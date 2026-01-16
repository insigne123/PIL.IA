/**
 * Debug which layers the geometry inside CIELOS block is on
 */

const fs = require('fs');
const DxfParser = require('dxf-parser');

const DXF_PATH = 'C:\\Users\\nicog\\Downloads\\wetransfer_lds-pak-licitacion-oocc_2026-01-08_0027\\PIL.IA\\LDS_PAK - (LC) (1).dxf';

function analyze() {
    let content;
    try {
        content = fs.readFileSync(DXF_PATH, 'utf-8');
    } catch (e) {
        content = fs.readFileSync(DXF_PATH).toString('latin1');
    }

    const parser = new DxfParser();
    const dxf = parser.parseSync(content);
    const blocks = dxf.blocks || {};

    console.log('=== Block Internal Layer Analysis ===\n');

    const keyBlocks = ['CIELOS', 'CIELOS PAK', 'ARQ Muros', 'ARQ RAB PAK'];

    for (const blockName of keyBlocks) {
        const block = blocks[blockName];
        if (!block) {
            console.log(`[${blockName}] - NOT FOUND\n`);
            continue;
        }

        console.log(`[${blockName}]`);
        console.log(`  Block layer: ${block.layer || '(none)'}`);
        console.log(`  Entities: ${block.entities?.length || 0}`);

        // Group entities by layer
        const layerCount = {};
        for (const entity of (block.entities || [])) {
            const layer = entity.layer || '0';
            layerCount[layer] = (layerCount[layer] || 0) + 1;
        }

        console.log('  Entity layers:');
        for (const [layer, count] of Object.entries(layerCount)) {
            console.log(`    ${layer}: ${count} entities (${layer === '0' ? 'INHERITS INSERT LAYER' : 'Fixed layer'})`);
        }

        // Check what layers polylines are on
        const polylineLayers = new Set();
        for (const entity of (block.entities || [])) {
            if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
                polylineLayers.add(entity.layer || '0');
            }
        }
        console.log(`  Polyline layers: ${Array.from(polylineLayers).join(', ')}`);
        console.log('');
    }

    // Now check which INSERT is used for CIELOS
    console.log('=== Where is CIELOS INSERT placed? ===');
    const entities = dxf.entities || [];
    for (const entity of entities) {
        if (entity.type === 'INSERT' && entity.name === 'CIELOS') {
            console.log(`  INSERT "CIELOS" on layer: ${entity.layer} at position (${entity.position?.x}, ${entity.position?.y})`);
        }
    }
}

analyze();
