/**
 * DXF Unit Normalization Module
 * 
 * Handles conversion from DXF drawing units to SI units (meters and m²)
 * This is Phase 2 of the quantity detection pipeline
 * 
 * Responsibilities:
 * - Read $INSUNITS from DXF header
 * - Implement fallback heuristics if $INSUNITS is missing
 * - Calculate toMeters conversion factor
 * - Provide metadata about unit detection confidence
 */

export interface DxfUnitMetadata {
    insunits: number | null;          // Value of $INSUNITS if exists
    toMeters: number;                  // Factor to convert to meters
    toMetersSquared: number;           // Factor to convert to m² (toMeters²)
    source: 'INSUNITS' | 'HEURISTIC' | 'PREFERENCE' | 'DEFAULT';
    confidence: number;                // 0-1, how confident we are
    warnings: string[];
    originalUnit: string;              // Human-readable detected unit
}

/**
 * Complete $INSUNITS mapping
 * Based on AutoCAD documentation
 */
const INSUNITS_MAP: Record<number, { unit: string; toMeters: number }> = {
    0: { unit: 'unitless', toMeters: 1.0 },      // Unitless
    1: { unit: 'inches', toMeters: 0.0254 },     // Inches
    2: { unit: 'feet', toMeters: 0.3048 },       // Feet
    3: { unit: 'miles', toMeters: 1609.34 },     // Miles
    4: { unit: 'mm', toMeters: 0.001 },          // Millimeters
    5: { unit: 'cm', toMeters: 0.01 },           // Centimeters
    6: { unit: 'm', toMeters: 1.0 },             // Meters
    7: { unit: 'km', toMeters: 1000.0 },         // Kilometers
    8: { unit: 'microinches', toMeters: 0.0000000254 },
    9: { unit: 'mils', toMeters: 0.0000254 },
    10: { unit: 'yards', toMeters: 0.9144 },
    11: { unit: 'angstroms', toMeters: 1e-10 },
    12: { unit: 'nanometers', toMeters: 1e-9 },
    13: { unit: 'microns', toMeters: 1e-6 },
    14: { unit: 'decimeters', toMeters: 0.1 },
    15: { unit: 'decameters', toMeters: 10.0 },
    16: { unit: 'hectometers', toMeters: 100.0 },
    17: { unit: 'gigameters', toMeters: 1e9 },
    18: { unit: 'astronomical units', toMeters: 1.496e11 },
    19: { unit: 'light years', toMeters: 9.461e15 },
    20: { unit: 'parsecs', toMeters: 3.086e16 },
};

/**
 * Detect DXF units and calculate conversion factors
 * 
 * Priority:
 * 1. $INSUNITS from header (highest confidence)
 * 2. User preference (medium confidence)
 * 3. Heuristic from geometry magnitudes (low confidence)
 * 4. Default to meters (fallback)
 */
export function detectDxfUnits(
    dxf: any,
    planUnitPreference?: string,  // Now accepts any string (Unit is string)
    boundingBoxDiagonal?: number // Optional: for heuristic
): DxfUnitMetadata {
    const warnings: string[] = [];

    // Priority 1: Read $INSUNITS from header
    if (dxf.header && dxf.header['$INSUNITS'] !== undefined) {
        const insunits = dxf.header['$INSUNITS'];

        if (INSUNITS_MAP[insunits]) {
            const mapping = INSUNITS_MAP[insunits];
            const toMeters = mapping.toMeters;

            return {
                insunits,
                toMeters,
                toMetersSquared: toMeters * toMeters,
                source: 'INSUNITS',
                confidence: 1.0,
                warnings: [],
                originalUnit: mapping.unit
            };
        } else {
            warnings.push(`$INSUNITS value ${insunits} is not recognized`);
        }
    }

    // Priority 2: User preference
    if (planUnitPreference) {
        const preferenceMap: Record<string, number> = {
            'mm': 0.001,
            'cm': 0.01,
            'm': 1.0
        };

        const toMeters = preferenceMap[planUnitPreference] || 1.0;

        warnings.push('Using user-specified unit preference (DXF lacks $INSUNITS)');

        return {
            insunits: null,
            toMeters,
            toMetersSquared: toMeters * toMeters,
            source: 'PREFERENCE',
            confidence: 0.7,
            warnings,
            originalUnit: planUnitPreference
        };
    }

    // Priority 3: Heuristic from geometry
    if (boundingBoxDiagonal !== undefined && boundingBoxDiagonal > 0) {
        const result = inferUnitFromMagnitude(boundingBoxDiagonal);
        warnings.push(`Inferred unit from geometry magnitude: ${result.originalUnit}`);
        warnings.push('This is a heuristic guess - results may not be accurate');

        return {
            ...result,
            warnings
        };
    }

    // Priority 4: Default to meters
    warnings.push('No $INSUNITS found, no user preference, no geometry data');
    warnings.push('Defaulting to meters (this may be incorrect)');

    return {
        insunits: null,
        toMeters: 1.0,
        toMetersSquared: 1.0,
        source: 'DEFAULT',
        confidence: 0.3,
        warnings,
        originalUnit: 'm (assumed)'
    };
}

