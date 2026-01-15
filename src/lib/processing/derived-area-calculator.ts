/**
 * Derived Area Calculator
 * 
 * P0.B: Calculates area from length for vertical surfaces (walls, tabiques)
 * that don't have HATCH geometry but have length contours.
 * 
 * Formula: area_m2 = length_m * height_m
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface DerivedAreaConfig {
    // Keywords indicating vertical surfaces (multiply length * height)
    verticalKeywords: string[];
    // Keywords indicating horizontal surfaces (use closed polylines)
    horizontalKeywords: string[];
    // Default height for vertical surfaces (meters)
    defaultHeight: number;
    // Height extraction patterns
    heightPatterns: RegExp[];
}

const DEFAULT_CONFIG: DerivedAreaConfig = {
    verticalKeywords: [
        // Tabiques y muros
        'tabique', 'muro', 'sobretabique', 'pilar', 'columna',
        'pared', 'tabiqueria', 'division', 'divisorio',
        // Revestimientos verticales
        'empaste', 'estuco', 'enlucido', 'revoque', 'pintura tabique',
        'pintura muro', 'ceramico muro', 'azulejo', 'enchape',
        'revestimiento muro', 'papel mural',
        // Estructuras verticales
        'viga', 'pilastra', 'contrafuerte'
    ],
    horizontalKeywords: [
        // Cielos
        'cielo', 'cielo falso', 'cielo raso', 'plafon',
        'cupula', 'boveda', 'cenefa',
        // Pisos (normalmente tienen HATCH, pero por si acaso)
        'piso', 'pavimento', 'solera', 'radier',
        // Otros horizontales
        'losa', 'entrepiso', 'cubierta', 'techumbre'
    ],
    defaultHeight: 2.4, // metros
    heightPatterns: [
        /h\s*[=:]\s*([\d.,]+)\s*m?/i,           // h=2.5m, h: 2.5
        /altura\s*[=:]\s*([\d.,]+)\s*m?/i,      // altura=2.5
        /(\d+[.,]\d+)\s*m\s*(?:alto|altura)/i,  // 2.5m alto
        /alto\s*[=:]\s*([\d.,]+)\s*m?/i         // alto=2.5
    ]
};

// ============================================================================
// TYPES
// ============================================================================

export type SurfaceOrientation = 'vertical' | 'horizontal' | 'unknown';

export interface DerivedAreaResult {
    canDerive: boolean;
    orientation: SurfaceOrientation;
    area_m2: number;
    method: 'length_x_height' | 'closed_polyline' | 'none';
    height_m?: number;
    height_source: 'extracted' | 'default' | 'none';
    length_m?: number;
    matchedKeywords: string[];
    reason: string;
}

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Detect surface orientation from item description
 */
export function detectSurfaceOrientation(
    description: string,
    config: DerivedAreaConfig = DEFAULT_CONFIG
): { orientation: SurfaceOrientation; matchedKeywords: string[] } {
    const normalizedDesc = description.toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[_-]/g, ' ');

    // Check vertical keywords
    const verticalMatches = config.verticalKeywords.filter(kw =>
        normalizedDesc.includes(kw.toLowerCase())
    );

    // Check horizontal keywords
    const horizontalMatches = config.horizontalKeywords.filter(kw =>
        normalizedDesc.includes(kw.toLowerCase())
    );

    // Vertical takes precedence if both match (e.g., "pintura muro cielo")
    if (verticalMatches.length > 0) {
        return { orientation: 'vertical', matchedKeywords: verticalMatches };
    }

    if (horizontalMatches.length > 0) {
        return { orientation: 'horizontal', matchedKeywords: horizontalMatches };
    }

    return { orientation: 'unknown', matchedKeywords: [] };
}

/**
 * Extract height from item description
 */
export function extractHeight(
    description: string,
    config: DerivedAreaConfig = DEFAULT_CONFIG
): { height: number | null; source: 'extracted' | 'default' | 'none' } {
    const normalizedDesc = description.toLowerCase();

    for (const pattern of config.heightPatterns) {
        const match = normalizedDesc.match(pattern);
        if (match && match[1]) {
            const heightStr = match[1].replace(',', '.');
            const height = parseFloat(heightStr);
            if (!isNaN(height) && height > 0 && height < 20) { // Sanity check: 0-20m
                return { height, source: 'extracted' };
            }
        }
    }

    return { height: null, source: 'none' };
}

