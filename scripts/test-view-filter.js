/**
 * Test script to verify view filter effect on quantities
 */

const fs = require('fs');
const DxfParser = require('dxf-parser');

const DXF_PATH = 'C:\\Users\\nicog\\Downloads\\wetransfer_lds-pak-licitacion-oocc_2026-01-08_0027\\PIL.IA\\LDS_PAK - (LC) (1).dxf';
const UNIT_SCALE = 0.001; // mm to m
const UNIT_SCALE_SQ = UNIT_SCALE * UNIT_SCALE;

function getEntityCenter(entity) {
    if (entity.type === 'LINE' && entity.start && entity.end) {
        return { x: (entity.start.x + entity.end.x) / 2, y: (entity.start.y + entity.end.y) / 2 };
    } else if ((entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') && entity.vertices?.length) {
        let sumX = 0, sumY = 0;
        for (const v of entity.vertices) { sumX += v.x; sumY += v.y; }
        return { x: sumX / entity.vertices.length, y: sumY / entity.vertices.length };
    } else if (entity.type === 'INSERT' && entity.position) {
        return entity.position;
    }
    return null;
}

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

function test() {
    let content;
    try {
        content = fs.readFileSync(DXF_PATH, 'utf-8');
    } catch (e) {
        content = fs.readFileSync(DXF_PATH).toString('latin1');
    }

    const parser = new DxfParser();
    const dxf = parser.parseSync(content);
    const entities = dxf.entities || [];

    console.log('=== View Filter Effect Test ===\n');
    console.log(`Total entities: ${entities.length}`);

    // Auto-detect main plan (Y range with most entities)
    const BIN_SIZE = 10000;
    const yBins = {};
    for (const e of entities) {
        const center = getEntityCenter(e);
        if (center) {
            const bin = Math.floor(center.y / BIN_SIZE) * BIN_SIZE;
            yBins[bin] = (yBins[bin] || 0) + 1;
        }
    }

    let maxBin = -70000, maxCount = 0;
    for (const [bin, count] of Object.entries(yBins)) {
        if (count > maxCount) { maxCount = count; maxBin = parseFloat(bin); }
    }

    const yMin = maxBin - BIN_SIZE;
    const yMax = maxBin + BIN_SIZE * 3;

    console.log(`\nDetected main plan Y range: ${(yMin * UNIT_SCALE).toFixed(0)}m to ${(yMax * UNIT_SCALE).toFixed(0)}m`);

    // Filter entities
    const mainPlanEntities = entities.filter(e => {
        const center = getEntityCenter(e);
        return center && center.y >= yMin && center.y <= yMax;
    });
    const excludedEntities = entities.filter(e => {
        const center = getEntityCenter(e);
        return center && (center.y < yMin || center.y > yMax);
    });

    console.log(`Main plan entities: ${mainPlanEntities.length}`);
    console.log(`Excluded (cortes): ${excludedEntities.length}`);
    console.log(`Reduction: ${((excludedEntities.length / entities.length) * 100).toFixed(1)}%`);

    // Calculate totals before/after
    function calculateTotals(entities) {
        let totalArea = 0;
        let totalLength = 0;
        let insertCount = 0;

        for (const entity of entities) {
            if (entity.type === 'INSERT') {
                insertCount++;
            } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
                const vertices = entity.vertices || [];
                const isClosed = entity.shape || entity.closed;

                if (isClosed && vertices.length >= 3) {
                    totalArea += calculatePolygonArea(vertices) * UNIT_SCALE_SQ;
                }

                for (let i = 0; i < vertices.length - 1; i++) {
                    const dx = vertices[i + 1].x - vertices[i].x;
                    const dy = vertices[i + 1].y - vertices[i].y;
                    totalLength += Math.sqrt(dx * dx + dy * dy) * UNIT_SCALE;
                }
            }
        }

        return { totalArea, totalLength, insertCount };
    }

    const beforeFilter = calculateTotals(entities);
    const afterFilter = calculateTotals(mainPlanEntities);

    console.log('\n=== Quantity Comparison ===');
    console.log(`| Metric | Before Filter | After Filter | Reduction |`);
    console.log(`|--------|--------------|--------------|-----------|`);
    console.log(`| Area | ${beforeFilter.totalArea.toFixed(2)} m² | ${afterFilter.totalArea.toFixed(2)} m² | ${(100 - (afterFilter.totalArea / beforeFilter.totalArea) * 100).toFixed(1)}% |`);
    console.log(`| Length | ${beforeFilter.totalLength.toFixed(2)} m | ${afterFilter.totalLength.toFixed(2)} m | ${(100 - (afterFilter.totalLength / beforeFilter.totalLength) * 100).toFixed(1)}% |`);
    console.log(`| INSERTs | ${beforeFilter.insertCount} | ${afterFilter.insertCount} | ${(100 - (afterFilter.insertCount / beforeFilter.insertCount) * 100).toFixed(1)}% |`);

    // Expected from Excel
    const expectedTabiques = 62.38 + 30.58 + 29.76; // TAB 01 + 02 + 03
    const expectedCielos = 37.62 + 9.889;

    console.log('\n=== Expected vs Filtered ===');
    console.log(`Expected total tabiques (TAB 01-03): ${expectedTabiques.toFixed(2)} m²`);
    console.log(`Expected total cielos: ${expectedCielos.toFixed(2)} m²`);
    console.log(`\nFiltered area: ${afterFilter.totalArea.toFixed(2)} m²`);
    console.log(`Filtered length (× 2.4 for wall area): ${(afterFilter.totalLength * 2.4).toFixed(2)} m²`);
}

test();
