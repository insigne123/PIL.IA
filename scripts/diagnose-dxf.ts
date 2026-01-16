/**
 * DXF Diagnostic Script
 * Analyzes a DXF file and outputs layer statistics for debugging quantity issues
 * 
 * Run with: npx ts-node --project tsconfig.json scripts/diagnose-dxf.ts
 */

import * as fs from 'fs';
import DxfParser from 'dxf-parser';

const DXF_PATH = 'C:\\Users\\nicog\\Downloads\\wetransfer_lds-pak-licitacion-oocc_2026-01-08_0027\\PIL.IA\\LDS_PAK - (LC) (1).dxf';

interface LayerStats {
    name: string;
    entityCount: number;
    types: Record<string, number>;
    totalLength: number;  // Sum of all line/polyline lengths
    totalArea: number;    // Sum of all hatch/closed polyline areas
    blockCount: number;   // Count of INSERT entities
    textCount: number;    // Count of TEXT/MTEXT entities
}

// Calculate polygon area using Shoelace formula
function calculatePolygonArea(vertices: Array<{ x: number; y: number }>): number {
    if (vertices.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < vertices.length; i++) {
        const j = (i + 1) % vertices.length;
        area += vertices[i].x * vertices[j].y;
        area -= vertices[j].x * vertices[i].y;
    }
    return Math.abs(area) / 2;
}

// Calculate distance between two points
function distance(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
    return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
}

