/**
 * CSV Matcher
 * 
 * Simplified matcher for CSV Takeoff flow.
 * Performs semantic matching between Excel items and layers from the CSV takeoff index.
 * Takes quantities directly from the CSV instead of calculating from DXF geometry.
 */

import { StagingRow, MeasureKind, ItemDetectado } from '@/types';
import { ExtractedExcelItem } from './excel';
import { LayerTakeoffIndex, getQuantityFromIndex, getLayerCandidates } from './csv-takeoff';
import { DXFContext } from './dxf-text-extractor';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// TYPES
// ============================================================================

interface MatchCandidate {
    layer: string;
    score: number;
    scoreBreakdown: {
        layerSimilarity: number;
        textBoost: number;
        keywordBoost: number;
    };
    qty: number | null;
    entityTypes: string[];
    matchedTexts?: string[]; // DXF texts that contributed to score
}

// ============================================================================
// P0.3: GENERIC LAYER BLACKLIST ("Hatch Slayer")
// These layers tend to be catch-all hatches or dimension layers that shouldn't
// be matched unless no better option exists.
// ============================================================================

const GENERIC_LAYERS: Set<string> = new Set([
    '0',                // Default layer, usually junk
    'dimen',            // Dimension layer
    'g-dim',            // Generic dimension
    'defpoints',        // AutoCAD default
    'fa_color 12',      // Generic hatch fill
    'fa_color 13',
    'fa_color 14',
    'fa_color 15',
    'mb-elev 2',        // Elevation hatches (usually massive areas)
    'mb-elev 4',
    'mb-elev 0',
    'i-ele-alumbrado',  // Too generic for specific items
]);

const GENERIC_LAYER_PENALTY = -0.7;  // Strong penalty for generic layers
const ABSURD_AREA_THRESHOLD = 5000;  // m² - areas larger than this are suspicious

// ============================================================================
// P0.4: DISCIPLINE FILTER SYSTEM
// Prevents electrical items from matching architectural layers and vice versa.
// ============================================================================

type Discipline = 'ELECTRICAL' | 'ARCHITECTURAL' | 'SANITARY' | 'STRUCTURAL' | 'UNKNOWN';

// Keywords that indicate an Excel item belongs to a specific discipline
const EXCEL_DISCIPLINE_KEYWORDS: Record<Discipline, string[]> = {
    'ELECTRICAL': ['enchufe', 'tomacorriente', 'tablero', 'alumbrado', 'luminaria',
        'iluminacion', 'electrico', 'canalizado', 'ups', 'sensor', 'parlante',
        'interruptor', 'dimmer', 'emergencia'],
    'SANITARY': ['lavamanos', 'inodoro', 'wc', 'sanitario', 'griferia', 'bomba',
        'alcantarillado', 'desague', 'agua potable', 'ap', 'ventilacion'],
    'STRUCTURAL': ['hormigon', 'acero', 'viga', 'columna', 'fundacion', 'pilar',
        'losa', 'radier', 'enfierradura', 'malla'],
    'ARCHITECTURAL': ['tabique', 'cielo', 'muro', 'piso', 'ceramico', 'pintura',
        'revestimiento', 'puerta', 'ventana', 'vitrina', 'mueble'],
    'UNKNOWN': [],
};

// Layer prefixes that indicate the layer belongs to a specific discipline
const LAYER_DISCIPLINE_PREFIXES: Record<Discipline, string[]> = {
    'ELECTRICAL': ['i-ele', 'ele-', 'e-', 'elec', 'fa-ilum', 'fa_ilum', 'fa_sistemas elec'],
    'SANITARY': ['i-san', 'san-', 's-', 'sani', 'ap-', 'alcant'],
    'STRUCTURAL': ['i-est', 'est-', 'e-', 'struct', 'hormigon'],
    'ARCHITECTURAL': ['a-arq', 'arq-', 'fa-', 'fa_', 'arch'],
    'UNKNOWN': [],
};

const DISCIPLINE_MISMATCH_PENALTY = -0.5;  // Score penalty for discipline mismatch

