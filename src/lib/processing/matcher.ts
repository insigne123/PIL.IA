import Fuse from 'fuse.js';
import { ItemDetectado, StagingRow, Unit, Suggestion } from '@/types';
import { ExtractedExcelItem } from './excel';
import { v4 as uuidv4 } from 'uuid';
import { classifyExpectedType, typeMatches, type ExpectedType } from './unit-classifier';
import { determineCalcMethod, isCompatibleType, type CalcMethod } from './calc-method';

export function matchItems(excelItems: ExtractedExcelItem[], dxfItems: ItemDetectado[], sheetName: string): StagingRow[] {

    // Configure Fuse to search within CAD items
    const fuse = new Fuse(dxfItems, {
        keys: ['name_raw', 'layer_normalized'],
        includeScore: true,
        threshold: 0.6,
        shouldSort: true,
        ignoreLocation: true
    });

    const rows: StagingRow[] = excelItems.map(excelItem => {
        // 1. Determine calculation method (deterministic)
        const calcMethodResult = determineCalcMethod(excelItem.unit, excelItem.description);
        const calcMethod = calcMethodResult.method;

        // 2. Classify expected type deterministically
        const classification = classifyExpectedType(excelItem.unit, excelItem.description);
        const expectedType = classification.type;

        // 2. Search for matches
        const allResults = fuse.search(excelItem.description);

        // 3. Filter by expected type if known
        const filteredResults = expectedType !== 'UNKNOWN' && expectedType !== 'GLOBAL'
            ? allResults.filter(r => typeMatches(r.item.type, expectedType))
            : allResults;

        const result = filteredResults.length > 0 ? filteredResults : allResults;

        let bestMatch: ItemDetectado[] = [];
        let confidence = 0;
        let reason = "No valid match found";
        let suggestions: Suggestion[] = [];

        if (result.length > 0) {
            const match = result[0];
            const score = match.score || 1;
            confidence = 1 - score;

            // Type matching bonus
            if (typeMatches(match.item.type, expectedType)) {
                confidence = Math.min(1.0, confidence * 1.1); // 10% bonus
                reason = `Type-matched "${match.item.name_raw || match.item.layer_raw}" (${(confidence * 100).toFixed(0)}%)`;
            } else {
                reason = `Matched "${match.item.name_raw || match.item.layer_raw}" (${(confidence * 100).toFixed(0)}%)`;
            }

            if (confidence > 0.4) {
                bestMatch = [match.item];
            } else {
                // Generate suggestions for low confidence
                suggestions = generateSuggestions(result.slice(0, 3), excelItem, expectedType);
            }
        } else {
            // No matches found - generate suggestions from all items
            suggestions = generateSuggestions(allResults.slice(0, 3), excelItem, expectedType);
        }

        // Calculate Qty
        let qtyFinal = 0;
        let heightFactor = undefined;

        if (bestMatch.length > 0) {
            const match = bestMatch[0];
            // Logic: 
            // If Excel unit is m2 and match is length, apply default height (handled in UI or here? Here default 1, UI applies factor)
            // But StagingRow has 'height_factor'.
            // If unit is matches (m vs m, un vs block), just take value.

            qtyFinal = match.value_m;

            if (excelItem.unit.toLowerCase().includes('m2') && match.type === 'length') {
                heightFactor = 2.4; // Default
                qtyFinal = match.value_m * heightFactor;
            }
        } else {
            // Keep existing Excel qty if present for "Manual" verification
            if (excelItem.qty !== null) qtyFinal = excelItem.qty;
        }

        // Determine refined status
        const status = determineStatus(confidence, bestMatch, expectedType, qtyFinal);

        return {
            id: uuidv4(),
            excel_sheet: sheetName,
            excel_row_index: excelItem.row,
            excel_item_text: excelItem.description,
            excel_unit: excelItem.unit,
            source_items: bestMatch,
            matched_items: bestMatch,
            match_confidence: confidence,
            confidence: confidence > 0.8 ? 'high' : confidence > 0.4 ? 'medium' : 'low',
            match_reason: reason,
            qty_final: qtyFinal,
            height_factor: heightFactor,
            price_selected: excelItem.price || undefined,
            price_candidates: [],
            status,
            status_reason: getStatusReason(status, classification, confidence),
            suggestions: suggestions.length > 0 ? suggestions : undefined,
            // NEW: Calculation method
            calc_method: calcMethod,
            method_detail: calcMethodResult.method_detail
        };
    });

    return rows;
}