/**
 * Calculate derived area from length
 */
export function calculateDerivedArea(
    lengthSum_m: number,
    itemDescription: string,
    config: DerivedAreaConfig = DEFAULT_CONFIG
): DerivedAreaResult {

    // Step 1: Detect orientation
    const { orientation, matchedKeywords } = detectSurfaceOrientation(itemDescription, config);

    // Step 2: Handle based on orientation
    if (orientation === 'vertical') {
        // Extract or use default height
        const { height, source } = extractHeight(itemDescription, config);
        const finalHeight = height ?? config.defaultHeight;

        // Calculate area
        const area_m2 = lengthSum_m * finalHeight;

        return {
            canDerive: true,
            orientation: 'vertical',
            area_m2,
            method: 'length_x_height',
            height_m: finalHeight,
            height_source: source === 'extracted' ? 'extracted' : 'default',
            length_m: lengthSum_m,
            matchedKeywords,
            reason: `Derived ${area_m2.toFixed(2)} m² from ${lengthSum_m.toFixed(2)}m × ${finalHeight}m (${source === 'extracted' ? 'extracted' : 'default'} height)`
        };
    }

    if (orientation === 'horizontal') {
        // For horizontal surfaces, we need closed polylines (hatches should exist)
        // This is a fallback - ideally horizontal surfaces have HATCH
        return {
            canDerive: false,
            orientation: 'horizontal',
            area_m2: 0,
            method: 'none',
            height_source: 'none',
            matchedKeywords,
            reason: 'Horizontal surface detected but no HATCH found. Requires closed polyline calculation.'
        };
    }

    // Unknown orientation - can't derive
    return {
        canDerive: false,
        orientation: 'unknown',
        area_m2: 0,
        method: 'none',
        height_source: 'none',
        matchedKeywords: [],
        reason: 'Could not determine surface orientation from description'
    };
}

// ============================================================================
// TAB PATTERN HANDLING
// ============================================================================

/**
 * Check if item is a TAB item (TAB 01, TAB 02, etc.)
 */
export function isTabItem(description: string): boolean {
    return /TAB\s*\d+/i.test(description);
}

/**
 * Extract TAB identifier from description
 */
export function extractTabId(description: string): string | null {
    const match = description.match(/TAB\s*(\d+)/i);
    return match ? `TAB${match[1].padStart(2, '0')}` : null;
}

/**
 * Calculate area for TAB items using nearby text anchors
 * This requires text items to be passed in
 */
export function calculateTabArea(
    tabId: string,
    lengthItems: Array<{ length_m: number; nearestText?: string; distance?: number }>,
    defaultHeight: number = 2.4
): DerivedAreaResult {
    // Filter length items associated with this TAB
    const tabLengths = lengthItems.filter(item =>
        item.nearestText?.toUpperCase().includes(tabId.toUpperCase())
    );

    if (tabLengths.length === 0) {
        return {
            canDerive: false,
            orientation: 'vertical',
            area_m2: 0,
            method: 'none',
            height_source: 'none',
            matchedKeywords: [tabId],
            reason: `No length geometry found near text "${tabId}"`
        };
    }

    const totalLength = tabLengths.reduce((sum, item) => sum + item.length_m, 0);
    const area_m2 = totalLength * defaultHeight;

    return {
        canDerive: true,
        orientation: 'vertical',
        area_m2,
        method: 'length_x_height',
        height_m: defaultHeight,
        height_source: 'default',
        length_m: totalLength,
        matchedKeywords: [tabId],
        reason: `TAB derived: ${area_m2.toFixed(2)} m² from ${tabLengths.length} segments (${totalLength.toFixed(2)}m × ${defaultHeight}m)`
    };
}

// ============================================================================
// UTILITY
// ============================================================================

/**
 * Check if derived area can be used as fallback for a layer profile
 */
export function canUseDerivedAreaFallback(
    totalLength_m: number,
    itemDescription: string
): boolean {
    if (totalLength_m <= 0) return false;

    const { orientation } = detectSurfaceOrientation(itemDescription);
    return orientation === 'vertical';
}

/**
 * Get configuration (for testing/override)
 */
export function getDefaultConfig(): DerivedAreaConfig {
    return { ...DEFAULT_CONFIG };
}