// ============================================================================
// SEMANTIC MATCHING
// ============================================================================

/**
 * Synonym dictionary for construction terms
 * Maps normalized terms to their synonyms for better matching
 */
const SYNONYMS: Record<string, string[]> = {
    // Walls / Partitions
    'tabiqueria': ['tabique', 'muro', 'divisorio', 'partition', 'pared', 'murillo', 'sobretabique'],
    'muro': ['tabique', 'tabiqueria', 'pared', 'wall', 'murillo'],
    'pared': ['muro', 'tabique', 'wall'],
    'sobretabique': ['tabique', 'tabiqueria', 'muro'],

    // Floors / Ceilings / Slabs
    'piso': ['suelo', 'floor', 'pavimento', 'radier'],
    'cielo': ['techo', 'ceiling', 'cielorraso', 'plafon'],
    'techo': ['cielo', 'ceiling', 'cubierta'],
    'losa': ['sobrelosa', 'radier', 'slab', 'placa'],
    'sobrelosa': ['losa', 'radier', 'placa'],
    'radier': ['losa', 'sobrelosa', 'piso', 'fundacion'],
    'pavimento': ['piso', 'suelo', 'floor', 'revestimiento'],

    // Sanitary
    'bano': ['wc', 'sanitario', 'toilet', 'restroom', 'bath', 'aseo'],
    'wc': ['bano', 'sanitario', 'toilet', 'bath'],
    'lavamanos': ['lavabo', 'lav', 'vanity', 'sink'],
    'inodoro': ['wc', 'toilet', 'water'],

    // Finishes
    'ceramico': ['ceramica', 'porcelanato', 'tile', 'baldosa', 'azulejo'],
    'porcelanato': ['ceramico', 'ceramica', 'tile', 'baldosa'],
    'marmol': ['marmol', 'marble', 'piedra'],
    'pintura': ['paint', 'latex', 'esmalte'],
    'revestimiento': ['enchape', 'recubrimiento', 'acabado', 'finish'],
    'impermeabilizacion': ['membrana', 'asfaltica', 'waterproof'],

    // Electrical
    'electrico': ['electrical', 'elec', 'elect'],
    'enchufe': ['tomacorriente', 'outlet', 'socket', 'punto'],
    'interruptor': ['switch', 'llave', 'int'],
    'luminaria': ['lampara', 'luz', 'light', 'lighting', 'foco'],
    'tablero': ['panel', 'board', 'cuadro'],
    'punto': ['enchufe', 'tomacorriente', 'outlet'],

    // Structure
    'hormigon': ['concreto', 'concrete', 'hg'],
    'acero': ['fierro', 'steel', 'fe'],
    'viga': ['beam', 'cadena'],
    'columna': ['pilar', 'column', 'col'],

    // Doors/Windows
    'puerta': ['door', 'pta', 'acceso'],
    'ventana': ['window', 'vta', 'vano'],
    'vitrina': ['escaparate', 'showcase', 'display'],

    // Common abbreviations
    'arq': ['arquitectura', 'arquitectonico', 'arch'],
    'est': ['estructura', 'estructural', 'struct'],
    'san': ['sanitario', 'sanitary'],
    'elec': ['electrico', 'electrical'],
    'ext': ['exterior', 'externo'],
    'int': ['interior', 'interno'],
};

/**
 * Expand tokens with their synonyms
 */
function expandTokensWithSynonyms(tokens: Set<string>): Set<string> {
    const expanded = new Set(tokens);

    for (const token of tokens) {
        // Check if token has synonyms
        if (SYNONYMS[token]) {
            for (const syn of SYNONYMS[token]) {
                expanded.add(syn);
            }
        }

        // Check if token IS a synonym of something
        for (const [key, syns] of Object.entries(SYNONYMS)) {
            if (syns.includes(token)) {
                expanded.add(key);
                for (const syn of syns) {
                    expanded.add(syn);
                }
            }
        }
    }

    return expanded;
}

/**
 * Normalize text for comparison (lowercase, remove accents, etc.)
 */
