/**
 * Statistical Quantity Validator
 *
 * Validates calculated quantities against expected ranges based on:
 * - Item type (floor, wall, fixture, etc.)
 * - Unit of measurement (m2, ml, un, gl)
 * - Contextual information from description
 *
 * Detects:
 * - Absurd values (e.g., 1112 units when should be 1-3)
 * - Suspicious values (e.g., 0.96m² for sobrelosa that should be ~60m²)
 * - Fractional counts for unit items
 */

export interface QuantityBounds {
    unit: string;
    context?: string;  // 'floor', 'wall', 'fixture', etc.
    typical_min: number;
    typical_max: number;
    absolute_max: number;
    allow_fractional?: boolean;
}

export interface ValidationResult {
    valid: boolean;
    severity: 'ok' | 'warning' | 'error';
    message?: string;
    suggested_action?: 'accept' | 'review' | 'reject';
}

// Comprehensive bounds database
const QUANTITY_BOUNDS: QuantityBounds[] = [
    // ==================== UNITS (COUNT) ====================
    {
        unit: 'un',
        context: 'general',
        typical_min: 1,
        typical_max: 50,
        absolute_max: 500,
        allow_fractional: false
    },
    {
        unit: 'u',
        context: 'general',
        typical_min: 1,
        typical_max: 50,
        absolute_max: 500,
        allow_fractional: false
    },
    {
        unit: 'gl',
        context: 'general',
        typical_min: 1,
        typical_max: 1,
        absolute_max: 1,
        allow_fractional: false
    },
    {
        unit: 'und',
        context: 'general',
        typical_min: 1,
        typical_max: 50,
        absolute_max: 500,
        allow_fractional: false
    },

    // ==================== AREAS (m²) ====================
    // Floors and slabs
    {
        unit: 'm2',
        context: 'floor',
        typical_min: 10,
        typical_max: 200,
        absolute_max: 2000,
        allow_fractional: true
    },
    {
        unit: 'm²',
        context: 'floor',
        typical_min: 10,
        typical_max: 200,
        absolute_max: 2000,
        allow_fractional: true
    },

    // Walls
    {
        unit: 'm2',
        context: 'wall',
        typical_min: 5,
        typical_max: 150,
        absolute_max: 1000,
        allow_fractional: true
    },
    {
        unit: 'm²',
        context: 'wall',
        typical_min: 5,
        typical_max: 150,
        absolute_max: 1000,
        allow_fractional: true
    },

    // Ceilings
    {
        unit: 'm2',
        context: 'ceiling',
        typical_min: 10,
        typical_max: 150,
        absolute_max: 1000,
        allow_fractional: true
    },
    {
        unit: 'm²',
        context: 'ceiling',
        typical_min: 10,
        typical_max: 150,
        absolute_max: 1000,
        allow_fractional: true
    },

    // Small items (fixtures, details, waterproofing patches)
    {
        unit: 'm2',
        context: 'small',
        typical_min: 0.01,
        typical_max: 10,
        absolute_max: 50,
        allow_fractional: true
    },
    {
        unit: 'm²',
        context: 'small',
        typical_min: 0.01,
        typical_max: 10,
        absolute_max: 50,
        allow_fractional: true
    },

    // ==================== LENGTHS (m, ml) ====================
    {
        unit: 'ml',
        context: 'general',
        typical_min: 1,
        typical_max: 200,
        absolute_max: 1000,
        allow_fractional: true
    },
    {
        unit: 'm',
        context: 'general',
        typical_min: 1,
        typical_max: 200,
        absolute_max: 1000,
        allow_fractional: true
    },

    // ==================== VOLUMES (m³) ====================
    {
        unit: 'm3',
        context: 'general',
        typical_min: 0.1,
        typical_max: 100,
        absolute_max: 1000,
        allow_fractional: true
    },
    {
        unit: 'm³',
        context: 'general',
        typical_min: 0.1,
        typical_max: 100,
        absolute_max: 1000,
        allow_fractional: true
    }
];

/**
 * Infer context from item description
 */
function inferContext(description: string, unit: string): string {
    const descLower = description.toLowerCase();

    // Floor/slab patterns
    if (descLower.match(/\b(losa|sobrelosa|piso|pavimento|floor|slab|radier|contrapiso)\b/)) {
        return 'floor';
    }

    // Wall patterns
    if (descLower.match(/\b(muro|muros|wall|walls|tabique|sobretabique|partition|mamposteria)\b/)) {
        return 'wall';
    }

    // Ceiling patterns
    if (descLower.match(/\b(cielo|cielos|ceiling|raso|plafon|volcanita|falso\s*cielo)\b/)) {
        return 'ceiling';
    }

    // Small fixtures/details patterns
    if (descLower.match(/\b(puerta|door|ventana|window|fixture|detalle|impermeabilizaci[oó]n)\b/)) {
        return 'small';
    }

    // Default context
    return 'general';
}

