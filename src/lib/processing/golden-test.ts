/**
 * Golden Test
 * 
 * P2.A: Compare processing results against a validated Excel ("golden" reference)
 * to detect regressions and measure accuracy.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface GoldenTestRow {
    rowIndex: number;
    description: string;
    expected: number;
    predicted: number | null;
    absError: number;
    pctError: number;
    status: 'pass' | 'fail' | 'missing_prediction' | 'missing_expected';
}

export interface GoldenTestResult {
    // Overall metrics
    totalRows: number;
    matchedRows: number;
    passedRows: number;
    failedRows: number;
    missingPredictions: number;

    // Error metrics
    avgAbsError: number;
    avgPctError: number;
    maxPctError: number;
    medianPctError: number;

    // Detailed results
    rows: GoldenTestRow[];
    top20Worst: GoldenTestRow[];

    // Quality gate
    qualityGate: 'PASS' | 'FAIL';
    qualityGateReason: string;

    // Metadata
    timestamp: string;
    config: GoldenTestConfig;
}

export interface GoldenTestConfig {
    // Maximum acceptable percentage error for pass
    maxAcceptablePctError: number;  // e.g., 10 = 10%
    // Minimum percentage of rows that must pass
    minPassRate: number;  // e.g., 0.8 = 80%
    // Tolerance for considering values equal (relative)
    tolerance: number;  // e.g., 0.01 = 1%
    // Ignore rows with expected value below threshold
    minExpectedValue: number;  // e.g., 0.01
}

const DEFAULT_CONFIG: GoldenTestConfig = {
    maxAcceptablePctError: 10,  // 10%
    minPassRate: 0.8,           // 80% must pass
    tolerance: 0.01,            // 1% tolerance = pass
    minExpectedValue: 0.01      // Ignore tiny values
};

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Run golden test comparing predictions against expected values
 */
export function runGoldenTest(
    predictions: Array<{ rowIndex: number; description: string; qty: number | null }>,
    expected: Array<{ rowIndex: number; description: string; qty: number }>,
    config: Partial<GoldenTestConfig> = {}
): GoldenTestResult {
    const cfg: GoldenTestConfig = { ...DEFAULT_CONFIG, ...config };
    const timestamp = new Date().toISOString();

    // Create lookup for expected values
    const expectedMap = new Map<number, { description: string; qty: number }>();
    for (const e of expected) {
        expectedMap.set(e.rowIndex, { description: e.description, qty: e.qty });
    }

    // Compare each prediction
    const rows: GoldenTestRow[] = [];

    for (const pred of predictions) {
        const exp = expectedMap.get(pred.rowIndex);

        if (!exp) {
            // No expected value for this row
            rows.push({
                rowIndex: pred.rowIndex,
                description: pred.description,
                expected: 0,
                predicted: pred.qty,
                absError: 0,
                pctError: 0,
                status: 'missing_expected'
            });
            continue;
        }

        // Skip tiny expected values
        if (exp.qty < cfg.minExpectedValue) {
            continue;
        }

        if (pred.qty === null) {
            // No prediction
            rows.push({
                rowIndex: pred.rowIndex,
                description: pred.description,
                expected: exp.qty,
                predicted: null,
                absError: exp.qty,
                pctError: 100,
                status: 'missing_prediction'
            });
            continue;
        }

        // Calculate errors
        const absError = Math.abs(pred.qty - exp.qty);
        const pctError = (absError / exp.qty) * 100;

        // Determine pass/fail
        const passes = pctError <= cfg.maxAcceptablePctError ||
            (absError / exp.qty) <= cfg.tolerance;

        rows.push({
            rowIndex: pred.rowIndex,
            description: pred.description,
            expected: exp.qty,
            predicted: pred.qty,
            absError,
            pctError,
            status: passes ? 'pass' : 'fail'
        });
    }

    // Calculate aggregate metrics
    const rowsWithPredictions = rows.filter(r =>
        r.status === 'pass' || r.status === 'fail'
    );

    const passedRows = rows.filter(r => r.status === 'pass').length;
    const failedRows = rows.filter(r => r.status === 'fail').length;
    const missingPredictions = rows.filter(r => r.status === 'missing_prediction').length;

    const pctErrors = rowsWithPredictions.map(r => r.pctError);
    const avgPctError = pctErrors.length > 0
        ? pctErrors.reduce((a, b) => a + b, 0) / pctErrors.length
        : 0;
    const maxPctError = pctErrors.length > 0
        ? Math.max(...pctErrors)
        : 0;
    const medianPctError = pctErrors.length > 0
        ? getMedian(pctErrors)
        : 0;

    const absErrors = rowsWithPredictions.map(r => r.absError);
    const avgAbsError = absErrors.length > 0
        ? absErrors.reduce((a, b) => a + b, 0) / absErrors.length
        : 0;

    // Top 20 worst
    const top20Worst = [...rows]
        .filter(r => r.status === 'fail' || r.status === 'missing_prediction')
        .sort((a, b) => b.pctError - a.pctError)
        .slice(0, 20);

    // Quality gate
    const passRate = rowsWithPredictions.length > 0
        ? passedRows / rowsWithPredictions.length
        : 0;
    const qualityGate = passRate >= cfg.minPassRate ? 'PASS' : 'FAIL';
    const qualityGateReason = qualityGate === 'PASS'
        ? `${(passRate * 100).toFixed(1)}% pass rate meets threshold of ${cfg.minPassRate * 100}%`
        : `${(passRate * 100).toFixed(1)}% pass rate is below threshold of ${cfg.minPassRate * 100}%`;

    return {
        totalRows: rows.length,
        matchedRows: rowsWithPredictions.length,
        passedRows,
        failedRows,
        missingPredictions,
        avgAbsError,
        avgPctError,
        maxPctError,
        medianPctError,
        rows,
        top20Worst,
        qualityGate,
        qualityGateReason,
        timestamp,
        config: cfg
    };
}

