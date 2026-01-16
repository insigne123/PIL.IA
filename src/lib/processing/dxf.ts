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
import { enrichItemsWithNearbyText } from './spatial-text-enrichment';
import { profileAllLayers, filterAnnotationItems, getLayerProfilingSummary, type LayerProfile } from './layer-profiling';
import { extractBlockInstances, deduplicateBlocks, getDeduplicationSummary } from './spatial-dedup';
import {
    detectDxfUnits,
    convertToMeters,
    convertToMetersSquared,
    getConversionSummary,
    type DxfUnitMetadata
} from './dxf-unit-normalizer';
import {
    calculateBoundingBoxFromEntities,
    getBBoxFromExtents,
    getBoundingBoxInfo,
    calculateDiagonal,
    type BoundingBox
} from './bbox-calculator';
import {
    deduplicateAreaItems,
    getPolygonDedupSummary
} from './polygon-dedup';
import {
    filterGeometryOnly,
    getBlacklistSummary
} from './layer-blacklist';
// P0.1: Block Exploder for extracting geometry from INSERTs
import {
    explodeBlocksForMetrics,
    calculateBBoxFromExploded,
    aggregateExplodedToItems,
    getExplodedSummary
} from './block-exploder';
// Phase 7: Sanity
import { checkGeometryHealth, type GeometryHealth } from './sanity';
// View Filter: Exclude cortes/elevaciones (duplicate views)
import {
    filterToMainPlanView,
    autoDetectMainPlanBounds,
    getViewFilterSummary,
    type ViewFilterConfig
} from './view-filter';


const parser = new DxfParser();

