import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
    // Note: In Next.js 15, params is a Promise
    const { batchId } = await params;

    if (!supabaseAdmin) {
        return NextResponse.json({ error: "Server misconfigured (missing service role key)" }, { status: 500 });
    }

    // 1. Get files ready for processing
    const { data: files, error: filesError } = await supabaseAdmin
        .from('batch_files')
        .select('id, file_type')
        .eq('batch_id', batchId)
        .eq('status', 'uploaded');

    if (filesError) {
        return NextResponse.json({ error: filesError.message }, { status: 500 });
    }

    if (!files || files.length === 0) {
        return NextResponse.json({ message: "No new files to process" }, { status: 200 });
    }

    // 2. Create Jobs and Update File Status
    const jobsToInsert = files.map(f => ({
        batch_file_id: f.id,
        phase: f.file_type === 'dwg' ? 'CONVERT' : 'EXTRACT',
        status: 'queued'
    }));

    const { error: jobsError } = await supabaseAdmin
        .from('jobs')
        .insert(jobsToInsert);

    if (jobsError) {
        return NextResponse.json({ error: jobsError.message }, { status: 500 });
    }

    const { error: updateError } = await supabaseAdmin
        .from('batch_files')
        .update({ status: 'queued' })
        .in('id', files.map(f => f.id));

    if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    const { error: batchUpdateError } = await supabaseAdmin
        .from('batches')
        .update({ status: 'processing' })
        .eq('id', batchId);

    if (batchUpdateError) {
        console.error("Warning: Could not update batch status", batchUpdateError);
    }

    return NextResponse.json({ success: true, count: files.length });
}
