/**
 * Calculation method determination for Excel items
 * Replaces LLM guessing with deterministic rules
 */

export type CalcMethod = 'COUNT' | 'LENGTH' | 'AREA' | 'GLOBAL';

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

    // COUNT: discrete items (highest priority for explicit units)
    if (/\b(un|u|punto|puntos|unidad|unidades|pza|pieza|piezas|equipo|equipos)\b/.test(unitLower)) {
        return {
            method: 'COUNT',
            method_detail: 'block_count',
            confidence: 0.95,
            reason: 'Unit indicates discrete items (punto/unidad)'
        };
    }

    // AREA: square meters
    if (/\b(m2|m²|metro cuadrado|metros cuadrados)\b/.test(unitLower)) {
        return {
            method: 'AREA',
            method_detail: 'hatch_area',
            confidence: 0.95,
            reason: 'Unit indicates area measurement (m²)'
        };
    }

    // LENGTH: linear meters (check not m2 first)
    if (/\b(m|ml|metro|metros|mts|mt)\b/.test(unitLower) &&
        !/\b(m2|m²|cuadrado)\b/.test(unitLower)) {

        // High confidence if infrastructure keywords present
        if (/\b(alimentador|alim|canalización|canalizado|tubería|tubo|ducto|cable|conductor|enlauchado|bandeja)\b/.test(descLower)) {
            return {
                method: 'LENGTH',
                method_detail: 'infrastructure_length',
                confidence: 0.95,
                reason: 'Linear measurement with infrastructure keywords (alimentador/canalización)'
            };
        }

        return {
            method: 'LENGTH',
            method_detail: 'line_length',
            confidence: 0.85,
            reason: 'Unit indicates linear measurement (m/metros)'
        };
    }

    // GLOBAL: services/documentation
    if (/\b(gl|global|servicio|servicios|alcance)\b/.test(unitLower)) {
        return {
            method: 'GLOBAL',
            method_detail: 'global_service',
            confidence: 0.9,
            reason: 'Unit indicates global/service item (gl/global)'
        };
    }

    if (/\b(certificado|as-built|as built|proyecto|ingeniería|tramitación|gestión|coordinación|instalación general)\b/.test(descLower)) {
        return {
            method: 'GLOBAL',
            method_detail: 'global_documentation',
            confidence: 0.85,
            reason: 'Description suggests service/documentation item'
        };
    }

    // FALLBACK: Infer from description keywords

    // Discrete equipment
    if (/\b(enchufe|toma|tomada|tomacorriente|luminaria|lámpara|lampara|interruptor|caja|tablero|equipo|ups|rack|cámara|camara|detector|sensor)\b/.test(descLower)) {
        return {
            method: 'COUNT',
            method_detail: 'equipment_inferred',
            confidence: 0.7,
            reason: 'Description suggests discrete equipment (enchufe/luminaria)'
        };
    }

    // Area work
    if (/\b(pintura|revestimiento|piso|cielo|muro|pared|superficie|pavimento)\b/.test(descLower)) {
        return {
            method: 'AREA',
            method_detail: 'surface_inferred',
            confidence: 0.65,
            reason: 'Description suggests surface work (pintura/revestimiento)'
        };
    }

    // Linear work
    if (/\b(trazado|recorrido|tendido|instalación de|montaje de)\b/.test(descLower)) {
        return {
            method: 'LENGTH',
            method_detail: 'linear_inferred',
            confidence: 0.6,
            reason: 'Description suggests linear work (trazado/tendido)'
        };
    }

    // DEFAULT: COUNT (most conservative)
    return {
        method: 'COUNT',
        method_detail: 'default_unknown',
        confidence: 0.3,
        reason: 'Could not determine from unit or description - defaulting to COUNT'
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
        'AREA': ['area'],
        'GLOBAL': [] // No geometry expected
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
