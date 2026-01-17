
import { extractQuantities, checkGeometryServiceHealth, parseDxfFull } from '../src/lib/processing/geometry-service';
import fs from 'fs';
import path from 'path';

// Mock Fetch for Node environment if needed, but tsx handles it
const GEOMETRY_SERVICE_URL = 'http://localhost:8000';

async function parseDxfFullLocal(fileContent: string): Promise<{ items: any[], detectedUnit: string }> {
    const formData = new FormData();
    const blob = new Blob([fileContent]);
    formData.append('file', blob, 'temp.dxf');

    console.log(`Sending minimal DXF to ${GEOMETRY_SERVICE_URL}/api/parse-dxf...`);
    const response = await fetch(`${GEOMETRY_SERVICE_URL}/api/parse-dxf`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        throw new Error(`Failed to parse DXF via service: ${response.statusText}`);
    }

    const data = await response.json() as any;
    const items: any[] = [];

    if (data.regions) {
        data.regions.forEach((reg: any) => {
            items.push({
                type: 'area',
                layer: reg.layer,
                value_m: reg.area
            });
        });
    }
    if (data.segments) {
        items.push(...data.segments.map((s: any) => ({ type: 'length', layer: s.layer })));
    }

    return { items, detectedUnit: 'm' };
}

async function run() {
    // Minimal DXF: A 10x10 rectangle on layer "WALLS"
    const dxfContent = `  0
SECTION
  2
ENTITIES
  0
LINE
  8
WALLS
 10
0.0
 20
0.0
 11
10.0
 21
0.0
  0
LINE
  8
WALLS
 10
10.0
 20
0.0
 11
10.0
 21
10.0
  0
LINE
  8
WALLS
 10
10.0
 20
10.0
 11
0.0
 21
10.0
  0
LINE
  8
WALLS
 10
0.0
 20
10.0
 11
0.0
 21
0.0
  0
ENDSEC
  0
EOF`;

    try {
        const result = await parseDxfFullLocal(dxfContent);
        console.log("Service OK!");
        console.log(`Items returned: ${result.items.length}`);

        const areas = result.items.filter(i => i.type === 'area');
        console.log(`Areas: ${areas.length}`);

        if (areas.length > 0) {
            console.log(`Region Layer: ${areas[0].layer}`);
            console.log(`Region Area: ${areas[0].value_m}`);
            if (Math.abs(areas[0].value_m - 100.0) < 0.1) {
                console.log("SUCCESS: Correct Area (100 m2) extracted!");
            } else {
                console.log("FAILURE: Incorrect Area calculated.");
            }
        } else {
            console.log("FAILURE: No regions extracted (Cleanup failed to close loop?)");
        }

    } catch (e: any) {
        console.error("Test Failed:", e.message);
    }
}

run();
