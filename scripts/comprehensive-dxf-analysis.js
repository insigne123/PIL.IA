/**
 * Comprehensive DXF Analysis for Excel Mapping
 * 
 * This script analyzes the DXF file to:
 * 1. List all blocks with their internal geometry
 * 2. Find text labels near geometry (TAB 01, TAB 02, etc.)
 * 3. Map geometry to Excel items
 * 4. Generate comparison report
 */

const fs = require('fs');
const DxfParser = require('dxf-parser');

const DXF_PATH = 'C:\\Users\\nicog\\Downloads\\wetransfer_lds-pak-licitacion-oocc_2026-01-08_0027\\PIL.IA\\LDS_PAK - (LC) (1).dxf';
const UNIT_SCALE = 0.001; // mm to m
const UNIT_SCALE_SQ = UNIT_SCALE * UNIT_SCALE;

// Expected values from Excel
const EXCEL_ITEMS = [
    { id: 'TAB_01', desc: 'TAB 01: sobretabique simple sala de ventas', unit: 'm2', expected: 62.38 },
    { id: 'TAB_02', desc: 'TAB 02: sobretabique simple bodega', unit: 'm2', expected: 30.58 },
    { id: 'TAB_03', desc: 'TAB 03: tabique simple divisorio y bodega', unit: 'm2', expected: 29.76 },
    { id: 'CIELO_SALA', desc: 'Cielo volcanita sala de ventas', unit: 'm2', expected: 37.62 },
    { id: 'CIELO_BODEGA', desc: 'Cielo volcanita bodega', unit: 'm2', expected: 9.889 },
    { id: 'MORTERO', desc: 'Mortero nivelador', unit: 'm2', expected: 46.87 },
    { id: 'EMPASTE', desc: 'Empaste y huincha de todos los tabiques', unit: 'm2', expected: 135.58 },
];

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

function analyzeBlock(block) {
    const entities = block.entities || [];
    let totalArea = 0;
    let totalLength = 0;
    let closedPolygons = 0;
    let openPolylines = 0;
    let lines = 0;
    let texts = [];

    for (const entity of entities) {
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
                const area = calculatePolygonArea(vertices);
                totalArea += area;
                closedPolygons++;
            } else {
                openPolylines++;
            }
            totalLength += length;
        } else if (entity.type === 'LINE') {
            totalLength += distance(entity.start, entity.end);
            lines++;
        } else if (entity.type === 'TEXT' || entity.type === 'MTEXT') {
            const text = entity.text || entity.string || '';
            if (text.trim()) texts.push(text.trim());
        } else if (entity.type === 'HATCH') {
            const boundaries = entity.boundaries || [];
            for (const boundary of boundaries) {
                if (boundary.vertices && boundary.vertices.length >= 3) {
                    totalArea += calculatePolygonArea(boundary.vertices);
                }
            }
        }
    }

    return {
        name: block.name,
        layer: block.layer || '0',
        entityCount: entities.length,
        areaM2: totalArea * UNIT_SCALE_SQ,
        lengthM: totalLength * UNIT_SCALE,
        wallAreaM2: totalLength * UNIT_SCALE * 2.4,
        closedPolygons,
        openPolylines,
        lines,
        texts
    };
}

function findNearbyTexts(point, allTexts, maxDistance = 5000) { // 5m in mm
    const nearby = [];
    for (const text of allTexts) {
        const dist = distance(point, text.position);
        if (dist < maxDistance) {
            nearby.push({ text: text.content, distance: dist * UNIT_SCALE });
        }
    }
    return nearby.sort((a, b) => a.distance - b.distance);
}

