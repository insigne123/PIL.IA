/**
 * Geometry Validator
 * 
 * P0.1: Validates that DXF layers have actual geometric support for expected measure types
 * This prevents incorrect matches like blocks being matched for m2 items (→ qty_final = 0)
 */

import { ItemDetectado } from '@/types';

export interface LayerGeometryProfile {
    layer: string;
    total_area: number;         // Total m² from HATCHes + closed polylines
    total_length: number;       // Total m from lines/polylines
    block_count: number;        // Count of INSERTs
    hatch_count: number;        // Count of HATCHes
    closed_poly_count: number;  // Count of closed polylines
    text_count: number;         // Count of TEXT/MTEXT items
    entity_types: Set<string>;  // ['HATCH', 'INSERT', 'LINE', ...]
    has_area_support: boolean;  // Has HATCHes or closed polys
    has_length_support: boolean;// Has lines/polylines
    has_block_support: boolean; // Has INSERTs
    // P4: Channel Selection - sample items per type (max 3 each for debugging)
    area_samples?: any[];       // Representative area items
    length_samples?: any[];     // Representative length items
    block_samples?: any[];      // Representative block items
}

export interface GeometryValidation {
    supported: boolean;
    reason: string;
    fallback?: 'explode_blocks' | 'convert_length_to_area';
    metrics?: {
        available_area?: number;
        available_length?: number;
        available_blocks?: number;
    };
}

/**
 * Build geometry profiles for all layers from DXF items
 */
export function buildLayerProfiles(items: ItemDetectado[]): Map<string, LayerGeometryProfile> {
    const profiles = new Map<string, LayerGeometryProfile>();

    for (const item of items) {
        const layer = item.layer_normalized;

        if (!profiles.has(layer)) {
            profiles.set(layer, {
                layer,
                total_area: 0,
                total_length: 0,
                block_count: 0,
                hatch_count: 0,
                closed_poly_count: 0,
                text_count: 0,
                entity_types: new Set<string>(),
                has_area_support: false,
                has_length_support: false,
                has_block_support: false,
                // P4: Initialize sample arrays for Channel Selection
                area_samples: [],
                length_samples: [],
                block_samples: []
            });
        }

        const profile = profiles.get(layer)!;

        // Add entity type
        profile.entity_types.add(item.type);

        // Accumulate by type AND collect samples (P4: Channel Selection)
        if (item.type === 'area') {
            profile.total_area += item.value_si;
            if (item.evidence?.includes('HATCH')) profile.hatch_count++;
            if (item.evidence?.includes('closed')) profile.closed_poly_count++;
            profile.has_area_support = true;
            // P4: Keep up to 3 samples for debugging
            if (profile.area_samples!.length < 3) {
                profile.area_samples!.push(item);
            }
        } else if (item.type === 'length') {
            profile.total_length += item.value_si;
            profile.has_length_support = true;
            if (profile.length_samples!.length < 3) {
                profile.length_samples!.push(item);
            }
        } else if (item.type === 'block') {
            profile.block_count += item.value_si; // value_si holds count for blocks
            profile.has_block_support = true;
            if (profile.block_samples!.length < 3) {
                profile.block_samples!.push(item);
            }
        } else if (item.type === 'text') {
            profile.text_count++;
        }
    }

    return profiles;
}

/**
 * Validate if a layer has geometric support for the expected measure type
 */
export function validateGeometrySupport(
    layer: string,
    expectedMeasureType: 'AREA' | 'LENGTH' | 'BLOCK' | 'VOLUME' | 'GLOBAL' | 'UNKNOWN',
    profile: LayerGeometryProfile
): GeometryValidation {

    // UNKNOWN and GLOBAL always pass
    if (expectedMeasureType === 'UNKNOWN' || expectedMeasureType === 'GLOBAL') {
        return {
            supported: true,
            reason: `${expectedMeasureType} type accepts any geometry`
        };
    }

    // AREA validation
    if (expectedMeasureType === 'AREA') {
        // Primary: Has actual area geometry
        if (profile.has_area_support && profile.total_area > 0.01) {
            return {
                supported: true,
                reason: `Has ${profile.total_area.toFixed(2)} m² of area (${profile.hatch_count} HATCHes, ${profile.closed_poly_count} closed polylines)`,
                metrics: { available_area: profile.total_area }
            };
        }

        // Secondary: Can convert length to area (e.g., walls with height)
        if (profile.has_length_support && profile.total_length > 0) {
            return {
                supported: true,
                reason: `Can convert ${profile.total_length.toFixed(2)} m length to area (with height factor)`,
                fallback: 'convert_length_to_area',
                metrics: { available_length: profile.total_length }
            };
        }

        // Tertiary: Try to explode blocks (future implementation)
        if (profile.has_block_support) {
            return {
                supported: false,
                reason: `Layer has only blocks (${profile.block_count}), no area geometry. Block explosion not implemented yet.`,
                fallback: 'explode_blocks',
                metrics: { available_blocks: profile.block_count }
            };
        }

        return {
            supported: false,
            reason: 'No area or length geometry found'
        };
    }

    // LENGTH validation
    if (expectedMeasureType === 'LENGTH') {
        if (profile.has_length_support && profile.total_length > 0) {
            return {
                supported: true,
                reason: `Has ${profile.total_length.toFixed(2)} m of length`,
                metrics: { available_length: profile.total_length }
            };
        }

        return {
            supported: false,
            reason: `No length geometry found. Layer has: ${Array.from(profile.entity_types).join(', ')}`
        };
    }

    // BLOCK validation
    if (expectedMeasureType === 'BLOCK') {
        if (profile.has_block_support && profile.block_count > 0) {
            return {
                supported: true,
                reason: `Has ${profile.block_count} blocks`,
                metrics: { available_blocks: profile.block_count }
            };
        }

        return {
            supported: false,
            reason: `No blocks found. Layer has: ${Array.from(profile.entity_types).join(', ')}`
        };
    }

    return { supported: false, reason: 'Unknown measure type' };
}

/**
 * Get summary of all layer profiles for logging
 */
export function getLayerProfilesSummary(profiles: Map<string, LayerGeometryProfile>): string {
    const lines: string[] = [];

    for (const [layer, profile] of profiles.entries()) {
        const parts: string[] = [];

        if (profile.total_area > 0) {
            parts.push(`${profile.total_area.toFixed(2)} m²`);
        }
        if (profile.total_length > 0) {
            parts.push(`${profile.total_length.toFixed(2)} m`);
        }
        if (profile.block_count > 0) {
            parts.push(`${profile.block_count} blocks`);
        }

        if (parts.length > 0) {
            lines.push(`  • ${layer}: ${parts.join(', ')}`);
        }
    }

    return lines.length > 0
        ? `Layer profiles (${profiles.size} layers):\n${lines.join('\n')}`
        : 'No layer profiles created';
}
