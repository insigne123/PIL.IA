
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { findPriceFlow } from '@/ai/find-prices';

// Initialize Supabase Client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ batchId: string }> }
) {
    const { batchId } = await params;

    // 1. Get items to price
    // Filter items that have a match ('approved' or 'pending') but no price yet
    const { data: items, error } = await supabase
        .from('staging_rows')
        .select('*')
        .eq('batch_id', batchId)
        .or('status.eq.approved,status.eq.pending') // Only price matched items
        .is('unit_price_ref', null);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!items || items.length === 0) {
        return NextResponse.json({ message: "No items to price", count: 0 });
    }

    console.log(`Starting price search for ${items.length} items...`);

    // 2. Process in parallel chunks (limit concurrency)
    const CHUNK_SIZE = 3;
    let processedCount = 0;
    const failedItems: Array<{ item: string; error: string }> = [];

    // Helper to process one item
    const processItem = async (item: any) => {
        try {
            const priceResult = await findPriceFlow({
                item_description: item.excel_item_text, // ✅ Fixed: was excel_item
                item_unit: item.excel_unit,
                country: 'Chile'
            });

            if (priceResult.found) {
                // Update DB
                await supabase.from('staging_rows').update({
                    unit_price_ref: priceResult.average_price,
                    total_price_ref: priceResult.average_price * item.qty_final,
                    price_sources: priceResult.sources,
                    price_confidence: priceResult.confidence
                }).eq('id', item.id);
                processedCount++;
            } else {
                failedItems.push({ item: item.excel_item_text, error: 'No prices found' });
            }
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Unknown error';
            console.error(`Failed to price item ${item.excel_item_text}:`, err);
            failedItems.push({ item: item.excel_item_text, error: errorMsg });
        }
    };

    // Run in chunks
    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
        const chunk = items.slice(i, i + CHUNK_SIZE);
        await Promise.all(chunk.map(processItem));
    }

    return NextResponse.json({
        success: true,
        message: `Pricing complete. Processed ${processedCount}/${items.length} items.`,
        failed: failedItems.length > 0 ? failedItems : undefined
    });
}
