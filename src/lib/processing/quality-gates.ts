/**
 * Quality Gates
 * 
 * P2.1: Automatic validation rules that flag items needing human review
 * Prevents bad matches from being auto-approved
 */

import { StagingRow } from '@/types';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface QualityGate {
    id: string;
    name: string;
    description: string;
    severity: 'error' | 'warning' | 'info';
    check: (row: StagingRow) => QualityGateResult;
}

export interface QualityGateResult {
    passed: boolean;
    message?: string;
    suggested_action?: string;
    details?: Record<string, any>;
}

export interface QualityCheckSummary {
    passed: boolean;
    totalGates: number;
    failedGates: number;
    errors: number;
    warnings: number;
    infos: number;
    failures: Array<{
        gate: QualityGate;
        result: QualityGateResult;
    }>;
}

// ============================================================================
// QUALITY GATE DEFINITIONS
// ============================================================================

export const QUALITY_GATES: QualityGate[] = [
    // ========================================
    // GATE 1: Low Match Confidence
    // ========================================
    {
        id: 'low_confidence',
        name: 'Low Match Confidence',
        description: 'Match confidence below acceptable threshold',
        severity: 'warning',
        check: (row) => {
            const threshold = 0.4;

            if (row.match_confidence !== undefined && row.match_confidence < threshold) {
                return {
                    passed: false,
                    message: `Match confidence ${(row.match_confidence * 100).toFixed(0)}% is below ${(threshold * 100).toFixed(0)}% threshold`,
                    suggested_action: 'Review match or select alternative layer from candidates',
                    details: {
                        confidence: row.match_confidence,
                        threshold,
                        matched_layer: row.source_items?.[0]?.layer_normalized
                    }
                };
            }

            return { passed: true };
        }
    },

    // ========================================
    // GATE 2: Type Mismatch
    // ========================================
    {
        id: 'type_mismatch',
        name: 'Geometry Type Mismatch',
        description: 'Excel unit doesn\'t match DXF geometry type',
        severity: 'error',
        check: (row) => {
            const excelType = row.expected_measure_type;
            const dxfType = row.source_items?.[0]?.type;

            if (!excelType || !dxfType) return { passed: true };

            // Check compatibility
            const compatible = {
                'AREA': ['area'],
                'LENGTH': ['length'],
                'BLOCK': ['block'],
                'VOLUME': ['area', 'length'], // Volume can use area or length
                'GLOBAL': ['area', 'length', 'block', 'text'],
                'UNKNOWN': ['area', 'length', 'block', 'text']
            };

            const allowedTypes = compatible[excelType] || [];

            if (!allowedTypes.includes(dxfType)) {
                return {
                    passed: false,
                    message: `Excel expects ${excelType} but matched ${dxfType} geometry`,
                    suggested_action: 'Find layer with correct geometry type',
                    details: {
                        excel_type: excelType,
                        dxf_type: dxfType,
                        excel_unit: row.excel_unit
                    }
                };
            }

            return { passed: true };
        }
    },

    // ========================================
    // GATE 3: Zero Quantity
    // ========================================
    {
        id: 'zero_quantity',
        name: 'Zero Quantity Despite Match',
        description: 'Matched a layer but qty_final is 0',
        severity: 'error',
        check: (row) => {
            const hasMatch = row.source_items && row.source_items.length > 0;
            const qtyIsZero = row.qty_final === 0 || row.qty_final === null;

            if (hasMatch && qtyIsZero) {
                return {
                    passed: false,
                    message: 'Matched layer but quantity is 0 - geometry type incompatibility',
                    suggested_action: 'Check if layer has correct geometry type (area/length/blocks)',
                    details: {
                        matched_layer: row.source_items[0].layer_normalized,
                        matched_type: row.source_items[0].type,
                        expected_type: row.expected_measure_type
                    }
                };
            }

            return { passed: true };
        }
    },

    // ========================================
    // GATE 4: Quantity Outlier
    // ========================================
    {
        id: 'quantity_outlier',
        name: 'Quantity Outlier',
        description: 'Quantity is suspiciously large or small',
        severity: 'warning',
        check: (row) => {
            const qty = row.qty_final;
            const measureType = row.expected_measure_type;

            if (qty === null || qty === undefined) return { passed: true };

            // Define reasonable ranges by type
            const ranges = {
                'AREA': { min: 0.01, max: 50000, unit: 'm²' },
                'LENGTH': { min: 0.01, max: 100000, unit: 'm' },
                'BLOCK': { min: 1, max: 10000, unit: 'units' },
                'VOLUME': { min: 0.01, max: 10000, unit: 'm³' }
            };

            const range = ranges[measureType as keyof typeof ranges];

            if (!range) return { passed: true };

            if (qty > range.max) {
                return {
                    passed: false,
                    message: `Quantity ${qty.toFixed(2)} ${range.unit} exceeds maximum ${range.max} ${range.unit}`,
                    suggested_action: 'Verify unit conversion or check for duplicate geometry',
                    details: {
                        quantity: qty,
                        max: range.max,
                        unit: range.unit,
                        ratio: qty / range.max
                    }
                };
            }

            if (qty < range.min && qty > 0) {
                return {
                    passed: false,
                    message: `Quantity ${qty.toFixed(4)} ${range.unit} is below minimum ${range.min} ${range.unit}`,
                    suggested_action: 'Check if geometry exists on layer or verify unit conversion',
                    details: {
                        quantity: qty,
                        min: range.min,
                        unit: range.unit
                    }
                };
            }

            return { passed: true };
        }
    },

    // ========================================
    // GATE 5: Layer 0 Usage
    // ========================================
    {
        id: 'layer_zero_usage',
        name: 'Layer 0 Usage',
        description: 'Using Layer 0 (DWG conversion artifact)',
        severity: 'info',
        check: (row) => {
            const layer = row.source_items?.[0]?.layer_normalized;

            if (layer === '0') {
                return {
                    passed: false,
                    message: 'Using Layer 0 (DWG conversion artifact) - verify this is correct',
                    suggested_action: 'Check if geometry should be on a named layer instead',
                    details: {
                        layer: '0',
                        qty: row.qty_final
                    }
                };
            }

            return { passed: true };
        }
    },

    // ========================================
    // GATE 6: Subtype Mismatch
    // ========================================
    {
        id: 'subtype_mismatch',
        name: 'Subtype Mismatch',
        description: 'Excel subtype doesn\'t match DXF layer name',
        severity: 'warning',
        check: (row) => {
            const subtype = row.excel_subtype;
            const layer = row.source_items?.[0]?.layer_normalized;
            const confidence = row.excel_subtype_confidence;

            if (!subtype || !layer || !confidence || confidence < 0.8) {
                return { passed: true }; // Skip if no strong subtype
            }

            // Check if layer name contradicts subtype
            const contradictions: Record<string, string[]> = {
                'floor_area': ['cielo', 'techo', 'muro', 'pared'],
                'ceiling_area': ['piso', 'pavimento', 'muro', 'pared'],
                'wall_area': ['piso', 'pavimento', 'cielo', 'techo'],
                'roof_area': ['piso', 'pavimento', 'cielo', 'muro']
            };

            const forbidden = contradictions[subtype] || [];
            const layerLower = layer.toLowerCase();

            for (const word of forbidden) {
                if (layerLower.includes(word)) {
                    return {
                        passed: false,
                        message: `Excel item is "${subtype}" but matched layer "${layer}" suggests different type`,
                        suggested_action: 'Review if layer is correct for this item type',
                        details: {
                            excel_subtype: subtype,
                            matched_layer: layer,
                            contradiction: word
                        }
                    };
                }
            }

            return { passed: true };
        }
    },

    // ========================================
    // GATE 7: Missing Geometry Metrics
    // ========================================
    {
        id: 'missing_geometry',
        name: 'Missing Geometry Metrics',
        description: 'No geometry information available for matched layer',
        severity: 'warning',
        check: (row) => {
            const hasMatch = row.source_items && row.source_items.length > 0;
            const topCandidate = row.top_candidates?.find(c => c.selected);

            if (hasMatch && topCandidate && !topCandidate.geometry) {
                return {
                    passed: false,
                    message: 'Matched layer has no geometry metrics available',
                    suggested_action: 'Verify layer contains actual geometry',
                    details: {
                        layer: topCandidate.layer
                    }
                };
            }

            return { passed: true };
        }
    },

    // ========================================
    // GATE 8: High Rejection Rate
    // ========================================
    {
        id: 'high_rejection_rate',
        name: 'High Candidate Rejection Rate',
        description: 'Most candidates were rejected - might indicate issue',
        severity: 'info',
        check: (row) => {
            const candidates = row.top_candidates || [];

            if (candidates.length === 0) return { passed: true };

            const rejected = candidates.filter(c => c.rejected).length;
            const rejectionRate = rejected / candidates.length;

            if (rejectionRate > 0.8 && candidates.length >= 3) {
                return {
                    passed: false,
                    message: `${rejected}/${candidates.length} candidates rejected - might indicate matching issue`,
                    suggested_action: 'Review rejection reasons and consider manual selection',
                    details: {
                        total_candidates: candidates.length,
                        rejected_count: rejected,
                        rejection_rate: rejectionRate,
                        rejection_reasons: candidates
                            .filter(c => c.reject_reason)
                            .map(c => c.reject_reason)
                            .slice(0, 3)
                    }
                };
            }

            return { passed: true };
        }
    }
];