function analyze() {
    console.log('=== Comprehensive DXF Analysis ===\n');

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
    const entities = dxf.entities || [];

    // ========================
    // PHASE 1: Extract all texts
    // ========================
    console.log('=== PHASE 1: Text Analysis ===\n');

    const allTexts = [];
    const relevantKeywords = ['TAB', 'CIELO', 'MURO', 'TABIQUE', 'PISO', 'PAVIMENTO', 'VOLCANITA', 'MORTERO', 'EMPASTE'];

    for (const entity of entities) {
        if (entity.type === 'TEXT' || entity.type === 'MTEXT') {
            const text = entity.text || entity.string || '';
            const position = entity.position || entity.insertionPoint || { x: 0, y: 0 };
            if (text.trim()) {
                allTexts.push({
                    content: text.trim().substring(0, 50),
                    layer: entity.layer || '0',
                    position
                });
            }
        }
    }

    console.log(`Total texts in ModelSpace: ${allTexts.length}`);

    // Find relevant texts
    const relevantTexts = allTexts.filter(t =>
        relevantKeywords.some(k => t.content.toUpperCase().includes(k))
    );

    console.log(`\nRelevant texts found (${relevantTexts.length}):`);
    for (const t of relevantTexts.slice(0, 30)) {
        console.log(`  "${t.content}" on layer "${t.layer}"`);
    }

    // ========================
    // PHASE 2: Block Analysis
    // ========================
    console.log('\n=== PHASE 2: Block Definitions ===\n');

    const blockAnalysis = [];
    for (const [name, block] of Object.entries(blocks)) {
        if (name.startsWith('*MODEL') || name.startsWith('*PAPER')) continue;

        const analysis = analyzeBlock(block);
        if (analysis.areaM2 > 0.1 || analysis.lengthM > 1) {
            blockAnalysis.push(analysis);
        }
    }

    // Sort by area
    blockAnalysis.sort((a, b) => b.areaM2 - a.areaM2);

    console.log('Top 20 Blocks by Area:');
    for (const b of blockAnalysis.slice(0, 20)) {
        console.log(`  [${b.name}]`);
        console.log(`    Area: ${b.areaM2.toFixed(2)} m², Length: ${b.lengthM.toFixed(2)} m, WallArea: ${b.wallAreaM2.toFixed(2)} m²`);
        if (b.texts.length > 0) {
            console.log(`    Texts inside: ${b.texts.slice(0, 5).join(', ')}`);
        }
    }

    // ========================
    // PHASE 3: Layer Summary
    // ========================
    console.log('\n=== PHASE 3: Layer Geometry Summary ===\n');

    const layerSummary = new Map();

    for (const entity of entities) {
        const layer = entity.layer || '0';
        if (!layerSummary.has(layer)) {
            layerSummary.set(layer, { area: 0, length: 0, blocks: new Map(), texts: [] });
        }
        const summary = layerSummary.get(layer);

        if (entity.type === 'INSERT') {
            const blockName = entity.name;
            summary.blocks.set(blockName, (summary.blocks.get(blockName) || 0) + 1);
        } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
            const vertices = entity.vertices || [];
            const isClosed = entity.shape || entity.closed;

            if (isClosed && vertices.length >= 3) {
                summary.area += calculatePolygonArea(vertices) * UNIT_SCALE_SQ;
            }

            let len = 0;
            for (let i = 0; i < vertices.length - 1; i++) {
                len += distance(vertices[i], vertices[i + 1]);
            }
            if (isClosed && vertices.length > 2) {
                len += distance(vertices[vertices.length - 1], vertices[0]);
            }
            summary.length += len * UNIT_SCALE;
        } else if (entity.type === 'HATCH') {
            const boundaries = entity.boundaries || [];
            for (const boundary of boundaries) {
                if (boundary.vertices) {
                    summary.area += calculatePolygonArea(boundary.vertices) * UNIT_SCALE_SQ;
                }
            }
        }
    }

    // Print relevant layers
    const relevantLayers = ['FA_ARQ-MUROS', 'FA_TABIQUES', 'A-ARQ-CIELO FALSO', 'FA_0.15', 'ARQ_NIVEL', 'MB-ELEV 2', 'FA_CORTES'];

    for (const layerName of relevantLayers) {
        const layerKey = Array.from(layerSummary.keys()).find(k => k.toLowerCase() === layerName.toLowerCase());
        if (layerKey) {
            const summary = layerSummary.get(layerKey);
            console.log(`[${layerKey}]`);
            console.log(`  Direct Area: ${summary.area.toFixed(2)} m²`);
            console.log(`  Direct Length: ${summary.length.toFixed(2)} m`);
            console.log(`  Wall Area (L×2.4): ${(summary.length * 2.4).toFixed(2)} m²`);
            console.log(`  Blocks used:`);
            for (const [blockName, count] of summary.blocks) {
                const blockDef = blockAnalysis.find(b => b.name === blockName);
                if (blockDef) {
                    console.log(`    - ${blockName} × ${count}: Area=${(blockDef.areaM2 * count).toFixed(2)} m², WallArea=${(blockDef.wallAreaM2 * count).toFixed(2)} m²`);
                }
            }
            console.log('');
        }
    }

    // ========================
    // PHASE 4: Excel Item Matching
    // ========================
    console.log('\n=== PHASE 4: Excel Item Matching ===\n');

    // Try to find best match for each Excel item
    for (const item of EXCEL_ITEMS) {
        console.log(`[${item.id}] ${item.desc}`);
        console.log(`  Expected: ${item.expected} m²`);

        // Search for matching blocks
        const matchingBlocks = blockAnalysis.filter(b => {
            const nameLower = b.name.toLowerCase();
            const descLower = item.desc.toLowerCase();
            return descLower.split(' ').some(word =>
                word.length > 3 && nameLower.includes(word)
            );
        });

        // Search for area values close to expected
        const closeBlocks = blockAnalysis.filter(b => {
            return Math.abs(b.areaM2 - item.expected) < item.expected * 0.2 ||
                Math.abs(b.wallAreaM2 - item.expected) < item.expected * 0.2;
        });

        if (matchingBlocks.length > 0) {
            console.log(`  Name matches:`);
            for (const b of matchingBlocks.slice(0, 3)) {
                console.log(`    - ${b.name}: ${b.areaM2.toFixed(2)} m² / ${b.wallAreaM2.toFixed(2)} m² (wall)`);
            }
        }

        if (closeBlocks.length > 0) {
            console.log(`  Value matches (~${item.expected} m²):`);
            for (const b of closeBlocks.slice(0, 3)) {
                const areaDiff = Math.abs(b.areaM2 - item.expected);
                const wallDiff = Math.abs(b.wallAreaM2 - item.expected);
                if (areaDiff < wallDiff) {
                    console.log(`    - ${b.name}: ${b.areaM2.toFixed(2)} m² (diff: ${areaDiff.toFixed(2)})`);
                } else {
                    console.log(`    - ${b.name}: ${b.wallAreaM2.toFixed(2)} m² wall (diff: ${wallDiff.toFixed(2)})`);
                }
            }
        }

        console.log('');
    }

    // ========================
    // PHASE 5: Summary Report
    // ========================
    console.log('\n=== PHASE 5: Summary Report ===\n');

    // Sum all tabique/muro related geometry
    let totalTabiqueArea = 0;
    let totalTabiqueWallArea = 0;
    let totalCieloArea = 0;

    for (const b of blockAnalysis) {
        const nameLower = b.name.toLowerCase();
        if (nameLower.includes('muro') || nameLower.includes('tabique') || nameLower.includes('rab')) {
            totalTabiqueArea += b.areaM2;
            totalTabiqueWallArea += b.wallAreaM2;
        }
        if (nameLower.includes('cielo')) {
            totalCieloArea += b.areaM2;
        }
    }

    console.log('Aggregated Values:');
    console.log(`  Total Tabique/Muro Area: ${totalTabiqueArea.toFixed(2)} m²`);
    console.log(`  Total Tabique/Muro Wall Area: ${totalTabiqueWallArea.toFixed(2)} m²`);
    console.log(`  Total Cielo Area: ${totalCieloArea.toFixed(2)} m²`);

    const expectedTabiques = 62.38 + 30.58 + 29.76; // TAB 01 + TAB 02 + TAB 03
    const expectedCielos = 37.62 + 9.889; // Cielo sala + bodega

    console.log(`\nExpected from Excel:`);
    console.log(`  TAB 01 + TAB 02 + TAB 03 = ${expectedTabiques.toFixed(2)} m²`);
    console.log(`  Cielo sala + bodega = ${expectedCielos.toFixed(2)} m²`);

    console.log(`\nMatch Analysis:`);
    console.log(`  Tabiques: DXF=${totalTabiqueWallArea.toFixed(2)} vs Excel=${expectedTabiques.toFixed(2)} (diff: ${(totalTabiqueWallArea - expectedTabiques).toFixed(2)})`);
    console.log(`  Cielos: DXF=${totalCieloArea.toFixed(2)} vs Excel=${expectedCielos.toFixed(2)} (diff: ${(totalCieloArea - expectedCielos).toFixed(2)})`);

    // Save detailed JSON report
    const report = {
        blocks: blockAnalysis.slice(0, 30),
        relevantTexts: relevantTexts.slice(0, 50),
        layerSummary: Object.fromEntries(
            Array.from(layerSummary.entries()).map(([k, v]) => [k, {
                area: v.area,
                length: v.length,
                wallArea: v.length * 2.4,
                blocks: Object.fromEntries(v.blocks)
            }])
        ),
        excelComparison: EXCEL_ITEMS,
        totals: {
            tabiqueWallArea: totalTabiqueWallArea,
            cieloArea: totalCieloArea,
            expectedTabiques,
            expectedCielos
        }
    };

    fs.writeFileSync('scripts/comprehensive-analysis.json', JSON.stringify(report, null, 2));
    console.log('\nDetailed report saved to scripts/comprehensive-analysis.json');
}

analyze();
