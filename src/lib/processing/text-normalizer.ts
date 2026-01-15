/**
 * Text Normalizer
 * 
 * P1.B: Robust normalization for text, layer names, block names
 * Handles encoding issues, accents, special characters
 */

/**
 * Normalize text for matching and comparison
 * Removes accents, fixes encoding, normalizes whitespace
 */
export function normalizeText(text: string): string {
    if (!text) return '';

    return text
        .toLowerCase()
        .trim()
        // Normalize unicode
        .normalize('NFD')
        // Remove diacritics/accents
        .replace(/[\u0300-\u036f]/g, '')
        // Fix broken encoding characters
        .replace(/�/g, '')
        .replace(/\ufffd/g, '')
        // Replace underscores and hyphens with spaces
        .replace(/[_-]/g, ' ')
        // Remove other special characters except alphanumeric and spaces
        .replace(/[^a-z0-9\s]/g, ' ')
        // Normalize multiple spaces to single
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Normalize layer name specifically
 * Preserves some structure like prefixes (A-, E-, S-)
 */
export function normalizeLayerName(layer: string): string {
    if (!layer) return '';

    return layer
        .trim()
        // Normalize unicode
        .normalize('NFD')
        // Remove diacritics
        .replace(/[\u0300-\u036f]/g, '')
        // Fix broken encoding
        .replace(/�/g, '')
        .replace(/\ufffd/g, '')
        // Normalize separators but keep hyphens for prefixes
        .replace(/_/g, '-')
        // Remove multiple hyphens
        .replace(/-+/g, '-')
        // Normalize spaces
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/**
 * Normalize block name
 * Similar to layer but also handles AutoCAD special patterns
 */
export function normalizeBlockName(blockName: string): string {
    if (!blockName) return '';

    return blockName
        .trim()
        // Normalize unicode
        .normalize('NFD')
        // Remove diacritics
        .replace(/[\u0300-\u036f]/g, '')
        // Fix broken encoding
        .replace(/�/g, '')
        .replace(/\ufffd/g, '')
        // Keep original case for block names (they're often case-sensitive)
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Normalize Excel description for matching
 */
export function normalizeExcelDescription(description: string): string {
    if (!description) return '';

    return description
        .toLowerCase()
        .trim()
        // Normalize unicode
        .normalize('NFD')
        // Remove diacritics
        .replace(/[\u0300-\u036f]/g, '')
        // Fix broken encoding
        .replace(/�/g, '')
        .replace(/\ufffd/g, '')
        // Normalize separators
        .replace(/[_-]/g, ' ')
        // Remove special chars but keep numbers
        .replace(/[^a-z0-9\s.,]/g, ' ')
        // Normalize spaces
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Check if text has encoding issues
 */
export function hasEncodingIssues(text: string): boolean {
    if (!text) return false;

    // Check for replacement character
    if (text.includes('\ufffd') || text.includes('�')) {
        return true;
    }

    // Check for suspicious byte sequences
    const suspiciousPatterns = [
        /[\x80-\x9f]/,  // Windows-1252 control chars
        /[\xc0-\xff][\x80-\xbf]{0,1}(?![\x80-\xbf])/, // Broken UTF-8
    ];

    return suspiciousPatterns.some(p => p.test(text));
}

/**
 * Attempt to fix common encoding issues
 */
export function fixEncoding(text: string): string {
    if (!text) return '';

    // Remove broken encoding characters
    let fixed = text
        .replace(/\ufffd/g, '')
        .replace(/[\x80-\x9f]/g, '');

    return fixed;
}

/**
 * Extract keywords from text for fuzzy matching
 */
export function extractKeywords(text: string): string[] {
    const normalized = normalizeText(text);

    // Split by spaces and filter short words
    const words = normalized.split(' ').filter(w => w.length > 2);

    // Remove common stopwords
    const stopwords = new Set([
        'del', 'de', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas',
        'en', 'con', 'por', 'para', 'sin', 'sobre', 'entre', 'hacia',
        'segun', 'desde', 'hasta', 'como', 'que', 'cual', 'donde',
        'the', 'and', 'for', 'with', 'from', 'into', 'over', 'under'
    ]);

    return words.filter(w => !stopwords.has(w));
}

/**
 * Calculate similarity between two normalized strings
 */
export function calculateSimilarity(a: string, b: string): number {
    const aNorm = normalizeText(a);
    const bNorm = normalizeText(b);

    if (aNorm === bNorm) return 1;
    if (!aNorm || !bNorm) return 0;

    // Simple Jaccard similarity on words
    const aWords = new Set(aNorm.split(' '));
    const bWords = new Set(bNorm.split(' '));

    const intersection = new Set([...aWords].filter(w => bWords.has(w)));
    const union = new Set([...aWords, ...bWords]);

    return intersection.size / union.size;
}
