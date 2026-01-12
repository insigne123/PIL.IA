// Service for tracking and reporting batch metrics

import { supabase } from '@/lib/supabase';
import type { BatchMetrics, MetricsSummary, TimeSeries, Alert } from '@/types/improvements';

export class MetricsService {
    private supabase = supabase;

    /**
     * Initialize metrics for a new batch
     */
    async initializeMetrics(batchId: string, totalItems: number): Promise<string> {
        const metrics: Partial<BatchMetrics> = {
            batchId,
            totalItems,
            autoMatched: 0,
            manualCorrections: 0,
            validationErrors: 0,
            validationWarnings: 0,
            highConfidenceMatches: 0,
            mediumConfidenceMatches: 0,
            lowConfidenceMatches: 0,
            itemsWithPrice: 0,
            priceCacheHits: 0,
            priceApiCalls: 0,
            aiTokensUsed: 0,
            searchApiCalls: 0,
            estimatedCostUsd: 0,
        };

        const { data, error } = await this.supabase
            .from('batch_metrics')
            .insert(metrics)
            .select()
            .single();

        if (error) {
            console.error('Failed to initialize metrics:', error);
            throw error;
        }

        return data.id;
    }

    /**
     * Update metrics with performance data
     */
    async updatePerformance(
        batchId: string,
        performance: {
            processingTimeMs?: number;
            matchingTimeMs?: number;
            pricingTimeMs?: number;
            validationTimeMs?: number;
        }
    ): Promise<void> {
        const { error } = await this.supabase
            .from('batch_metrics')
            .update({
                ...performance,
                updated_at: new Date().toISOString(),
            })
            .eq('batch_id', batchId);

        if (error) {
            console.error('Failed to update performance metrics:', error);
        }
    }

    /**
     * Update quality metrics
     */
    async updateQuality(
        batchId: string,
        quality: {
            autoMatched?: number;
            manualCorrections?: number;
            validationErrors?: number;
            validationWarnings?: number;
            highConfidenceMatches?: number;
            mediumConfidenceMatches?: number;
            lowConfidenceMatches?: number;
        }
    ): Promise<void> {
        const { error } = await this.supabase
            .from('batch_metrics')
            .update({
                ...quality,
                updated_at: new Date().toISOString(),
            })
            .eq('batch_id', batchId);

        if (error) {
            console.error('Failed to update quality metrics:', error);
        }
    }

    /**
     * Update pricing metrics
     */
    async updatePricing(
        batchId: string,
        pricing: {
            itemsWithPrice?: number;
            avgPriceConfidence?: number;
            priceCacheHits?: number;
            priceApiCalls?: number;
        }
    ): Promise<void> {
        const { error } = await this.supabase
            .from('batch_metrics')
            .update({
                ...pricing,
                updated_at: new Date().toISOString(),
            })
            .eq('batch_id', batchId);

        if (error) {
            console.error('Failed to update pricing metrics:', error);
        }
    }

    /**
     * Update cost metrics
     */
    async updateCosts(
        batchId: string,
        costs: {
            aiTokensUsed?: number;
            searchApiCalls?: number;
            estimatedCostUsd?: number;
        }
    ): Promise<void> {
        const { error } = await this.supabase
            .from('batch_metrics')
            .update({
                ...costs,
                updated_at: new Date().toISOString(),
            })
            .eq('batch_id', batchId);

        if (error) {
            console.error('Failed to update cost metrics:', error);
        }
    }

    /**
     * Update accuracy after user review
     */
    async updateAccuracy(
        batchId: string,
        matchingAccuracy: number,
        pricingAccuracy?: number
    ): Promise<void> {
        const { error } = await this.supabase
            .from('batch_metrics')
            .update({
                matching_accuracy: matchingAccuracy,
                pricing_accuracy: pricingAccuracy,
                updated_at: new Date().toISOString(),
            })
            .eq('batch_id', batchId);

        if (error) {
            console.error('Failed to update accuracy metrics:', error);
        }
    }

    /**
     * Get metrics for a specific batch
     */
    async getBatchMetrics(batchId: string): Promise<BatchMetrics | null> {
        const { data, error } = await this.supabase
            .from('batch_metrics')
            .select('*')
            .eq('batch_id', batchId)
            .single();

        if (error) {
            console.error('Failed to get batch metrics:', error);
            return null;
        }

        return data as BatchMetrics;
    }

