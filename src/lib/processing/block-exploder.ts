/**
 * Block Exploder Module
 * 
 * P0.1: Explodes INSERT entities to extract all inner geometry for metrics calculation.
 * This is CRITICAL because many DXF files have all geometry inside blocks.
 * 
 * Key behaviors:
 * 1. Recursively resolve block definitions
 * 2. Apply transforms (translate/rotate/scale) to geometry
 * 3. Resolve layer "0" inheritance from INSERT
 * 4. Extract areas, lengths, and points for bbox calculation
 */

import { v4 as uuidv4 } from 'uuid';
import { ItemDetectado } from '@/types';
import {
    buildBlockDefinitionsMap,
    extractTransformFromInsert,
    composeTransforms,
    transformPoint,
    type Transform,
    type BlockDefinition,
    type Point
} from './block-resolver';

export interface ExplodedGeometry {
    // Points for BBox calculation
    points: Point[];

    // Area geometry (HATCHes, closed polylines)
    areas: Array<{
        layer: string;
        layer_normalized: string;
        area_m2: number;
        vertices: Point[];
        source: 'HATCH' | 'CLOSED_POLYLINE';
    }>;

    // Length geometry (lines, polylines)
    lengths: Array<{
        layer: string;
        layer_normalized: string;
        length_m: number;
        source: 'LINE' | 'POLYLINE' | 'LWPOLYLINE' | 'ARC' | 'CIRCLE';
    }>;

    // Block instances (for counting)
    blocks: Array<{
        name: string;
        layer: string;
        layer_normalized: string;
        position: Point;
    }>;

    // Statistics
    stats: {
        insertsProcessed: number;
        entitiesExploded: number;
        maxDepth: number;
        layersFound: Set<string>;
    };
}

/**
 * Shoelace formula for polygon area
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
    return Math.abs(area) / 2;
}

/**
 * Calculate distance between two points
 */
function distance(p1: Point, p2: Point): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Resolve effective layer for entity inside block
 * CAD rule: Layer "0" entities inherit the INSERT's layer
 */
function resolveEffectiveLayer(entityLayer: string, insertLayer: string): string {
    if (entityLayer === '0' || entityLayer === '' || !entityLayer) {
        return insertLayer;
    }
    return entityLayer;
}

/**
 * Extract vertices from various entity types
 */
function extractVertices(entity: any, transform: Transform): Point[] {
    const vertices: Point[] = [];
    const type = entity.type;

    if (type === 'LINE') {
        if (entity.start) vertices.push(transformPoint(entity.start, transform));
        if (entity.end) vertices.push(transformPoint(entity.end, transform));
    }
    else if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
        const rawVertices = entity.vertices || [];
        for (const v of rawVertices) {
            vertices.push(transformPoint(v, transform));
        }
    }
    else if (type === 'CIRCLE') {
        // For circles, use center + 4 cardinal points for bbox
        const center = entity.center || { x: 0, y: 0 };
        const r = entity.radius || 0;
        const transformedCenter = transformPoint(center, transform);
        vertices.push(
            { x: transformedCenter.x - r, y: transformedCenter.y, z: 0 },
            { x: transformedCenter.x + r, y: transformedCenter.y, z: 0 },
            { x: transformedCenter.x, y: transformedCenter.y - r, z: 0 },
            { x: transformedCenter.x, y: transformedCenter.y + r, z: 0 }
        );
    }
    else if (type === 'ARC') {
        const center = entity.center || { x: 0, y: 0 };
        const r = entity.radius || 0;
        const startAngle = entity.startAngle || 0;
        const endAngle = entity.endAngle || Math.PI * 2;

        // Sample arc for bbox
        const sampleCount = 8;
        for (let i = 0; i <= sampleCount; i++) {
            const angle = startAngle + (endAngle - startAngle) * (i / sampleCount);
            const point = {
                x: center.x + r * Math.cos(angle),
                y: center.y + r * Math.sin(angle),
                z: 0
            };
            vertices.push(transformPoint(point, transform));
        }
    }
    else if (type === 'HATCH') {
        // Extract vertices from HATCH boundaries
        const boundaries = entity.boundaries || [];
        for (const boundary of boundaries) {
            if (boundary.vertices) {
                for (const v of boundary.vertices) {
                    vertices.push(transformPoint(v, transform));
                }
            }
        }
    }

    return vertices;
}

