import Fuse, { FuseResult } from 'fuse.js';
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
// Phase 4 imports (AI-recommended fixes)
import { detectFootprintCandidates, getFootprintSummary, getFootprintScore } from './footprint-detector';
import { isNonMeasurableLayer, getNonMeasurablePenalty } from './layer-blacklist';
import { extractZoneIntent } from './spatial-intent'; // Phase 5: Spatial

// Phase 6 B): Approval Gates Validator
function validateApprovalGates(
    unit: string,
    evidenceType: 'area' | 'length' | 'block' | 'text' | 'none',
    calcMethod: string | null,
    isWallIntent: boolean
): { approved: boolean; reason: string } {
    const unitLower = unit.toLowerCase();

    // 1. mÂ² Rules
    if (unitLower.includes('m2') || unitLower === 'mÂ²') {
        // Valid Case A: Area geometry with direct measurement
        if (evidenceType === 'area' && calcMethod === 'direct_area') {
            return { approved: true, reason: 'Valid area geometry' };
        }

        // Valid Case B: Length geometry for WALL/SURFACE (length * height)
        const isLengthMethod = calcMethod === 'length_x_height' || calcMethod === 'length_x_height_default';
        if (evidenceType === 'length' && isLengthMethod) {
            return { approved: true, reason: 'Valid wall length Ã— height' };
        }

        if (evidenceType === 'text') return { approved: false, reason: 'Text evidence not allowed for mÂ²' };
        if (evidenceType === 'block') return { approved: false, reason: 'Block evidence invalid for mÂ²' };

        return { approved: false, reason: `Invalid evidence/method for mÂ²: ${evidenceType} / ${calcMethod}` };
    }

    // 2. Count (un) Rules
    if (['un', 'u', 'und', 'unidad'].includes(unitLower)) {
        if (evidenceType === 'block') return { approved: true, reason: 'Valid block count' };
        return { approved: false, reason: `Count requires BLOCK evidence, got ${evidenceType}` };
    }

    // 3. Length (ml) Rules
    if (['ml', 'm'].includes(unitLower)) {
        if (evidenceType === 'length') return { approved: true, reason: 'Valid length geometry' };
        // Exception: Perimeter from area? Maybe later.
        return { approved: false, reason: `Length requires LENGTH geometry, got ${evidenceType}` };
    }

    // Default pass for other units (gl, etc)
    return { approved: true, reason: 'Unit not strictly validated' };
}

// FIX 11.1: Helper to Validate Wall Fallback
function shouldApplyWallFallback(match: ItemDetectado, excelItem: ExtractedExcelItem): boolean {
    // 1. Layer Analysis Check (The 3D Truth)
    if (match.layerAnalysis?.classification === 'HORIZONTAL') {
        console.log(`  [Matcher] ⚠️ Wall Fallback Blocked: Layer ${match.layer_normalized} is 3D-Horizontal`);
        return false;
    }

    // 2. Keyword check (Redundant but safe)
    const horizontalKeywords = ['losa', 'cielo', 'impermeabilizacion', 'cubierta', 'radier', 'piso', 'terraza', 'techo'];
    const itemText = excelItem.description.toLowerCase();
    if (horizontalKeywords.some(kw => itemText.includes(kw))) {
        console.log(`  [Matcher] ⚠️ Wall Fallback Blocked: Item "${excelItem.description}" has horizontal keyword`);
        return false;
    }

    return true;
}

