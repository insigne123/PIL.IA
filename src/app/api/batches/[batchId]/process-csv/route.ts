/**
 * Special processing endpoint for batches with CSV Takeoff files
 * This bypasses the worker system and processes directly
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { parseExcel } from '@/lib/processing/excel';
import { parseTakeoffCSV } from '@/lib/processing/csv-takeoff';
import { matchExcelToCSV } from '@/lib/processing/csv-matcher';
import { buildDXFContext } from '@/lib/processing/dxf-text-extractor';

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ batchId: string }> }
) {
    const { batchId } = await params;

    try {
        console.log(`[CSV Process] Starting CSV Takeoff processing for batch ${batchId}`);

        // 1. Get batch files
        const { data: files, error: filesError } = await supabase
            .from('batch_files')
            .select('*')
            .eq('batch_id', batchId);

        if (filesError || !files) {
            return NextResponse.json({ error: 'Failed to fetch files' }, { status: 500 });
        }

        const csvFile = files.find(f => f.file_type === 'csv');
        const excelFile = files.find(f => f.file_type === 'excel');
        const dxfFile = files.find(f => f.file_type === 'dxf');

        if (!csvFile || !excelFile) {
            return NextResponse.json({ error: 'CSV and Excel files required' }, { status: 400 });
        }

        // 2. Download files from storage
        const { data: csvData } = await supabase.storage
            .from('yago-source')
            .download(csvFile.storage_path);

        const { data: excelData } = await supabase.storage
            .from('yago-source')
            .download(excelFile.storage_path);

        if (!csvData || !excelData) {
            return NextResponse.json({ error: 'Failed to download files' }, { status: 500 });
        }

        // 3. Parse CSV
        const csvText = await csvData.text();
        const takeoffResult = await parseTakeoffCSV(csvText);

        console.log(`[CSV Process] Parsed CSV: ${takeoffResult.totalLayers} layers`);

        // 4. Parse Excel
        const excelBuffer = await excelData.arrayBuffer();
        const { items: excelItems, structure } = await parseExcel(excelBuffer);

        console.log(`[CSV Process] Parsed Excel: ${excelItems.length} items`);

        // 5. Optional: Build DXF context if DXF exists
        let dxfContext;
        if (dxfFile) {
            const { data: dxfData } = await supabase.storage
                .from('yago-source')
                .download(dxfFile.storage_path);

            if (dxfData) {
                const dxfText = await dxfData.text();
                dxfContext = buildDXFContext(dxfText);
                console.log(`[CSV Process] Built DXF context: ${dxfContext.summary.totalBlocks} blocks`);
            }
        }

        // 6. Match Excel to CSV
        const stagingRows = matchExcelToCSV(
            excelItems,
            takeoffResult.index,
            structure.sheetName,
            dxfContext
        );

        console.log(`[CSV Process] Matched ${stagingRows.length} rows`);

        // 7. Save to database
        const rowsToInsert = stagingRows.map(row => ({
            ...row,
            batch_id: batchId,
        }));

        const { error: insertError } = await supabase
            .from('staging_rows')
            .insert(rowsToInsert);

        if (insertError) {
            console.error('[CSV Process] Insert error:', insertError);
            return NextResponse.json({ error: 'Failed to save staging rows' }, { status: 500 });
        }

        // 8. Update batch status to ready
        await supabase
            .from('batches')
            .update({ status: 'ready' })
            .eq('id', batchId);

        // 9. Mark files as extracted
        await supabase
            .from('batch_files')
            .update({ status: 'extracted' })
            .eq('batch_id', batchId);

        console.log(`[CSV Process] ✅ Complete`);

        return NextResponse.json({
            success: true,
            stagingRowsCount: stagingRows.length,
        });

    } catch (error: any) {
        console.error('[CSV Process] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
