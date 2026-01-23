/**
 * CSV Takeoff Parser
 * 
 * Parses takeoff_layers_report.csv exported from AutoCAD DATAEXTRACTION
 * and builds a LayerTakeoffIndex with pre-calculated quantities per layer.
 * 
 * This allows skipping geometry calculation and using AutoCAD's native
 * area/length measurements as the source of truth.
 */

import { MeasureKind, Unit } from '@/types';

// ============================================================================
// TYPES
// ============================================================================

export interface CSVTakeoffRow {
    count: number;
    name: string;       // Entity type: 'Hatch', 'Polyline', 'Line', 'Arc', etc.
    layer: string;
    area: number | null;
    length: number | null;
    closed: boolean | null;
    color?: string;     // NEW P0.5
}

export interface LayerTakeoffEntry {
    totalArea: number;          // m² (normalized)
    totalLength: number;        // m (normalized)
    entityTypes: string[];      // ['Hatch', 'Polyline', 'Line']
    hasReliableArea: boolean;   // true if has Hatch or Closed Polylines
    hasReliableLength: boolean; // true if has Lines, Polylines, or Arcs
    entityCount: number;        // Total entity count
    rawAreaSum: number;         // Original sum before normalization (for debugging)
    rawLengthSum: number;       // Original sum before normalization (for debugging)

    // NEW P0.5: Color breakdown
    colorBreakdown: Map<string, {
        area: number;
        length: number;
        count: number;
    }>;
}

export interface LayerTakeoffIndex {
    [layer: string]: LayerTakeoffEntry;
}

export interface CSVTakeoffResult {
    index: LayerTakeoffIndex;
    detectedUnit: Unit;
    totalLayers: number;
    layersWithArea: number;
    layersWithLength: number;
    warnings: string[];
    metadata: {
        totalRows: number;
        totalEntities: number;
        entityTypeBreakdown: Record<string, number>;
    };
}

// Entity types that provide reliable area measurements
const AREA_ENTITY_TYPES = ['Hatch', 'Circle'];
const CLOSED_POLY_TYPES = ['Polyline', 'LwPolyline', 'Region'];

// Entity types that provide reliable length measurements
const LENGTH_ENTITY_TYPES = ['Line', 'Polyline', 'LwPolyline', 'Arc', 'Spline', 'Circle'];

// ============================================================================
// CSV PARSING
// ============================================================================

/**
 * Parse the CSV content into structured rows
 */
export function parseCSVContent(csvContent: string): CSVTakeoffRow[] {
    const lines = csvContent.split(/\r?\n/).filter(line => line.trim());

    if (lines.length < 2) {
        throw new Error('CSV file is empty or has no data rows');
    }

    // Parse header
    const header = lines[0].split(',').map(h => h.trim().toLowerCase());

    // Find column indices
    const countIdx = header.findIndex(h => h === 'count');
    const nameIdx = header.findIndex(h => h === 'name');
    const layerIdx = header.findIndex(h => h === 'layer');
    const areaIdx = header.findIndex(h => h === 'area');
    const lengthIdx = header.findIndex(h => h === 'length');
    const closedIdx = header.findIndex(h => h === 'closed');
    const colorIdx = header.findIndex(h => h === 'color'); // New

    // Validate required columns
    if (layerIdx === -1) {
        throw new Error('CSV missing required "Layer" column');
    }
    if (nameIdx === -1) {
        throw new Error('CSV missing required "Name" column');
    }

    const rows: CSVTakeoffRow[] = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Simple CSV parsing (handles basic cases)
        const values = parseCSVLine(line);

        const count = countIdx !== -1 ? parseFloat(values[countIdx]) || 1 : 1;
        const name = nameIdx !== -1 ? values[nameIdx]?.trim() || '' : '';
        const layer = values[layerIdx]?.trim() || '';
        const area = areaIdx !== -1 ? parseFloat(values[areaIdx]) || null : null;
        const length = lengthIdx !== -1 ? parseFloat(values[lengthIdx]) || null : null;
        const closedStr = closedIdx !== -1 ? values[closedIdx]?.trim().toLowerCase() : null;
        const closed = closedStr === 'true' ? true : closedStr === 'false' ? false : null;
        const color = colorIdx !== -1 ? values[colorIdx]?.trim() : undefined; // New

        if (layer) {
            rows.push({ count, name, layer, area, length, closed, color });
        }
    }

    return rows;
}

