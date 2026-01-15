import ExcelJS from 'exceljs';

export type RowType = 'item' | 'section_header' | 'note' | 'service';

export interface ExtractedExcelItem {
    row: number;
    description: string;
    unit: string;
    qty: number | null;
    price: number | null;
    type: RowType; // New field
}

export interface ExcelStructure {
    headerRow: number;
    columns: {
        description: number;
        unit: number;
        qty: number;
        price: number;
        total: number;
    };
    sheetName: string;
    columns_detected_by: string; // Diagnostic field
}

/**
 * Validates if a column mapping is sane by checking data types in the next N rows
 */
function validateMapping(worksheet: ExcelJS.Worksheet, headerRow: number, columns: ExcelStructure['columns']): number {
    let score = 0;
    const checkLimit = 30; // Check up to 30 rows
    let rowsChecked = 0;
    let validUnits = 0;
    let validNumbers = 0;

    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber <= headerRow || rowsChecked >= checkLimit) return;

        // Check Unit: should match common units
        const unitVal = columns.unit !== -1 ? row.getCell(columns.unit).text?.toLowerCase().trim() : '';
        if (['m', 'ml', 'm2', 'm²', 'm3', 'm³', 'u', 'un', 'und', 'gl', 'glb', 'global'].includes(unitVal)) {
            validUnits++;
        }

        // Check Qty/Price: should be numeric
        const qtyVal = columns.qty !== -1 ? row.getCell(columns.qty).value : null;
        if (typeof qtyVal === 'number') validNumbers++;

        const priceVal = columns.price !== -1 ? row.getCell(columns.price).value : null;
        if (typeof priceVal === 'number') validNumbers++;

        rowsChecked++;
    });

    if (rowsChecked === 0) return 0;

    // Scoring: High weight on valid units (strong signal)
    const unitScore = (validUnits / rowsChecked) * 100;
    const numScore = (validNumbers / (rowsChecked * 2)) * 100; // *2 because checking both qty and price

    return (unitScore * 0.7) + (numScore * 0.3);
}

/**
 * Validates if a unit column contains valid unit values by sampling data rows
 */
function validateUnitColumn(worksheet: ExcelJS.Worksheet, headerRow: number, unitCol: number): number {
    if (unitCol === -1) return 0;

    const VALID_UNITS = /^(m|ml|m2|m²|m3|m³|u|un|und|unidad|unidades|gl|glb|global|pa|est|kg|ton)$/i;
    let validCount = 0;
    let totalSampled = 0;
    const MAX_SAMPLES = 20;

    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber <= headerRow || totalSampled >= MAX_SAMPLES) return;

        const unitVal = row.getCell(unitCol).text?.toLowerCase().trim();
        if (unitVal && unitVal !== '') {
            totalSampled++;
            if (VALID_UNITS.test(unitVal)) {
                validCount++;
            }
        }
    });

    // Return score: % of valid values
    return totalSampled > 0 ? (validCount / totalSampled) * 100 : 0;
}

/**
 * Classifies a row based on content heuristics
 */
function classifyRow(description: string, unit: string, qty: number | null, price: number | null, hasMerge: boolean = false, isBold: boolean = false): RowType {
    const descLower = description.toLowerCase().trim();

    // 1. NOTES / EXCLUSIONS
    if (descLower.startsWith('nota') ||
        descLower.includes('importante:') ||
        descLower.includes('otros no considerados') ||
        descLower === 'otros') {
        return 'note';
    }

    // 2. SECTION HEADERS (Titles) - STRICT RULE
    // ⭐ MEJORA 1: Sin unidad + tiene descripción = título
    // This is the highest precision rule for title detection
    const hasNoUnit = !unit || unit.trim() === '';
    const hasDescription = description && description.trim().length > 0;

    if (hasNoUnit && hasDescription) {
        console.log(`[Excel Classify] Detected POSSIBLE TITLE: "${description}" (Unit: "${unit}")`);
        // Additional confidence: Bold, Uppercase, Merged, or Numbered
        const isUppercase = description === description.toUpperCase() && description.length > 3;
        const hasNoData = (!qty && qty !== 0) && (!price && price !== 0);
        const isNumbered = /^\d+(\.\d+)*\.?\s+[A-Z]/.test(description);

        // If any formatting hint OR no data at all, definitely a title
        if (isBold || hasMerge || isUppercase || isNumbered || hasNoData) {
            return 'section_header';
        }

        // Even without formatting, if it has no unit, treat as title
        // (This is the key improvement - prevents false positives)
        return 'section_header';
    }

    // 3. SERVICE ITEMS
    // Known service keywords
    if (unit === 'gl' ||
        descLower.includes('tramite') ||
        descLower.includes('trámite') ||
        descLower.includes('certificacion') ||
        descLower.includes('certificación') ||
        descLower.includes('limpieza') ||
        descLower.includes('aseo') ||
        descLower.includes('planos as-built')) {
        return 'service';
    }

    // 4. Default: ITEM
    return 'item';
}