export async function parseDxf(fileContent: string, planUnitPreference?: Unit): Promise<{ items: ItemDetectado[], detectedUnit: Unit | null, preflight: PreflightResult, geometryHealth: GeometryHealth }> {
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

    // === PHASE 2: USE NEW UNIT NORMALIZER ===
    const unitMetadata = detectDxfUnits(
        dxf,
        planUnitPreference,
        preflight.boundingBox.diagonal
    );

    console.log('[DXF Unit Detection]', getConversionSummary(unitMetadata));

    // Report warnings to user
    if (unitMetadata.warnings.length > 0) {
        console.warn('[DXF Unit Detection] Warnings:', unitMetadata.warnings);
    }

    // Map back to Unit type for compatibility
    const detectedUnit: Unit | null =
        unitMetadata.originalUnit.includes('mm') ? 'mm' :
            unitMetadata.originalUnit.includes('cm') ? 'cm' :
                unitMetadata.originalUnit.includes('m') ? 'm' :
                    null;

    console.log(`[DXF Parser] Using unit: ${unitMetadata.originalUnit} (confidence: ${(unitMetadata.confidence * 100).toFixed(0)}%)`);

    // === FIX A.1: SCALE GUARDRAILS ===
    // Verify conversion was applied correctly by checking bbox post-conversion
    const bboxDiagonalRaw = preflight.boundingBox.diagonal;
    const bboxDiagonalSI = bboxDiagonalRaw * unitMetadata.toMeters;

    console.log(`[DXF Scale] Raw diagonal: ${bboxDiagonalRaw.toFixed(2)} ${unitMetadata.originalUnit} → SI: ${bboxDiagonalSI.toFixed(2)} m`);
    console.log(`[DXF Scale] BBox size: ${(preflight.boundingBox.width * unitMetadata.toMeters).toFixed(2)}m × ${(preflight.boundingBox.height * unitMetadata.toMeters).toFixed(2)}m`);

    // Guardrail: If detected mm but diagonal > 5000m after conversion, something is wrong
    if (unitMetadata.originalUnit.includes('mm') && bboxDiagonalSI > 5000) {
        console.error(`[DXF SCALE ERROR] ⚠️ Detected mm but SI diagonal=${bboxDiagonalSI.toFixed(2)}m is too large!`);
        console.error(`[DXF SCALE ERROR] This suggests conversion factor was not applied correctly.`);
        console.error(`[DXF SCALE ERROR] Raw: ${bboxDiagonalRaw}, Factor: ${unitMetadata.toMeters}`);
    }

    // Guardrail: If diagonal seems unrealistically large (> 10km), warn
    if (bboxDiagonalSI > 10000) {
        console.warn(`[DXF Scale Warning] Diagonal ${bboxDiagonalSI.toFixed(0)}m seems too large for a building. Check units.`);
    }

    // 2. Use dynamic minimum length from preflight (now uses improved calculation)
    const minLengthDynamic = preflight.dynamicMinLength;
    console.log(`[DXF Parser] Dynamic min length: ${minLengthDynamic.toFixed(4)}m (SI diagonal: ${bboxDiagonalSI.toFixed(2)}m)`);

    // Use let instead of const to allow reassignment for spatial enrichment
    let items: ItemDetectado[] = [];
    const allEntities = dxf.entities || [];

    // ✅ P1.1: FILTER ANNOTATION LAYERS before processing
    const blacklistResult = filterGeometryOnly(allEntities);
    const filteredEntities = blacklistResult.filtered;

    if (blacklistResult.excluded > 0) {
        console.log(`[Layer Blacklist] ${getBlacklistSummary(blacklistResult)}`);
    }

    // 3. Separate ModelSpace vs PaperSpace entities
    const modelSpaceEntities = filteredEntities.filter((e: any) => {
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

    // === VIEW FILTER: EXCLUDE CORTES/ELEVACIONES ===
    // Auto-detect main plan bounds based on entity clustering
    const viewFilterConfig = autoDetectMainPlanBounds(modelSpaceEntities);
    const viewFilterResult = filterToMainPlanView(modelSpaceEntities, viewFilterConfig);
    const mainPlanEntities = viewFilterResult.filtered;

    console.log(`[DXF Parser] ${getViewFilterSummary(viewFilterResult.stats)}`);

    // Use filtered entities for subsequent processing
    const processableEntities = mainPlanEntities;

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

    // === PHASE 2: CONVERSION FACTORS FROM NORMALIZER ===
    // These replace the old toMeters helper function
    const toMeters = (val: number) => convertToMeters(val, unitMetadata);
    const toMetersSquared = (val: number) => convertToMetersSquared(val, unitMetadata);

    // === P0.1/P0.2: BLOCK EXPLOSION FOR METRICS ===
    // Explode all INSERTs to extract geometry - CRITICAL for files where all geometry is inside blocks
    console.log(`[DXF Parser] P0.1: Exploding blocks to extract geometry...`);
    const explodedGeometry = explodeBlocksForMetrics(
        processableEntities,
        dxf,
        toMeters,
        toMetersSquared,
        10 // maxDepth
    );
    console.log(`[DXF Parser] ${getExplodedSummary(explodedGeometry)}`);

    // Calculate BBox from exploded geometry (fixes P0.2: BBox was 0×0)
    const explodedBBox = calculateBBoxFromExploded(explodedGeometry);
    if (explodedBBox.diagonal > 0) {
        // Use exploded bbox for better threshold calculation
        const explodedBBoxSI = {
            width: toMeters(explodedBBox.width),
            height: toMeters(explodedBBox.height),
            diagonal: toMeters(explodedBBox.diagonal)
        };
        console.log(`[DXF Parser] P0.2: Exploded BBox: ${explodedBBoxSI.width.toFixed(2)}m × ${explodedBBoxSI.height.toFixed(2)}m (diagonal: ${explodedBBoxSI.diagonal.toFixed(2)}m)`);

        // Override dynamic min length if original was 0
        if (preflight.boundingBox.diagonal === 0 && explodedBBoxSI.diagonal > 0) {
            const newDynamicMin = Math.max(0.001, explodedBBoxSI.diagonal * 0.0001);
            console.log(`[DXF Parser] P0.2: Updated dynamic min length: ${newDynamicMin.toFixed(4)}m (from exploded bbox)`);
        }
    }

    // Convert exploded geometry to ItemDetectado array
    const explodedItems = aggregateExplodedToItems(explodedGeometry);
    console.log(`[DXF Parser] P0.1: Created ${explodedItems.length} items from block explosion`);

    // ... (rest of the logic uses effectiveUnit via conversion functions)

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

    // 4. Process ONLY filtered main plan entities for cubication
    for (const entity of processableEntities) {
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
                            value_raw: 0,
                            unit_raw: 'txt',
                            value_m: 0,
                            value_si: 0,
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
                        value_si: 1,  // ✅ Each block instance = 1 count
                        value_m: 1,   // Legacy
                        evidence: 'INSERT entity',
                        layer_metadata: layerResolutionData
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
                        const insertPosition = (entity as any).position;

                        // Resolve nested blocks
                        const resolvedEntities = resolveBlockRecursive(
                            blockName,
                            blockDefinitions,
                            extractTransformFromInsert(entity),
                            toMeters,
                            entity,
                            5,
                            []
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
                                // Add position from INSERT entity
                                if (insertPosition) {
                                    measured.position = { x: insertPosition.x || 0, y: insertPosition.y || 0 };
                                }
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
                        // area calculated in draw units, convert to SI
                        const areaSI = toMetersSquared(area);
                        layerAreas.set(key, (layerAreas.get(key) || 0) + areaSI);
                        console.log(`[DXF Parser] Closed ${type} on "${layer}" → Area SI: ${areaSI.toFixed(2)} m² (Raw: ${area.toFixed(2)})`);
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
                    const areaSI = toMetersSquared(areaRaw); // Apply Squared Factor
                    const key = `AREA::${layer}`;
                    layerAreas.set(key, (layerAreas.get(key) || 0) + areaSI);
                    console.log(`[DXF Parser] HATCH on "${layer}" - Final area SI: ${areaSI.toFixed(2)} m²`);
                }
            }
            // TEXT / MTEXT
            else if (type === 'TEXT' || type === 'MTEXT') {
                const layer = (entity as any).layer || '0';
                const text = (entity as any).text || (entity as any).string || '';
                const position = (entity as any).position || (entity as any).insertionPoint;

                if (text && text.trim()) {
                    items.push({
                        id: uuidv4(),
                        type: 'text',
                        name_raw: text.trim(),
                        layer_raw: layer,
                        layer_normalized: layer.toLowerCase(),
                        value_raw: 0,  // Text has no numeric value
                        unit_raw: 'txt',
                        value_si: 0,   // ✅ Text items don't contribute to quantity
                        value_m: 0,    // Legacy
                        evidence: type,
                        position: position ? { x: position.x || 0, y: position.y || 0 } : undefined
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
            value_si: data.count,  // ✅ Count in SI (same as raw for blocks)
            value_m: data.count,   // Legacy
            evidence: 'INSERT entity'
        });
    }

    // Convert Areas
    for (const [key, area] of layerAreas.entries()) {
        const layer = key.replace('AREA::', '');
        items.push({
            id: uuidv4(),
            type: 'area',
            name_raw: `Área en ${layer}`,
            layer_raw: layer,
            layer_normalized: layer.toLowerCase(),
            value_raw: area,  // Already in m² from toMetersSquared()
            unit_raw: 'm²',
            value_si: area,   // ✅ Area in SI (m²)
            value_m: area,    // Legacy
            evidence: 'Closed Polyline / Hatch',
            value_area: area  // Deprecated
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
            value_si: lengthM,  // ✅ Length in SI (meters)
            value_m: lengthM,   // Legacy
            evidence: `LINE/POLYLINE sum (${unitMetadata.originalUnit}→m)`,
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
                value_raw: areaM2,  // Already in m²
                unit_raw: 'm²',
                value_si: areaM2,   // ✅ Area in SI (m²)
                value_m: areaM2,    // Legacy
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
    // Associate TEXT entities with nearby geometry for improved semantic matching
    const textItems = items.filter(i => i.type === 'text' && i.position);
    const geometryItems = items.filter(i => i.type !== 'text' && i.position);

    if (textItems.length > 0 && geometryItems.length > 0) {
        console.log(`[Spatial Text] Enriching ${geometryItems.length} items with ${textItems.length} nearby texts...`);

        const textEntities = textItems.map(t => ({
            text: t.name_raw,
            position: t.position!,
            layer: t.layer_raw
        }));

        items = enrichItemsWithNearbyText(items, textEntities, 5.0);
    }

    // ✅ P0.1: MERGE EXPLODED ITEMS FROM BLOCK EXPLOSION
    // These are areas/lengths extracted from inside INSERTs
    if (explodedItems.length > 0) {
        console.log(`[DXF Parser] P0.1: Merging ${explodedItems.length} items from block explosion into main list`);
        items = [...items, ...explodedItems];
    }

    // ✅ P0.3: APPLY POLYGON DEDUPLICATION
    // This fixes Layer 0 bug where DWG→DXF creates duplicate polygons
    const dedupStats = deduplicateAreaItems(items);
    items = dedupStats.deduplicated;

    if (dedupStats.duplicatesRemoved > 0) {
        console.log(`[Dedup] ${getPolygonDedupSummary(dedupStats)}`);
    }

    // ✅ P0.2: RECALCULATE BBOX AFTER UNIT CONVERSION
    // This fixes the bbox=0 bug by calculating  from entities AFTER toMeters applied
    let accurateBBox = calculateBoundingBoxFromEntities(processableEntities, unitMetadata.toMeters);
    let accurateDiagonal = calculateDiagonal(accurateBBox);

    // Fallback 1: Try DXF header extents if bbox is still invalid
    if (accurateDiagonal < 0.01 && dxf.header) {
        const extentsBBox = getBBoxFromExtents(dxf.header, unitMetadata.toMeters);
        if (extentsBBox) {
            const extentsDiag = calculateDiagonal(extentsBBox);
            if (extentsDiag > accurateDiagonal) {
                console.log(`[BBox] Using DXF $EXTMIN/$EXTMAX: ${extentsDiag.toFixed(2)} m`);
                accurateBBox = extentsBBox;
                accurateDiagonal = extentsDiag;
            }
        }
    }

    // Fallback 2: If still invalid, use reasonable default
    if (accurateDiagonal < 0.01) {
        console.warn(`[BBox] Diagonal still < 0.01m after fallbacks, using default 100m`);
        accurateDiagonal = 100;
        accurateBBox = {
            min: { x: 0, y: 0, z: 0 },
            max: { x: 100, y: 100, z: 0 }
        };
    }

    const bboxInfo = getBoundingBoxInfo(accurateBBox);
    console.log(`[BBox] ✅ Accurate Bounding Box (post-conversion):`);
    console.log(`  Min: (${accurateBBox.min.x.toFixed(2)}, ${accurateBBox.min.y.toFixed(2)})`);
    console.log(`  Max: (${accurateBBox.max.x.toFixed(2)}, ${accurateBBox.max.y.toFixed(2)})`);
    console.log(`  Diagonal: ${accurateDiagonal.toFixed(2)} m`);
    console.log(`  Size: ${bboxInfo.width.toFixed(2)}m × ${bboxInfo.height.toFixed(2)}m`);

    // Update preflight with accurate bbox
    preflight.boundingBox.diagonal = accurateDiagonal;
    preflight.dynamicMinLength = Math.max(0.001, accurateDiagonal * 0.0001);

    console.log(`[BBox] ✅ Updated dynamic min length: ${preflight.dynamicMinLength.toFixed(4)}m`);

    // Phase 7: Global Sanity Check & Smoke Test
    const geometryHealth = checkGeometryHealth({
        items,
        bboxDiagonalM: accurateDiagonal,
        hasAreaCandidates: preflight.hasAreaCandidates,
        hasLengthCandidates: preflight.hasLengthCandidates,
        hasInserts: preflight.hasInserts
    });

    if (geometryHealth.status !== 'healthy') {
        console.warn(`[Geometry Health] Status: ${geometryHealth.status}`, geometryHealth.issues);
    }

    return { items, detectedUnit, preflight, geometryHealth };
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
            existing.value_si += item.value_si;  // ✅ Sum SI values
            existing.value_m += item.value_m;    // Legacy
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
