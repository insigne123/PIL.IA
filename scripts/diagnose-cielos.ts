import DxfParser from 'dxf-parser';
import fs from 'fs';
import path from 'path';

// Config
const DXF_PATH = path.resolve(__dirname, '..', 'LDS_PAK - (LC) (1).dxf');
const TARGET_BLOCK_NAME = 'A$C35E860D8'; // From previous log

async function run() {
    console.log(`--- Inspecting Block: ${TARGET_BLOCK_NAME} ---`);

    let dxfContent;
    try {
        dxfContent = fs.readFileSync(DXF_PATH, 'utf-8');
    } catch (e) {
        dxfContent = fs.readFileSync(DXF_PATH).toString('latin1');
    }

    const parser = new DxfParser();
    const dxf = parser.parseSync(dxfContent);

    if (!dxf) {
        console.error('Failed to parse DXF file.');
        return;
    }

    // Find the block definition
    const block = dxf.blocks[TARGET_BLOCK_NAME];

    if (!block) {
        console.error(`Block ${TARGET_BLOCK_NAME} NOT FOUND in DXF blocks table.`);
        console.log('Available blocks:', Object.keys(dxf.blocks).filter(k => k.startsWith('A$')).slice(0, 10));
        return;
    }

    console.log(`Block found. Entities: ${block.entities.length}`);

    const typeCounts: Record<string, number> = {};
    let totalLen = 0;

    block.entities.forEach(e => {
        typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;

        if (e.type === 'LINE' || e.type === 'LWPOLYLINE') {
            // Rough length approx
            // (Not calculating full dist here, just counting existence)
        }
    });

    console.log('Entity Composition:', JSON.stringify(typeCounts, null, 2));

    // Check for "Closed" Polylines (Area candidates)
    const closedPolys = block.entities.filter(e => {
        if (e.type !== 'LWPOLYLINE') return false;
        const poly = e as any; // Type assertion for LWPOLYLINE-specific props
        return poly.shape === true || poly.closed === true;
    });
    console.log(`Closed Polylines: ${closedPolys.length}`);

    const hatches = block.entities.filter(e => e.type === 'HATCH');
    console.log(`Hatches: ${hatches.length}`);

}

run();
