-- Add ambiguous_layers column to staging_rows table
-- This column is used to store alternative layer candidates when the match is ambiguous
ALTER TABLE staging_rows 
ADD COLUMN IF NOT EXISTS ambiguous_layers JSONB;

-- Add comment
COMMENT ON COLUMN staging_rows.ambiguous_layers IS 'List of alternative layer candidates when match is ambiguous (score diff < 0.1)';
