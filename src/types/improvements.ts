// Extended types for new improvement features

import type { StagingRow, ItemDetectado, Batch, PriceSource } from './index';

export interface MatchingFeedback {
    id: string;
    batchId: string;
    excelItemText: string;
    excelUnit?: string;
    suggestedMatchId?: string;
    suggestedConfidence?: number;
    actualMatchId?: string;
    correctionType: 'accept' | 'reject' | 'modify' | 'manual';
    userId: string;
    sessionId?: string;
    createdAt: string;
}

export interface BatchMetrics {
    id: string;
    batchId: string;

    // Performance (ms)
    processingTimeMs?: number;
    matchingTimeMs?: number;
    pricingTimeMs?: number;
    validationTimeMs?: number;

    // Quality
    totalItems: number;
    autoMatched: number;
    manualCorrections: number;
    validationErrors: number;
    validationWarnings: number;

    // Matching breakdown
    highConfidenceMatches: number;
    mediumConfidenceMatches: number;
    lowConfidenceMatches: number;

    // Pricing
    itemsWithPrice: number;
    avgPriceConfidence?: number;
    priceCacheHits: number;
    priceApiCalls: number;

    // Costs
    aiTokensUsed: number;
    searchApiCalls: number;
    estimatedCostUsd: number;

    // Accuracy (post-review)
    matchingAccuracy?: number;
    pricingAccuracy?: number;

    createdAt: string;
    updatedAt: string;
}

export interface PriceCache {
    id: string;
    itemNormalized: string;
    unit?: string;
    averagePrice: number;
    currency: string;
    sources?: PriceSource[];
    confidence: 'high' | 'medium' | 'low';
    lastUpdated: string;
    hitCount: number;
    createdAt: string;
}

export interface ValidationRule {
    id: string;
    name: string;
    description?: string;
    ruleType: 'range' | 'ratio' | 'consistency' | 'business';
    config: Record<string, any>;
    severity: 'error' | 'warning' | 'info';
    enabled: boolean;
    userId?: string;
    createdAt: string;
    updatedAt: string;
}

export interface ValidationResult {
    id: string;
    stagingRowId: string;
    batchId: string;
    ruleId?: string;
    passed: boolean;
    severity: 'error' | 'warning' | 'info';
    message?: string;
    details?: Record<string, any>;
    overridden: boolean;
    overrideReason?: string;
    overrideBy?: string;
    overrideAt?: string;
    createdAt: string;
}

// Enhanced StagingRow with validation results
export interface StagingRowWithValidation extends StagingRow {
    validationResults?: ValidationResult[];
    hasErrors?: boolean;
    hasWarnings?: boolean;
}

// Matching strategy types
export type MatchingStrategy = 'fuzzy' | 'semantic' | 'rule-based' | 'ensemble';

export interface MatchingConfig {
    strategies: MatchingStrategy[];
    weights?: Record<MatchingStrategy, number>;
    threshold: number;
    useFeedback: boolean;
}

export interface MatchResult {
    item: ItemDetectado;
    confidence: number;
    strategy: MatchingStrategy;
    reason: string;
}

// Validation types
export interface ValidationContext {
    batch: Batch;
    allRows: StagingRow[];
    historicalData?: any;
}

export interface ValidationCheck {
    (row: StagingRow, context: ValidationContext): ValidationResult | null;
}

// Metrics dashboard types
export interface MetricsSummary {
    totalBatches: number;
    avgMatchingAccuracy: number;
    avgProcessingTime: number;
    totalCosts: number;
    accuracyTrend: TimeSeries;
    costTrend: TimeSeries;
}

export interface TimeSeries {
    labels: string[];
    values: number[];
}

export interface Alert {
    id: string;
    type: 'accuracy' | 'cost' | 'performance' | 'error';
    severity: 'critical' | 'warning' | 'info';
    message: string;
    threshold: number;
    actualValue: number;
    createdAt: string;
}

// Learning service types
export interface HistoricalMatch {
    excelText: string;
    cadItem: ItemDetectado;
    confidence: number;
    frequency: number;
    lastUsed: string;
}

export interface LearningDataset {
    examples: Array<{
        input: string;
        output: string;
        confidence: number;
    }>;
    metadata: {
        totalExamples: number;
        avgConfidence: number;
        dateRange: [string, string];
    };
}
