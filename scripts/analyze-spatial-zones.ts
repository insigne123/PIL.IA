
import { parseDxf } from '../src/lib/processing/dxf';
import fs from 'fs';
import path from 'path';

async function analyzeSpatialZones() {
    console.log('--- ANALYSIS: Spatial Zones Detection ---');

    const filePath = path.join(process.cwd(), 'LDS_PAK - (LC) (1).dxf');
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        return;
    }

    const fileBuffer = fs.readFileSync(filePath);
    const fileStr = fileBuffer.toString('utf-8');

    // Mute console.log during parsing
    const originalLog = console.log;
    console.log = () => { };
    const result = await parseDxf(fileStr);
    console.log = originalLog;

    const itemTypes: Record<string, number> = {};
    const textSamples: any[] = [];
    const allTexts: { text: string, layer: string, x: number, y: number, height: number }[] = [];

    result.items.forEach(item => {
        itemTypes[item.type] = (itemTypes[item.type] || 0) + 1;

        if (item.type === 'text' || item.type === 'mtext') {
            // Capture any text-like item
            if (textSamples.length < 50) {
                textSamples.push(item);
            }

            if (item.name_raw) {
                allTexts.push({
                    text: item.name_raw,
                    layer: item.layer,
                    x: item.position?.x || 0,
                    y: item.position?.y || 0,
                    height: item.value_si || 0
                });
            }
        }
    });

    // Report types found
    console.log('Item Types:', JSON.stringify(itemTypes, null, 2));

    // Filter for likely room names (simple heuristic: length < 50, no numbers only)

    const roomCandidates = allTexts.filter(t => {
        const txt = t.text.trim();
        return txt.length > 2 && txt.length < 50 && !/^\d+$/.test(txt);
    });

    const report = {
        totalTexts: allTexts.length,
        candidates: roomCandidates.length,
        layersWithText: [...new Set(roomCandidates.map(t => t.layer))],
        samples: roomCandidates.slice(0, 50)
    };

    const reportPath = path.join(process.cwd(), 'scripts', 'spatial-zones-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`Report saved to ${reportPath}`);
}

analyzeSpatialZones().catch(console.error);
