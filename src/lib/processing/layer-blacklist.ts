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
 */
export const NON_MEASURABLE_LAYER_PATTERNS = [
    'dimen', 'dimension', 'dim',
    'texto', 'text', 'txt',
    'pdf_geometry', 'pdf-',
    'g-dim', 'g-text', 'g-anno',
    'annotation', 'anno',
    'defpoints',
    'viewport', 'vport',
    'import', 'dwf',
    'acad_', 'acadiso'
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
 * Get penalty for non-measurable layers (0-1)
 * 0 = measurable (no penalty), 1 = non-measurable (high penalty)
 */
export function getNonMeasurablePenalty(layerName: string): number {
    if (isNonMeasurableLayer(layerName)) {
        return 0.5; // 50% confidence reduction
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
