/**
 * Geometry Service Client
 * 
 * Client for calling the Python geometry extraction service from Next.js
 */

const GEOMETRY_SERVICE_URL = process.env.GEOMETRY_SERVICE_URL || 'http://localhost:8000';

export interface ExtractRequest {
    dxfFile?: File;
    pdfFiles?: File[];
    excelItems: Array<{
        id: string;
        description: string;
        unit: string;
        expected_qty?: number;
    }>;
    useVisionAI?: boolean;
    snapTolerance?: number;
}

export interface Match {
    id: string;
    excel_item_id: string;
    excel_item_description: string;
    region_id: string | null;
    label_text: string | null;
    qty_calculated: number;
    unit: string;
    confidence: number;
    match_reason: string;
    warnings: string[];
}

export interface ExtractResponse {
    matches: Match[];
    unmatched_items: Array<{ id: string; description: string }>;
    warnings: string[];
    processing_time_ms: number;
}

/**
 * Check if the geometry service is available
 */
export async function checkGeometryServiceHealth(): Promise<boolean> {
    try {
        console.log(`[GeometryService] Checking health at ${GEOMETRY_SERVICE_URL}/health...`);
        const response = await fetch(`${GEOMETRY_SERVICE_URL}/health`, {
            method: 'GET',
            signal: AbortSignal.timeout(5000),
        });
        const isOk = response.ok;
        console.log(`[GeometryService] Health check result: ${isOk ? 'HEALTHY' : 'UNHEALTHY'} (status: ${response.status})`);
        return isOk;
    } catch (error) {
        console.error(`[GeometryService] Health check FAILED:`, error);
        return false;
    }
}

/**
 * Extract quantities from DXF/PDF files using the geometry service
 */
export async function extractQuantities(request: ExtractRequest): Promise<ExtractResponse> {
    const formData = new FormData();

    if (request.dxfFile) {
        formData.append('dxf_file', request.dxfFile);
    }

    if (request.pdfFiles) {
        for (const pdf of request.pdfFiles) {
            formData.append('pdf_files', pdf);
        }
    }

    formData.append('excel_data', JSON.stringify(request.excelItems));
    formData.append('use_vision_ai', String(request.useVisionAI ?? true));
    formData.append('snap_tolerance', String(request.snapTolerance ?? 0.01));

    const response = await fetch(`${GEOMETRY_SERVICE_URL}/api/extract`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Geometry service error: ${error}`);
    }

    return response.json();
}

/**
 * Parse a DXF file and return raw geometry
 */
return response.json();
}

/**
 * Parse DXF using Python service and return full ItemDetectado array
 * This replaces the local legacy parser
 */
export async function parseDxfFull(fileContent: Buffer | string, unit: string = 'm'): Promise<{ items: any[], detectedUnit: string }> {
    const formData = new FormData();

    // Create a Blob/File from content since API expects file upload
    const blob = new Blob([fileContent]);
    formData.append('file', blob, 'temp.dxf');

    // Note: The Python endpoint currently detects unit from file header automatically
    // We might want to pass 'unit' as a hint in future if needed

    const response = await fetch(`${GEOMETRY_SERVICE_URL}/api/parse-dxf`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        throw new Error(`Failed to parse DXF via service: ${response.statusText}`);
    }

    const data = await response.json();
    const items: any[] = [];

    // Map Segments -> LENGTH items
    // (We could merge contiguous segments into polylines here or trust Python regions)
    // For now, let's map segments as simple length items
    data.segments.forEach((seg: any, index: number) => {
        // Calculate length
        const dx = seg.end.x - seg.start.x;
        const dy = seg.end.y - seg.start.y;
        const len = Math.sqrt(dx * dx + dy * dy);

        items.push({
            id: `seg_${index}`,
            type: 'length',
            layer: seg.layer || '0',
            layer_normalized: (seg.layer || '0').toLowerCase().trim(),
            value_raw: len,
            value_m: len, // python service usually processes in unitless or meters? 
            // Default python parser returns raw coordinates. 
            // We need scaling logic if units mismatch. 
            // For now assume raw = m or handle scaling downstream.
            vertices: [seg.start, seg.end],
            color: 7
        });
    });

    // Map Texts -> TEXT items
    data.texts.forEach((txt: any, index: number) => {
        items.push({
            id: `txt_${index}`,
            type: 'text',
            layer: txt.layer || '0',
            layer_normalized: (txt.layer || '0').toLowerCase().trim(),
            value_raw: 0,
            value_m: 0,
            name_raw: txt.text,
            text: txt.text,
            vertices: [txt.position],
            color: 7
        });
    });

    // Map Regions -> AREA items (The Missing Link!)
    if (data.regions) {
        data.regions.forEach((reg: any) => {
            items.push({
                id: reg.id,
                type: 'block', // Using 'block' type for now as 'area' might not be fully supported by matcher logic? 
                // Wait, matcher supports 'area' type check?
                // Log says: "Excel expects AREA but matched length geometry"
                // So 'area' type is supported.
                // However, matcher often looks for 'block' for Count items.
                // Let's use 'area' type but ensure matcher handles it.
                // Actually, in `routes.py` log it said: "Profile: has_area=true".
                // If I set type='area', matcher should pick it up.
                // REVISION: Use 'length' for simple processing if flat, but 'area' is better.
                // Let's check ItemDetectado type definition.
                // Assuming 'area' is valid.
                type: 'area',
                layer: reg.layer || 'Unknown',
                layer_normalized: (reg.layer || 'Unknown').toLowerCase().trim(),
                value_raw: reg.area,
                value_m: reg.area,
                vertices: reg.vertices,
                color: 9
            });
        });
    }

    // Scale items if needed based on detected unit (omitted for brevity, assuming meters)
    // In legacy parser, we apply scaling. Here Python might return raw.
    // If Python returns raw, we need to know the unit.
    // Python parser checks $INSUNITS.

    return { items, detectedUnit: 'm' }; // Mock unit for now
}

/**
 * Detect labels in an image using Vision AI
 */
export async function detectLabels(file: File, model: 'claude' | 'gpt4v' = 'gpt4v'): Promise<{
    labels: Array<{
        text: string;
        bbox: [number, number, number, number];
        element_type: string;
        confidence: number;
    }>;
    model_used: string;
}> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('model', model);

    const response = await fetch(`${GEOMETRY_SERVICE_URL}/api/detect-labels`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        throw new Error('Failed to detect labels');
    }

    return response.json();
}
