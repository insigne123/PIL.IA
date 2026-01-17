
import { parseDxf } from '../src/lib/processing/dxf';
import fs from 'fs';
import path from 'path';

const DXF_PATH = path.resolve(__dirname, '..', 'LDS_PAK - (LC) (1).dxf');
const OUTPUT_FILE = 'layer_inventory.txt';

async function run() {
    console.log('Analyzing DXF layers...');

    let dxfContent;
    try {
        dxfContent = fs.readFileSync(DXF_PATH, 'utf-8');
    } catch (e) {
        dxfContent = fs.readFileSync(DXF_PATH).toString('latin1');
    }

    const { items } = await parseDxf(dxfContent);

    // Aggregate by layer
    const layerStats: Record<string, {
        totalArea: number;
        totalLength: number;
        blockCount: number;
        itemCount: number;
        types: Set<string>;
    }> = {};

    for (const item of items) {
        const layer = item.layer_normalized || 'unknown';
        if (!layerStats[layer]) {
            layerStats[layer] = {
                totalArea: 0,
                totalLength: 0,
                blockCount: 0,
                itemCount: 0,
                types: new Set()
            };
        }

        layerStats[layer].itemCount++;
        layerStats[layer].types.add(item.type);

        if (item.type === 'area') {
            layerStats[layer].totalArea += item.value_si;
        } else if (item.type === 'length') {
            layerStats[layer].totalLength += item.value_si;
        } else if (item.type === 'block') {
            layerStats[layer].blockCount += item.value_si;
        }
    }

    // Sort by area + length (potential usefulness)
    const sortedLayers = Object.entries(layerStats)
        .map(([layer, stats]) => ({
            layer,
            ...stats,
            // Calculate potential area from length (for reference)
            potentialAreaFromLength: stats.totalLength * 2.4
        }))
        .sort((a, b) => (b.totalArea + b.potentialAreaFromLength) - (a.totalArea + a.potentialAreaFromLength));

    // Generate report
    const lines: string[] = [];
    lines.push('='.repeat(100));
    lines.push('DXF LAYER INVENTORY - Buscando capas que coincidan con valores esperados');
    lines.push('='.repeat(100));
    lines.push('');
    lines.push('VALORES ESPERADOS DEL CSV:');
    lines.push('  TAB 01 (sobretabique sala): 62.38 m²');
    lines.push('  TAB 02 (sobretabique bodega): 30.58 m²');
    lines.push('  TAB 03 (tabique divisorio): 29.76 m²');
    lines.push('  Cielo sala: 37.62 m²');
    lines.push('  Cielo bodega: 9.89 m²');
    lines.push('  Impermeabilización: 46.57 m²');
    lines.push('  Sobrelosa: 60.57 m²');
    lines.push('');
    lines.push('='.repeat(100));
    lines.push('CAPAS DISPONIBLES EN EL DXF:');
    lines.push('='.repeat(100));
    lines.push('');
    lines.push('Layer'.padEnd(40) + 'Área (m²)'.padStart(15) + 'Largo (m)'.padStart(15) + 'Área×2.4m'.padStart(15) + 'Bloques'.padStart(10) + 'Tipos'.padStart(20));
    lines.push('-'.repeat(115));

    for (const layer of sortedLayers) {
        const areaStr = layer.totalArea > 0 ? layer.totalArea.toFixed(2) : '-';
        const lengthStr = layer.totalLength > 0 ? layer.totalLength.toFixed(2) : '-';
        const potAreaStr = layer.potentialAreaFromLength > 0 ? layer.potentialAreaFromLength.toFixed(2) : '-';
        const blockStr = layer.blockCount > 0 ? layer.blockCount.toString() : '-';
        const typesStr = Array.from(layer.types).join(',');

        lines.push(
            layer.layer.padEnd(40) +
            areaStr.padStart(15) +
            lengthStr.padStart(15) +
            potAreaStr.padStart(15) +
            blockStr.padStart(10) +
            typesStr.padStart(20)
        );
    }

    lines.push('');
    lines.push('='.repeat(100));
    lines.push('CAPAS CON ÁREA DIRECTA (potenciales matches para cielos/pisos):');
    lines.push('='.repeat(100));

    const areaLayers = sortedLayers.filter(l => l.totalArea > 1);
    for (const layer of areaLayers) {
        lines.push(`  ${layer.layer}: ${layer.totalArea.toFixed(2)} m²`);
    }

    lines.push('');
    lines.push('='.repeat(100));
    lines.push('CAPAS CON LARGO SIGNIFICATIVO (potenciales matches para tabiques):');
    lines.push('='.repeat(100));

    const lengthLayers = sortedLayers
        .filter(l => l.totalLength > 10)
        .sort((a, b) => b.potentialAreaFromLength - a.potentialAreaFromLength);

    for (const layer of lengthLayers) {
        lines.push(`  ${layer.layer}: ${layer.totalLength.toFixed(2)} m → ${layer.potentialAreaFromLength.toFixed(2)} m² (×2.4m)`);
    }

    const output = lines.join('\n');
    fs.writeFileSync(OUTPUT_FILE, output);
    console.log(`\nInventory saved to ${OUTPUT_FILE}`);
    console.log('\n' + output);
}

run();