/**
 * Main function: Explode all INSERTs in ModelSpace to extract geometry
 */
export function explodeBlocksForMetrics(
    entities: any[],
    dxf: any,
    toMeters: (val: number) => number,
    toMetersSquared: (val: number) => number,
    maxDepth: number = 10
): ExplodedGeometry {
    const result: ExplodedGeometry = {
        points: [],
        areas: [],
        lengths: [],
        blocks: [],
        stats: {
            insertsProcessed: 0,
            entitiesExploded: 0,
            maxDepth: 0,
            layersFound: new Set()
        }
    };

    // Build block definitions map
    const blockDefs = buildBlockDefinitionsMap(dxf);
    console.log(`[Block Exploder] Found ${blockDefs.size} block definitions`);

    // Identity transform for root entities
    const identityTransform: Transform = {
        position: { x: 0, y: 0, z: 0 },
        rotation: 0,
        scale: { x: 1, y: 1, z: 1 }
    };

    // Process all entities
    processEntities(entities, blockDefs, identityTransform, '0', 0, maxDepth, result, toMeters, toMetersSquared);

    console.log(`[Block Exploder] Processed ${result.stats.insertsProcessed} INSERTs, exploded ${result.stats.entitiesExploded} entities`);
    console.log(`[Block Exploder] Found ${result.areas.length} areas, ${result.lengths.length} lengths, ${result.points.length} bbox points`);
    console.log(`[Block Exploder] Max depth reached: ${result.stats.maxDepth}`);

    return result;
}

/**
 * Recursively process entities and explode INSERTs
 */
