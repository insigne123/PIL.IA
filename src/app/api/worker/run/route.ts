import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { executeJob } from '../../../../../worker/pipeline';

// Configure for long running - This works on Vercel Pro / Netlify / Cloud Run
// On Firebase/Google Cloud Functions, timeouts are configured in firebase.json
export const maxDuration = 300; // 5 minutes
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    if (!supabaseAdmin) {
        return NextResponse.json({ error: "Server config missing" }, { status: 500 });
    }

    // 1. Fetch pending job (FIFO)
    const { data: jobs, error } = await supabaseAdmin
        .from('jobs')
        .select('*')
        .eq('status', 'queued')
        .order('created_at', { ascending: true })
        .limit(1);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!jobs || jobs.length === 0) {
        return NextResponse.json({ message: "No jobs pending" }, { status: 200 });
    }

    const job = jobs[0];

    // 2. Lock Job
    const { error: lockError } = await supabaseAdmin
        .from('jobs')
        .update({
            status: 'processing',
            locked_at: new Date().toISOString()
        })
        .eq('id', job.id)
        .eq('status', 'queued'); // Optimistic Lock

    if (lockError) {
        return NextResponse.json({ message: "Job locked by another worker" }, { status: 409 });
    }

    console.log(`Processing Job ${job.id} (${job.phase})...`);

    // 3. Execute
    try {
        await executeJob(supabaseAdmin, job);

        await supabaseAdmin.from('jobs').update({ status: 'completed' }).eq('id', job.id);

        // Optional: Trigger next job recursively?
        // Ideally we return "hasMore: true" and client triggers again, 
        // OR we use a cron to clean up.
        // For MVP manual trigger from UI loop is safer vs infinite recursion server-side.

        // One exception: Check if we need to trigger MAP/GENERATE directly?
        // executeJob already handles some chaining logic (checkAndTriggerMatching).

        // Wait... executeJob in `pipeline.ts` calls `executeMapping` which is just a function call.
        // It runs IN THIS PROCESS. So it's fine.

        return NextResponse.json({ success: true, job: job.id, phase: job.phase });

    } catch (e: any) {
        console.error(`Job ${job.id} failed:`, e);
        await supabaseAdmin.from('jobs').update({ status: 'failed', last_error: e.message }).eq('id', job.id);
        return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
}
