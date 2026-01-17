
import { parseDxf } from '../src/lib/processing/dxf';
import { matchItems } from '../src/lib/processing/matcher';
import fs from 'fs';
import path from 'path';
import { ExtractedExcelItem } from '../src/types';

// Configuration
const EXCEL_JSON_PATH = path.resolve(__dirname, 'excel-analysis.json');
const DXF_PATH = path.resolve(__dirname, '..', 'LDS_PAK - (LC) (1).dxf');
const OUTPUT_JSON = 'staging_data_final.json';
const OUTPUT_TXT = 'final-results.txt';
const LOG_FILE = 'pipeline.log';

function log(msg: string) {
    console.log(msg);
    try {
        fs.appendFileSync(LOG_FILE, msg + '\n');
    } catch (e) { }
}

async function run() {
    try {
        fs.writeFileSync(LOG_FILE, '--- Starting End-to-End Processing ---\n');
        log(`Excel JSON: ${EXCEL_JSON_PATH}`);
        log(`DXF: ${DXF_PATH}`);

        if (!fs.existsSync(EXCEL_JSON_PATH) || !fs.existsSync(DXF_PATH)) {
            throw new Error('Input files not found!');
        }

        // 1. Process Excel (From JSON)
        log('\n[1/3] Loading Excel Data from JSON...');
        const excelJson = JSON.parse(fs.readFileSync(EXCEL_JSON_PATH, 'utf-8'));
        const excelItems: ExtractedExcelItem[] = [];

        // Flatten items from all worksheets
        if (excelJson.worksheets) {
            for (const sheet of excelJson.worksheets) {
                if (sheet.items) {
                    for (const item of sheet.items) {
                        if (item.description) {
                            excelItems.push({
                                id: String(item.row),
                                description: item.description,
                                unit: item.unit || 'gl',
                                quantity: item.qty || 1, // Default to 1 if missing in analysis
                                unitPrice: 0,
                                totalPrice: 0
                            });
                        }
                    }
                }
            }
        } else if (excelJson.allItems) {
            for (const item of excelJson.allItems) {
                if (item.description) {
                    excelItems.push({
                        id: String(item.row),
                        description: item.description,
                        unit: item.unit || 'gl',
                        quantity: item.qty || 1,
                        unitPrice: 0,
                        totalPrice: 0
                    });
                }
            }
        }

        log(`Loaded ${excelItems.length} items from Excel Analysis.`);

        // 2. Process DXF
        log('\n[2/3] Processing DXF (this may take a moment)...');
        let dxfContent;
        try {
            dxfContent = fs.readFileSync(DXF_PATH, 'utf-8');
        } catch (e) {
            dxfContent = fs.readFileSync(DXF_PATH).toString('latin1');
        }

        const { items: detectados, preflight } = await parseDxf(dxfContent);
        log(`Extracted ${detectados.length} items from DXF.`);
        log(`Preflight Warnings: ${preflight.warnings.length}`);

        // 3. Match
        log('\n[3/3] Matching Items...');
        const stagingRows = matchItems(excelItems, detectados, 'FinalRun');
        log(`Generated ${stagingRows.length} staging rows.`);

        // 4. Output Logic
        fs.writeFileSync(OUTPUT_JSON, JSON.stringify(stagingRows, null, 2));
        log(`\nResults saved to ${OUTPUT_JSON}`);

        // 5. Verification Summary for File
        const lines: string[] = [];
        lines.push('--- Final Verification Summary ---');
        lines.push(`Total Rows: ${stagingRows.length}`);

        // Critical items to check
        const criticalKeywords = ['osb', 'placa', 'vulcanita', 'cielo', 'tabique'];

        lines.push('\n--- Critical Items Analysis ---');

        for (const row of stagingRows) {
            const rowDesc = row.excel_item.description.toLowerCase();
            const isCritical = criticalKeywords.some(c => rowDesc.includes(c));

            if (isCritical) {
                // Find primary match
                const match = row.matched_items?.[0];
                const matchVal = match ? match.value_si : 0;
                const matchLayer = match ? match.layer_normalized : 'NONE';
                const matchZone = match ? match.zone_name : 'No Zone';
                const matchSrc = match ? match.evidence : 'N/A';

                lines.push(`\nItem: "${row.excel_item.description}"`);
                lines.push(`  Excel Qty: ${row.excel_item.quantity} ${row.excel_item.unit}`);
                lines.push(`  Matched: ${matchVal.toFixed(2)} ${match?.unit_raw || '-'} on [${matchLayer}]`);
                lines.push(`  Zone: ${matchZone}`);
                lines.push(`  Source: ${matchSrc}`);
                lines.push(`  Score: ${row.match_confidence.toFixed(2)}`);
                lines.push(`  Reason: ${row.match_reason}`);
            }
        }

        fs.writeFileSync(OUTPUT_TXT, lines.join('\n'));
        log(`Summary saved to ${OUTPUT_TXT}`);

    } catch (e: any) {
        log('FATAL ERROR: ' + e.message);
        if (e.stack) log(e.stack);
    }
}

run();