function normalizeText(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove accents
        .replace(/[^a-z0-9\s]/g, ' ')    // Keep only alphanumeric
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Calculate semantic similarity between two strings
 * Uses token overlap scoring with synonym expansion
 */
function calculateSimilarity(text1: string, text2: string): number {
    const tokens1 = new Set(normalizeText(text1).split(' ').filter(t => t.length > 2));
    const tokens2 = new Set(normalizeText(text2).split(' ').filter(t => t.length > 2));

    if (tokens1.size === 0 || tokens2.size === 0) return 0;

    // Expand with synonyms for better matching
    const expanded1 = expandTokensWithSynonyms(tokens1);
    const expanded2 = expandTokensWithSynonyms(tokens2);

    // Calculate intersection with expanded tokens
    const intersection = [...expanded1].filter(t => expanded2.has(t)).length;

    // Use original union size to not inflate denominator
    const union = new Set([...tokens1, ...tokens2]).size;

    // Bonus if direct match exists
    const directMatch = [...tokens1].filter(t => tokens2.has(t)).length;
    const directBonus = directMatch > 0 ? 0.1 : 0;

    return Math.min((intersection / union) * 0.8 + directBonus, 1.0);
}

/**
 * P0.4: Detect discipline of an Excel item based on keywords
 */
function detectExcelDiscipline(description: string): Discipline {
    const normalized = normalizeText(description);

    for (const [discipline, keywords] of Object.entries(EXCEL_DISCIPLINE_KEYWORDS)) {
        for (const keyword of keywords) {
            if (normalized.includes(keyword)) {
                return discipline as Discipline;
            }
        }
    }

    return 'UNKNOWN';
}

/**
 * P0.4: Detect discipline of a layer based on prefixes
 */
function detectLayerDiscipline(layer: string): Discipline {
    const normalized = normalizeText(layer);

    for (const [discipline, prefixes] of Object.entries(LAYER_DISCIPLINE_PREFIXES)) {
        for (const prefix of prefixes) {
            if (normalized.startsWith(prefix)) {
                return discipline as Discipline;
            }
        }
    }

    return 'UNKNOWN';
}

/**
 * Calculate enhanced score using DXF context
 * Combines layer name similarity with spatial text matching
 */
function calculateEnhancedScore(
    excelDescription: string,
    layer: string,
    dxfContext?: DXFContext
): { score: number; breakdown: { layerSimilarity: number; textBoost: number; keywordBoost: number }; matchedTexts: string[] } {
    const normalizedDesc = normalizeText(excelDescription);
    const descTokens = new Set(normalizedDesc.split(' ').filter(t => t.length > 2));

    // 1. Base: Layer name similarity (40% weight)
    const layerSimilarity = calculateSimilarity(excelDescription, layer);

    // 2. Text boost: DXF texts near this layer (30% weight)
    let textBoost = 0;
    const matchedTexts: string[] = [];

    if (dxfContext) {
        const nearbyTexts = dxfContext.layerTexts.get(layer) || [];

        for (const text of nearbyTexts) {
            const textTokens = new Set(text.split(' ').filter(t => t.length > 2));
            const overlap = [...descTokens].filter(t => textTokens.has(t));

            if (overlap.length > 0) {
                textBoost = Math.min(textBoost + 0.15, 0.3); // Cap at 0.3
                matchedTexts.push(text);
            }
        }
    }

    // 3. Keyword boost: Keywords from layer name (20% weight)
    let keywordBoost = 0;

    if (dxfContext) {
        const layerKeywords = dxfContext.layerKeywords.get(layer) || [];

        for (const keyword of layerKeywords) {
            if (normalizedDesc.includes(keyword)) {
                keywordBoost = Math.min(keywordBoost + 0.1, 0.2); // Cap at 0.2
            }
        }
    }

    // Combined score (capped at 1.0)
    const score = Math.min(layerSimilarity * 0.5 + textBoost + keywordBoost + layerSimilarity * 0.1, 1.0);

    return {
        score,
        breakdown: { layerSimilarity, textBoost, keywordBoost },
        matchedTexts
    };
}

/**
 * Infer measure kind from Excel unit
 */
function inferMeasureKind(unit: string): MeasureKind {
    const normalized = unit.toLowerCase().trim();

    if (['m2', 'm²', 'mt2', 'metro2', 'metros cuadrados'].some(u => normalized.includes(u))) {
        return 'area';
    }
    if (['m', 'ml', 'mt', 'metro', 'metros lineales'].some(u => normalized === u || normalized.startsWith(u + ' '))) {
        return 'length';
    }
    if (['un', 'u', 'pza', 'pieza', 'und', 'unidad'].some(u => normalized === u)) {
        return 'count';
    }
    if (['gl', 'global', 'sg'].some(u => normalized === u)) {
        return 'service';
    }

    return 'unknown';
}

/**
 * Check if an item is a section header (no unit, likely a title)
 */
function isSectionHeader(item: ExtractedExcelItem): boolean {
    if (!item.unit || item.unit.trim() === '') return true;
    if (item.description.length < 5) return true;
    if (/^[0-9.]+\s*$/.test(item.description.trim())) return true;
    return false;
}

// ============================================================================
// MATCHING LOGIC
// ============================================================================

/**
 * Find best matching layers for an Excel item
 */
function findBestMatches(
    item: ExtractedExcelItem,
    takeoffIndex: LayerTakeoffIndex,
    measureKind: MeasureKind,
    dxfContext?: DXFContext
): MatchCandidate[] {
    const candidates: MatchCandidate[] = [];
    const layerCandidates = getLayerCandidates(takeoffIndex, measureKind);

    // console.log(`[CSV Matcher] Finding matches for "${item.description.substring(0, 40)}..." (${measureKind})`);
    // console.log(`[CSV Matcher] Available layers for ${measureKind}: ${layerCandidates.length}`);

    for (const layer of layerCandidates) {
        const entry = takeoffIndex[layer];
        let { score, breakdown, matchedTexts } = calculateEnhancedScore(
            item.description,
            layer,
            dxfContext
        );

        let qty = getQuantityFromIndex(takeoffIndex, layer, measureKind);

        // P0.2: DXF Block Logic for Unit Items
        // If we are looking for a 'count' item, prioritize layers that actually have BLOCKS (Inserts)
        if (measureKind === 'count' && dxfContext && dxfContext.blockCounts) {
            const dxfBlockCount = dxfContext.blockCounts.get(layer);

            if (dxfBlockCount && dxfBlockCount > 0) {
                // Strong boost if layer has blocks
                score = Math.min(score + 0.35, 1.0);
                breakdown.textBoost = Math.min(breakdown.textBoost + 0.35, 0.4); // repurpose textBoost for now or add new field

                // Override CSV qty with precise block count from DXF
                qty = dxfBlockCount;
            } else {
                // Check if DXF has ANY blocks at all
                const totalBlocksInDXF = Array.from(dxfContext.blockCounts.values()).reduce((sum, count) => sum + count, 0);

                if (totalBlocksInDXF > 10) {
                    // Only penalize if blocks exist elsewhere (meaning they're relevant)
                    // Soft penalty: -0.2 instead of -0.5 to allow fallback to CSV count
                    score = Math.max(score - 0.2, 0);
                }
                // If no blocks exist anywhere, don't penalize (use CSV count as-is)
            }
        }

        // P0.3: Generic Layer Penalty ("Hatch Slayer")
        // Penalize generic layers like FA_COLOR 12, DIMEN, 0
        const normalizedLayer = normalizeText(layer);
        if (GENERIC_LAYERS.has(normalizedLayer)) {
            score = Math.max(score + GENERIC_LAYER_PENALTY, 0);
        }

        // P0.4: Discipline Filter
        // Penalize if Excel item discipline doesn't match layer discipline
        const excelDiscipline = detectExcelDiscipline(item.description);
        const layerDiscipline = detectLayerDiscipline(layer);

        if (excelDiscipline !== 'UNKNOWN' && layerDiscipline !== 'UNKNOWN' && excelDiscipline !== layerDiscipline) {
            score = Math.max(score + DISCIPLINE_MISMATCH_PENALTY, 0);
        }

        // P0.5: Absurd Area Detection
        // Penalize layers with unrealistically large areas for specific items
        if (measureKind === 'area' && qty && qty > ABSURD_AREA_THRESHOLD) {
            // If the item description is specific (e.g., "Sobrelosa de 8cm") but the area is huge,
            // it's likely a wrong match to an elevation hatch or similar
            const itemTokens = normalizeText(item.description).split(' ').filter(t => t.length > 3);
            if (itemTokens.length > 2) {  // Specific item (not just "Piso" or "Muro")
                score = Math.max(score - 0.3, 0);
            }
        }

        candidates.push({
            layer,
            score,
            scoreBreakdown: breakdown,
            qty,
            entityTypes: entry.entityTypes,
            matchedTexts: matchedTexts.length > 0 ? matchedTexts : undefined,
        });
    }

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);

    // Log top 3 candidates
    if (candidates.length > 0) {
        console.log(`[CSV Matcher] Top 3 matches for "${item.description.substring(0, 30)}...":`,
            candidates.slice(0, 3).map(c => `${c.layer} (${c.score.toFixed(2)}, qty: ${c.qty})`).join(', ')
        );
    } else {
        console.log(`[CSV Matcher] ⚠️ No candidates found for "${item.description.substring(0, 30)}..."`);
    }

    return candidates.slice(0, 5); // Top 5
}

