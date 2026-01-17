
import { parseDxf } from '../src/lib/processing/dxf';
import fs from 'fs';
import path from 'path';

const DXF_PATH = path.resolve(__dirname, '..', 'LDS_PAK - (LC) (1).dxf');

async function locateText() {
    console.log('Reading DXF...');
    let dxfContent;
    try {
        dxfContent = fs.readFileSync(DXF_PATH, 'utf-8');
    } catch (e) {
        dxfContent = fs.readFileSync(DXF_PATH).toString('latin1');
    }

    const { items } = await parseDxf(dxfContent);

    // Find all text items containing "TAB"
    const textItems = items.filter(i =>
        (i.type === 'text' || i.evidence?.includes('TEXT')) &&
        i.name_raw?.toUpperCase().includes('TAB')
    );

    console.log(`\nFound ${textItems.length} text labels containing 'TAB':`);

    for (const t of textItems) {
        console.log(`  - "${t.name_raw}" at Layer: ${t.layer_normalized}`);
        // Note: parseDxf simplifies items, so exact coordinates might be in 'value_m' or skipped.
        // We might need to check direct DXF parser output if coordinates aren't preserved in 'ItemDetectado'.
    }

    // Check if we have standard parsing available for coordinates
    const DxfParser = require('dxf-parser');
    const parser = new DxfParser();
    let dxfData;
    try {
        dxfData = parser.parseSync(dxfContent);
    } catch (e) {
        console.error("Parser failed:", e.message);
        return;
    }

    // Deep search in entities for TEXT/MTEXT with coordinates
    console.log('\nDeep coordinate search for "TAB 01":');
    const entities = dxfData.entities;

    const relevantTexts = entities.filter((e: any) => {
        return (e.type === 'TEXT' || e.type === 'MTEXT') &&
            (e.text?.includes('TAB 01') || e.text?.includes('TAB-01'));
    });

    if (relevantTexts.length === 0) {
        console.log('  ❌ Label "TAB 01" NOT FOUND in Entities.');

        // Try searching for just "TAB"
        const anyTab = entities.filter((e: any) => (e.type === 'TEXT' || e.type === 'MTEXT') && e.text?.includes('TAB'));
        console.log(`  ℹ️ Found ${anyTab.length} other labels with "TAB" (e.g., "${anyTab[0]?.text}")`);
    } else {
        for (const t of relevantTexts) {
            console.log(`  ✅ Found "${t.text}" at X=${t.position?.x || t.startPoint?.x}, Y=${t.position?.y || t.startPoint?.y}`);
        }
    }
}

locateText();
