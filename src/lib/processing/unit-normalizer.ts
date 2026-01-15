/**
 * Unit Normalizer & MeasureKind Classifier
 * 
 * Phase 2 Enhancement: Robust unit handling without restrictive TypeScript types
 * 
 * Key Improvements:
 * 1. Accepts ANY string as unit (no TypeScript errors)
 * 2. Normalizes all variants (m², m2, m^2 -> 'm2')
 * 3. Maps to MeasureKind for type-safe classification
 * 4. Handles scale conversion (cm2, mm2 -> m2 with scale flag)
 * 
 * The pipeline depends on MeasureKind, NOT on Unit type
 */

import { MeasureKind } from '@/types';

export interface UnitNormalizationResult {
    isValid: boolean;
    normalizedUnit: string | null;
    measureKind: MeasureKind;
    skipReason?: 'no_unit' | 'invalid_unit';
    originalUnit: string;
    confidence: number; // 0-1
    scaleSource?: 'unit_string'; // If we converted cm2/mm2 to m2
    scaleConversionFactor?: number; // If scale conversion was applied
}

/**
 * Normalize a unit string to canonical form
 * 
 * Rules:
 * 1. trim, lowercase
 * 2. Convert superscripts: ² -> 2, ³ -> 3
 * 3. Remove dots and extra spaces
 * 4. Map variants to canonical form
 */
function normalizeUnitString(raw: string): string {
    let normalized = raw
        .toString()
        .trim()
        .toLowerCase();

    // Convert superscripts and special characters
    normalized = normalized
        .replace(/²/g, '2')
        .replace(/³/g, '3')
        .replace(/\^2/g, '2')
        .replace(/\^3/g, '3')
        .replace(/\s+/g, ' ')  // Multiple spaces -> single space
        .replace(/[.,;:]/g, ''); // Remove punctuation

    return normalized;
}

/**
 * Comprehensive unit normalization map
 * Maps all variants to canonical forms
 */
const UNIT_NORMALIZATION_MAP: Record<string, { canonical: string; kind: MeasureKind }> = {
    // ===  LENGTH (canonical: 'm') ===
    'm': { canonical: 'm', kind: 'length' },
    'ml': { canonical: 'm', kind: 'length' },
    'mts': { canonical: 'm', kind: 'length' },
    'mt': { canonical: 'm', kind: 'length' },
    'metro': { canonical: 'm', kind: 'length' },
    'metros': { canonical: 'm', kind: 'length' },

    // === AREA (canonical: 'm2') ===
    'm2': { canonical: 'm2', kind: 'area' },
    'metro cuadrado': { canonical: 'm2', kind: 'area' },
    'metros cuadrados': { canonical: 'm2', kind: 'area' },

    // Special: cm2, mm2 -> needs scale conversion (handled separately)

    // === VOLUME (canonical: 'm3') ===
    'm3': { canonical: 'm3', kind: 'volume' },
    'metro cubico': { canonical: 'm3', kind: 'volume' },
    'metros cubicos': { canonical: 'm3', kind: 'volume' },
    'metro cúbico': { canonical: 'm3', kind: 'volume' },
    'metros cúbicos': { canonical: 'm3', kind: 'volume' },

    // === COUNT (canonical: 'un') ===
    'u': { canonical: 'un', kind: 'count' },
    'un': { canonical: 'un', kind: 'count' },
    'und': { canonical: 'un', kind: 'count' },
    'unid': { canonical: 'un', kind: 'count' },
    'unidad': { canonical: 'un', kind: 'count' },
    'unidades': { canonical: 'un', kind: 'count' },

    'pza': { canonical: 'un', kind: 'count' },
    'pieza': { canonical: 'un', kind: 'count' },
    'piezas': { canonical: 'un', kind: 'count' },

    'punto': { canonical: 'un', kind: 'count' },
    'puntos': { canonical: 'un', kind: 'count' },
    'pto': { canonical: 'un', kind: 'count' },
    'ptos': { canonical: 'un', kind: 'count' },

    // === SERVICE/GLOBAL (canonical: 'gl') ===
    'gl': { canonical: 'gl', kind: 'service' },
    'glb': { canonical: 'gl', kind: 'service' },
    'global': { canonical: 'gl', kind: 'service' },

    'alcance': { canonical: 'gl', kind: 'service' },
    'servicio': { canonical: 'gl', kind: 'service' },

    'instalacion': { canonical: 'gl', kind: 'service' },
    'instalación': { canonical: 'gl', kind: 'service' },
    'inst': { canonical: 'gl', kind: 'service' },

    'por mandante': { canonical: 'gl', kind: 'service' },
    'mandante': { canonical: 'gl', kind: 'service' },
    'p/mandante': { canonical: 'gl', kind: 'service' },
    'pm': { canonical: 'gl', kind: 'service' },

    'est': { canonical: 'gl', kind: 'service' },
    'estimado': { canonical: 'gl', kind: 'service' },

    'pa': { canonical: 'gl', kind: 'service' },
    'paquete': { canonical: 'gl', kind: 'service' },
};

