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
        const response = await fetch(`${GEOMETRY_SERVICE_URL}/health`, {
            method: 'GET',
            signal: AbortSignal.timeout(5000),
        });
        return response.ok;
    } catch {
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
export async function parseDxf(file: File): Promise<{
    segments: number;
    texts: number;
    layers: string[];
    bounds: { min_x: number; min_y: number; max_x: number; max_y: number };
}> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${GEOMETRY_SERVICE_URL}/api/parse-dxf`, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        throw new Error('Failed to parse DXF');
    }

    return response.json();
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
