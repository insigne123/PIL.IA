-- Add price_metadata column to staging_rows table
-- This column stores additional pricing information for auditing and debugging

ALTER TABLE staging_rows
ADD COLUMN IF NOT EXISTS price_metadata JSONB;

-- Add comment to explain the column
COMMENT ON COLUMN staging_rows.price_metadata IS 'Metadata about pricing calculation including AI suggested price, calculated average, minimum price, source count, and price range';