/**
 * Simple CSV line parser that handles quoted fields
 */
function parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current);

    return result;
}

// ============================================================================
// UNIT DETECTION & NORMALIZATION
// ============================================================================

/**
 * Detect the unit of the drawing based on area magnitudes
 * Uses heuristics: if areas for typical rooms are in millions, it's mm²
 */
export function detectUnitFromAreas(rows: CSVTakeoffRow[]): { unit: Unit; confidence: number } {
    // Get all non-null areas
    const areas = rows
        .filter(r => r.area !== null && r.area > 0)
        .map(r => r.area! * r.count);

    if (areas.length === 0) {
        return { unit: 'm', confidence: 0 };
    }

    // Calculate median area
    const sorted = [...areas].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    // Heuristics based on typical room sizes:
    // A 10m² room would be:
    // - 10 in m²
    // - 100,000 in cm²
    // - 10,000,000 in mm²

    if (median > 1_000_000) {
        // Likely mm²
        return { unit: 'mm', confidence: 0.9 };
    } else if (median > 1_000) {
        // Likely cm²
        return { unit: 'cm', confidence: 0.7 };
    } else {
        // Likely already in m²
        return { unit: 'm', confidence: 0.8 };
    }
}

/**
 * Get conversion factors based on detected unit
 */
function getConversionFactors(unit: Unit): { areaFactor: number; lengthFactor: number } {
    switch (unit) {
        case 'mm':
            return { areaFactor: 1 / 1_000_000, lengthFactor: 1 / 1_000 };
        case 'cm':
            return { areaFactor: 1 / 10_000, lengthFactor: 1 / 100 };
        case 'm':
        default:
            return { areaFactor: 1, lengthFactor: 1 };
    }
}

// ============================================================================
// LAYER TAKEOFF INDEX BUILDER
// ============================================================================

/**
 * Build the LayerTakeoffIndex from parsed rows
 */
export function buildLayerTakeoffIndex(
    rows: CSVTakeoffRow[],
    unit: Unit
): LayerTakeoffIndex {
    const index: LayerTakeoffIndex = {};
    const { areaFactor, lengthFactor } = getConversionFactors(unit);

    for (const row of rows) {
        const layer = row.layer;

        if (!index[layer]) {
            index[layer] = {
                totalArea: 0,
                totalLength: 0,
                entityTypes: [],
                hasReliableArea: false,
                hasReliableLength: false,
                entityCount: 0,
                rawAreaSum: 0,
                rawLengthSum: 0,
                colorBreakdown: new Map() // Initialize map
            };
        }

        const entry = index[layer];
        entry.entityCount += row.count;

        // Track entity types
        if (row.name && !entry.entityTypes.includes(row.name)) {
            entry.entityTypes.push(row.name);
        }

        const exactColor = row.color || 'ByLayer';
        const normalizedColor = exactColor.toLowerCase();

        // Ensure color entry exists
        if (!entry.colorBreakdown.has(normalizedColor)) {
            entry.colorBreakdown.set(normalizedColor, { area: 0, length: 0, count: 0 });
        }
        const colorEntry = entry.colorBreakdown.get(normalizedColor)!;
        colorEntry.count += row.count;

        // Process area
        if (row.area !== null && row.area > 0) {
            const isReliableAreaEntity = AREA_ENTITY_TYPES.includes(row.name) ||
                (CLOSED_POLY_TYPES.includes(row.name) && row.closed === true);

            if (isReliableAreaEntity) {
                const areaValue = row.area * row.count;
                const convertedArea = areaValue * areaFactor;

                entry.rawAreaSum += areaValue;
                entry.totalArea += convertedArea;
                entry.hasReliableArea = true;

                // Add to color stats
                colorEntry.area += convertedArea;
            }
        }

        // Process length
        if (row.length !== null && row.length > 0) {
            if (LENGTH_ENTITY_TYPES.includes(row.name)) {
                const lengthValue = row.length * row.count;
                const convertedLength = lengthValue * lengthFactor;

                entry.rawLengthSum += lengthValue;
                entry.totalLength += convertedLength;
                entry.hasReliableLength = true;

                // Add to color stats
                colorEntry.length += convertedLength;
            }
        }
    }

    return index;
}

// ============================================================================
// MAIN PARSER FUNCTION
// ============================================================================

/**
 * Main function to parse CSV and build takeoff index
 */