async function analyzeDxf() {
    console.log('=== DXF Diagnostic Tool ===\n');
    console.log(`Reading: ${DXF_PATH}\n`);

    // Read file
    let content: string;
    try {
        content = fs.readFileSync(DXF_PATH, 'utf-8');
    } catch (e) {
        // Try Latin-1
        const buffer = fs.readFileSync(DXF_PATH);
        content = buffer.toString('latin1');
    }

    // Parse DXF
    const parser = new DxfParser();
    const dxf = parser.parseSync(content);

    if (!dxf) {
        console.error('Failed to parse DXF');
        return;
    }

    // Get header info for units
    const header = dxf.header || {};
    console.log('=== DXF Header ===');
    console.log(`$INSUNITS: ${header.$INSUNITS || 'Not set'}`);
    console.log(`$MEASUREMENT: ${header.$MEASUREMENT || 'Not set'}`);
    console.log(`$LUNITS: ${header.$LUNITS || 'Not set'}`);

    // Calculate bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    const entities = dxf.entities || [];
    console.log(`\nTotal entities: ${entities.length}\n`);

    // Analyze by layer
    const layerStats = new Map<string, LayerStats>();

    for (const entity of entities) {
        const layer = (entity as any).layer || '0';

        if (!layerStats.has(layer)) {
            layerStats.set(layer, {
                name: layer,
                entityCount: 0,
                types: {},
                totalLength: 0,
                totalArea: 0,
                blockCount: 0,
                textCount: 0
            });
        }

        const stats = layerStats.get(layer)!;
        stats.entityCount++;
        stats.types[entity.type] = (stats.types[entity.type] || 0) + 1;

        // Calculate geometry
        if (entity.type === 'LINE') {
            const start = (entity as any).start;
            const end = (entity as any).end;
            if (start && end) {
                stats.totalLength += distance(start, end);
                minX = Math.min(minX, start.x, end.x);
                minY = Math.min(minY, start.y, end.y);
                maxX = Math.max(maxX, start.x, end.x);
                maxY = Math.max(maxY, start.y, end.y);
            }
        } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
            const vertices = (entity as any).vertices || [];
            const isClosed = (entity as any).shape || (entity as any).closed;

            // Calculate length
            for (let i = 0; i < vertices.length - 1; i++) {
                stats.totalLength += distance(vertices[i], vertices[i + 1]);
            }
            if (isClosed && vertices.length > 2) {
                stats.totalLength += distance(vertices[vertices.length - 1], vertices[0]);
                // Calculate area for closed polylines
                stats.totalArea += calculatePolygonArea(vertices);
            }

            // Update bbox
            for (const v of vertices) {
                minX = Math.min(minX, v.x);
                minY = Math.min(minY, v.y);
                maxX = Math.max(maxX, v.x);
                maxY = Math.max(maxY, v.y);
            }
        } else if (entity.type === 'HATCH') {
            const boundaries = (entity as any).boundaries || [];
            for (const boundary of boundaries) {
                if (boundary.vertices && boundary.vertices.length >= 3) {
                    stats.totalArea += calculatePolygonArea(boundary.vertices);
                }
            }
        } else if (entity.type === 'INSERT') {
            stats.blockCount++;
        } else if (entity.type === 'TEXT' || entity.type === 'MTEXT') {
            stats.textCount++;
        }
    }

    // Print bounding box
    const width = maxX - minX;
    const height = maxY - minY;
    const diagonal = Math.sqrt(width * width + height * height);

    console.log('=== Bounding Box (Raw Units) ===');
    console.log(`Min: (${minX.toFixed(2)}, ${minY.toFixed(2)})`);
    console.log(`Max: (${maxX.toFixed(2)}, ${maxY.toFixed(2)})`);
    console.log(`Width: ${width.toFixed(2)}, Height: ${height.toFixed(2)}`);
    console.log(`Diagonal: ${diagonal.toFixed(2)}`);

    // Estimate unit scale
    let unitScale = 1;
    let estimatedUnit = 'unknown';
    if (diagonal > 10000) {
        estimatedUnit = 'millimeters';
        unitScale = 0.001;
    } else if (diagonal > 100) {
        estimatedUnit = 'centimeters';
        unitScale = 0.01;
    } else {
        estimatedUnit = 'meters';
        unitScale = 1;
    }

    console.log(`\nEstimated Unit: ${estimatedUnit} (scale factor: ${unitScale})`);
    console.log(`Diagonal in meters: ${(diagonal * unitScale).toFixed(2)}m`);

    // Print layer statistics
    console.log('\n=== Layer Statistics ===');
    console.log('(Showing layers with area/length > 0)\n');

    // Sort by total area descending
    const sortedLayers = Array.from(layerStats.values())
        .filter(l => l.totalArea > 0 || l.totalLength > 0 || l.blockCount > 0)
        .sort((a, b) => b.totalArea - a.totalArea);

    // Target layers from the logs
    const targetLayers = ['fa_arq-muros', 'fa_tabiques', 'fa_0.15', 'a-arq-cielo falso', 'arq_nivel'];

    console.log('--- Target Layers (from error logs) ---');
    for (const targetName of targetLayers) {
        const layer = Array.from(layerStats.values()).find(l => l.name.toLowerCase() === targetName.toLowerCase());
        if (layer) {
            const areaM2 = layer.totalArea * unitScale * unitScale;
            const lengthM = layer.totalLength * unitScale;
            console.log(`\n[${layer.name}]`);
            console.log(`  Entities: ${layer.entityCount}`);
            console.log(`  Types: ${JSON.stringify(layer.types)}`);
            console.log(`  Total Area (raw): ${layer.totalArea.toFixed(2)} -> ${areaM2.toFixed(2)} m²`);
            console.log(`  Total Length (raw): ${layer.totalLength.toFixed(2)} -> ${lengthM.toFixed(2)} m`);
            console.log(`  Blocks: ${layer.blockCount}`);
        } else {
            console.log(`\n[${targetName}] - NOT FOUND`);
        }
    }

    console.log('\n--- All Layers with Geometry ---');
    for (const layer of sortedLayers.slice(0, 30)) {
        const areaM2 = layer.totalArea * unitScale * unitScale;
        const lengthM = layer.totalLength * unitScale;
        console.log(`\n[${layer.name}]`);
        console.log(`  Entities: ${layer.entityCount}, Types: ${JSON.stringify(layer.types)}`);
        if (areaM2 > 0.01) console.log(`  Area: ${areaM2.toFixed(2)} m²`);
        if (lengthM > 0.1) console.log(`  Length: ${lengthM.toFixed(2)} m`);
        if (layer.blockCount > 0) console.log(`  Blocks: ${layer.blockCount}`);
    }

    // Summary for debugging
    console.log('\n=== Expected vs Available ===');
    console.log('From Excel validation:');
    console.log('  - TAB 01: sobretabique simple sala de ventas = 62.38 m²');
    console.log('  - TAB 02: sobretabique simple bodega = 30.58 m²');
    console.log('  - Cielo volcanita sala de ventas = 37.62 m²');
    console.log('  - Mortero nivelador = 46.87 m²');
    console.log('\nLook for layers above with similar area values...');
}

analyzeDxf().catch(console.error);
