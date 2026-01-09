import ExcelJS from 'exceljs';

export interface ExtractedExcelItem {
    row: number;
    description: string;
    unit: string;
    qty: number | null;
    price: number | null;
}

export interface ExcelStructure {
    headerRow: number;
    columns: {
        description: number;
        unit: number;
        qty: number;
        price: number;
    };
    sheetName: string;
}

export async function parseExcel(buffer: ArrayBuffer, targetSheetName?: string): Promise<{ items: ExtractedExcelItem[]; structure: ExcelStructure }> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    let worksheet = targetSheetName ? workbook.getWorksheet(targetSheetName) : undefined;
    if (!worksheet) {
        // If not found or not provided, try heuristics: find "Presupuesto" or take first visible
        worksheet = workbook.worksheets.find(ws => ws.name.toLowerCase().includes('presupuesto')) || workbook.worksheets[0];
    }

    if (!worksheet) throw new Error("No worksheet found");

    // Detect Headers
    const structure: ExcelStructure = {
        headerRow: -1,
        columns: { description: -1, unit: -1, qty: -1, price: -1 },
        sheetName: worksheet.name
    };

    const KEYWORDS = {
        description: ['descripcia', 'descripcio', 'partida', 'designation', 'description', 'nombre'],
        unit: ['unidad', 'und', 'unid', 'unit', 'u.'],
        qty: ['cantidad', 'cant', 'qty', 'quantity'],
        price: ['precio', 'unitario', 'p.u', 'price', 'costo']
    };

    // Scan first 50 rows
    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber > 50 || structure.headerRow !== -1) return;

        let score = 0;
        const cols = { description: -1, unit: -1, qty: -1, price: -1 };

        row.eachCell((cell, colNumber) => {
            const val = cell.text ? cell.text.toLowerCase() : '';

            if (KEYWORDS.description.some(k => val.includes(k))) { cols.description = colNumber; score++; }
            else if (KEYWORDS.unit.some(k => val.includes(k))) { cols.unit = colNumber; score++; }
            else if (KEYWORDS.qty.some(k => val.includes(k))) { cols.qty = colNumber; score++; }
            else if (KEYWORDS.price.some(k => val.includes(k))) { cols.price = colNumber; score++; }
        });

        // If we found at least Description and one other, assume this is header
        if (cols.description !== -1 && (cols.qty !== -1 || cols.unit !== -1 || cols.price !== -1)) {
            structure.headerRow = rowNumber;
            structure.columns = cols;
        }
    });

    if (structure.headerRow === -1) {
        throw new Error("Could not detect headers in Excel. Please ensure headers like 'Descripción', 'Unidad', 'Cantidad'.");
    }

    const items: ExtractedExcelItem[] = [];

    // Extract items
    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber <= structure.headerRow) return;

        const desc = structure.columns.description !== -1 ? row.getCell(structure.columns.description).text : '';

        // Basic filter: skip empty descriptions or "Total" rows
        if (!desc || desc.trim() === '' || desc.toLowerCase().includes('total')) return;

        const unit = structure.columns.unit !== -1 ? row.getCell(structure.columns.unit).text : '';
        const qtyVal = structure.columns.qty !== -1 ? row.getCell(structure.columns.qty).value : null;
        const priceVal = structure.columns.price !== -1 ? row.getCell(structure.columns.price).value : null;

        const qty = typeof qtyVal === 'number' ? qtyVal : null;
        const price = typeof priceVal === 'number' ? priceVal : null;

        items.push({
            row: rowNumber,
            description: desc,
            unit: unit,
            qty,
            price
        });
    });

    return { items, structure };
}
