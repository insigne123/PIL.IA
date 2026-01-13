/**
 * Deterministic classifier for expected item types based on Excel unit and description
 * This replaces guessing with rule-based classification
 */

export type ExpectedType = 'LENGTH' | 'BLOCK' | 'AREA' | 'GLOBAL' | 'UNKNOWN';

export interface ClassificationResult {
    type: ExpectedType;
    confidence: number; // 0-1
    reason: string;
}

/**
 * Classify expected type from Excel unit and description
 */
export function classifyExpectedType(
    excelUnit: string,
    description: string
): ClassificationResult {
    const unitLower = excelUnit.toLowerCase().trim();
    const descLower = description.toLowerCase();

    // HIGH CONFIDENCE RULES (from unit)

    // LENGTH indicators
    if (/\b(m|ml|metro|metros|mts|mt)\b/.test(unitLower)) {
        return {
            type: 'LENGTH',
            confidence: 0.95,
            reason: 'Unit indicates linear measurement (m/metros)'
        };
    }

    // AREA indicators
    if (/\b(m2|m²|metro cuadrado|metros cuadrados)\b/.test(unitLower)) {
        return {
            type: 'AREA',
            confidence: 0.95,
            reason: 'Unit indicates area measurement (m²)'
        };
    }

    // BLOCK/POINT indicators
    if (/\b(punto|puntos|unidad|unidades|u|un|pza|pieza|piezas)\b/.test(unitLower)) {
        return {
            type: 'BLOCK',
            confidence: 0.9,
            reason: 'Unit indicates discrete items (punto/unidad)'
        };
    }

    // GLOBAL indicators
    if (/\b(gl|global|alcance|servicio|instalación)\b/.test(unitLower)) {
        return {
            type: 'GLOBAL',
            confidence: 0.85,
            reason: 'Unit indicates global/service item (gl/global)'
        };
    }

    // MEDIUM CONFIDENCE RULES (from description when unit is ambiguous)

    // LENGTH from description
    if (/\b(alimentador|canalización|canalizado|tubería|ducto|cable|conductor|enlauchado)\b/.test(descLower)) {
        return {
            type: 'LENGTH',
            confidence: 0.7,
            reason: 'Description suggests linear element (alimentador/canalización)'
        };
    }

    // BLOCK from description
    if (/\b(enchufe|toma|luminaria|lámpara|interruptor|caja|tablero|equipo|ups|rack|cámara|detector)\b/.test(descLower)) {
        return {
            type: 'BLOCK',
            confidence: 0.7,
            reason: 'Description suggests discrete equipment (enchufe/luminaria)'
        };
    }

    // AREA from description
    if (/\b(pintura|revestimiento|piso|cielo|muro|pared|superficie)\b/.test(descLower)) {
        return {
            type: 'AREA',
            confidence: 0.65,
            reason: 'Description suggests surface work (pintura/revestimiento)'
        };
    }

    // GLOBAL from description
    if (/\b(certificado|as-built|proyecto|ingeniería|tramitación|gestión|coordinación)\b/.test(descLower)) {
        return {
            type: 'GLOBAL',
            confidence: 0.75,
            reason: 'Description suggests service/documentation (certificado/proyecto)'
        };
    }

    // DEFAULT: UNKNOWN
    return {
        type: 'UNKNOWN',
        confidence: 0.0,
        reason: 'Could not determine type from unit or description'
    };
}

/**
 * Check if a DXF item type matches the expected type
 */
export function typeMatches(
    dxfItemType: 'block' | 'length' | 'text',
    expectedType: ExpectedType
): boolean {
    if (expectedType === 'UNKNOWN') return true; // Accept any match if unknown
    if (expectedType === 'GLOBAL') return false; // Global items don't match CAD geometry

    const matchMap: Record<ExpectedType, Array<'block' | 'length' | 'text'>> = {
        'LENGTH': ['length'],
        'BLOCK': ['block'],
        'AREA': ['length'], // Area can be derived from length (perimeter)
        'GLOBAL': [],
        'UNKNOWN': ['block', 'length', 'text']
    };

    return matchMap[expectedType]?.includes(dxfItemType) || false;
}

/**
 * Get a human-readable explanation of the classification
 */
export function getClassificationExplanation(result: ClassificationResult): string {
    const confidenceLabel = result.confidence >= 0.9 ? 'Alta' :
        result.confidence >= 0.7 ? 'Media' :
            result.confidence >= 0.5 ? 'Baja' : 'Muy baja';

    return `Tipo esperado: ${result.type} (Confianza: ${confidenceLabel}) - ${result.reason}`;
}

/**
 * Batch classify multiple items
 */
export function batchClassify(
    items: Array<{ unit: string; description: string }>
): ClassificationResult[] {
    return items.map(item => classifyExpectedType(item.unit, item.description));
}

/**
 * Get statistics about classifications
 */
export function getClassificationStats(results: ClassificationResult[]): {
    byType: Record<ExpectedType, number>;
    avgConfidence: number;
    unknownCount: number;
} {
    const byType: Record<ExpectedType, number> = {
        'LENGTH': 0,
        'BLOCK': 0,
        'AREA': 0,
        'GLOBAL': 0,
        'UNKNOWN': 0
    };

    let totalConfidence = 0;
    let unknownCount = 0;

    for (const result of results) {
        byType[result.type]++;
        totalConfidence += result.confidence;
        if (result.type === 'UNKNOWN') unknownCount++;
    }

    return {
        byType,
        avgConfidence: results.length > 0 ? totalConfidence / results.length : 0,
        unknownCount
    };
}