function processEntities(
    entities: any[],
    blockDefs: Map<string, BlockDefinition>,
    parentTransform: Transform,
    parentLayer: string,
    depth: number,
    maxDepth: number,
    result: ExplodedGeometry,
    toMeters: (val: number) => number,
    toMetersSquared: (val: number) => number
): void {
    if (depth > maxDepth) {
        console.warn(`[Block Exploder] Max depth ${maxDepth} reached, stopping recursion`);
        return;
    }

    result.stats.maxDepth = Math.max(result.stats.maxDepth, depth);

    for (const entity of entities) {
        const type = entity.type;
        const rawLayer = entity.layer || '0';
        const effectiveLayer = resolveEffectiveLayer(rawLayer, parentLayer);

        result.stats.layersFound.add(effectiveLayer);

        // Handle INSERT - recursively explode
        if (type === 'INSERT') {
            const blockName = entity.name;
            if (!blockName) continue;

            const blockDef = blockDefs.get(blockName);
            if (!blockDef) {
                console.warn(`[Block Exploder] Block definition not found: ${blockName}`);
                continue;
            }

            result.stats.insertsProcessed++;

            // Get transform from INSERT
            const insertTransform = extractTransformFromInsert(entity);
            const composedTransform = composeTransforms(parentTransform, insertTransform);

            // Record block for counting
            const position = transformPoint(entity.position || { x: 0, y: 0 }, parentTransform);
            result.blocks.push({
                name: blockName,
                layer: effectiveLayer,
                layer_normalized: effectiveLayer.toLowerCase(),
                position
            });

            // Recursively process block's entities
            processEntities(
                blockDef.entities,
                blockDefs,
                composedTransform,
                effectiveLayer, // Pass INSERT's layer for "0" inheritance
                depth + 1,
                maxDepth,
                result,
                toMeters,
                toMetersSquared
            );

            continue;
        }

        // Skip annotation entities
        if (['TEXT', 'MTEXT', 'DIMENSION', 'LEADER', 'ATTRIB', 'ATTDEF'].includes(type)) {
            continue;
        }

        result.stats.entitiesExploded++;

        // Extract vertices for bbox
        const vertices = extractVertices(entity, parentTransform);
        result.points.push(...vertices);

        // Process HATCH for area
        if (type === 'HATCH') {
            const boundaries = entity.boundaries || [];
            let totalArea = 0;
            const allVertices: Point[] = [];

            for (let i = 0; i < boundaries.length; i++) {
                const boundary = boundaries[i];
                if (boundary.vertices && boundary.vertices.length >= 3) {
                    const transformedVerts = boundary.vertices.map((v: Point) =>
                        transformPoint(v, parentTransform)
                    );
                    const areaRaw = calculatePolygonArea(transformedVerts);

                    if (i === 0) {
                        totalArea += areaRaw; // Outer boundary
                    } else {
                        totalArea -= areaRaw; // Holes
                    }
                    allVertices.push(...transformedVerts);
                }
            }

            if (totalArea > 0) {
                const areaSI = toMetersSquared(totalArea);
                result.areas.push({
                    layer: effectiveLayer,
                    layer_normalized: effectiveLayer.toLowerCase(),
                    area_m2: areaSI,
                    vertices: allVertices,
                    source: 'HATCH'
                });
            }
        }

        // Process closed polylines for area
        else if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
            const rawVerts = entity.vertices || [];
            const isClosed = entity.shape || entity.closed;

            if (isClosed && rawVerts.length >= 3) {
                const transformedVerts = rawVerts.map((v: Point) =>
                    transformPoint(v, parentTransform)
                );
                const areaRaw = calculatePolygonArea(transformedVerts);

                if (areaRaw > 0) {
                    const areaSI = toMetersSquared(areaRaw);
                    result.areas.push({
                        layer: effectiveLayer,
                        layer_normalized: effectiveLayer.toLowerCase(),
                        area_m2: areaSI,
                        vertices: transformedVerts,
                        source: 'CLOSED_POLYLINE'
                    });
                }
            }

            // Also calculate length (even for closed polylines - perimeter)
            if (rawVerts.length >= 2) {
                let totalLength = 0;
                for (let i = 0; i < rawVerts.length - 1; i++) {
                    const p1 = transformPoint(rawVerts[i], parentTransform);
                    const p2 = transformPoint(rawVerts[i + 1], parentTransform);
                    totalLength += distance(p1, p2);
                }
                if (isClosed && rawVerts.length > 2) {
                    const pFirst = transformPoint(rawVerts[0], parentTransform);
                    const pLast = transformPoint(rawVerts[rawVerts.length - 1], parentTransform);
                    totalLength += distance(pLast, pFirst);
                }

                if (totalLength > 0) {
                    result.lengths.push({
                        layer: effectiveLayer,
                        layer_normalized: effectiveLayer.toLowerCase(),
                        length_m: toMeters(totalLength),
                        source: type as 'POLYLINE' | 'LWPOLYLINE'
                    });
                }
            }
        }

        // Process LINE for length
        else if (type === 'LINE') {
            if (entity.start && entity.end) {
                const p1 = transformPoint(entity.start, parentTransform);
                const p2 = transformPoint(entity.end, parentTransform);
                const lengthRaw = distance(p1, p2);

                if (lengthRaw > 0) {
                    result.lengths.push({
                        layer: effectiveLayer,
                        layer_normalized: effectiveLayer.toLowerCase(),
                        length_m: toMeters(lengthRaw),
                        source: 'LINE'
                    });
                }
            }
        }

        // Process CIRCLE for length (circumference)
        else if (type === 'CIRCLE') {
            const r = entity.radius || 0;
            if (r > 0) {
                const circumference = 2 * Math.PI * r;
                result.lengths.push({
                    layer: effectiveLayer,
                    layer_normalized: effectiveLayer.toLowerCase(),
                    length_m: toMeters(circumference),
                    source: 'CIRCLE'
                });
            }
        }

        // Process ARC for length
        else if (type === 'ARC') {
            const r = entity.radius || 0;
            const startAngle = entity.startAngle || 0;
            const endAngle = entity.endAngle || Math.PI * 2;
            let arcLength = Math.abs(endAngle - startAngle) * r;

            if (arcLength > 0) {
                result.lengths.push({
                    layer: effectiveLayer,
                    layer_normalized: effectiveLayer.toLowerCase(),
                    length_m: toMeters(arcLength),
                    source: 'ARC'
                });
            }
        }
    }
}

