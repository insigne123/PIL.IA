/**
 * DXF Diagnostic Script v3 - JSON Output
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
    const dx = (p2.x || 0) - (p1.x || 0);
    const dy = (p2.y || 0) - (p1.y || 0);
    return Math.sqrt(dx * dx + dy * dy);
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
        fs.writeFileSync('scripts/analysis.json', JSON.stringify({ error: 'Failed to parse DXF' }));
        return;
    }

    const header = dxf.header || {};

    // $INSUNITS: 4=mm, 5=cm, 6=m
    let unitScale = 0.001; // Default mm
    let unitName = 'mm';
    if (header.$INSUNITS === 5) { unitScale = 0.01; unitName = 'cm'; }
    if (header.$INSUNITS === 6) { unitScale = 1; unitName = 'm'; }

    const entities = dxf.entities || [];
    const layerStats = new Map();

    for (const entity of entities) {
        const layer = entity.layer || '0';

        if (!layerStats.has(layer)) {
            layerStats.set(layer, {
                name: layer,
                entityCount: 0,
                types: {},
                totalLength: 0,
                totalArea: 0,
                blockCount: 0
            });
        }

        const stats = layerStats.get(layer);
        stats.entityCount++;
        stats.types[entity.type] = (stats.types[entity.type] || 0) + 1;

        if (entity.type === 'LINE') {
            stats.totalLength += distance(entity.start, entity.end);
        } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
            const vertices = entity.vertices || [];
            const isClosed = entity.shape || entity.closed;

            for (let i = 0; i < vertices.length - 1; i++) {
                stats.totalLength += distance(vertices[i], vertices[i + 1]);
            }
            if (isClosed && vertices.length > 2) {
                stats.totalLength += distance(vertices[vertices.length - 1], vertices[0]);
                stats.totalArea += calculatePolygonArea(vertices);
            }
        } else if (entity.type === 'HATCH') {
            const boundaries = entity.boundaries || [];
            for (const boundary of boundaries) {
                if (boundary.vertices) {
                    stats.totalArea += calculatePolygonArea(boundary.vertices);
                }
            }
        } else if (entity.type === 'INSERT') {
            stats.blockCount++;
        }
    }

    // Prepare output
    const targetLayers = ['fa_arq-muros', 'fa_tabiques', 'fa_0.15', 'a-arq-cielo falso', 'arq_nivel'];

    const targetLayerAnalysis = targetLayers.map(targetName => {
        const layer = Array.from(layerStats.values()).find(l =>
            l.name.toLowerCase() === targetName.toLowerCase()
        );
        if (layer) {
            const areaM2 = layer.totalArea * unitScale * unitScale;
            const lengthM = layer.totalLength * unitScale;
            return {
                name: layer.name,
                found: true,
                entities: layer.entityCount,
                types: layer.types,
                rawArea: layer.totalArea,
                areaM2: Math.round(areaM2 * 100) / 100,
                rawLength: layer.totalLength,
                lengthM: Math.round(lengthM * 100) / 100,
                wallAreaFromLength: Math.round(lengthM * 2.4 * 100) / 100,
                blocks: layer.blockCount
            };
        }
        return { name: targetName, found: false };
    });

    const topByArea = Array.from(layerStats.values())
        .filter(l => l.totalArea > 0)
        .sort((a, b) => b.totalArea - a.totalArea)
        .slice(0, 20)
        .map(l => ({
            name: l.name,
            areaM2: Math.round(l.totalArea * unitScale * unitScale * 100) / 100,
            entities: l.entityCount
        }));

    const topByLength = Array.from(layerStats.values())
        .filter(l => l.totalLength > 0)
        .sort((a, b) => b.totalLength - a.totalLength)
        .slice(0, 20)
        .map(l => ({
            name: l.name,
            lengthM: Math.round(l.totalLength * unitScale * 100) / 100,
            wallAreaM2: Math.round(l.totalLength * unitScale * 2.4 * 100) / 100,
            entities: l.entityCount
        }));

    const result = {
        header: {
            insunits: header.$INSUNITS,
            measurement: header.$MEASUREMENT,
            interpretedUnit: unitName,
            scaleFactor: unitScale
        },
        totalEntities: entities.length,
        targetLayers: targetLayerAnalysis,
        topLayersByArea: topByArea,
        topLayersByLength: topByLength,
        expectedFromExcel: {
            'TAB 01': 62.38,
            'TAB 02': 30.58,
            'TAB 03': 29.76,
            'Cielo sala ventas': 37.62,
            'Cielo bodega': 9.89,
            'Mortero nivelador': 46.87
        }
    };

    fs.writeFileSync('scripts/analysis.json', JSON.stringify(result, null, 2));
    console.log('Analysis written to scripts/analysis.json');
}

analyzeDxf();
