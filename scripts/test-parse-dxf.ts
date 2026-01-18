
import { parseDxf } from '../src/lib/processing/dxf';
import fs from 'fs';
import path from 'path';

async function testParse() {
    console.log('--- TEST: Diagnosing specific layers ---');

    const filePath = path.join(process.cwd(), 'LDS_PAK - (LC) (1).dxf');
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        return;
    }

    const fileBuffer = fs.readFileSync(filePath);
    const fileStr = fileBuffer.toString('utf-8');

    console.log(`Parsing DXF: ${filePath} (${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB)`);

    // Suppress heavy logging from parseDxf
    const originalLog = console.log;
    console.log = () => { };

    try {
        const result = await parseDxf(fileStr);
        console.log = originalLog; // Restore logging

        console.log(`\nParsed ${result.items.length} items.`);

        // Layers to inspect
        const targetLayers = [
            'a-arq-cielo falso',
            'fa_tabiques',
            'fa_arq-muros',
            'mb-elev 2',
            '0',
            'mb-proyection line'
        ];

        const report: any = { layers: {} };

        targetLayers.forEach(layerName => {
            const items = result.items.filter((i: any) => i.layer && i.layer.toLowerCase() === layerName.toLowerCase());
            let totalArea = 0;
            let totalLength = 0;
            let blockCount = 0;
            let polyCount = 0;

            items.forEach(i => {
                if (i.type === 'area') {
                    totalArea += i.value_si || 0;
                    polyCount++;
                } else if (i.type === 'length') {
                    totalLength += i.value_si || 0;
                } else if (i.type === 'block') {
                    blockCount++;
                }
            });

            report.layers[layerName] = {
                items: items.length,
                totalArea: parseFloat(totalArea.toFixed(2)),
                totalLength: parseFloat(totalLength.toFixed(2)),
                blockCount,
                polyCount
            };
        });

        const reportPath = path.join(process.cwd(), 'scripts', 'layer-report.json');
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log(`Report saved to ${reportPath}`);
    } catch (error) {
        console.error("Error in testParse:", error);
    } finally {
        console.log = originalLog;
    }
}

testParse().catch(console.error);
