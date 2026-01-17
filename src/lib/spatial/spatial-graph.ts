
import { v4 as uuidv4 } from 'uuid';
import { ItemDetectado } from '@/types';
import { SpatialZone, SpatialGraphConfig, SpatialAnalysisResult } from './types';
import { Point } from '../processing/block-resolver';

export class SpatialGraph {
    private zones: SpatialZone[] = [];
    private config: SpatialGraphConfig;

    constructor(config: SpatialGraphConfig = {}) {
        this.config = {
            minTextHeight: 0.2, // Minimum height for room label candidate (m)
            maxDistance: 5.0,    // Search radius (m)
            keywords: [],        // Optional whitelist
            ...config
        };
    }

    /**
     * Detect spatial zones from text entities
     */
    public detectZones(texts: ItemDetectado[]): void {
        this.zones = [];

        // Filter candidates
        const candidates = texts.filter(t => {
            if (t.type !== 'text') return false;

            // Check height
            if (this.config.minTextHeight && t.value_m && t.value_m < this.config.minTextHeight) {
                return false;
            }

            // Check keywords if provided
            if (this.config.keywords && this.config.keywords.length > 0) {
                const content = t.name_raw?.toUpperCase() || '';
                const match = this.config.keywords.some(k => content.includes(k.toUpperCase()));
                if (!match) return false;
            }

            // Must have position
            if (!t.position || (t.position.x === 0 && t.position.y === 0)) {
                // Check if it's truly 0,0 (unlikely for valid room label)
                // But we saw legitimate text at 0,0 in some debug logs? 
                // No, we saw 0,0 due to parse error. Valid text was at 113000.
                // So we can filter out 0,0 safely as "likely unpositioned".
                return false;
            }

            return true;
        });

        // Create zones
        for (const t of candidates) {
            this.zones.push({
                id: uuidv4(),
                name: t.name_raw || 'Unnamed Zone',
                center: t.position!, // Checked above
                source_text_id: t.id,
                items: []
            });
        }

        console.log(`[SpatialGraph] Detected ${this.zones.length} zones from ${texts.length} text entities.`);
    }

    /**
     * Find nearest zone for a point within maxDistance
     */
    public findZone(p: Point): SpatialZone | null {
        if (!p || (p.x === 0 && p.y === 0)) return null;

        let bestZone: SpatialZone | null = null;
        let minDist = this.config.maxDistance || 5.0; // Default 5m

        for (const zone of this.zones) {
            const dx = p.x - zone.center.x;
            const dy = p.y - zone.center.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < minDist) {
                minDist = dist;
                bestZone = zone;
            }
        }
        return bestZone;
    }

    /**
     * Assign items to nearest zones
     */
    public assignItems(items: ItemDetectado[]): SpatialAnalysisResult {
        const unassigned: ItemDetectado[] = [];
        let assignedCount = 0;

        for (const item of items) {
            // Skip texts (they are the zones)
            if (item.type === 'text') continue;

            // Only assign if item has position check? 
            // Most items don't have single 'position'. 
            // We need to look up their Bounding Box center or random point?
            // ItemDetectado doesn't have `position` for geometry usually (except Block).
            // But we can check if we can get position from item properties?

            // For now, only Blocks have explicit position in ItemDetectado.
            // Items from `aggregateExplodedToItems` might NOT have position if they are aggregated Areas/Lengths!
            // Wait. `aggregateExplodedToItems` aggregates total area by Layer.
            // It loses spatial information!

            // CRITICAL: Aggregated items (e.g. "Total Wall Area on Layer X") cannot be assigned to a room!
            // We need UN-AGGREGATED items (individual entites) to do spatial assignment.

            // Current `dxf.ts` flow: explode -> aggregate -> match.
            // To do Spatial Assignment, we need to assign BEFORE aggregation?
            // OR we need to keep individual items and aggregate PER ZONE?

            // For Phase 1, we only have `ItemDetectado` which are aggregated.
            // We can only Assign BLOCK instances easily (since they keep position?).
            // BUT `aggregateExplodedToItems` counts block instances.

            // WE NEED TO CHANGE THE PIPELINE.
            // Spatial Intelligence requires processing INDIVIDUAL geometry traces.

            unassigned.push(item);
        }

        return {
            zones: this.zones,
            unassignedItems: unassigned,
            graphStats: {
                totalZones: this.zones.length,
                totalAssigned: assignedCount
            }
        };
    }
}
