// Validation engine for staging rows

import type {
    ValidationRule,
    ValidationResult,
    ValidationContext,
    ValidationCheck,
} from '@/types/improvements';
import type { StagingRow } from '@/types';
import { supabase } from '@/lib/supabase';

export class ValidationEngine {
    private supabase = supabase;
    private rules: Map<string, ValidationCheck> = new Map();

    constructor() {
        this.registerDefaultRules();
    }

    /**
     * Register default validation rules
     */
    private registerDefaultRules(): void {
        // Quantity sanity check
        this.rules.set('quantity_sanity', (row, ctx) => {
            if (row.qty_final && row.qty_final > 10000 && row.excel_unit === 'un') {
                return {
                    id: '',
                    stagingRowId: row.id,
                    batchId: ctx.batch.id,
                    passed: false,
                    severity: 'warning',
                    message: 'Cantidad inusualmente alta (>10,000 unidades)',
                    details: { qty: row.qty_final, unit: row.excel_unit },
                    overridden: false,
                    createdAt: new Date().toISOString(),
                };
            }
            return null;
        });

        // Price outlier detection
        this.rules.set('price_outlier', (row, ctx) => {
            if (!row.unit_price_ref) return null;

            // Get average price for similar items
            const similarItems = ctx.allRows.filter(
                (r) =>
                    r.excel_item_text.toLowerCase().includes(row.excel_item_text.toLowerCase().split(' ')[0]) &&
                    r.unit_price_ref
            );

            if (similarItems.length < 2) return null;

            const avgPrice =
                similarItems.reduce((sum, r) => sum + (r.unit_price_ref || 0), 0) /
                similarItems.length;

            if (row.unit_price_ref > avgPrice * 3) {
                return {
                    id: '',
                    stagingRowId: row.id,
                    batchId: ctx.batch.id,
                    passed: false,
                    severity: 'warning',
                    message: `Precio 3x superior al promedio (${avgPrice.toFixed(0)} CLP)`,
                    details: { price: row.unit_price_ref, avgPrice },
                    overridden: false,
                    createdAt: new Date().toISOString(),
                };
            }
            return null;
        });

        // Unit consistency check
        this.rules.set('unit_consistency', (row, ctx) => {
            if (row.excel_unit === 'm2' && !row.height_factor) {
                return {
                    id: '',
                    stagingRowId: row.id,
                    batchId: ctx.batch.id,
                    passed: false,
                    severity: 'error',
                    message: 'Falta factor de altura para conversión a m²',
                    details: { unit: row.excel_unit },
                    overridden: false,
                    createdAt: new Date().toISOString(),
                };
            }
            return null;
        });

        // Missing quantity check
        this.rules.set('missing_quantity', (row, ctx) => {
            if (!row.qty_final || row.qty_final === 0) {
                return {
                    id: '',
                    stagingRowId: row.id,
                    batchId: ctx.batch.id,
                    passed: false,
                    severity: 'error',
                    message: 'Cantidad final no puede ser cero',
                    details: { qty: row.qty_final },
                    overridden: false,
                    createdAt: new Date().toISOString(),
                };
            }
            return null;
        });

        // Low confidence warning
        this.rules.set('low_confidence', (row, ctx) => {
            const confidence = row.match_confidence || 0;
            if (confidence < 0.4 && row.source_items.length > 0) {
                return {
                    id: '',
                    stagingRowId: row.id,
                    batchId: ctx.batch.id,
                    passed: false,
                    severity: 'warning',
                    message: `Confianza de matching baja (${(confidence * 100).toFixed(0)}%)`,
                    details: { confidence },
                    overridden: false,
                    createdAt: new Date().toISOString(),
                };
            }
            return null;
        });

        // Missing price check
        this.rules.set('missing_price', (row, ctx) => {
            if (!row.unit_price_ref && row.status === 'approved') {
                return {
                    id: '',
                    stagingRowId: row.id,
                    batchId: ctx.batch.id,
                    passed: false,
                    severity: 'info',
                    message: 'Ítem aprobado sin precio de referencia',
                    details: {},
                    overridden: false,
                    createdAt: new Date().toISOString(),
                };
            }
            return null;
        });
    }

