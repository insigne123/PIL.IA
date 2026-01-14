/**
 * Smart geometry evaluation system
 * Replaces hard 0.5m threshold with intelligent category-based evaluation
 */

import { type LayerProfile } from './layer-profiling';

export interface GeometryEvaluation {
    valid: boolean;
    suspect: boolean;
    reason: string;
    threshold_used: number;
}

/**
 * Evaluate geometry based on context and layer characteristics
 */
export function evaluateGeometry(
    lengthM: number,
    layerProfile: LayerProfile | undefined,
    isOnlyCandidate: boolean,
    calcMethod?: 'COUNT' | 'LENGTH' | 'AREA' | 'GLOBAL'
): GeometryEvaluation {

    // GLOBAL items don't need geometry
    if (calcMethod === 'GLOBAL') {
        return {
            valid: true,
            suspect: false,
            reason: 'Global item - no geometry required',
            threshold_used: 0
        };
    }

    // Determine threshold based on layer characteristics
    let threshold = 0.5; // Default
    let category = 'standard';

    if (layerProfile) {
        // Real infrastructure layers: lower threshold
        if (layerProfile.isLikelyAnnotation === false &&
            layerProfile.lengthDistribution.p50 > 1.0) {
            threshold = 0.10; // 10cm for real infrastructure
            category = 'infrastructure';
        }
        // Mixed layers: medium threshold
        else if (!layerProfile.isLikelyAnnotation &&
            layerProfile.shortSegmentRatio < 0.5) {
            threshold = 0.25; // 25cm for mixed content
            category = 'mixed';
        }
    }

    // Special case: LENGTH calc method with infrastructure keywords
    if (calcMethod === 'LENGTH' && threshold > 0.10) {
        threshold = 0.10;
        category = 'length_required';
    }

    // Evaluation logic

    // Case 1: Clearly valid
    if (lengthM >= threshold) {
        return {
            valid: true,
            suspect: false,
            reason: `Length ${lengthM.toFixed(3)}m above ${category} threshold (${threshold}m)`,
            threshold_used: threshold
        };
    }

    // Case 2: Only candidate - don't reject automatically
    if (isOnlyCandidate && lengthM >= 0.01) {
        return {
            valid: true,
            suspect: true,
            reason: `Only candidate - length ${lengthM.toFixed(3)}m below threshold (${threshold}m) but not rejected`,
            threshold_used: threshold
        };
    }

    // Case 3: Very small but in infrastructure layer - suspect
    if (category === 'infrastructure' && lengthM >= 0.05) {
        return {
            valid: true,
            suspect: true,
            reason: `Infrastructure layer - length ${lengthM.toFixed(3)}m marginally below threshold (${threshold}m)`,
            threshold_used: threshold
        };
    }

    // Case 4: Below threshold - invalid
    return {
        valid: false,
        suspect: false,
        reason: `Length ${lengthM.toFixed(3)}m below ${category} threshold (${threshold}m)`,
        threshold_used: threshold
    };
}

/**
 * Batch evaluate multiple geometries
 */
export function batchEvaluateGeometry(
    items: Array<{
        lengthM: number;
        layerProfile?: LayerProfile;
        isOnlyCandidate: boolean;
        calcMethod?: 'COUNT' | 'LENGTH' | 'AREA' | 'GLOBAL';
    }>
): GeometryEvaluation[] {
    return items.map(item =>
        evaluateGeometry(
            item.lengthM,
            item.layerProfile,
            item.isOnlyCandidate,
            item.calcMethod
        )
    );
}

/**
 * Get statistics about geometry evaluations
 */
export function getEvaluationStats(evaluations: GeometryEvaluation[]): {
    valid: number;
    invalid: number;
    suspect: number;
    avgThreshold: number;
} {
    let valid = 0;
    let invalid = 0;
    let suspect = 0;
    let totalThreshold = 0;

    for (const evaluation of evaluations) {
        if (evaluation.valid) valid++;
        else invalid++;
        if (evaluation.suspect) suspect++;
        totalThreshold += evaluation.threshold_used;
    }

    return {
        valid,
        invalid,
        suspect,
        avgThreshold: evaluations.length > 0 ? totalThreshold / evaluations.length : 0
    };
}

/**
 * Determine if an item should be marked as suspect_geometry
 */
export function shouldMarkSuspect(
    evaluation: GeometryEvaluation,
    confidence: number
): boolean {
    // Mark as suspect if:
    // 1. Evaluation flagged it as suspect
    // 2. Valid but with low confidence and near threshold
    return evaluation.suspect ||
        (evaluation.valid && confidence < 0.5);
}

/**
 * Get user-friendly explanation of geometry evaluation
 */
export function getEvaluationExplanation(evaluation: GeometryEvaluation): string {
    if (evaluation.suspect) {
        return `⚠️ Geometría sospechosa: ${evaluation.reason}`;
    }
    if (!evaluation.valid) {
        return `❌ Geometría insuficiente: ${evaluation.reason}`;
    }
    return `✅ Geometría válida: ${evaluation.reason}`;
}
