/**
 * Sanity Checker Module
 * 
 * Detects suspicious values that may indicate:
 * - Unconverted units (mm interpreted as m)
 * - Missing conversions
 * - Impossible quantities
 * - Type mismatches
 * 
 * This is the "smell detector" for the pipeline
 */

import { MeasureKind } from '@/types';

export interface SanityCheckResult {
    passed: boolean;
    issues: SanityIssue[];
    severity: 'ok' | 'warning' | 'error';
}

export interface SanityIssue {
    type: 'unconverted_units' | 'impossible_value' | 'type_mismatch' | 'outlier' | 'zero_quantity';
    message: string;
    detected_value: number;
    expected_range?: { min: number; max: number };
    suggestion?: string;
}

/**
 * Check if a quantity value makes sense for its measure kind
 */
export function checkQuantitySanity(
    qty: number | null,
    measureKind: MeasureKind,
    context?: {
        description?: string;
        unit?: string;
        expectedRange?: { min: number; max: number };
    }
): SanityCheckResult {
    const issues: SanityIssue[] = [];

    // Null/undefined check
    if (qty === null || qty === undefined || isNaN(qty)) {
        return {
            passed: true, // Not an error, just no value
            issues: [],
            severity: 'ok'
        };
    }

    // Zero quantity (suspicious but not always wrong)
    if (qty === 0) {
        issues.push({
            type: 'zero_quantity',
            message: 'Cantidad es cero - puede ser correcto para items globales',
            detected_value: qty
        });
    }

    // Negative quantity (always wrong)
    if (qty < 0) {
        issues.push({
            type: 'impossible_value',
            message: `Cantidad negativa: ${qty} (BUG)`,
            detected_value: qty,
            suggestion: 'Verificar cálculo de valor_si'
        });
        return {
            passed: false,
            issues,
            severity: 'error'
        };
    }

    // Check based on measure kind
    switch (measureKind) {
        case 'length':
            return checkLengthSanity(qty, issues, context);
        case 'area':
            return checkAreaSanity(qty, issues, context);
        case 'volume':
            return checkVolumeSanity(qty, issues, context);
        case 'count':
            return checkCountSanity(qty, issues, context);
        case 'service':
            return checkServiceSanity(qty, issues, context);
        default:
            // Unknown - can't validate
            return { passed: true, issues, severity: 'ok' };
    }
}

/**
 * Check length values (meters)
 */
function checkLengthSanity(
    qty: number,
    issues: SanityIssue[],
    context?: any
): SanityCheckResult {
    // Suspiciously large (likely unconverted mm)
    if (qty > 10000) {
        issues.push({
            type: 'unconverted_units',
            message: `Longitud ${qty.toFixed(0)}m es sospechosamente grande (>10km) - posible mm sin convertir`,
            detected_value: qty,
            expected_range: { min: 0, max: 1000 },
            suggestion: 'Verificar factor de conversión de unidades'
        });
        return { passed: false, issues, severity: 'error' };
    }

    // Very large (warning)
    if (qty > 1000) {
        issues.push({
            type: 'outlier',
            message: `Longitud ${qty.toFixed(0)}m es muy grande (>1km) - revisar`,
            detected_value: qty,
            expected_range: { min: 0, max: 1000 }
        });
        return { passed: false, issues, severity: 'warning' };
    }

    // Very small (possible noise)
    if (qty < 0.01 && qty > 0) {
        issues.push({
            type: 'outlier',
            message: `Longitud ${qty.toFixed(4)}m es muy pequeña (<1cm) - posible ruido geométrico`,
            detected_value: qty,
            expected_range: { min: 0.01, max: 10000 }
        });
        return { passed: false, issues, severity: 'warning' };
    }

    return { passed: true, issues, severity: 'ok' };
}

/**
 * Check area values (m²)
 * P0.6: Added specific checks for floor/losa/sobrelosa items
 */
