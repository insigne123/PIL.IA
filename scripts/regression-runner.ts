
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { parseDxf } from '../src/lib/processing/dxf';
import { matchItems } from '../src/lib/processing/matcher';
import { ExtractedExcelItem } from '../src/types';

// Configuration
const CSV_PATH = path.resolve(process.cwd(), '00. LdS PA - Planilla cotizaciขn OOCC MV CONSTRUCTORA rev1.csv');
const XLSX_PATH = path.resolve(process.cwd(), '00. LdS PAK - Planilla cotizaciขn OOCC.xlsx');
const DXF_PATH = path.resolve(process.cwd(), 'ACAD-LDS_PAK - (LC) Copia Clean.dxf');
const REPORT_JSON_PATH = path.resolve(process.cwd(), 'artifacts/regression_report.json');
const FILLED_XLSX_PATH = path.resolve(process.cwd(), 'artifacts/filled.xlsx');

const ARGS = process.argv.slice(2);
const FILL_XLSX = ARGS.includes('--fill-xlsx');

// Ensure artifacts directory exists
if (!fs.existsSync(path.resolve(process.cwd(), 'artifacts'))) {
    fs.mkdirSync(path.resolve(process.cwd(), 'artifacts'));
}

// Normalization Helpers
function normalizePartida(text: string): string {
    if (!text) return '';
    return text
        .toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
        .replace(/[.,;:]/g, '') // Remove light punctuation
        .replace(/\s+/g, ' ') // Collapse spaces
        .trim();
}

function normalizeUnidad(text: string): string {
    if (!text) return '';
    let unit = text.toLowerCase().trim();
    // Map variants
    if (unit === 'm²' || unit === 'mt2' || unit === 'm2') return 'm2';
    if (unit === 'ml' || unit === 'm' || unit === 'mt') return 'ml';
    if (unit === 'un' || unit === 'u' || unit === 'und' || unit === 'c/u') return 'un';
    if (unit === 'gl' || unit === 'glb') return 'gl';
    return unit;
}

function generateKey(partida: string, unidad: string): string {
    return `${normalizePartida(partida)}|${normalizeUnidad(unidad)}`;
}

interface ValidationRow {
    rowIndex: number;
    partida: string;
    unidad: string;
    cantidad: number;
    n_item: string; // The "Nº" column
    key: string;
}

async function loadValidationCSV(): Promise<ValidationRow[]> {
    console.log(`[CSV] Loading ${CSV_PATH}...`);
    const content = fs.readFileSync(CSV_PATH, 'utf-8');

    // Parse all rows as arrays first to find the header
    const rawRows = parse(content, {
        relax_column_count: true,
        skip_empty_lines: true
    }) as string[][];

    // Find header row
    let headerIndex = -1;
    let colMap = { n: -1, partida: -1, unidad: -1, cantidad: -1 };

    for (let i = 0; i < rawRows.length; i++) {
        const row = rawRows[i].map(c => c.toLowerCase().trim());
        if (row.includes('partida') && row.includes('unidad')) {
            headerIndex = i;
            colMap.n = row.indexOf('nº');
            if (colMap.n === -1) colMap.n = row.indexOf('item'); // Fallback
            colMap.partida = row.indexOf('partida');
            colMap.unidad = row.indexOf('unidad');
            colMap.cantidad = row.indexOf('cantidad');
            break;
        }
    }

    if (headerIndex === -1) {
        throw new Error('Could not find header row in CSV');
    }

    const validationRows: ValidationRow[] = [];
    const titleRegex = /^\d+$/;

    for (let i = headerIndex + 1; i < rawRows.length; i++) {
        const row = rawRows[i];
        const partida = row[colMap.partida]?.trim();
        const unidad = row[colMap.unidad]?.trim();
        const cantidadStr = row[colMap.cantidad]?.trim(); // e.g. "150,000" or "46.57"
        const n_item = colMap.n > -1 ? row[colMap.n]?.trim() : '';

        // Filter Logic
        if (!partida) continue;

        // Skip if partida is just digits (Title)
        if (titleRegex.test(partida)) continue;

        // Skip if Unit is empty (Title/Header)
        if (!unidad) continue;

        // Clean Quantity: remove commas, parse float
        const cleanQty = cantidadStr.replace(/,/g, '');
        const qty = parseFloat(cleanQty);

        if (isNaN(qty)) continue; // Skip if quantity is not a number

        validationRows.push({
            rowIndex: i + 1, // 1-based index
            partida,
            unidad,
            cantidad: qty,
            n_item,
            key: generateKey(partida, unidad)
        });
    }

    console.log(`[CSV] Loaded ${validationRows.length} valid rows.`);
    return validationRows;
}

