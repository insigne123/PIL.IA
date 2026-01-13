-- Add refined status states for better pending categorization
-- Since status is likely a TEXT/VARCHAR field, no schema changes needed
-- The new status values will be:
--   - 'pending_semantics': Requires human decision (UPS, Pantallas)
--   - 'pending_no_geometry': Insufficient geometry (< 0.5m)
--   - 'pending_no_match': No valid match found
--   - 'pending': Generic pending (backwards compatible)
--   - 'approved': Approved
--   - 'ignored': Ignored

-- Add status_reason column if it doesn't exist
ALTER TABLE staging_rows 
ADD COLUMN IF NOT EXISTS status_reason TEXT;

COMMENT ON COLUMN staging_rows.status_reason IS 'Reason for refined status (e.g., insufficient_geometry, semantic_mismatch)';
