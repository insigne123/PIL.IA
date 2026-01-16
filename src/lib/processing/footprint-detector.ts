/**
 * Footprint Detection Module
 * 
 * Fix C: Identifies polygons that are likely "building footprints" or main areas
 * to help matcher prioritize layers with real area geometry.
 */

import { ItemDetectado } from '@/types';

export interface FootprintCandidate {
    layer: string;
    layer_normalized: string;
    area_m2: number;
    max_single_area: number;
    polygon_count: number;
    complexity: number;  // Lower is simpler (more likely a footprint)
    bbox_coverage: number; // What % of global bbox this layer covers
    score: number;
    evidence: string;
}

export interface FootprintDetectionResult {
    candidates: FootprintCandidate[];
    globalBBoxArea: number;
    totalAreaExtracted: number;
    layerCount: number;
}

/**
 * Detect footprint candidates from DXF items
 * Prioritizes layers with:
 * - Large total area
 * - Few, large polygons (not many small pieces)
 * - High coverage of the global bounding box
 */
export function detectFootprintCandidates(
    items: ItemDetectado[],
    globalBBox: { width: number; height: number }
): FootprintDetectionResult {
    // 1. Filter to only area items
    const areaItems = items.filter(i => i.type === 'area');

    if (areaItems.length === 0) {
        return {
            candidates: [],
            globalBBoxArea: globalBBox.width * globalBBox.height,
            totalAreaExtracted: 0,
            layerCount: 0
        };
    }

    // 2. Group by layer
    const byLayer = new Map<string, { areas: number[]; layer_raw: string }>();

    for (const item of areaItems) {
        const key = item.layer_normalized;
        const existing = byLayer.get(key) || { areas: [], layer_raw: item.layer_raw };
        existing.areas.push(item.value_si);
        byLayer.set(key, existing);
    }

    // 3. Calculate global metrics
    const globalBBoxArea = globalBBox.width * globalBBox.height;
    const totalAreaExtracted = areaItems.reduce((sum, i) => sum + i.value_si, 0);

    // 4. Score each layer
    const candidates: FootprintCandidate[] = [];

    for (const [layerNorm, data] of byLayer.entries()) {
        const areas = data.areas;
        const totalArea = areas.reduce((sum, a) => sum + a, 0);
        const maxArea = Math.max(...areas);
        const polygonCount = areas.length;

        // Complexity: More polygons = more complex = lower priority
        // Ideal footprint: 1-5 large polygons
        const complexityPenalty = Math.min(1, polygonCount / 10); // 0-1, lower is better

        // Coverage: How much of the global bbox does this layer cover?
        const coverage = globalBBoxArea > 0 ? totalArea / globalBBoxArea : 0;

        // Size score: Larger areas are better
        const sizeScore = Math.min(1, totalArea / 1000); // Cap at 1000m²

        // Single polygon bonus: If largest polygon is >80% of total, bonus
        const singlePolygonRatio = totalArea > 0 ? maxArea / totalArea : 0;

        // Final score (0-1)
        const score = (
            sizeScore * 0.4 +
            coverage * 0.3 +
            (1 - complexityPenalty) * 0.2 +
            singlePolygonRatio * 0.1
        );

        // Build evidence string
        const evidenceParts: string[] = [];
        if (totalArea > 100) evidenceParts.push(`Large area: ${totalArea.toFixed(0)}m²`);
        if (polygonCount <= 3) evidenceParts.push(`Few polygons: ${polygonCount}`);
        if (coverage > 0.5) evidenceParts.push(`High coverage: ${(coverage * 100).toFixed(0)}%`);
        if (maxArea > 50) evidenceParts.push(`Max single: ${maxArea.toFixed(0)}m²`);

        candidates.push({
            layer: data.layer_raw,
            layer_normalized: layerNorm,
            area_m2: totalArea,
            max_single_area: maxArea,
            polygon_count: polygonCount,
            complexity: complexityPenalty,
            bbox_coverage: coverage,
            score,
            evidence: evidenceParts.join(', ') || 'Small layer'
        });
    }

    // 5. Sort by score descending
    candidates.sort((a, b) => b.score - a.score);

    return {
        candidates,
        globalBBoxArea,
        totalAreaExtracted,
        layerCount: byLayer.size
    };
}

/**
 * Get summary string for logging
 */
export function getFootprintSummary(result: FootprintDetectionResult): string {
    const { candidates, totalAreaExtracted, layerCount } = result;

    if (candidates.length === 0) {
        return `No area layers found (0 m² extracted)`;
    }

    const top5 = candidates.slice(0, 5);
    const lines = [
        `Found ${layerCount} layers with ${totalAreaExtracted.toFixed(0)} m² total area:`,
        ...top5.map((c, i) =>
            `  ${i + 1}. "${c.layer}": ${c.area_m2.toFixed(0)} m² (${c.polygon_count} polys, score: ${c.score.toFixed(2)}) - ${c.evidence}`
        )
    ];

    return lines.join('\n');
}

/**
 * Check if a layer is a good footprint candidate
 * Used by matcher to boost confidence for area items
 */
export function isGoodFootprintLayer(
    layerNormalized: string,
    result: FootprintDetectionResult,
    minScore: number = 0.3
): boolean {
    const candidate = result.candidates.find(c => c.layer_normalized === layerNormalized);
    return candidate ? candidate.score >= minScore : false;
}

/**
 * Get footprint score for a layer (0-1)
 */
export function getFootprintScore(
    layerNormalized: string,
    result: FootprintDetectionResult
): number {
    const candidate = result.candidates.find(c => c.layer_normalized === layerNormalized);
    return candidate?.score ?? 0;
}
