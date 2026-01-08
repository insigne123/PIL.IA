-- Add pricing columns to staging_rows
ALTER TABLE staging_rows 
ADD COLUMN IF NOT EXISTS unit_price_ref numeric,
ADD COLUMN IF NOT EXISTS total_price_ref numeric,
ADD COLUMN IF NOT EXISTS price_sources jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS price_confidence text CHECK (price_confidence IN ('high', 'medium', 'low'));

-- Add index for price filtering if needed
CREATE INDEX IF NOT EXISTS idx_staging_rows_price ON staging_rows(total_price_ref);
