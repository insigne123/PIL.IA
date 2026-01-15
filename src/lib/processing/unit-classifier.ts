import { Unit } from '@/types';
import { normalizeUnit } from './unit-validator';

/**
 * Expected type classification for Excel items
 * Uses UPPERCASE to match StagingRow.expected_measure_type
 * Now includes VOLUME for m3 support
 */
export type ExpectedType = 'LENGTH' | 'BLOCK' | 'AREA' | 'VOLUME' | 'GLOBAL' | 'UNKNOWN';

export interface ClassificationResult {
    type: ExpectedType;
    confidence: number;
    reason: string;
    method: 'unit_hard' | 'keyword_strong' | 'keyword_weak' | 'header_context' | 'default';
}

/**
 * CANONICAL unit to type mapping
 * This uses NORMALIZED units from unit-validator
 * This is the SINGLE SOURCE OF TRUTH for unit→type classification
 */
const UNIT_TYPE_MAP: Record<string, ExpectedType> = {
    // Length - Only normalized 'm'
    'm': 'LENGTH',

    // Area - Only normalized 'm2'
    'm2': 'AREA',

    // Volume - Only normalized 'm3'
    'm3': 'VOLUME',

    // Block/Unit - Only normalized 'un'
    'un': 'BLOCK',

    // Global - Only normalized 'gl'
    'gl': 'GLOBAL',
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
 * 
 * NEW LOGIC (Phase 1):
 * 1. Unit is ALWAYS the authority if it's recognized
 * 2. Keywords are ONLY hints when unit is UNKNOWN
 * 3. No keyword can override an explicit unit
 * 
 * This ensures type consistency and prevents mismatches
 */
export function classifyItemIntent(description: string, unit: string = ''): ClassificationResult {
    const descLower = description.toLowerCase();

    // Step 1: Normalize the unit using the validator
    const normalizedUnit = normalizeUnit(unit);

    // Step 2: If we have a normalized unit, IT IS THE AUTHORITY
    if (normalizedUnit && UNIT_TYPE_MAP[normalizedUnit]) {
        const type = UNIT_TYPE_MAP[normalizedUnit];
        return {
            type: type,
            confidence: 1.0,
            reason: `Unit '${unit}' (normalized: '${normalizedUnit}') strictly defines ${type}`,
            method: 'unit_hard'
        };
    }

    // Step 3: If unit is present but not recognized (shouldn't happen after validation)
    if (unit && !normalizedUnit) {
        return {
            type: 'UNKNOWN',
            confidence: 0.0,
            reason: `Unit '${unit}' is not recognized`,
            method: 'default'
        };
    }

    // Step 4: No unit provided - use keywords as HINTS ONLY
    // Check for strong global keywords first
    const globalKeywords = [
        'instalacion', 'instalación', 'certificado', 'tramite', 'trámite',
        'legaliza', 'inscripcion', 'rotulacion', 'limpieza', 'aseo',
        'capacitacion', 'ingeneria', 'planos', 'as built', 'puesta en marcha'
    ];

    for (const keyword of globalKeywords) {
        if (descLower.includes(keyword)) {
            return {
                type: 'GLOBAL',
                confidence: 0.85,
                reason: `Description contains global keyword '${keyword}' (no unit provided)`,
                method: 'keyword_strong'
            };
        }
    }

    // Check description keywords (only as hints since no unit)
    for (const [key, type] of Object.entries(KEYWORD_TYPE_MAP)) {
        if (descLower.includes(key)) {
            // Special context refinements
            if (key === 'punto' && (descLower.includes('canaliz') || descLower.includes('tuber'))) {
                continue; // "Punto" in context of piping is likely the pipe itself
            }

            return {
                type: type,
                confidence: 0.7,
                reason: `Description contains keyword '${key}' (no unit provided, using hint)`,
                method: 'keyword_strong'
            };
        }
    }

    // Weak heuristics
    if (descLower.startsWith('punto ') || descLower.startsWith('puntos ')) {
        return {
            type: 'BLOCK',
            confidence: 0.6,
            reason: "Starts with 'Punto' (weak heuristic, no unit)",
            method: 'keyword_weak'
        };
    }

    // Default: Unknown
    return {
        type: 'UNKNOWN',
        confidence: 0.0,
        reason: "No unit provided and no clear keyword classifier found",
        method: 'default'
    };
}

/**
 * Check if a DXF item type matches an expected type
 * @param dxfItemType - Type from DXF item (uppercase)
 * @param expectedType - Expected type from classification
 */
export function typeMatches(
    dxfItemType: 'BLOCK' | 'LENGTH' | 'TEXT' | 'AREA' | 'VOLUME',
    expectedType: ExpectedType
): boolean {
    if (expectedType === 'UNKNOWN') return true;
    if (expectedType === 'GLOBAL') return false;

    const matchMap: Record<ExpectedType, Array<'BLOCK' | 'LENGTH' | 'TEXT' | 'AREA' | 'VOLUME'>> = {
        'LENGTH': ['LENGTH'],
        'BLOCK': ['BLOCK'],
        'AREA': ['AREA'],
        'VOLUME': ['VOLUME'],
        'GLOBAL': [],
        'UNKNOWN': ['BLOCK', 'LENGTH', 'TEXT', 'AREA', 'VOLUME']
    };

    return matchMap[expectedType]?.includes(dxfItemType) || false;
}

/**
 * Helper to get strictly what the UNIT allows (for filtering candidates)
 * Uses normalized units from validator
 */
export function getExpectedMeasureType(unit: string): ExpectedType {
    const normalizedUnit = normalizeUnit(unit);
    if (!normalizedUnit) return 'UNKNOWN';
    return UNIT_TYPE_MAP[normalizedUnit] || 'UNKNOWN';
}

/**
 * NEW: Single source of truth for getting type from unit
 * This function MUST be used in the matching pipeline
 */
export function getTypeForUnit(unit: string): ExpectedType {
    return getExpectedMeasureType(unit);
}

/**
 * Legacy compatibility (optional, can be removed if specific calls are updated)
 */
export function classifyExpectedType(unit: string, description: string): ClassificationResult {
    return classifyItemIntent(description, unit);
}