export function matchItems(excelItems: ExtractedExcelItem[], dxfItems: ItemDetectado[], sheetName: string, excelDiscipline: Discipline = 'UNKNOWN'): StagingRow[] {

    // FIX 8.2: Build Spatial Zone Registry
    // Map Zone Name -> Max Valid Area found in that zone
    const zoneRegistry: Record<string, number> = {};
    dxfItems.forEach(item => {
        if (item.zone_name && item.type === 'area') {
            if (item.value_si > 0) {
                const zoneKey = item.zone_name.toUpperCase();
                // Keep the largest area found for this zone (e.g. the floor)
                if (!zoneRegistry[zoneKey] || item.value_si > zoneRegistry[zoneKey]) {
                    zoneRegistry[zoneKey] = item.value_si;
                }
            }
        }
    });
    if (Object.keys(zoneRegistry).length > 0) {
        const keys = Object.keys(zoneRegistry);
        console.log(`[Matcher] Built Zone Registry with ${keys.length} zones. Keys: ${keys.slice(0, 10).join(', ')}...`);
    } else {
        console.warn(`[Matcher] WARNING: Zone Registry is EMPTY. DLP/Spatial logic might fail. Total Items: ${dxfItems.length}. Items with zone_name: ${dxfItems.filter(i => i.zone_name).length}`);
    }

    // âœ… P0.1: BUILD LAYER GEOMETRY PROFILES ONCE
    const layerProfiles = buildLayerProfiles(dxfItems);
    console.log(`[Matcher] ${getLayerProfilesSummary(layerProfiles)}`);

    // FIX C: DETECT FOOTPRINT CANDIDATES FOR AREA ITEMS
    // Calculate global bbox from items for footprint detection
    const xCoords = dxfItems.filter(i => i.position?.x).map(i => i.position!.x);
    const yCoords = dxfItems.filter(i => i.position?.y).map(i => i.position!.y);
    const globalBBox = {
        width: xCoords.length > 0 ? Math.max(...xCoords) - Math.min(...xCoords) : 100,
        height: yCoords.length > 0 ? Math.max(...yCoords) - Math.min(...yCoords) : 100
    };
    // Phase 6 E): Approx Project Footprint Area (largest dimension squared * 0.5 as heuristic)
    const projectFootprintEstimate = globalBBox.width * globalBBox.height;

    const footprintResult = detectFootprintCandidates(dxfItems, globalBBox);
    if (footprintResult.candidates.length > 0) {
        console.log(`[Footprint] ${getFootprintSummary(footprintResult)}`);
    }


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
        keywords_str: string; // [NEW] Keywords joined for fuzzy search
        profile: LayerGeometryProfile;
        sampleItem: ItemDetectado; // Representative item for this layer
    }

    const layerCandidates: LayerCandidate[] = [];
    for (const [layerName, profile] of layerProfiles.entries()) {
        const sampleItem = candidateItems.find(i => i.layer_normalized === layerName);
        if (sampleItem) {
            // Get keywords for this layer
            const keywords = getLayerKeywords(layerName);

            layerCandidates.push({
                layer: sampleItem.layer_raw,
                layer_normalized: layerName,
                keywords_str: keywords.join(' '), // Join for fuzzy search
                profile,
                sampleItem
            });
        }
    }

    console.log(`[Matcher] P0.C: Built ${layerCandidates.length} layer candidates for matching`);

    // 1. Build layer names index (for fuzzy) - P0.C: Layer-first matching
    // Fuse.js: lower threshold = more strict
    const fuse = new Fuse(layerCandidates, {
        keys: ['layer', 'layer_normalized', 'keywords_str'], // [NEW] Include keywords in search
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
                source_items: [] as ItemDetectado[],
                matched_items: [] as ItemDetectado[],
                match_confidence: 0,
                confidence: 'low',
                match_reason: excelItem.type === 'section_header' ? 'Clasificado como Título de Sección' : 'Skipped: Note/Exclusion',
                qty_final: null,
                status: excelItem.type === 'section_header' ? 'title' : 'ignored',
                calc_method: 'GLOBAL',
                discipline: excelDiscipline,
                // Phase 6 A): Pass expected
                excel_qty_expected: excelItem.expectedQty,
                excel_qty_excluded: excelItem.expectedExcluded
            } as StagingRow;
        }

        if (excelItem.type === 'service') {
            return {
                id: uuidv4(),
                excel_sheet: sheetName,
                excel_row_index: excelItem.row,
                excel_item_text: excelItem.description,
                excel_unit: excelItem.unit,
                row_type: excelItem.type,
                source_items: [] as ItemDetectado[],
                matched_items: [] as ItemDetectado[],
                match_confidence: 1.0, // High confidence manual/global
                confidence: 'high',
                match_reason: 'Auto-Approved: Service/Global Item',
                qty_final: 1, // Default quantity for services is 1 (GL)
                status: 'approved',
                calc_method: 'GLOBAL',
                method_detail: 'service_auto_approve',
                discipline: excelDiscipline,
                // Phase 6 A)
                excel_qty_expected: excelItem.expectedQty,
                excel_qty_excluded: excelItem.expectedExcluded
            } as StagingRow;
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

        // FIX 2/3: Detect WALL intent for m² items (tabique/muro/empaste)
        const descLower = excelItem.description.toLowerCase();
        const isWallIntent = [
            'tabique', 'sobretabique', 'muro', 'empaste', 'huincha',
            'pintura tabique', 'enlucido', 'estuco', 'revoco',
            'revestimiento muro', 'ceramico muro', 'ceramica muro'
        ].some(keyword => descLower.includes(keyword));

        if (expectedMeasureType === 'AREA') {
            if (isWallIntent) {
                // P0.2: For WALL items, ONLY accept layers with LENGTH support
                // Walls MUST be measured as length × height, NOT blocks/text/direct-area
                typeFilteredLayers = layerCandidates.filter(lc =>
                    lc.profile.has_length_support && lc.profile.total_length > 0
                );

                if (typeFilteredLayers.length === 0) {
                    // P0.2: No LENGTH layers found for WALL - this will trigger pending_no_length_for_wall
                    console.log(`  [P0.2] ⚠️ WALL intent but NO layers with length_total_m > 0`);
                    // Keep all layers but mark as problematic - will be caught by hard gate
                    typeFilteredLayers = layerCandidates.filter(lc =>
                        lc.profile.has_area_support || lc.profile.has_length_support
                    );
                } else {
                    console.log(`  [P0.2] WALL intent: filtered to ${typeFilteredLayers.length} layers with LENGTH support`);
                }
            } else {
                typeFilteredLayers = layerCandidates.filter(lc =>
                    lc.profile.has_area_support || lc.profile.has_length_support
                );
            }
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
            keys: ['layer', 'layer_normalized', 'keywords_str'], // [NEW] Include keywords
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

        // Evaluate top candidates to find best match after boosting
        // P0.C: We must evaluate multiple candidates because keyword boosting might promote a lower-ranked Fuse match
        interface EvaluatedCandidate {
            match: FuseResult<LayerCandidate>;
            confidence: number;
            reason: string;
            warnings: string[];
        }

        const evaluatedCandidates: EvaluatedCandidate[] = [];

        if (result.length > 0) {
            // Check top 5 candidates
            const candidatesToEvaluate = result.slice(0, 5);

            for (const match of candidatesToEvaluate) {
                const layerCandidate = match.item;
                const matchedItem = layerCandidate.sampleItem;
                const score = match.score || 1;
                let currentConfidence = 1 - score;
                let currentReason = '';
                const currentWarnings: string[] = [];

                // ✅ LAYER KEYWORD BOOST
                const keywordMatch = matchLayerKeywords(excelItem.description, layerCandidate.layer);
                let keywordBoost = 0;
                let usedKeywordMapping = false;

                if (keywordMatch.score > 0) {
                    usedKeywordMapping = true;

                    if (keywordMatch.method === 'direct') {
                        // P0 FIX: Explicit keyword match is a STRONG signal
                        const newConfidence = Math.max(currentConfidence, 0.85);
                        keywordBoost = newConfidence - currentConfidence;
                        currentConfidence = newConfidence;
                    } else {
                        keywordBoost = keywordMatch.score * 0.4;
                        currentConfidence = Math.min(1.0, currentConfidence + keywordBoost);
                    }
                }

                // ✅ P1.7: GEOMETRY PRIOR
                if (expectedMeasureType === 'AREA' && layerCandidate.profile.total_area > 0) {
                    const geometryPrior = Math.min(0.2, Math.log10(layerCandidate.profile.total_area + 1) * 0.066);
                    currentConfidence = Math.min(1.0, currentConfidence + geometryPrior);
                }

                // ✅ FIX 3: WALL LAYER NAME BONUS
                if (isWallIntent) {
                    const layerLower = layerCandidate.layer_normalized;
                    const wallLayerKeywords = ['tabique', 'muro', 'wall', 'partition', 'muros'];
                    const hasWallInName = wallLayerKeywords.some(k => layerLower.includes(k));

                    if (hasWallInName) {
                        currentConfidence = Math.min(1.0, currentConfidence + 0.25);
                    }

                    const profile = layerCandidate.profile;
                    const hasTextEntities = profile.entity_types.has('TEXT') || profile.entity_types.has('MTEXT');
                    if (hasTextEntities && profile.total_length === 0) {
                        currentConfidence = currentConfidence * 0.6; // -40% penalty
                    }
                }

                // Phase 5: Spatial Matcher
                const zoneIntent = extractZoneIntent(excelItem.description);
                if (zoneIntent) {
                    const itemZone = matchedItem.zone_name;
                    if (itemZone) {
                        const intentNorm = zoneIntent.toUpperCase();
                        const itemNorm = itemZone.toUpperCase();
                        if (itemNorm.includes(intentNorm)) {
                            currentConfidence *= 1.5;
                            currentReason += ` | Zone Match (${zoneIntent})`;
                        } else {
                            currentConfidence *= 0.1;
                            currentReason += ` | Zone Mismatch (${itemZone} != ${zoneIntent})`;
                        }
                    } else {
                        currentConfidence *= 0.8;
                    }
                }

                // Type matching bonus
                const dominantType = layerCandidate.profile.has_area_support ? 'AREA'
                    : layerCandidate.profile.has_length_support ? 'LENGTH'
                        : layerCandidate.profile.has_block_support ? 'BLOCK' : 'UNKNOWN';

                if (typeMatches(dominantType as any, expectedType)) {
                    currentConfidence = Math.min(1.0, currentConfidence * 1.1);
                    currentReason += `Type-matched layer "${layerCandidate.layer}" (${(currentConfidence * 100).toFixed(0)}%)`;
                } else {
                    currentReason += `Matched layer "${layerCandidate.layer}" (${(currentConfidence * 100).toFixed(0)}%)`;
                }

                if (usedKeywordMapping) {
                    currentReason += ` | Keywords: [${keywordMatch.matchedKeywords.join(', ')}]`;
                }

                // Penalties
                const layerPenalty = getNonMeasurablePenalty(layerCandidate.layer_normalized, expectedMeasureType as 'AREA' | 'LENGTH' | 'BLOCK');
                if (layerPenalty > 0) {
                    currentConfidence *= (1 - layerPenalty);
                    currentReason += ` | Penalty: -${(layerPenalty * 100).toFixed(0)}%`;
                }

                // FIX 8.1: Horizontal vs Vertical Orientation Check
                // Prevent Floors (Horizontal) from matching Walls/Elevations (Length)
                const orientationResult = detectSurfaceOrientation(excelItem.description);
                const isHorizontalIntent = orientationResult.orientation === 'horizontal';

                // If Item is Horizontal (Floor/Ceiling) but Candidate is purely Length-based (no Area)
                // We penalize it because generating Area from Length * Height is only valid for Walls (Vertical)
                if (isHorizontalIntent && dominantType === 'LENGTH' && expectedMeasureType === 'AREA') {
                    // Strong penalty: Non-wall items should NOT use length fallback
                    currentConfidence *= 0.2;
                    currentReason += ` | Orientation Mismatch (Horizontal Item vs Length Layer)`;
                }

                // Conversly, if Vertical Intent but Area Only (unlikely but possible), slight boost? No.

                if (layerCandidate.layer_normalized === 'defpoints') {
                    currentConfidence *= 0.1;
                    currentReason += " | DEFPOINTS PENALTY";
                }

                // Add geometry info to reason
                const profile = layerCandidate.profile;
                if (profile) {
                    const geometryParts: string[] = [];
                    if (profile.total_area > 0) geometryParts.push(`${profile.total_area.toFixed(2)} m²`);
                    if (profile.total_length > 0) geometryParts.push(`${profile.total_length.toFixed(2)} m`);
                    if (profile.block_count > 0) geometryParts.push(`${profile.block_count} blocks`);
                    if (geometryParts.length > 0) currentReason += ` | Geometry: ${geometryParts.join(', ')}`;
                }

                evaluatedCandidates.push({
                    match,
                    confidence: currentConfidence,
                    reason: currentReason,
                    warnings: currentWarnings
                });
            }

            // Sort by confidence descending
            evaluatedCandidates.sort((a, b) => b.confidence - a.confidence);

            // Select best
            const best = evaluatedCandidates[0];

            // Set variables for downstream logic
            confidence = best.confidence;
            reason = best.reason;
            warnings.push(...best.warnings);

            if (confidence > 0.4) {
                bestMatch = [best.match.item.sampleItem];
                console.log(`[Matcher] ✅ Selected Best Match: "${best.match.item.layer}" (${(confidence * 100).toFixed(0)}%)`);
            } else {
                // Generate suggestions
                const itemsForSuggestions = evaluatedCandidates.slice(0, 3).map(r => ({
                    item: r.match.item.sampleItem,
                    score: 1 - r.confidence // Convert back to score for suggestion API
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

        // Calculate Qty (can be null if invariant violation)
        let qtyFinal: number | null = 0;
        let heightFactor: number | undefined = undefined;
        let methodDetail: string | undefined = undefined; // FIX 2: Track calculation method
        let evidenceTypeUsed: 'area' | 'length' | 'block' | 'text' | 'none' = 'none'; // P0.3: Track actual evidence type

        if (bestMatch.length > 0) {
            const match = bestMatch[0];
            const matchType = match.type.toUpperCase();

            // Phase 6 C): Full traceability default initialization
            let qtyRaw = match.value_si;

            // --- HOTFIX 3: Unit-Based Quantity Calculation ---
            // We use calcMethod to decide how to derive qty from CAD geometry

            if (calcMethod === 'COUNT') {
                // FIXED 11.5: Disable Text Match for Unit/Global Items to prevent "1112" count error
                const isUnitOrGlobal = ['un', 'gl', 'u'].includes(excelItem.unit?.toLowerCase() || '');
                const isTextLayer = match.type === 'text' || (match as any).layer_normalized?.toLowerCase().includes('text');

                if (isUnitOrGlobal && isTextLayer) {
                    console.log(`[Matcher] Blocked Text Match for Unit Item: ${excelItem.description} vs ${(match as any).layer_normalized}`);
                    qtyFinal = 0; // Force zero to avoid counting letters
                    (match as any).confidence = 'low';
                    reason = '⛔ Blocked: Cannot count Text for Unit/Global item';
                } else if (match.type === 'block' && match.value_area && (excelItem.unit === 'm2' || excelItem.unit === 'm²')) {
                    // FIX 11.3: If target is AREA and block has area, multiply!
                    qtyFinal = (match.value_si || 1) * match.value_area;
                    methodDetail = 'block_area_times_count';
                    reason += ` | Area derived from ${match.value_si} blocks * ${match.value_area.toFixed(2)}m²/each`;
                } else {
                    qtyFinal = match.type === 'block' ? (match.value_si || 1) : 0;
                }
                evidenceTypeUsed = match.type as 'area' | 'length' | 'block' | 'text'; // P0.3

                // P0.D: Check if block is generic/untrusted
                if (match.type === 'block') {
                    const blockClassification = classifyBlock(
                        match.name_raw || '',
                        match.layer_normalized
                    );

                    if (blockClassification.isGeneric) {
                        console.log(`  [Block Classifier] âš ï¸ Generic block detected: "${match.name_raw}" - ${blockClassification.reason}`);
                        confidence *= (1 - blockClassification.penaltyScore);
                        warnings.push(`Generic block: ${blockClassification.reason}`);

                        // Don't auto-approve generic blocks
                        if (!canAutoApproveBlock(blockClassification)) {
                            reason += ` | GENERIC BLOCK (requires review)`;
                        }
                    } else {
                        console.log(`  [Block Classifier] âœ… Trusted block: "${match.name_raw}" (${blockClassification.confidence})`);
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
                qtyFinal = match.value_si; // âœ… SI units (meters)
                evidenceTypeUsed = 'length'; // P0.3
            }

            else if (calcMethod === 'AREA') {
                // Phase 6 D): Wall/Tabique Logic (Length -> Area)
                // If evidence is length, check for wall intent
                if (match.type === 'length') {
                    // FIX 2: Use derived area calculator for intelligent height detection
                    const derivedResult = calculateDerivedArea(
                        match.value_si,
                        excelItem.description
                    );

                    if (derivedResult.canDerive) {
                        qtyFinal = derivedResult.area_m2;
                        heightFactor = derivedResult.height_m;
                        methodDetail = 'length_x_height';
                        evidenceTypeUsed = 'length';
                        reason += ` | ${derivedResult.reason}`;
                        console.log(`  [FIX 2] length_x_height: ${match.value_si.toFixed(2)}m Ã— ${heightFactor}m = ${qtyFinal?.toFixed(2)}mÂ²`);
                    } else {
                        // FIX 8.1: Block unsafe fallback for Horizontal items
                        if (derivedResult.orientation === 'horizontal') {
                            qtyFinal = 0; // Better to return 0 than fake wall area
                            reason += ` | âŒ Mismatch: Horizontal Item matched Length Layer (Requires Area/Hatch)`;
                            console.log(`  [Matcher] Blocked Length*Hz for Horizontal Item "${excelItem.description}"`);
                        } else {
                            // Phase 6 D): Default height fallback logic
                            // FIX 11.1: Validate with 3D analysis
                            if (shouldApplyWallFallback(match, excelItem)) {
                                heightFactor = 2.4;
                                qtyFinal = match.value_si * heightFactor;
                                methodDetail = 'length_x_height_default';
                                evidenceTypeUsed = 'length';
                                reason += ` | Derivada: Largo * 2.4m (default)`;
                            } else {
                                qtyFinal = 0; // Blocked
                                methodDetail = 'fallback_blocked_3d_horizontal';
                                reason += ` | ⛔ FALLBACK BLOCKED: 3D Horizontal Layer or Keyword`;
                            }
                        }
                    }
                }
                // Case A: Geometry is Area (HATCH/Polyline Region)
                else if (match.type === 'area') {
                    qtyFinal = match.value_si; // âœ… SI units (mÂ²)
                    methodDetail = 'direct_area';
                    evidenceTypeUsed = 'area'; // P0.3
                }
                // FIX: match.type is block or text - use layer profile's total_area instead
                else if (match.type === 'block' || match.type === 'text') {
                    // P0.3 FIX: When mÂ² items match to block/text layers, check if layer has area geometry
                    const layerProfile = result.length > 0 ? result[0].item.profile : null;

                    if (layerProfile && layerProfile.total_area > 0) {
                        // Layer has area geometry - use it instead of block count
                        qtyFinal = layerProfile.total_area;
                        methodDetail = 'profile_area_from_block_layer';
                        evidenceTypeUsed = 'area';
                        reason += ` | âš ï¸ WARN: Layer matched via block but using layer's total_area (${layerProfile.total_area.toFixed(2)} mÂ²)`;
                        console.log(`  [FIX] Block layer but has area geometry: using profile.total_area = ${layerProfile.total_area.toFixed(2)} mÂ²`);
                    } else if (layerProfile && layerProfile.total_length > 0 && isWallIntent) {
                        // Layer has length but no area, and it's a WALL item - use length Ã— height
                        heightFactor = 2.4;
                        qtyFinal = layerProfile.total_length * heightFactor;
                        methodDetail = 'profile_length_x_height_from_block_layer';
                        evidenceTypeUsed = 'length';
                        reason += ` | âš ï¸ WALL: Layer matched via block but using length Ã— 2.4m = ${qtyFinal?.toFixed(2)} mÂ²`;
                        console.log(`  [FIX] Block layer with WALL intent: using profile.total_length Ã— 2.4 = ${qtyFinal?.toFixed(2)} mÂ²`);
                        console.log(`  [FIX] Block layer with WALL intent: using profile.total_length Ã— 2.4 = ${qtyFinal?.toFixed(2)} mÂ²`);
                    } else {
                        // P0.3: No area/length geometry available - this is INVALID for mÂ² items
                        qtyFinal = null; // Mark as null to trigger pending status
                        methodDetail = 'invalid_type_for_area';
                        evidenceTypeUsed = match.type as 'block' | 'text' | 'area' | 'length';
                        reason += ` | â Œ ERROR: mÂ² item matched to ${match.type} layer with no area/length geometry`;
                        console.log(`  [ERROR] mÂ² item matched to ${match.type} type with no area geometry - setting qtyFinal = null`);
                    }
                }
                else {
                    // Unknown type
                    qtyFinal = 0;
                    methodDetail = 'invalid_type_for_area';
                    evidenceTypeUsed = match.type as 'block' | 'text' | 'area' | 'length'; // P0.3: Track invalid type
                }
            }

            else if (calcMethod === 'VOLUME') {
                // Naive implementation: Area * Thickness
                const thickness = 0.1; // 10cm default
                qtyFinal = match.value_si * (match.type === 'length' ? 2.4 : 1) * thickness;
            }

            else {
                // Global or Unknown
                qtyFinal = match.value_si;  // âœ… SI units
            }
        } else {
            // Keep existing Excel qty if present for "Manual" verification
            if (excelItem.qty !== null) qtyFinal = excelItem.qty;
        }

        // FIX 8.2: Spatial Zone Override (Highest Priority for mÂ² items with failed/missing geometries)
        // If standard geometry match failed (e.g. Horizontal item had no Hatch), use the Zone Area.
        if (expectedMeasureType === 'AREA' && (!qtyFinal || qtyFinal <= 0.1)) {
            const zoneIntent = extractZoneIntent(excelItem.description);
            if (zoneIntent) {
                const zoneKey = zoneIntent.toUpperCase();
                // Soft match zone registry keys (e.g. "BODEGA" matches "BODEGAS")?
                // For now, assume exact match or simple inclusion.
                // Let's try direct lookup first.
                if (zoneRegistry[zoneKey] && zoneRegistry[zoneKey] > 0) {
                    qtyFinal = zoneRegistry[zoneKey];
                    reason += ` | âœ… SPATIAL OVERRIDE: Using Zone "${zoneIntent}" Area`;
                    methodDetail = 'spatial_zone_area';
                    evidenceTypeUsed = 'area';
                    confidence = 0.95; // High confidence if we found the exact zone
                    console.log(`  [Spatial] Overriding "${excelItem.description}" with Zone Area: ${qtyFinal.toFixed(2)} mÂ²`);
                }
            }
        }


        // FIX 9.2: Ensure methodDetail is NEVER null for normal items
        // If we got here without a methodDetail, assign one based on expectedMeasureType
        if (!methodDetail && bestMatch.length > 0) {
            if (expectedMeasureType === 'AREA') {
                methodDetail = 'direct_area';
                evidenceTypeUsed = 'area';
            } else if (expectedMeasureType === 'LENGTH') {
                methodDetail = 'direct_length';
                evidenceTypeUsed = 'length';
            } else if (expectedMeasureType === 'BLOCK') {
                methodDetail = 'count_blocks';
                evidenceTypeUsed = 'block';
            }
            console.log(`[Fix 9.2] Assigned default methodDetail: ${methodDetail}`);
        }

        // âœ… SANITY CHECK: Detect suspicious values
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

        // âœ… P0.3: INVARIANT ENFORCEMENT
        // The evidence type MUST match the expected measure type
        // mÂ² MUST come from AREA geometry (or LENGTHâ†’AREA if WALL)
        // un MUST come from BLOCK geometry
        // ml/m MUST come from LENGTH geometry
        let invariantViolation = false;
        let invariantReason = '';

        if (bestMatch.length > 0) {
            const match = bestMatch[0];
            // FIX 9.1b: Use LAYER NAME for profile lookup (object reference comparison fails)
            // The sampleItem can be TEXT even if the layer has real AREA geometry

            // DEBUG: Log allResults content
            console.log(`[Fix 9.1b] DEBUG: allResults has ${allResults.length} items`);
            console.log(`[Fix 9.1b] DEBUG: Looking for layer "${match.layer_normalized}" in allResults`);
            console.log(`[Fix 9.1b] DEBUG: allResults layers: [${allResults.map(r => r.item.layer_normalized).join(', ')}]`);

            const layerProfile = allResults.find(r => r.item.layer_normalized === match.layer_normalized)?.item.profile;

            // DEBUG: Log profile lookup result
            console.log(`[Fix 9.1b] Layer "${match.layer_normalized}" - Profile found: ${!!layerProfile}, sampleItem.type: ${match.type}`);
            if (layerProfile) {
                console.log(`[Fix 9.1b] Profile: has_area=${layerProfile.has_area_support}, has_length=${layerProfile.has_length_support}, has_block=${layerProfile.has_block_support}`);
            }

            const profileBasedType = layerProfile
                ? (layerProfile.has_area_support ? 'AREA'
                    : layerProfile.has_length_support ? 'LENGTH'
                        : layerProfile.has_block_support ? 'BLOCK'
                            : match.type.toUpperCase())
                : match.type.toUpperCase();

            const matchType = profileBasedType;
            console.log(`[Fix 9.1] Profile-based type: ${matchType} (sampleItem was: ${match.type})`);

            // Rule 1: mÂ² requires AREA (or LENGTH for walls)
            if (expectedMeasureType === 'AREA') {
                if (matchType === 'TEXT' || matchType === 'BLOCK') {
                    invariantViolation = true;
                    invariantReason = `mÂ² cannot use ${matchType} as evidence (requires AREA or LENGTH for walls)`;
                }
                // LENGTH is OK for walls - height factor will be applied
            }

            // Rule 2: un requires BLOCK
            if (expectedMeasureType === 'BLOCK') {
                if (matchType !== 'BLOCK') {
                    invariantViolation = true;
                    invariantReason = `un (count) requires BLOCK as evidence, got ${matchType}`;
                }
            }

            // Rule 3: ml/m requires LENGTH
            if (expectedMeasureType === 'LENGTH') {
                if (matchType === 'TEXT' || matchType === 'BLOCK') {
                    invariantViolation = true;
                    invariantReason = `m/ml requires LENGTH as evidence, got ${matchType}`;
                }
                // AREA could be used for perimeter - allow for now
            }

            if (invariantViolation) {
                console.warn(`[Matcher] P0.3 Invariant Violation: ${invariantReason}`);
                warnings.push(`Invariant: ${invariantReason}`);
                // P0 FIX 1: Force pending_type_mismatch - NEVER approve mÂ² with TEXT/BLOCK
                confidence = 0; // Zero confidence forces non-approved
                qtyFinal = null; // Nullify the quantity - it's invalid
            }
        }

        // Determine refined status (FIX E.1/E.2: pass heightFactor for wall surface check)
        let status = determineStatus(confidence, bestMatch, expectedType, qtyFinal, heightFactor);

        // P0 FIX 1: Override status to pending_type_mismatch if invariant violated
        if (invariantViolation) {
            status = 'pending_type_mismatch';
        }

        // ========== P0.1: HARD APPROVAL GATE FOR mÂ² ==========
        // mÂ² can ONLY be approved if:
        // (evidenceTypeUsed=area AND methodDetail=direct_area) OR
        // (evidenceTypeUsed=length AND methodDetail in [length_x_height, length_x_height_default])
        const unitLower = excelItem.unit?.toLowerCase() || '';
        const isM2Unit = unitLower.includes('m2') || unitLower === 'mÂ²';

        if (isM2Unit && status === 'approved') {
            const validAreaMethod = evidenceTypeUsed === 'area' && methodDetail === 'direct_area';
            const validLengthMethod = evidenceTypeUsed === 'length' &&
                (methodDetail === 'length_x_height' || methodDetail === 'length_x_height_default');

            if (!validAreaMethod && !validLengthMethod) {
                // P0.1: HARD REJECTION - cannot approve mÂ² with invalid evidence
                console.warn(`[P0.1] âŒ Hard rejection for mÂ²: evidenceType=${evidenceTypeUsed}, method=${methodDetail}`);
                status = 'pending_type_mismatch';
                warnings.push('TYPE_MISMATCH_M2');
                qtyFinal = null;
            }
        }

        // ========== P0.2: WALL items need LENGTH layers ==========
        if (isWallIntent && isM2Unit && status === 'approved') {
            if (evidenceTypeUsed !== 'length' || !methodDetail?.includes('length_x_height')) {
                console.warn(`[P0.2] âŒ WALL item approved without length_x_height: ${evidenceTypeUsed}/${methodDetail}`);
                status = 'pending_no_length_for_wall';
                warnings.push('WALL_NEEDS_LENGTH');
                qtyFinal = null;
            }
        }

        // ========== P0.4: SANITY CHECK for WALL mÂ² > 500 ==========
        if (isWallIntent && isM2Unit && qtyFinal !== null && qtyFinal > 500) {
            console.warn(`[P0.4] âš ï¸ WALL mÂ² sanity check failed: ${qtyFinal.toFixed(0)}mÂ² > 500mÂ² threshold`);
            status = 'pending_sanity_check';
            warnings.push('M2_TOO_LARGE_FOR_WALL');
        }

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
                console.log(`  âŒ ${failure.gate.name}: ${failure.result.message}`);
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

        // ========== STEP B: FINAL ENFORCEMENT ==========
        // Phase 8 REMOVED: Previously nullified qtyFinal for pending items, which broke derived area
        // Now we KEEP qtyFinal values even for pending items to show calculated values in UI
        // The status field already indicates that user review is needed

        // Log warning if pending but has qty (for debugging) - but DON'T nullify
        if (status.startsWith('pending') && qtyFinal !== null) {
            console.log(`[Phase 8] ℹ️ Pending status with calculated qty: ${qtyFinal?.toFixed(2)} (keeping value)`);
        }

        // Also ensure calcMethod is set if we have a qty
        if (qtyFinal !== null && (!methodDetail || methodDetail === 'null')) {
            console.warn(`[Phase 8] calcMethod missing for qty ${qtyFinal}, status: ${status}`);
            // Don't nullify, but flag
            warnings.push('CALC_METHOD_MISSING');
        }

        // FIX 9.3b: FINAL PROFILE-BASED GATE
        // Even if gates above passed (using sampleItem), verify with actual layer profile
        if (bestMatch.length > 0 && qtyFinal !== null) {
            // FIX 9.3b: Use layer_normalized for lookup, not object reference
            const matchedLayerCandidate = allResults.find(r => r.item.layer_normalized === bestMatch[0].layer_normalized)?.item;
            if (matchedLayerCandidate) {
                const profile = matchedLayerCandidate.profile;
                const unitLower = excelItem.unit?.toLowerCase() || '';
                const isM2 = unitLower.includes('m2') || unitLower === 'mÂ²';

                // For mÂ² items: layer MUST have area_support OR length_support (for walls)
                if (isM2) {
                    const hasValidSupport = profile.has_area_support || profile.has_length_support;
                    if (!hasValidSupport) {
                        console.warn(`[Fix 9.3] âŒ mÂ² item but layer "${matchedLayerCandidate.layer}" has no AREA/LENGTH support`);
                        status = 'pending_type_mismatch';
                        qtyFinal = null;
                        warnings.push('LAYER_NO_AREA_OR_LENGTH');
                    }
                }
            }
        }

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
            // NEW: Calculation method (use computed methodDetail if available)
            calc_method: calcMethod,
            method_detail: methodDetail || calcMethodResult.method_detail,
            discipline: excelDiscipline,

            // Debug Outputs (Phase 1 improvements)
            expected_measure_type: expectedMeasureType,

            // P1.5: Subtype classification
            excel_subtype: subtypeClassification.subtype,
            excel_subtype_confidence: subtypeClassification.confidence,
            excel_subtype_keywords: subtypeClassification.matched_keywords,

            top_candidates: allResults.slice(0, 5).map(r => ({
                layer: r.item.layer,
                score_semantic: r.score || 0,
                score_type: 0,
                qty_if_used: r.item.sampleItem.value_si || 0
            })), // Simplified for now
            hard_reject_reasons: hardRejectReasons.length > 0 ? hardRejectReasons : undefined,
            warnings: warnings.length > 0 ? warnings : undefined
        } as unknown as StagingRow;
    });

    console.log("[DEBUG] matchItems returning rows:", rows ? rows.length : "undefined");
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
            reasons.push(`âš ï¸ Type mismatch: found ${item.type}, expected ${expectedType}`);
        }

        // --- HOTFIX 5: Layer 0 Warning ---
        if (item.layer_normalized === '0' || item.layer_normalized === 'defpoints') {
            reasons.push(`âš ï¸ Layer 0/Defpoints (High Risk)`);
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
 * FIX E.1/E.2: Added new status types for better user guidance
 */
function determineStatus(
    confidence: number,
    bestMatch: ItemDetectado[],
    expectedType: ExpectedType,
    qtyFinal: number | null,
    heightFactor?: number | null
): StagingRow['status'] {
    // No match found
    if (bestMatch.length === 0) {
        // FIX E.1: If expecting AREA but no match, user needs to pick layer manually
        if (expectedType === 'AREA') {
            return 'pending_needs_layer_pick';
        }
        return expectedType === 'GLOBAL' ? 'pending_semantics' : 'pending_no_match';
    }

    const match = bestMatch[0];

    // FIX E.2: If AREA expected but only LENGTH geometry, and no height factor derived
    if (expectedType === 'AREA' && match.type === 'length') {
        // Check if we're using a default/assumed height (not properly derived)
        if (!heightFactor || heightFactor === 2.4) {
            // Using default height - user should confirm
            return 'pending_needs_height';
        }
    }

    // No geometry extracted
    if (qtyFinal === null || qtyFinal === 0) {
        // FIX E.1: If expecting AREA but qty is 0, user needs to pick layer
        if (expectedType === 'AREA') {
            return 'pending_needs_layer_pick';
        }
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
        // FIX E.1/E.2: New status reasons
        case 'pending_needs_layer_pick':
            return 'No suitable area layers found - please select a layer manually';
        case 'pending_needs_height':
            return 'Wall/surface requires height to calculate mÂ² - please configure height or approve default (2.4m)';
        // P0 FIX 1: Type mismatch status
        case 'pending_type_mismatch':
            return 'Evidence type does not match unit - mÂ² requires AREA geometry (or LENGTH for walls), un requires BLOCK';
        // P0.2: WALL needs length
        case 'pending_no_length_for_wall':
            return 'WALL item requires LENGTH geometry (lines/polylines) to calculate mÂ² via length Ã— height';
        // P0.4: Sanity check failed
        case 'pending_sanity_check':
            return 'Quantity exceeds sanity threshold - WALL mÂ² > 500 is suspicious';
        default:
            return 'Unknown status';
    }
}

/**
 * P1.9: Build deterministic match reason from actual data
 * No free-text that could contradict evidence
 */
export function buildDeterministicReason(params: {
    expectedType: string;
    matchedLayer: string;
    evidenceType: string;
    layerArea?: number;
    layerLength?: number;
    confidence: number;
    keywords?: string[];
    penalties?: string[];
    formula?: string;
}): string {
    const parts: string[] = [];

    // Expected vs Evidence
    parts.push(`expected=${params.expectedType}`);
    parts.push(`evidence=${params.evidenceType}`);
    parts.push(`layer="${params.matchedLayer}"`);

    // Geometry metrics
    if (params.layerArea && params.layerArea > 0) {
        parts.push(`area=${params.layerArea.toFixed(1)}mÂ²`);
    }
    if (params.layerLength && params.layerLength > 0) {
        parts.push(`length=${params.layerLength.toFixed(1)}m`);
    }

    // Confidence
    parts.push(`confidence=${(params.confidence * 100).toFixed(0)}%`);

    // Keywords used
    if (params.keywords && params.keywords.length > 0) {
        parts.push(`keywords=[${params.keywords.join(',')}]`);
    }

    // Penalties applied
    if (params.penalties && params.penalties.length > 0) {
        parts.push(`penalties=[${params.penalties.join(',')}]`);
    }

    // Formula used
    if (params.formula) {
        parts.push(`formula=${params.formula}`);
    }

    return parts.join(' | ');
}

