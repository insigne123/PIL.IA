/**
 * DXF Polyline Closure Debug Script
 * Checks if polylines have the 'closed' or 'shape' flag set
 */

const fs = require('fs');
const DxfParser = require('dxf-parser');

const DXF_PATH = 'C:\\Users\\nicog\\Downloads\\wetransfer_lds-pak-licitacion-oocc_2026-01-08_0027\\PIL.IA\\LDS_PAK - (LC) (1).dxf';

function analyzeDxf() {
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

    const blocks = dxf.blocks || {};
    const targetBlocks = ['CIELOS', 'CIELOS PAK', 'ARQ Muros', 'ARQ RAB PAK', 'mu pak'];

    console.log('=== Polyline Closure Analysis ===\n');

    for (const targetName of targetBlocks) {
        const block = blocks[targetName];
        if (!block) {
            console.log(`[${targetName}] - NOT FOUND\n`);
            continue;
        }

        console.log(`[${targetName}]`);
        console.log(`  Total entities: ${block.entities?.length || 0}`);

        let closedCount = 0;
        let openCount = 0;
        let totalArea = 0;

        for (const entity of (block.entities || [])) {
            if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
                const vertices = entity.vertices || [];
                const closed = entity.closed;
                const shape = entity.shape;
                const flags = entity.flags;

                // Check if first and last vertex are same (auto-close detection)
                let autoClose = false;
                if (vertices.length >= 3) {
                    const first = vertices[0];
                    const last = vertices[vertices.length - 1];
                    if (first && last) {
                        const dist = Math.sqrt(Math.pow(first.x - last.x, 2) + Math.pow(first.y - last.y, 2));
                        autoClose = dist < 1; // Less than 1mm
                    }
                }

                // Calculate area if appears closed
                let area = 0;
                if (vertices.length >= 3 && (closed || shape || autoClose)) {
                    for (let i = 0; i < vertices.length; i++) {
                        const j = (i + 1) % vertices.length;
                        area += vertices[i].x * vertices[j].y;
                        area -= vertices[j].x * vertices[i].y;
                    }
                    area = Math.abs(area) / 2;
                }

                const areaM2 = area * 0.001 * 0.001; // mm² to m²

                if (closed || shape || autoClose) {
                    closedCount++;
                    totalArea += areaM2;
                    console.log(`  POLYLINE: ${vertices.length} vertices, closed=${closed}, shape=${shape}, autoClose=${autoClose}, area=${areaM2.toFixed(2)} m²`);
                } else {
                    openCount++;
                }
            }
        }

        console.log(`  Summary: ${closedCount} closed, ${openCount} open polylines`);
        console.log(`  Total area from closed polylines: ${totalArea.toFixed(2)} m²`);
        console.log('');
    }

    // Also check CIELOS in block definitions for detail
    console.log('\n=== CIELOS Block Detail ===');
    const cielosBlock = blocks['CIELOS'];
    if (cielosBlock) {
        for (const entity of (cielosBlock.entities || [])) {
            console.log(JSON.stringify({
                type: entity.type,
                layer: entity.layer,
                closed: entity.closed,
                shape: entity.shape,
                flags: entity.flags,
                vertexCount: entity.vertices?.length || 0
            }, null, 2));
        }
    }
}

analyzeDxf();
