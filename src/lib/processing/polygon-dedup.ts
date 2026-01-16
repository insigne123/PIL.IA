/**
 * Polygon Deduplication
 * 
 * Detects and removes duplicate polygons based on geometry signature
 * Fixes the Layer 0 bug where DWG→DXF conversion creates multiple identical polygons
 */

export interface Point {
    x: number;
    y: number;
    z?: number;
}

export interface PolygonSignature {
    area: number;
    centroid: { x: number; y: number };
    vertexCount: number;
    vertexHash: string;
}

/**
 * Calculate centroid (geometric center) of a polygon
 */
function calculateCentroid(vertices: Point[]): { x: number; y: number } {
    if (vertices.length === 0) {
        return { x: 0, y: 0 };
    }

    let sumX = 0;
    let sumY = 0;

    for (const v of vertices) {
        sumX += v.x;
        sumY += v.y;
    }

    return {
        x: sumX / vertices.length,
        y: sumY / vertices.length
    };
}

/**
 * Calculate polygon area using Shoelace formula
 */
function calculatePolygonArea(vertices: Point[]): number {
    if (vertices.length < 3) return 0;

    let area = 0;
    const n = vertices.length;

    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += vertices[i].x * vertices[j].y;
        area -= vertices[j].x * vertices[i].y;
    }

    return Math.abs(area / 2);
}

/**
 * Create a unique signature for a polygon based on its geometry
 */
export function calculatePolygonSignature(
    vertices: Point[],
    tolerance: number = 0.01
): PolygonSignature {
    const area = calculatePolygonArea(vertices);
    const centroid = calculateCentroid(vertices);

    // Create hash from sorted, rounded vertices
    // This handles polygons with same shape but different starting vertex
    const roundedVertices = vertices.map(v => ({
        x: Math.round(v.x / tolerance) * tolerance,
        y: Math.round(v.y / tolerance) * tolerance
    }));

    // Sort by x, then y to normalize vertex order
    const sortedVertices = [...roundedVertices].sort((a, b) => {
        if (Math.abs(a.x - b.x) > tolerance / 10) return a.x - b.x;
        return a.y - b.y;
    });

    // Create hash string
    const vertexHash = sortedVertices
        .map(v => `${v.x.toFixed(2)},${v.y.toFixed(2)}`)
        .join('|');

    return {
        area: Math.round(area * 100) / 100, // Round to 2 decimals
        centroid: {
            x: Math.round(centroid.x * 100) / 100,
            y: Math.round(centroid.y * 100) / 100
        },
        vertexCount: vertices.length,
        vertexHash
    };
}

/**
 * Check if two polygon signatures match (same polygon)
 */
export function signaturesMatch(
    sig1: PolygonSignature,
    sig2: PolygonSignature,
    areaTolerance: number = 0.01,
    centroidTolerance: number = 0.1
): boolean {
    // Check area
    if (Math.abs(sig1.area - sig2.area) > areaTolerance) {
        return false;
    }

    // Check centroid distance
    const dx = sig1.centroid.x - sig2.centroid.x;
    const dy = sig1.centroid.y - sig2.centroid.y;
    const centroidDist = Math.sqrt(dx * dx + dy * dy);

    if (centroidDist > centroidTolerance) {
        return false;
    }

    // Check vertex count
    if (sig1.vertexCount !== sig2.vertexCount) {
        return false;
    }

    // Check vertex hash (exact match)
    return sig1.vertexHash === sig2.vertexHash;
}

/**
 * FIX D.1: Annotation/import layers that should be deprioritized in cross-layer dedup
 * If a polygon exists in both a measurable layer AND an annotation layer, keep the measurable one
 */
const ANNOTATION_LAYER_PATTERNS = [
    'pdf_geometry', 'pdf-', 'pdf',
    'g-dim', 'g-text', 'g-anno',
    'dimen', 'dimension', 'dim',
    'annotation', 'anno',
    'import', 'dwf', 'xref',
    'defpoints'
];

