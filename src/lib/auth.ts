// Authentication helper for API routes
// Validates user authentication and batch ownership

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export interface AuthValidationResult {
    authorized: boolean;
    user?: any;
    error?: NextResponse;
}

/**
 * Validates that the user is authenticated and has access to the specified batch
 * @param req - Next.js request object
 * @param batchId - Batch ID to validate ownership
 * @returns AuthValidationResult with user data or error response
 */
export async function validateBatchAccess(
    req: NextRequest,
    batchId: string
): Promise<AuthValidationResult> {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Get user from session
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
        return {
            authorized: false,
            error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        };
    }

    // Extract token from "Bearer <token>"
    const token = authHeader.replace('Bearer ', '');

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
        return {
            authorized: false,
            error: NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
        };
    }

    // 2. Validate batch ownership
    const { data: batch, error: batchError } = await supabase
        .from('batches')
        .select(`
            id,
            project_id,
            projects!inner (
                id,
                user_id
            )
        `)
        .eq('id', batchId)
        .single();

    if (batchError || !batch) {
        return {
            authorized: false,
            error: NextResponse.json({ error: 'Batch not found' }, { status: 404 })
        };
    }

    // Check if user owns the project
    const project = Array.isArray(batch.projects) ? batch.projects[0] : batch.projects;
    if (project.user_id !== user.id) {
        return {
            authorized: false,
            error: NextResponse.json({ error: 'Forbidden: You do not have access to this batch' }, { status: 403 })
        };
    }

    return {
        authorized: true,
        user
    };
}

/**
 * Simple authentication check without batch validation
 * @param req - Next.js request object
 * @returns AuthValidationResult with user data or error response
 */
export async function validateAuth(req: NextRequest): Promise<AuthValidationResult> {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
        return {
            authorized: false,
            error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        };
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
        return {
            authorized: false,
            error: NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
        };
    }

    return {
        authorized: true,
        user
    };
}
