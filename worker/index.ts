import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { executeJob } from './pipeline';

// Load env from .env.local
// Load env from .env
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing Supabase credentials in .env.local");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '3');

async function loop() {
    console.log("Worker started. Polling for jobs...");
    while (true) {
        try {
            // 1. Fetch pending job
            const { data: jobs, error } = await supabase
                .from('jobs')
                .select('*')
                .eq('status', 'queued')
                .order('created_at', { ascending: true })
                .limit(1);

            if (error) {
                console.error("Error fetching jobs:", error);
                await sleep(5000);
                continue;
            }

            if (!jobs || jobs.length === 0) {
                await sleep(2000); // Idle wait
                continue;
            }

            const job = jobs[0];

            // 2. Check Batch Concurrency
            // Join batch_files to get batch_id (mocked here by assuming we can look it up or adding it to jobs)
            // Ideally jobs should have batch_id or we fetch it.
            // For MVP, simplistic check or skip.
            // Let's implement strict locking.

            // Lock the job
            const { error: lockError } = await supabase
                .from('jobs')
                .update({ status: 'processing', locked_at: new Date().toISOString() })
                .eq('id', job.id)
                .eq('status', 'queued'); // Optimistic lock

            if (lockError) {
                // Someone else took it
                continue;
            }

            console.log(`Processing Job ${job.id} (${job.phase})...`);

            // 3. Execute Pipeline
            try {
                await executeJob(supabase, job);

                // Success
                await supabase.from('jobs').update({ status: 'completed' }).eq('id', job.id);
                console.log(`Job ${job.id} completed.`);
            } catch (e: any) {
                console.error(`Job ${job.id} failed:`, e);
                await supabase.from('jobs').update({ status: 'failed', last_error: e.message }).eq('id', job.id);
            }

        } catch (e) {
            console.error("Worker Loop Error", e);
            await sleep(5000);
        }
    }
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

loop();
