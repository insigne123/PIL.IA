/**
 * Extract expected quantities from Excel for comparison
 */

const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

const EXCEL_PATH = path.join(__dirname, '..', '00. LdS PAK - Planilla cotización OOCC.xlsx');

async function extractQuantities() {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(EXCEL_PATH);

    const results = [];

    for (const worksheet of workbook.worksheets) {
        console.log(`\n=== Sheet: ${worksheet.name} ===`);

        // Find header row
        let headerRow = null;
        let headers = {};

        for (let r = 1; r <= Math.min(15, worksheet.rowCount); r++) {
            const row = worksheet.getRow(r);
            const values = [];
            row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                const val = cell.text || cell.value;
                if (typeof val === 'string') {
                    values.push({ col: colNumber, val: val.toLowerCase().trim() });
                }
            });

            // Look for common headers
            const hasPartida = values.some(v => v.val.includes('partida') || v.val.includes('descripción'));
            const hasUnidad = values.some(v => v.val === 'unidad' || v.val === 'ud' || v.val === 'und');
            const hasCantidad = values.some(v => v.val === 'cantidad' || v.val === 'cant' || v.val === 'qty');

            if (hasPartida || (hasUnidad && hasCantidad)) {
                headerRow = r;
                values.forEach(v => {
                    if (v.val.includes('partida') || v.val.includes('descripción')) headers.description = v.col;
                    if (v.val === 'unidad' || v.val === 'ud') headers.unit = v.col;
                    if (v.val === 'cantidad' || v.val === 'cant' || v.val === 'qty') headers.quantity = v.col;
                });
                console.log(`Found header row: ${r}, columns:`, headers);
                break;
            }
        }

        if (!headerRow) {
            console.log('No header row found, skipping sheet');
            continue;
        }

        // If we didn't find cantidad, look in columns around unidad
        if (!headers.quantity && headers.unit) {
            // Usually Cantidad is column before or after Unidad
            headers.quantity = headers.unit - 1; // Try column before
            console.log(`Guessing quantity column: ${headers.quantity}`);
        }

        // Extract items
        for (let r = headerRow + 1; r <= worksheet.rowCount && r < headerRow + 200; r++) {
            const row = worksheet.getRow(r);

            const description = headers.description ? getCellValue(row.getCell(headers.description)) : '';
            const unit = headers.unit ? getCellValue(row.getCell(headers.unit)) : '';
            const quantity = headers.quantity ? getCellValue(row.getCell(headers.quantity)) : null;

            if (description && unit && unit.match(/^(m2|m|ml|u|gl|un)$/i)) {
                const numQty = parseFloat(quantity);
                if (!isNaN(numQty) && numQty > 0) {
                    results.push({
                        row: r,
                        description: description.substring(0, 80),
                        unit: unit,
                        quantity_expected: numQty
                    });
                    console.log(`Row ${r}: ${unit} | ${numQty} | ${description.substring(0, 50)}`);
                }
            }
        }
    }

    // Save to JSON
    fs.writeFileSync('scripts/expected-quantities.json', JSON.stringify(results, null, 2));
    console.log(`\n\nSaved ${results.length} items to scripts/expected-quantities.json`);
}

function getCellValue(cell) {
    if (!cell) return '';
    if (cell.result !== undefined) return String(cell.result);
    if (cell.value && typeof cell.value === 'object') {
        if (cell.value.result !== undefined) return String(cell.value.result);
        if (cell.value.text) return cell.value.text;
    }
    return String(cell.value || cell.text || '');
}

extractQuantities().catch(console.error);
