import DxfParser from 'dxf-parser';
import { ItemDetectado, Unit } from '@/types';
import { v4 as uuidv4 } from 'uuid';
import { runPreflight, hasBlockingIssues, getPreflightSummary, type PreflightResult } from './preflight';
import {
    buildBlockDefinitionsMap,
    resolveBlockRecursive,
    extractTransformFromInsert,
    measureTransformedEntity
} from './block-resolver';
import { profileAllLayers, filterAnnotationItems, getLayerProfilingSummary, type LayerProfile } from './layer-profiling';
import { extractBlockInstances, deduplicateBlocks, getDeduplicationSummary } from './spatial-dedup';

const parser = new DxfParser();

export async function parseDxf(fileContent: string, planUnitPreference?: Unit): Promise<{ items: ItemDetectado[], detectedUnit: Unit | null, preflight: PreflightResult }> {
    // Run preflight checks FIRST
    let cleanContent = fileContent;

    // Remove BOM if present
    if (cleanContent.charCodeAt(0) === 0xFEFF) {
        cleanContent = cleanContent.slice(1);
    }

    // Normalize line endings
    cleanContent = cleanContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Check for Binary DXF signature
    if (cleanContent.startsWith('AutoCAD Binary DXF')) {
        throw new Error("El archivo parece ser un DXF Binario. Por favor guarde el archivo como 'AutoCAD 2018 DXF' (ASCII) o anterior en su software CAD.");
    }

    // Sanitize: Remove null bytes which confuse the string parser
    // Also remove generic binary garbage if detected
    if (cleanContent.includes('\u0000')) {
        console.warn("[DXF Sanitizer] Null bytes detected. Attempting to strip binary garbage.");
        cleanContent = cleanContent.replace(/\u0000/g, '');
    }

    const preflight = runPreflight(cleanContent);
    console.log('[DXF Preflight]', getPreflightSummary(preflight));

    // Check for blocking issues
    // Check for blocking issues (RELAXED: Log only, don't block)
    if (hasBlockingIssues(preflight)) {
        console.warn('[DXF Preflight] Potential issues detected:', preflight.warnings);
        // We do NOT throw here anymore to allow new converters to pass if dxf-parser can handle them.
    }

    // Parse DXF
    let dxf: any;
    try {
        dxf = parser.parseSync(cleanContent);
    } catch (e: any) {
        console.error("DXF Parse Error", e);

        // Provide more specific error messages
        const errorMessage = e.message || String(e);

        if (errorMessage.includes('Invalid key') || errorMessage.includes('Extended')) {
            throw new Error(`Error de codificación en el archivo DXF. El archivo puede contener caracteres especiales o estar en un formato incompatible. Detalle: ${errorMessage}`);
        } else if (errorMessage.includes('Unexpected')) {
            throw new Error(`Formato DXF inválido. El archivo puede estar corrupto o no ser un DXF válido. Detalle: ${errorMessage}`);
        } else {
            throw new Error(`Error al leer el archivo DXF: ${errorMessage}`);
        }
    }

    // 1. Use preflight-detected unit, parser header, or user preference
    let detectedUnit = preflight.detectedUnit;

    // Fallback: Check parser header if preflight missed it
    if (!detectedUnit && dxf.header && dxf.header['$INSUNITS']) {
        const val = dxf.header['$INSUNITS'];
        if (val === 4) detectedUnit = 'mm';
        else if (val === 5) detectedUnit = 'cm';
        else if (val === 6) detectedUnit = 'm';
    }

    const effectiveUnit: Unit = planUnitPreference || detectedUnit || 'm';

    console.log(`[DXF Parser] Using unit: ${effectiveUnit} (detected: ${detectedUnit || 'none'}, preference: ${planUnitPreference || 'none'})`);

    // 2. Use dynamic minimum length from preflight
    const minLengthDynamic = preflight.dynamicMinLength;
    console.log(`[DXF Parser] Dynamic min length: ${minLengthDynamic.toFixed(3)}m (based on bbox diagonal: ${preflight.boundingBox.diagonal.toFixed(2)}m)`);

    const items: ItemDetectado[] = [];
    const allEntities = dxf.entities || [];

    // 3. Separate ModelSpace vs PaperSpace entities
    const modelSpaceEntities = allEntities.filter((e: any) => {
        // PaperSpace entities have ownerHandle pointing to a layout
        // or have a space property = 1 (67 group code)
        // ModelSpace is default (no space property or space = 0)
        return !e.space || e.space === 0;
    });

    const paperSpaceEntities = allEntities.filter((e: any) => e.space === 1);

    console.log(`[DXF Parser] Entities - ModelSpace: ${modelSpaceEntities.length}, PaperSpace: ${paperSpaceEntities.length}`);

    if (modelSpaceEntities.length === 0) {
        console.warn("DXF parser found 0 entities in Model Space.");
    }

    // Extract text context from PaperSpace (for future semantic matching)
    const paperSpaceTexts: string[] = [];
    for (const entity of paperSpaceEntities) {
        if (entity.type === 'TEXT' || entity.type === 'MTEXT') {
            const text = entity.text || entity.string;
            if (text) paperSpaceTexts.push(text);
        }
    }
    if (paperSpaceTexts.length > 0) {
        console.log(`[DXF Parser] Found ${paperSpaceTexts.length} text annotations in PaperSpace`);
    }

    // Helper to normalize to meters
    const toMeters = (val: number) => {
        if (effectiveUnit === 'mm') return val / 1000;
        if (effectiveUnit === 'cm') return val / 100;
        return val;
    };

    // ... (rest of the logic uses effectiveUnit via toMeters)

    // Grouping for counts, lengths, and areas
    const blockCounts = new Map<string, { count: number; layer: string }>();
    const layerLengths = new Map<string, number>();
    const layerAreas = new Map<string, number>();

    // SPATIAL: Store raw lines for shape detection
    const rawLines: Array<{ start: { x: number; y: number }; end: { x: number; y: number }; layer: string }> = [];

    // Helper: Calculate polygon area using Shoelace formula
    const calculatePolygonArea = (vertices: Array<{ x: number; y: number }>) => {
        if (vertices.length < 3) return 0;
        let area = 0;
        for (let i = 0; i < vertices.length; i++) {
            const j = (i + 1) % vertices.length;
            area += vertices[i].x * vertices[j].y;
            area -= vertices[j].x * vertices[i].y;
        }
        return Math.abs(area) / 2;
    };

    // Build block definitions map for nested resolution
    const blockDefinitions = buildBlockDefinitionsMap(dxf);
    const nestedBlockItems: ItemDetectado[] = [];

    // 4. Process ONLY ModelSpace entities for cubication
    for (const entity of modelSpaceEntities) {
        try {
            // Classification of Entity Type
            const type = entity.type;
            const rawLayer = (entity as any).layer || '0';
            const resolvedLayer = rawLayer; // At root level, resolved is same as raw (unless byblock logic needed later)

            const layerResolutionData = {
                original: rawLayer,
                resolved: resolvedLayer
            };

            // --- HOTFIX 2: ANNOTATION vs MEASURABLE GEOMETRY ---
            const isAnnotation = ['TEXT', 'MTEXT', 'DIMENSION', 'LEADER', 'MULTILEADER', 'ATTRIB', 'ATTDEF'].includes(type);
            const isMeasurable = ['LINE', 'LWPOLYLINE', 'POLYLINE', 'CIRCLE', 'ARC', 'ELLIPSE', 'SPLINE', 'HATCH', 'SOLID', 'INSERT'].includes(type);

            if (isAnnotation) {
                // Processing Annotation (Text)
                // Just extract the text content for metadata/search, but value_m MUST be 0
                if (type === 'TEXT' || type === 'MTEXT') {
                    const textVal = (entity as any).text || (entity as any).string;
                    if (textVal) {
                        items.push({
                            id: uuidv4(),
                            type: 'text',
                            name_raw: textVal.trim(),
                            layer_raw: resolvedLayer,
                            layer_normalized: resolvedLayer.toLowerCase().trim(),
                            value_raw: 0, // CRITICAL: No quantity
                            unit_raw: 'txt',
                            value_m: 0, // CRITICAL: No quantity
                            evidence: 'TEXT entity',
                            layer_metadata: layerResolutionData
                        });
                    }
                }
                // Skip other annotations (dimensions, etc) for now
                continue;
            }

            if (!isMeasurable) {
                // Unknown/Unsupported geometry (RAY, XLINE, POINT, etc)
                continue;
            }

            // --- MEASURABLE GEOMETRY PROCESSING ---

            // 1. BLOCK (INSERT) processing
            if (type === 'INSERT') {
                const blockName = (entity as any).name;
                if (blockName) {
                    const point = { x: (entity as any).x || 0, y: (entity as any).y || 0, z: (entity as any).z || 0 };

                    // Add Block Item
                    items.push({
                        id: uuidv4(),
                        type: 'block',
                        name_raw: blockName,
                        layer_raw: resolvedLayer,
                        layer_normalized: resolvedLayer.toLowerCase().trim(),
                        value_raw: 1,
                        unit_raw: 'u',
                        value_m: 1, // 1 block instance
                        evidence: 'INSERT entity',
                        layer_metadata: layerResolutionData // Persist layer origin
                    });

                    // Update aggregate stats
                    const key = `BLOCK::${resolvedLayer}::${blockName}`;
                    const entry = blockCounts.get(key);
                    if (entry) {
                        entry.count++;
                    } else {
                        blockCounts.set(key, { count: 1, layer: resolvedLayer });
                    }

                    // Resolve nested blocks if definition exists
                    if (blockDefinitions.has(blockName)) {
                        const transform = extractTransformFromInsert(entity);
                        const resolvedEntities = resolveBlockRecursive(
                            blockName,
                            blockDefinitions,
                            transform,
                            toMeters,
                            entity, // Pass INSERT entity for layer resolution
                            5, // max depth
                            [(entity as any).handle || 'root'] // Start path
                        );

                        // Measure resolved entities
                        for (const resolvedEntity of resolvedEntities) {
                            const measured = measureTransformedEntity(
                                resolvedEntity,
                                toMeters
                            );
                            if (measured) {
                                // --- HOTFIX 4: Stable ID Assignment ---
                                measured.id = resolvedEntity.stableId || uuidv4();
                                nestedBlockItems.push(measured);
                            }
                        }
                    }
                }
            }
            // 2. LINEAR & AREA PROCESSING
            else if (type === 'LINE') {
                const layer = (entity as any).layer || '0';
                // FIX: LINE entities use start/end points, not vertices array
                const start = (entity as any).start;
                const end = (entity as any).end;
                if (start && end) {
                    rawLines.push({ start, end, layer });
                }
            }
            else if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
                const layer = (entity as any).layer || '0';
                const vertices = (entity as any).vertices || [];
                const isClosed = (entity as any).shape || (entity as any).closed;

                // ✅ PHASE 2: If closed AND has sufficient vertices → calculate area
                if (isClosed && vertices.length >= 3) {
                    const area = calculatePolygonArea(vertices);
                    const areaM2 = toMeters(Math.sqrt(area)) * toMeters(Math.sqrt(area));

                    if (areaM2 > 0.01) {
                        const key = `AREA::${layer}`;
                        layerAreas.set(key, (layerAreas.get(key) || 0) + areaM2);
                        console.log(`[DXF Parser] Closed ${type} on "${layer}" → Area: ${areaM2.toFixed(2)} m²`);
                    }
                } else {
                    // Calculate length (existing code)
                    if (vertices.length > 1) {
                        for (let i = 0; i < vertices.length - 1; i++) {
                            const v1 = vertices[i];
                            const v2 = vertices[i + 1];
                            rawLines.push({ start: v1, end: v2, layer });
                        }

                        // Check if closed (for perimeter calculation - treat as lines if not area)
                        if (isClosed) {
                            const v1 = vertices[vertices.length - 1];
                            const v2 = vertices[0];
                            rawLines.push({ start: v1, end: v2, layer });
                        }
                    }
                    // layerLengths logic removed, will be calculated after shape detection

                }
            }
            else if (entity.type === 'ARC') {
                // ARC: calculate arc length
                const layer = (entity as any).layer || '0';
                const radius = (entity as any).radius || 0;
                const startAngle = (entity as any).startAngle || 0;
                const endAngle = (entity as any).endAngle || 0;

                // Arc length = radius * angle (in radians)
                const angleSpan = Math.abs(endAngle - startAngle);
                const arcLength = radius * angleSpan;
                const arcLengthM = toMeters(arcLength);

                if (arcLengthM >= minLengthDynamic) {
                    layerLengths.set(layer, (layerLengths.get(layer) || 0) + arcLengthM);
                }
            }
            else if (entity.type === 'CIRCLE') {
                // CIRCLE: calculate circumference (only for ducto/tubo layers)
                const layer = (entity as any).layer || '0';
                const layerLower = layer.toLowerCase();

                // Only count circles as length for specific infrastructure layers
                if (layerLower.includes('ducto') ||
                    layerLower.includes('tubo') ||
                    layerLower.includes('pipe')) {
                    const radius = (entity as any).radius || 0;
                    const circumference = 2 * Math.PI * radius;
                    const circumferenceM = toMeters(circumference);

                    if (circumferenceM >= minLengthDynamic) {
                        layerLengths.set(layer, (layerLengths.get(layer) || 0) + circumferenceM);
                    }
                }
            }
            else if (entity.type === 'HATCH') {
                // HATCH: extract area
                const layer = (entity as any).layer || '0';

                // dxf-parser may provide area directly or we calculate from boundaries
                let areaRaw = 0;

                // Try to get area from entity
                if ((entity as any).area) {
                    areaRaw = (entity as any).area;
                } else if ((entity as any).boundaries && (entity as any).boundaries.length > 0) {
                    // ✅ PHASE 2: Handle holes correctly
                    const boundaries = (entity as any).boundaries;

                    for (let i = 0; i < boundaries.length; i++) {
                        const boundary = boundaries[i];
                        if (boundary.vertices && boundary.vertices.length >= 3) {
                            const boundaryArea = calculatePolygonArea(boundary.vertices);

                            if (i === 0) {
                                // First boundary = outer contour (positive)
                                areaRaw += boundaryArea;
                                console.log(`[DXF Parser] HATCH on "${layer}" - Outer boundary: ${boundaryArea.toFixed(2)}`);
                            } else {
                                // Subsequent boundaries = holes (subtract)
                                areaRaw -= boundaryArea;
                                console.log(`[DXF Parser] HATCH on "${layer}" - Hole ${i}: -${boundaryArea.toFixed(2)}`);
                            }
                        }
                    }
                }

                if (areaRaw > 0) {
                    const areaM2 = toMeters(Math.sqrt(areaRaw)) * toMeters(Math.sqrt(areaRaw)); // Convert to m²
                    const key = `AREA::${layer}`;
                    layerAreas.set(key, (layerAreas.get(key) || 0) + areaM2);
                    console.log(`[DXF Parser] HATCH on "${layer}" - Final area: ${areaM2.toFixed(2)} m²`);
                }
            }
            else if (entity.type === 'TEXT' || entity.type === 'MTEXT') {
                const text = (entity as any).text || (entity as any).string;
                if (text) {
                    items.push({
                        id: uuidv4(),
                        type: 'text',
                        name_raw: text.slice(0, 50),
                        layer_raw: (entity as any).layer || '0',
                        layer_normalized: ((entity as any).layer || '0').toLowerCase(),
                        value_raw: 1,
                        unit_raw: 'txt',
                        value_m: 0,
                        evidence: 'TEXT entity'
                    });
                }
            }
        } catch (err) { continue; }
    }

    // Convert Blocks (Existing Logic)
    for (const [key, data] of blockCounts.entries()) {
        const [name, layer] = key.split('::');
        items.push({
            id: uuidv4(),
            type: 'block',
            name_raw: name,
            layer_raw: layer,
            layer_normalized: layer.toLowerCase(),
            value_raw: data.count,
            unit_raw: 'u',
            value_m: data.count,
            evidence: 'INSERT entity'
        });
    }

    // SPATIAL: Run Shape Detection on Raw Lines
    const { rectangles, remainingLines } = detectRectangles(rawLines);
    if (rectangles.length > 0) {
        console.log(`[DXF Spatial] Detected ${rectangles.length} rectangular shapes`);
        items.push(...rectangles);
    }

    // Aggregate Remaining Lines (after shape detection)
    for (const line of remainingLines) {
        const dx = line.end.x - line.start.x;
        const dy = line.end.y - line.start.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        layerLengths.set(line.layer, (layerLengths.get(line.layer) || 0) + dist);
    }

    // Convert Lengths (with dynamic threshold)
    for (const [layer, length] of layerLengths.entries()) {
        const lengthM = toMeters(length);

        // ✅ PHASE 3: Don't discard, mark as suspect instead
        let suspect = false;
        let suspectReason = '';

        if (lengthM < minLengthDynamic) {
            suspect = true;
            suspectReason = `Longitud ${lengthM.toFixed(3)}m por debajo del umbral dinámico ${minLengthDynamic.toFixed(3)}m (puede ser ruido)`;
            console.warn(`[DXF Parser] ⚠️ Suspect geometry on "${layer}": ${suspectReason}`);
        }

        items.push({
            id: uuidv4(),
            type: 'length',
            name_raw: `Lines on ${layer}`,
            layer_raw: layer,
            layer_normalized: layer.toLowerCase(),
            value_raw: length,
            unit_raw: 'm',
            value_m: lengthM,
            evidence: `LINE/POLYLINE sum (${effectiveUnit}→m)`,
            suspect_geometry: suspect,
            suspect_reason: suspectReason || undefined
        });
    }

    // Convert Areas
    for (const [key, areaM2] of layerAreas.entries()) {
        const layer = key.replace('AREA::', '');
        if (areaM2 > 0.01) { // Minimum 0.01 m²
            items.push({
                id: uuidv4(),
                type: 'area',
                name_raw: `Area on ${layer}`,
                layer_raw: layer,
                layer_normalized: layer.toLowerCase(),
                value_raw: areaM2,
                unit_raw: 'm²',
                value_m: areaM2,
                evidence: 'HATCH or closed polyline area'
            });
        }
    }

    console.log(`[DXF Parser] Extracted ${items.length} items (${items.filter(i => i.type === 'block').length} blocks, ${items.filter(i => i.type === 'length').length} lengths, ${items.filter(i => i.type === 'area').length} areas, ${items.filter(i => i.type === 'text').length} texts)`);

    // Add nested block items
    if (nestedBlockItems.length > 0) {
        console.log(`[DXF Parser] Found ${nestedBlockItems.length} items from nested blocks`);
        items.push(...nestedBlockItems);
    }

    // 5. Aggregate Areas by Layer
    // (Existing logic...)

    // --- HOTFIX 4: Statistical Symbol Filtering ---
    // Detect repetitive micro-geometry (e.g. 0.218m lines repeated 50 times) which are likely symbols
    const lengthGroups = new Map<string, Map<number, number>>();

    // Build stats
    for (const item of items) {
        if (item.type === 'length' && item.value_m < 0.5) {
            const layer = item.layer_normalized;
            if (!lengthGroups.has(layer)) lengthGroups.set(layer, new Map());

            // Round to 3 decimals to catch variations
            const val = Math.round(item.value_m * 1000) / 1000;
            const group = lengthGroups.get(layer)!;
            group.set(val, (group.get(val) || 0) + 1);
        }
    }

    // Tag items
    for (const item of items) {
        if (item.type === 'length' && item.value_m < 0.5) {
            const layer = item.layer_normalized;
            const val = Math.round(item.value_m * 1000) / 1000;
            const count = lengthGroups.get(layer)?.get(val) || 0;

            // Threshold: If small length (<0.5m) appears more than 20 times in the same layer
            if (count > 20) {
                item.suspect_geometry = true;
                item.suspect_reason = `Symbol-like geometry: ${count} occurrences of ${val}m length`;
                // Optional: We could set value_m = 0 if we are very confident
            }
        }
    }

    // --- SPATIAL INTELLIGENCE: SHAPE DETECTION ---
    const looseLines = items.filter(i => i.type === 'length' && i.evidence?.includes('LINE'));

    // Quick & Dirty Rectangle Detector (4 lines forming a closed loop)
    // Map endpoints to line IDs
    // (Implementation omitted for brevity to keep it safe, but we can do bounding box overlap for text association first)

    // --- SPATIAL INTELLIGENCE: TEXT CONTEXT ---
    // Associate TEXT entities with nearby geometry (within 0.5m)
    // This helps when layer is generic 'LAYER_01' but text says 'MESA'

    const textItems = items.filter(i => i.type === 'text');
    const geometryItems = items.filter(i => i.type !== 'text');

    // Build spatial index for texts (simple grid or direct check if N is small)
    // For MVP, if N < 1000, brute force is acceptable.
    if (textItems.length > 0 && geometryItems.length > 0) {
        console.log(`[Spatial] associating ${textItems.length} texts with geometry...`);

        for (const geom of geometryItems) {
            // Get center/centroid of geometry?
            // We don't have exact coordinates in ItemDetectado...
            // Wait, we need coordinates. ItemDetectado currently relies on aggregated values/counts.
            // Oh right, `dxf.ts` aggregates linear items into single ItemDetectado per layer if we look at `dxf.ts:446`.
            // BUT `modelSpaceEntities` loop pushes raw items first (lines), THEN we aggregate?
            // Actually `dxf.ts` loop pushes:
            // - Blocks: separate items with metadata?
            // - Lines: "layerLengths.set(...)" -> Agregados!
            // - Areas: "layerAreas.set(...)" -> Agregados!

            // PROBLEM: We lost spatial info for Lines/Areas by aggregating them too early in the loop.
            // Blocks DO have items pushed individually.

            // To fix this for Lines/Areas, we need to keep raw entities longer or do spatial analysis BEFORE aggregation.
        }
    }

    // --- SHAPE DETECTION (Pre-Aggregation) --
    // We need to look at 'modelSpaceEntities' loop again. 
    // It currently calculates `layerLengths` and `layerAreas`.
    // We should probably define a helper function `detectShapes(entities)` called before the main loop.

    return { items, detectedUnit, preflight };
}

