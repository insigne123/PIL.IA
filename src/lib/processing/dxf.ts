import DxfParser from 'dxf-parser';
import { ItemDetectado, Unit } from '@/types';
import { v4 as uuidv4 } from 'uuid';

const parser = new DxfParser();

export async function parseDxf(fileContent: string, planUnit: Unit): Promise<ItemDetectado[]> {
    let dxf;
    try {
        dxf = parser.parseSync(fileContent);
    } catch (e) {
        console.error("DXF Parse Error", e);
        throw new Error("Invalid DXF file");
    }

    const items: ItemDetectado[] = [];

    // In some DXFs, entities might be inside blocks or directly in entities
    const entities = dxf.entities || [];
    // We could potentially investigate dxf.blocks if needed, but for now focus on Model Space entities

    if (entities.length === 0) {
        console.warn("DXF parser found 0 entities in Model Space.");
    }

    // Helper to normalize to meters
    const toMeters = (val: number) => {
        if (planUnit === 'mm') return val / 1000;
        if (planUnit === 'cm') return val / 100;
        return val;
    };

    // Grouping for counts and lengths
    const blockCounts = new Map<string, { count: number; layer: string }>();
    const layerLengths = new Map<string, number>();

    for (const entity of entities) {
        try {
            if (entity.type === 'INSERT') {
                // Some parsers put name in 'name' or 'block'
                let name = (entity as any).name || (entity as any).block || 'UnknownBlock';
                const layer = (entity as any).layer || '0';

                // Clean anonymous block names if desired, or keep unique to match Python logic
                // Python kept matches like 'BLOQUE | *U114' so we will keep them too for consistency

                const key = `${name}::${layer}`;

                if (!blockCounts.has(key)) {
                    blockCounts.set(key, { count: 0, layer });
                }
                blockCounts.get(key)!.count++;
            }
            else if (entity.type === 'LINE') {
                const layer = (entity as any).layer || '0';
                const vertices = (entity as any).vertices;
                if (vertices && vertices.length >= 2) {
                    const dx = vertices[0].x - vertices[1].x;
                    const dy = vertices[0].y - vertices[1].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    layerLengths.set(layer, (layerLengths.get(layer) || 0) + dist);
                }
            }
            else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
                const layer = (entity as any).layer || '0';
                const vertices = (entity as any).vertices || [];
                let dist = 0;

                if (vertices.length > 1) {
                    for (let i = 0; i < vertices.length - 1; i++) {
                        const dx = vertices[i].x - vertices[i + 1].x;
                        const dy = vertices[i].y - vertices[i + 1].y;
                        dist += Math.sqrt(dx * dx + dy * dy);
                    }
                    // Closed polyline?
                    if ((entity as any).shape || (entity as any).closed) {
                        const dx = vertices[vertices.length - 1].x - vertices[0].x;
                        const dy = vertices[vertices.length - 1].y - vertices[0].y;
                        dist += Math.sqrt(dx * dx + dy * dy);
                    }
                }
                layerLengths.set(layer, (layerLengths.get(layer) || 0) + dist);
            }
            else if (entity.type === 'HATCH') {
                const layer = (entity as any).layer || '0';
                // Hatch area calculation is complex in raw DXF. 
                // We will attempt to use the boundary path if available
                // Simplification: If it has a polyline boundary, calculate that area.
                // This is a "Best Effort" for MVP.
                let area = 0;
                // ... implementation details for signed area of polygon ...
                const summary = (entity as any).summary; // Some parsers provide summary
                if (summary && summary.area) {
                    area = summary.area;
                }

                // Fallback: Check if we can compute from boundary loop
                // This is complex, skipping strict geometry math for now to avoid crashes.
                // We will mark it as "Area Detected"

                const key = `HATCH::${layer}`;
                if (!layerLengths.has(key)) layerLengths.set(key, 0);
                // We accumulate "Count" of hatches for now if area is missing, 
                // or maybe we just track that this layer HAS hatches.
            }
            else if (entity.type === 'TEXT' || entity.type === 'MTEXT') {
                const text = (entity as any).text || (entity as any).string;
                if (text) {
                    // We create a special "Context" item later? 
                    // Or just treat as a 'text' item
                    items.push({
                        id: uuidv4(),
                        type: 'text',
                        name_raw: text.slice(0, 50),
                        layer_raw: (entity as any).layer || '0',
                        layer_normalized: ((entity as any).layer || '0').toLowerCase(),
                        value_raw: 1,
                        unit_raw: 'txt',
                        value_m: 0,
                        evidence: 'TEXT entity'
                    });
                }
            }
        } catch (err) {
            // Skip entity if malformed
            continue;
        }
    }

    // Convert to ItemDetectado for Blocks
    for (const [key, data] of blockCounts.entries()) {
        const [name, layer] = key.split('::');
        items.push({
            id: uuidv4(),
            type: 'block',
            name_raw: name, // e.g. "*U114" or "ELEC E"
            layer_raw: layer,
            layer_normalized: layer.toLowerCase(),
            value_raw: data.count,
            unit_raw: 'u', // Explicit unit for AI
            value_m: data.count,
            evidence: 'INSERT entity'
        });
    }

    // Convert to ItemDetectado for Lengths/Layers
    for (const [layer, length] of layerLengths.entries()) {
        const lengthM = toMeters(length);
        if (lengthM < 0.01) continue; // Noise filter

        items.push({
            id: uuidv4(),
            type: 'length',
            name_raw: `Lines on ${layer}`,
            layer_raw: layer,
            layer_normalized: layer.toLowerCase(),
            value_raw: length,
            unit_raw: 'm', // Explicit unit for AI
            value_m: lengthM,
            evidence: 'LINE/POLYLINE sum'
        });
    }

    return items;
}

export function aggregateDxfItems(allItems: ItemDetectado[]): ItemDetectado[] {
    const map = new Map<string, ItemDetectado>();

    for (const item of allItems) {
        // We aggregate Text differently or ignore it for summation?
        if (item.type === 'text') continue; // Don't sum texts

        const key = `${item.type}::${item.name_raw}::${item.layer_normalized}`;
        if (map.has(key)) {
            const existing = map.get(key)!;
            existing.value_raw += item.value_raw;
            existing.value_m += item.value_m;
            // append evidence or source?
        } else {
            // Clone to avoid mutation issues
            map.set(key, { ...item, id: uuidv4() });
        }
    }

    return Array.from(map.values());
}
