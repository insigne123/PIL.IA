import DxfParser from 'dxf-parser';
import { ItemDetectado, Unit } from '@/types';
import { v4 as uuidv4 } from 'uuid';

const parser = new DxfParser();

export async function parseDxf(fileContent: string, planUnitPreference?: Unit): Promise<{ items: ItemDetectado[], detectedUnit: Unit | null }> {
    let dxf;
    try {
        dxf = parser.parseSync(fileContent);
    } catch (e) {
        console.error("DXF Parse Error", e);
        throw new Error("Invalid DXF file");
    }

    // 1. Auto-Detect Unit from $INSUNITS
    let detectedUnit: Unit | null = null;
    const insUnits = (dxf.header || {})['$INSUNITS'];
    if (insUnits !== undefined) {
        if (insUnits === 4) detectedUnit = 'mm';
        else if (insUnits === 5) detectedUnit = 'cm';
        else if (insUnits === 6) detectedUnit = 'm';
    }

    // 2. Decide effective unit
    // If user provided a preference (and it's not 'pending' or similar?), use it.
    // Otherwise use detected. Fallback to 'm'.
    const effectiveUnit: Unit = planUnitPreference || detectedUnit || 'm';

    const items: ItemDetectado[] = [];
    const entities = dxf.entities || [];

    if (entities.length === 0) {
        console.warn("DXF parser found 0 entities in Model Space.");
    }

    // Helper to normalize to meters
    const toMeters = (val: number) => {
        if (effectiveUnit === 'mm') return val / 1000;
        if (effectiveUnit === 'cm') return val / 100;
        return val;
    };

    // ... (rest of the logic uses effectiveUnit via toMeters)

    // Grouping for counts and lengths
    const blockCounts = new Map<string, { count: number; layer: string }>();
    const layerLengths = new Map<string, number>();

    for (const entity of entities) {
        try {
            if (entity.type === 'INSERT') {
                let name = (entity as any).name || (entity as any).block || 'UnknownBlock';
                const layer = (entity as any).layer || '0';
                const key = `${name}::${layer}`;
                if (!blockCounts.has(key)) blockCounts.set(key, { count: 0, layer });
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
                    if ((entity as any).shape || (entity as any).closed) {
                        const dx = vertices[vertices.length - 1].x - vertices[0].x;
                        const dy = vertices[vertices.length - 1].y - vertices[0].y;
                        dist += Math.sqrt(dx * dx + dy * dy);
                    }
                }
                layerLengths.set(layer, (layerLengths.get(layer) || 0) + dist);
            }
            else if (entity.type === 'HATCH') {
                // Hatch logic (simplified)
                const layer = (entity as any).layer || '0';
                const key = `HATCH::${layer}`;
                if (!layerLengths.has(key)) layerLengths.set(key, 0);
            }
            else if (entity.type === 'TEXT' || entity.type === 'MTEXT') {
                const text = (entity as any).text || (entity as any).string;
                if (text) {
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
        } catch (err) { continue; }
    }

    // Convert Blocks
    for (const [key, data] of blockCounts.entries()) {
        const [name, layer] = key.split('::');
        items.push({
            id: uuidv4(),
            type: 'block',
            name_raw: name,
            layer_raw: layer,
            layer_normalized: layer.toLowerCase(),
            value_raw: data.count,
            unit_raw: 'u',
            value_m: data.count,
            evidence: 'INSERT entity'
        });
    }

    // Convert Lengths
    for (const [layer, length] of layerLengths.entries()) {
        const lengthM = toMeters(length);
        if (lengthM < 0.01) continue;
        items.push({
            id: uuidv4(),
            type: 'length',
            name_raw: `Lines on ${layer}`,
            layer_raw: layer,
            layer_normalized: layer.toLowerCase(),
            value_raw: length,
            unit_raw: 'm',
            value_m: lengthM,
            evidence: `LINE/POLYLINE sum (${effectiveUnit}->m)`
        });
    }

    return { items, detectedUnit };
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
