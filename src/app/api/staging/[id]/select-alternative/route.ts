/**
 * API Endpoint: Select Alternative Candidate
 * 
 * P2.2: Selects an alternative layer from top candidates
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
        const { layerName } = await req.json();

        if (!layerName) {
            return NextResponse.json(
                { error: 'Layer name is required' },
                { status: 400 }
            );
        }

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

        // Find the selected candidate
        const candidate = row.top_candidates?.find(
            (c: any) => c.layer === layerName
        );

        if (!candidate) {
            return NextResponse.json(
                { error: 'Candidate not found' },
                { status: 404 }
            );
        }

        // Calculate new quantity from candidate geometry
        let newQty = 0;
        if (candidate.geometry) {
            if (candidate.geometry.area) newQty = candidate.geometry.area;
            else if (candidate.geometry.length) newQty = candidate.geometry.length;
            else if (candidate.geometry.blocks) newQty = candidate.geometry.blocks;
        }

        // Update with new selection
        const { error: updateError } = await supabase
            .from('staging')
            .update({
                source_items: [{
                    layer_normalized: layerName,
                    type: candidate.type,
                    ...candidate
                }],
                qty_final: newQty,
                match_confidence: candidate.score,
                match_reason: `User selected "${layerName}" (${(candidate.score * 100).toFixed(0)}%)`,
                status: 'approved',
                updated_at: new Date().toISOString()
            })
            .eq('id', id);

        if (updateError) {
            return NextResponse.json(
                { error: 'Failed to update selection' },
                { status: 500 }
            );
        }

        // Save to learning system
        const userId = row.user_id || 'system';
        await saveMapping({
            userId,
            excelDescription: row.excel_item_text,
            excelUnit: row.excel_unit,
            dxfLayer: layerName,
            dxfType: candidate.type,
            confidence: candidate.score,
            discipline: row.discipline,
            excelSubtype: row.excel_subtype
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error selecting alternative:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