/**
 * Find applicable bounds for a quantity
 */
function findBounds(qty: number, unit: string, description: string): QuantityBounds | null {
    const context = inferContext(description, unit);

    // Normalize unit
    const unitNormalized = unit.toLowerCase().trim();

    // Try to find bounds with matching context first
    let bounds = QUANTITY_BOUNDS.find(
        b => b.unit.toLowerCase() === unitNormalized && b.context === context
    );

    // Fallback to general context
    if (!bounds) {
        bounds = QUANTITY_BOUNDS.find(
            b => b.unit.toLowerCase() === unitNormalized && b.context === 'general'
        );
    }

    // Last fallback: any matching unit
    if (!bounds) {
        bounds = QUANTITY_BOUNDS.find(
            b => b.unit.toLowerCase() === unitNormalized
        );
    }

    return bounds || null;
}

/**
 * Validate a calculated quantity
 */
export function validateQuantity(
    qty: number,
    unit: string,
    description: string
): ValidationResult {
    // Handle null/undefined quantities
    if (qty === null || qty === undefined || isNaN(qty)) {
        return {
            valid: false,
            severity: 'error',
            message: 'Quantity is null or undefined',
            suggested_action: 'reject'
        };
    }

    // Handle negative quantities
    if (qty < 0) {
        return {
            valid: false,
            severity: 'error',
            message: `Negative quantity: ${qty}`,
            suggested_action: 'reject'
        };
    }

    // Find applicable bounds
    const bounds = findBounds(qty, unit, description);

    if (!bounds) {
        // No bounds defined for this unit - accept but log warning
        console.log(`[Validator] No bounds defined for unit "${unit}", skipping validation`);
        return {
            valid: true,
            severity: 'ok',
            suggested_action: 'accept'
        };
    }

    // Check for fractional counts on unit items
    if (!bounds.allow_fractional && qty % 1 !== 0) {
        return {
            valid: false,
            severity: 'error',
            message: `Fractional count ${qty.toFixed(2)} for unit item (expected integer)`,
            suggested_action: 'reject'
        };
    }

    // Check absolute maximum (hard limit)
    if (qty > bounds.absolute_max) {
        return {
            valid: false,
            severity: 'error',
            message: `Quantity ${qty.toFixed(2)} exceeds absolute maximum ${bounds.absolute_max} for ${unit} (${bounds.context || 'general'})`,
            suggested_action: 'reject'
        };
    }

    // Check typical range (soft limits)
    if (qty < bounds.typical_min || qty > bounds.typical_max) {
        const rangeStr = `${bounds.typical_min}-${bounds.typical_max}`;
        return {
            valid: true,  // Still valid, but suspicious
            severity: 'warning',
            message: `Quantity ${qty.toFixed(2)} outside typical range [${rangeStr}] for ${unit} (${bounds.context || 'general'})`,
            suggested_action: 'review'
        };
    }

    // All checks passed
    return {
        valid: true,
        severity: 'ok',
        suggested_action: 'accept'
    };
}

/**
 * Validate a batch of quantities
 */
export function validateBatch(
    items: Array<{ qty: number; unit: string; description: string }>
): Array<ValidationResult & { item_index: number }> {
    return items.map((item, index) => ({
        ...validateQuantity(item.qty, item.unit, item.description),
        item_index: index
    }));
}

/**
 * Get statistics for validation results
 */
export function getValidationStats(results: ValidationResult[]): {
    total: number;
    ok: number;
    warnings: number;
    errors: number;
    error_rate: number;
} {
    const total = results.length;
    const ok = results.filter(r => r.severity === 'ok').length;
    const warnings = results.filter(r => r.severity === 'warning').length;
    const errors = results.filter(r => r.severity === 'error').length;

    return {
        total,
        ok,
        warnings,
        errors,
        error_rate: total > 0 ? (errors / total) * 100 : 0
    };
}

/**
 * Add custom bounds at runtime
 */
export function addCustomBounds(bounds: QuantityBounds): void {
    QUANTITY_BOUNDS.push(bounds);
}

/**
 * Get all defined bounds (for debugging/documentation)
 */
export function getAllBounds(): QuantityBounds[] {
    return [...QUANTITY_BOUNDS];
}
