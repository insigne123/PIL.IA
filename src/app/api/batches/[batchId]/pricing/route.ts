
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { findPriceFlow } from '@/ai/find-prices';
import { validateBatchAccess } from '@/lib/auth';

// Initialize Supabase Client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ batchId: string }> }
) {
    const { batchId } = await params;

    // Note: Skipping auth validation for development
    // In production, implement proper cookie-based auth

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
    // Configurable via environment variable for flexibility
    const CHUNK_SIZE = parseInt(process.env.PRICING_CHUNK_SIZE || '3', 10);
    let processedCount = 0;
    const failedItems: Array<{ item: string; error: string }> = [];

    // Helper to process one item
    const processItem = async (item: any) => {
        try {
            // Debug logging
            console.log('Processing item:', {
                id: item.id,
                excel_item_text: item.excel_item_text,
                excel_unit: item.excel_unit,
                has_text: !!item.excel_item_text
            });

            // Validate required fields
            if (!item.excel_item_text || item.excel_item_text.trim() === '') {
                console.warn(`Skipping item ${item.id}: empty description`);
                failedItems.push({ item: item.id, error: 'Empty item description' });
                return;
            }

            // Determine Pricing Mode
            const desc = (item.excel_item_text || '').toLowerCase();
            const unit = (item.excel_unit || '').toLowerCase().trim();

            let mode: 'material' | 'service' | 'mixed' = 'material'; // Default logic

            // Heuristic to detect services
            if (
                ['gl', 'glb', 'global', 'est', 'est.'].includes(unit) ||
                desc.includes('instalacion') || desc.includes('instalación') ||
                desc.includes('tramite') || desc.includes('inscripcion') ||
                desc.includes('certificado') || desc.includes('legaliz') ||
                desc.includes('mano de obra')
            ) {
                mode = 'service';
            }

            // Heuristic for mixed (e.g. Point + Install, but usually we want materials for points first)
            // Keeping it simple: Points -> Material (to get the cost of components)

            const priceResult = await findPriceFlow({
                item_description: item.excel_item_text, // ✅ Fixed: was excel_item
                item_unit: item.excel_unit || '',
                country: 'Chile',
                pricing_mode: mode
            });

            if (priceResult.found) {
                // Validate and filter sources with valid URLs
                const validSources = priceResult.sources.filter(s =>
                    s.url &&
                    s.url.trim() !== '' &&
                    s.url !== 'null' &&
                    s.url.startsWith('http')
                );

                // Use MINIMUM price from sources (best price for user)
                const minPrice = priceResult.sources.length > 0
                    ? Math.min(...priceResult.sources.map(s => s.price))
                    : priceResult.average_price;

                // Calculate average for metadata
                const avgPrice = priceResult.sources.length > 0
                    ? priceResult.sources.reduce((sum, s) => sum + s.price, 0) / priceResult.sources.length
                    : priceResult.average_price;

                // Check if AI average differs significantly from min
                const priceDifference = Math.abs(priceResult.average_price - minPrice);
                const percentageDiff = minPrice > 0 ? (priceDifference / minPrice) * 100 : 0;

                // Adjust confidence if sources lack URLs
                let finalConfidence = priceResult.confidence;
                if (validSources.length === 0) {
                    console.warn(`Item ${item.excel_item_text}: No sources with valid URLs. Lowering confidence.`);
                    finalConfidence = 'low';
                } else if (validSources.length < priceResult.sources.length) {
                    console.warn(`Item ${item.excel_item_text}: Some sources missing URLs (${validSources.length}/${priceResult.sources.length})`);
                    if (finalConfidence === 'high') finalConfidence = 'medium';
                }

                // Lower confidence if only 1 source
                if (priceResult.sources.length === 1) {
                    console.warn(`Item ${item.excel_item_text}: Only 1 source found`);
                    if (finalConfidence === 'high') finalConfidence = 'medium';
                }

                // Create metadata for auditing
                const priceMetadata = {
                    ai_suggested_price: priceResult.average_price,
                    minimum_price: Math.round(minPrice),
                    average_price: Math.round(avgPrice),
                    source_count: priceResult.sources.length,
                    valid_source_count: validSources.length,
                    calculation_method: 'minimum_from_sources',
                    price_range: priceResult.sources.length > 0 ? {
                        min: Math.min(...priceResult.sources.map(s => s.price)),
                        max: Math.max(...priceResult.sources.map(s => s.price))
                    } : null
                };

                // Update DB with minimum price (best for user)
                await supabase.from('staging_rows').update({
                    unit_price_ref: Math.round(minPrice),
                    total_price_ref: Math.round(minPrice) * (item.qty_final ?? 0),
                    price_sources: validSources, // Only save sources with valid URLs
                    price_confidence: finalConfidence
                    // price_metadata: priceMetadata // TODO: Add migration for this column
                }).eq('id', item.id);

                const maxPrice = priceResult.sources.length > 0 ? Math.max(...priceResult.sources.map(s => s.price)) : minPrice;
                console.log(`[Pricing] ${item.excel_item_text}: $${Math.round(minPrice).toLocaleString('es-CL')} (min of ${priceResult.sources.length} sources, range: $${Math.round(minPrice).toLocaleString('es-CL')}-$${Math.round(maxPrice).toLocaleString('es-CL')})`);
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
