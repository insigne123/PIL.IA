-- Add is_title column to staging_rows
-- Required for section headers in CSV Takeoff flow

ALTER TABLE staging_rows 
ADD COLUMN IF NOT EXISTS is_title BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN staging_rows.is_title IS 'Indicates if the row is a section header/title';
