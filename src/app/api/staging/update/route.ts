import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
    if (!supabaseAdmin) {
        return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }

    try {
        const body = await req.json();
        const { id, updates } = body;

        if (!id || !updates) {
            return NextResponse.json({ error: "Missing id or updates" }, { status: 400 });
        }

        // Only allow updating certain fields for security
        // In a real app we would validate 'updates' object strictly
        const allowedUpdates = {
            qty_final: updates.qty_final,
            height_factor: updates.height_factor,
            status: updates.status,
            price_selected: updates.price_selected
        };

        const { error } = await supabaseAdmin
            .from('staging_rows')
            .update(allowedUpdates)
            .eq('id', id);

        if (error) {
            console.error("Error updating staging row:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true });

    } catch (e: any) {
        console.error("API Error:", e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
