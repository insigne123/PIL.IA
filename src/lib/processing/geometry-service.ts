/**
 * Geometry Service Client
 * 
 * Client for calling the Python geometry extraction service from Next.js
 */

const GEOMETRY_SERVICE_URL = process.env.GEOMETRY_SERVICE_URL || 'http://127.0.0.1:8000'; // Explicit IPv4 for Windows

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
    unit_factor?: number;
    detected_unit?: string;
    unit_confidence?: string;
}

/**
 * Check if the geometry service is available
 */
export async function checkGeometryServiceHealth(): Promise<boolean> {
    try {
        console.log(`[GeometryService] Checking health at ${GEOMETRY_SERVICE_URL}/health...`);
        const response = await fetch(`${GEOMETRY_SERVICE_URL}/health`, {
            method: 'GET',
            signal: AbortSignal.timeout(10000),
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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes

    try {
        const response = await fetch(`${GEOMETRY_SERVICE_URL}/api/extract`, {
            method: 'POST',
            body: formData,
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Geometry service error: ${error}`);
        }

        return response.json();
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
}


/**
 * Parse DXF using Python service and return full ItemDetectado array
 * This replaces the local legacy parser
 */
export async function parseDxfFull(fileContent: Buffer | string, unit: string = 'm'): Promise<{ items: any[], detectedUnit: string, unitConfidence: string, unitFactor: number, blockMetadata?: any }> {
    const formData = new FormData();

    // Create a Blob/File from content since API expects file upload
    const blobContent = typeof fileContent === 'string' ? fileContent : new Uint8Array(fileContent);
    const blob = new Blob([blobContent]);
    const blob = new Blob([blobContent]);
    formData.append('file', blob, 'temp.dxf');
    formData.append('hint_unit', unit); // Send explicit hint

    // Note: The Python endpoint currently detects unit from file header automatically
    // We might want to pass 'unit' as a hint in future if needed


    // Optimize: Set 5-minute timeout for large DXF processing
    // (Optimization Phase 9: Prevent 'HeadersTimeoutError' fallback)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes

    let data;
    try {
        const response = await fetch(`${GEOMETRY_SERVICE_URL}/api/parse-dxf`, {
            method: 'POST',
            body: formData,
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`Failed to parse DXF via service: ${response.statusText}`);
        }

        data = await response.json();
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }

    const items: any[] = [];

    // Map Segments -> LENGTH items
    // (We could merge contiguous segments into polylines here or trust Python regions)
    // For now, let's map segments as simple length items
    if (data.segments) {
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
                value_m: len,
                vertices: [seg.start, seg.end],
                color: 7,
                // 11.1: Map Layer Analysis
                layerAnalysis: data.layer_metadata ? ((data.layer_metadata[seg.layer] || data.layer_metadata[seg.layer.toUpperCase()]) as any) : undefined
            });
        });
    }

    // Map Texts -> TEXT items
    if (data.texts) {
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
                color: 7,
                layerAnalysis: data.layer_metadata ? ((data.layer_metadata[txt.layer] || data.layer_metadata[txt.layer.toUpperCase()]) as any) : undefined
            });
        });
    }

    // Map Regions -> AREA items
    if (data.regions) {
        data.regions.forEach((reg: any) => {
            items.push({
                id: reg.id,
                type: 'area',
                layer: reg.layer || 'Unknown',
                layer_normalized: (reg.layer || 'Unknown').toLowerCase().trim(),
                value_raw: reg.area,
                value_m: reg.area,
                vertices: reg.vertices,
                color: 9,
                layerAnalysis: data.layer_metadata ? ((data.layer_metadata[reg.layer] || data.layer_metadata[reg.layer.toUpperCase()]) as any) : undefined
            });
        });
    }

    // 11.3 Map Blocks -> BLOCK items
    if (data.inserts) {
        data.inserts.forEach((ins: any, index: number) => {
            const blockStats = data.block_metadata ? data.block_metadata[ins.name] : undefined;

            items.push({
                id: `blk_${index}_${Math.random().toString(36).substr(2, 5)}`,
                type: 'block',
                name_raw: ins.name,
                layer: ins.layer || '0',
                layer_normalized: (ins.layer || '0').toLowerCase().trim(),
                value_raw: 1, // Count = 1
                value_si: 1,  // Count = 1
                value_m: 1,   // Legacy count
                // P1.2 Block Transform: Area = DefArea * |ScaleX * ScaleY|
                value_area: blockStats ? blockStats.area * Math.abs((ins.scale_x ?? 1) * (ins.scale_y ?? 1)) : undefined,
                vertices: [ins.position],
                color: 5,
                unit_raw: 'u',
                layerAnalysis: data.layer_metadata ? ((data.layer_metadata[ins.layer] || data.layer_metadata[ins.layer.toUpperCase()]) as any) : undefined
            });
        });
    }

    // Scale items if needed based on detected unit (omitted for brevity, assuming meters)
    // In legacy parser, we apply scaling. Here Python might return raw.
    // If Python returns raw, we need to know the unit.
    // Python parser checks $INSUNITS.

    return {
        items,
        detectedUnit: data.detected_unit || 'm',
        unitConfidence: data.unit_confidence || 'Low', // NEW
        unitFactor: data.unit_factor || 1.0,           // NEW
        blockMetadata: data.block_metadata
    };
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
