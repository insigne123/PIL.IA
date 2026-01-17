
import { explodeBlocksForMetrics, aggregateExplodedToItems } from '../src/lib/processing/block-exploder';
import { ItemDetectado } from '../src/types';
import fs from 'fs';

// Helper for file logging
const lines: string[] = [];
const log = (msg: string) => {
    console.log(msg);
    lines.push(msg);
};
const error = (msg: string) => {
    console.error(msg);
    lines.push(msg);
};

// Mock mocks
const mockDxf = {
    blocks: {
        'TEST_BLOCK': {
            entities: [
                {
                    type: 'LWPOLYLINE',
                    layer: '0', // Should inherit
                    closed: true,
                    vertices: [
                        { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 } // 100m2
                    ]
                },
                {
                    type: 'LWPOLYLINE',
                    layer: 'FIXED_LAYER', // Should stay FIXED_LAYER but also aggregate to parent
                    closed: true,
                    vertices: [
                        { x: 20, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }, { x: 20, y: 10 } // 100m2
                    ]
                }
            ]
        }
    },
    tables: {
        layer: {
            handle: 'layerTable'
        }
    }
} as any;

const mockEntities = [
    {
        type: 'INSERT',
        name: 'TEST_BLOCK',
        layer: 'PARENT_LAYER',
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        rotation: 0
    }
];

// Mock metric converters
const toMeters = (v: number) => v;
const toMetersSquared = (v: number) => v;

log('--- Debugging Block Explosion ---');
const exploded = explodeBlocksForMetrics(mockEntities, mockDxf, toMeters, toMetersSquared);

log('--- Exploded Areas ---');
exploded.areas.forEach(a => {
    log(`Layer: ${a.layer} | Root: ${a.rootInsertLayer} | Area: ${a.area_m2}`);
});

log('\n--- Aggregated Items ---');
const items = aggregateExplodedToItems(exploded);
items.forEach(i => {
    log(`[${i.type}] Name: "${i.name_raw}" | Layer: ${i.layer_raw} | Value: ${i.value_si}`);
});

log('\n--- Verification ---');
// Expectation 1: "0" layer entity should be on PARENT_LAYER
const parentLayerItem = items.find(i => i.layer_raw === 'PARENT_LAYER' && i.type === 'area' && !i.name_raw.startsWith('Block Geometry'));
if (parentLayerItem && parentLayerItem.value_si >= 100) {
    log(`PASS: Found aggregated area on PARENT_LAYER: ${parentLayerItem.value_si}`);
} else {
    error(`FAIL: Missing or incorrect area on PARENT_LAYER`);
}

// Expectation 2: FIXED_LAYER entity should produce an item on FIXED_LAYER
const fixedLayerItem = items.find(i => i.layer_raw === 'FIXED_LAYER' && i.type === 'area');
if (fixedLayerItem) {
    log(`PASS: Found preserved area on FIXED_LAYER: ${fixedLayerItem.value_si}`);
} else {
    error(`FAIL: Missing area on FIXED_LAYER`);
}

// Expectation 3: "Block Geometry Area" on PARENT_LAYER should exist and match SUM (200)
// This proves we are capturing the full content of the block associated with the Insert
const blockGeomItem = items.find(i => i.name_raw.startsWith('Block Geometry Area') && i.layer_raw === 'PARENT_LAYER');

if (blockGeomItem) {
    if (blockGeomItem.value_si >= 200) {
        log(`PASS: Found Block Geometry Aggregation item on PARENT_LAYER: ${blockGeomItem.value_si}`);
    } else {
        error(`FAIL: Found Block Geometry item but value wrong: ${blockGeomItem.value_si} (Expected 200)`);
    }
} else {
    error(`FAIL: Block Geometry Aggregation item missing on PARENT_LAYER`);
}

fs.writeFileSync('debug-block-output.txt', lines.join('\n'));