function checkAreaSanity(
    qty: number,
    issues: SanityIssue[],
    context?: any
): SanityCheckResult {
    // P0.6: For floor/losa/pavimento items, reject if < 1 m²
    const description = (context?.description || '').toLowerCase();
    const isFloorItem = [
        'piso', 'losa', 'pavimento', 'sobrelosa', 'radier',
        'fundacion', 'contrapiso', 'alfombra', 'cerámico', 'ceramica',
        'porcelanato', 'pvc', 'vinilico', 'floor', 'slab'
    ].some(keyword => description.includes(keyword));

    if (isFloorItem && qty < 1 && qty > 0) {
        issues.push({
            type: 'outlier',
            message: `Área de piso/losa ${qty.toFixed(2)}m² es menor a 1m² - sospechoso para "${context?.description}"`,
            detected_value: qty,
            expected_range: { min: 1, max: 100000 },
            suggestion: 'Verificar que match esté usando AREA correcta, no TEXT o fragmento'
        });
        return { passed: false, issues, severity: 'error' };
    }

    // Suspiciously large (likely unconverted)
    if (qty > 100000) {
        issues.push({
            type: 'unconverted_units',
            message: `Área ${qty.toFixed(0)}m² es sospechosamente grande (>10ha) - posible error de conversión`,
            detected_value: qty,
            expected_range: { min: 0, max: 10000 },
            suggestion: 'Verificar unidades del dibujo (mm² vs m²)'
        });
        return { passed: false, issues, severity: 'error' };
    }

    // Very large building (warning)
    if (qty > 10000) {
        issues.push({
            type: 'outlier',
            message: `Área ${qty.toFixed(0)}m² es muy grande (>1ha) - revisar`,
            detected_value: qty,
            expected_range: { min: 0, max: 10000 }
        });
        return { passed: false, issues, severity: 'warning' };
    }

    // Very small (for non-floor items)
    if (!isFloorItem && qty < 0.01 && qty > 0) {
        issues.push({
            type: 'outlier',
            message: `Área ${qty.toFixed(4)}m² es muy pequeña (<100cm²) - posible ruido`,
            detected_value: qty,
            expected_range: { min: 0.01, max: 100000 }
        });
        return { passed: false, issues, severity: 'warning' };
    }

    return { passed: true, issues, severity: 'ok' };
}

/**
 * Check volume values (m³)
 */
function checkVolumeSanity(
    qty: number,
    issues: SanityIssue[],
    context?: any
): SanityCheckResult {
    // Suspiciously large
    if (qty > 1000000) {
        issues.push({
            type: 'unconverted_units',
            message: `Volumen ${qty.toFixed(0)}m³ es sospechosamente grande`,
            detected_value: qty,
            expected_range: { min: 0, max: 100000 }
        });
        return { passed: false, issues, severity: 'error' };
    }

    // Very large
    if (qty > 10000) {
        issues.push({
            type: 'outlier',
            message: `Volumen ${qty.toFixed(0)}m³ es muy grande - revisar`,
            detected_value: qty,
            expected_range: { min: 0, max: 10000 }
        });
        return { passed: false, issues, severity: 'warning' };
    }

    return { passed: true, issues, severity: 'ok' };
}

/**
 * Check count values (blocks/units)
 */
function checkCountSanity(
    qty: number,
    issues: SanityIssue[],
    context?: any
): SanityCheckResult {
    // Not an integer (suspicious - unless it's global)
    if (!Number.isInteger(qty)) {
        issues.push({
            type: 'type_mismatch',
            message: `Conteo ${qty.toFixed(2)} no es entero - Probablemente se midió LONGITUD o TEXTO en vez de BLOQUES`,
            detected_value: qty,
            suggestion: 'Verificar que el tipo DXF sea "block" no "length/text"',
            // P0: Treat as error for Unit items
            severity: 'error'
        });
        return { passed: false, issues, severity: 'error' };
    }

    // P0: Sanity Limit lowered to 500 (from 50k)
    // 1112 error typically produces huge numbers
    if (qty > 500) {
        issues.push({
            type: 'outlier',
            message: `Conteo ${qty} es sospechosamente alto (>500) - Posible error de "Contar Textos"`,
            detected_value: qty,
            expected_range: { min: 1, max: 500 },
            suggestion: 'Bloquear match de tipo TEXT para este ítem'
        });
        return { passed: false, issues, severity: 'error' };
    }

    return { passed: true, issues, severity: 'ok' };
}

/**
 * Check service/global values
 */
function checkServiceSanity(
    qty: number,
    issues: SanityIssue[],
    context?: any
): SanityCheckResult {
    // Service items should typically be 1 or 0
    if (qty !== 1 && qty !== 0) {
        issues.push({
            type: 'outlier',
            message: `Item de servicio con cantidad ${qty} - normalmente debería ser 1`,
            detected_value: qty,
            suggestion: 'Verificar si realmente es un item global/servicio'
        });
        return { passed: false, issues, severity: 'warning' };
    }

    return { passed: true, issues, severity: 'ok' };
}

/**
 * Batch check multiple values
 */
export function checkBatchSanity(
    values: Array<{ qty: number | null; measureKind: MeasureKind; description?: string }>
): {
    totalChecked: number;
    passed: number;
    warnings: number;
    errors: number;
    results: Array<SanityCheckResult & { description?: string }>;
} {
    const results = values.map(v => ({
        ...checkQuantitySanity(v.qty, v.measureKind, { description: v.description }),
        description: v.description
    }));

    return {
        totalChecked: results.length,
        passed: results.filter(r => r.passed).length,
        warnings: results.filter(r => r.severity === 'warning').length,
        errors: results.filter(r => r.severity === 'error').length,
        results
    };
}

/**
 * Get summary string for logging
 */
export function getSanitySummary(result: SanityCheckResult): string {
    if (result.passed && result.issues.length === 0) {
        return '✅ OK';
    }

    const icon = result.severity === 'error' ? '❌' : '⚠️';
    const issueMessages = result.issues.map(i => i.message).join('; ');
    return `${icon} ${issueMessages}`;
}
