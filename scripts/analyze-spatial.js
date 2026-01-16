/**
 * Analyze DXF spatial distribution to find main plan bounding box
 * This will help filter out cortes/elevaciones
 */

const fs = require('fs');
const DxfParser = require('dxf-parser');

const DXF_PATH = 'C:\\Users\\nicog\\Downloads\\wetransfer_lds-pak-licitacion-oocc_2026-01-08_0027\\PIL.IA\\LDS_PAK - (LC) (1).dxf';
const UNIT_SCALE = 0.001; // mm to m

function getEntityBounds(entity) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    if (entity.type === 'LINE') {
        if (entity.start) { minX = Math.min(minX, entity.start.x); minY = Math.min(minY, entity.start.y); maxX = Math.max(maxX, entity.start.x); maxY = Math.max(maxY, entity.start.y); }
        if (entity.end) { minX = Math.min(minX, entity.end.x); minY = Math.min(minY, entity.end.y); maxX = Math.max(maxX, entity.end.x); maxY = Math.max(maxY, entity.end.y); }
    } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
        for (const v of (entity.vertices || [])) {
            minX = Math.min(minX, v.x); minY = Math.min(minY, v.y);
            maxX = Math.max(maxX, v.x); maxY = Math.max(maxY, v.y);
        }
    } else if (entity.type === 'INSERT') {
        const pos = entity.position || { x: 0, y: 0 };
        minX = minY = pos.x; maxX = maxY = pos.y;
        return { minX: pos.x, minY: pos.y, maxX: pos.x, maxY: pos.y, cx: pos.x, cy: pos.y };
    } else if (entity.type === 'TEXT' || entity.type === 'MTEXT') {
        const pos = entity.position || entity.insertionPoint || { x: 0, y: 0 };
        return { minX: pos.x, minY: pos.y, maxX: pos.x, maxY: pos.y, cx: pos.x, cy: pos.y };
    }

    if (minX === Infinity) return null;
    return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

function analyze() {
    let content;
    try {
        content = fs.readFileSync(DXF_PATH, 'utf-8');
    } catch (e) {
        content = fs.readFileSync(DXF_PATH).toString('latin1');
    }

    const parser = new DxfParser();
    const dxf = parser.parseSync(content);
    const entities = dxf.entities || [];

    console.log('=== Spatial Distribution Analysis ===\n');

    // Collect all entity centers
    const points = [];
    for (const entity of entities) {
        const bounds = getEntityBounds(entity);
        if (bounds) {
            points.push({ x: bounds.cx, y: bounds.cy, layer: entity.layer || '0', type: entity.type });
        }
    }

    console.log(`Total entities with position: ${points.length}`);

    // Find global bounds
    let gMinX = Infinity, gMinY = Infinity, gMaxX = -Infinity, gMaxY = -Infinity;
    for (const p of points) {
        gMinX = Math.min(gMinX, p.x); gMinY = Math.min(gMinY, p.y);
        gMaxX = Math.max(gMaxX, p.x); gMaxY = Math.max(gMaxY, p.y);
    }

    console.log(`\nGlobal Bounds (mm):`);
    console.log(`  X: ${gMinX.toFixed(0)} to ${gMaxX.toFixed(0)} (width: ${(gMaxX - gMinX).toFixed(0)})`);
    console.log(`  Y: ${gMinY.toFixed(0)} to ${gMaxY.toFixed(0)} (height: ${(gMaxY - gMinY).toFixed(0)})`);
    console.log(`\nGlobal Bounds (m):`);
    console.log(`  X: ${(gMinX * UNIT_SCALE).toFixed(2)} to ${(gMaxX * UNIT_SCALE).toFixed(2)} m`);
    console.log(`  Y: ${(gMinY * UNIT_SCALE).toFixed(2)} to ${(gMaxY * UNIT_SCALE).toFixed(2)} m`);

    // Cluster analysis - divide Y axis into zones
    const yBins = {};
    const binSize = 10000; // 10m bins

    for (const p of points) {
        const bin = Math.floor(p.y / binSize) * binSize;
        yBins[bin] = (yBins[bin] || 0) + 1;
    }

    console.log('\n=== Y-Axis Distribution (entity count per 10m zone) ===');
    const sortedBins = Object.entries(yBins).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));

    let maxCount = 0;
    let mainZone = null;

    for (const [bin, count] of sortedBins) {
        const yStart = parseFloat(bin) * UNIT_SCALE;
        const yEnd = (parseFloat(bin) + binSize) * UNIT_SCALE;
        const bar = '█'.repeat(Math.min(50, Math.floor(count / 20)));
        console.log(`  Y ${yStart.toFixed(0)}m to ${yEnd.toFixed(0)}m: ${count} entities ${bar}`);

        if (count > maxCount) {
            maxCount = count;
            mainZone = parseFloat(bin);
        }
    }

    // Identify main plan zone (likely largest cluster)
    console.log(`\n=== Detected Main Plan Zone ===`);
    console.log(`  Y range: ${(mainZone * UNIT_SCALE).toFixed(0)}m to ${((mainZone + binSize) * UNIT_SCALE).toFixed(0)}m`);

    // Analyze layers in main zone vs other zones
    const mainZoneEntities = points.filter(p => p.y >= mainZone && p.y < mainZone + binSize * 3);
    const otherZoneEntities = points.filter(p => !(p.y >= mainZone && p.y < mainZone + binSize * 3));

    console.log(`\n=== Zone Comparison ===`);
    console.log(`  Main plan zone: ${mainZoneEntities.length} entities`);
    console.log(`  Other zones (cortes/elevaciones): ${otherZoneEntities.length} entities`);

    // Layer distribution in main zone
    const mainZoneLayers = {};
    for (const p of mainZoneEntities) {
        mainZoneLayers[p.layer] = (mainZoneLayers[p.layer] || 0) + 1;
    }

    console.log('\n=== Layers in Main Plan Zone (top 15) ===');
    const sortedLayers = Object.entries(mainZoneLayers).sort((a, b) => b[1] - a[1]).slice(0, 15);
    for (const [layer, count] of sortedLayers) {
        console.log(`  ${layer}: ${count}`);
    }

    // Save recommended filter bounds
    const recommendation = {
        mainPlanBounds: {
            yMin: mainZone,
            yMax: mainZone + binSize * 3,
            yMinM: mainZone * UNIT_SCALE,
            yMaxM: (mainZone + binSize * 3) * UNIT_SCALE
        },
        entityCounts: {
            mainPlan: mainZoneEntities.length,
            cortes: otherZoneEntities.length
        }
    };

    fs.writeFileSync('scripts/spatial-recommendation.json', JSON.stringify(recommendation, null, 2));
    console.log('\nRecommendation saved to scripts/spatial-recommendation.json');
}

analyze();
