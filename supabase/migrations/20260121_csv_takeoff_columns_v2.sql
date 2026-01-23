-- Add remaining missing columns for CSV Takeoff flow
-- These were missed in the previous migration

-- 1. Add expected_measure_type (TEXT)
ALTER TABLE staging_rows 
ADD COLUMN IF NOT EXISTS expected_measure_type TEXT;
COMMENT ON COLUMN staging_rows.expected_measure_type IS 'Expected measure type derived from Excel classification (AREA, LENGTH, BLOCK)';

-- 2. Add method_detail (TEXT)
ALTER TABLE staging_rows 
ADD COLUMN IF NOT EXISTS method_detail TEXT;
COMMENT ON COLUMN staging_rows.method_detail IS 'Additional detail about the method used (e.g., csv_takeoff)';
