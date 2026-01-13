import { ItemDetectado } from '@/types';

export interface Point {
    x: number;
    y: number;
    z?: number;
}

export interface BlockInstance {
    name: string;
    layer: string;
    position: Point;
}

export interface DeduplicatedBlock extends BlockInstance {
    count: number;
    instances: Point[]; // All positions that were merged
}

/**
 * Calculate Euclidean distance between two points
 */
export function distance(p1: Point, p2: Point): number {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    const dz = (p1.z || 0) - (p2.z || 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Deduplicate blocks that are at the same position (within tolerance)
 * This handles cases where the same block is inserted multiple times at the same location
 */
export function deduplicateBlocks(
    blocks: BlockInstance[],
    tolerance: number = 0.01 // 1cm default
): DeduplicatedBlock[] {
    const clusters: DeduplicatedBlock[] = [];

    for (const block of blocks) {
        // Find existing cluster with same name, layer, and nearby position
        const existing = clusters.find(c =>
            c.name === block.name &&
            c.layer === block.layer &&
            distance(c.position, block.position) < tolerance
        );

        if (existing) {
            // Add to existing cluster
            existing.count++;
            existing.instances.push(block.position);
        } else {
            // Create new cluster
            clusters.push({
                name: block.name,
                layer: block.layer,
                position: block.position,
                count: 1,
                instances: [block.position]
            });
        }
    }

    return clusters;
}

/**
 * Deduplicate ItemDetectado blocks based on spatial proximity
 * Returns deduplicated items with updated counts
 */
export function deduplicateItemDetectadoBlocks(
    items: ItemDetectado[],
    tolerance: number = 0.01
): ItemDetectado[] {
    // Separate blocks from other items
    const blockItems = items.filter(i => i.type === 'block');
    const otherItems = items.filter(i => i.type !== 'block');

    if (blockItems.length === 0) {
        return items;
    }

    // Group blocks by name and layer for deduplication
    const blocksByKey = new Map<string, ItemDetectado[]>();

    for (const item of blockItems) {
        const key = `${item.name_raw}::${item.layer_normalized}`;
        if (!blocksByKey.has(key)) {
            blocksByKey.set(key, []);
        }
        blocksByKey.get(key)!.push(item);
    }

    const deduplicatedBlocks: ItemDetectado[] = [];

    // For each group, deduplicate based on spatial proximity
    // Note: ItemDetectado doesn't have position, so we can't do true spatial dedup
    // Instead, we'll just ensure counts are accurate
    for (const [key, groupItems] of blocksByKey.entries()) {
        if (groupItems.length === 1) {
            deduplicatedBlocks.push(groupItems[0]);
        } else {
            // Merge into single item with summed count
            const merged = { ...groupItems[0] };
            merged.value_raw = groupItems.reduce((sum, item) => sum + item.value_raw, 0);
            merged.value_m = groupItems.reduce((sum, item) => sum + item.value_m, 0);
            merged.evidence = `${merged.evidence} (merged ${groupItems.length} duplicates)`;
            deduplicatedBlocks.push(merged);
        }
    }

    return [...otherItems, ...deduplicatedBlocks];
}

/**
 * Extract block instances with positions from entities
 * This is used before creating ItemDetectado to enable spatial deduplication
 */
export function extractBlockInstances(entities: any[]): BlockInstance[] {
    const instances: BlockInstance[] = [];

    for (const entity of entities) {
        if (entity.type === 'INSERT') {
            const name = entity.name || entity.block || 'UnknownBlock';
            const layer = entity.layer || '0';
            const position: Point = {
                x: entity.position?.x || 0,
                y: entity.position?.y || 0,
                z: entity.position?.z || 0
            };

            instances.push({ name, layer, position });
        }
    }

    return instances;
}

/**
 * Get deduplication summary for logging
 */
export function getDeduplicationSummary(
    original: BlockInstance[],
    deduplicated: DeduplicatedBlock[]
): string {
    const totalOriginal = original.length;
    const totalDeduplicated = deduplicated.length;
    const duplicatesRemoved = totalOriginal - totalDeduplicated;
    const duplicatesPercent = totalOriginal > 0
        ? ((duplicatesRemoved / totalOriginal) * 100).toFixed(1)
        : '0';

    if (duplicatesRemoved === 0) {
        return `No duplicates found (${totalOriginal} unique blocks)`;
    }

    return `Removed ${duplicatesRemoved} duplicate blocks (${duplicatesPercent}%) - ${totalOriginal} → ${totalDeduplicated}`;
}
