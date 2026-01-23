-- Comprehensive migration for CSV Takeoff flow
-- Adds all necessary columns to staging_rows table

-- 1. Add ambiguous_layers (JSONB)
ALTER TABLE staging_rows 
ADD COLUMN IF NOT EXISTS ambiguous_layers JSONB;
COMMENT ON COLUMN staging_rows.ambiguous_layers IS 'List of alternative layer candidates when match is ambiguous (score diff < 0.1)';

-- 2. Add calc_method (TEXT)
ALTER TABLE staging_rows 
ADD COLUMN IF NOT EXISTS calc_method TEXT;
COMMENT ON COLUMN staging_rows.calc_method IS 'Method used for calculation (AREA, LENGTH, COUNT, etc.)';

-- 3. Add score_breakdown (JSONB)
ALTER TABLE staging_rows 
ADD COLUMN IF NOT EXISTS score_breakdown JSONB;
COMMENT ON COLUMN staging_rows.score_breakdown IS 'Detailed breakdown of the match score (semantic, text, keyword, synonym)';

-- 4. Add match_source (TEXT)
ALTER TABLE staging_rows 
ADD COLUMN IF NOT EXISTS match_source TEXT;
COMMENT ON COLUMN staging_rows.match_source IS 'Source of the match (csv, dxf, geometry_service)';
