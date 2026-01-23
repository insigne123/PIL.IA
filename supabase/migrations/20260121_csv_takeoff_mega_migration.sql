-- MEGA MIGRATION for CSV Takeoff flow
-- Adds ALL missing columns to staging_rows table to match the StagingRow interface in TypeScript
-- This ensures the direct insert from API route works correctly

-- 1. Core Identification & Types
ALTER TABLE staging_rows ADD COLUMN IF NOT EXISTS layer TEXT;
ALTER TABLE staging_rows ADD COLUMN IF NOT EXISTS excel_sheet TEXT;
ALTER TABLE staging_rows ADD COLUMN IF NOT EXISTS row_type TEXT DEFAULT 'item';
ALTER TABLE staging_rows ADD COLUMN IF NOT EXISTS is_title BOOLEAN DEFAULT FALSE;
ALTER TABLE staging_rows ADD COLUMN IF NOT EXISTS type TEXT; -- measure type (area, length, block)

-- 2. Matching Details & Scores
ALTER TABLE staging_rows ADD COLUMN IF NOT EXISTS match_confidence DOUBLE PRECISION;
ALTER TABLE staging_rows ADD COLUMN IF NOT EXISTS score DOUBLE PRECISION;
ALTER TABLE staging_rows ADD COLUMN IF NOT EXISTS match_source TEXT; -- csv, dxf, etc.
ALTER TABLE staging_rows ADD COLUMN IF NOT EXISTS calc_method TEXT; -- AREA, LENGTH, COUNT
ALTER TABLE staging_rows ADD COLUMN IF NOT EXISTS method_detail TEXT;
ALTER TABLE staging_rows ADD COLUMN IF NOT EXISTS expected_measure_type TEXT;

-- 3. Complex Data Structures (JSONB)
ALTER TABLE staging_rows ADD COLUMN IF NOT EXISTS matched_items JSONB DEFAULT '[]'::jsonb;
ALTER TABLE staging_rows ADD COLUMN IF NOT EXISTS top_candidates JSONB DEFAULT '[]'::jsonb;
ALTER TABLE staging_rows ADD COLUMN IF NOT EXISTS score_breakdown JSONB;
ALTER TABLE staging_rows ADD COLUMN IF NOT EXISTS ambiguous_layers JSONB;
ALTER TABLE staging_rows ADD COLUMN IF NOT EXISTS warnings JSONB DEFAULT '[]'::jsonb;
ALTER TABLE staging_rows ADD COLUMN IF NOT EXISTS suggestions JSONB DEFAULT '[]'::jsonb;

-- 4. Status Flags
ALTER TABLE staging_rows ADD COLUMN IF NOT EXISTS rejected BOOLEAN DEFAULT FALSE;

-- Comments for documentation
COMMENT ON COLUMN staging_rows.layer IS 'Matched layer name';
COMMENT ON COLUMN staging_rows.excel_sheet IS 'Name of the sheet in the Excel file';
COMMENT ON COLUMN staging_rows.row_type IS 'Type of row (item, section_header, etc)';
COMMENT ON COLUMN staging_rows.matched_items IS 'List of items matched to this row';
COMMENT ON COLUMN staging_rows.top_candidates IS 'Top N layer candidates for UI selection';
