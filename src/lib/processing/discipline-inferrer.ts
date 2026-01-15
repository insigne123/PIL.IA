/**
 * Discipline Inferrer
 * 
 * P1.C: Infers construction discipline from context
 * (sheet name, item description, layer patterns)
 */

// ============================================================================
// TYPES
// ============================================================================

export type Discipline =
    | 'ARQUITECTURA'
    | 'ESTRUCTURAS'
    | 'ELECTRICO'
    | 'SANITARIO'
    | 'CLIMA'
    | 'INCENDIO'
    | 'GAS'
    | 'PAISAJISMO'
    | 'UNKNOWN';

export interface DisciplineInference {
    discipline: Discipline;
    confidence: 'high' | 'medium' | 'low';
    source: 'sheet_name' | 'item_keywords' | 'layer_patterns' | 'fallback';
    matchedPattern: string;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const SHEET_PATTERNS: Record<Discipline, RegExp[]> = {
    ARQUITECTURA: [
        /oocc/i, /arq/i, /arquitectura/i, /obra.*gruesa/i,
        /terminaciones/i, /revestimientos/i
    ],
    ESTRUCTURAS: [
        /estr/i, /estructura/i, /hormigon/i, /acero/i, /fundacion/i
    ],
    ELECTRICO: [
        /elec/i, /electrico/i, /iluminacion/i, /corrientes/i,
        /ee\.?cc/i, /eecc/i
    ],
    SANITARIO: [
        /sanit/i, /sanitario/i, /agua/i, /alcantarillado/i,
        /ss\.?cc/i, /sscc/i
    ],
    CLIMA: [
        /clima/i, /hvac/i, /aire.*acondicionado/i, /ventilacion/i,
        /calefaccion/i
    ],
    INCENDIO: [
        /incendio/i, /fire/i, /rociador/i, /extintor/i,
        /deteccion/i, /alarma.*incendio/i
    ],
    GAS: [
        /gas/i, /combustible/i
    ],
    PAISAJISMO: [
        /paisaj/i, /jardin/i, /exterior/i, /landscape/i
    ],
    UNKNOWN: []
};

const ITEM_KEYWORDS: Record<Discipline, string[]> = {
    ARQUITECTURA: [
        'tabique', 'muro', 'cielo', 'piso', 'puerta', 'ventana',
        'ceramico', 'pintura', 'enchape', 'revestimiento', 'sobrelosa',
        'radier', 'estuco', 'yeso', 'papel mural', 'alfombra',
        'porcelanato', 'palmeta', 'baranda', 'pasamano'
    ],
    ESTRUCTURAS: [
        'hormigon', 'pilar', 'columna', 'viga', 'losa', 'fundacion',
        'moldaje', 'enfierradura', 'acero', 'estructura metalica',
        'cadena', 'sobrecimiento', 'zapata', 'dado'
    ],
    ELECTRICO: [
        'tablero', 'circuito', 'canalizacion', 'conductor', 'cable',
        'interruptor', 'tomacorriente', 'enchufe', 'luminaria', 'ampolleta',
        'bandeja', 'empalme', 'transformador', 'ups'
    ],
    SANITARIO: [
        'wc', 'inodoro', 'lavamanos', 'lavaplatos', 'ducha', 'tina',
        'urinario', 'lavadero', 'grifo', 'llave paso', 'valvula',
        'tuberia', 'pvc', 'cobre', 'desague', 'ventilacion sanitaria',
        'camara inspeccion', 'alcantarillado'
    ],
    CLIMA: [
        'aire acondicionado', 'split', 'fancoil', 'chiller', 'bomba calor',
        'difusor', 'rejilla', 'ducto', 'damper', 'unidad manejadora',
        'termostato', 'radiador', 'calefactor'
    ],
    INCENDIO: [
        'rociador', 'sprinkler', 'extintor', 'gabinete incendio',
        'detector', 'central incendio', 'manguera', 'red humeda',
        'red seca', 'bomba incendio'
    ],
    GAS: [
        'medidor gas', 'regulador gas', 'valvula gas', 'tuberia gas',
        'flexible gas', 'calefont'
    ],
    PAISAJISMO: [
        'pasto', 'arbol', 'arbusto', 'planta', 'jardinera',
        'riego', 'aspersion', 'goteo', 'palmeta exterior'
    ],
    UNKNOWN: []
};

const LAYER_PREFIXES: Record<Discipline, string[]> = {
    ARQUITECTURA: ['a-', 'arq-', 'arq_', 'fa-', 'fa_'],
    ESTRUCTURAS: ['s-', 'st-', 'est-', 'str-', 'e-est'],
    ELECTRICO: ['e-', 'el-', 'elec-', 'ee-'],
    SANITARIO: ['p-', 's-san', 'san-', 'ss-'],
    CLIMA: ['m-', 'hvac-', 'clima-', 'mec-'],
    INCENDIO: ['f-', 'fire-', 'inc-'],
    GAS: ['g-', 'gas-'],
    PAISAJISMO: ['l-', 'land-', 'pais-'],
    UNKNOWN: []
};

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Infer discipline from sheet name
 */
export function inferFromSheetName(sheetName: string): DisciplineInference | null {
    const normalized = sheetName.toLowerCase().trim();

    for (const [discipline, patterns] of Object.entries(SHEET_PATTERNS)) {
        if (discipline === 'UNKNOWN') continue;

        for (const pattern of patterns) {
            if (pattern.test(normalized)) {
                return {
                    discipline: discipline as Discipline,
                    confidence: 'high',
                    source: 'sheet_name',
                    matchedPattern: pattern.source
                };
            }
        }
    }

    return null;
}

/**
 * Infer discipline from item description keywords
 */
export function inferFromItemDescription(description: string): DisciplineInference | null {
    const normalized = description.toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    let bestMatch: { discipline: Discipline; score: number; keyword: string } | null = null;

    for (const [discipline, keywords] of Object.entries(ITEM_KEYWORDS)) {
        if (discipline === 'UNKNOWN') continue;

        for (const keyword of keywords) {
            if (normalized.includes(keyword)) {
                const score = keyword.length; // Longer keywords = more specific
                if (!bestMatch || score > bestMatch.score) {
                    bestMatch = {
                        discipline: discipline as Discipline,
                        score,
                        keyword
                    };
                }
            }
        }
    }

    if (bestMatch) {
        return {
            discipline: bestMatch.discipline,
            confidence: bestMatch.score > 8 ? 'high' : 'medium',
            source: 'item_keywords',
            matchedPattern: bestMatch.keyword
        };
    }

    return null;
}

/**
 * Infer discipline from dominant layers
 */
export function inferFromLayers(layers: string[]): DisciplineInference | null {
    const counts: Record<Discipline, number> = {
        ARQUITECTURA: 0, ESTRUCTURAS: 0, ELECTRICO: 0, SANITARIO: 0,
        CLIMA: 0, INCENDIO: 0, GAS: 0, PAISAJISMO: 0, UNKNOWN: 0
    };

    for (const layer of layers) {
        const normalizedLayer = layer.toLowerCase();

        for (const [discipline, prefixes] of Object.entries(LAYER_PREFIXES)) {
            if (discipline === 'UNKNOWN') continue;

            for (const prefix of prefixes) {
                if (normalizedLayer.startsWith(prefix)) {
                    counts[discipline as Discipline]++;
                    break;
                }
            }
        }
    }

    // Find dominant discipline
    let maxCount = 0;
    let dominant: Discipline = 'UNKNOWN';

    for (const [discipline, count] of Object.entries(counts)) {
        if (count > maxCount && discipline !== 'UNKNOWN') {
            maxCount = count;
            dominant = discipline as Discipline;
        }
    }

    if (maxCount > 0) {
        const totalLayers = layers.length;
        const ratio = maxCount / totalLayers;

        return {
            discipline: dominant,
            confidence: ratio > 0.5 ? 'high' : ratio > 0.2 ? 'medium' : 'low',
            source: 'layer_patterns',
            matchedPattern: `${maxCount}/${totalLayers} layers`
        };
    }

    return null;
}

/**
 * Infer discipline using all available context
 */
export function inferDiscipline(context: {
    sheetName?: string;
    itemDescription?: string;
    layers?: string[];
}): DisciplineInference {
    // Priority 1: Sheet name (most reliable)
    if (context.sheetName) {
        const sheetResult = inferFromSheetName(context.sheetName);
        if (sheetResult) return sheetResult;
    }

    // Priority 2: Item description keywords
    if (context.itemDescription) {
        const itemResult = inferFromItemDescription(context.itemDescription);
        if (itemResult && itemResult.confidence !== 'low') return itemResult;
    }

    // Priority 3: Layer patterns
    if (context.layers && context.layers.length > 0) {
        const layerResult = inferFromLayers(context.layers);
        if (layerResult) return layerResult;
    }

    // Fallback to item result even if low confidence
    if (context.itemDescription) {
        const itemResult = inferFromItemDescription(context.itemDescription);
        if (itemResult) return itemResult;
    }

    return {
        discipline: 'UNKNOWN',
        confidence: 'low',
        source: 'fallback',
        matchedPattern: 'none'
    };
}

/**
 * Check if two disciplines are compatible for matching
 */
export function areDisciplinesCompatible(
    excelDiscipline: Discipline,
    layerDiscipline: Discipline
): boolean {
    // Unknown is always compatible
    if (excelDiscipline === 'UNKNOWN' || layerDiscipline === 'UNKNOWN') {
        return true;
    }

    // Same discipline
    if (excelDiscipline === layerDiscipline) {
        return true;
    }

    // ARQUITECTURA is compatible with most things
    if (excelDiscipline === 'ARQUITECTURA') {
        return true;
    }

    // Some known compatible pairs
    const compatiblePairs: [Discipline, Discipline][] = [
        ['SANITARIO', 'ARQUITECTURA'],
        ['ELECTRICO', 'ARQUITECTURA'],
        ['CLIMA', 'ARQUITECTURA'],
    ];

    return compatiblePairs.some(([a, b]) =>
        (excelDiscipline === a && layerDiscipline === b) ||
        (excelDiscipline === b && layerDiscipline === a)
    );
}