/**
 * Infer unit from geometry magnitude using heuristics
 * 
 * Common patterns:
 * - Drawing in mm: BBox diagonal typically 1000-100000
 * - Drawing in cm: BBox diagonal typically 100-10000
 * - Drawing in m: BBox diagonal typically 1-1000
 */
function inferUnitFromMagnitude(diagonal: number): DxfUnitMetadata {
    // These thresholds are heuristic and may need tuning
    let inferredUnit: string;
    let toMeters: number;
    let confidence: number;

    if (diagonal > 20000) {
        // Likely millimeters (e.g., 50000mm = 50m building)
        inferredUnit = 'mm (inferred)';
        toMeters = 0.001;
        confidence = 0.6;
    } else if (diagonal > 2000) {
        // Likely centimeters (e.g., 5000cm = 50m building)
        inferredUnit = 'cm (inferred)';
        toMeters = 0.01;
        confidence = 0.5;
    } else if (diagonal > 200) {
        // Could be either cm or m - ambiguous
        inferredUnit = 'cm or m (ambiguous)';
        toMeters = 0.01; // Assume cm to be conservative
        confidence = 0.3;
    } else {
        // Likely meters (e.g., 100m building)
        inferredUnit = 'm (inferred)';
        toMeters = 1.0;
        confidence = 0.5;
    }

    return {
        insunits: null,
        toMeters,
        toMetersSquared: toMeters * toMeters,
        source: 'HEURISTIC',
        confidence,
        warnings: [`Heuristic based on bounding box diagonal: ${diagonal.toFixed(2)}`],
        originalUnit: inferredUnit
    };
}

/**
 * Convert a value from DXF units to meters
 */
export function convertToMeters(value: number, metadata: DxfUnitMetadata): number {
    return value * metadata.toMeters;
}

/**
 * Convert an area from DXF units to m²
 */
export function convertToMetersSquared(area: number, metadata: DxfUnitMetadata): number {
    return area * metadata.toMetersSquared;
}

/**
 * Convert a volume from DXF units to m³
 */
export function convertToMetersCubed(volume: number, metadata: DxfUnitMetadata): number {
    return volume * Math.pow(metadata.toMeters, 3);
}

/**
 * Validate that conversion makes sense
 * Detect if values seem unconverted (common bug)
 */
export function validateConversion(
    valueRaw: number,
    valueSI: number,
    expectedType: 'length' | 'area' | 'volume',
    metadata: DxfUnitMetadata
): { isValid: boolean; warning?: string } {
    // Check if valueSI is suspiciously close to valueRaw when conversion should happen
    if (metadata.toMeters !== 1.0) {
        const ratio = valueSI / valueRaw;
        const expectedRatio =
            expectedType === 'length' ? metadata.toMeters :
                expectedType === 'area' ? metadata.toMetersSquared :
                    Math.pow(metadata.toMeters, 3);

        const diff = Math.abs(ratio - expectedRatio);

        // If difference is significant, conversion may be wrong
        if (diff > 0.01 * expectedRatio) {
            return {
                isValid: false,
                warning: `Conversion mismatch: expected ratio ${expectedRatio.toFixed(4)}, got ${ratio.toFixed(4)}`
            };
        }
    }

    // Check for impossible values
    if (expectedType === 'length' && valueSI > 100000) {
        return {
            isValid: false,
            warning: `Length ${valueSI}m is suspiciously large - may indicate unconverted mm/cm`
        };
    }

    if (expectedType === 'area' && valueSI > 10000000) {
        return {
            isValid: false,
            warning: `Area ${valueSI}m² is suspiciously large - may indicate unconverted units`
        };
    }

    return { isValid: true };
}

/**
 * Create a conversion summary for logging
 */
export function getConversionSummary(metadata: DxfUnitMetadata): string {
    const parts = [
        `Source: ${metadata.source}`,
        `Unit: ${metadata.originalUnit}`,
        `Factor: ${metadata.toMeters} (${metadata.source === 'INSUNITS' ? `$INSUNITS=${metadata.insunits}` : 'inferred'})`,
        `Confidence: ${(metadata.confidence * 100).toFixed(0)}%`
    ];

    if (metadata.warnings.length > 0) {
        parts.push(`Warnings: ${metadata.warnings.join('; ')}`);
    }

    return parts.join(' | ');
}
