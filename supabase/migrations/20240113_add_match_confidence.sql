-- Add match_confidence column to staging_rows table
-- This column stores the numeric confidence score (0.0 to 1.0) from the matching algorithm

ALTER TABLE staging_rows 
ADD COLUMN IF NOT EXISTS match_confidence decimal;

-- Add comment for documentation
COMMENT ON COLUMN staging_rows.match_confidence IS 'Numeric confidence score (0.0-1.0) from fuzzy or AI matching';