/**
 * Validate and normalize a unit from Excel
 * 
 * This is THE authoritative unit normalization function
 */
export function normalizeAndClassifyUnit(rawUnit: string | null | undefined): UnitNormalizationResult {
    // Handle missing/null/undefined
    if (!rawUnit || rawUnit === null || rawUnit === undefined) {
        return {
            isValid: false,
            normalizedUnit: null,
            measureKind: 'unknown',
            skipReason: 'no_unit',
            originalUnit: String(rawUnit || ''),
            confidence: 0
        };
    }

    const original = rawUnit;

    // Empty or very long strings
    if (original.trim().length === 0) {
        return {
            isValid: false,
            normalizedUnit: null,
            measureKind: 'unknown',
            skipReason: 'no_unit',
            originalUnit: original,
            confidence: 0
        };
    }

    if (original.length > 50) {
        return {
            isValid: false,
            normalizedUnit: null,
            measureKind: 'unknown',
            skipReason: 'invalid_unit',
            originalUnit: original,
            confidence: 0
        };
    }

    // Normalize the string
    const normalized = normalizeUnitString(original);

    // Check if it's in our map
    if (UNIT_NORMALIZATION_MAP[normalized]) {
        const mapping = UNIT_NORMALIZATION_MAP[normalized];
        return {
            isValid: true,
            normalizedUnit: mapping.canonical,
            measureKind: mapping.kind,
            originalUnit: original,
            confidence: 1.0
        };
    }

    // Special case: cm2, mm2 (area in non-SI units)
    if (normalized === 'cm2' || normalized.includes('centimetro') && normalized.includes('cuadrado')) {
        return {
            isValid: true,
            normalizedUnit: 'm2',
            measureKind: 'area',
            originalUnit: original,
            confidence: 0.95,
            scaleSource: 'unit_string',
            scaleConversionFactor: 0.0001 // cm² to m²
        };
    }

    if (normalized === 'mm2' || normalized.includes('milimetro') && normalized.includes('cuadrado')) {
        return {
            isValid: true,
            normalizedUnit: 'm2',
            measureKind: 'area',
            originalUnit: original,
            confidence: 0.95,
            scaleSource: 'unit_string',
            scaleConversionFactor: 0.000001 // mm² to m²
        };
    }

    // Unknown unit - don't error, just mark as unknown
    return {
        isValid: false,
        normalizedUnit: null,
        measureKind: 'unknown',
        skipReason: 'invalid_unit',
        originalUnit: original,
        confidence: 0
    };
}

/**
 * Get MeasureKind from a unit string
 * This is the function the pipeline should use for classification
 */
export function getMeasureKind(unit: string | null | undefined): MeasureKind {
    const result = normalizeAndClassifyUnit(unit);
    return result.measureKind;
}

/**
 * Quick check if a unit requires geometry extraction
 */
export function requiresGeometry(measureKind: MeasureKind): boolean {
    return measureKind !== 'service' && measureKind !== 'unknown';
}

/**
 * Get all supported canonical units (for testing/documentation)
 */
export function getSupportedUnits(): Array<{ canonical: string; kind: MeasureKind; examples: string[] }> {
    const groups = new Map<string, { kind: MeasureKind; examples: Set<string> }>();

    for (const [variant, { canonical, kind }] of Object.entries(UNIT_NORMALIZATION_MAP)) {
        if (!groups.has(canonical)) {
            groups.set(canonical, { kind, examples: new Set() });
        }
        groups.get(canonical)!.examples.add(variant);
    }

    return Array.from(groups.entries()).map(([canonical, { kind, examples }]) => ({
        canonical,
        kind,
        examples: Array.from(examples)
    }));
}

/**
 * Legacy compatibility: validateExcelUnit
 * Wraps new function for backward compatibility
 */
export function validateExcelUnit(rawUnit: string | null | undefined) {
    return normalizeAndClassifyUnit(rawUnit);
}

/**
 * Legacy compatibility: normalizeUnit
 */
export function normalizeUnit(rawUnit: string | null | undefined): string | null {
    const result = normalizeAndClassifyUnit(rawUnit);
    return result.normalizedUnit;
}
