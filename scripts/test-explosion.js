/**
 * Test DXF Parser Output
 * Verifies what items are being returned by parseDxf
 */

const fs = require('fs');
const DxfParser = require('dxf-parser');

// Replicate the key logic from block-exploder to verify
const DXF_PATH = 'C:\\Users\\nicog\\Downloads\\wetransfer_lds-pak-licitacion-oocc_2026-01-08_0027\\PIL.IA\\LDS_PAK - (LC) (1).dxf';

function calculatePolygonArea(vertices) {
    if (!vertices || vertices.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < vertices.length; i++) {
        const j = (i + 1) % vertices.length;
        area += vertices[i].x * vertices[j].y;
        area -= vertices[j].x * vertices[i].y;
    }
    return Math.abs(area) / 2;
}

function distance(p1, p2) {
    if (!p1 || !p2) return 0;
    return Math.sqrt(Math.pow((p2.x || 0) - (p1.x || 0), 2) + Math.pow((p2.y || 0) - (p1.y || 0), 2));
}

function testBlockExplosion() {
    let content;
    try {
        content = fs.readFileSync(DXF_PATH, 'utf-8');
    } catch (e) {
        const buffer = fs.readFileSync(DXF_PATH);
        content = buffer.toString('latin1');
    }

    const parser = new DxfParser();
    const dxf = parser.parseSync(content);

    if (!dxf) {
        console.log('Failed to parse DXF');
        return;
    }

    const unitScale = 0.001; // mm to m
    const unitScaleSq = unitScale * unitScale;

    const blocks = dxf.blocks || {};
    const entities = dxf.entities || [];

    console.log('=== Block Explosion Test ===\n');

    // Find all INSERTs and their block definitions
    const inserts = entities.filter(e => e.type === 'INSERT');
    console.log(`Total INSERTs in ModelSpace: ${inserts.length}\n`);

    // Explode key blocks
    const targetBlocks = ['CIELOS', 'CIELOS PAK', 'ARQ Muros', 'ARQ RAB PAK'];

    for (const targetName of targetBlocks) {
        const block = blocks[targetName];
        if (!block) {
            console.log(`[${targetName}] - NOT FOUND\n`);
            continue;
        }

        // Count how many times this block is used
        const usageCount = inserts.filter(i => i.name === targetName).length;

        console.log(`[${targetName}] - Used ${usageCount} times`);

        let totalArea = 0;
        let totalLength = 0;

        for (const entity of (block.entities || [])) {
            if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
                const vertices = entity.vertices || [];
                const isClosed = entity.shape || entity.closed;

                // Calculate length
                let length = 0;
                for (let i = 0; i < vertices.length - 1; i++) {
                    length += distance(vertices[i], vertices[i + 1]);
                }
                if (isClosed && vertices.length > 2) {
                    length += distance(vertices[vertices.length - 1], vertices[0]);
                }

                // Calculate area if closed
                if (isClosed && vertices.length >= 3) {
                    const area = calculatePolygonArea(vertices) * unitScaleSq;
                    totalArea += area;
                }

                totalLength += length * unitScale;
            }
        }

        const perInstanceArea = totalArea;
        const perInstanceLength = totalLength;
        const totalAreaAllInstances = totalArea * usageCount;
        const totalLengthAllInstances = totalLength * usageCount;
        const wallAreaAllInstances = totalLengthAllInstances * 2.4;

        console.log(`  Per Instance: Area=${perInstanceArea.toFixed(2)} m², Length=${perInstanceLength.toFixed(2)} m`);
        console.log(`  All Instances (x${usageCount}): Area=${totalAreaAllInstances.toFixed(2)} m², Length=${totalLengthAllInstances.toFixed(2)} m`);
        console.log(`  Wall Area (Length * 2.4m): ${wallAreaAllInstances.toFixed(2)} m²`);
        console.log('');
    }

    // Check which layers INSERTs are on
    console.log('=== INSERTs by Layer ===\n');
    const insertsByLayer = {};
    for (const insert of inserts) {
        const layer = insert.layer || '0';
        const name = insert.name;
        if (!insertsByLayer[layer]) insertsByLayer[layer] = {};
        insertsByLayer[layer][name] = (insertsByLayer[layer][name] || 0) + 1;
    }

    for (const [layer, blocks] of Object.entries(insertsByLayer)) {
        console.log(`[${layer}]`);
        for (const [name, count] of Object.entries(blocks)) {
            console.log(`  ${name}: ${count}x`);
        }
    }

    console.log('\n=== Expected from Excel ===');
    console.log('  TAB 01: 62.38 m²');
    console.log('  TAB 02: 30.58 m²');
    console.log('  TAB 03: 29.76 m²');
    console.log('  Cielo sala ventas: 37.62 m²');
    console.log('\nLook for matching values above!');
}

testBlockExplosion();
