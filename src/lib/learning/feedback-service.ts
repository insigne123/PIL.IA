import { supabaseAdmin } from '@/lib/supabase';
import { MatchingFeedback, ItemDetectado } from '@/types';

export class FeedbackService {

    /**
     * Finds a high-confidence historical match for a given description
     */
    static async findHistoricalMatch(description: string, unit: string): Promise<{
        cadItem: Partial<ItemDetectado>;
        confidence: number;
        source: 'manual_correction' | 'verified_learning';
    } | null> {
        if (!supabaseAdmin) return null;

        // Normalize inputs
        const descClean = description.trim();
        if (!descClean) return null;

        // Query Feedback Table
        // We look for "accept" or "modify" corrections on similar text
        const { data, error } = await supabaseAdmin
            .from('matching_feedback')
            .select('*')
            .eq('excel_item_text', descClean) // Exact match for MVP
            // .eq('excel_unit', unit) // Optional: strict unit check?
            .in('correction_type', ['accept', 'modify', 'manual'])
            .order('created_at', { ascending: false })
            .limit(1);

        if (error || !data || data.length === 0) return null;

        const feedback = data[0] as MatchingFeedback;

        // If user manually corrected it, we trust it highly
        if (feedback.suggestedMatchId) {
            // We need to fetch what that MatchId represents... 
            // Problem: MatchId is specific to a run. We need the "Layer Name" or "Block Name" stored.
            // The current Feedback interface might store ID, but we really need the *content* of the match.

            // Assumption: The feedback might need to store the target layer/block name, not just ID.
            // If `matching_feedback` only stores IDs, we can't learn across batches easily unless we look up the old batch.
            // Let's assume for now we can't learn from ID alone without lookup.

            // However, let's check if we can store/retrieve "Target Layer" in feedback.
            // If not, we return null for now until schema is updated.
            return null;
        }

        return null;
    }

    /**
     * Records feedback (placeholder for future write operations)
     */
    static async recordFeedback(feedback: MatchingFeedback) {
        if (!supabaseAdmin) return;
        await supabaseAdmin.from('matching_feedback').insert(feedback);
    }
}
