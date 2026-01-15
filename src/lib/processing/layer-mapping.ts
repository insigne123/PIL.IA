/**
 * Layer Keyword Mapping System
 * 
 * Provides configurable mapping between DXF layer names and descriptive keywords
 * to improve fuzzy matching between Excel descriptions and DXF layers.
 * 
 * Example:
 *   Layer "FA-PAVIMENTO" maps to keywords ["pavimento", "piso", "sobrelosa"]
 *   Excel: "sobrelosa de 8cm" → matches via keyword "sobrelosa"
 */

import layerMappingConfig from './layer-mapping.json';

export interface LayerMapping {
    keywords: string[];
    description?: string;
}

export interface LayerMappingConfig {
    version: string;
    mappings: Record<string, LayerMapping>;
    wildcards?: Record<string, string[]>;
}

// Load mapping from JSON
const config: LayerMappingConfig = layerMappingConfig as LayerMappingConfig;

/**
 * Get keywords for a specific layer
 */
export function getLayerKeywords(layer: string): string[] {
    const layerUpper = layer.toUpperCase();
    const layerNormalized = layer.toLowerCase();

    // Direct mapping
    if (config.mappings[layer]) {
        return config.mappings[layer].keywords;
    }

    // Case-insensitive search
    for (const [mappedLayer, mapping] of Object.entries(config.mappings)) {
        if (mappedLayer.toLowerCase() === layerNormalized) {
            return mapping.keywords;
        }
    }

    // Wildcard matching (prefix-based)
    if (config.wildcards) {
        for (const [prefix, keywords] of Object.entries(config.wildcards)) {
            if (layerUpper.startsWith(prefix)) {
                return keywords;
            }
        }
    }

    return [];
}

/**
 * Check if a description matches layer keywords
 * Returns match score (0-1) and which keywords matched
 */
export function matchLayerKeywords(
    description: string,
    layer: string
): {
    score: number;
    matchedKeywords: string[];
    method: 'direct' | 'partial' | 'none';
} {
    const keywords = getLayerKeywords(layer);
    if (keywords.length === 0) {
        return { score: 0, matchedKeywords: [], method: 'none' };
    }

    const descLower = description.toLowerCase();
    const matchedKeywords: string[] = [];

    // Check each keyword
    for (const keyword of keywords) {
        const keywordLower = keyword.toLowerCase();

        // Exact word match (highest score)
        const wordBoundaryRegex = new RegExp(`\\b${keywordLower}\\b`, 'i');
        if (wordBoundaryRegex.test(descLower)) {
            matchedKeywords.push(keyword);
        }
        // Partial match (contains)
        else if (descLower.includes(keywordLower)) {
            matchedKeywords.push(keyword);
        }
    }

    if (matchedKeywords.length === 0) {
        return { score: 0, matchedKeywords: [], method: 'none' };
    }

    // Calculate score based on number of matches and match quality
    const matchRatio = matchedKeywords.length / keywords.length;
    const hasExactMatch = matchedKeywords.some(kw =>
        new RegExp(`\\b${kw.toLowerCase()}\\b`, 'i').test(descLower)
    );

    let score = 0.5 + (matchRatio * 0.3); // Base 50-80% for keyword match
    if (hasExactMatch) {
        score += 0.2; // Bonus for exact word match
    }

    return {
        score: Math.min(score, 1.0),
        matchedKeywords,
        method: hasExactMatch ? 'direct' : 'partial'
    };
}

/**
 * Get all layers that have keyword mappings
 */
export function getMappedLayers(): string[] {
    return Object.keys(config.mappings);
}

/**
 * Check if a layer has keyword mappings
 */
export function hasMapping(layer: string): boolean {
    return getLayerKeywords(layer).length > 0;
}

/**
 * Get description for a layer (for documentation/UI)
 */
export function getLayerDescription(layer: string): string | undefined {
    return config.mappings[layer]?.description;
}

/**
 * Add or update layer mapping at runtime (for dynamic configuration)
 */
export function updateLayerMapping(layer: string, keywords: string[], description?: string): void {
    config.mappings[layer] = { keywords, description };
}

/**
 * Export current configuration (for saving/debugging)
 */
export function exportConfig(): LayerMappingConfig {
    return JSON.parse(JSON.stringify(config)); // Deep clone
}

/**
 * Get mapping statistics for logging/debugging
 */
export function getMappingStats(): {
    totalLayers: number;
    totalKeywords: number;
    wildcards: number;
} {
    const totalKeywords = Object.values(config.mappings)
        .reduce((sum, mapping) => sum + mapping.keywords.length, 0);

    return {
        totalLayers: Object.keys(config.mappings).length,
        totalKeywords,
        wildcards: Object.keys(config.wildcards || {}).length
    };
}
