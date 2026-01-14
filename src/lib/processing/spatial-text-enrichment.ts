import { ItemDetectado } from '@/types';

interface TextEntity {
    text: string;
    position: { x: number; y: number };
    layer: string;
}

interface GridCell {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    texts: TextEntity[];
}

/**
 * Simple spatial grid index for text association
 */
export class SpatialTextIndex {
    private cellSize: number;
    private grid: Map<string, GridCell>;

    constructor(cellSize: number = 10.0) {
        this.cellSize = cellSize;
        this.grid = new Map();
    }

    private getCellKey(x: number, y: number): string {
        const cellX = Math.floor(x / this.cellSize);
        const cellY = Math.floor(y / this.cellSize);
        return `${cellX},${cellY}`;
    }

    addText(text: TextEntity) {
        const key = this.getCellKey(text.position.x, text.position.y);

        if (!this.grid.has(key)) {
            const cellX = Math.floor(text.position.x / this.cellSize);
            const cellY = Math.floor(text.position.y / this.cellSize);

            this.grid.set(key, {
                minX: cellX * this.cellSize,
                minY: cellY * this.cellSize,
                maxX: (cellX + 1) * this.cellSize,
                maxY: (cellY + 1) * this.cellSize,
                texts: []
            });
        }

        this.grid.get(key)!.texts.push(text);
    }

    findNearbyTexts(x: number, y: number, maxDistance: number = 5.0): TextEntity[] {
        const nearby: TextEntity[] = [];
        const cellsToCheck = Math.ceil(maxDistance / this.cellSize);

        const centerCellX = Math.floor(x / this.cellSize);
        const centerCellY = Math.floor(y / this.cellSize);

        for (let dx = -cellsToCheck; dx <= cellsToCheck; dx++) {
            for (let dy = -cellsToCheck; dy <= cellsToCheck; dy++) {
                const key = `${centerCellX + dx},${centerCellY + dy}`;
                const cell = this.grid.get(key);

                if (cell) {
                    for (const text of cell.texts) {
                        const dist = Math.sqrt(
                            Math.pow(text.position.x - x, 2) +
                            Math.pow(text.position.y - y, 2)
                        );

                        if (dist <= maxDistance) {
                            nearby.push(text);
                        }
                    }
                }
            }
        }

        return nearby;
    }
}

/**
 * Get approximate position of an item for spatial lookup
 */
function getItemApproximatePosition(item: ItemDetectado): { x: number; y: number } | null {
    // Use stored position if available
    return item.position || null;
}

/**
 * Enrich DXF items with nearby text tokens
 * This helps with semantic matching by associating text labels with geometry
 */
export function enrichItemsWithNearbyText(
    items: ItemDetectado[],
    textEntities: TextEntity[],
    maxDistance: number = 5.0
): ItemDetectado[] {
    if (textEntities.length === 0) {
        console.log('[Spatial Text] No text entities to index');
        return items;
    }

    console.log(`[Spatial Text] Building index for ${textEntities.length} text entities`);

    // Build spatial index
    const index = new SpatialTextIndex(10.0);
    for (const text of textEntities) {
        index.addText(text);
    }

    // Enrich items
    let enrichedCount = 0;

    for (const item of items) {
        if (item.type === 'text') continue;

        // Get approximate position
        const position = getItemApproximatePosition(item);
        if (!position) continue;

        const nearbyTexts = index.findNearbyTexts(position.x, position.y, maxDistance);

        if (nearbyTexts.length > 0) {
            const tokens = nearbyTexts.map(t => t.text.toLowerCase().trim());
            (item as any).nearby_text_tokens = tokens;
            item.evidence = `${item.evidence || ''} + nearby: "${nearbyTexts[0].text}"`;
            enrichedCount++;
        }
    }

    console.log(`[Spatial Text] Enriched ${enrichedCount}/${items.length} items with nearby text`);

    return items;
}

export type { TextEntity };
