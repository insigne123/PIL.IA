-- P2.3: Learning System for User Mappings
-- Stores user-approved Excel→DXF mappings for reuse in future batches

CREATE TABLE IF NOT EXISTS learned_mappings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Excel side (what the user searched for)
  excel_description TEXT NOT NULL,
  excel_unit TEXT NOT NULL,
  excel_normalized TEXT NOT NULL, -- Normalized for fuzzy matching
  
  -- DXF side (what they selected)
  dxf_layer TEXT NOT NULL,
  dxf_type TEXT NOT NULL, -- 'area', 'length', 'block'
  
  -- Metadata
  confidence FLOAT DEFAULT 0.5,
  times_used INTEGER DEFAULT 1,
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Context (for better matching)
  discipline TEXT, -- 'ARQUITECTURA', 'ELECTRICO', 'SANITARIO', etc.
  project_type TEXT, -- For future: 'residential', 'commercial', etc.
  
  -- Subtype info (from P1.5)
  excel_subtype TEXT, -- 'floor_area', 'wall_area', etc.
  
  -- Prevent duplicate mappings
  UNIQUE(user_id, excel_normalized, dxf_layer)
);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_learned_mappings_lookup 
ON learned_mappings(user_id, excel_normalized);

CREATE INDEX IF NOT EXISTS idx_learned_mappings_usage 
ON learned_mappings(user_id, times_used DESC, last_used_at DESC);

CREATE INDEX IF NOT EXISTS idx_learned_mappings_discipline 
ON learned_mappings(user_id, discipline);

-- RLS Policies
ALTER TABLE learned_mappings ENABLE ROW LEVEL SECURITY;

-- Users can only see their own mappings
CREATE POLICY "Users can view own mappings"
ON learned_mappings FOR SELECT
USING (auth.uid() = user_id);

-- Users can insert their own mappings
CREATE POLICY "Users can insert own mappings"
ON learned_mappings FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own mappings
CREATE POLICY "Users can update own mappings"
ON learned_mappings FOR UPDATE
USING (auth.uid() = user_id);

-- Users can delete their own mappings
CREATE POLICY "Users can delete own mappings"
ON learned_mappings FOR DELETE
USING (auth.uid() = user_id);

-- Function to increment usage count
CREATE OR REPLACE FUNCTION increment_mapping_usage(mapping_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE learned_mappings
  SET 
    times_used = times_used + 1,
    last_used_at = NOW()
  WHERE id = mapping_id;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION increment_mapping_usage(UUID) TO authenticated;
