import ExcelJS from 'exceljs';
import { StagingRow } from '@/types';
import { ExcelStructure } from './excel';

export async function writeExcel(originalBuffer: ArrayBuffer, rows: StagingRow[], structure: ExcelStructure): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(originalBuffer);

    const worksheet = workbook.getWorksheet(structure.sheetName);
    if (!worksheet) throw new Error(`Worksheet ${structure.sheetName} not found`);

    for (const row of rows) {
        if (row.status === 'ignored') continue;

        const excelRow = worksheet.getRow(row.excel_row_index);

        // Write Qty
        if (structure.columns.qty !== -1) {
            excelRow.getCell(structure.columns.qty).value = row.qty_final;
        }

        // Write Price
        if (structure.columns.price !== -1 && row.price_selected !== undefined) {
            excelRow.getCell(structure.columns.price).value = row.price_selected;
        }

        // Write Unit if empty
        if (structure.columns.unit !== -1 && row.excel_unit) {
            const cell = excelRow.getCell(structure.columns.unit);
            if (!cell.value) {
                cell.value = row.excel_unit;
            }
        }

        // Optional: Add comment or color to indicate auto-fill
        if (structure.columns.qty !== -1) {
            // excelRow.getCell(structure.columns.qty).note = "Auto-filled by YAGO";
        }
    }

    // Return buffer
    const buffer = await workbook.xlsx.writeBuffer();
    return buffer as Buffer;
}
