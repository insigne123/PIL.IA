import { ItemDetectado } from '@/types';
import { v4 as uuidv4 } from 'uuid';

export interface Point {
    x: number;
    y: number;
    z?: number;
}

export interface Transform {
    position: Point;
    rotation: number; // radians
    scale: Point;
}

export interface BlockDefinition {
    name: string;
    entities: any[];
}

/**
 * Compose two transformations (parent * child)
 */
export function composeTransforms(parent: Transform, child: Transform): Transform {
    const cos = Math.cos(parent.rotation);
    const sin = Math.sin(parent.rotation);

    // Rotate and scale child position, then translate by parent position
    const rotatedX = child.position.x * cos - child.position.y * sin;
    const rotatedY = child.position.x * sin + child.position.y * cos;

    return {
        position: {
            x: parent.position.x + rotatedX * parent.scale.x,
            y: parent.position.y + rotatedY * parent.scale.y,
            z: (parent.position.z || 0) + (child.position.z || 0) * (parent.scale.z || 1)
        },
        rotation: parent.rotation + child.rotation,
        scale: {
            x: parent.scale.x * child.scale.x,
            y: parent.scale.y * child.scale.y,
            z: (parent.scale.z || 1) * (child.scale.z || 1)
        }
    };
}

/**
 * Apply transformation to a point
 */
export function transformPoint(point: Point, transform: Transform): Point {
    const cos = Math.cos(transform.rotation);
    const sin = Math.sin(transform.rotation);

    const scaledX = point.x * transform.scale.x;
    const scaledY = point.y * transform.scale.y;

    const rotatedX = scaledX * cos - scaledY * sin;
    const rotatedY = scaledX * sin + scaledY * cos;

    return {
        x: transform.position.x + rotatedX,
        y: transform.position.y + rotatedY,
        z: (transform.position.z || 0) + (point.z || 0) * (transform.scale.z || 1)
    };
}

/**
 * Extract transform from INSERT entity
 */
export function extractTransformFromInsert(insertEntity: any): Transform {
    const position: Point = {
        x: insertEntity.position?.x || 0,
        y: insertEntity.position?.y || 0,
        z: insertEntity.position?.z || 0
    };

    const rotation = insertEntity.rotation || 0; // Already in radians in dxf-parser

    const scale: Point = {
        x: insertEntity.xScale || insertEntity.scaleX || 1,
        y: insertEntity.yScale || insertEntity.scaleY || 1,
        z: insertEntity.zScale || insertEntity.scaleZ || 1
    };

    return { position, rotation, scale };
}

/**
 * Recursively resolve a block and its nested blocks
 * Returns array of resolved entities with their absolute transformations
 */
export function resolveBlockRecursive(
    blockName: string,
    blocks: Map<string, BlockDefinition>,
    transform: Transform,
    toMeters: (val: number) => number,
    maxDepth: number = 5,
    currentDepth: number = 0
): Array<{ entity: any; transform: Transform; depth: number }> {
    if (currentDepth >= maxDepth) {
        console.warn(`[Block Resolver] Max depth ${maxDepth} reached for block "${blockName}"`);
        return [];
    }

    const blockDef = blocks.get(blockName);
    if (!blockDef) {
        // Block not found - might be a standard AutoCAD block or missing definition
        return [];
    }

    const resolvedEntities: Array<{ entity: any; transform: Transform; depth: number }> = [];

    for (const entity of blockDef.entities) {
        if (entity.type === 'INSERT') {
            // Nested block: compose transformations and recurse
            const childTransform = extractTransformFromInsert(entity);
            const composedTransform = composeTransforms(transform, childTransform);

            const nestedName = entity.name || entity.block;
            if (nestedName) {
                const nestedResults = resolveBlockRecursive(
                    nestedName,
                    blocks,
                    composedTransform,
                    toMeters,
                    maxDepth,
                    currentDepth + 1
                );
                resolvedEntities.push(...nestedResults);
            }
        } else {
            // Geometric entity: store with current transformation
            resolvedEntities.push({
                entity,
                transform,
                depth: currentDepth
            });
        }
    }

    return resolvedEntities;
}

/**
 * Measure a geometric entity with applied transformation
 */
export function measureTransformedEntity(
    entity: any,
    transform: Transform,
    toMeters: (val: number) => number,
    layer: string
): ItemDetectado | null {
    try {
        if (entity.type === 'LINE') {
            const start = transformPoint(entity.start, transform);
            const end = transformPoint(entity.end, transform);

            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const distM = toMeters(dist);

            return {
                id: uuidv4(),
                type: 'length',
                name_raw: `Line in block on ${layer}`,
                layer_raw: layer,
                layer_normalized: layer.toLowerCase(),
                value_raw: dist,
                unit_raw: 'm',
                value_m: distM,
                evidence: `LINE in nested block (depth ${transform})`
            };
        }

        if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
            const vertices = entity.vertices || [];
            if (vertices.length < 2) return null;

            let totalDist = 0;
            for (let i = 0; i < vertices.length - 1; i++) {
                const p1 = transformPoint(vertices[i], transform);
                const p2 = transformPoint(vertices[i + 1], transform);
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                totalDist += Math.sqrt(dx * dx + dy * dy);
            }

            // Check if closed
            if (entity.shape || entity.closed) {
                const p1 = transformPoint(vertices[vertices.length - 1], transform);
                const p2 = transformPoint(vertices[0], transform);
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                totalDist += Math.sqrt(dx * dx + dy * dy);
            }

            const distM = toMeters(totalDist);

            return {
                id: uuidv4(),
                type: 'length',
                name_raw: `${entity.type} in block on ${layer}`,
                layer_raw: layer,
                layer_normalized: layer.toLowerCase(),
                value_raw: totalDist,
                unit_raw: 'm',
                value_m: distM,
                evidence: `${entity.type} in nested block`
            };
        }

        // Add more entity types as needed (CIRCLE, ARC, etc.)

    } catch (err) {
        console.error(`[Block Resolver] Error measuring entity:`, err);
    }

    return null;
}

/**
 * Build a map of block definitions from DXF blocks section
 */
export function buildBlockDefinitionsMap(dxf: any): Map<string, BlockDefinition> {
    const blocks = new Map<string, BlockDefinition>();

    if (!dxf.blocks) return blocks;

    for (const [blockName, blockData] of Object.entries(dxf.blocks)) {
        if (typeof blockData === 'object' && blockData !== null) {
            const entities = (blockData as any).entities || [];
            blocks.set(blockName, {
                name: blockName,
                entities
            });
        }
    }

    console.log(`[Block Resolver] Found ${blocks.size} block definitions`);

    return blocks;
}
