/**
 * Unit Classifier V2 - MeasureKind Based
 * 
 * Uses MeasureKind instead of ExpectedType for robust classification
 * 
 * Key principle: Unit is ALWAYS the authority
 * Keywords are only hints when unit is missing or unknown
 */

import { MeasureKind } from '@/types';
import { getMeasureKind, normalizeAndClassifyUnit } from './unit-normalizer';

export interface ClassificationResult {
    measureKind: MeasureKind;
    confidence: number;
    reason: string;
    method: 'unit_authority' | 'keyword_hint' | 'default';
}

/**
 * Keywords that suggest a measure kind when unit is unknown
 * These are HINTS only, never override explicit units
 */
const KEYWORD_HINTS: Record<string, MeasureKind> = {
    // Service keywords
    'instalacion': 'service',
    'instalación': 'service',
    'certificado': 'service',
    'tramite': 'service',
    'legaliza': 'service',
    'capacitacion': 'service',
    'planos': 'service',

    // Length keywords
    'tubería': 'length',
    'tuberia': 'length',
    'cable': 'length',
    'conductor': 'length',
    'canalización': 'length',
    'canalizacion': 'length',
    'ducto': 'length',
    'bandeja': 'length',

    // Count keywords
    'tablero': 'count',
    'gabinete': 'count',
    'luminaria': 'count',
    'sensor': 'count',
    'interruptor': 'count',
    'enchufe': 'count',
};

/**
 * Classify an Excel item by unit and description
 * 
 * NEW LOGIC:
 * 1. If unit is provided -> get MeasureKind from unit (AUTHORITY)
 * 2. If no unit or unknown -> use description keywords as HINT
 * 3. Never let keywords override explicit unit
 */
export function classifyExcelItem(description: string, unit: string = ''): ClassificationResult {
    const descLower = description.toLowerCase();

    // Step 1: Try to get MeasureKind from unit
    if (unit && unit.trim()) {
        const unitResult = normalizeAndClassifyUnit(unit);

        if (unitResult.measureKind !== 'unknown') {
            // Unit provides clear classification
            return {
                measureKind: unitResult.measureKind,
                confidence: unitResult.confidence,
                reason: `Unit '${unit}' (normalized: '${unitResult.normalizedUnit}') defines ${unitResult.measureKind}`,
                method: 'unit_authority'
            };
        }
    }

    // Step 2: No valid unit - use keywords as hints
    for (const [keyword, kind] of Object.entries(KEYWORD_HINTS)) {
        if (descLower.includes(keyword)) {
            return {
                measureKind: kind,
                confidence: 0.7,
                reason: `Description contains keyword '${keyword}' suggesting ${kind} (no unit provided)`,
                method: 'keyword_hint'
            };
        }
    }

    // Step 3: No unit, no keywords -> unknown
    return {
        measureKind: 'unknown',
        confidence: 0.0,
        reason: 'No unit provided and no recognizable keywords',
        method: 'default'
    };
}

/**
 * Get MeasureKind from unit (the primary classification method)
 */
export function getExpectedMeasureKind(unit: string): MeasureKind {
    return getMeasureKind(unit);
}

/**
 * Check if a DXF item type matches expected MeasureKind
 */
export function measureKindMatches(
    dxfItemType: 'block' | 'length' | 'text' | 'area' | 'volume',
    expectedKind: MeasureKind
): boolean {
    if (expectedKind === 'unknown') return true; // Unknown matches anything
    if (expectedKind === 'service') return false; // Service doesn't use geometry

    const matchMap: Record<MeasureKind, string[]> = {
        'length': ['length'],
        'area': ['area'],
        'volume': ['volume'],
        'count': ['block'],
        'service': [],
        'unknown': ['block', 'length', 'area', 'volume']
    };

    return matchMap[expectedKind]?.includes(dxfItemType) || false;
}

// ===== LEGACY COMPATIBILITY =====

/**
 * @deprecated Use MeasureKind instead
 */
export type ExpectedType = 'LENGTH' | 'BLOCK' | 'AREA' | 'VOLUME' | 'GLOBAL' | 'UNKNOWN';

/**
 * @deprecated Use classifyExcelItem instead
 */
export function classifyItemIntent(description: string, unit: string = ''): {
    type: ExpectedType;
    confidence: number;
    reason: string;
    method: string;
} {
    const result = classifyExcelItem(description, unit);

    // Map MeasureKind to legacy ExpectedType
    const typeMap: Record<MeasureKind, ExpectedType> = {
        'length': 'LENGTH',
        'area': 'AREA',
        'volume': 'VOLUME',
        'count': 'BLOCK',
        'service': 'GLOBAL',
        'unknown': 'UNKNOWN'
    };

    return {
        type: typeMap[result.measureKind],
        confidence: result.confidence,
        reason: result.reason,
        method: result.method
    };
}

/**
 * @deprecated Use measureKindMatches instead
 */
export function typeMatches(
    dxfItemType: 'BLOCK' | 'LENGTH' | 'TEXT' | 'AREA' | 'VOLUME',
    expectedType: ExpectedType
): boolean {
    const kindMap: Record<ExpectedType, MeasureKind> = {
        'LENGTH': 'length',
        'AREA': 'area',
        'VOLUME': 'volume',
        'BLOCK': 'count',
        'GLOBAL': 'service',
        'UNKNOWN': 'unknown'
    };

    const dxfTypeMap: Record<string, string> = {
        'BLOCK': 'block',
        'LENGTH': 'length',
        'AREA': 'area',
        'VOLUME': 'volume',
        'TEXT': 'text'
    };

    return measureKindMatches(
        dxfTypeMap[dxfItemType] as any,
        kindMap[expectedType]
    );
}

/**
 * @deprecated Use getExpectedMeasureKind instead
 */
export function getExpectedMeasureType(unit: string): ExpectedType {
    const kind = getMeasureKind(unit);
    const typeMap: Record<MeasureKind, ExpectedType> = {
        'length': 'LENGTH',
        'area': 'AREA',
        'volume': 'VOLUME',
        'count': 'BLOCK',
        'service': 'GLOBAL',
        'unknown': 'UNKNOWN'
    };
    return typeMap[kind];
}

/**
 * @deprecated Use getExpectedMeasureKind instead
 */
export function getTypeForUnit(unit: string): ExpectedType {
    return getExpectedMeasureType(unit);
}
