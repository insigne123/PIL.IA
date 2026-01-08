import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { StagingRow } from '@/types';

export async function generateHeatmapPdf(rows: StagingRow[], batchName: string): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontSize = 10;

    let y = height - 50;

    page.drawText(`Reporte de Revisión (Heatmap): ${batchName}`, { x: 50, y, size: 18, font, color: rgb(0, 0, 0) });
    y -= 30;

    page.drawText(`Leyenda: Verde (Aprobado), Naranja (Pendiente), Rojo (Baja Confianza)`, { x: 50, y, size: 10, font, color: rgb(0.5, 0.5, 0.5) });
    y -= 30;

    for (const row of rows) {
        if (y < 50) { page = pdfDoc.addPage(); y = height - 50; }

        let color = rgb(0, 0, 0);
        if (row.status === 'approved') color = rgb(0, 0.6, 0); // Green
        else if (row.confidence === 'low') color = rgb(0.8, 0, 0); // Red
        else color = rgb(0.8, 0.6, 0); // Orange

        const text = `${row.excel_row_index}. ${row.excel_item_text.substring(0, 80)}... | Qty: ${row.qty_final} ${row.excel_unit}`;

        page.drawRectangle({ x: 30, y: y - 2, width: 10, height: 10, color });
        page.drawText(text, { x: 50, y, size: fontSize, font, color: rgb(0, 0, 0) });

        y -= 15;
    }

    return pdfDoc.save();
}
