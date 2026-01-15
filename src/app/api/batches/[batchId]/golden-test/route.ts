import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runGoldenTest, generateGoldenTestReport, parseGoldenExcel } from '@/lib/processing/golden-test';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/batches/[batchId]/golden-test
 * 
 * Runs a golden test comparing current predictions against validated expected values.
 * 
 * Body: {
 *   expectedValues: Array<{ rowIndex: number; description: string; expectedQty: number }>
 *   config?: { maxAcceptablePctError?: number; minPassRate?: number }
 * }
 */
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ batchId: string }> }
) {
    try {
        const { batchId } = await params;

        // Get request body
        const body = await req.json();
        const { expectedValues, config } = body;

        if (!expectedValues || !Array.isArray(expectedValues)) {
            return NextResponse.json(
                { error: 'expectedValues array is required' },
                { status: 400 }
            );
        }

        // Fetch current staging rows for this batch
        const { data: stagingRows, error: stagingError } = await supabase
            .from('staging')
            .select('excel_row_index, excel_item_text, qty_final')
            .eq('batch_id', batchId)
            .not('qty_final', 'is', null);

        if (stagingError) {
            console.error('[Golden Test] Error fetching staging rows:', stagingError);
            return NextResponse.json(
                { error: 'Failed to fetch staging data' },
                { status: 500 }
            );
        }

        // Prepare predictions
        const predictions = (stagingRows || []).map(row => ({
            rowIndex: row.excel_row_index,
            description: row.excel_item_text,
            qty: row.qty_final
        }));

        // Parse expected values
        const expected = parseGoldenExcel(expectedValues);

        // Run golden test
        const result = runGoldenTest(predictions, expected, config || {});

        // Generate report
        const report = generateGoldenTestReport(result);

        // Log report to console
        console.log('\n' + report + '\n');

        // Return results
        return NextResponse.json({
            success: true,
            result: {
                qualityGate: result.qualityGate,
                qualityGateReason: result.qualityGateReason,
                totalRows: result.totalRows,
                matchedRows: result.matchedRows,
                passedRows: result.passedRows,
                failedRows: result.failedRows,
                missingPredictions: result.missingPredictions,
                avgPctError: result.avgPctError,
                medianPctError: result.medianPctError,
                maxPctError: result.maxPctError,
                top20Worst: result.top20Worst,
                timestamp: result.timestamp
            },
            report
        });

    } catch (error) {
        console.error('[Golden Test] Error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

/**
 * GET /api/batches/[batchId]/golden-test
 * 
 * Returns info about golden test endpoint.
 */
export async function GET() {
    return NextResponse.json({
        endpoint: 'Golden Test',
        description: 'Compare batch predictions against validated expected values',
        usage: {
            method: 'POST',
            body: {
                expectedValues: 'Array<{ rowIndex: number; description: string; expectedQty: number }>',
                config: {
                    maxAcceptablePctError: 'number (default: 10)',
                    minPassRate: 'number (default: 0.8)'
                }
            }
        }
    });
}
