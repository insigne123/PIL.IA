/**
 * Excel Subtype Classifier
 * 
 * P1.5: Classifies Excel items into granular subtypes for better matching
 * Examples: m² → floor_area, ceiling_area, wall_area, etc.
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type AreaSubtype =
    | 'floor_area'        // Pisos, pavimentos, sobrelosas, radieres
    | 'ceiling_area'      // Cielos, cielos rasos, plafones
    | 'wall_area'         // Muros, tabiques, revestimientos
    | 'roof_area'         // Techos, cubiertas, impermeabilizaciones
    | 'opening_area'      // Ventanas, puertas, vanos
    | 'generic_area';     // No clasificable

export type LengthSubtype =
    | 'wall_length'       // Muros, tabiques, envigados
    | 'beam_length'       // Vigas, dinteles, cadenas
    | 'column_length'     // Pilares (aunque suelen ser blocks)
    | 'pipe_length'       // Cañerías, tuberías, ductos
    | 'cable_length'      // Cables, conductores, alimentadores
    | 'border_length'     // Bordes, perímetros, guardapolvos
    | 'generic_length';

export type BlockSubtype =
    | 'electrical'        // Tableros, enchufes, interruptores
    | 'plumbing'          // Artefactos sanitarios, llaves
    | 'hvac'             // Equipos HVAC, rejillas
    | 'furniture'        // Muebles, mobiliario
    | 'fixture'          // Luminarias, apliques
    | 'equipment'        // Equipos diversos
    | 'generic_block';

export type ItemSubtype = AreaSubtype | LengthSubtype | BlockSubtype;

export interface SubtypeClassification {
    subtype: ItemSubtype;
    confidence: number;
    method: 'keyword_exact' | 'keyword_partial' | 'keyword_fuzzy' | 'default';
    matched_keywords?: string[];
    alternative_subtypes?: Array<{
        subtype: ItemSubtype;
        confidence: number;
    }>;
}

// ============================================================================
// KEYWORD DICTIONARIES
// ============================================================================

const AREA_KEYWORDS: Record<AreaSubtype, string[]> = {
    floor_area: [
        // Pisos
        'piso', 'pavimento', 'sobrelosa', 'radier', 'contrapiso',
        'baldosa', 'ceramica piso', 'porcelanato', 'suelo',
        'losa', 'carpeta', 'firme', 'solera',
        // Materiales de piso
        'vinilico', 'flotante', 'parquet', 'alfombra',
        'palmeta', 'adoquin', 'empedrado'
    ],

    ceiling_area: [
        'cielo', 'cielorraso', 'plafon', 'techo falso',
        'cielo raso', 'entretecho', 'falso cielo',
        'yeso carton cielo', 'fibrocemento cielo'
    ],

    wall_area: [
        // Muros y tabiques
        'muro', 'tabique', 'pared', 'tabiqu',
        'envigado', 'panel', 'division',
        // Revestimientos
        'revestimiento', 'enchape', 'estuco', 'enlucido',
        'pintura muro', 'ceramica mural', 'porcelanato muro',
        'yeso', 'estuque', 'guarnecido',
        // Aislación
        'aislacion termica', 'lana mineral', 'poliestireno'
    ],

    roof_area: [
        'techo', 'cubierta', 'tejado', 'techumbre',
        'impermeabilizacion', 'membrana', 'asfaltica',
        'zinc', 'teja', 'plancha', 'sandwich'
    ],

    opening_area: [
        'ventana', 'puerta', 'vano', 'abertura',
        'cristal', 'vidrio', 'vidriera', 'cancel'
    ],

    generic_area: []
};

const LENGTH_KEYWORDS: Record<LengthSubtype, string[]> = {
    wall_length: [
        'muro', 'tabique', 'pared', 'envigado',
        'division', 'panel'
    ],

    beam_length: [
        'viga', 'dintel', 'cadena', 'solera',
        'correa', 'cercha'
    ],

    column_length: [
        'pilar', 'columna', 'poste', 'pie derecho'
    ],

    pipe_length: [
        'cañeria', 'tuberia', 'ducto', 'cañon',
        'caño', 'tubo', 'conducto', 'colector'
    ],

    cable_length: [
        'cable', 'conductor', 'alimentador',
        'circuito', 'tendido'
    ],

    border_length: [
        'guardapolvo', 'zocalo', 'cornisa', 'moldura',
        'borde', 'perimetro', 'canto'
    ],

    generic_length: []
};

const BLOCK_KEYWORDS: Record<BlockSubtype, string[]> = {
    electrical: [
        'tablero', 'enchufe', 'interruptor', 'tomacorriente',
        'caja', 'toma', 'switch', 'breaker',
        'centro de carga', 'panel electrico'
    ],

    plumbing: [
        'lavatorio', 'lavamanos', 'inodoro', 'wc',
        'ducha', 'tina', 'bidet', 'urinario',
        'llave', 'grifo', 'valvula', 'artefacto sanitario'
    ],

    hvac: [
        'rejilla', 'difusor', 'extractor', 'ventilador',
        'aire acondicionado', 'calefactor', 'radiador',
        'split', 'fan coil'
    ],

    furniture: [
        'mueble', 'mobiliario', 'estante', 'repisa',
        'closet', 'armario', 'cajonera'
    ],

    fixture: [
        'luminaria', 'lampara', 'aplique', 'foco',
        'spot', 'downlight', 'panel led'
    ],

    equipment: [
        'equipo', 'bomba', 'motor', 'generador',
        'transformador', 'ups', 'grupo electrogeno'
    ],

    generic_block: []
};

// ============================================================================
// CLASSIFICATION FUNCTIONS
// ============================================================================

/**
 * Normalize text for keyword matching
 */