    /**
     * Validate a single staging row
     */
    async validateRow(
        row: StagingRow,
        context: ValidationContext
    ): Promise<ValidationResult[]> {
        const results: ValidationResult[] = [];

        // Run all registered rules
        for (const [ruleName, check] of this.rules.entries()) {
            const result = check(row, context);
            if (result) {
                results.push(result);
            }
        }

        // Load custom rules from database
        const customRules = await this.loadCustomRules(context.batch.projectId);
        for (const rule of customRules) {
            const result = await this.executeCustomRule(rule, row, context);
            if (result) {
                results.push(result);
            }
        }

        // Save results to database
        if (results.length > 0) {
            await this.saveResults(results);
        }

        return results;
    }

    /**
     * Validate all rows in a batch
     */
    async validateBatch(
        rows: StagingRow[],
        context: ValidationContext
    ): Promise<Map<string, ValidationResult[]>> {
        const resultsByRow = new Map<string, ValidationResult[]>();

        for (const row of rows) {
            const results = await this.validateRow(row, context);
            if (results.length > 0) {
                resultsByRow.set(row.id, results);
            }
        }

        return resultsByRow;
    }

    /**
     * Load custom validation rules from database
     */
    private async loadCustomRules(projectId: string): Promise<ValidationRule[]> {
        const { data, error } = await this.supabase
            .from('validation_rules')
            .select('*')
            .eq('enabled', true)
            .or(`user_id.is.null,user_id.eq.${projectId}`);

        if (error || !data) {
            return [];
        }

        return data as ValidationRule[];
    }

    /**
     * Execute a custom validation rule
     */
    private async executeCustomRule(
        rule: ValidationRule,
        row: StagingRow,
        context: ValidationContext
    ): Promise<ValidationResult | null> {
        try {
            // Simple rule execution based on type
            switch (rule.ruleType) {
                case 'range':
                    return this.executeRangeRule(rule, row, context);
                case 'ratio':
                    return this.executeRatioRule(rule, row, context);
                case 'consistency':
                    return this.executeConsistencyRule(rule, row, context);
                case 'business':
                    return this.executeBusinessRule(rule, row, context);
                default:
                    return null;
            }
        } catch (error) {
            console.error(`Failed to execute rule ${rule.name}:`, error);
            return null;
        }
    }

    private executeRangeRule(
        rule: ValidationRule,
        row: StagingRow,
        context: ValidationContext
    ): ValidationResult | null {
        const { field, min, max } = rule.config;
        const value = (row as any)[field];

        if (value !== undefined && (value < min || value > max)) {
            return {
                id: '',
                stagingRowId: row.id,
                batchId: context.batch.id,
                ruleId: rule.id,
                passed: false,
                severity: rule.severity,
                message: `${field} fuera de rango (${min}-${max})`,
                details: { value, min, max },
                overridden: false,
                createdAt: new Date().toISOString(),
            };
        }
        return null;
    }

    private executeRatioRule(
        rule: ValidationRule,
        row: StagingRow,
        context: ValidationContext
    ): ValidationResult | null {
        // Implement ratio validation logic
        return null;
    }

    private executeConsistencyRule(
        rule: ValidationRule,
        row: StagingRow,
        context: ValidationContext
    ): ValidationResult | null {
        // Implement consistency validation logic
        return null;
    }

    private executeBusinessRule(
        rule: ValidationRule,
        row: StagingRow,
        context: ValidationContext
    ): ValidationResult | null {
        // Implement business rule validation logic
        return null;
    }

    /**
     * Save validation results to database
     */
    private async saveResults(results: ValidationResult[]): Promise<void> {
        const { error } = await this.supabase
            .from('validation_results')
            .insert(results);

        if (error) {
            console.error('Failed to save validation results:', error);
        }
    }

    /**
     * Get validation results for a staging row
     */
    async getResults(stagingRowId: string): Promise<ValidationResult[]> {
        const { data, error } = await this.supabase
            .from('validation_results')
            .select('*')
            .eq('staging_row_id', stagingRowId)
            .eq('overridden', false);

        if (error || !data) {
            return [];
        }

        return data as ValidationResult[];
    }

    /**
     * Override a validation result
     */
    async overrideResult(
        resultId: string,
        reason: string,
        userId: string
    ): Promise<void> {
        const { error } = await this.supabase
            .from('validation_results')
            .update({
                overridden: true,
                override_reason: reason,
                override_by: userId,
                override_at: new Date().toISOString(),
            })
            .eq('id', resultId);

        if (error) {
            console.error('Failed to override validation result:', error);
        }
    }
}

export const validationEngine = new ValidationEngine();
