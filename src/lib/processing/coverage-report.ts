import { ItemDetectado, StagingRow } from '@/types';
import { type LayerProfile } from './layer-profiling';

export interface LayerCoverage {
    layerName: string;
    entityCount: number;
    totalLength: number; // in meters
    blockCount: number;
    textCount: number;
    bboxSize: { width: number; height: number };
    isUsedInMatching: boolean;
    isLikelyAnnotation: boolean;
    profile?: LayerProfile;
}

/**
 * Generate a coverage report showing which layers were extracted and used
 */
export function generateCoverageReport(
    dxfItems: ItemDetectado[],
    stagingRows: StagingRow[],
    layerProfiles?: Map<string, LayerProfile>
): LayerCoverage[] {
    // Group items by layer
    const layerMap = new Map<string, ItemDetectado[]>();

    for (const item of dxfItems) {
        const layer = item.layer_normalized;
        if (!layerMap.has(layer)) {
            layerMap.set(layer, []);
        }
        layerMap.get(layer)!.push(item);
    }

    // Get layers used in matching
    const usedLayers = new Set<string>();
    for (const row of stagingRows) {
        for (const item of row.source_items || []) {
            usedLayers.add(item.layer_normalized);
        }
    }

    // Build coverage report
    const coverage: LayerCoverage[] = [];

    for (const [layerName, items] of layerMap.entries()) {
        const profile = layerProfiles?.get(layerName);

        // Calculate stats
        let totalLength = 0;
        let blockCount = 0;
        let textCount = 0;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        for (const item of items) {
            if (item.type === 'length') {
                totalLength += item.value_m;
            } else if (item.type === 'block') {
                blockCount += item.value_m; // value_m is count for blocks
            } else if (item.type === 'text') {
                textCount++;
            }

            // Note: ItemDetectado doesn't have position, so bbox is estimated
            // In a real implementation, we'd need to track entity positions
        }

        coverage.push({
            layerName,
            entityCount: items.length,
            totalLength,
            blockCount,
            textCount,
            bboxSize: {
                width: maxX - minX,
                height: maxY - minY
            },
            isUsedInMatching: usedLayers.has(layerName),
            isLikelyAnnotation: profile?.isLikelyAnnotation || false,
            profile
        });
    }

    // Sort by entity count descending
    coverage.sort((a, b) => b.entityCount - a.entityCount);

    return coverage;
}

/**
 * Get a summary of the coverage report
 */
export function getCoverageSummary(coverage: LayerCoverage[]): string {
    const totalLayers = coverage.length;
    const usedLayers = coverage.filter(c => c.isUsedInMatching).length;
    const annotationLayers = coverage.filter(c => c.isLikelyAnnotation).length;
    const unusedLayers = coverage.filter(c => !c.isUsedInMatching && !c.isLikelyAnnotation).length;

    const parts: string[] = [];
    parts.push(`Total layers: ${totalLayers}`);
    parts.push(`Used in matching: ${usedLayers}`);
    parts.push(`Annotation (excluded): ${annotationLayers}`);

    if (unusedLayers > 0) {
        parts.push(`⚠️ Unused geometry layers: ${unusedLayers}`);
    }

    return parts.join(' | ');
}

/**
 * Export coverage report as CSV string
 */
export function exportCoverageAsCSV(coverage: LayerCoverage[]): string {
    const headers = [
        'Layer Name',
        'Entity Count',
        'Total Length (m)',
        'Block Count',
        'Text Count',
        'Used in Matching',
        'Likely Annotation'
    ];

    const rows = coverage.map(c => [
        c.layerName,
        c.entityCount.toString(),
        c.totalLength.toFixed(2),
        c.blockCount.toString(),
        c.textCount.toString(),
        c.isUsedInMatching ? 'Yes' : 'No',
        c.isLikelyAnnotation ? 'Yes' : 'No'
    ]);

    return [
        headers.join(','),
        ...rows.map(row => row.join(','))
    ].join('\n');
}
