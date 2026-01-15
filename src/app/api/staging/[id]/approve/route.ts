/**
 * API Endpoint: Approve Staging Item
 * 
 * P2.2: Approves current match and saves to learning system
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { saveMapping } from '@/lib/processing/learning-system';

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        // Get the staging row
        const { data: row, error: fetchError } = await supabase
            .from('staging')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchError || !row) {
            return NextResponse.json(
                { error: 'Staging item not found' },
                { status: 404 }
            );
        }

        // Update status to approved
        const { error: updateError } = await supabase
            .from('staging')
            .update({
                status: 'approved',
                updated_at: new Date().toISOString()
            })
            .eq('id', id);

        if (updateError) {
            return NextResponse.json(
                { error: 'Failed to update status' },
                { status: 500 }
            );
        }

        // Save to learning system if there's a match
        if (row.source_items && row.source_items.length > 0) {
            const userId = row.user_id || 'system'; // Get from auth if available

            await saveMapping({
                userId,
                excelDescription: row.excel_item_text,
                excelUnit: row.excel_unit,
                dxfLayer: row.source_items[0].layer_normalized,
                dxfType: row.source_items[0].type,
                confidence: row.match_confidence || 0.5,
                discipline: row.discipline,
                excelSubtype: row.excel_subtype
            });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error approving item:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
