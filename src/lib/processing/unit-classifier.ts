import { Unit } from '@/types';

/**
 * Expected type classification for Excel items
 * Uses UPPERCASE to match StagingRow.expected_measure_type
 */
export type ExpectedType = 'LENGTH' | 'BLOCK' | 'AREA' | 'GLOBAL' | 'UNKNOWN';

export interface ClassificationResult {
    type: ExpectedType;
    confidence: number;
    reason: string;
    method: 'unit_hard' | 'keyword_strong' | 'keyword_weak' | 'header_context' | 'default';
}

/**
 * Hard mapping of Units to Expected Geometry Types
 */
const UNIT_TYPE_MAP: Record<string, ExpectedType> = {
    // Length
    'm': 'LENGTH',
    'ml': 'LENGTH',
    'mts': 'LENGTH',
    'metro': 'LENGTH',
    'metros': 'LENGTH',
    'mt': 'LENGTH',

    // Area
    'm2': 'AREA',
    'm²': 'AREA',
    'metro cuadrado': 'AREA',
    'metros cuadrados': 'AREA',

    // Block/Unit
    'u': 'BLOCK',
    'un': 'BLOCK',
    'und': 'BLOCK',
    'unid': 'BLOCK',
    'unidad': 'BLOCK',
    'unidades': 'BLOCK',
    'pza': 'BLOCK',
    'pieza': 'BLOCK',
    'piezas': 'BLOCK',
    'punto': 'BLOCK',
    'puntos': 'BLOCK',
    'pto': 'BLOCK',
    'ptos': 'BLOCK',

    // Global
    'gl': 'GLOBAL',
    'glb': 'GLOBAL',
    'global': 'GLOBAL',
    'alcance': 'GLOBAL',
    'servicio': 'GLOBAL',
    'instalación': 'GLOBAL',
    'instalacion': 'GLOBAL',
    'por mandante': 'GLOBAL',
    'mandante': 'GLOBAL',
};

/**
 * Strong keywords that almost guarantee a type regardless of unit (unless unit contradicts strongly)
 */
const KEYWORD_TYPE_MAP: Record<string, 'LENGTH' | 'BLOCK' | 'AREA' | 'GLOBAL'> = {
    // Global Keywords
    'instalacion': 'GLOBAL',
    'instalación': 'GLOBAL',
    'certificado': 'GLOBAL',
    'tramite': 'GLOBAL',
    'trámite': 'GLOBAL',
    'legaliza': 'GLOBAL',
    'inscripcion': 'GLOBAL',
    'rotulacion': 'GLOBAL',
    'limpieza': 'GLOBAL',
    'aseo': 'GLOBAL',
    'capacitacion': 'GLOBAL',
    'ingeneria': 'GLOBAL',
    'planos': 'GLOBAL',
    'as built': 'GLOBAL',
    'puesta en marcha': 'GLOBAL',
    ' provision': 'GLOBAL', // solo "provision" a veces es compra sin inst

    // Length Keywords
    'canalización': 'LENGTH',
    'canalizacion': 'LENGTH',
    'ducto': 'LENGTH',
    'tubería': 'LENGTH',
    'tuberia': 'LENGTH',
    'tubo': 'LENGTH',
    'cable': 'LENGTH',
    'conductor': 'LENGTH',
    'cañería': 'LENGTH',
    'cañeria': 'LENGTH',
    'bandeja': 'LENGTH',
    'escalerilla': 'LENGTH',
    'malla': 'LENGTH',
    'baranda': 'LENGTH',
    'pasamanos': 'LENGTH',

    // Block Keywords
    'tablero': 'BLOCK',
    'gabinete': 'BLOCK',
    'rack': 'BLOCK',
    'ups': 'BLOCK',
    'transformador': 'BLOCK',
    'generador': 'BLOCK',
    'cámara': 'BLOCK',
    'camara': 'BLOCK',
    'sensor': 'BLOCK',
    'detector': 'BLOCK',
    'modulo': 'BLOCK',
    'enchufe': 'BLOCK',
    'interruptor': 'BLOCK',
    'luminaria': 'BLOCK',
    'foco': 'BLOCK',
    'equipo': 'BLOCK',
    'sirena': 'BLOCK',
    'pulsador': 'BLOCK',
    'poste': 'BLOCK',
    'curva': 'BLOCK', // Accesorios suelen ser bloques
    'copla': 'BLOCK',
    'terminal': 'BLOCK',
    'caja': 'BLOCK', // OJO: Caja a veces es paso (block)
};

