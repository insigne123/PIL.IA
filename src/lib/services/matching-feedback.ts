// Service for capturing and utilizing matching feedback

import { supabase } from '@/lib/supabase';
import type { MatchingFeedback, HistoricalMatch, LearningDataset } from '@/types/improvements';
import type { StagingRow, ItemDetectado } from '@/types';

export class MatchingFeedbackService {
    private supabase = supabase;

    /**
     * Record user correction to a match
     */
    async recordFeedback(
        batchId: string,
        stagingRow: StagingRow,
        correctionType: 'accept' | 'reject' | 'modify' | 'manual',
        actualMatchId?: string
    ): Promise<void> {
        const feedback: Partial<MatchingFeedback> = {
            batchId,
            excelItemText: stagingRow.excel_item_text,
            excelUnit: stagingRow.excel_unit,
            suggestedMatchId: stagingRow.source_items?.[0]?.id,
            suggestedConfidence: stagingRow.match_confidence,
            actualMatchId,
            correctionType,
            userId: (await this.supabase.auth.getUser()).data.user?.id || 'unknown',
        };

        const { error } = await this.supabase
            .from('matching_feedback')
            .insert(feedback);

        if (error) {
            console.error('Failed to record feedback:', error);
            throw error;
        }
    }

    /**
     * Get similar historical matches for an item
     */
    async getSimilarMatches(
        excelText: string,
        limit: number = 5
    ): Promise<HistoricalMatch[]> {
        // Normalize the text for better matching
        const normalized = this.normalizeText(excelText);

        const { data, error } = await this.supabase
            .from('matching_feedback')
            .select('excel_item_text, actual_match_id, suggested_confidence')
            .eq('correction_type', 'accept')
            .ilike('excel_item_text', `%${normalized}%`)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            console.error('Failed to get similar matches:', error);
            return [];
        }

        // Group by actual_match_id and count frequency
        const grouped = data.reduce((acc, item) => {
            const key = item.actual_match_id || 'unknown';
            if (!acc[key]) {
                acc[key] = {
                    excelText: item.excel_item_text,
                    cadItem: null as any, // Would need to fetch from staging_rows
                    confidence: item.suggested_confidence || 0,
                    frequency: 0,
                    lastUsed: new Date().toISOString(),
                };
            }
            acc[key].frequency++;
            return acc;
        }, {} as Record<string, HistoricalMatch>);

        return Object.values(grouped).sort((a, b) => b.frequency - a.frequency);
    }

    /**
     * Get learning dataset for a batch or user
     */
    async getLearningDataset(
        batchId?: string,
        userId?: string
    ): Promise<LearningDataset> {
        let query = this.supabase
            .from('matching_feedback')
            .select('*')
            .eq('correction_type', 'accept');

        if (batchId) {
            query = query.eq('batch_id', batchId);
        }
        if (userId) {
            query = query.eq('user_id', userId);
        }

        const { data, error } = await query;

        if (error || !data) {
            return {
                examples: [],
                metadata: {
                    totalExamples: 0,
                    avgConfidence: 0,
                    dateRange: [new Date().toISOString(), new Date().toISOString()],
                },
            };
        }

        const examples = data.map((item) => ({
            input: item.excel_item_text,
            output: item.actual_match_id || '',
            confidence: item.suggested_confidence || 0,
        }));

        const avgConfidence =
            examples.reduce((sum, ex) => sum + ex.confidence, 0) / examples.length;

        const dates = data.map((item) => new Date(item.created_at).getTime());
        const dateRange: [string, string] = [
            new Date(Math.min(...dates)).toISOString(),
            new Date(Math.max(...dates)).toISOString(),
        ];

        return {
            examples,
            metadata: {
                totalExamples: examples.length,
                avgConfidence,
                dateRange,
            },
        };
    }

    /**
     * Calculate matching accuracy for a batch
     */
    async calculateAccuracy(batchId: string): Promise<number> {
        const { data, error } = await this.supabase
            .from('matching_feedback')
            .select('correction_type')
            .eq('batch_id', batchId);

        if (error || !data || data.length === 0) {
            return 0;
        }

        const accepted = data.filter((item) => item.correction_type === 'accept').length;
        return (accepted / data.length) * 100;
    }

    /**
     * Normalize text for better matching
     */
    private normalizeText(text: string): string {
        return text
            .toLowerCase()
            .trim()
            .replace(/\s+/g, ' ') // Multiple spaces to single
            .replace(/[áàäâ]/g, 'a')
            .replace(/[éèëê]/g, 'e')
            .replace(/[íìïî]/g, 'i')
            .replace(/[óòöô]/g, 'o')
            .replace(/[úùüû]/g, 'u')
            .replace(/ñ/g, 'n');
    }
}

export const matchingFeedbackService = new MatchingFeedbackService();