/**
 * Calculate bounding box from exploded geometry points
 */
export function calculateBBoxFromExploded(exploded: ExplodedGeometry): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
    diagonal: number;
} {
    if (exploded.points.length === 0) {
        return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0, diagonal: 0 };
    }

    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const p of exploded.points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }

    const width = maxX - minX;
    const height = maxY - minY;
    const diagonal = Math.sqrt(width * width + height * height);

    return { minX, minY, maxX, maxY, width, height, diagonal };
}

/**
 * Aggregate exploded geometry into ItemDetectado array
 */
export function aggregateExplodedToItems(exploded: ExplodedGeometry): ItemDetectado[] {
    const items: ItemDetectado[] = [];

    // Aggregate areas by layer
    const areasByLayer = new Map<string, number>();
    for (const area of exploded.areas) {
        const key = area.layer_normalized;
        areasByLayer.set(key, (areasByLayer.get(key) || 0) + area.area_m2);
    }

    for (const [layer, totalArea] of areasByLayer.entries()) {
        items.push({
            id: uuidv4(),
            type: 'area',
            name_raw: `Exploded Area on ${layer}`,
            layer_raw: layer,
            layer_normalized: layer.toLowerCase(),
            value_raw: totalArea,
            unit_raw: 'm²',
            value_si: totalArea,
            value_m: totalArea,
            evidence: 'Block Explosion (HATCH/Closed Polyline)'
        });
    }

    // Aggregate lengths by layer
    const lengthsByLayer = new Map<string, number>();
    for (const length of exploded.lengths) {
        const key = length.layer_normalized;
        lengthsByLayer.set(key, (lengthsByLayer.get(key) || 0) + length.length_m);
    }

    for (const [layer, totalLength] of lengthsByLayer.entries()) {
        items.push({
            id: uuidv4(),
            type: 'length',
            name_raw: `Exploded Length on ${layer}`,
            layer_raw: layer,
            layer_normalized: layer.toLowerCase(),
            value_raw: totalLength,
            unit_raw: 'm',
            value_si: totalLength,
            value_m: totalLength,
            evidence: 'Block Explosion (LINE/POLYLINE/ARC)'
        });
    }

    // Block counts by name+layer
    const blockCounts = new Map<string, { name: string; layer: string; count: number }>();
    for (const block of exploded.blocks) {
        const key = `${block.layer_normalized}::${block.name}`;
        const existing = blockCounts.get(key);
        if (existing) {
            existing.count++;
        } else {
            blockCounts.set(key, { name: block.name, layer: block.layer, count: 1 });
        }
    }

    for (const [, data] of blockCounts.entries()) {
        items.push({
            id: uuidv4(),
            type: 'block',
            name_raw: data.name,
            layer_raw: data.layer,
            layer_normalized: data.layer.toLowerCase(),
            value_raw: data.count,
            unit_raw: 'u',
            value_si: data.count,
            value_m: data.count,
            evidence: 'Block Explosion (INSERT count)'
        });
    }

    return items;
}

/**
 * Get summary for logging
 */
export function getExplodedSummary(exploded: ExplodedGeometry): string {
    const totalArea = exploded.areas.reduce((sum, a) => sum + a.area_m2, 0);
    const totalLength = exploded.lengths.reduce((sum, l) => sum + l.length_m, 0);

    return [
        `Block Explosion Results:`,
        `  INSERTs processed: ${exploded.stats.insertsProcessed}`,
        `  Entities exploded: ${exploded.stats.entitiesExploded}`,
        `  Max depth: ${exploded.stats.maxDepth}`,
        `  Layers found: ${exploded.stats.layersFound.size}`,
        `  Total area: ${totalArea.toFixed(2)} m²`,
        `  Total length: ${totalLength.toFixed(2)} m`,
        `  Block instances: ${exploded.blocks.length}`
    ].join('\n');
}