/**
 * Centralized logic to classify what kind of geometry we expect for an item
 */
export function classifyItemIntent(description: string, unit: string = ''): ClassificationResult {
    const descLower = description.toLowerCase();
    const unitLower = unit.toLowerCase().trim().replace('.', ''); // remove dots (c.u -> cu)

    // 1. Check Unit (Highest Authority for Hard Constraints)
    // Priority 1: GLOBAL Unit overrides everything
    if (['gl', 'glb', 'global', 'pa', 'est'].includes(unitLower)) {
        return {
            type: 'GLOBAL',
            confidence: 1.0,
            reason: `Unit '${unit}' implies Global/Service`,
            method: 'unit_hard'
        };
    }

    // Priority 2: Explicit "By Mandante" or "Service" keywords override Geometry
    if (unitLower.includes('mandante') || unitLower.includes('cliente')) {
        return {
            type: 'GLOBAL',
            confidence: 0.9,
            reason: "Unit implies provided by client",
            method: 'keyword_strong'
        };
    }

    // Priority 3: Strong Keywords (Geometry)
    // We check description keywords.
    for (const [key, type] of Object.entries(KEYWORD_TYPE_MAP)) {
        if (descLower.includes(key)) {
            // Special Exception: "Caja" is Block, but "Alimentador desde caja" is Length.
            // Check context or allow longer matches to override shorter ones?
            // "Alimentador" is already checked.

            // Refinement for "Punto":
            // "Punto de red" -> Block
            // "Punto electrico" -> Block
            if (key === 'punto' && (descLower.includes('canaliz') || descLower.includes('tuber'))) {
                continue; // It's likely describing the pipe to the point
            }

            return {
                type: type,
                confidence: 0.85,
                reason: `Description contains strong keyword '${key}'`,
                method: 'keyword_strong'
            };
        }
    }

    // Priority 4: Unit-based Geometry
    if (UNIT_TYPE_MAP[unitLower]) {
        return {
            type: UNIT_TYPE_MAP[unitLower],
            confidence: 0.8,
            reason: `Unit '${unit}' implies ${UNIT_TYPE_MAP[unitLower]}`,
            method: 'unit_hard'
        };
    }

    // Priority 5: Weak/Heuristic Rules
    if (descLower.startsWith('punto ') || descLower.startsWith('puntos ')) {
        return {
            type: 'BLOCK',
            confidence: 0.7,
            reason: "Starts with 'Punto'",
            method: 'keyword_weak'
        };
    }

    // Default
    return {
        type: 'UNKNOWN',
        confidence: 0.0,
        reason: "No clear classifier found",
        method: 'default'
    };
}

/**
 * Check if a DXF item type matches an expected type
 * @param dxfItemType - Type from DXF item (now in UPPERCASE)
 * @param expectedType - Expected type from classification
 */
export function typeMatches(
    dxfItemType: 'BLOCK' | 'LENGTH' | 'TEXT' | 'AREA',
    expectedType: ExpectedType
): boolean {
    if (expectedType === 'UNKNOWN') return true;
    if (expectedType === 'GLOBAL') return false;

    const matchMap: Record<ExpectedType, Array<'BLOCK' | 'LENGTH' | 'TEXT' | 'AREA'>> = {
        'LENGTH': ['LENGTH'],
        'BLOCK': ['BLOCK'],
        'AREA': ['AREA'],
        'GLOBAL': [],
        'UNKNOWN': ['BLOCK', 'LENGTH', 'TEXT', 'AREA']
    };

    return matchMap[expectedType]?.includes(dxfItemType) || false;
}

/**
 * Helper to get strictly what the UNIT allows (for filtering candidates)
 */
export function getExpectedMeasureType(unit: string): ExpectedType {
    const unitLower = unit.toLowerCase().trim().replace('.', '');
    return UNIT_TYPE_MAP[unitLower] || 'UNKNOWN';
}

/**
 * Legacy compatibility (optional, can be removed if specific calls are updated)
 */
export function classifyExpectedType(unit: string, description: string): ClassificationResult {
    return classifyItemIntent(description, unit);
}
