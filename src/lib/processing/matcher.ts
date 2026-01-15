import Fuse from 'fuse.js';
import { ItemDetectado, StagingRow, Unit, Suggestion, Discipline } from '@/types';
import { ExtractedExcelItem } from './excel';
import { v4 as uuidv4 } from 'uuid';
// Use legacy-compatible functions from unit-classifier (which now has VOLUME support)
import { classifyItemIntent, typeMatches, getExpectedMeasureType, type ExpectedType } from './unit-classifier';
import { determineCalcMethod, isCompatibleType, type CalcMethod } from './calc-method';
import { isDisciplineMatch } from './discipline';
import { getMeasureKind } from './unit-normalizer';
import { checkQuantitySanity, getSanitySummary } from './sanity-checker';

export function matchItems(excelItems: ExtractedExcelItem[], dxfItems: ItemDetectado[], sheetName: string, excelDiscipline: Discipline = 'UNKNOWN'): StagingRow[] {

    // Configure Fuse to search within CAD items
    // Pre-filtering: Ideally we filter dxfItems passed to this function.
    // However, if we receive specific discipline, we can filter here silently or penalize.

    // Let's filter Fuse candidates to reduce noise if discipline is known
    let candidateItems = dxfItems;
    if (excelDiscipline !== 'UNKNOWN' && excelDiscipline !== 'GENERAL') {
        candidateItems = dxfItems.filter(i => isDisciplineMatch(i.discipline || 'UNKNOWN', excelDiscipline));
        // If we filtered everything, maybe fallback to all? NO, strict scoping requested.
    }

    const fuse = new Fuse(candidateItems, {
        keys: ['name_raw', 'layer_normalized'],
        includeScore: true,
        threshold: 0.6,
        shouldSort: true,
        ignoreLocation: true
    });

    const rows: StagingRow[] = excelItems.map(excelItem => {
        // --- HOTFIX 1: Handle Non-Measurable Rows ---
        if (excelItem.type === 'section_header' || excelItem.type === 'note') {
            return {
                id: uuidv4(),
                excel_sheet: sheetName,
                excel_row_index: excelItem.row,
                excel_item_text: excelItem.description,
                excel_unit: excelItem.unit,
                row_type: excelItem.type, // Pass through
                source_items: [],
                matched_items: [],
                match_confidence: 0,
                confidence: 'low',
                match_reason: excelItem.type === 'section_header' ? 'Clasificado como Título de Sección' : 'Skipped: Note/Exclusion',
                qty_final: null,
                status: excelItem.type === 'section_header' ? 'title' : 'ignored',
                calc_method: 'GLOBAL',
                discipline: excelDiscipline
            };
        }

        if (excelItem.type === 'service') {
            return {
                id: uuidv4(),
                excel_sheet: sheetName,
                excel_row_index: excelItem.row,
                excel_item_text: excelItem.description,
                excel_unit: excelItem.unit,
                row_type: excelItem.type,
                source_items: [],
                matched_items: [],
                match_confidence: 1.0, // High confidence manual/global
                confidence: 'high',
                match_reason: 'Auto-Approved: Service/Global Item',
                qty_final: 1, // Default quantity for services is 1 (GL)
                status: 'approved',
                calc_method: 'GLOBAL',
                method_detail: 'service_auto_approve',
                discipline: excelDiscipline
            };
        }

        // --- NORMAL ITEM MATCHING ---

        // 1. Determine calculation method (deterministic)
        const calcMethodResult = determineCalcMethod(excelItem.unit, excelItem.description);
        const calcMethod = calcMethodResult.method;

        // 2. Derive expected measure type from Excel unit (for hard filtering)
        const expectedMeasureType = getExpectedMeasureType(excelItem.unit);

        // 3. Classify expected type deterministically (for soft matching)
        // Switch to new classifyItemIntent (desc, unit) order
        const classification = classifyItemIntent(excelItem.description, excelItem.unit);
        const expectedType = classification.type;

        // Debug logging
        console.log(`[Matcher] Row ${excelItem.row}: "${excelItem.description}"`);
        console.log(`  Excel Unit: "${excelItem.unit}" → Expected Measure Type: ${expectedMeasureType}`);
        console.log(`  Classification: ${expectedType} (confidence: ${classification.confidence})`);

        // 4. Search for matches
        const allResults = fuse.search(excelItem.description);

        // 5. Apply HARD filter by measurement type
        const hardFilteredResults = expectedMeasureType !== 'UNKNOWN' && expectedMeasureType !== 'GLOBAL'
            ? allResults.filter(r => {
                // Convert lowercase type to uppercase for comparison
                const itemTypeUpper = r.item.type.toUpperCase() as 'BLOCK' | 'LENGTH' | 'TEXT' | 'AREA';
                const isCompatible = typeMatches(itemTypeUpper, expectedMeasureType);
                if (!isCompatible) {
                    console.log(`  [Hard Reject] "${r.item.layer_normalized}" - Type ${r.item.type} incompatible with expected ${expectedMeasureType}`);
                }
                return isCompatible;
            })
            : allResults;

        const result = hardFilteredResults.length > 0 ? hardFilteredResults : [];

        let bestMatch: ItemDetectado[] = [];
        let confidence = 0;
        let reason = "No valid match found";
        let suggestions: Suggestion[] = [];
        const hardRejectReasons: string[] = [];
        const warnings: string[] = [];

        // Track hard rejects
        if (expectedMeasureType !== 'UNKNOWN' && hardFilteredResults.length === 0 && allResults.length > 0) {
            const foundTypes = [...new Set(allResults.slice(0, 3).map(r => r.item.type))].join(', ');
            hardRejectReasons.push(
                `Unidad Excel "${excelItem.unit}" requiere tipo ${expectedMeasureType}, pero solo se encontraron: ${foundTypes}`
            );
        }

        if (result.length > 0) {
            const match = result[0];
            const score = match.score || 1;
            confidence = 1 - score;

            // Type matching bonus - convert to UPPERCASE for comparison
            const matchTypeUpper = match.item.type.toUpperCase() as 'BLOCK' | 'LENGTH' | 'TEXT' | 'AREA';
            if (typeMatches(matchTypeUpper, expectedType)) {
                confidence = Math.min(1.0, confidence * 1.1); // 10% bonus
                reason = `Type-matched "${match.item.name_raw || match.item.layer_raw}" (${(confidence * 100).toFixed(0)}%)`;
            } else {
                reason = `Matched "${match.item.name_raw || match.item.layer_raw}" (${(confidence * 100).toFixed(0)}%)`;
            }

            // --- HOTFIX 5: Exclude Layer 0 default ---
            if (match.item.layer_normalized === '0' || match.item.layer_normalized === 'defpoints') {
                confidence = confidence * 0.1; // 90% Penalty
                reason += " | LAYER 0 PENALTY";
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

            // --- HOTFIX 3: Unit-Based Quantity Calculation ---
            // We use calcMethod to decide how to derive qty from CAD geometry

            if (calcMethod === 'COUNT') {
                // ✅ Use value_si for count (blocks)
                qtyFinal = match.type === 'block' ? (match.value_si || 1) : 0;

                // If we matched a length item for a count unit -> Semantic Error
                if (match.type === 'length') {
                    confidence = 0.2;
                    reason = "Mismatch: Expected COUNT/BLOCK, got LENGTH geometry";
                    qtyFinal = 1; // Default to 1 unit if forced?
                }
            }

            else if (calcMethod === 'LENGTH') {
                qtyFinal = match.value_si; // ✅ SI units (meters)
            }

            else if (calcMethod === 'AREA') {
                // Case A: Geometry is Area (HATCH/Polyline Region)
                if (match.type === 'area') {
                    qtyFinal = match.value_si; // ✅ SI units (m²)
                }
                // Case B: Geometry is Length (Muros/Tabiques lines) -> Convert to Area
                else if (match.type === 'length') {
                    heightFactor = 2.4; // Default Height
                    qtyFinal = match.value_si * heightFactor;  // ✅ SI units
                    reason += " | Derivada: Largo * 2.4m";
                }
                else {
                    qtyFinal = 0;
                }
            }

            else if (calcMethod === 'VOLUME') {
                // Naive implementation: Area * Thickness
                const thickness = 0.1; // 10cm default
                if (match.type === 'area') {
                    qtyFinal = match.value_si * thickness;  //✅ SI units
                } else if (match.type === 'length') {
                    // Length * Height * Thickness
                    qtyFinal = match.value_si * 2.4 * thickness;  // ✅ SI units
                }
            }

            else {
                // Global or Unknown
                qtyFinal = match.value_si;  // ✅ SI units
            }
        } else {
            // Keep existing Excel qty if present for "Manual" verification
            if (excelItem.qty !== null) qtyFinal = excelItem.qty;
        }

        // ✅ SANITY CHECK: Detect suspicious values
        const measureKind = getMeasureKind(excelItem.unit);
        const sanityCheck = checkQuantitySanity(qtyFinal, measureKind, {
            description: excelItem.description,
            unit: excelItem.unit
        });

        // If sanity check failed, add warnings and potentially adjust status
        if (!sanityCheck.passed) {
            sanityCheck.issues.forEach(issue => {
                warnings.push(`${issue.type}: ${issue.message}`);
            });

            // For errors (not just warnings), mark as pending
            if (sanityCheck.severity === 'error') {
                confidence = Math.min(confidence, 0.3); // Reduce confidence
            }
        }

        // Determine refined status
        const status = determineStatus(confidence, bestMatch, expectedType, qtyFinal);

        return {
            id: uuidv4(),
            excel_sheet: sheetName,
            excel_row_index: excelItem.row,
            excel_item_text: excelItem.description,
            excel_unit: excelItem.unit,
            row_type: excelItem.type, // Pass through
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
            method_detail: calcMethodResult.method_detail,
            discipline: excelDiscipline,

            // Debug Outputs (Phase 1 improvements)
            expected_measure_type: expectedMeasureType,
            top_candidates: allResults.slice(0, 5).map(r => ({
                layer: r.item.layer_normalized,
                type: r.item.type,
                score: 1 - (r.score || 1),
                rejected: !hardFilteredResults.includes(r),
                reject_reason: !hardFilteredResults.includes(r)
                    ? `Type ${r.item.type} incompatible with expected ${expectedMeasureType}`
                    : undefined
            })),
            hard_reject_reasons: hardRejectReasons.length > 0 ? hardRejectReasons : undefined,
            warnings: warnings.length > 0 ? warnings : undefined
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
        if (typeMatches(item.type.toUpperCase() as any, expectedType)) {
            reasons.push(`Type matches expected (${expectedType})`);
        } else {
            reasons.push(`⚠️ Type mismatch: found ${item.type}, expected ${expectedType}`);
        }

        // --- HOTFIX 5: Layer 0 Warning ---
        if (item.layer_normalized === '0' || item.layer_normalized === 'defpoints') {
            reasons.push(`⚠️ Layer 0/Defpoints (High Risk)`);
            // We heavily penalize this in the score logic if we haven't already
        }

        // Reason 3: Quantity reasonableness
        if (item.value_si > 0) {
            reasons.push(`Qty: ${item.value_si.toFixed(2)} ${item.unit_raw}`);
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
    if (expectedType !== 'UNKNOWN' && !typeMatches(match.type.toUpperCase() as any, expectedType)) {
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
