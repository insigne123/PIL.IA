-- Performance Optimization: Add indices for frequently queried columns
-- This migration improves query performance for batch operations

-- Index for staging_rows batch lookups (most common query)
CREATE INDEX IF NOT EXISTS idx_staging_rows_batch_id ON staging_rows(batch_id);

-- Index for batch_files batch lookups
CREATE INDEX IF NOT EXISTS idx_batch_files_batch_id ON batch_files(batch_id);

-- Index for batch_files status filtering
CREATE INDEX IF NOT EXISTS idx_batch_files_status ON batch_files(status);

-- Index for jobs batch_file lookups and status filtering
-- Note: jobs table uses batch_file_id, not batch_id
CREATE INDEX IF NOT EXISTS idx_jobs_batch_file_status ON jobs(batch_file_id, status);

-- Index for staging_rows status filtering (for pricing queries)
CREATE INDEX IF NOT EXISTS idx_staging_rows_status ON staging_rows(status);

-- Note: Pricing-specific index will be added in 20240108_add_pricing.sql migration
-- after the unit_price_ref column is created
