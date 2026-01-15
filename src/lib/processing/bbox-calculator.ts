/**
 * Bounding Box Calculator
 * 
 * Calculates accurate bounding boxes from processed DXF items (post-normalization)
 * Fixes the bbox diagonal = 0 bug by calculating AFTER unit conversion
 */

export interface BoundingBox {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
}

export interface Point3D {
    x: number;
    y: number;
    z?: number;
}

/**
 * Calculate bounding box from DXF entities (raw, before ItemDetectado creation)
 * This version works with raw parsed entities
 */
export function calculateBoundingBoxFromEntities(
    entities: any[],
    toMeters: number = 1.0
): BoundingBox {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    let validPoints = 0;

    for (const entity of entities) {
        const points = extractPointsFromEntity(entity);

        for (const point of points) {
            // Apply unit conversion
            const x = point.x * toMeters;
            const y = point.y * toMeters;
            const z = (point.z || 0) * toMeters;

            if (isFinite(x) && isFinite(y)) {
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
                minZ = Math.min(minZ, z);
                maxZ = Math.max(maxZ, z);

                validPoints++;
            }
        }
    }

    if (validPoints === 0) {
        console.warn('[BBox] No valid points found, using fallback');
        return {
            min: { x: 0, y: 0, z: 0 },
            max: { x: 100, y: 100, z: 0 } // Fallback: 100m x 100m
        };
    }

    return {
        min: {
            x: minX === Infinity ? 0 : minX,
            y: minY === Infinity ? 0 : minY,
            z: minZ === Infinity ? 0 : minZ
        },
        max: {
            x: maxX === -Infinity ? 100 : maxX,
            y: maxY === -Infinity ? 100 : maxY,
            z: maxZ === -Infinity ? 0 : maxZ
        }
    };
}

/**
 * Extract coordinate points from any DXF entity type
 */
function extractPointsFromEntity(entity: any): Point3D[] {
    const points: Point3D[] = [];

    // Skip non-geometric entities
    if (entity.type === 'TEXT' || entity.type === 'MTEXT' ||
        entity.type === 'DIMENSION' || entity.type === 'ATTDEF') {
        return points;
    }

    // LINE
    if (entity.type === 'LINE') {
        if (entity.start) points.push(entity.start);
        if (entity.end) points.push(entity.end);
    }

    // POLYLINE, LWPOLYLINE
    else if (entity.type === 'POLYLINE' || entity.type === 'LWPOLYLINE') {
        if (entity.vertices && Array.isArray(entity.vertices)) {
            points.push(...entity.vertices);
        }
    }

    // CIRCLE, ARC
    else if (entity.type === 'CIRCLE' || entity.type === 'ARC') {
        if (entity.center) {
            const radius = entity.radius || 0;
            // Add bounding points (center ± radius)
            points.push(
                { x: entity.center.x - radius, y: entity.center.y - radius, z: entity.center.z },
                { x: entity.center.x + radius, y: entity.center.y + radius, z: entity.center.z }
            );
        }
    }

    // INSERT (block)
    else if (entity.type === 'INSERT') {
        if (entity.position) points.push(entity.position);
    }

    // HATCH
    else if (entity.type === 'HATCH' && entity.boundaries) {
        for (const boundary of entity.boundaries) {
            if (boundary.vertices && Array.isArray(boundary.vertices)) {
                points.push(...boundary.vertices);
            }
        }
    }

    // SPLINE
    else if (entity.type === 'SPLINE' && entity.controlPoints) {
        points.push(...entity.controlPoints);
    }

    // ELLIPSE
    else if (entity.type === 'ELLIPSE') {
        if (entity.center) {
            const majorRadius = entity.majorAxisEndPoint ?
                Math.sqrt(
                    entity.majorAxisEndPoint.x ** 2 +
                    entity.majorAxisEndPoint.y ** 2
                ) : 1;
            const minorRadius = majorRadius * (entity.axisRatio || 1);

            points.push(
                { x: entity.center.x - majorRadius, y: entity.center.y - minorRadius, z: entity.center.z },
                { x: entity.center.x + majorRadius, y: entity.center.y + minorRadius, z: entity.center.z }
            );
        }
    }

    return points;
}

/**
 * Calculate diagonal distance of bounding box
 */
export function calculateDiagonal(bbox: BoundingBox): number {
    const dx = bbox.max.x - bbox.min.x;
    const dy = bbox.max.y - bbox.min.y;
    const dz = bbox.max.z - bbox.min.z;

    const diagonal = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (!isFinite(diagonal) || diagonal === 0) {
        console.warn('[BBox] Invalid diagonal, using fallback');
        return 100; // Fallback: assume 100m building
    }

    return diagonal;
}

/**
 * Try to get bounding box from DXF header extents
 */
export function getBBoxFromExtents(
    header: any,
    toMeters: number = 1.0
): BoundingBox | null {
    if (!header || !header.$EXTMIN || !header.$EXTMAX) {
        return null;
    }

    return {
        min: {
            x: header.$EXTMIN.x * toMeters,
            y: header.$EXTMIN.y * toMeters,
            z: (header.$EXTMIN.z || 0) * toMeters
        },
        max: {
            x: header.$EXTMAX.x * toMeters,
            y: header.$EXTMAX.y * toMeters,
            z: (header.$EXTMAX.z || 0) * toMeters
        }
    };
}

/**
 * Get bounding box info for logging
 */
export function getBoundingBoxInfo(bbox: BoundingBox): {
    diagonal: number;
    width: number;
    height: number;
    depth: number;
    center: Point3D;
} {
    const diagonal = calculateDiagonal(bbox);
    const width = bbox.max.x - bbox.min.x;
    const height = bbox.max.y - bbox.min.y;
    const depth = bbox.max.z - bbox.min.z;

    return {
        diagonal,
        width,
        height,
        depth,
        center: {
            x: (bbox.min.x + bbox.max.x) / 2,
            y: (bbox.min.y + bbox.max.y) / 2,
            z: (bbox.min.z + bbox.max.z) / 2
        }
    };
}
