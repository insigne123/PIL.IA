
import { parseDxf } from '../src/lib/processing/dxf';
import fs from 'fs';
import path from 'path';

const DXF_PATH = path.resolve(__dirname, '..', 'LDS_PAK - (LC) (1).dxf');
const TARGET_LAYERS = ['a-arq-cielo falso'];

const LOG_FILE = 'debug_layers_output.txt';

function log(msg: string) {
    console.log(msg);
    fs.appendFileSync(LOG_FILE, msg + '\n');
}

async function run() {
    fs.writeFileSync(LOG_FILE, ''); // Clear file
    log(`Reading ${DXF_PATH}`);
    let content;
    try {
        content = fs.readFileSync(DXF_PATH, 'utf-8');
    } catch (e) {
        content = fs.readFileSync(DXF_PATH).toString('latin1');
    }

    log('Parsing DXF...');
    const { items } = await parseDxf(content);
    log(`Total items: ${items.length}`);

    for (const layer of TARGET_LAYERS) {
        log(`\n--- Layer: ${layer} ---`);
        const layerItems = items.filter(i => i.layer_normalized === layer);
        log(`Count: ${layerItems.length}`);

        // Group by type
        const byType: Record<string, number> = {};
        let totalLength = 0;
        let totalArea = 0;

        for (const item of layerItems) {
            byType[item.type] = (byType[item.type] || 0) + 1;
            if (item.type === 'length') totalLength += item.value_si;
            if (item.type === 'area') totalArea += item.value_si;
        }

        log('Types: ' + JSON.stringify(byType));
        log(`Total Length: ${totalLength.toFixed(2)}m`);
        log(`Total Area: ${totalArea.toFixed(2)}m²`);

        // Show first 3 items
        if (layerItems.length > 0) {
            log('Sample items: ' + JSON.stringify(layerItems.slice(0, 3), null, 2));
        }
    }
}

run();
