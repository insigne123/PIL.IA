
import { getLayerKeywords, matchLayerKeywords } from '../src/lib/processing/layer-mapping';
import fs from 'fs';

const logFile = 'debug_keywords_output.txt';
function log(msg: string) {
    console.log(msg);
    fs.appendFileSync(logFile, msg + '\n');
}
fs.writeFileSync(logFile, '');

const layer = 'fa_arq-muros';
const description = 'TAB 01: sobretabique simple sala de ventas';

log(`Layer: ${layer}`);
log(`Keywords: ${JSON.stringify(getLayerKeywords(layer))}`);

const match = matchLayerKeywords(description, layer);
log(`Match Result: ${JSON.stringify(match, null, 2)}`);

log(`Checking match with 'FA_ARQ-MUROS' (upper case)...`);
log(`Keywords (Upper): ${JSON.stringify(getLayerKeywords('FA_ARQ-MUROS'))}`);

