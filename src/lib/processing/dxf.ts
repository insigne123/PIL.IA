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
    const entities = dxf.entities || [];

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
        if (entity.type === 'INSERT') {
            const name = (entity as any).name;
            const layer = (entity as any).layer || '0';
            const key = `${name}::${layer}`;

            if (!blockCounts.has(key)) {
                blockCounts.set(key, { count: 0, layer });
            }
            blockCounts.get(key)!.count++;
        } else if (entity.type === 'LINE') {
            const layer = (entity as any).layer || '0';
            const vertices = (entity as any).vertices;
            if (vertices && vertices.length === 2) {
                const dx = vertices[0].x - vertices[1].x;
                const dy = vertices[0].y - vertices[1].y;
                // 2D distance for now (Projected)
                const dist = Math.sqrt(dx * dx + dy * dy);
                layerLengths.set(layer, (layerLengths.get(layer) || 0) + dist);
            }
        } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
            const layer = (entity as any).layer || '0';
            const vertices = (entity as any).vertices || [];
            let dist = 0;
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
            layerLengths.set(layer, (layerLengths.get(layer) || 0) + dist);
        }
    }

    // Convert to ItemDetectado
    for (const [key, data] of blockCounts.entries()) {
        const [name, layer] = key.split('::');
        items.push({
            id: uuidv4(),
            type: 'block',
            name_raw: name,
            layer_raw: layer,
            layer_normalized: layer.toLowerCase(),
            value_raw: data.count,
            unit_raw: planUnit, // Blocks essentially have 'unit' count, but context suggests they exist in this plan unit space
            value_m: data.count, // Count is count
            evidence: 'INSERT entity'
        });
    }

    for (const [layer, length] of layerLengths.entries()) {
        items.push({
            id: uuidv4(),
            type: 'length',
            name_raw: `Lines on ${layer}`,
            layer_raw: layer,
            layer_normalized: layer.toLowerCase(),
            value_raw: length,
            unit_raw: planUnit,
            value_m: toMeters(length),
            evidence: 'LINE/POLYLINE sum'
        });
    }

    return items;
}

export function aggregateDxfItems(allItems: ItemDetectado[]): ItemDetectado[] {
    const map = new Map<string, ItemDetectado>();

    for (const item of allItems) {
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
