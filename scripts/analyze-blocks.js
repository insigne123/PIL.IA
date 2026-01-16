/**
 * DXF Deep Block Analysis
 * Explores block definitions to find hidden geometry
 */

const fs = require('fs');
const DxfParser = require('dxf-parser');

const DXF_PATH = 'C:\\Users\\nicog\\Downloads\\wetransfer_lds-pak-licitacion-oocc_2026-01-08_0027\\PIL.IA\\LDS_PAK - (LC) (1).dxf';

function calculatePolygonArea(vertices) {
    if (!vertices || vertices.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < vertices.length; i++) {
        const j = (i + 1) % vertices.length;
        if (vertices[i] && vertices[j]) {
            area += (vertices[i].x || 0) * (vertices[j].y || 0);
            area -= (vertices[j].x || 0) * (vertices[i].y || 0);
        }
    }
    return Math.abs(area) / 2;
}

function distance(p1, p2) {
    if (!p1 || !p2) return 0;
    return Math.sqrt(Math.pow((p2.x || 0) - (p1.x || 0), 2) + Math.pow((p2.y || 0) - (p1.y || 0), 2));
}

function analyzeBlockDefinition(block, unitScale) {
    const entities = block.entities || [];
    let totalLength = 0;
    let totalArea = 0;
    const types = {};

    for (const entity of entities) {
        types[entity.type] = (types[entity.type] || 0) + 1;

        if (entity.type === 'LINE') {
            totalLength += distance(entity.start, entity.end);
        } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
            const vertices = entity.vertices || [];
            const isClosed = entity.shape || entity.closed;

            for (let i = 0; i < vertices.length - 1; i++) {
                totalLength += distance(vertices[i], vertices[i + 1]);
            }
            if (isClosed && vertices.length > 2) {
                totalLength += distance(vertices[vertices.length - 1], vertices[0]);
                totalArea += calculatePolygonArea(vertices);
            }
        } else if (entity.type === 'HATCH') {
            const boundaries = entity.boundaries || [];
            for (const boundary of boundaries) {
                if (boundary.vertices) {
                    totalArea += calculatePolygonArea(boundary.vertices);
                }
            }
        }
    }

    return {
        name: block.name,
        layer: block.layer || '0',
        entityCount: entities.length,
        types,
        rawLength: totalLength,
        lengthM: totalLength * unitScale,
        rawArea: totalArea,
        areaM2: totalArea * unitScale * unitScale,
        wallAreaM2: totalLength * unitScale * 2.4
    };
}

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
        console.log(JSON.stringify({ error: 'Failed to parse DXF' }));
        return;
    }

    const header = dxf.header || {};
    const unitScale = 0.001; // mm to m

    // Analyze block definitions
    const blocks = dxf.blocks || {};
    const blockAnalysis = [];

    console.log('=== Block Definitions Analysis ===\n');

    for (const [blockName, block] of Object.entries(blocks)) {
        // Skip model space and paper space
        if (blockName.startsWith('*') && (blockName.includes('MODEL') || blockName.includes('PAPER'))) {
            continue;
        }

        const analysis = analyzeBlockDefinition(block, unitScale);

        // Only include blocks with actual geometry
        if (analysis.entityCount > 0 && (analysis.lengthM > 0.1 || analysis.areaM2 > 0.01)) {
            blockAnalysis.push(analysis);
        }
    }

    // Sort by area, then length
    blockAnalysis.sort((a, b) => (b.areaM2 + b.wallAreaM2) - (a.areaM2 + a.wallAreaM2));

    // Count INSERT usage
    const entities = dxf.entities || [];
    const insertCounts = {};
    const insertsByLayer = {};

    for (const entity of entities) {
        if (entity.type === 'INSERT') {
            const name = entity.name;
            const layer = entity.layer || '0';
            insertCounts[name] = (insertCounts[name] || 0) + 1;

            if (!insertsByLayer[layer]) insertsByLayer[layer] = {};
            insertsByLayer[layer][name] = (insertsByLayer[layer][name] || 0) + 1;
        }
    }

    // Print top blocks by geometry
    console.log('=== Top 20 Blocks with Geometry ===\n');
    for (const block of blockAnalysis.slice(0, 20)) {
        const usageCount = insertCounts[block.name] || 0;
        console.log(`[${block.name}]`);
        console.log(`  Layer: ${block.layer}`);
        console.log(`  Entities: ${block.entityCount} (${JSON.stringify(block.types)})`);
        console.log(`  Length: ${block.lengthM.toFixed(2)} m`);
        console.log(`  Area: ${block.areaM2.toFixed(2)} m²`);
        console.log(`  Wall Area (L*2.4): ${block.wallAreaM2.toFixed(2)} m²`);
        console.log(`  Used in drawing: ${usageCount} times`);
        if (usageCount > 0) {
            console.log(`  => Total Wall Area: ${(block.wallAreaM2 * usageCount).toFixed(2)} m²`);
            console.log(`  => Total Area: ${(block.areaM2 * usageCount).toFixed(2)} m²`);
        }
        console.log('');
    }

    // INSERTs by layer
    console.log('\n=== Block Usage by Layer ===\n');
    const targetLayers = ['FA_ARQ-MUROS', 'FA_TABIQUES', 'A-ARQ-CIELO FALSO', 'FA_0.15', 'ARQ_NIVEL'];

    for (const layerName of targetLayers) {
        const layerKey = Object.keys(insertsByLayer).find(k => k.toLowerCase() === layerName.toLowerCase());
        if (layerKey && insertsByLayer[layerKey]) {
            console.log(`\n[${layerKey}]`);
            for (const [blockName, count] of Object.entries(insertsByLayer[layerKey])) {
                const blockDef = blockAnalysis.find(b => b.name === blockName);
                if (blockDef) {
                    console.log(`  ${blockName}: ${count}x`);
                    console.log(`    -> Total Length: ${(blockDef.lengthM * count).toFixed(2)} m`);
                    console.log(`    -> Total Wall Area: ${(blockDef.wallAreaM2 * count).toFixed(2)} m²`);
                    console.log(`    -> Total Area: ${(blockDef.areaM2 * count).toFixed(2)} m²`);
                }
            }
        }
    }

    // Search for blocks that could match expected values
    console.log('\n=== Matching Expected Values ===\n');
    const expected = [
        { name: 'TAB 01 (62.38 m²)', target: 62.38 },
        { name: 'TAB 02 (30.58 m²)', target: 30.58 },
        { name: 'TAB 03 (29.76 m²)', target: 29.76 },
        { name: 'Cielo sala (37.62 m²)', target: 37.62 },
        { name: 'Mortero (46.87 m²)', target: 46.87 }
    ];

    for (const exp of expected) {
        console.log(`\nSearching for ~${exp.target} m²:`);

        // Check direct area matches
        const areaMatches = blockAnalysis.filter(b =>
            Math.abs(b.areaM2 - exp.target) < 5 ||
            Math.abs(b.wallAreaM2 - exp.target) < 10
        );

        for (const match of areaMatches.slice(0, 3)) {
            console.log(`  Block "${match.name}": Area=${match.areaM2.toFixed(2)} m², WallArea=${match.wallAreaM2.toFixed(2)} m²`);
        }

        // Check multiplied values (block * count)
        for (const block of blockAnalysis) {
            const count = insertCounts[block.name] || 0;
            if (count > 0) {
                const totalArea = block.areaM2 * count;
                const totalWall = block.wallAreaM2 * count;
                if (Math.abs(totalArea - exp.target) < 5 || Math.abs(totalWall - exp.target) < 10) {
                    console.log(`  Block "${block.name}" x${count}: TotalArea=${totalArea.toFixed(2)} m², TotalWall=${totalWall.toFixed(2)} m²`);
                }
            }
        }
    }

    // Save detailed JSON
    const result = {
        blockDefinitions: blockAnalysis.slice(0, 30),
        insertCounts,
        insertsByLayer
    };
    fs.writeFileSync('scripts/block-analysis.json', JSON.stringify(result, null, 2));
    console.log('\nDetailed analysis saved to scripts/block-analysis.json');
}

analyzeDxf();
