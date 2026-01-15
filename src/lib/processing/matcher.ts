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
import { matchLayerKeywords, getLayerKeywords } from './layer-mapping';
import { buildLayerProfiles, validateGeometrySupport, getLayerProfilesSummary, type LayerGeometryProfile } from './geometry-validator';
import { classifyExcelSubtype, getSubtypeLabel } from './subtype-classifier';
import { runQualityGates, getQualityCheckSummary, qualityFailuresToSuggestions } from './quality-gates';
// Phase 3 imports
import { calculateDerivedArea, canUseDerivedAreaFallback, detectSurfaceOrientation } from './derived-area-calculator';
import { classifyBlock, getBlockPenalty, canAutoApproveBlock } from './block-classifier';
import { inferDiscipline } from './discipline-inferrer';
import { normalizeText } from './text-normalizer';

export function matchItems(excelItems: ExtractedExcelItem[], dxfItems: ItemDetectado[], sheetName: string, excelDiscipline: Discipline = 'UNKNOWN'): StagingRow[] {

    // ✅ P0.1: BUILD LAYER GEOMETRY PROFILES ONCE
    const layerProfiles = buildLayerProfiles(dxfItems);
    console.log(`[Matcher] ${getLayerProfilesSummary(layerProfiles)}`);

    // P1.C: INFER DISCIPLINE if UNKNOWN
    let effectiveDiscipline = excelDiscipline;
    if (excelDiscipline === 'UNKNOWN') {
        const layerNames = Array.from(layerProfiles.keys());
        const disciplineInference = inferDiscipline({
            sheetName,
            layers: layerNames
        });

        if (disciplineInference.discipline !== 'UNKNOWN') {
            effectiveDiscipline = disciplineInference.discipline as Discipline;
            console.log(`[Discipline] Inferred: ${effectiveDiscipline} (${disciplineInference.confidence}) from ${disciplineInference.source}`);
        }
    }

    // Configure Fuse to search within CAD items
    // We compare: block name, layer name
    // Pre-filtering: Ideally we filter dxfItems passed to this function.
    // However, if we receive specific discipline, we can filter here silently or penalize.

    // Start with all dxfItems, filter out text items
    let candidateItems = dxfItems.filter(item => {
        // Exclude text items from being matched as a best match
        // Texts can be used for enrichment but not as quantity sources
        return item.type !== 'text'; // lowercase to match ItemDetectado.type
    });

    // P1.A: Filter out nested block items (only use model space geometry for quantities)
    const modelSpaceItems = candidateItems.filter(item => {
        // If item has nested_path, it's from a nested block (check with optional chaining)
        const isNested = (item as any).nested_path?.length > 0;
        if (isNested) {
            return false; // Exclude nested items from quantity pool
        }
        return true;
    });

    if (modelSpaceItems.length < candidateItems.length) {
        const nestedCount = candidateItems.length - modelSpaceItems.length;
        console.log(`[Matcher] P1.A: Filtered ${nestedCount} nested block items (using ${modelSpaceItems.length} model space items)`);
        candidateItems = modelSpaceItems;
    }

    // Let's filter Fuse candidates to reduce noise if discipline is known
    if (effectiveDiscipline !== 'UNKNOWN' && effectiveDiscipline !== 'GENERAL') {
        candidateItems = candidateItems.filter(i => isDisciplineMatch(i.discipline || 'UNKNOWN', effectiveDiscipline));
        // If we filtered everything, maybe fallback to all? NO, strict scoping requested.
    }

    // P0.C: BUILD LAYER-FIRST CANDIDATES
    // Instead of fuzzy matching entities, we match against layer profiles
    interface LayerCandidate {
        layer: string;
        layer_normalized: string;
        profile: LayerGeometryProfile;
        sampleItem: ItemDetectado; // Representative item for this layer
    }

    const layerCandidates: LayerCandidate[] = [];
    for (const [layerName, profile] of layerProfiles.entries()) {
        // Find a sample item from this layer
        const sampleItem = candidateItems.find(i => i.layer_normalized === layerName);
        if (sampleItem) {
            layerCandidates.push({
                layer: sampleItem.layer_raw,
                layer_normalized: layerName,
                profile,
                sampleItem
            });
        }
    }

    console.log(`[Matcher] P0.C: Built ${layerCandidates.length} layer candidates for matching`);

    // 1. Build layer names index (for fuzzy) - P0.C: Layer-first matching
    // Fuse.js: lower threshold = more strict
    const fuse = new Fuse(layerCandidates, {
        keys: ['layer', 'layer_normalized'],
        includeScore: true,
        threshold: 0.6,
        shouldSort: true,
        ignoreLocation: true
    });

    // Also keep entity-level fuse for block name matching
    const entityFuse = new Fuse(candidateItems, {
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

        // P1.5: CLASSIFY EXCEL SUBTYPE for granular matching
        const subtypeClassification = classifyExcelSubtype(
            excelItem.description,
            expectedMeasureType
        );

        if (subtypeClassification.confidence > 0.7) {
            console.log(`[Subtype] "${excelItem.description}" → ${getSubtypeLabel(subtypeClassification.subtype)} (${(subtypeClassification.confidence * 100).toFixed(0)}%)`);
            if (subtypeClassification.matched_keywords) {
                console.log(`  Keywords: [${subtypeClassification.matched_keywords.join(', ')}]`);
            }
        }

        // Debug logging
        console.log(`[Matcher] Row ${excelItem.row}: "${excelItem.description}"`);
        console.log(`  Excel Unit: "${excelItem.unit}" → Expected Measure Type: ${expectedMeasureType}`);
        console.log(`  Classification: ${expectedType} (confidence: ${classification.confidence})`);

        // P0.A: PRE-FILTER LAYER CANDIDATES BY GEOMETRY TYPE (BEFORE FUZZY MATCH)
        let typeFilteredLayers = layerCandidates;
        if (expectedMeasureType === 'AREA') {
            typeFilteredLayers = layerCandidates.filter(lc =>
                lc.profile.has_area_support || lc.profile.has_length_support
            );
        } else if (expectedMeasureType === 'BLOCK') {
            typeFilteredLayers = layerCandidates.filter(lc => lc.profile.has_block_support);
        } else if (expectedMeasureType === 'LENGTH') {
            typeFilteredLayers = layerCandidates.filter(lc => lc.profile.has_length_support);
        }

        if (typeFilteredLayers.length < layerCandidates.length) {
            console.log(`  [P0.A] Pre-filtered ${layerCandidates.length - typeFilteredLayers.length} layers without ${expectedMeasureType} support`);
        }

        // 4. Search for matches using TYPE-FILTERED layers (P0.C Layer-first)
        const typeFilteredFuse = new Fuse(typeFilteredLayers, {
            keys: ['layer', 'layer_normalized'],
            includeScore: true,
            threshold: 0.6,
            shouldSort: true,
            ignoreLocation: true
        });

        const allResults = typeFilteredFuse.search(excelItem.description);

        // P0.1: GEOMETRY VALIDATION (now using LayerCandidate which has profile directly)
        const geometryValidatedResults = allResults.filter(r => {
            const validation = validateGeometrySupport(
                r.item.layer_normalized,
                expectedMeasureType,
                r.item.profile
            );

            if (!validation.supported) {
                console.log(`  [Geometry Reject] Layer "${r.item.layer_normalized}" - ${validation.reason}`);
                return false;
            }

            return true;
        });

        // Log geometry filter summary
        if (geometryValidatedResults.length < allResults.length) {
            const rejected = allResults.length - geometryValidatedResults.length;
            console.log(`  [Geometry Filter] Rejected ${rejected}/${allResults.length} candidates (missing geometry support)`);
        }

        // P0.A: Hard filter already done BEFORE fuzzy match, so we just use geometry validated results
        const result = geometryValidatedResults;

        let bestMatch: ItemDetectado[] = [];
        let confidence = 0;
        let reason = "No valid match found";
        let suggestions: Suggestion[] = [];
        const hardRejectReasons: string[] = [];
        const warnings: string[] = [];

        // Track if no compatible layers found
        if (result.length === 0 && layerCandidates.length > 0) {
            hardRejectReasons.push(
                `No layers found with ${expectedMeasureType} geometry support for "${excelItem.unit}"`
            );
        }

        if (result.length > 0) {
            const match = result[0];
            const layerCandidate = match.item; // This is a LayerCandidate
            const matchedItem = layerCandidate.sampleItem; // Get the actual ItemDetectado
            const score = match.score || 1;
            confidence = 1 - score;

            // ✅ LAYER KEYWORD BOOST
            // Check if match improves with layer keyword mapping
            const keywordMatch = matchLayerKeywords(excelItem.description, layerCandidate.layer);
            let keywordBoost = 0;
            let usedKeywordMapping = false;

            if (keywordMatch.score > 0) {
                // Keyword match found - boost confidence
                keywordBoost = keywordMatch.score * 0.4; // Up to 40% boost
                confidence = Math.min(1.0, confidence + keywordBoost);
                usedKeywordMapping = true;

                console.log(`[Matcher] 🎯 Keyword boost for "${excelItem.description}" → layer "${layerCandidate.layer}"`);
                console.log(`  • Matched keywords: [${keywordMatch.matchedKeywords.map(k => `"${k}"`).join(', ')}]`);
                console.log(`  • Method: ${keywordMatch.method}`);
                console.log(`  • Keyword score: ${(keywordMatch.score * 100).toFixed(0)}%`);
                console.log(`  • Confidence boost: +${(keywordBoost * 100).toFixed(0)}% → Final: ${(confidence * 100).toFixed(0)}%`);
            }

            // Type matching bonus - use profile to determine dominant type
            const dominantType = layerCandidate.profile.has_area_support ? 'AREA'
                : layerCandidate.profile.has_length_support ? 'LENGTH'
                    : layerCandidate.profile.has_block_support ? 'BLOCK' : 'UNKNOWN';

            if (typeMatches(dominantType as any, expectedType)) {
                confidence = Math.min(1.0, confidence * 1.1); // 10% bonus
                reason = `Type-matched layer "${layerCandidate.layer}" (${(confidence * 100).toFixed(0)}%)`;
            } else {
                reason = `Matched layer "${layerCandidate.layer}" (${(confidence * 100).toFixed(0)}%)`;
            }

            // Add keyword mapping info to reason
            if (usedKeywordMapping) {
                reason += ` | Keywords: [${keywordMatch.matchedKeywords.join(', ')}]`;
            }

            // ✅ P0.3: Don't auto-penalize layer 0 (valid geometry after DWG conversion)
            // Only penalize defpoints
            if (layerCandidate.layer_normalized === 'defpoints') {
                confidence = confidence * 0.1; // 90% Penalty for defpoints only
                reason += " | DEFPOINTS PENALTY";
            }

            // Layer 0 gets normal treatment but with explicit warning
            if (layerCandidate.layer_normalized === '0') {
                console.log(`  ⚠️ Using Layer 0 - verify this is correct (DWG conversion artifact)`);
                reason += " | From Layer 0";
            }

            if (confidence > 0.4) {
                bestMatch = [matchedItem];

                // Enhanced logging for successful match
                if (usedKeywordMapping) {
                    console.log(`[Matcher] ✅ Matched "${excelItem.description}" → layer "${layerCandidate.layer}" usando keywords [${keywordMatch.matchedKeywords.join(', ')}] con score FINAL: ${(confidence * 100).toFixed(0)}%`);
                }

                // P1.3: ENHANCE MATCH REASON with geometry metrics (use profile directly)
                const profile = layerCandidate.profile;
                if (profile) {
                    const geometryParts: string[] = [];
                    if (profile.total_area > 0) {
                        geometryParts.push(`${profile.total_area.toFixed(2)} m²`);
                        if (profile.hatch_count > 0) geometryParts.push(`(${profile.hatch_count} HATCHes)`);
                    }
                    if (profile.total_length > 0) {
                        geometryParts.push(`${profile.total_length.toFixed(2)} m`);
                    }
                    if (profile.block_count > 0) {
                        geometryParts.push(`${profile.block_count} blocks`);
                    }

                    if (geometryParts.length > 0) {
                        reason += ` | Geometry: ${geometryParts.join(', ')}`;
                    }
                }
            } else {
                // Generate suggestions for low confidence - convert LayerCandidates to items
                const itemsForSuggestions = result.slice(0, 3).map(r => ({
                    item: r.item.sampleItem,
                    score: r.score
                }));
                suggestions = generateSuggestions(itemsForSuggestions, excelItem, expectedType);
            }
        } else {
            // No matches found - generate suggestions from all items
            const itemsForSuggestions = allResults.slice(0, 3).map(r => ({
                item: r.item.sampleItem,
                score: r.score
            }));
            suggestions = generateSuggestions(itemsForSuggestions, excelItem, expectedType);
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

                // P0.D: Check if block is generic/untrusted
                if (match.type === 'block') {
                    const blockClassification = classifyBlock(
                        match.name_raw || '',
                        match.layer_normalized
                    );

                    if (blockClassification.isGeneric) {
                        console.log(`  [Block Classifier] ⚠️ Generic block detected: "${match.name_raw}" - ${blockClassification.reason}`);
                        confidence *= (1 - blockClassification.penaltyScore);
                        warnings.push(`Generic block: ${blockClassification.reason}`);

                        // Don't auto-approve generic blocks
                        if (!canAutoApproveBlock(blockClassification)) {
                            reason += ` | GENERIC BLOCK (requires review)`;
                        }
                    } else {
                        console.log(`  [Block Classifier] ✅ Trusted block: "${match.name_raw}" (${blockClassification.confidence})`);
                    }
                }

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
                // Case B: Geometry is Length (Muros/Tabiques lines) -> Convert to Area using P0.B
                else if (match.type === 'length') {
                    // Use derived area calculator for intelligent height detection
                    const derivedResult = calculateDerivedArea(
                        match.value_si,
                        excelItem.description
                    );

                    if (derivedResult.canDerive) {
                        qtyFinal = derivedResult.area_m2;
                        heightFactor = derivedResult.height_m;
                        reason += ` | ${derivedResult.reason}`;
                        console.log(`  [Derived Area] ${derivedResult.reason}`);
                    } else {
                        // Fallback to default height
                        heightFactor = 2.4;
                        qtyFinal = match.value_si * heightFactor;
                        reason += ` | Derivada: Largo * 2.4m (default)`;
                    }
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
        let status = determineStatus(confidence, bestMatch, expectedType, qtyFinal);

        // P2.1: RUN QUALITY GATES
        const qualityCheck = runQualityGates({
            id: '',
            excel_sheet: sheetName,
            excel_row_index: excelItem.row,
            excel_item_text: excelItem.description,
            excel_unit: excelItem.unit,
            source_items: bestMatch,
            matched_items: bestMatch,
            match_confidence: confidence,
            confidence: confidence > 0.8 ? 'high' : confidence > 0.4 ? 'medium' : 'low',
            qty_final: qtyFinal,
            status: status,
            expected_measure_type: expectedMeasureType,
            excel_subtype: subtypeClassification.subtype,
            excel_subtype_confidence: subtypeClassification.confidence,
            top_candidates: [] // Will be populated below
        } as any);

        // If quality check failed with errors, mark as pending
        if (!qualityCheck.passed) {
            status = 'pending';
            console.log(`[Quality] ${getQualityCheckSummary(qualityCheck)}`);

            // Add quality failures to suggestions
            const qualitySuggestions = qualityFailuresToSuggestions(qualityCheck.failures);
            suggestions.push(...qualitySuggestions);

            // Log each failure
            for (const failure of qualityCheck.failures) {
                console.log(`  ❌ ${failure.gate.name}: ${failure.result.message}`);
            }
        }

        // P1.2: CAPTURE TOP-K CANDIDATES with geometry metrics (using LayerCandidate)
        const topCandidates = allResults.slice(0, 5).map(r => {
            const layerCandidate = r.item;
            const profile = layerCandidate.profile;
            const isSelected = bestMatch.some(m => m.id === layerCandidate.sampleItem.id);

            // Check if rejected by geometry validation
            const geometryValidation = validateGeometrySupport(
                layerCandidate.layer_normalized,
                expectedMeasureType,
                profile
            );

            // Determine dominant type from profile
            const dominantType = profile.has_area_support ? 'area'
                : profile.has_length_support ? 'length'
                    : profile.has_block_support ? 'block' : 'unknown';

            // Check if rejected by type filter (already done by P0.A pre-filter)
            let rejectReason: string | undefined;
            if (!geometryValidation.supported) {
                rejectReason = geometryValidation.reason;
            }

            return {
                layer: layerCandidate.layer_normalized,
                type: dominantType,
                score: 1 - r.score!, // Fuse score is distance, convert to similarity
                rejected: !isSelected,
                reject_reason: rejectReason,
                geometry: {
                    area: profile.total_area > 0 ? profile.total_area : undefined,
                    length: profile.total_length > 0 ? profile.total_length : undefined,
                    blocks: profile.block_count > 0 ? profile.block_count : undefined,
                    hatches: profile.hatch_count > 0 ? profile.hatch_count : undefined,
                    closed_polys: profile.closed_poly_count > 0 ? profile.closed_poly_count : undefined
                },
                selected: isSelected
            };
        });

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

            // P1.5: Subtype classification
            excel_subtype: subtypeClassification.subtype,
            excel_subtype_confidence: subtypeClassification.confidence,
            excel_subtype_keywords: subtypeClassification.matched_keywords,

            top_candidates: topCandidates, // P1.2: Enhanced with geometry metrics
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
