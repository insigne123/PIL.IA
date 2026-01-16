/**
 * Parse Excel to understand required items - JSON output version
 */

const ExcelJS = require('exceljs');
const fs = require('fs');

const EXCEL_PATH = 'C:\\Users\\nicog\\Downloads\\wetransfer_lds-pak-licitacion-oocc_2026-01-08_0027\\PIL.IA\\00. LdS PAK - Planilla cotizaciขn OOCC.xlsx';

async function analyzeExcel() {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(EXCEL_PATH);

    const result = {
        worksheets: [],
        allItems: []
    };

    // Analyze each worksheet
    for (const worksheet of workbook.worksheets) {
        const sheetData = {
            name: worksheet.name,
            rowCount: worksheet.rowCount,
            columnCount: worksheet.columnCount,
            items: []
        };

        // Find header row
        let headerRow = null;
        let headers = [];

        for (let i = 1; i <= Math.min(10, worksheet.rowCount); i++) {
            const row = worksheet.getRow(i);
            const values = [];
            row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                values[colNumber] = cell.text || cell.value;
            });

            // Check if this looks like a header
            const hasPartida = values.some(v => typeof v === 'string' && v.toLowerCase().includes('partida'));
            const hasDescripcion = values.some(v => typeof v === 'string' && v.toLowerCase().includes('descripci'));
            const hasCantidad = values.some(v => typeof v === 'string' && v.toLowerCase().includes('cantidad'));
            const hasUnidad = values.some(v => typeof v === 'string' && v.toLowerCase().includes('unidad'));

            if ((hasPartida || hasDescripcion) && (hasCantidad || hasUnidad)) {
                headerRow = i;
                headers = values;
                break;
            }
        }

        sheetData.headerRow = headerRow;
        sheetData.headers = headers.filter(h => h);

        // Extract all data rows
        if (headerRow) {
            for (let i = headerRow + 1; i <= worksheet.rowCount; i++) {
                const row = worksheet.getRow(i);
                const values = {};

                row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
                    const headerName = headers[colNumber] || `col${colNumber}`;
                    values[headerName] = cell.text || cell.value;
                    values[`_col${colNumber}`] = cell.text || cell.value;
                });

                // Skip empty rows
                if (Object.keys(values).length === 0) continue;

                // Try to extract key fields
                let item = {
                    row: i,
                    sheet: worksheet.name,
                    raw: values
                };

                // Find description
                for (const [key, val] of Object.entries(values)) {
                    if (typeof val === 'string' && val.length > 5) {
                        if (key.toLowerCase().includes('descripci') || key.toLowerCase().includes('partida')) {
                            item.description = val.substring(0, 100);
                        }
                    }
                }

                // Find unit
                for (const [key, val] of Object.entries(values)) {
                    const valStr = String(val).toLowerCase().trim();
                    if (['m2', 'm²', 'ml', 'm', 'u', 'un', 'gl', 'kg', 'm3', 'm³'].includes(valStr)) {
                        item.unit = valStr;
                    }
                }

                // Find quantity (look for numeric values in cantidad column or reasonable numbers)
                for (const [key, val] of Object.entries(values)) {
                    if (key.toLowerCase().includes('cantidad') && typeof val === 'number') {
                        item.qty = val;
                    }
                }

                if (item.description || item.unit || item.qty) {
                    sheetData.items.push(item);
                    result.allItems.push(item);
                }
            }
        }

        result.worksheets.push(sheetData);
    }

    // Save results
    fs.writeFileSync('scripts/excel-analysis.json', JSON.stringify(result, null, 2));

    // Print summary
    console.log('=== Excel Analysis Summary ===\n');
    for (const sheet of result.worksheets) {
        console.log(`Sheet: ${sheet.name} - ${sheet.items.length} items`);
        if (sheet.headers.length > 0) {
            console.log(`  Headers: ${sheet.headers.slice(0, 6).join(', ')}`);
        }
    }

    console.log(`\nTotal items: ${result.allItems.length}`);
    console.log('\nSaved to scripts/excel-analysis.json');
}

analyzeExcel().catch(console.error);
