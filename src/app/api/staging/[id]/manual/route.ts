/**
 * API Endpoint: Mark as Manual Entry
 * 
 * P2.2: Marks item for manual quantity entry
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        const { error } = await supabase
            .from('staging')
            .update({
                status: 'pending',
                status_reason: 'Marked for manual quantity entry',
                match_reason: 'User requested manual entry',
                updated_at: new Date().toISOString()
            })
            .eq('id', id);

        if (error) {
            return NextResponse.json(
                { error: 'Failed to update status' },
                { status: 500 }
            );
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error marking as manual:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
