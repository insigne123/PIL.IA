/**
 * View Filter Module
 * 
 * Filters DXF entities to only include those from the main plan view,
 * excluding cortes, elevaciones, and other duplicate views.
 * 
 * This is critical because DXF files often contain multiple views of the same
 * geometry, causing quantities to be counted 2-3x.
 */

import { ItemDetectado } from '@/types';

export interface ViewFilterConfig {
    // Main plan Y bounds (in drawing units, typically mm)
    mainPlanYMin: number;
    mainPlanYMax: number;

    // Optional X bounds for additional filtering
    mainPlanXMin?: number;
    mainPlanXMax?: number;

    // Enable/disable filtering
    enabled: boolean;
}

// Default configuration based on analysis of LdS PAK DXF
// Main plan is typically in Y range -90000 to -60000 (mm)
export const DEFAULT_VIEW_FILTER: ViewFilterConfig = {
    mainPlanYMin: -100000, // -100m
    mainPlanYMax: -50000,  // -50m (generous margin)
    enabled: true
};

/**
 * Get the center point of an entity for filtering
 */
function getEntityCenter(entity: any): { x: number; y: number } | null {
    if (entity.type === 'LINE') {
        if (entity.start && entity.end) {
            return {
                x: (entity.start.x + entity.end.x) / 2,
                y: (entity.start.y + entity.end.y) / 2
            };
        }
    } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
        const vertices = entity.vertices || [];
        if (vertices.length > 0) {
            let sumX = 0, sumY = 0;
            for (const v of vertices) {
                sumX += v.x || 0;
                sumY += v.y || 0;
            }
            return { x: sumX / vertices.length, y: sumY / vertices.length };
        }
    } else if (entity.type === 'CIRCLE' || entity.type === 'ARC') {
        const center = entity.center || { x: 0, y: 0 };
        return { x: center.x, y: center.y };
    } else if (entity.type === 'INSERT') {
        const pos = entity.position || { x: 0, y: 0 };
        return { x: pos.x, y: pos.y };
    } else if (entity.type === 'TEXT' || entity.type === 'MTEXT') {
        const pos = entity.position || entity.insertionPoint || { x: 0, y: 0 };
        return { x: pos.x, y: pos.y };
    } else if (entity.type === 'HATCH') {
        // For HATCH, use first boundary's center
        const boundaries = entity.boundaries || [];
        if (boundaries.length > 0 && boundaries[0].vertices?.length > 0) {
            let sumX = 0, sumY = 0;
            const verts = boundaries[0].vertices;
            for (const v of verts) {
                sumX += v.x || 0;
                sumY += v.y || 0;
            }
            return { x: sumX / verts.length, y: sumY / verts.length };
        }
    }

    return null;
}

/**
 * Check if an entity is within the main plan view
 */
export function isInMainPlanView(entity: any, config: ViewFilterConfig): boolean {
    if (!config.enabled) return true;

    const center = getEntityCenter(entity);
    if (!center) return true; // If we can't determine position, include by default

    // Check Y bounds
    if (center.y < config.mainPlanYMin || center.y > config.mainPlanYMax) {
        return false;
    }

    // Check X bounds if specified
    if (config.mainPlanXMin !== undefined && config.mainPlanXMax !== undefined) {
        if (center.x < config.mainPlanXMin || center.x > config.mainPlanXMax) {
            return false;
        }
    }

    return true;
}

/**
 * Filter entities to only include those in the main plan view
 */
export function filterToMainPlanView(
    entities: any[],
    config: ViewFilterConfig = DEFAULT_VIEW_FILTER
): { filtered: any[]; excluded: number; stats: { mainPlan: number; cortes: number } } {
    if (!config.enabled) {
        return {
            filtered: entities,
            excluded: 0,
            stats: { mainPlan: entities.length, cortes: 0 }
        };
    }

    const filtered: any[] = [];
    let excluded = 0;

    for (const entity of entities) {
        if (isInMainPlanView(entity, config)) {
            filtered.push(entity);
        } else {
            excluded++;
        }
    }

    console.log(`[View Filter] Filtered ${excluded} entities from cortes/elevaciones (kept ${filtered.length})`);

    return {
        filtered,
        excluded,
        stats: { mainPlan: filtered.length, cortes: excluded }
    };
}

/**
 * Filter ItemDetectado array to only include items from main plan
 */
export function filterItemsToMainPlan(
    items: ItemDetectado[],
    config: ViewFilterConfig = DEFAULT_VIEW_FILTER
): ItemDetectado[] {
    if (!config.enabled) return items;

    return items.filter(item => {
        // If item has position, check it
        if (item.position) {
            const pos = item.position as { x: number; y: number };
            if (pos.y < config.mainPlanYMin || pos.y > config.mainPlanYMax) {
                return false;
            }
            if (config.mainPlanXMin !== undefined && config.mainPlanXMax !== undefined) {
                if (pos.x < config.mainPlanXMin || pos.x > config.mainPlanXMax) {
                    return false;
                }
            }
        }
        return true;
    });
}

/**
 * Auto-detect main plan bounds from entity distribution
 * Uses clustering to find the main concentration of entities
 */
export function autoDetectMainPlanBounds(entities: any[]): ViewFilterConfig {
    const BIN_SIZE = 10000; // 10m bins
    const yBins: Record<number, number> = {};

    for (const entity of entities) {
        const center = getEntityCenter(entity);
        if (center) {
            const bin = Math.floor(center.y / BIN_SIZE) * BIN_SIZE;
            yBins[bin] = (yBins[bin] || 0) + 1;
        }
    }

    // Find the bin with most entities
    let maxBin = 0;
    let maxCount = 0;

    for (const [bin, count] of Object.entries(yBins)) {
        if (count > maxCount) {
            maxCount = count;
            maxBin = parseFloat(bin);
        }
    }

    // Expand to include adjacent bins with significant entities
    let yMin = maxBin;
    let yMax = maxBin + BIN_SIZE;

    // Check bins above and below
    for (let offset = BIN_SIZE; offset <= BIN_SIZE * 5; offset += BIN_SIZE) {
        const aboveBin = maxBin + offset;
        const belowBin = maxBin - offset;

        if (yBins[aboveBin] && yBins[aboveBin] > maxCount * 0.1) {
            yMax = aboveBin + BIN_SIZE;
        }
        if (yBins[belowBin] && yBins[belowBin] > maxCount * 0.1) {
            yMin = belowBin;
        }
    }

    console.log(`[View Filter] Auto-detected main plan Y bounds: ${yMin} to ${yMax} (${(yMin * 0.001).toFixed(1)}m to ${(yMax * 0.001).toFixed(1)}m)`);

    return {
        mainPlanYMin: yMin - BIN_SIZE, // Add margin
        mainPlanYMax: yMax + BIN_SIZE,
        enabled: true
    };
}

/**
 * Get summary of view filter results
 */
export function getViewFilterSummary(stats: { mainPlan: number; cortes: number }): string {
    const total = stats.mainPlan + stats.cortes;
    const pct = total > 0 ? ((stats.cortes / total) * 100).toFixed(1) : '0';
    return `View Filter: ${stats.mainPlan} main plan, ${stats.cortes} excluded (${pct}% duplicates)`;
}
