import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ batchId: string }> }
) {
    const { batchId } = await params;

    if (!supabaseAdmin) {
        return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }

    try {
        console.log(`[Reset] Resetting batch ${batchId}...`);

        // 1. Delete Staging Rows
        const { error: stagingError } = await supabaseAdmin
            .from('staging_rows')
            .delete()
            .eq('batch_id', batchId);

        if (stagingError) {
            console.error("Error deleting staging rows:", stagingError);
            return NextResponse.json({ error: stagingError.message }, { status: 500 });
        }

        // 2. Delete Excel Maps (optional, but safer to re-detect)
        await supabaseAdmin
            .from('excel_maps')
            .delete()
            .eq('batch_id', batchId);

        // 3. Delete Jobs associated with batch files
        // First get batch files IDs
        const { data: files } = await supabaseAdmin
            .from('batch_files')
            .select('id')
            .eq('batch_id', batchId);

        if (files && files.length > 0) {
            const fileIds = files.map(f => f.id);
            await supabaseAdmin
                .from('jobs')
                .delete()
                .in('batch_file_id', fileIds);
        }

        // 4. Reset Batch Files status
        await supabaseAdmin
            .from('batch_files')
            .update({
                status: 'uploaded',
                error_message: null,
                error_code: null
            })
            .eq('batch_id', batchId);

        // 5. Reset Batch status
        await supabaseAdmin
            .from('batches')
            .update({ status: 'pending' })
            .eq('id', batchId);

        console.log(`[Reset] Batch ${batchId} reset successfully.`);
        return NextResponse.json({ success: true });

    } catch (e: any) {
        console.error("Reset Error:", e);
        return NextResponse.json({ error: e.message || "Internal Server Error" }, { status: 500 });
    }
}