function normalizeText(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove accents
        .trim();
}

/**
 * Check if text contains keyword (exact or partial match)
 */
function containsKeyword(text: string, keyword: string): {
    match: boolean;
    method: 'exact' | 'partial' | 'fuzzy';
} {
    const normalizedText = normalizeText(text);
    const normalizedKeyword = normalizeText(keyword);

    // Exact word match
    const words = normalizedText.split(/\s+/);
    if (words.includes(normalizedKeyword)) {
        return { match: true, method: 'exact' };
    }

    // Partial match (keyword is substring)
    if (normalizedText.includes(normalizedKeyword)) {
        return { match: true, method: 'partial' };
    }

    // Fuzzy match (keyword words in text)
    const keywordWords = normalizedKeyword.split(/\s+/);
    if (keywordWords.every(kw => normalizedText.includes(kw))) {
        return { match: true, method: 'fuzzy' };
    }

    return { match: false, method: 'exact' };
}

/**
 * Classify AREA items into subtypes
 */
function classifyAreaSubtype(description: string): SubtypeClassification {
    const matches: Array<{
        subtype: AreaSubtype;
        keywords: string[];
        method: 'exact' | 'partial' | 'fuzzy';
    }> = [];

    // Check all subtypes
    for (const [subtype, keywords] of Object.entries(AREA_KEYWORDS)) {
        if (subtype === 'generic_area') continue;

        const matchedKeywords: string[] = [];
        let bestMethod: 'exact' | 'partial' | 'fuzzy' = 'fuzzy';

        for (const keyword of keywords) {
            const result = containsKeyword(description, keyword);
            if (result.match) {
                matchedKeywords.push(keyword);
                if (result.method === 'exact') bestMethod = 'exact';
                else if (result.method === 'partial' && bestMethod !== 'exact') bestMethod = 'partial';
            }
        }

        if (matchedKeywords.length > 0) {
            matches.push({
                subtype: subtype as AreaSubtype,
                keywords: matchedKeywords,
                method: bestMethod
            });
        }
    }

    // Sort by quality: exact > partial > fuzzy, then by keyword count
    matches.sort((a, b) => {
        const methodScore = { exact: 3, partial: 2, fuzzy: 1 };
        const scoreDiff = methodScore[b.method] - methodScore[a.method];
        if (scoreDiff !== 0) return scoreDiff;
        return b.keywords.length - a.keywords.length;
    });

    if (matches.length === 0) {
        return {
            subtype: 'generic_area',
            confidence: 0.3,
            method: 'default'
        };
    }

    const best = matches[0];
    const confidence = best.method === 'exact' ? 0.95 :
        best.method === 'partial' ? 0.85 : 0.75;

    return {
        subtype: best.subtype,
        confidence,
        method: `keyword_${best.method}` as any,
        matched_keywords: best.keywords,
        alternative_subtypes: matches.slice(1, 3).map(m => ({
            subtype: m.subtype,
            confidence: confidence * 0.7
        }))
    };
}

/**
 * Classify LENGTH items into subtypes
 */
function classifyLengthSubtype(description: string): SubtypeClassification {
    const matches: Array<{
        subtype: LengthSubtype;
        keywords: string[];
        method: 'exact' | 'partial' | 'fuzzy';
    }> = [];

    for (const [subtype, keywords] of Object.entries(LENGTH_KEYWORDS)) {
        if (subtype === 'generic_length') continue;

        const matchedKeywords: string[] = [];
        let bestMethod: 'exact' | 'partial' | 'fuzzy' = 'fuzzy';

        for (const keyword of keywords) {
            const result = containsKeyword(description, keyword);
            if (result.match) {
                matchedKeywords.push(keyword);
                if (result.method === 'exact') bestMethod = 'exact';
                else if (result.method === 'partial' && bestMethod !== 'exact') bestMethod = 'partial';
            }
        }

        if (matchedKeywords.length > 0) {
            matches.push({
                subtype: subtype as LengthSubtype,
                keywords: matchedKeywords,
                method: bestMethod
            });
        }
    }

    matches.sort((a, b) => {
        const methodScore = { exact: 3, partial: 2, fuzzy: 1 };
        const scoreDiff = methodScore[b.method] - methodScore[a.method];
        if (scoreDiff !== 0) return scoreDiff;
        return b.keywords.length - a.keywords.length;
    });

    if (matches.length === 0) {
        return {
            subtype: 'generic_length',
            confidence: 0.3,
            method: 'default'
        };
    }

    const best = matches[0];
    const confidence = best.method === 'exact' ? 0.95 :
        best.method === 'partial' ? 0.85 : 0.75;

    return {
        subtype: best.subtype,
        confidence,
        method: `keyword_${best.method}` as any,
        matched_keywords: best.keywords,
        alternative_subtypes: matches.slice(1, 3).map(m => ({
            subtype: m.subtype,
            confidence: confidence * 0.7
        }))
    };
}

