/**
 * P2.10: Regression Runner API (Enhanced)
 * 
 * Compares computed quantities against expected values from staging rows
 * to generate error reports and identify top errors.
 * 
 * Fields designed for self-diagnosing without checking logs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

interface LayerStats {
    area_total_m2: number | null;
    length_total_m: number | null;
    block_count: number | null;
}

interface RegressionError {
    // Row identification
    rowIndex: number;
    itemName: string;
    unit: string;

    // Quantity comparison
    expectedQty: number | null;
    predictedQty: number | null;
    absError: number;
    pctError: number | null;

    // Match details
    matchedLayer: string | null;
    matchedType: 'area' | 'length' | 'block' | 'text' | 'none';
    calcMethod: string | null;

    // Layer geometry (why this qty?)
    layerStats: LayerStats | null;

    // Status/reason
    status: string;
    matchReason: string | null;
    warnings: string[] | null;
}

interface RegressionReport {
    batchId: string;
    totalItems: number;
    itemsCompared: number;
    topErrors: RegressionError[];
    // P0.5: Suspects = m² items with invalid evidence (text/block)
    suspects: RegressionError[];
    summary: {
        avgAbsError: number;
        avgPctError: number; // Only for items WITH expected values
        itemsWithLargeError: number; // >20% error OR exceeds unit threshold
        itemsWithNoComputed: number;
        itemsWithNoExpected: number; // New: rows where we can't calc pct
        // Unit-based outlier thresholds
        outliersByUnit: {
            m2: number; // absError > 50
            ml: number; // absError > 20
            un: number; // absError > 5
        };
        suspectsCount: number; // P0.5: Count of m² with text/block
    };
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ batchId: string }> }
) {
    try {
        const { batchId } = await params;

        // Fetch staging rows for this batch
        const { data: stagingRows, error } = await supabase
            .from('staging_rows')
            .select('*')
            .eq('batch_id', batchId)
            .order('excel_row_index', { ascending: true });

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        if (!stagingRows || stagingRows.length === 0) {
            return NextResponse.json({ error: 'No staging rows found for batch' }, { status: 404 });
        }

        // Calculate errors for each row
        const errors: RegressionError[] = [];
        let totalAbsError = 0;
        let totalPctError = 0;
        let pctErrorCount = 0;
        let noComputedCount = 0;
        let noExpectedCount = 0;
        let largeErrorCount = 0;
        // P0 Fix 4: Unit-based outlier counters
        const outliersByUnit = { m2: 0, ml: 0, un: 0 };

        for (const row of stagingRows) {
            // Skip title/section header rows
            if (row.row_type === 'section_header' || row.row_type === 'title' || row.status === 'title') {
                continue;
            }

            const expected = row.excel_qty_original ?? null;
            const computed = row.qty_final ?? null;
            const unit = (row.excel_unit || '').toLowerCase();

            // Calculate errors
            let absError = 0;
            let pctError: number | null = null;

            if (computed === null) {
                noComputedCount++;
                absError = expected ?? 0;
            } else if (expected !== null && expected !== 0) {
                absError = Math.abs(computed - expected);
                pctError = (absError / Math.abs(expected)) * 100;
                totalPctError += pctError;
                pctErrorCount++;

                if (pctError > 20) {
                    largeErrorCount++;
                }
            } else {
                // Expected was empty/zero or null - can't calculate pct
                noExpectedCount++;
                if (computed !== null) {
                    absError = Math.abs(computed);

                    // P0 Fix 4: Use unit-based thresholds when no expected value
                    if (unit.includes('m2') || unit === 'm²') {
                        if (absError > 50) { outliersByUnit.m2++; largeErrorCount++; }
                    } else if (unit === 'ml' || unit === 'm') {
                        if (absError > 20) { outliersByUnit.ml++; largeErrorCount++; }
                    } else if (unit === 'un' || unit === 'u' || unit === 'gl') {
                        if (absError > 5) { outliersByUnit.un++; largeErrorCount++; }
                    }
                }
            }

            totalAbsError += absError;

            // Only add to errors list if there's meaningful difference
            if (absError > 0.01 || computed === null) {
                // Extract matched item info (first source item if exists)
                const sourceItems = row.source_items || row.matched_items || [];
                const topCandidate = row.top_candidates?.[0];
                const firstMatch = sourceItems[0];

                // Determine matched type
                let matchedType: 'area' | 'length' | 'block' | 'text' | 'none' = 'none';
                if (firstMatch?.type) {
                    matchedType = firstMatch.type as 'area' | 'length' | 'block' | 'text';
                }

                // Build layer stats from top candidate geometry
                let layerStats: LayerStats | null = null;
                if (topCandidate?.geometry) {
                    layerStats = {
                        area_total_m2: topCandidate.geometry.area ?? null,
                        length_total_m: topCandidate.geometry.length ?? null,
                        block_count: topCandidate.geometry.blocks ?? null
                    };
                }

                errors.push({
                    // Row identification
                    rowIndex: row.excel_row_index,
                    itemName: row.excel_item_text || `Row ${row.excel_row_index}`,
                    unit: row.excel_unit || '',

                    // Quantity comparison
                    expectedQty: expected,
                    predictedQty: computed,
                    absError,
                    pctError,

                    // Match details
                    matchedLayer: firstMatch?.layer_normalized || topCandidate?.layer || null,
                    matchedType,
                    calcMethod: row.calc_method || row.method_detail || null,

                    // Layer geometry
                    layerStats,

                    // Status/reason
                    status: row.status,
                    matchReason: row.match_reason || null,
                    warnings: row.warnings || null
                });
            }
        }

        // Sort by absolute error and get top 20
        errors.sort((a, b) => b.absError - a.absError);
        const topErrors = errors.slice(0, 20);

        // P0.5: Filter suspects = m² items with text/block matchedType (invalid evidence)
        const suspects = errors.filter(e => {
            const isM2 = e.unit.toLowerCase().includes('m2') || e.unit === 'm²';
            const invalidType = e.matchedType === 'text' || e.matchedType === 'block';
            return isM2 && invalidType;
        });

        const report: RegressionReport = {
            batchId,
            totalItems: stagingRows.length,
            itemsCompared: stagingRows.length - noComputedCount,
            topErrors,
            suspects, // P0.5
            summary: {
                avgAbsError: errors.length > 0 ? totalAbsError / errors.length : 0,
                avgPctError: pctErrorCount > 0 ? totalPctError / pctErrorCount : 0,
                itemsWithLargeError: largeErrorCount,
                itemsWithNoComputed: noComputedCount,
                itemsWithNoExpected: noExpectedCount,
                outliersByUnit,
                suspectsCount: suspects.length // P0.5
            }
        };

        return NextResponse.json(report);
    } catch (err) {
        console.error('[Regression] Error:', err);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