/**
 * Generate suggestions for pending items
 */
function generateSuggestions(
    results: Array<{ item: ItemDetectado; score?: number }>,
    excelItem: ExtractedExcelItem,
    expectedType: ExpectedType
): Suggestion[] {
    const suggestions: Suggestion[] = [];

    for (const result of results) {
        const item = result.item;
        const score = result.score !== undefined ? 1 - result.score : 0;

        const reasons: string[] = [];

        // Reason 1: Name/Layer similarity
        if (score > 0.3) {
            reasons.push(`Similar name/layer (${(score * 100).toFixed(0)}% match)`);
        }

        // Reason 2: Type compatibility
        if (typeMatches(item.type, expectedType)) {
            reasons.push(`Type matches expected (${expectedType})`);
        } else {
            reasons.push(`⚠️ Type mismatch: found ${item.type}, expected ${expectedType}`);
        }

        // Reason 3: Quantity reasonableness
        if (item.value_m > 0) {
            reasons.push(`Qty: ${item.value_m.toFixed(2)} ${item.unit_raw}`);
        }

        suggestions.push({
            id: uuidv4(),
            action_type: 'SELECT_ALT_LAYER',
            label: `Use "${item.name_raw}" from layer "${item.layer_raw}"`,
            payload: { itemId: item.id, layer: item.layer_raw, name: item.name_raw },
            confidence: score > 0.6 ? 'high' : score > 0.3 ? 'medium' : 'low'
        });
    }

    // Add manual qty suggestion if no good matches
    if (results.length === 0 || results.every(r => (r.score || 1) > 0.7)) {
        suggestions.push({
            id: uuidv4(),
            action_type: 'MANUAL_QTY',
            label: 'Enter quantity manually',
            payload: {},
            confidence: 'medium'
        });
    }

    return suggestions.slice(0, 3); // Top 3 suggestions
}

/**
 * Determine refined status based on confidence and type matching
 */
function determineStatus(
    confidence: number,
    bestMatch: ItemDetectado[],
    expectedType: ExpectedType,
    qtyFinal: number | null
): StagingRow['status'] {
    // No match found
    if (bestMatch.length === 0) {
        return expectedType === 'GLOBAL' ? 'pending_semantics' : 'pending_no_match';
    }

    const match = bestMatch[0];

    // No geometry extracted
    if (qtyFinal === null || qtyFinal === 0) {
        return 'pending_no_geometry';
    }

    // Type mismatch
    if (expectedType !== 'UNKNOWN' && !typeMatches(match.type, expectedType)) {
        return 'pending_semantics';
    }

    // High confidence - approve
    if (confidence >= 0.7) {
        return 'approved';
    }

    // Medium confidence - pending
    if (confidence >= 0.4) {
        return 'pending';
    }

    // Low confidence - semantics issue
    return 'pending_semantics';
}

/**
 * Get human-readable reason for status
 */
function getStatusReason(
    status: StagingRow['status'],
    classification: { type: ExpectedType; reason: string },
    confidence: number
): string {
    switch (status) {
        case 'approved':
            return `High confidence match (${(confidence * 100).toFixed(0)}%)`;
        case 'pending':
            return `Medium confidence - review recommended (${(confidence * 100).toFixed(0)}%)`;
        case 'pending_no_geometry':
            return 'No geometry found or quantity is zero';
        case 'pending_no_match':
            return 'No matching CAD items found';
        case 'pending_semantics':
            return `Type or semantic mismatch - ${classification.reason}`;
        default:
            return 'Unknown status';
    }
}