/**
 * Classify BLOCK items into subtypes
 */
function classifyBlockSubtype(description: string): SubtypeClassification {
    const matches: Array<{
        subtype: BlockSubtype;
        keywords: string[];
        method: 'exact' | 'partial' | 'fuzzy';
    }> = [];

    for (const [subtype, keywords] of Object.entries(BLOCK_KEYWORDS)) {
        if (subtype === 'generic_block') continue;

        const matchedKeywords: string[] = [];
        let bestMethod: 'exact' | 'partial' | 'fuzzy' = 'fuzzy';

        for (const keyword of keywords) {
            const result = containsKeyword(description, keyword);
            if (result.match) {
                matchedKeywords.push(keyword);
                if (result.method === 'exact') bestMethod = 'exact';
                else if (result.method === 'partial' && bestMethod !== 'exact') bestMethod = 'partial';
            }
        }

        if (matchedKeywords.length > 0) {
            matches.push({
                subtype: subtype as BlockSubtype,
                keywords: matchedKeywords,
                method: bestMethod
            });
        }
    }

    matches.sort((a, b) => {
        const methodScore = { exact: 3, partial: 2, fuzzy: 1 };
        const scoreDiff = methodScore[b.method] - methodScore[a.method];
        if (scoreDiff !== 0) return scoreDiff;
        return b.keywords.length - a.keywords.length;
    });

    if (matches.length === 0) {
        return {
            subtype: 'generic_block',
            confidence: 0.3,
            method: 'default'
        };
    }

    const best = matches[0];
    const confidence = best.method === 'exact' ? 0.95 :
        best.method === 'partial' ? 0.85 : 0.75;

    return {
        subtype: best.subtype,
        confidence,
        method: `keyword_${best.method}` as any,
        matched_keywords: best.keywords,
        alternative_subtypes: matches.slice(1, 3).map(m => ({
            subtype: m.subtype,
            confidence: confidence * 0.7
        }))
    };
}

// ============================================================================
// MAIN CLASSIFICATION FUNCTION
// ============================================================================

/**
 * Classify Excel item into granular subtype
 */
export function classifyExcelSubtype(
    description: string,
    measureType: 'AREA' | 'LENGTH' | 'BLOCK' | 'VOLUME' | 'GLOBAL' | 'UNKNOWN'
): SubtypeClassification {
    if (measureType === 'AREA') {
        return classifyAreaSubtype(description);
    } else if (measureType === 'LENGTH') {
        return classifyLengthSubtype(description);
    } else if (measureType === 'BLOCK') {
        return classifyBlockSubtype(description);
    }

    // VOLUME, GLOBAL, UNKNOWN default to generic
    return {
        subtype: 'generic_area',
        confidence: 0.3,
        method: 'default'
    };
}

/**
 * Get subtype category (for grouping)
 */
export function getSubtypeCategory(subtype: ItemSubtype): 'area' | 'length' | 'block' {
    if ((subtype as string).endsWith('_area')) return 'area';
    if ((subtype as string).endsWith('_length')) return 'length';
    if ((subtype as string).endsWith('_block')) return 'block';
    return 'area'; // fallback
}

/**
 * Get human-readable subtype label
 */
export function getSubtypeLabel(subtype: ItemSubtype): string {
    const labels: Record<ItemSubtype, string> = {
        // Area
        floor_area: 'Área de Piso',
        ceiling_area: 'Área de Cielo',
        wall_area: 'Área de Muro',
        roof_area: 'Área de Techo',
        opening_area: 'Área de Abertura',
        generic_area: 'Área Genérica',

        // Length
        wall_length: 'Longitud de Muro',
        beam_length: 'Longitud de Viga',
        column_length: 'Longitud de Columna',
        pipe_length: 'Longitud de Cañería',
        cable_length: 'Longitud de Cable',
        border_length: 'Longitud de Borde',
        generic_length: 'Longitud Genérica',

        // Block
        electrical: 'Eléctrico',
        plumbing: 'Sanitario',
        hvac: 'HVAC',
        furniture: 'Mobiliario',
        fixture: 'Luminaria',
        equipment: 'Equipo',
        generic_block: 'Bloque Genérico'
    };

    return labels[subtype] || subtype;
}
