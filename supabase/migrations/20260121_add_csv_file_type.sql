-- Add CSV file type support to batch_files table
-- Migration: Add 'csv' to file_type check constraint

-- Drop the old constraint
ALTER TABLE batch_files DROP CONSTRAINT IF EXISTS batch_files_file_type_check;

-- Add new constraint with 'csv' included
ALTER TABLE batch_files ADD CONSTRAINT batch_files_file_type_check 
    CHECK (file_type IN ('excel', 'dxf', 'dwg', 'csv'));