/**
 * Check if a layer is an annotation/import layer
 */
function isAnnotationLayer(layerName: string): boolean {
    if (!layerName) return false;
    const lower = layerName.toLowerCase();
    return ANNOTATION_LAYER_PATTERNS.some(pattern => lower.includes(pattern));
}

/**
 * Deduplicate area items based on polygon signature
 * FIX D.1: Now with two phases:
 *   1. Within-layer dedup (same as before)
 *   2. Cross-layer dedup: annotation layers lose to measurable layers
 */
export function deduplicateAreaItems(
    items: any[]
): {
    deduplicated: any[];
    duplicatesRemoved: number;
    duplicatesByLayer: Map<string, number>;
} {
    // PHASE 1: Within-layer deduplication
    const seen = new Map<string, { item: any; signature: PolygonSignature }>();
    const phase1Result: any[] = [];
    let duplicatesRemoved = 0;
    const duplicatesByLayer = new Map<string, number>();

    for (const item of items) {
        // Only deduplicate area items
        if (item.type !== 'area') {
            phase1Result.push(item);
            continue;
        }

        const layer = item.layer_normalized || '0';
        const area = Math.round(item.value_si * 100) / 100; // Round to 2 decimals

        // Phase 1 key: layer::area (within-layer dedup)
        const withinLayerKey = `${layer}::${area}`;

        if (seen.has(withinLayerKey)) {
            duplicatesRemoved++;
            duplicatesByLayer.set(layer, (duplicatesByLayer.get(layer) || 0) + 1);
            continue;
        }

        seen.set(withinLayerKey, { item, signature: { area, centroid: { x: 0, y: 0 }, vertexCount: 0, vertexHash: '' } });
        phase1Result.push(item);
    }

    // PHASE 2: Cross-layer deduplication (annotation layers lose to measurable)
    // Build a map of area -> items across all layers
    const areaToItems = new Map<number, any[]>();

    for (const item of phase1Result) {
        if (item.type !== 'area') continue;

        const area = Math.round(item.value_si * 100) / 100;
        const existing = areaToItems.get(area) || [];
        existing.push(item);
        areaToItems.set(area, existing);
    }

    // For each area value, if there are items from both measurable and annotation layers,
    // keep only the measurable ones
    const itemsToRemove = new Set<string>();

    for (const [area, areaItems] of areaToItems.entries()) {
        if (areaItems.length <= 1) continue;

        const measurableItems = areaItems.filter(i => !isAnnotationLayer(i.layer_normalized));
        const annotationItems = areaItems.filter(i => isAnnotationLayer(i.layer_normalized));

        // Only remove annotation items if there's at least one measurable item with same area
        if (measurableItems.length > 0 && annotationItems.length > 0) {
            for (const annoItem of annotationItems) {
                itemsToRemove.add(annoItem.id);
                duplicatesRemoved++;

                const layer = annoItem.layer_normalized || '0';
                duplicatesByLayer.set(layer, (duplicatesByLayer.get(layer) || 0) + 1);

                console.log(`[Dedup] Cross-layer: Removing ${area.toFixed(2)}m² from annotation layer "${layer}" (exists in measurable layer)`);
            }
        }
    }

    // Filter out annotation duplicates
    const deduplicated = phase1Result.filter(item => !itemsToRemove.has(item.id));

    return {
        deduplicated,
        duplicatesRemoved,
        duplicatesByLayer
    };
}

/**
 * Get polygon deduplication summary for logging
 */
export function getPolygonDedupSummary(stats: {
    duplicatesRemoved: number;
    duplicatesByLayer: Map<string, number>;
}): string {
    if (stats.duplicatesRemoved === 0) {
        return 'No duplicates found';
    }

    const layerSummary = Array.from(stats.duplicatesByLayer.entries())
        .map(([layer, count]) => `${layer} (${count})`)
        .join(', ');

    return `Removed ${stats.duplicatesRemoved} duplicates from layers: ${layerSummary}`;
}

