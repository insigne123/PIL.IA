/**
 * Learning System
 * 
 * P2.3: Stores and reuses user-approved Excel→DXF mappings
 * Improves matching accuracy over time by learning from user selections
 */

import { supabase } from '@/lib/supabase';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface LearnedMapping {
    id: string;
    user_id: string;
    excel_description: string;
    excel_unit: string;
    excel_normalized: string;
    dxf_layer: string;
    dxf_type: string;
    confidence: number;
    times_used: number;
    last_used_at: string;
    created_at: string;
    discipline?: string;
    project_type?: string;
    excel_subtype?: string;
}

export interface SaveMappingParams {
    userId: string;
    excelDescription: string;
    excelUnit: string;
    dxfLayer: string;
    dxfType: string;
    confidence: number;
    discipline?: string;
    excelSubtype?: string;
}

// ============================================================================
// NORMALIZATION
// ============================================================================

/**
 * Normalize text for learning/matching
 * Removes accents, special chars, and normalizes whitespace
 */
export function normalizeForLearning(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove accents
        .replace(/[^a-z0-9\s]/g, '') // Remove special chars
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
}

// ============================================================================
// SAVE MAPPING
// ============================================================================

/**
 * Save a user-approved mapping to the database
 * If mapping already exists, increments usage count
 */
export async function saveMapping(params: SaveMappingParams): Promise<{
    data: LearnedMapping | null;
    error: Error | null;
}> {
    try {
        const normalized = normalizeForLearning(params.excelDescription);

        // Try to insert, on conflict increment usage
        const { data, error } = await supabase
            .from('learned_mappings')
            .upsert({
                user_id: params.userId,
                excel_description: params.excelDescription,
                excel_unit: params.excelUnit,
                excel_normalized: normalized,
                dxf_layer: params.dxfLayer,
                dxf_type: params.dxfType,
                confidence: params.confidence,
                discipline: params.discipline,
                excel_subtype: params.excelSubtype,
                last_used_at: new Date().toISOString()
            }, {
                onConflict: 'user_id,excel_normalized,dxf_layer',
                ignoreDuplicates: false
            })
            .select()
            .single();

        if (error) {
            console.error('[Learning] Error saving mapping:', error);
            return { data: null, error: new Error(error.message) };
        }

        // Increment usage count if it already existed
        if (data) {
            await supabase.rpc('increment_mapping_usage', { mapping_id: data.id });
        }

        console.log(`[Learning] ✅ Saved mapping: "${params.excelDescription}" → "${params.dxfLayer}"`);

        return { data, error: null };
    } catch (err) {
        console.error('[Learning] Exception saving mapping:', err);
        return { data: null, error: err as Error };
    }
}

// ============================================================================
// RETRIEVE MAPPINGS
// ============================================================================

/**
 * Get learned mappings for an Excel description
 * Returns top matches ordered by usage and confidence
 */
export async function getLearnedMappings(
    userId: string,
    excelDescription: string,
    options: {
        discipline?: string;
        limit?: number;
    } = {}
): Promise<LearnedMapping[]> {
    try {
        const normalized = normalizeForLearning(excelDescription);
        const limit = options.limit || 5;

        // Build query
        let query = supabase
            .from('learned_mappings')
            .select('*')
            .eq('user_id', userId);

        // Exact match first, then fuzzy
        query = query.or(`excel_normalized.eq.${normalized},excel_normalized.ilike.%${normalized}%`);

        // Filter by discipline if provided
        if (options.discipline) {
            query = query.eq('discipline', options.discipline);
        }

        // Order by usage and confidence
        query = query
            .order('times_used', { ascending: false })
            .order('confidence', { ascending: false })
            .limit(limit);

        const { data, error } = await query;

        if (error) {
            console.error('[Learning] Error fetching mappings:', error);
            return [];
        }

        if (data && data.length > 0) {
            console.log(`[Learning] Found ${data.length} learned mappings for "${excelDescription}"`);
            data.forEach(m => {
                console.log(`  • "${m.dxf_layer}" (used ${m.times_used}x, confidence: ${(m.confidence * 100).toFixed(0)}%)`);
            });
        }

        return data || [];
    } catch (err) {
        console.error('[Learning] Exception fetching mappings:', err);
        return [];
    }
}

