/**
 * DXF Text Extractor (Lightweight)
 * 
 * Extracts only TEXT and MTEXT entities from DXF for semantic enrichment.
 * Does NOT calculate geometry (that comes from CSV).
 * Used to enrich layer matching with spatial text context.
 */

import DxfParser from 'dxf-parser';

// ============================================================================
// TYPES
// ============================================================================

export interface DXFTextEntity {
    text: string;
    position: { x: number; y: number };
    layer: string;
    type: 'TEXT' | 'MTEXT';
}

export interface LayerTextAssociation {
    layer: string;
    textsNearby: string[];           // Normalized texts found near this layer's geometry
    keywords: string[];              // Keywords extracted from layer name
    hasGeometry: boolean;            // Does this layer have geometry (not just text)?
    entityTypes: string[];           // Types of entities in this layer
}

export interface DXFContext {
    layerTexts: Map<string, string[]>;      // Layer → nearby texts
    layerKeywords: Map<string, string[]>;   // Layer → keywords from layer name
    layerHasGeometry: Map<string, boolean>; // Layer → has measurable geometry
    allTexts: DXFTextEntity[];              // All extracted text entities
    // P0.3: Block counts for unit items
    blockCounts: Map<string, number>;       // Block name → count (for unit items)
    blocksByLayer: Map<string, Map<string, number>>; // Layer → (Block name → count)
    summary: {
        totalLayers: number;
        layersWithGeometry: number;
        totalTextEntities: number;
        totalBlocks: number;                // Total INSERT count
        uniqueBlockNames: number;           // Unique block names
    };
}

// ============================================================================
// KEYWORD EXTRACTION
// ============================================================================

const NOISE_WORDS = new Set([
    'de', 'la', 'el', 'los', 'las', 'en', 'con', 'para', 'por', 'del',
    'a', 'y', 'o', 'e', 'u', 'the', 'of', 'and', 'for', 'to', 'in', 'on'
]);

/**
 * Extract meaningful keywords from a layer name
 */
function extractKeywords(layerName: string): string[] {
    // Normalize: split by common separators, lowercase
    const tokens = layerName
        .toLowerCase()
        .replace(/[-_.\s]+/g, ' ')
        .split(' ')
        .filter(t => t.length > 2 && !NOISE_WORDS.has(t));

    return [...new Set(tokens)];
}

/**
 * Normalize text for comparison
 */
