import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(
    request: NextRequest,
    { params }: { params: { batchId: string } }
) {
    const batchId = params.batchId;

    try {
        // Fetch all diagnostic data
        const { data: batch } = await supabase
            .from('batches')
            .select('*')
            .eq('id', batchId)
            .single();

        const { data: files } = await supabase
            .from('batch_files')
            .select('*')
            .eq('batch_id', batchId);

        const { data: stagingRows } = await supabase
            .from('staging_rows')
            .select('*')
            .eq('batch_id', batchId)
            .order('excel_row_index', { ascending: true });

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
                    : '0%'
            }
        };

        return NextResponse.json(diagnostic, {
            headers: {
                'Content-Disposition': `attachment; filename="diagnostic_${batchId}.json"`,
                'Content-Type': 'application/json'
            }
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