// ============================================================================
// BATCH OPERATIONS
// ============================================================================

/**
 * Save multiple mappings at once (e.g., after batch approval)
 */
export async function saveMappingsBatch(
    mappings: SaveMappingParams[]
): Promise<{
    success: number;
    failed: number;
}> {
    let success = 0;
    let failed = 0;

    for (const mapping of mappings) {
        const result = await saveMapping(mapping);
        if (result.data) {
            success++;
        } else {
            failed++;
        }
    }

    console.log(`[Learning] Batch save: ${success} succeeded, ${failed} failed`);

    return { success, failed };
}

/**
 * Get all mappings for a user (for export/analysis)
 */
export async function getAllUserMappings(
    userId: string
): Promise<LearnedMapping[]> {
    try {
        const { data, error } = await supabase
            .from('learned_mappings')
            .select('*')
            .eq('user_id', userId)
            .order('times_used', { ascending: false });

        if (error) {
            console.error('[Learning] Error fetching all mappings:', error);
            return [];
        }

        return data || [];
    } catch (err) {
        console.error('[Learning] Exception fetching all mappings:', err);
        return [];
    }
}

// ============================================================================
// STATISTICS
// ============================================================================

/**
 * Get learning statistics for a user
 */
export async function getLearningStats(userId: string): Promise<{
    totalMappings: number;
    totalUsage: number;
    topLayers: Array<{ layer: string; count: number }>;
    byDiscipline: Record<string, number>;
}> {
    try {
        const { data, error } = await supabase
            .from('learned_mappings')
            .select('*')
            .eq('user_id', userId);

        if (error || !data) {
            return {
                totalMappings: 0,
                totalUsage: 0,
                topLayers: [],
                byDiscipline: {}
            };
        }

        const totalMappings = data.length;
        const totalUsage = data.reduce((sum: number, m) => sum + m.times_used, 0);

        // Top layers by usage
        const layerCounts = new Map<string, number>();
        data.forEach(m => {
            layerCounts.set(m.dxf_layer, (layerCounts.get(m.dxf_layer) || 0) + m.times_used);
        });

        const topLayers = Array.from(layerCounts.entries())
            .map(([layer, count]) => ({ layer, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        // By discipline
        const byDiscipline: Record<string, number> = {};
        data.forEach(m => {
            if (m.discipline) {
                byDiscipline[m.discipline] = (byDiscipline[m.discipline] || 0) + 1;
            }
        });

        return {
            totalMappings,
            totalUsage,
            topLayers,
            byDiscipline
        };
    } catch (err) {
        console.error('[Learning] Exception getting stats:', err);
        return {
            totalMappings: 0,
            totalUsage: 0,
            topLayers: [],
            byDiscipline: {}
        };
    }
}

// ============================================================================
// CLEANUP
// ============================================================================

/**
 * Delete old unused mappings (optional maintenance)
 */
export async function cleanupOldMappings(
    userId: string,
    daysOld: number = 180
): Promise<number> {
    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysOld);

        const { data, error } = await supabase
            .from('learned_mappings')
            .delete()
            .eq('user_id', userId)
            .eq('times_used', 1) // Only used once
            .lt('last_used_at', cutoffDate.toISOString())
            .select();

        if (error) {
            console.error('[Learning] Error cleaning up mappings:', error);
            return 0;
        }

        const deleted = data?.length || 0;
        console.log(`[Learning] Cleaned up ${deleted} old mappings`);

        return deleted;
    } catch (err) {
        console.error('[Learning] Exception cleaning up:', err);
        return 0;
    }
}
