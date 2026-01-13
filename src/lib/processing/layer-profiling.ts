import { ItemDetectado } from '@/types';

export interface LayerProfile {
    layerName: string;
    entityTypes: Record<string, number>; // { LINE: 45, POLYLINE: 12, ... }
    lengthDistribution: {
        p50: number;
        p90: number;
        p95: number;
        max: number;
        min: number;
        mean: number;
    };
    shortSegmentRatio: number; // % de entidades < minLength/5
    isLikelyAnnotation: boolean;
    spatialClusters: number; // componentes conexas (estimado)
    totalEntities: number;
    totalLength: number;
    confidence: number; // 0-1, qué tan seguro estamos de la clasificación
}

/**
 * Calculate percentile from sorted array
 */
function percentile(sortedArray: number[], p: number): number {
    if (sortedArray.length === 0) return 0;
    const index = Math.ceil(sortedArray.length * p) - 1;
    return sortedArray[Math.max(0, index)];
}

/**
 * Profile a layer to determine if it's likely annotation or real geometry
 */
export function profileLayer(
    entities: any[],
    layerName: string,
    minLength: number
): LayerProfile {
    const profile: LayerProfile = {
        layerName,
        entityTypes: {},
        lengthDistribution: {
            p50: 0,
            p90: 0,
            p95: 0,
            max: 0,
            min: 0,
            mean: 0
        },
        shortSegmentRatio: 0,
        isLikelyAnnotation: false,
        spatialClusters: 0,
        totalEntities: entities.length,
        totalLength: 0,
        confidence: 0
    };

    if (entities.length === 0) {
        profile.isLikelyAnnotation = true;
        profile.confidence = 1.0;
        return profile;
    }

    // Count entity types
    const lengths: number[] = [];
    let shortSegmentCount = 0;
    const shortThreshold = minLength / 5;

    for (const entity of entities) {
        const type = entity.type || 'UNKNOWN';
        profile.entityTypes[type] = (profile.entityTypes[type] || 0) + 1;

        // Calculate length for linear entities
        let length = 0;
        if (entity.type === 'LINE') {
            const start = entity.start;
            const end = entity.end;
            if (start && end) {
                const dx = end.x - start.x;
                const dy = end.y - start.y;
                length = Math.sqrt(dx * dx + dy * dy);
            }
        } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
            const vertices = entity.vertices || [];
            for (let i = 0; i < vertices.length - 1; i++) {
                const dx = vertices[i].x - vertices[i + 1].x;
                const dy = vertices[i].y - vertices[i + 1].y;
                length += Math.sqrt(dx * dx + dy * dy);
            }
            if (entity.shape || entity.closed) {
                const dx = vertices[vertices.length - 1].x - vertices[0].x;
                const dy = vertices[vertices.length - 1].y - vertices[0].y;
                length += Math.sqrt(dx * dx + dy * dy);
            }
        }

        if (length > 0) {
            lengths.push(length);
            profile.totalLength += length;
            if (length < shortThreshold) {
                shortSegmentCount++;
            }
        }
    }

    // Calculate length distribution
    if (lengths.length > 0) {
        const sortedLengths = lengths.sort((a, b) => a - b);
        profile.lengthDistribution.min = sortedLengths[0];
        profile.lengthDistribution.max = sortedLengths[sortedLengths.length - 1];
        profile.lengthDistribution.p50 = percentile(sortedLengths, 0.5);
        profile.lengthDistribution.p90 = percentile(sortedLengths, 0.9);
        profile.lengthDistribution.p95 = percentile(sortedLengths, 0.95);
        profile.lengthDistribution.mean = profile.totalLength / lengths.length;
        profile.shortSegmentRatio = shortSegmentCount / lengths.length;
    }

    // Estimate spatial clusters (simplified: just count unique rounded positions)
    const positions = new Set<string>();
    for (const entity of entities) {
        if (entity.type === 'LINE' && entity.start) {
            const key = `${Math.round(entity.start.x / 10)},${Math.round(entity.start.y / 10)}`;
            positions.add(key);
        } else if ((entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') && entity.vertices?.[0]) {
            const v = entity.vertices[0];
            const key = `${Math.round(v.x / 10)},${Math.round(v.y / 10)}`;
            positions.add(key);
        } else if (entity.type === 'INSERT' && entity.position) {
            const key = `${Math.round(entity.position.x / 10)},${Math.round(entity.position.y / 10)}`;
            positions.add(key);
        }
    }
    profile.spatialClusters = positions.size;

    // Determine if likely annotation based on heuristics
    const annotationScore = calculateAnnotationScore(profile, minLength);
    profile.isLikelyAnnotation = annotationScore > 0.6;
    profile.confidence = Math.abs(annotationScore - 0.5) * 2; // 0 at boundary, 1 at extremes

    return profile;
}

