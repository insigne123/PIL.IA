import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { validateBatchAccess } from '@/lib/auth';
import { validateSourceItems, validatePriceSources } from '@/lib/validation';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function GET(req: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
    try {
        const { batchId } = await params;

        // Note: Skipping auth validation for diagnostic route
        // This is a read-only diagnostic endpoint
        // In production, you may want to add auth back

        // Fetch batch data
        const { data: batch, error: batchError } = await supabase
            .from('batches')
            .select('*')
            .eq('id', batchId)
            .single();

        if (batchError || !batch) {
            return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
        }

        // Fetch all diagnostic data
        const { data: files } = await supabase
            .from('batch_files')
            .select('*')
            .eq('batch_id', batchId);

        const { data: stagingRows } = await supabase
            .from('staging_rows')
            .select('*')
            .eq('batch_id', batchId)
            .order('excel_row_index', { ascending: true });

        // Validate JSONB fields
        const validatedRows = stagingRows?.map(row => {
            const validatedSourceItems = validateSourceItems(row.source_items);
            const validatedPriceSources = validatePriceSources(row.price_sources);

            if (!validatedSourceItems && row.source_items) {
                console.warn(`Invalid source_items for row ${row.id}`);
            }
            if (!validatedPriceSources && row.price_sources) {
                console.warn(`Invalid price_sources for row ${row.id}`);
            }

            return {
                ...row,
                source_items: validatedSourceItems || [],
                price_sources: validatedPriceSources || []
            };
        });

        const { data: excelMap } = await supabase
            .from('excel_maps')
            .select('*')
            .eq('batch_id', batchId)
            .single();

        // Build diagnostic report
        const diagnostic = {
            metadata: {
                batch_id: batchId,
                batch_name: batch?.name,
                unit_selected: batch?.unit_selected,
                height_default: batch?.height_default,
                status: batch?.status,
                created_at: batch?.created_at,
                total_rows: stagingRows?.length || 0,
            },
            files: files?.map(f => ({
                filename: f.original_filename,
                type: f.file_type,
                status: f.status,
                detected_unit: f.detected_unit,
                error: f.error_message
            })),
            excel_structure: excelMap ? {
                sheet: excelMap.sheet_name,
                header_row: excelMap.header_row,
                columns: {
                    description: excelMap.col_desc,
                    unit: excelMap.col_unit,
                    qty: excelMap.col_qty,
                    price: excelMap.col_price
                }
            } : null,
            matches: stagingRows?.map(row => ({
                row_index: row.excel_row_index,
                excel_item: row.excel_item_text,
                excel_unit: row.excel_unit,
                matched_layer: row.source_items?.[0]?.layer_normalized || null,
                matched_type: row.source_items?.[0]?.type || null,
                confidence: row.confidence,
                match_reason: row.match_reason,
                qty_final: row.qty_final,
                status: row.status,
                source_items_count: row.source_items?.length || 0,
                source_items: row.source_items,
                // Pricing information
                pricing: {
                    unit_price: row.unit_price_ref,
                    total_price: row.total_price_ref,
                    sources: row.price_sources,
                    confidence: row.price_confidence,
                    has_pricing: !!row.unit_price_ref
                }
            })),
            // Summary statistics
            summary: {
                total_items: stagingRows?.length || 0,
                items_with_pricing: stagingRows?.filter(r => r.unit_price_ref).length || 0,
                items_without_pricing: stagingRows?.filter(r => !r.unit_price_ref).length || 0,
                pricing_coverage: stagingRows?.length
                    ? ((stagingRows.filter(r => r.unit_price_ref).length / stagingRows.length) * 100).toFixed(1) + '%'
                    : '0%',
                // Match quality breakdown
                match_quality: {
                    high_confidence: stagingRows?.filter(r => r.confidence === 'high').length || 0,
                    medium_confidence: stagingRows?.filter(r => r.confidence === 'medium').length || 0,
                    low_confidence: stagingRows?.filter(r => r.confidence === 'low').length || 0,
                    approved: stagingRows?.filter(r => r.status === 'approved').length || 0,
                    pending: stagingRows?.filter(r => r.status === 'pending').length || 0
                },
                // Pricing quality breakdown
                pricing_quality: {
                    high_confidence: stagingRows?.filter(r => r.price_confidence === 'high').length || 0,
                    medium_confidence: stagingRows?.filter(r => r.price_confidence === 'medium').length || 0,
                    low_confidence: stagingRows?.filter(r => r.price_confidence === 'low').length || 0
                },
                // Type distribution
                type_distribution: {
                    blocks: stagingRows?.filter(r => r.source_items?.[0]?.type === 'block').length || 0,
                    lengths: stagingRows?.filter(r => r.source_items?.[0]?.type === 'length').length || 0,
                    texts: stagingRows?.filter(r => r.source_items?.[0]?.type === 'text').length || 0
                }
            },
            // Data quality indicators for AI analysis
            quality_indicators: {
                // Items with fractional quantities on block types (potential bug)
                fractional_block_quantities: stagingRows?.filter(r =>
                    r.qty_final && !Number.isInteger(r.qty_final) && r.source_items?.[0]?.type === 'block'
                ).map(r => ({
                    row_index: r.excel_row_index,
                    item: r.excel_item_text,
                    qty: r.qty_final
                })) || [],
                // Items with pricing but no valid URL sources
                pricing_without_urls: stagingRows?.filter(r =>
                    r.unit_price_ref && (!r.price_sources || !r.price_sources.some((s: any) => s.url?.startsWith('http')))
                ).map(r => ({
                    row_index: r.excel_row_index,
                    item: r.excel_item_text
                })) || [],
                // "Punto de" items for kit analysis
                point_items: stagingRows?.filter(r =>
                    r.excel_item_text?.toLowerCase().includes('punto')
                ).map(r => ({
                    row_index: r.excel_row_index,
                    item: r.excel_item_text,
                    unit_price: r.unit_price_ref
                })) || []
            },
            // System metadata
            system_info: {
                export_timestamp: new Date().toISOString(),
                files_processed: files?.length || 0
            }
        };

        return NextResponse.json(diagnostic, {
            headers: {
                'Content-Disposition': `attachment; filename = "diagnostic_${batchId}.json"`,
                'Content-Type': 'application/json'
            }
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