export function parseTakeoffCSV(csvContent: string): CSVTakeoffResult {
    const warnings: string[] = [];

    // 1. Parse CSV
    const rows = parseCSVContent(csvContent);

    // 2. Detect unit
    const { unit: detectedUnit, confidence } = detectUnitFromAreas(rows);

    if (confidence < 0.7) {
        warnings.push(`Unit detection confidence is low (${(confidence * 100).toFixed(0)}%). Verify quantities.`);
    }

    // 3. Build index
    const index = buildLayerTakeoffIndex(rows, detectedUnit);

    // 4. Calculate metadata
    const layers = Object.keys(index);
    const layersWithArea = layers.filter(l => index[l].hasReliableArea).length;
    const layersWithLength = layers.filter(l => index[l].hasReliableLength).length;

    // Entity type breakdown
    const entityTypeBreakdown: Record<string, number> = {};
    for (const row of rows) {
        entityTypeBreakdown[row.name] = (entityTypeBreakdown[row.name] || 0) + row.count;
    }

    // 5. Add warnings for potential issues
    const layer0 = index['0'];
    if (layer0 && layer0.entityCount > rows.length * 0.1) {
        warnings.push(`Layer "0" contains ${layer0.entityCount} entities (${((layer0.entityCount / rows.reduce((s, r) => s + r.count, 0)) * 100).toFixed(1)}%). Consider normalizing layers.`);
    }

    // Check for very large areas that might indicate scale issues
    for (const [layerName, entry] of Object.entries(index)) {
        if (entry.totalArea > 10000) {
            warnings.push(`Layer "${layerName}" has unusually large area (${entry.totalArea.toFixed(0)} m²). Verify scale.`);
        }
    }

    return {
        index,
        detectedUnit,
        totalLayers: layers.length,
        layersWithArea,
        layersWithLength,
        warnings,
        metadata: {
            totalRows: rows.length,
            totalEntities: rows.reduce((sum, r) => sum + r.count, 0),
            entityTypeBreakdown,
        },
    };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get layer candidates filtered by measure kind
 */
export function getLayerCandidates(
    index: LayerTakeoffIndex,
    measureKind: MeasureKind
): string[] {
    const layers = Object.keys(index);

    switch (measureKind) {
        case 'area':
            return layers.filter(l => index[l].hasReliableArea && index[l].totalArea > 0);
        case 'length':
            return layers.filter(l => index[l].hasReliableLength && index[l].totalLength > 0);
        case 'count':
            return layers.filter(l => index[l].entityCount > 0);
        default:
            return layers;
    }
}

/**
 * Get quantity from takeoff index for a specific layer and measure kind
 */
export function getQuantityFromIndex(
    index: LayerTakeoffIndex,
    layer: string,
    measureKind: MeasureKind
): number | null {
    const entry = index[layer];
    if (!entry) return null;

    switch (measureKind) {
        case 'area':
            return entry.hasReliableArea ? entry.totalArea : null;
        case 'length':
            return entry.hasReliableLength ? entry.totalLength : null;
        case 'count':
            return entry.entityCount;
        default:
            return null;
    }
}

/**
 * Generate a summary of the takeoff index for logging/debugging
 */
export function getTakeoffSummary(result: CSVTakeoffResult): string {
    const lines: string[] = [
        `📊 CSV Takeoff Summary`,
        `├─ Total Rows: ${result.metadata.totalRows}`,
        `├─ Total Entities: ${result.metadata.totalEntities}`,
        `├─ Detected Unit: ${result.detectedUnit}`,
        `├─ Layers: ${result.totalLayers} (${result.layersWithArea} with area, ${result.layersWithLength} with length)`,
    ];

    // Top 5 layers by area
    const byArea = Object.entries(result.index)
        .filter(([, e]) => e.hasReliableArea)
        .sort((a, b) => b[1].totalArea - a[1].totalArea)
        .slice(0, 5);

    if (byArea.length > 0) {
        lines.push(`├─ Top Layers by Area:`);
        for (const [name, entry] of byArea) {
            lines.push(`│  └─ ${name}: ${entry.totalArea.toFixed(2)} m² (${entry.entityTypes.join(', ')})`);
        }
    }

    if (result.warnings.length > 0) {
        lines.push(`└─ ⚠️ Warnings: ${result.warnings.length}`);
        for (const w of result.warnings) {
            lines.push(`   └─ ${w}`);
        }
    }

    return lines.join('\n');
}