/**
 * Calculate annotation likelihood score (0 = definitely geometry, 1 = definitely annotation)
 */
function calculateAnnotationScore(profile: LayerProfile, minLength: number): number {
    let score = 0;
    let weights = 0;

    // Factor 1: High ratio of short segments (weight: 0.3)
    if (profile.shortSegmentRatio > 0.7) {
        score += 0.3 * profile.shortSegmentRatio;
        weights += 0.3;
    }

    // Factor 2: Very small median length (weight: 0.25)
    if (profile.lengthDistribution.p50 < minLength / 3) {
        const ratio = profile.lengthDistribution.p50 / (minLength / 3);
        score += 0.25 * (1 - ratio);
        weights += 0.25;
    }

    // Factor 3: High proportion of TEXT/MTEXT entities (weight: 0.2)
    const textCount = (profile.entityTypes['TEXT'] || 0) + (profile.entityTypes['MTEXT'] || 0);
    const textRatio = textCount / profile.totalEntities;
    if (textRatio > 0.3) {
        score += 0.2 * textRatio;
        weights += 0.2;
    }

    // Factor 4: High number of spatial clusters relative to entities (weight: 0.15)
    const clusterRatio = profile.spatialClusters / profile.totalEntities;
    if (clusterRatio > 0.5) {
        score += 0.15 * clusterRatio;
        weights += 0.15;
    }

    // Factor 5: Very low total length (weight: 0.1)
    if (profile.totalLength < minLength * 2) {
        const ratio = profile.totalLength / (minLength * 2);
        score += 0.1 * (1 - ratio);
        weights += 0.1;
    }

    // Normalize score
    return weights > 0 ? score / weights : 0.5;
}

/**
 * Profile all layers in a set of items
 */
export function profileAllLayers(
    items: ItemDetectado[],
    entitiesByLayer: Map<string, any[]>,
    minLength: number
): Map<string, LayerProfile> {
    const profiles = new Map<string, LayerProfile>();

    for (const [layerName, entities] of entitiesByLayer.entries()) {
        const profile = profileLayer(entities, layerName, minLength);
        profiles.set(layerName, profile);
    }

    return profiles;
}

/**
 * Filter items to exclude those from annotation layers
 */
export function filterAnnotationItems(
    items: ItemDetectado[],
    layerProfiles: Map<string, LayerProfile>
): { filtered: ItemDetectado[]; excluded: ItemDetectado[] } {
    const filtered: ItemDetectado[] = [];
    const excluded: ItemDetectado[] = [];

    for (const item of items) {
        const profile = layerProfiles.get(item.layer_normalized);

        if (profile && profile.isLikelyAnnotation && profile.confidence > 0.7) {
            excluded.push(item);
        } else {
            filtered.push(item);
        }
    }

    return { filtered, excluded };
}

/**
 * Get a summary of layer profiling results
 */
export function getLayerProfilingSummary(profiles: Map<string, LayerProfile>): string {
    const total = profiles.size;
    const annotationLayers = Array.from(profiles.values()).filter(p => p.isLikelyAnnotation);
    const geometryLayers = Array.from(profiles.values()).filter(p => !p.isLikelyAnnotation);

    const parts: string[] = [];
    parts.push(`Total layers: ${total}`);
    parts.push(`Geometry layers: ${geometryLayers.length}`);
    parts.push(`Annotation layers: ${annotationLayers.length}`);

    if (annotationLayers.length > 0) {
        const names = annotationLayers.map(p => p.layerName).slice(0, 5).join(', ');
        parts.push(`Annotation detected: ${names}${annotationLayers.length > 5 ? '...' : ''}`);
    }

    return parts.join(' | ');
}
