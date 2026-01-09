-- Performance Optimization: Add indices for frequently queried columns
-- This migration improves query performance for batch operations

-- Index for staging_rows batch lookups (most common query)
CREATE INDEX IF NOT EXISTS idx_staging_rows_batch_id ON staging_rows(batch_id);

-- Index for batch_files batch lookups
CREATE INDEX IF NOT EXISTS idx_batch_files_batch_id ON batch_files(batch_id);

-- Index for batch_files status filtering
CREATE INDEX IF NOT EXISTS idx_batch_files_status ON batch_files(status);

-- Index for jobs batch lookups and status filtering
CREATE INDEX IF NOT EXISTS idx_jobs_batch_status ON jobs(batch_id, status);

-- Index for staging_rows status filtering (for pricing queries)
CREATE INDEX IF NOT EXISTS idx_staging_rows_status ON staging_rows(status);

-- Composite index for pricing queries (batch + status + null price)
CREATE INDEX IF NOT EXISTS idx_staging_rows_pricing 
ON staging_rows(batch_id, status) 
WHERE unit_price_ref IS NULL;
