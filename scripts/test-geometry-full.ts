
import fs from 'fs';
import path from 'path';

// Mock GEOMETRY_SERVICE_URL
const GEOMETRY_SERVICE_URL = 'http://localhost:8000';

// --- COPIED logic from geometry-service.ts ---
async function parseDxfFull(fileContent: Buffer | string, unit: string = 'm'): Promise<{ items: any[], detectedUnit: string }> {
    const formData = new FormData();

    // Create a Blob/File from content since API expects file upload
    const blob = new Blob([fileContent]);
    formData.append('file', blob, 'temp.dxf');

    console.log(`Sending request to ${GEOMETRY_SERVICE_URL}/api/parse-dxf...`);
    const response = await fetch(`${GEOMETRY_SERVICE_URL}/api/parse-dxf`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        throw new Error(`Failed to parse DXF via service: ${response.statusText}`);
    }

    const data = await response.json() as any;
    const items: any[] = [];

    // Map Segments
    if (data.segments) {
        data.segments.forEach((seg: any, index: number) => {
            const dx = seg.end.x - seg.start.x;
            const dy = seg.end.y - seg.start.y;
            const len = Math.sqrt(dx * dx + dy * dy);

            items.push({
                id: `seg_${index}`,
                type: 'length',
                layer: seg.layer || '0',
                layer_normalized: (seg.layer || '0').toLowerCase().trim(),
                value_raw: len,
                value_m: len,
                vertices: [seg.start, seg.end],
                color: 7
            });
        });
    }

    // Map Texts
    if (data.texts) {
        data.texts.forEach((txt: any, index: number) => {
            items.push({
                id: `txt_${index}`,
                type: 'text',
                layer: txt.layer || '0',
                layer_normalized: (txt.layer || '0').toLowerCase().trim(),
                value_raw: 0,
                value_m: 0,
                name_raw: txt.text,
                text: txt.text,
                vertices: [txt.position],
                color: 7
            });
        });
    }

    // Map Regions
    if (data.regions) {
        data.regions.forEach((reg: any) => {
            items.push({
                id: reg.id,
                type: 'area',
                layer: reg.layer || 'Unknown',
                layer_normalized: (reg.layer || 'Unknown').toLowerCase().trim(),
                value_raw: reg.area,
                value_m: reg.area,
                vertices: reg.vertices,
                color: 9
            });
        });
    }

    return { items, detectedUnit: 'm' };
}

// --- MAIN RUN ---
async function run() {
    const dxfPath = path.resolve('LDS_PAK - (LC) (1).dxf');
    console.log(`Reading DXF from ${dxfPath}...`);

    if (!fs.existsSync(dxfPath)) {
        console.error("DXF file not found!");
        return;
    }

    const content = fs.readFileSync(dxfPath);
    console.log(`File read (${content.length} bytes). Checking service...`);

    try {
        const { items, detectedUnit } = await parseDxfFull(content, 'm');
        console.log(`Detection complete. Unit: ${detectedUnit}`);
        console.log(`Total Items: ${items.length}`);

        const areas = items.filter(i => i.type === 'area');
        const blocks = items.filter(i => i.type === 'block');
        const lengths = items.filter(i => i.type === 'length');
        const texts = items.filter(i => i.type === 'text');

        console.log(`Areas (Regions): ${areas.length}`);
        console.log(`Blocks: ${blocks.length}`);
        console.log(`Lengths: ${lengths.length}`);
        console.log(`Texts: ${texts.length}`);

        // VALIDATION
        if (areas.length > 0) {
            console.log("SUCCESS: Areas detected via Python Service!");
            console.log("Sample Area Layer:", areas[0].layer);
            console.log("Sample Area Value:", areas[0].value_m);
        } else {
            console.error("FAILURE: No areas detected.");
        }

    } catch (e: any) {
        console.error("Execution failed:", e.message);
        if (e.cause) console.error("Cause:", e.cause);
    }
}

run();