    /**
     * Get summary metrics for a date range
     */
    async getSummary(
        startDate: string,
        endDate: string
    ): Promise<MetricsSummary> {
        const { data, error } = await this.supabase
            .from('batch_metrics')
            .select('*')
            .gte('created_at', startDate)
            .lte('created_at', endDate);

        if (error || !data || data.length === 0) {
            return {
                totalBatches: 0,
                avgMatchingAccuracy: 0,
                avgProcessingTime: 0,
                totalCosts: 0,
                accuracyTrend: { labels: [], values: [] },
                costTrend: { labels: [], values: [] },
            };
        }

        const totalBatches = data.length;
        const avgMatchingAccuracy =
            data.reduce((sum, m: any) => sum + (m.matching_accuracy || 0), 0) / totalBatches;
        const avgProcessingTime =
            data.reduce((sum, m: any) => sum + (m.processing_time_ms || 0), 0) / totalBatches;
        const totalCosts = data.reduce((sum, m: any) => sum + (m.estimated_cost_usd || 0), 0);

        // Group by day for trends
        const byDay = data.reduce((acc, m: any) => {
            const day = new Date(m.created_at).toISOString().split('T')[0];
            if (!acc[day]) {
                acc[day] = { accuracy: [], costs: [] };
            }
            if (m.matching_accuracy) acc[day].accuracy.push(m.matching_accuracy);
            if (m.estimated_cost_usd) acc[day].costs.push(m.estimated_cost_usd);
            return acc;
        }, {} as Record<string, { accuracy: number[]; costs: number[] }>);

        const labels = Object.keys(byDay).sort();
        const accuracyValues = labels.map((day: string) => {
            const values = byDay[day].accuracy;
            return values.reduce((sum: number, v: number) => sum + v, 0) / values.length;
        });
        const costValues = labels.map((day: string) => {
            const values = byDay[day].costs;
            return values.reduce((sum: number, v: number) => sum + v, 0);
        });

        return {
            totalBatches,
            avgMatchingAccuracy,
            avgProcessingTime,
            totalCosts,
            accuracyTrend: { labels, values: accuracyValues },
            costTrend: { labels, values: costValues },
        };
    }

    /**
     * Get active alerts based on thresholds
     */
    async getAlerts(): Promise<Alert[]> {
        const alerts: Alert[] = [];
        const recentMetrics = await this.getRecentMetrics(10);

        if (recentMetrics.length === 0) return alerts;

        // Check accuracy threshold
        const avgAccuracy =
            recentMetrics.reduce((sum, m: any) => sum + (m.matching_accuracy || 0), 0) /
            recentMetrics.length;
        if (avgAccuracy < 70) {
            alerts.push({
                id: 'accuracy-low',
                type: 'accuracy',
                severity: 'warning',
                message: 'Matching accuracy below 70%',
                threshold: 70,
                actualValue: avgAccuracy,
                createdAt: new Date().toISOString(),
            });
        }

        // Check cost threshold
        const totalCost = recentMetrics.reduce(
            (sum, m: any) => sum + (m.estimated_cost_usd || 0),
            0
        );
        if (totalCost > 100) {
            alerts.push({
                id: 'cost-high',
                type: 'cost',
                severity: 'warning',
                message: 'Total costs exceed $100 in last 10 batches',
                threshold: 100,
                actualValue: totalCost,
                createdAt: new Date().toISOString(),
            });
        }

        // Check performance threshold
        const avgTime =
            recentMetrics.reduce((sum, m: any) => sum + (m.processing_time_ms || 0), 0) /
            recentMetrics.length;
        if (avgTime > 300000) {
            // 5 minutes
            alerts.push({
                id: 'performance-slow',
                type: 'performance',
                severity: 'info',
                message: 'Average processing time exceeds 5 minutes',
                threshold: 300000,
                actualValue: avgTime,
                createdAt: new Date().toISOString(),
            });
        }

        return alerts;
    }

    /**
     * Get recent metrics
     */
    private async getRecentMetrics(limit: number): Promise<BatchMetrics[]> {
        const { data, error } = await this.supabase
            .from('batch_metrics')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error || !data) {
            return [];
        }

        return data as BatchMetrics[];
    }
}

export const metricsService = new MetricsService();