export async function parseExcel(buffer: ArrayBuffer, targetSheetName?: string): Promise<{ items: ExtractedExcelItem[]; structure: ExcelStructure }> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    let worksheet = targetSheetName ? workbook.getWorksheet(targetSheetName) : undefined;
    if (!worksheet) {
        // Search heuristic
        worksheet = workbook.worksheets.find(ws => {
            const name = ws.name.toLowerCase();
            return name.includes('presupuesto') || name.includes('cotiza') || name.includes('itemizado');
        }) || workbook.worksheets[0];
    }

    if (!worksheet) throw new Error("No worksheet found");

    // --- HOTFIX 0: Robust Header Detection ---
    let bestHeaderRow = -1;
    let bestCols = { description: -1, unit: -1, qty: -1, price: -1, total: -1 };
    let bestScore = -1;
    let detectionMethod = 'heuristic';

    const KEYWORDS = {
        description: ['descripcion', 'descripción', 'partida', 'designation', 'description', 'nombre', 'ítem', 'item'],
        unit: [
            'unidad',
            'unidades',
            /\bund\b/i,      // Word boundary to avoid matching "Valor Und" or "P.U."
            /\bunid\b/i,
            /\bunit\b/i,
            /^u\.?$/i        // Only "u" or "u." as standalone
        ],
        qty: ['cantidad', 'cant', 'qty', 'quantity'],
        price: ['valor unitario', 'precio unitario', 'p.u', 'unit price', 'precio', 'valor u.'],
        total: ['total', 'valor total', 'precio total']
    };

    // Scan first 50 rows for the Best Header Candidate
    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber > 50) return;

        const currentCols = { description: -1, unit: -1, qty: -1, price: -1, total: -1 };
        let matches = 0;

        row.eachCell((cell, colNumber) => {
            const val = (cell.text || '').toLowerCase().trim();
            if (!val) return;

            // Strict checking for headers
            if (KEYWORDS.description.some(k => val === k || val.includes(k))) {
                currentCols.description = colNumber;
                matches++;
            }
            // Special handling for unit column with regex support
            else if (KEYWORDS.unit.some(k => {
                if (k instanceof RegExp) {
                    return k.test(val);
                }
                return val === k || val.includes(k);
            })) {
                currentCols.unit = colNumber;
                matches++;
            }
            else if (KEYWORDS.qty.some(k => val === k || val.includes(k))) {
                currentCols.qty = colNumber;
                matches++;
            }
            else if (KEYWORDS.price.some(k => val === k || val.includes(k))) {
                currentCols.price = colNumber;
                matches++;
            }
            else if (KEYWORDS.total.some(k => val === k || val.includes(k))) {
                currentCols.total = colNumber;
                matches++;
            }
        });

        // Must have at least Description AND (Unit OR Qty OR Price)
        if (currentCols.description !== -1 && (currentCols.unit !== -1 || currentCols.qty !== -1 || currentCols.price !== -1)) {
            // Validate unit column with sampling
            const unitValidationScore = validateUnitColumn(worksheet!, rowNumber, currentCols.unit);

            // Validate this mapping with data below
            const mappingScore = validateMapping(worksheet!, rowNumber, currentCols);

            // Context score (matches count) + Validation score + Unit validation
            const totalScore = matches * 10 + mappingScore + unitValidationScore;

            console.log(`[Excel Parser] Row ${rowNumber} candidate - Unit validation: ${unitValidationScore.toFixed(1)}%, Total score: ${totalScore.toFixed(1)}`);

            if (totalScore > bestScore) {
                bestScore = totalScore;
                bestHeaderRow = rowNumber;
                bestCols = currentCols;
                detectionMethod = `header_match (score: ${totalScore.toFixed(1)}, unit_validation: ${unitValidationScore.toFixed(1)}%)`;
            }
        }
    });

    if (bestHeaderRow === -1) {
        throw new Error("Could not detect valid headers (Descripción, Unidad, Cantidad) in the first 50 rows.");
    }

    const structure: ExcelStructure = {
        headerRow: bestHeaderRow,
        columns: bestCols,
        sheetName: worksheet.name,
        columns_detected_by: detectionMethod
    };

    // Extract Items
    const items: ExtractedExcelItem[] = [];

    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber <= structure.headerRow) return;

        const descCell = structure.columns.description !== -1 ? row.getCell(structure.columns.description) : null;
        const desc = descCell ? (descCell.text || '').trim() : '';

        // Basic clean filter
        if (!desc || desc === '' || desc.toLowerCase().includes('total neto') || desc.toLowerCase().includes('subtotal')) return;

        const unit = structure.columns.unit !== -1 ? (row.getCell(structure.columns.unit).text || '').trim() : '';

        // Robust numeric parsing
        const parseNum = (cell: ExcelJS.Cell) => {
            if (!cell) return null;
            if (typeof cell.value === 'number') return cell.value;
            // Handle strings like "$ 1.000" or "1,000.50"
            if (typeof cell.value === 'string') {
                const clean = cell.value.replace(/[^0-9.,-]/g, '').replace(',', '.'); // naive replace, usually safer to strip non-numeric
                const num = parseFloat(clean);
                return isNaN(num) ? null : num;
            }
            return null;
        };

        const qty = structure.columns.qty !== -1 ? parseNum(row.getCell(structure.columns.qty)) : null;
        const price = structure.columns.price !== -1 ? parseNum(row.getCell(structure.columns.price)) : null;

        // --- HOTFIX 1: Row Classification ---
        // Check formatting (bold/merged) if possible. ExcelJS cell.style.font.bold
        let isBold = false;
        if (descCell?.style?.font?.bold) isBold = true;
        // Merge check is expensive O(N), skip for now unless critical.

        const rowType = classifyRow(desc, unit, qty, price, false, isBold);

        items.push({
            row: rowNumber,
            description: desc,
            unit: unit,
            qty: qty,
            price: price,
            type: rowType
        });
    });

    return { items, structure };
}