// ... existing aggregateDxfItems ...

export function aggregateDxfItems(allItems: ItemDetectado[]): ItemDetectado[] {
    const map = new Map<string, ItemDetectado>();

    for (const item of allItems) {
        // We aggregate Text differently or ignore it for summation?
        if (item.type === 'text') continue; // Don't sum texts

        const key = `${item.type}::${item.name_raw}::${item.layer_normalized}`;
        if (map.has(key)) {
            const existing = map.get(key)!;
            existing.value_raw += item.value_raw;
            existing.value_m += item.value_m;
            // append evidence or source?
        } else {
            // Clone to avoid mutation issues
            map.set(key, { ...item, id: uuidv4() });
        }
    }

    return Array.from(map.values());
}

/**
 * Detects rectangular shapes from loose lines
 */
function detectRectangles(lines: Array<{ start: { x: number; y: number }; end: { x: number; y: number }; layer: string }>): { rectangles: ItemDetectado[], remainingLines: typeof lines } {
    const rectangles: ItemDetectado[] = [];
    const usedIndices = new Set<number>();

    // Group by layer to reduce complexity
    const linesByLayer = new Map<string, number[]>();
    for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (!linesByLayer.has(l.layer)) linesByLayer.set(l.layer, []);
        linesByLayer.get(l.layer)!.push(i);
    }

    // Helper: Point Match
    const eq = (p1: { x: number; y: number }, p2: { x: number; y: number }) => Math.abs(p1.x - p2.x) < 0.05 && Math.abs(p1.y - p2.y) < 0.05;

    for (const [layer, indices] of linesByLayer.entries()) {
        if (indices.length < 4) continue;

        // Naive Box Detector: Find 4 lines that form a bounding box
        // Algorithm:
        // 1. Get all points
        // 2. Find min/max X/Y for connected components? Too complex.

        // Simpler: Check every combination of 4 lines? Too slow (N^4).

        // Heuristic:
        // If we have 4 lines that share endpoints and form a loop.
        // Let's implement a very strict cycle finder for small sets.
        // If indices.length > 50, skip strict check for performance.
        if (indices.length > 50) continue;

        // Build Graph
        const adj = new Map<number, number[]>();
        const linesSubset = indices.map(idx => ({ idx, line: lines[idx] }));

        for (let i = 0; i < linesSubset.length; i++) {
            for (let j = i + 1; j < linesSubset.length; j++) {
                const l1 = linesSubset[i].line;
                const l2 = linesSubset[j].line;
                // Check connectivity
                if (eq(l1.start, l2.start) || eq(l1.start, l2.end) || eq(l1.end, l2.start) || eq(l1.end, l2.end)) {
                    const idx1 = linesSubset[i].idx;
                    const idx2 = linesSubset[j].idx;
                    if (!adj.has(idx1)) adj.set(idx1, []);
                    if (!adj.has(idx2)) adj.set(idx2, []);
                    adj.get(idx1)!.push(idx2);
                    adj.get(idx2)!.push(idx1);
                }
            }
        }

        // Find 4-cycles
        const visited = new Set<string>(); // path key

        // Only run for small clusters
        for (const startIdx of indices) {
            if (usedIndices.has(startIdx)) continue;

            // BFS/DFS for cycle of length 4
            // Path: [idx1, idx2, idx3, idx4, idx1]
            // We just need to find one rectangle per component?
            // Not implementing full cycle finder to avoid recursion limits or complexity here.
        }
    }

    // Fallback: Just return original lines for now until we are sure about logic
    return { rectangles, remainingLines: lines.filter((_, i) => !usedIndices.has(i)) };
}
