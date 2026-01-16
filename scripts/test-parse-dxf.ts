/**
 * Direct test of parseDxf function
 * Run with: npx tsx scripts/test-parse-dxf.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseDxf, aggregateDxfItems } from '../src/lib/processing/dxf';

const DXF_PATH = path.join(__dirname, '..', 'LDS_PAK - (LC) (1).dxf');

async function main() {
    console.log('=== Direct DXF Parse Test ===\n');

    // Read DXF file
    let content: string;
    try {
        content = fs.readFileSync(DXF_PATH, 'utf-8');
    } catch (e) {
        const buffer = fs.readFileSync(DXF_PATH);
        content = buffer.toString('latin1');
    }

    console.log(`DXF file size: ${(content.length / 1024 / 1024).toFixed(2)} MB`);

    // Parse DXF
    console.log('\nParsing DXF (this includes view filter)...\n');
    const startTime = Date.now();

    try {
        const { items, preflight, geometryHealth } = await parseDxf(content, 'm');

        console.log(`Parse time: ${Date.now() - startTime}ms`);
        console.log('\n=== Preflight Summary ===');
        console.log(`  Total entities: ${preflight.entityCount}`);
        console.log(`  BBox diagonal: ${preflight.boundingBox.diagonal.toFixed(2)}m`);
        console.log(`  Has area candidates: ${preflight.hasAreaCandidates}`);
        console.log(`  Has length candidates: ${preflight.hasLengthCandidates}`);

        console.log('\n=== Geometry Health ===');
        console.log(`  Status: ${geometryHealth.status}`);
        if (geometryHealth.issues?.length) {
            console.log(`  Issues: ${geometryHealth.issues.join(', ')}`);
        }

        // Aggregate items
        const aggregated = aggregateDxfItems(items);

        console.log(`\n=== Items Created ===`);
        console.log(`  Raw items: ${items.length}`);
        console.log(`  Aggregated items: ${aggregated.length}`);

        // Show items by type
        const byType: Record<string, number> = {};
        for (const item of aggregated) {
            byType[item.type] = (byType[item.type] || 0) + 1;
        }
        console.log(`\n  By type: ${JSON.stringify(byType)}`);

        // Show area items
        console.log('\n=== Area Items (m²) ===');
        const areaItems = aggregated.filter(i => i.type === 'area');
        for (const item of areaItems.slice(0, 20)) {
            console.log(`  ${item.layer_raw}: ${item.value_si?.toFixed(2)} m²`);
        }

        // Show length items  
        console.log('\n=== Length Items (m) - Top 10 ===');
        const lengthItems = aggregated.filter(i => i.type === 'length').sort((a, b) => (b.value_si || 0) - (a.value_si || 0));
        for (const item of lengthItems.slice(0, 10)) {
            console.log(`  ${item.layer_raw}: ${item.value_si?.toFixed(2)} m (wall area: ${((item.value_si || 0) * 2.4).toFixed(2)} m²)`);
        }

        // Show expected layers
        console.log('\n=== Key Layers for Excel ===');
        const keyLayers = ['FA_ARQ-MUROS', 'FA_TABIQUES', 'A-ARQ-CIELO FALSO'];
        for (const layer of keyLayers) {
            const layerItems = aggregated.filter(i => i.layer_raw?.toLowerCase() === layer.toLowerCase());
            console.log(`  [${layer}]:`);
            for (const item of layerItems) {
                console.log(`    ${item.type}: ${item.value_si?.toFixed(2)} ${item.type === 'area' ? 'm²' : item.type === 'length' ? 'm' : 'u'}`);
            }
        }

    } catch (e: any) {
        console.error('Parse error:', e.message);
        console.error(e.stack);
    }
}

main();
