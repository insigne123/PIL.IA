/**
 * Block Classifier
 * 
 * P0.D: Classifies blocks as generic/trusted to prevent auto-matching
 * with unreliable blocks like "BLOCK" or Layer 0.
 */

// ============================================================================
// TYPES
// ============================================================================

export type BlockConfidence = 'none' | 'low' | 'medium' | 'high';

export interface BlockClassification {
    isGeneric: boolean;
    isTrusted: boolean;
    confidence: BlockConfidence;
    reason: string;
    penaltyScore: number; // 0-1, higher = more penalty
}

// ============================================================================
// CONFIGURATION
// ============================================================================

// Block names that are considered generic/unreliable
const GENERIC_BLOCK_PATTERNS = [
    /^BLOCK$/i,
    /^\*U\d+$/,           // AutoCAD unnamed blocks (*U123)
    /^\*D\d+$/,           // AutoCAD unnamed dimensions
    /^\*T\d+$/,           // AutoCAD table blocks
    /^\*X\d+$/,           // AutoCAD external reference
    /^$/,                 // Empty name
    /^_$/,                // Single underscore
    /^unnamed/i,
    /^sin nombre/i,
    /^no name/i
];

// Layers that are considered untrusted for blocks
const UNTRUSTED_LAYERS = [
    '0',
    'defpoints',
    'layer0',
    'capa0',
    'temp',
    'tmp',
    'trash',
    'borrar',
    'delete'
];

// Block name patterns that indicate high trust
const TRUSTED_BLOCK_PATTERNS = [
    // Equipment/fixtures
    /^(eq|equipo|fixture|artefacto)/i,
    // Furniture
    /^(mueble|furniture|mob)/i,
    // Electrical
    /^(enc|interruptor|tomacorriente|luminaria|tablero)/i,
    // Plumbing
    /^(wc|lavamanos|lavaplatos|ducha|tina|inodoro)/i,
    // HVAC
    /^(ac|aire|difusor|rejilla|duct)/i,
    // Structural
    /^(pilar|columna|viga|fundacion)/i,
    // Doors/windows
    /^(puerta|ventana|door|window|p\d+|v\d+)/i,
    // Symbols with identifiers
    /^[A-Z]{2,4}[-_]\d+/  // e.g., "EQ-01", "LUM_123"
];

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Classify a block as generic or trusted
 */
export function classifyBlock(
    blockName: string,
    layer: string
): BlockClassification {
    const normalizedBlockName = (blockName || '').trim();
    const normalizedLayer = (layer || '').toLowerCase().trim();

    // Check if generic block name
    const isGenericName = GENERIC_BLOCK_PATTERNS.some(pattern =>
        pattern.test(normalizedBlockName)
    );

    // Check if untrusted layer
    const isUntrustedLayer = UNTRUSTED_LAYERS.includes(normalizedLayer);

    // Check if explicitly trusted
    const isTrustedName = TRUSTED_BLOCK_PATTERNS.some(pattern =>
        pattern.test(normalizedBlockName)
    );

    // Classification logic
    if (isGenericName) {
        return {
            isGeneric: true,
            isTrusted: false,
            confidence: 'none',
            reason: `Generic block name pattern: "${blockName}"`,
            penaltyScore: 1.0
        };
    }

    if (isUntrustedLayer && !isTrustedName) {
        return {
            isGeneric: true,
            isTrusted: false,
            confidence: 'low',
            reason: `Block on untrusted layer: "${layer}"`,
            penaltyScore: 0.8
        };
    }

    if (isTrustedName) {
        return {
            isGeneric: false,
            isTrusted: true,
            confidence: 'high',
            reason: `Trusted block pattern: "${blockName}"`,
            penaltyScore: 0
        };
    }

    // Default: medium trust if has a real name on a real layer
    if (normalizedBlockName.length > 2 && !isUntrustedLayer) {
        return {
            isGeneric: false,
            isTrusted: true,
            confidence: 'medium',
            reason: `Named block on specific layer`,
            penaltyScore: 0.1
        };
    }

    // Fallback: low trust
    return {
        isGeneric: false,
        isTrusted: false,
        confidence: 'low',
        reason: 'Block with short name or ambiguous layer',
        penaltyScore: 0.5
    };
}

/**
 * Check if a block should be auto-approved
 */
export function canAutoApproveBlock(classification: BlockClassification): boolean {
    return classification.isTrusted && classification.confidence !== 'none' && classification.confidence !== 'low';
}

/**
 * Get penalty multiplier for matching score
 */
export function getBlockPenalty(blockName: string, layer: string): number {
    const classification = classifyBlock(blockName, layer);
    return 1 - classification.penaltyScore; // Convert penalty to multiplier (0-1)
}

/**
 * Batch classify blocks and return summary
 */
export function classifyBlocks(
    blocks: Array<{ name: string; layer: string; count: number }>
): {
    trusted: typeof blocks;
    generic: typeof blocks;
    summary: string;
} {
    const trusted: typeof blocks = [];
    const generic: typeof blocks = [];

    for (const block of blocks) {
        const classification = classifyBlock(block.name, block.layer);
        if (classification.isGeneric) {
            generic.push(block);
        } else {
            trusted.push(block);
        }
    }

    const totalCount = blocks.reduce((sum, b) => sum + b.count, 0);
    const genericCount = generic.reduce((sum, b) => sum + b.count, 0);

    return {
        trusted,
        generic,
        summary: `Blocks: ${trusted.length} trusted types, ${generic.length} generic types (${genericCount}/${totalCount} instances generic)`
    };
}

// ============================================================================
// UTILITY
// ============================================================================

/**
 * Check if a block name matches any generic pattern
 */
export function isGenericBlockName(blockName: string): boolean {
    return GENERIC_BLOCK_PATTERNS.some(pattern => pattern.test(blockName));
}

/**
 * Check if a layer is untrusted
 */
export function isUntrustedLayer(layer: string): boolean {
    return UNTRUSTED_LAYERS.includes(layer.toLowerCase().trim());
}
