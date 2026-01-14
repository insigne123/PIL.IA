/**
 * Calculation method determination for Excel items
 * Replaces LLM guessing with deterministic rules
 */

export type CalcMethod = 'COUNT' | 'LENGTH' | 'AREA' | 'VOLUME' | 'GLOBAL';

export interface CalcMethodResult {
    method: CalcMethod;
    method_detail: string;
    confidence: number;
    reason: string;
}

/**
 * Determine calculation method from Excel unit and description
 */
export function determineCalcMethod(
    excelUnit: string,
    description: string
): CalcMethodResult {
    const unitLower = excelUnit.toLowerCase().trim();
    const descLower = description.toLowerCase();

    // 1. UNIT-BASED HARD RULES (Highest Priority)

    // COUNT (u, un, pza, est, glb - wait global is diff)
    if (['un', 'u', 'und', 'unidad', 'unidades', 'pza', 'pieza', 'c/u', 'num', 'nº'].includes(unitLower)) {
        return {
            method: 'COUNT',
            method_detail: 'unit_count',
            confidence: 0.99,
            reason: `Explicit Unit: ${excelUnit} -> COUNT`
        };
    }

    // AREA (m2)
    if (['m2', 'm²', 'mt2'].includes(unitLower)) {
        return {
            method: 'AREA',
            method_detail: 'area_m2',
            confidence: 0.99,
            reason: `Explicit Unit: ${excelUnit} -> AREA`
        };
    }

    // VOLUME (m3)
    if (['m3', 'm³', 'mt3'].includes(unitLower)) {
        return {
            method: 'VOLUME',
            method_detail: 'volume_m3',
            confidence: 0.99,
            reason: `Explicit Unit: ${excelUnit} -> VOLUME`
        };
    }

    // LENGTH (m, ml)
    if (['m', 'ml', 'mts', 'metro', 'metros', 'mt'].includes(unitLower)) {
        return {
            method: 'LENGTH',
            method_detail: 'length_m',
            confidence: 0.99,
            reason: `Explicit Unit: ${excelUnit} -> LENGTH`
        };
    }

    // GLOBAL (gl, est, pa) - Note: 'est' = Global/Estimate
    if (['gl', 'glb', 'global', 'est', 'est.', 'estimado', 'pa'].includes(unitLower)) {
        return {
            method: 'GLOBAL',
            method_detail: 'global_estimate',
            confidence: 0.99,
            reason: `Explicit Unit: ${excelUnit} -> GLOBAL`
        };
    }

    // 2. FALLBACK BY DESCRIPTION

    // Discrete items
    if (descLower.includes('punto') || descLower.includes('tablero') || descLower.includes('equipo')) {
        return { method: 'COUNT', method_detail: 'inferred_count', confidence: 0.7, reason: 'Description suggests COUNT' };
    }

    // Linear items
    if (descLower.includes('tubería') || descLower.includes('canalización') || descLower.includes('conductor')) {
        return { method: 'LENGTH', method_detail: 'inferred_length', confidence: 0.7, reason: 'Description suggests LENGTH' };
    }

    // Surface work
    if (descLower.includes('pintura') || descLower.includes('piso')) {
        return { method: 'AREA', method_detail: 'inferred_area', confidence: 0.7, reason: 'Description suggests AREA' };
    }

    return {
        method: 'GLOBAL', // Default safest fallback? Or COUNT? Global is safer to avoid false positives.
        method_detail: 'unknown_fallback',
        confidence: 0.1,
        reason: 'Unknown unit/description'
    };
}

/**
 * Check if DXF item type is compatible with calc method
 */
export function isCompatibleType(
    dxfItemType: 'block' | 'length' | 'area' | 'text',
    calcMethod: CalcMethod
): boolean {
    const compatibility: Record<CalcMethod, Array<'block' | 'length' | 'area' | 'text'>> = {
        'COUNT': ['block'],
        'LENGTH': ['length'],
        'AREA': ['area', 'length'], // Length allowed for Area (Walls)
        'VOLUME': ['area', 'length'], // Allowed
        'GLOBAL': []
    };

    return compatibility[calcMethod]?.includes(dxfItemType) || false;
}

/**
 * Get human-readable explanation of calc method
 */
export function getCalcMethodExplanation(result: CalcMethodResult): string {
    const confidenceLabel = result.confidence >= 0.9 ? 'Alta' :
        result.confidence >= 0.7 ? 'Media' :
            result.confidence >= 0.5 ? 'Baja' : 'Muy baja';

    return `Método: ${result.method} (${result.method_detail}) - Confianza: ${confidenceLabel} - ${result.reason}`;
}

/**
 * Batch classify multiple items
 */
export function batchClassifyCalcMethods(
    items: Array<{ unit: string; description: string }>
): CalcMethodResult[] {
    return items.map(item => determineCalcMethod(item.unit, item.description));
}

/**
 * Get statistics about calc method distribution
 */
export function getCalcMethodStats(results: CalcMethodResult[]): {
    byMethod: Record<CalcMethod, number>;
    avgConfidence: number;
    lowConfidenceCount: number;
} {
    const byMethod: Record<CalcMethod, number> = {
        'COUNT': 0,
        'LENGTH': 0,
        'AREA': 0,
        'VOLUME': 0,
        'GLOBAL': 0
    };

    let totalConfidence = 0;
    let lowConfidenceCount = 0;

    for (const result of results) {
        byMethod[result.method]++;
        totalConfidence += result.confidence;
        if (result.confidence < 0.5) lowConfidenceCount++;
    }

    return {
        byMethod,
        avgConfidence: results.length > 0 ? totalConfidence / results.length : 0,
        lowConfidenceCount
    };
}
