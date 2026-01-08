import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
    const { batchId } = await params;

    if (!supabaseAdmin) {
        return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }

    // 1. Find the Excel file for this batch
    const { data: excelFile, error: fileError } = await supabaseAdmin
        .from('batch_files')
        .select('id')
        .eq('batch_id', batchId)
        .eq('file_type', 'excel')
        .single();

    if (fileError || !excelFile) {
        return NextResponse.json({ error: "No Excel file found in this batch" }, { status: 400 });
    }

    // 2. Queue Generation Job
    const { error: jobError } = await supabaseAdmin
        .from('jobs')
        .insert({
            batch_file_id: excelFile.id,
            phase: 'GENERATE',
            status: 'queued'
        });

    if (jobError) {
        return NextResponse.json({ error: jobError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "Generation queued" });
}
