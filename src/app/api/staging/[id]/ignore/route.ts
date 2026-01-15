/**
 * API Endpoint: Ignore Item
 * 
 * P2.2: Marks item as ignored
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
                status: 'ignored',
                status_reason: 'User ignored this item',
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
        console.error('Error ignoring item:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