function normalizeText(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove accents
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// ============================================================================
// DXF PARSING (LIGHTWEIGHT)
// ============================================================================

/**
 * Extract text entities from DXF content
 */
export function extractTextsFromDXF(dxfContent: string): DXFTextEntity[] {
    const parser = new DxfParser();
    const texts: DXFTextEntity[] = [];

    try {
        const dxf = parser.parseSync(dxfContent);

        if (!dxf || !dxf.entities) {
            console.warn('[DXF Text Extractor] No entities found in DXF');
            return texts;
        }

        for (const entity of dxf.entities) {
            const e = entity as any; // Cast to any for dynamic properties

            // Extract TEXT entities
            if (entity.type === 'TEXT' && e.text) {
                texts.push({
                    text: e.text,
                    position: {
                        x: e.startPoint?.x || e.position?.x || 0,
                        y: e.startPoint?.y || e.position?.y || 0
                    },
                    layer: entity.layer || '0',
                    type: 'TEXT'
                });
            }

            // Extract MTEXT entities
            if (entity.type === 'MTEXT' && e.text) {
                // MTEXT can have formatting codes, clean them
                const cleanText = (e.text as string)
                    .replace(/\\[A-Za-z]+;/g, '')  // Remove format codes
                    .replace(/\{|\}/g, '')          // Remove braces
                    .replace(/\\P/g, ' ')           // Paragraph breaks
                    .trim();

                if (cleanText) {
                    texts.push({
                        text: cleanText,
                        position: {
                            x: e.position?.x || 0,
                            y: e.position?.y || 0
                        },
                        layer: entity.layer || '0',
                        type: 'MTEXT'
                    });
                }
            }
        }

        console.log(`[DXF Text Extractor] Extracted ${texts.length} text entities`);

    } catch (error) {
        console.warn('[DXF Text Extractor] Parse error:', error);
    }

    return texts;
}

/**
 * Get layers with geometry (not just text/dimensions)
 */
export function getLayersWithGeometry(dxfContent: string): Map<string, string[]> {
    const parser = new DxfParser();
    const layerEntities: Map<string, string[]> = new Map();

    const GEOMETRY_TYPES = ['LINE', 'LWPOLYLINE', 'POLYLINE', 'CIRCLE', 'ARC', 'HATCH', 'INSERT'];

    try {
        const dxf = parser.parseSync(dxfContent);

        if (!dxf || !dxf.entities) return layerEntities;

        for (const entity of dxf.entities) {
            const layer = entity.layer || '0';

            if (GEOMETRY_TYPES.includes(entity.type)) {
                if (!layerEntities.has(layer)) {
                    layerEntities.set(layer, []);
                }
                const types = layerEntities.get(layer)!;
                if (!types.includes(entity.type)) {
                    types.push(entity.type);
                }
            }
        }

    } catch (error) {
        console.warn('[DXF Text Extractor] Error getting layer geometry:', error);
    }

    return layerEntities;
}

/**
 * P1.3: Associate texts with nearby layers using spatial proximity
 * Uses text positions and layer centroids for better context
 */
export function associateTextsWithLayers(
    texts: DXFTextEntity[],
    layerGeometryMap: Map<string, string[]>,
    layerCentroids?: Map<string, { x: number; y: number }> // Optional: pre-calculated centroids
): Map<string, string[]> {
    const layerTexts: Map<string, string[]> = new Map();

    // Initialize all geometry layers
    for (const layer of layerGeometryMap.keys()) {
        layerTexts.set(layer, []);
    }

    // Calculate text positions by layer (for centroid estimation if not provided)
    const layerTextPositions: Map<string, { sumX: number; sumY: number; count: number }> = new Map();

    // First pass: Associate by same layer (high confidence)
    for (const text of texts) {
        const normalizedText = normalizeText(text.text);
        if (normalizedText.length < 2) continue;

        // Track positions for centroid calculation
        const layer = text.layer;
        if (!layerTextPositions.has(layer)) {
            layerTextPositions.set(layer, { sumX: 0, sumY: 0, count: 0 });
        }
        const pos = layerTextPositions.get(layer)!;
        pos.sumX += text.position.x;
        pos.sumY += text.position.y;
        pos.count++;

        // Associate with same layer if it has geometry
        if (layerGeometryMap.has(layer)) {
            const existing = layerTexts.get(layer) || [];
            if (!existing.includes(normalizedText)) {
                existing.push(normalizedText);
                layerTexts.set(layer, existing);
            }
        }
    }

    // Calculate centroids from text positions (rough approximation)
    const calculatedCentroids: Map<string, { x: number; y: number }> = new Map();
    for (const [layer, pos] of layerTextPositions) {
        if (pos.count > 0) {
            calculatedCentroids.set(layer, {
                x: pos.sumX / pos.count,
                y: pos.sumY / pos.count
            });
        }
    }

    // Use provided centroids or calculated ones
    const centroids = layerCentroids || calculatedCentroids;

    // Second pass: Associate by keywords OR spatial proximity
    const PROXIMITY_THRESHOLD = 50; // Units (adjust based on typical drawing scale)

    for (const text of texts) {
        const normalizedText = normalizeText(text.text);
        if (normalizedText.length < 2) continue;

        for (const [layer] of layerGeometryMap) {
            // Skip if already associated
            const existing = layerTexts.get(layer) || [];
            if (existing.includes(normalizedText)) continue;

            // Method 1: Keyword match
            const layerKeywords = extractKeywords(layer);
            const textKeywords = extractKeywords(normalizedText);
            const hasKeywordOverlap = layerKeywords.some(lk =>
                textKeywords.some(tk => lk.includes(tk) || tk.includes(lk))
            );

            // Method 2: Spatial proximity (if centroid available)
            let isNearby = false;
            const centroid = centroids.get(layer);
            if (centroid) {
                const distance = Math.sqrt(
                    Math.pow(text.position.x - centroid.x, 2) +
                    Math.pow(text.position.y - centroid.y, 2)
                );
                isNearby = distance < PROXIMITY_THRESHOLD;
            }

            // Associate if keyword match OR nearby
            if (hasKeywordOverlap || isNearby) {
                existing.push(normalizedText);
                layerTexts.set(layer, existing);
            }
        }
    }

    return layerTexts;
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Extract block counts from DXF (INSERT entities)
 * Returns both global counts and counts per layer
 */
function extractBlockCounts(dxfContent: string): {
    blockCounts: Map<string, number>;
    blocksByLayer: Map<string, Map<string, number>>;
    totalBlocks: number;
} {
    const parser = new DxfParser();
    const blockCounts: Map<string, number> = new Map();
    const blocksByLayer: Map<string, Map<string, number>> = new Map();
    let totalBlocks = 0;

    try {
        const dxf = parser.parseSync(dxfContent);

        if (!dxf || !dxf.entities) {
            return { blockCounts, blocksByLayer, totalBlocks };
        }

        for (const entity of dxf.entities) {
            if (entity.type === 'INSERT') {
                const e = entity as any;
                const blockName = e.name || e.block || 'UNKNOWN';
                const layer = entity.layer || '0';

                // Global count
                blockCounts.set(blockName, (blockCounts.get(blockName) || 0) + 1);

                // Per-layer count
                if (!blocksByLayer.has(layer)) {
                    blocksByLayer.set(layer, new Map());
                }
                const layerBlocks = blocksByLayer.get(layer)!;
                layerBlocks.set(blockName, (layerBlocks.get(blockName) || 0) + 1);

                totalBlocks++;
            }
        }

        console.log(`[DXF Text Extractor] Found ${totalBlocks} blocks (${blockCounts.size} unique names)`);

    } catch (error) {
        console.warn('[DXF Text Extractor] Error extracting blocks:', error);
    }

    return { blockCounts, blocksByLayer, totalBlocks };
}

/**
 * Build DXF context for enhanced matching
 */
export function buildDXFContext(dxfContent: string): DXFContext {
    console.log('[DXF Text Extractor] Building context...');

    // 1. Extract all texts
    const allTexts = extractTextsFromDXF(dxfContent);

    // 2. Get layers with geometry
    const layerGeometryMap = getLayersWithGeometry(dxfContent);

    // 3. Associate texts with layers
    const layerTexts = associateTextsWithLayers(allTexts, layerGeometryMap);

    // 4. Extract keywords from layer names
    const layerKeywords: Map<string, string[]> = new Map();
    for (const layer of layerGeometryMap.keys()) {
        layerKeywords.set(layer, extractKeywords(layer));
    }

    // 5. Build hasGeometry map
    const layerHasGeometry: Map<string, boolean> = new Map();
    for (const layer of layerGeometryMap.keys()) {
        layerHasGeometry.set(layer, true);
    }

    // 6. P0.3: Extract block counts for unit items
    const { blockCounts, blocksByLayer, totalBlocks } = extractBlockCounts(dxfContent);

    const context: DXFContext = {
        layerTexts,
        layerKeywords,
        layerHasGeometry,
        allTexts,
        blockCounts,
        blocksByLayer,
        summary: {
            totalLayers: layerGeometryMap.size,
            layersWithGeometry: layerGeometryMap.size,
            totalTextEntities: allTexts.length,
            totalBlocks,
            uniqueBlockNames: blockCounts.size,
        }
    };

    console.log(`[DXF Text Extractor] Context built: ${context.summary.totalLayers} layers, ${context.summary.totalTextEntities} texts, ${context.summary.totalBlocks} blocks`);

    return context;
}

/**
 * Get a summary string for logging
 */
export function getDXFContextSummary(context: DXFContext): string {
    const lines: string[] = [
        `🔍 DXF Context Summary`,
        `├─ Layers with geometry: ${context.summary.layersWithGeometry}`,
        `├─ Text entities: ${context.summary.totalTextEntities}`,
    ];

    // Top 5 layers with most associated texts
    const layersByTexts = [...context.layerTexts.entries()]
        .filter(([, texts]) => texts.length > 0)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 5);

    if (layersByTexts.length > 0) {
        lines.push(`└─ Top layers with texts:`);
        for (const [layer, texts] of layersByTexts) {
            lines.push(`   └─ ${layer}: ${texts.slice(0, 3).join(', ')}${texts.length > 3 ? '...' : ''}`);
        }
    }

    return lines.join('\n');
}
