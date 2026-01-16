import { ItemDetectado, Unit } from '@/types';

export interface GeometryHealth {
    // 1. Preflight/Raw metrics (passed in)
    hasAreaCandidates: boolean;
    hasLengthCandidates: boolean;
    hasInserts: boolean;

    // 2. Scale & Bounds
    bboxDiagM: number;
    footprintM2: number;

    // 3. Smoke Test Results
    topAreaLayers: Array<{ layer: string; area_m2: number; count: number }>;
    topLengthLayers: Array<{ layer: string; length_m: number; count: number }>;

    // 4. Final Verdict
    status: 'healthy' | 'warning' | 'critical';
    dataset_status?: 'invalid_geometry_for_takeoff'; // Specific flag for blocking
    issues: string[];
}

export interface SanityInput {
    items: ItemDetectado[];
    bboxDiagonalM: number;
    hasAreaCandidates: boolean;
    hasLengthCandidates: boolean;
    hasInserts: boolean;
}

/**
 * Calculates the approximate project footprint by finding the largest closed polygon area.
 * This is a heuristic to detect if the scale is correct (e.g. if footprint is 0.0001m2, units are wrong).
 */
export function calculateApproxFootprint(items: ItemDetectado[]): number {
    // Filter for area items that are likely floor/slab candidates
    // We look for the largest single area item, assuming it might be the perimeter or a slab
    const areaItems = items.filter(i => i.type === 'area');

    if (areaItems.length === 0) return 0;

    // Return the maximum single area found
    // (A better heuristic might be sum of largest layer, but single max is a safer lower bound for "footprint")
    const maxArea = Math.max(...areaItems.map(i => i.value_si));
    return maxArea;
}

/**
 * Runs global sanity checks and smoke tests on the processed dataset.
 */
export function checkGeometryHealth(input: SanityInput): GeometryHealth {
    const { items, bboxDiagonalM } = input;

    const issues: string[] = [];
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    let dataset_status: 'invalid_geometry_for_takeoff' | undefined = undefined;

    // 1. Calculate Metrics
    const footprintM2 = calculateApproxFootprint(items);

    const totalAreaM2 = items
        .filter(i => i.type === 'area')
        .reduce((sum, i) => sum + i.value_si, 0);

    // 2. Identify Top Layers (for Smoke Test)
    const areaLayers = new Map<string, { area: number, count: number }>();
    const lengthLayers = new Map<string, { length: number, count: number }>();

    for (const item of items) {
        if (item.type === 'area') {
            const current = areaLayers.get(item.layer_normalized) || { area: 0, count: 0 };
            current.area += item.value_si;
            current.count++;
            areaLayers.set(item.layer_normalized, current);
        } else if (item.type === 'length') {
            const current = lengthLayers.get(item.layer_normalized) || { length: 0, count: 0 };
            current.length += item.value_si;
            current.count++;
            lengthLayers.set(item.layer_normalized, current);
        }
    }

    const topAreaLayers = Array.from(areaLayers.entries())
        .map(([layer, stats]) => ({ layer, area_m2: stats.area, count: stats.count }))
        .sort((a, b) => b.area_m2 - a.area_m2)
        .slice(0, 3);

    const topLengthLayers = Array.from(lengthLayers.entries())
        .map(([layer, stats]) => ({ layer, length_m: stats.length, count: stats.count }))
        .sort((a, b) => b.length_m - a.length_m)
        .slice(0, 3);

    // 3. Rule Checks

    // Rule A: Scale Sanity (BBox)
    if (bboxDiagonalM < 1) {
        status = 'critical';
        issues.push(`BBox diagonal too small (${bboxDiagonalM.toFixed(3)}m). Units likely wrong.`);
        dataset_status = 'invalid_geometry_for_takeoff';
    } else if (bboxDiagonalM > 5000) {
        status = 'warning';
        issues.push(`BBox diagonal very large (${bboxDiagonalM.toFixed(0)}m). Check for outliers.`);
    }

    // Rule B: Footprint Sanity
    // For architectural evaluation, meaningful floor plans usually have at least 5m2
    if (footprintM2 < 5 && totalAreaM2 < 5) {
        // Only critical if we expected an area takeoff
        // But for generic robustness, if there is NO area > 5m2, it's suspicious for a building plan
        if (input.hasAreaCandidates) {
            // If we had candidates but result is small, maybe units/scale issue
            status = 'critical';
            issues.push(`Project footprint too small (${footprintM2.toFixed(2)}m²). Check units/scale.`);
            dataset_status = 'invalid_geometry_for_takeoff';
        } else if (!input.hasLengthCandidates) {
            // No area, no length => empty
            status = 'critical';
            issues.push('No measurable geometry found.');
            dataset_status = 'invalid_geometry_for_takeoff';
        }
    }

    // Rule C: Smoke Test (Measurable Quantity)
    // "Debe existir al menos 1 layer con area > 10m2 OR 1 layer con length > 20m"
    const hasSignificantArea = topAreaLayers.some(l => l.area_m2 > 10);
    const hasSignificantLength = topLengthLayers.some(l => l.length_m > 20);

    if (!hasSignificantArea && !hasSignificantLength) {
        // If preflight saw candidates but we ended up with nothing significant -> Critical
        if (input.hasAreaCandidates || input.hasLengthCandidates) {
            status = 'critical';
            issues.push('Smoke Test Failed: No layers with significant area (>10m²) or length (>20m).');
            dataset_status = 'invalid_geometry_for_takeoff';
        } else {
            // If preflight saw nothing, it's also critical but expected
            status = 'critical';
            issues.push('No geometry candidates detected in Preflight.');
            dataset_status = 'invalid_geometry_for_takeoff';
        }
    }

    // Rule D: Huge Area Safety
    if (totalAreaM2 > 1000000) { // 1 million m2
        status = 'warning';
        issues.push(`Total area extremely large (${totalAreaM2.toFixed(0)}m²). Possible explosion/dedup fail.`);
    }

    return {
        hasAreaCandidates: input.hasAreaCandidates,
        hasLengthCandidates: input.hasLengthCandidates,
        hasInserts: input.hasInserts,
        bboxDiagM: bboxDiagonalM,
        footprintM2,
        topAreaLayers,
        topLengthLayers,
        status,
        dataset_status,
        issues
    };
}