// ============================================================================
// MAIN QUALITY CHECK FUNCTION
// ============================================================================

/**
 * Run all quality gates on a staging row
 */
export function runQualityGates(row: StagingRow): QualityCheckSummary {
    const failures: Array<{ gate: QualityGate; result: QualityGateResult }> = [];
    let errors = 0;
    let warnings = 0;
    let infos = 0;

    for (const gate of QUALITY_GATES) {
        const result = gate.check(row);

        if (!result.passed) {
            failures.push({ gate, result });

            if (gate.severity === 'error') errors++;
            else if (gate.severity === 'warning') warnings++;
            else if (gate.severity === 'info') infos++;
        }
    }

    return {
        passed: errors === 0, // Only errors block approval
        totalGates: QUALITY_GATES.length,
        failedGates: failures.length,
        errors,
        warnings,
        infos,
        failures
    };
}

/**
 * Get quality check summary for logging
 */
export function getQualityCheckSummary(summary: QualityCheckSummary): string {
    if (summary.passed && summary.failedGates === 0) {
        return '✅ All quality gates passed';
    }

    const parts: string[] = [];

    if (summary.errors > 0) {
        parts.push(`${summary.errors} error(s)`);
    }
    if (summary.warnings > 0) {
        parts.push(`${summary.warnings} warning(s)`);
    }
    if (summary.infos > 0) {
        parts.push(`${summary.infos} info(s)`);
    }

    return `⚠️ Quality gates: ${parts.join(', ')}`;
}

/**
 * Convert quality failures to suggestions
 */
export function qualityFailuresToSuggestions(
    failures: QualityCheckSummary['failures']
): Array<{
    id: string;
    action_type: 'REVIEW_QUALITY';
    label: string;
    confidence: 'high' | 'medium' | 'low';
}> {
    return failures.map(({ gate, result }) => ({
        id: `quality_${gate.id}`,
        action_type: 'REVIEW_QUALITY' as const,
        label: result.suggested_action || `Review: ${gate.name}`,
        confidence: (gate.severity === 'error' ? 'high' :
            gate.severity === 'warning' ? 'medium' : 'low') as 'high' | 'medium' | 'low'
    }));
}
