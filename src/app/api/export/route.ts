import { NextRequest, NextResponse } from 'next/server';
import { writeExcel } from '@/lib/processing/writer';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();

        const file = formData.get('file') as File;
        const rowsJson = formData.get('rows') as string;
        const structureJson = formData.get('structure') as string;

        if (!file || !rowsJson || !structureJson) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        const rows = JSON.parse(rowsJson);
        const structure = JSON.parse(structureJson);
        const buffer = await file.arrayBuffer();

        const modifiedBuffer = await writeExcel(buffer, rows, structure);

        return new NextResponse(modifiedBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="procesado_${file.name}"`
            }
        });

    } catch (e: any) {
        console.error("Export Error", e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
