/**
 * Unit Validator
 * 
 * Validates and normalizes Excel units to ensure every row has a valid unit
 * before processing. This is the first gate in the pipeline.
 * 
 * Responsibilities:
 * - Obtain excel_unit from each row
 * - Normalize unit variants (m, ml, mts -> 'm')
 * - Detect invalid or missing units
 * - Mark rows for skip if they lack valid units
 */

export interface UnitValidationResult {
    isValid: boolean;
    normalizedUnit: string | null;
    skipReason?: 'no_unit' | 'invalid_unit' | 'ambiguous_unit';
    originalUnit: string;
    confidence: number; // 0-1
}

/**
 * Comprehensive unit normalization map
 * Maps all known variants to canonical forms
 */
const UNIT_NORMALIZATION_MAP: Record<string, string> = {
    // Length variants -> 'm'
    'm': 'm',
    'ml': 'm',
    'mts': 'm',
    'mt': 'm',
    'metro': 'm',
    'metros': 'm',
    'mts.': 'm',
    'mt.': 'm',
    'm.': 'm',
    'ml.': 'm',

    // Area variants -> 'm2'
    'm2': 'm2',
    'm²': 'm2',
    'm^2': 'm2',
    'metro cuadrado': 'm2',
    'metros cuadrados': 'm2',
    'm2.': 'm2',
    'm².': 'm2',

    // Volume variants -> 'm3'
    'm3': 'm3',
    'm³': 'm3',
    'm^3': 'm3',
    'metro cubico': 'm3',
    'metros cubicos': 'm3',
    'metro cúbico': 'm3',
    'metros cúbicos': 'm3',
    'm3.': 'm3',
    'm³.': 'm3',

    // Count/Unit variants -> 'un'
    'u': 'un',
    'un': 'un',
    'und': 'un',
    'unid': 'un',
    'unidad': 'un',
    'unidades': 'un',
    'u.': 'un',
    'un.': 'un',
    'und.': 'un',
    'unid.': 'un',

    // Piece variants -> 'un'
    'pza': 'un',
    'pieza': 'un',
    'piezas': 'un',
    'pza.': 'un',

    // Point variants -> 'un'
    'punto': 'un',
    'puntos': 'un',
    'pto': 'un',
    'ptos': 'un',
    'pto.': 'un',
    'ptos.': 'un',

    // Global/Service variants -> 'gl'
    'gl': 'gl',
    'glb': 'gl',
    'global': 'gl',
    'gl.': 'gl',
    'glb.': 'gl',

    // Alcance (scope) -> 'gl'
    'alcance': 'gl',
    'servicio': 'gl',

    // Installation variants -> 'gl'
    'instalacion': 'gl',
    'instalación': 'gl',
    'inst': 'gl',
    'inst.': 'gl',

    // By client/mandante -> 'gl'
    'por mandante': 'gl',
    'mandante': 'gl',
    'p/mandante': 'gl',
    'pm': 'gl',

    // Estimate -> 'gl'
    'est': 'gl',
    'est.': 'gl',
    'estimado': 'gl',

    // Package -> 'gl'
    'pa': 'gl',
    'paquete': 'gl',
};

/**
 * Units that should never be used for geometry measurement
 * These are valid units but indicate service/global items
 */
const NON_GEOMETRIC_UNITS = new Set(['gl']);

/**
 * Validates and normalizes an Excel unit string
 * 
 * @param rawUnit - Raw unit string from Excel cell
 * @returns Validation result with normalized unit or skip reason
 */
export function validateExcelUnit(rawUnit: string | null | undefined): UnitValidationResult {
    // Handle missing/null/undefined
    if (!rawUnit || rawUnit === null || rawUnit === undefined) {
        return {
            isValid: false,
            normalizedUnit: null,
            skipReason: 'no_unit',
            originalUnit: String(rawUnit || ''),
            confidence: 0
        };
    }

    const original = rawUnit;

    // Normalize: lowercase, trim, remove extra spaces
    let normalized = rawUnit
        .toString()
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' '); // Multiple spaces -> single space

    // Try exact match first
    if (UNIT_NORMALIZATION_MAP[normalized]) {
        return {
            isValid: true,
            normalizedUnit: UNIT_NORMALIZATION_MAP[normalized],
            originalUnit: original,
            confidence: 1.0
        };
    }

    // Try without punctuation
    const noPunct = normalized.replace(/[.,;:]/g, '');
    if (UNIT_NORMALIZATION_MAP[noPunct]) {
        return {
            isValid: true,
            normalizedUnit: UNIT_NORMALIZATION_MAP[noPunct],
            originalUnit: original,
            confidence: 0.95
        };
    }

    // Try common abbreviation patterns
    // e.g., "c.u" -> "un", "m.l" -> "m"
    const abbrev = noPunct.replace(/\./g, '').replace(/\s/g, '');
    if (UNIT_NORMALIZATION_MAP[abbrev]) {
        return {
            isValid: true,
            normalizedUnit: UNIT_NORMALIZATION_MAP[abbrev],
            originalUnit: original,
            confidence: 0.9
        };
    }

    // Check if it looks like a unit but isn't recognized
    // e.g., "kg", "lts", etc.
    const looksLikeUnit = /^[a-z]{1,4}[0-9²³]?\.?$/.test(normalized);

    if (looksLikeUnit) {
        return {
            isValid: false,
            normalizedUnit: null,
            skipReason: 'invalid_unit',
            originalUnit: original,
            confidence: 0
        };
    }

    // Empty or very long strings
    if (normalized.length === 0 || normalized.length > 30) {
        return {
            isValid: false,
            normalizedUnit: null,
            skipReason: 'no_unit',
            originalUnit: original,
            confidence: 0
        };
    }

    // Default: invalid unit
    return {
        isValid: false,
        normalizedUnit: null,
        skipReason: 'invalid_unit',
        originalUnit: original,
        confidence: 0
    };
}

/**
 * Quick helper to just get normalized unit or null
 * 
 * @param rawUnit - Raw unit string
 * @returns Normalized unit string or null if invalid
 */
export function normalizeUnit(rawUnit: string | null | undefined): string | null {
    const result = validateExcelUnit(rawUnit);
    return result.normalizedUnit;
}

/**
 * Check if a unit requires geometry extraction (vs. service/global)
 * 
 * @param unit - Normalized unit string
 * @returns true if unit requires DXF geometry, false if global/service
 */
export function requiresGeometry(unit: string): boolean {
    return !NON_GEOMETRIC_UNITS.has(unit);
}

/**
 * Get all valid normalized units (for testing/documentation)
 */
export function getValidUnits(): string[] {
    return Array.from(new Set(Object.values(UNIT_NORMALIZATION_MAP)));
}

/**
 * Get all unit variants for a normalized unit (for testing/documentation)
 */
export function getUnitVariants(normalizedUnit: string): string[] {
    return Object.entries(UNIT_NORMALIZATION_MAP)
        .filter(([_, normalized]) => normalized === normalizedUnit)
        .map(([variant, _]) => variant);
}