/**
 * Generate a summary report string
 */
export function generateGoldenTestReport(result: GoldenTestResult): string {
    const lines: string[] = [
        '═══════════════════════════════════════════════════════════════',
        '                    GOLDEN TEST REPORT',
        '═══════════════════════════════════════════════════════════════',
        '',
        `📅 Timestamp: ${result.timestamp}`,
        `🎯 Quality Gate: ${result.qualityGate === 'PASS' ? '✅ PASS' : '❌ FAIL'}`,
        `   ${result.qualityGateReason}`,
        '',
        '───────────────────────────────────────────────────────────────',
        '                    SUMMARY METRICS',
        '───────────────────────────────────────────────────────────────',
        '',
        `Total Rows:           ${result.totalRows}`,
        `Matched Rows:         ${result.matchedRows}`,
        `Passed:               ${result.passedRows} (${((result.passedRows / result.matchedRows) * 100).toFixed(1)}%)`,
        `Failed:               ${result.failedRows} (${((result.failedRows / result.matchedRows) * 100).toFixed(1)}%)`,
        `Missing Predictions:  ${result.missingPredictions}`,
        '',
        `Avg % Error:          ${result.avgPctError.toFixed(2)}%`,
        `Median % Error:       ${result.medianPctError.toFixed(2)}%`,
        `Max % Error:          ${result.maxPctError.toFixed(2)}%`,
        `Avg Abs Error:        ${result.avgAbsError.toFixed(4)}`,
        '',
    ];

    if (result.top20Worst.length > 0) {
        lines.push('───────────────────────────────────────────────────────────────');
        lines.push('                    TOP 20 WORST ERRORS');
        lines.push('───────────────────────────────────────────────────────────────');
        lines.push('');
        lines.push('Row  | Expected  | Predicted | % Error | Description');
        lines.push('-----|-----------|-----------|---------|------------------------');

        for (const row of result.top20Worst) {
            const predicted = row.predicted !== null ? row.predicted.toFixed(2) : 'NULL';
            const desc = row.description.substring(0, 24).padEnd(24);
            lines.push(
                `${String(row.rowIndex).padStart(4)} | ` +
                `${row.expected.toFixed(2).padStart(9)} | ` +
                `${predicted.padStart(9)} | ` +
                `${row.pctError.toFixed(1).padStart(6)}% | ` +
                `${desc}`
            );
        }
        lines.push('');
    }

    lines.push('═══════════════════════════════════════════════════════════════');

    return lines.join('\n');
}

/**
 * Compare two golden test results to detect regressions
 */
export function compareGoldenTests(
    current: GoldenTestResult,
    previous: GoldenTestResult
): {
    regression: boolean;
    improvements: string[];
    regressions: string[];
    summary: string;
} {
    const improvements: string[] = [];
    const regressions: string[] = [];

    // Compare pass rates
    const currPassRate = current.passedRows / current.matchedRows;
    const prevPassRate = previous.passedRows / previous.matchedRows;

    if (currPassRate > prevPassRate + 0.02) {
        improvements.push(`Pass rate improved: ${(prevPassRate * 100).toFixed(1)}% → ${(currPassRate * 100).toFixed(1)}%`);
    } else if (currPassRate < prevPassRate - 0.02) {
        regressions.push(`Pass rate regressed: ${(prevPassRate * 100).toFixed(1)}% → ${(currPassRate * 100).toFixed(1)}%`);
    }

    // Compare avg error
    if (current.avgPctError < previous.avgPctError - 1) {
        improvements.push(`Avg error improved: ${previous.avgPctError.toFixed(1)}% → ${current.avgPctError.toFixed(1)}%`);
    } else if (current.avgPctError > previous.avgPctError + 1) {
        regressions.push(`Avg error regressed: ${previous.avgPctError.toFixed(1)}% → ${current.avgPctError.toFixed(1)}%`);
    }

    // Compare missing predictions
    if (current.missingPredictions < previous.missingPredictions) {
        improvements.push(`Missing predictions reduced: ${previous.missingPredictions} → ${current.missingPredictions}`);
    } else if (current.missingPredictions > previous.missingPredictions) {
        regressions.push(`Missing predictions increased: ${previous.missingPredictions} → ${current.missingPredictions}`);
    }

    const regression = regressions.length > improvements.length;
    const summary = regression
        ? `⚠️ REGRESSION DETECTED: ${regressions.length} regressions vs ${improvements.length} improvements`
        : `✅ NO REGRESSION: ${improvements.length} improvements, ${regressions.length} regressions`;

    return { regression, improvements, regressions, summary };
}

// ============================================================================
// UTILITIES
// ============================================================================

function getMedian(arr: number[]): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Parse expected values from a "golden" Excel column
 * Assumes format: { rowIndex, qty }
 */
export function parseGoldenExcel(
    rows: Array<{ rowIndex: number; description: string; expectedQty?: number | string }>
): Array<{ rowIndex: number; description: string; qty: number }> {
    return rows
        .filter(r => r.expectedQty !== undefined && r.expectedQty !== null && r.expectedQty !== '')
        .map(r => ({
            rowIndex: r.rowIndex,
            description: r.description,
            qty: typeof r.expectedQty === 'string'
                ? parseFloat(r.expectedQty.replace(',', '.'))
                : (r.expectedQty as number)
        }))
        .filter(r => !isNaN(r.qty));
}
