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

    const preflight = runPreflight(cleanContent);
    console.log('[DXF Preflight]', getPreflightSummary(preflight));

    // Check for blocking issues
    if (hasBlockingIssues(preflight)) {
        const errorParts = [
            'El archivo DXF tiene problemas críticos que impiden el procesamiento:',
            ...preflight.warnings,
            '',
            'Recomendaciones:',
            ...preflight.recommendations
        ];
        throw new Error(errorParts.join('\n'));
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

    // 1. Use preflight-detected unit or user preference
    const detectedUnit = preflight.detectedUnit;
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
            if (entity.type === 'INSERT') {
                let name = (entity as any).name || (entity as any).block || 'UnknownBlock';
                const layer = (entity as any).layer || '0';
                const key = `${name}::${layer}`;
                if (!blockCounts.has(key)) blockCounts.set(key, { count: 0, layer });
                blockCounts.get(key)!.count++;

                // Resolve nested blocks if definition exists
                if (blockDefinitions.has(name)) {
                    const transform = extractTransformFromInsert(entity);
                    const resolvedEntities = resolveBlockRecursive(
                        name,
                        blockDefinitions,
                        transform,
                        toMeters,
                        entity, // Pass INSERT entity for layer resolution
                        5 // max depth
                    );

                    // Measure resolved entities
                    for (const resolvedEntity of resolvedEntities) {
                        const measured = measureTransformedEntity(
                            resolvedEntity,
                            toMeters
                        );
                        if (measured) {
                            nestedBlockItems.push(measured);
                        }
                    }
                }
            }
            else if (entity.type === 'LINE') {
                const layer = (entity as any).layer || '0';
                // FIX: LINE entities use start/end points, not vertices array
                const start = (entity as any).start;
                const end = (entity as any).end;
                if (start && end) {
                    const dx = end.x - start.x;
                    const dy = end.y - start.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    layerLengths.set(layer, (layerLengths.get(layer) || 0) + dist);
                }
            }
            else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
                const layer = (entity as any).layer || '0';
                const vertices = (entity as any).vertices || [];
                let totalDist = 0;

                if (vertices.length > 1) {
                    for (let i = 0; i < vertices.length - 1; i++) {
                        const v1 = vertices[i];
                        const v2 = vertices[i + 1];

                        // Check if this segment has a bulge (arc)
                        if (v1.bulge && v1.bulge !== 0) {
                            // Calculate arc length from bulge
                            // bulge = tan(angle/4)
                            const dx = v2.x - v1.x;
                            const dy = v2.y - v1.y;
                            const chord = Math.sqrt(dx * dx + dy * dy);
                            const bulge = Math.abs(v1.bulge);

                            // Arc length formula with bulge
                            const angle = 4 * Math.atan(bulge);
                            const radius = chord / (2 * Math.sin(angle / 2));
                            const arcLength = radius * angle;

                            totalDist += arcLength;
                        } else {
                            // Straight line segment
                            const dx = v2.x - v1.x;
                            const dy = v2.y - v1.y;
                            totalDist += Math.sqrt(dx * dx + dy * dy);
                        }
                    }

                    // Check if closed
                    if ((entity as any).shape || (entity as any).closed) {
                        const v1 = vertices[vertices.length - 1];
                        const v2 = vertices[0];

                        if (v1.bulge && v1.bulge !== 0) {
                            const dx = v2.x - v1.x;
                            const dy = v2.y - v1.y;
                            const chord = Math.sqrt(dx * dx + dy * dy);
                            const bulge = Math.abs(v1.bulge);
                            const angle = 4 * Math.atan(bulge);
                            const radius = chord / (2 * Math.sin(angle / 2));
                            const arcLength = radius * angle;
                            totalDist += arcLength;
                        } else {
                            const dx = v2.x - v1.x;
                            const dy = v2.y - v1.y;
                            totalDist += Math.sqrt(dx * dx + dy * dy);
                        }
                    }
                }
                layerLengths.set(layer, (layerLengths.get(layer) || 0) + totalDist);
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
                    // Calculate area from boundary polylines using Shoelace formula
                    for (const boundary of (entity as any).boundaries) {
                        if (boundary.vertices && boundary.vertices.length >= 3) {
                            areaRaw += calculatePolygonArea(boundary.vertices);
                        }
                    }
                }

                if (areaRaw > 0) {
                    const areaM2 = toMeters(Math.sqrt(areaRaw)) * toMeters(Math.sqrt(areaRaw)); // Convert to m²
                    const key = `AREA::${layer}`;
                    layerAreas.set(key, (layerAreas.get(key) || 0) + areaM2);
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

    // Convert Blocks
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

    // Convert Lengths (with dynamic threshold)
    for (const [layer, length] of layerLengths.entries()) {
        const lengthM = toMeters(length);

        // Use dynamic threshold instead of fixed 0.01
        if (lengthM < minLengthDynamic) {
            console.log(`[DXF Parser] Skipping layer "${layer}" - length ${lengthM.toFixed(3)}m below threshold ${minLengthDynamic.toFixed(3)}m`);
            continue;
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
            evidence: `LINE/POLYLINE sum (${effectiveUnit}->m)`
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

    return { items, detectedUnit, preflight };
}

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
