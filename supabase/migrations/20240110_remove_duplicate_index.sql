-- Migration to remove duplicate index on staging_rows.batch_id
-- The index idx_staging_batch from 20240101_init.sql is redundant with
-- idx_staging_rows_batch_id from 20240109_add_performance_indices.sql

-- Drop the older index (keeping the more descriptively named one)
DROP INDEX IF EXISTS idx_staging_batch;

-- Note: idx_staging_rows_batch_id remains and provides the same functionality
