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

export interface LayerResolution {
    original_layer: string;
    insert_layer: string;
    resolved_layer: string;
    block_name?: string;
}

export interface ResolvedEntity {
    entity: any;
    transform: Transform;
    depth: number;
    layerResolution: LayerResolution;
    stableId?: string; // Hotfix 4
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
export function transformPoint(point: Point | undefined, transform: Transform): Point {
    // Defensive check: if point is undefined, return transform position
    if (!point || point.x === undefined || point.y === undefined) {
        return {
            x: transform.position.x,
            y: transform.position.y,
            z: transform.position.z || 0
        };
    }

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

    const rotation = insertEntity.rotation || 0;

    const scale: Point = {
        x: insertEntity.xScale || insertEntity.scaleX || 1,
        y: insertEntity.yScale || insertEntity.scaleY || 1,
        z: insertEntity.zScale || insertEntity.scaleZ || 1
    };

    return { position, rotation, scale };
}

/**
 * Resolve layer for entity inside block
 * Handles BYBLOCK, BYLAYER, and Layer "0" inheritance
 */
export function resolveEntityLayer(
    entity: any,
    insertEntity: any,
    blockName: string
): LayerResolution {
    const original = entity.layer || '0';
    const insertLayer = insertEntity.layer || '0';

    // Rule 1: Layer "0" inherits from INSERT
    if (original === '0' || original === '0') {
        return {
            original_layer: original,
            insert_layer: insertLayer,
            resolved_layer: insertLayer,
            block_name: blockName
        };
    }

    // Rule 2: BYLAYER/BYBLOCK inherits from INSERT
    const originalUpper = original.toUpperCase();
    if (originalUpper === 'BYLAYER' || originalUpper === 'BYBLOCK') {
        return {
            original_layer: original,
            insert_layer: insertLayer,
            resolved_layer: insertLayer,
            block_name: blockName
        };
    }

    // Rule 3: Explicit layer is maintained
    return {
        original_layer: original,
        insert_layer: insertLayer,
        resolved_layer: original,
        block_name: blockName
    };
}

/**
 * Recursively resolve a block and its nested blocks
 * Returns array of resolved entities with transformations and layer resolution
 */
// Helper to generate stable ID
// format: [INSERT_HANDLE_PATH]::[ENTITY_HANDLE]
function generateStableId(pathHandles: string[], entityHandle: string): string {
    return `${pathHandles.join('/')}::${entityHandle}`;
}

export function resolveBlockRecursive(
    blockName: string,
    definitions: Map<string, BlockDefinition>,
    parentTransform: Transform,
    toMeters: (val: number) => number,
    parentInsertEntity: any, // The INSERT entity that triggered this
    maxDepth: number = 5,
    pathHandles: string[] = [] // Track handles for stable ID
): ResolvedEntity[] {
    if (maxDepth <= 0) return [];

    const def = definitions.get(blockName);
    if (!def) return [];

    let results: ResolvedEntity[] = [];

    // Add current INSERT handle to path
    const currentPath = [...pathHandles, parentInsertEntity.handle || 'unknown'];

    for (const entity of def.entities) {
        // Resolve Layer: Nested entities inherit from parent INSERT if on '0'
        // Logic:
        // 1. Get entity's raw layer
        // 2. If '0' or 'BYBLOCK', use parent's RESOLVED layer

        let resolvedLayerName = entity.layer || '0';
        const parentLayerName = (parentInsertEntity as any).resolvedLayer || (parentInsertEntity as any).layer || '0';

        if (resolvedLayerName === '0' || resolvedLayerName.toUpperCase() === 'DEFPOINTS') {
            resolvedLayerName = parentLayerName;
        }

        const layerResolution: LayerResolution = {
            original_layer: entity.layer || '0',
            insert_layer: parentLayerName,
            resolved_layer: resolvedLayerName,
            block_name: blockName
        };

        // Pass resolved layer to entity for next recursion level
        (entity as any).resolvedLayer = resolvedLayerName;

        if (entity.type === 'INSERT') {
            // Recursive resolution
            const childTransform = extractTransformFromInsert(entity);
            const compositeTransform = composeTransforms(parentTransform, childTransform);

            // Nested recursion
            const nested = resolveBlockRecursive(
                entity.name,
                definitions,
                compositeTransform,
                toMeters,
                entity,
                maxDepth - 1,
                currentPath // Pass growing path
            );
            results.push(...nested);
        } else {
            // Leaf entity (Line, Polyline, etc)
            results.push({
                entity,
                transform: parentTransform,
                depth: 6 - maxDepth,
                layerResolution,
                stableId: generateStableId(currentPath, entity.handle || uuidv4()) // Generate ID
            });
        }
    }

    return results;
}

/**
 * Measure a geometric entity with applied transformation and layer resolution
 */
export function measureTransformedEntity(
    resolvedEntity: ResolvedEntity,
    toMeters: (val: number) => number
): ItemDetectado | null {
    const { entity, transform, layerResolution } = resolvedEntity;
    const layer = layerResolution.resolved_layer;

    try {
        if (entity.type === 'LINE') {
            // Validate that start and end points exist
            if (!entity.start || !entity.end) {
                return null;
            }

            const start = transformPoint(entity.start, transform);
            const end = transformPoint(entity.end, transform);

            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const distM = toMeters(dist);

            // Skip if distance is negligible
            if (distM < 0.001) return null;

            return {
                id: uuidv4(),
                type: 'length',
                name_raw: `Line in block on ${layer}`,
                layer_raw: layer,
                layer_normalized: layer.toLowerCase(),
                value_raw: dist,
                unit_raw: 'm',
                value_si: distM,  // ✅ Length in SI
                value_m: distM,   // Legacy
                evidence: `LINE in nested block`,
                layer_metadata: {
                    original: layerResolution.original_layer,
                    resolved: layerResolution.resolved_layer,
                    block_name: layerResolution.block_name
                }
            };
        }

        if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
            const vertices = entity.vertices || [];
            if (vertices.length < 2) return null;

            // Validate that vertices have x,y coordinates
            const validVertices = vertices.filter((v: any) => v && v.x !== undefined && v.y !== undefined);
            if (validVertices.length < 2) return null;

            let totalDist = 0;
            for (let i = 0; i < validVertices.length - 1; i++) {
                const p1 = transformPoint(validVertices[i], transform);
                const p2 = transformPoint(validVertices[i + 1], transform);
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                totalDist += Math.sqrt(dx * dx + dy * dy);
            }

            // Check if closed
            if (entity.shape || entity.closed) {
                const p1 = transformPoint(validVertices[validVertices.length - 1], transform);
                const p2 = transformPoint(validVertices[0], transform);
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                totalDist += Math.sqrt(dx * dx + dy * dy);
            }

            const distM = toMeters(totalDist);

            // Skip if distance is negligible
            if (distM < 0.001) return null;

            return {
                id: uuidv4(),
                type: 'length',
                name_raw: `${entity.type} in block on ${layer}`,
                layer_raw: layer,
                layer_normalized: layer.toLowerCase(),
                value_raw: totalDist,
                unit_raw: 'm',
                value_si: distM,  // ✅ Length in SI
                value_m: distM,   // Legacy
                evidence: `${entity.type} in nested block`,
                layer_metadata: {
                    original: layerResolution.original_layer,
                    resolved: layerResolution.resolved_layer,
                    block_name: layerResolution.block_name
                }
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
