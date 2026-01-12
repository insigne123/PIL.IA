import { NextRequest, NextResponse } from 'next/server';
import { parseDxf, aggregateDxfItems } from '@/lib/processing/dxf';
import { parseExcel } from '@/lib/processing/excel';
import { matchItems } from '@/lib/processing/matcher';
import { ItemDetectado, Unit } from '@/types';

export const runtime = 'nodejs'; // Required for buffer/stream ops usually

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();

        const files: File[] = [];
        const planUnit = (formData.get('unit') as Unit) || 'm';
        const targetSheet = (formData.get('sheetName') as string) || undefined;
        // height is handled in staging or matcher default, here we might pass it but matcher uses constant for now

        for (const [key, value] of formData.entries()) {
            if (value instanceof File) {
                files.push(value);
            }
        }

        const excelFile = files.find(f => f.name.endsWith('.xlsx') || f.name.endsWith('.xlsm'));
        const dxfFiles = files.filter(f => f.name.endsWith('.dxf')); // TODO: DWG

        if (!excelFile) {
            return NextResponse.json({ error: "Missing Excel file" }, { status: 400 });
        }

        // 1. Parse Excel
        const excelBuffer = await excelFile.arrayBuffer();
        const { items: excelItems, structure } = await parseExcel(excelBuffer, targetSheet);

        // 2. Parse DXFs
        let allDxfItems: ItemDetectado[] = [];
        for (const file of dxfFiles) {
            const text = await file.text();
            const { items } = await parseDxf(text, planUnit);
            allDxfItems = [...allDxfItems, ...items];
        }

        // 3. Aggregate
        const aggregatedDxfItems = aggregateDxfItems(allDxfItems);

        // 4. Match
        const stagingRows = matchItems(excelItems, aggregatedDxfItems, structure.sheetName);

        // 5. Identify Unmatched CAD Items (for "Detected but not used" list - Optional for MVP)
        // logic: filter aggregatedDxfItems that are not in any stagingRow.matched_items

        return NextResponse.json({
            success: true,
            data: {
                stagingRows,
                structure: structure, // Return header info for writer
                stats: {
                    excelRows: excelItems.length,
                    dxfItems: aggregatedDxfItems.length,
                    matched: stagingRows.filter(r => (r.matched_items?.length ?? 0) > 0).length
                }
            }
        });

    } catch (e: any) {
        console.error("Processing Error", e);
        return NextResponse.json({ error: e.message || "Internal Server Error" }, { status: 500 });
    }
}
