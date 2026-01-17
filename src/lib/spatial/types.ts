
import { Point } from '../processing/block-resolver';
import { ItemDetectado } from '@/types';

export interface SpatialZone {
    id: string; // uuid
    name: string; // "SALA DE REUNIONES", "BODEGA", etc.
    center: Point;
    bbox?: {
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
    };
    source_text_id?: string;
    items: ItemDetectado[]; // Items assigned to this zone
    score?: number; // Match confidence
}

export interface SpatialGraphConfig {
    // Configuration for zone detection
    minTextHeight?: number;
    keywords?: string[]; // e.g. ["DORMITORIO", "BODEGA"]
    maxDistance?: number; // Max distance to associate item with zone
}

export interface SpatialAnalysisResult {
    zones: SpatialZone[];
    unassignedItems: ItemDetectado[];
    graphStats: {
        totalZones: number;
        totalAssigned: number;
    };
}
