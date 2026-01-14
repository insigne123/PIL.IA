export type Unit = 'mm' | 'cm' | 'm' | 'm²';

// M2/M5: Extracted from CAD
export interface ItemDetectado {
  id: string; // uuid
  type: 'block' | 'length' | 'text' | 'area';
  name_raw: string;
  name_effective?: string; // For dynamic blocks
  layer_raw: string;
  layer_normalized: string;
  value_raw: number; // Count or Length in original unit
  unit_raw: Unit | 'txt' | 'u';
  value_m: number; // Normalized to meters or count
  evidence?: string; // 'ATTRIB', 'MTEXT vicinity', etc.
  // Layer resolution metadata
  layer_metadata?: {
    original: string;
    resolved: string;
    block_name?: string;
  };
  // Suspect geometry flagging
  suspect_geometry?: boolean;
  suspect_reason?: string;
  geometry_threshold?: number;
}

// Unified Price Source
export interface PriceSource {
  price: number;
  currency?: string;
  url?: string; // Standard URL field
  source_url?: string; // Legacy
  date_fetched?: string;
  confidence?: number | 'high' | 'medium' | 'low';
  vendor: string;
  title: string;
}

// M10: Staging Row (The core data structure for the UI)
export interface StagingRow {
  id: string; // uuid for React keys
  batchId?: string; // Optional as some internal flows might not set it immediately

  // Excel Context
  excel_sheet: string;
  excel_row_index: number;
  excel_item_text: string; // Description from Excel
  excel_unit: string; // Unit from Excel (could be 'gl', 'un', 'm', 'm2')

  // Mapping Result
  source_items: ItemDetectado[]; // Items contributing to this row
  matched_items?: ItemDetectado[]; // Compability alias

  // aggregation_rule: 'sum' | 'count'; // usually sum

  // User Edits / Final State
  qty_final: number | null; // null = couldn't measure, 0 = measured as zero, >0 = valid
  raw_qty?: number; // What was actually measured before sanity checks
  sanity_flag?: string; // Reason if qty_final was nullified (e.g., 'insufficient_geometry')
  height_factor?: number; // For m -> m2 conversion (default 2.4 or user override)

  unit_final?: string; // Normalized unit to write if Excel was empty

  price_selected?: number; // Deprecated? Used for manual override maybe?

  // Pricing Fields (New)
  unit_price_ref?: number;
  total_price_ref?: number;
  price_sources?: PriceSource[];
  price_candidates?: PriceSource[]; // Added for compatibility

  price_confidence?: 'high' | 'medium' | 'low';

  confidence: string; // high, medium, low
  match_confidence?: number; // Numeric confidence score

  match_reason?: string; // AI reasoning
  confidence_reason?: string;
  status: 'pending' | 'approved' | 'ignored' | 'pending_semantics' | 'pending_no_geometry' | 'pending_no_match';
  status_reason?: string; // Reason for refined status
  suggestions?: Suggestion[]; // Actionable suggestions for pending items

  // Calculation method (deterministic)
  calc_method?: 'COUNT' | 'LENGTH' | 'AREA' | 'GLOBAL';
  method_detail?: string; // 'block_count' | 'polyline_length' | 'hatch_area' | etc.
}

export interface Suggestion {
  id: string; // unique
  action_type: 'SELECT_ALT_LAYER' | 'MARK_GLOBAL' | 'SPLIT_ITEM' | 'MANUAL_QTY' | 'RETRY_EXTRACTION';
  label: string;
  payload?: any;
  confidence?: 'high' | 'medium' | 'low';
}

// M1: Project & Batch
export interface Project {
  id: string;
  name: string;
  client: string;
  notes?: string;
  createdAt: string;
}

export interface Batch {
  id: string;
  projectId: string;
  name: string;
  unitSelected: Unit;
  heightDefault: number;
  sheetTarget: string;
  status: 'pending' | 'processing' | 'ready' | 'completed' | 'error' | 'waiting_review';
  createdAt: string;
}

export interface BatchFile {
  id: string;
  batchId: string;
  originalName: string;
  fileType: 'dwg' | 'dxf' | 'excel';
  size: number;
  detectedUnit?: Unit;
  status: 'uploaded' | 'queued' | 'processing' | 'converted' | 'extracted' | 'error';
  errorCode?: string;
  errorMessage?: string;
  storagePath: string;
  createdAt: string;
}

export interface ExcelStructure {
  headerRow: number;
  columns: {
    description: number;
    unit: number;
    qty: number;
    price: number;
  };
  sheetName: string;
}
