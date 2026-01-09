import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
    if (!supabaseAdmin) {
        return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }

    try {
        const { id, updates } = await req.json();

        if (!id || !updates) {
            return NextResponse.json({ error: "Missing id or updates" }, { status: 400 });
        }

        // Whitelist of allowed fields to prevent unauthorized modifications
        const ALLOWED_FIELDS = [
            'qty_final',
            'height_factor',
            'unit_final',
            'price_selected',
            'status',
            'excel_unit'
        ];

        // Filter updates to only include allowed fields
        const sanitizedUpdates: Record<string, any> = {};
        for (const key of Object.keys(updates)) {
            if (ALLOWED_FIELDS.includes(key)) {
                sanitizedUpdates[key] = updates[key];
            }
        }

        if (Object.keys(sanitizedUpdates).length === 0) {
            return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
        }

        const { error } = await supabaseAdmin
            .from('staging_rows')
            .update(sanitizedUpdates)
            .eq('id', id);

        if (error) {
            console.error("Error updating staging row:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (e) {
        console.error("API Error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