async function runRegression() {
    console.log('--- Starting Regression Runner VERSION 5 ---');

    // 1. Load CSV
    const validationRows = await loadValidationCSV();

    // 2. Load and Parse DXF
    if (!fs.existsSync(DXF_PATH)) {
        throw new Error(`DXF file not found at ${DXF_PATH}`);
    }
    console.log(`[DXF] Parsing ${DXF_PATH}...`);
    // Check if it's LFS pointer
    const dxfStat = fs.statSync(DXF_PATH);
    if (dxfStat.size < 1000) {
        throw new Error('DXF file seems too small. Is it an LFS pointer? Run "git lfs pull"');
    }

    let dxfContent: string;
    try {
        dxfContent = fs.readFileSync(DXF_PATH, 'utf-8');
    } catch (e) {
        dxfContent = fs.readFileSync(DXF_PATH).toString('latin1');
    }

    const { items: dxfItems } = await parseDxf(dxfContent);
    console.log(`[DXF] Extracted ${dxfItems.length} items.`);

    // 3. Prepare items for Matcher
    // We need to convert ValidationRow -> ExtractedExcelItem for the matcher
    const excelItems: ExtractedExcelItem[] = validationRows.map(row => {
        const u = normalizeUnidad(row.unidad);
        let type = 'item';
        if (u === 'gl') type = 'service';

        return {
            row: row.rowIndex,
            description: row.partida,
            unit: row.unidad,
            qty: null,
            expectedQty: row.cantidad,
            type
        };
    });

    // 4. Run Matcher
    console.log('[Matcher] Running matching logic...');
    const stagingRows = matchItems(excelItems, dxfItems, 'Regression');

    // 5. Build Report
    const reportItems: any[] = [];
    let totalEvaluable = 0;
    let totalError = 0;
    let outlierCount = 0;
    const errorsByUnit: Record<string, { sumAbsError: number, count: number }> = {};

    stagingRows.forEach((row) => {
        const valRow = validationRows.find(r => r.rowIndex === row.excel_row_index);
        if (!valRow) return; // Should not happen

        const predicted = row.qty_final || 0;
        const expected = valRow.cantidad;
        const absError = Math.abs(predicted - expected);
        let pctError = 0;

        if (expected > 0) {
            pctError = (absError / expected) * 100;
        }

        totalEvaluable++;
        totalError += (expected > 0 ? pctError : 0); // Only sum % error for non-zero expected

        if (expected > 0 && pctError > 10) {
            outlierCount++;
        }

        // Stats by unit
        const u = normalizeUnidad(valRow.unidad);
        if (!errorsByUnit[u]) errorsByUnit[u] = { sumAbsError: 0, count: 0 };
        errorsByUnit[u].sumAbsError += absError;
        errorsByUnit[u].count++;

        reportItems.push({
            rowIndex: valRow.rowIndex,
            partida: valRow.partida,
            unidad: valRow.unidad,
            n_item: valRow.n_item,
            expectedQty: expected,
            predictedQty: predicted,
            absError: parseFloat(absError.toFixed(4)),
            pctError: expected > 0 ? parseFloat(pctError.toFixed(2)) : null,
            matchedLayer: row.source_items?.[0]?.layer_normalized || null,
            calcMethod: row.method_detail || row.calc_method,
            confidence: row.match_confidence,
            flags: row.warnings || []
        });
    });

    const globalMAPE = totalEvaluable > 0 ? totalError / totalEvaluable : 0;

    const report = {
        summary: {
            totalRows: totalEvaluable,
            MAPE: parseFloat(globalMAPE.toFixed(2)),
            outliers: outlierCount,
            timestamp: new Date().toISOString()
        },
        items: reportItems
    };

    fs.writeFileSync(REPORT_JSON_PATH, JSON.stringify(report, null, 2));
    console.log(`[Report] Saved to ${REPORT_JSON_PATH}`);
    console.log(`[Report] MAPE: ${globalMAPE.toFixed(2)}% | Outliers: ${outlierCount}`);

    // 6. Fill XLSX
    if (FILL_XLSX) {
        await fillXlsx(reportItems);
    }
}