// ============================================================================
// MAIN MATCHER FUNCTION
// ============================================================================

/**
 * Match Excel items to layers using the CSV takeoff index
 */
export function matchExcelToCSV(
    excelItems: ExtractedExcelItem[],
    takeoffIndex: LayerTakeoffIndex,
    sheetName: string,
    dxfContext?: DXFContext  // Optional: if provided, enables enhanced matching
): StagingRow[] {
    const stagingRows: StagingRow[] = [];
    const hasContext = !!dxfContext;

    if (hasContext) {
        console.log('[CSV Matcher] 🔍 Enhanced matching with DXF context enabled');
    }

    for (const item of excelItems) {
        const rowId = uuidv4();

        // Check if section header
        if (isSectionHeader(item)) {
            stagingRows.push({
                id: rowId,
                excel_sheet: sheetName,
                excel_row_index: item.row,
                excel_item_text: item.description,
                excel_unit: item.unit || '',
                row_type: 'section_header',
                source_items: [],
                qty_final: null,
                confidence: 'low',
                status: 'title',
                is_title: true,
                layer: '',
                type: 'text',
                score: 0,
                rejected: false,
            });
            continue;
        }

        // Infer measure kind
        const measureKind = inferMeasureKind(item.unit);

        // Handle global/service items
        if (measureKind === 'service') {
            stagingRows.push({
                id: rowId,
                excel_sheet: sheetName,
                excel_row_index: item.row,
                excel_item_text: item.description,
                excel_unit: item.unit,
                row_type: 'service',
                source_items: [],
                qty_final: 1,
                confidence: 'high',
                status: 'approved',
                calc_method: 'GLOBAL',
                layer: '',
                type: 'text',
                score: 1,
                rejected: false,
            });
            continue;
        }

        // Find matches
        const matches = findBestMatches(item, takeoffIndex, measureKind, dxfContext);
        const bestMatch = matches[0];
        const secondMatch = matches[1];

        // P1.2: Detect ambiguous matches (top 2 have similar scores)
        const isAmbiguous = bestMatch && secondMatch &&
            (bestMatch.score - secondMatch.score) < 0.1 &&
            bestMatch.score >= 0.3;

        // Determine confidence and status
        let confidence: 'high' | 'medium' | 'low' = 'low';
        let status: StagingRow['status'] = 'pending_no_match';
        let qtyFinal: number | null = null;
        let matchedLayer = '';
        let ambiguousLayers: string[] | undefined;

        if (isAmbiguous) {
            // P1.2: Force user to pick when ambiguous
            matchedLayer = bestMatch.layer;
            qtyFinal = bestMatch.qty;
            confidence = 'medium';
            status = 'pending_needs_layer_pick';
            ambiguousLayers = [bestMatch.layer, secondMatch.layer];
            console.log(`[CSV Matcher] ⚠️ Ambiguous: "${item.description.substring(0, 30)}..." → ${bestMatch.layer} (${bestMatch.score.toFixed(2)}) vs ${secondMatch.layer} (${secondMatch.score.toFixed(2)})`);
        } else if (bestMatch && bestMatch.score >= 0.3 && bestMatch.qty !== null) {
            matchedLayer = bestMatch.layer;
            qtyFinal = bestMatch.qty;

            if (bestMatch.score >= 0.6) {
                confidence = 'high';
                status = 'approved';
            } else if (bestMatch.score >= 0.4) {
                confidence = 'medium';
                status = 'pending';
            } else {
                confidence = 'low';
                status = 'pending';
            }
        } else if (matches.length > 0) {
            status = 'pending_needs_layer_pick';
        }

        // Build source items (synthetic for compatibility)
        const sourceItems: ItemDetectado[] = bestMatch && bestMatch.qty !== null ? [{
            id: uuidv4(),
            type: measureKind === 'area' ? 'area' : measureKind === 'length' ? 'length' : 'block',
            name_raw: bestMatch.layer,
            layer_raw: bestMatch.layer,
            layer_normalized: bestMatch.layer.toLowerCase().replace(/[^a-z0-9]/g, '_'),
            value_raw: bestMatch.qty,
            unit_raw: measureKind === 'area' ? 'm2' : measureKind === 'length' ? 'm' : 'u',
            value_si: bestMatch.qty,
            value_m: bestMatch.qty,
            evidence: 'CSV_TAKEOFF',
        }] : [];

        // Build top candidates for UI
        const topCandidates = matches.slice(0, 3).map(m => ({
            layer: m.layer,
            score_semantic: m.score,
            score_type: m.qty !== null ? 1 : 0,
            qty_if_used: m.qty ?? 0,
        }));

        stagingRows.push({
            id: rowId,
            excel_sheet: sheetName,
            excel_row_index: item.row,
            excel_item_text: item.description,
            excel_unit: item.unit,
            row_type: 'item',
            source_items: sourceItems,
            matched_items: sourceItems,
            qty_final: qtyFinal,
            confidence,
            match_confidence: bestMatch?.score ?? 0,
            // P2: Score breakdown for UI transparency
            score_breakdown: bestMatch?.scoreBreakdown,
            match_source: 'csv',
            ambiguous_layers: ambiguousLayers,
            status,
            calc_method: measureKind === 'area' ? 'AREA' : measureKind === 'length' ? 'LENGTH' : measureKind === 'count' ? 'COUNT' : undefined,
            method_detail: 'csv_takeoff',
            expected_measure_type: measureKind === 'area' ? 'AREA' : measureKind === 'length' ? 'LENGTH' : measureKind === 'count' ? 'BLOCK' : 'UNKNOWN',
            top_candidates: topCandidates,
            layer: matchedLayer,
            type: measureKind === 'area' ? 'area' : measureKind === 'length' ? 'length' : 'block',
            score: bestMatch?.score ?? 0,
            rejected: false,
            warnings: [],
            suggestions: matches.length > 1 && confidence !== 'high' ? [{
                id: uuidv4(),
                action_type: 'SELECT_ALT_LAYER',
                label: `Otras capas candidatas: ${matches.slice(1, 3).map(m => m.layer).join(', ')}`,
                confidence: 'medium',
            }] : [],
        });
    }

    return stagingRows;
}

/**
 * Get matching statistics for logging
 */
export function getMatchingStats(stagingRows: StagingRow[]): {
    total: number;
    matched: number;
    highConfidence: number;
    pending: number;
    headers: number;
} {
    return {
        total: stagingRows.length,
        matched: stagingRows.filter(r => r.qty_final !== null && r.status !== 'title').length,
        highConfidence: stagingRows.filter(r => r.confidence === 'high').length,
        pending: stagingRows.filter(r => r.status.startsWith('pending')).length,
        headers: stagingRows.filter(r => r.status === 'title').length,
    };
}
