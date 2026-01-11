// Database type definitions
// Auto-generated types for Supabase tables

export interface Project {
    id: string;
    user_id: string;
    name: string;
    client_name: string | null;
    notes: string | null;
    created_at: string;
}

export interface Batch {
    id: string;
    project_id: string;
    name: string;
    unit_selected: 'mm' | 'cm' | 'm';
    height_default: number;
    sheet_target: string;
    status: 'pending' | 'processing' | 'ready' | 'error';
    created_at: string;
    updated_at?: string;
}

export interface BatchFile {
    id: string;
    batch_id: string;
    original_filename: string;
    file_type: 'excel' | 'dxf' | 'dwg';
    size_bytes: number | null;
    status: 'uploaded' | 'queued' | 'processing' | 'converted' | 'extracted' | 'error';
    error_code: string | null;
    error_message: string | null;
    storage_path: string | null;
    storage_json_path?: string | null;
    detected_unit?: string | null;
    created_at: string;
}

export interface SourceItem {
    id: string;
    type: 'block' | 'length' | 'area' | 'text';
    value_m: number;
    evidence: string;
    name_raw: string;
    unit_raw: string;
    layer_raw: string;
    value_raw: number;
    layer_normalized: string;
}

export interface PriceSource {
    url: string;
    price: number;
    title: string;
    vendor: string;
}

export interface StagingRow {
    id: string;
    batch_id: string;
    excel_row_index: number;
    excel_item_text: string | null;
    excel_unit: string | null;
    source_items: SourceItem[] | null;
    qty_final: number | null;
    height_factor: number;
    price_candidates: any[] | null;
    price_selected: number | null;
    price_source_url: string | null;
    price_timestamp: string | null;
    confidence: 'high' | 'medium' | 'low' | null;
    match_reason: string | null;
    status: 'pending' | 'approved' | 'ignored';
    unit_price_ref: number | null;
    total_price_ref: number | null;
    price_sources: PriceSource[] | null;
    price_confidence: 'high' | 'medium' | 'low' | null;
    created_at: string;
}

export interface ExcelMap {
    id: string;
    batch_id: string;
    sheet_name: string | null;
    header_row: number | null;
    col_desc: number | null;
    col_unit: number | null;
    col_qty: number | null;
    col_price: number | null;
    detected_by: string | null;
    created_at: string;
}

export interface Job {
    id: string;
    batch_file_id: string;
    phase: 'CONVERT' | 'EXTRACT' | 'MAP' | 'GENERATE';
    status: 'queued' | 'processing' | 'completed' | 'failed';
    locked_by: string | null;
    locked_at: string | null;
    attempts: number;
    last_error: string | null;
    created_at: string;
    updated_at: string;
}

export interface Output {
    id: string;
    batch_id: string;
    excel_path: string | null;
    pdf_path: string | null;
    created_at: string;
}

// Type guards for runtime validation
export function isSourceItem(obj: any): obj is SourceItem {
    return (
        typeof obj === 'object' &&
        obj !== null &&
        typeof obj.id === 'string' &&
        ['block', 'length', 'area', 'text'].includes(obj.type) &&
        typeof obj.value_m === 'number'
    );
}

export function isPriceSource(obj: any): obj is PriceSource {
    return (
        typeof obj === 'object' &&
        obj !== null &&
        typeof obj.url === 'string' &&
        typeof obj.price === 'number' &&
        typeof obj.title === 'string' &&
        typeof obj.vendor === 'string'
    );
}
