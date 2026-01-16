/**
 * Layer Blacklist
 * 
 * P1.1: Filters out annotation layers (dimensions, text layers, etc.)
 * Prevents areas being detected in non-geometric layers like DIMEN, DEFPOINTS, MV_TEXTOS
 */

const ANNOTATION_LAYER_PATTERNS = [
    /^dimen/i,
    /^defpoints$/i,
    /^text/i,
    /^cotas?/i,
    /^anno/i,
    /^dim/i,
    /^mv[_-]?text/i,
    /^ejes?/i,
    /^marco/i,
    /^viewport/i,
    /^xref/i,
    /^title/i,
    /^border/i
];

const BLACKLIST_ENTITY_TYPES = [
    'DIMENSION',
    'LEADER',
    'MULTILEADER',
    'ATTDEF',
    'ATTRIB'
];

/**
 * FIX D.2: Non-measurable layers
 * These layers should be penalized in matching - they typically contain
 * imported/annotation geometry that shouldn't compete with real CAD layers
 * P1.8: Extended with more patterns
 */
export const NON_MEASURABLE_LAYER_PATTERNS = [
    'dimen', 'dimension', 'dim',
    'texto', 'text', 'txt', 'texto_m', 'a-txt',
    'pdf_geometry', 'pdf-',
    'g-dim', 'g-text', 'g-anno',
    'annotation', 'anno',
    'defpoints',
    'viewport', 'vport',
    'import', 'dwf', 'xref',
    'acad_', 'acadiso',
    'mv_textos', 'mv-textos'
];

/**
 * Check if a layer is non-measurable (import/annotation/system)
 * Used by matcher to penalize these layers
 */
export function isNonMeasurableLayer(layerName: string): boolean {
    if (!layerName) return false;
    const lower = layerName.toLowerCase();
    return NON_MEASURABLE_LAYER_PATTERNS.some(pattern => lower.includes(pattern));
}

/**
 * P1.8: Check if layer is "0" (default layer - often contains mixed content)
 * Should be penalized for m² items unless user confirms
 */
export function isDefaultLayer(layerName: string): boolean {
    return layerName === '0' || layerName.toLowerCase() === 'layer0' || layerName === '';
}

/**
 * Get penalty for non-measurable layers (0-1)
 * 0 = measurable (no penalty), up to 0.7 = high penalty
 * P1.8: Also penalizes layer "0" for area items
 */
export function getNonMeasurablePenalty(layerName: string, measureType?: 'AREA' | 'LENGTH' | 'BLOCK'): number {
    // Non-measurable layers get 50% penalty
    if (isNonMeasurableLayer(layerName)) {
        return 0.5;
    }

    // P1.8: Layer "0" gets 40% penalty for AREA items (often contains mixed/import data)
    if (isDefaultLayer(layerName) && measureType === 'AREA') {
        return 0.4;
    }

    return 0;
}

/**
 * Check if a layer should be excluded (annotation layer)
 */
export function shouldExcludeLayer(layerName: string): boolean {
    return ANNOTATION_LAYER_PATTERNS.some(pattern => pattern.test(layerName));
}

/**
 * Check if an entity type should be excluded
 */
export function shouldExcludeEntity(entityType: string): boolean {
    return BLACKLIST_ENTITY_TYPES.includes(entityType.toUpperCase());
}

/**
 * Filter entities to keep only geometric ones
 * Excludes annotation layers and entity types
 */
export function filterGeometryOnly(
    entities: any[],
    customBlacklist: string[] = []
): { filtered: any[]; excluded: number; excludedByLayer: Map<string, number> } {
    const excludedByLayer = new Map<string, number>();
    let excluded = 0;

    const filtered = entities.filter(entity => {
        // 1. Exclude by entity type (dimensions, leaders)
        if (shouldExcludeEntity(entity.type)) {
            excluded++;
            return false;
        }

        // 2. Exclude by layer pattern
        const layer = entity.layer || '0';
        if (shouldExcludeLayer(layer)) {
            console.log(`[Layer Blacklist] Excluding entity on "${layer}" (annotation layer)`);
            excludedByLayer.set(layer, (excludedByLayer.get(layer) || 0) + 1);
            excluded++;
            return false;
        }

        // 3. Custom blacklist
        if (customBlacklist.includes(layer.toLowerCase())) {
            excluded++;
            return false;
        }

        return true;
    });

    return { filtered, excluded, excludedByLayer };
}

/**
 * Get blacklist summary for logging
 */
export function getBlacklistSummary(stats: {
    excluded: number;
    excludedByLayer: Map<string, number>;
}): string {
    if (stats.excluded === 0) {
        return 'No annotation entities excluded';
    }

    const layerSummary = Array.from(stats.excludedByLayer.entries())
        .map(([layer, count]) => `${layer} (${count})`)
        .join(', ');

    return `Excluded ${stats.excluded} annotation entities from layers: ${layerSummary}`;
}