async function fillXlsx(reportItems: any[]) {
    console.log(`[XLSX] Reading target file ${XLSX_PATH}...`);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(XLSX_PATH);
    const worksheet = workbook.worksheets[0]; // Assume first sheet

    // Build Index from XLSX
    console.log('[XLSX] Building row index...');

    interface XlsxRowInfo {
        rowNumber: number;
        partida: string;
        unidad: string;
        n_item: string;
        key: string;
    }

    const xlsxMap = new Map<string, XlsxRowInfo[]>();
    const titleRegex = /^\d+$/;

    // Scan for header in XLSX
    let headerRow = -1;
    let colMap = { n: -1, partida: -1, unidad: -1, cantidad: -1 };

    worksheet.eachRow((row, rowNumber) => {
        if (headerRow !== -1) return;
        let hasPartida = false;
        let hasUnidad = false;

        row.eachCell((cell, colNum) => {
            const val = String(cell.value).toLowerCase().trim();
            if (val.includes('partida')) { colMap.partida = colNum; hasPartida = true; }
            if (val.includes('unidad')) { colMap.unidad = colNum; hasUnidad = true; }
            if (val.includes('cantidad')) { colMap.cantidad = colNum; }
            if (val.includes('nº') || val === 'item') { colMap.n = colNum; }
        });

        if (hasPartida && hasUnidad) {
            headerRow = rowNumber;
            console.log(`[XLSX] Found header at row ${rowNumber}:`, colMap);
        }
    });

    if (headerRow === -1) {
        console.error('[XLSX] Could not find header row. Aborting fill.');
        return;
    }

    // Build map
    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber <= headerRow) return;

        const partida = row.getCell(colMap.partida).text?.trim();
        const unidad = row.getCell(colMap.unidad).text?.trim();
        const n_item = colMap.n > -1 ? row.getCell(colMap.n).text?.trim() : '';

        if (!partida || titleRegex.test(partida)) return;
        if (!unidad) return;

        const key = generateKey(partida, unidad);
        const info = { rowNumber, partida, unidad, n_item, key };

        if (!xlsxMap.has(key)) xlsxMap.set(key, []);
        xlsxMap.get(key)!.push(info);
    });

    // Fill Data
    let filledCount = 0;
    let ambiguousCount = 0;
    let notFoundCount = 0;

    for (const item of reportItems) {
        const key = generateKey(item.partida, item.unidad);
        const candidates = xlsxMap.get(key);

        if (!candidates || candidates.length === 0) {
            item.flags.push('not_found_in_xlsx');
            notFoundCount++;
            continue;
        }

        let targetRowIndex = -1;

        if (candidates.length === 1) {
            targetRowIndex = candidates[0].rowNumber;
        } else {
            // Disambiguate
            item.flags.push('duplicate_key');
            ambiguousCount++;

            // Try matching N_ITEM if available
            if (item.n_item) {
                const exactMatch = candidates.find(c => c.n_item === item.n_item);
                if (exactMatch) {
                    targetRowIndex = exactMatch.rowNumber;
                }
            }

            // Fallback
            if (targetRowIndex === -1) {
                targetRowIndex = candidates[0].rowNumber;
                item.flags.push('ambiguous_resolved_first');
            }
        }

        // Write Qty
        if (targetRowIndex !== -1) {
            const cell = worksheet.getRow(targetRowIndex).getCell(colMap.cantidad);
            cell.value = item.predictedQty;
            filledCount++;
        }
    }

    console.log(`[XLSX] Filled ${filledCount} rows. Not found: ${notFoundCount}. Ambiguous: ${ambiguousCount}.`);
    await workbook.xlsx.writeFile(FILLED_XLSX_PATH);
    console.log(`[XLSX] Saved to ${FILLED_XLSX_PATH}`);
}

runRegression().catch(e => {
    console.error(e);
    process.exit(1);
});
