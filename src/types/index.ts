export type Unit = 'mm' | 'cm' | 'm';

// M2/M5: Extracted from CAD
export interface ItemDetectado {
  id: string; // uuid
  type: 'block' | 'length';
  name_raw: string;
  name_effective?: string; // For dynamic blocks
  layer_raw: string;
  layer_normalized: string;
  value_raw: number; // Count or Length in original unit
  unit_raw: Unit;
  value_m: number; // Normalized to meters or count
  evidence?: string; // 'ATTRIB', 'MTEXT vicinity', etc.
}

// M7/M9: Price Source
export interface PriceSource {
  price: number;
  currency: string;
  source_url?: string;
  date_fetched: string;
  confidence: number;
  vendor?: string;
}

// M10: Staging Row (The core data structure for the UI)
export interface StagingRow {
  id: string; // uuid for React keys
  batchId: string;

  // Excel Context
  excel_sheet: string;
  excel_row_index: number;
  excel_item_text: string; // Description from Excel
  excel_unit: string; // Unit from Excel (could be 'gl', 'un', 'm', 'm2')

  // Mapping Result
  source_items: ItemDetectado[]; // Items contributing to this row
  // aggregation_rule: 'sum' | 'count'; // usually sum

  // User Edits / Final State
  qty_final: number; // The value to write to Excel
  height_factor?: number; // For m -> m2 conversion (default 2.4 or user override)

  unit_final?: string; // Normalized unit to write if Excel was empty

  price_selected?: number;
  price_candidates: PriceSource[];

  confidence: string; // high, medium, low
  confidence_reason?: string;
  status: 'pending' | 'approved' | 'ignored';
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
  status: 'pending' | 'processing' | 'ready' | 'error';
  createdAt: string;
}

export interface BatchFile {
  id: string;
  batchId: string;
  originalName: string;
  fileType: 'dwg' | 'dxf' | 'excel';
  size: number;
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
