// Zod schemas for JSONB validation
// Ensures data integrity for complex JSON fields

import { z } from 'zod';

// Source Item Schema (for staging_rows.source_items)
export const SourceItemSchema = z.object({
    id: z.string().uuid(),
    type: z.enum(['block', 'length', 'area', 'text']),
    value_m: z.number().nonnegative(),
    evidence: z.string(),
    name_raw: z.string(),
    unit_raw: z.string(),
    layer_raw: z.string(),
    value_raw: z.number(),
    layer_normalized: z.string()
});

export const SourceItemsArraySchema = z.array(SourceItemSchema);

// Price Source Schema (for staging_rows.price_sources)
export const PriceSourceSchema = z.object({
    url: z.string().url(),
    price: z.number().positive(),
    title: z.string().min(1),
    vendor: z.string().min(1)
});

export const PriceSourcesArraySchema = z.array(PriceSourceSchema);

// Price Candidates Schema (legacy field, for staging_rows.price_candidates)
export const PriceCandidateSchema = z.object({
    vendor: z.string(),
    price: z.number().positive(),
    score: z.number().min(0).max(1),
    url: z.string().url().optional()
});

export const PriceCandidatesArraySchema = z.array(PriceCandidateSchema);

// Helper functions for validation
export function validateSourceItems(data: unknown): z.infer<typeof SourceItemsArraySchema> | null {
    const result = SourceItemsArraySchema.safeParse(data);
    if (!result.success) {
        console.error('Invalid source_items:', result.error);
        return null;
    }
    return result.data;
}

export function validatePriceSources(data: unknown): z.infer<typeof PriceSourcesArraySchema> | null {
    const result = PriceSourcesArraySchema.safeParse(data);
    if (!result.success) {
        console.error('Invalid price_sources:', result.error);
        return null;
    }
    return result.data;
}

export function validatePriceCandidates(data: unknown): z.infer<typeof PriceCandidatesArraySchema> | null {
    const result = PriceCandidatesArraySchema.safeParse(data);
    if (!result.success) {
        console.error('Invalid price_candidates:', result.error);
        return null;
    }
    return result.data;
}

// Type exports
export type SourceItem = z.infer<typeof SourceItemSchema>;
export type PriceSource = z.infer<typeof PriceSourceSchema>;
export type PriceCandidate = z.infer<typeof PriceCandidateSchema>;
