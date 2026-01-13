-- Add suggestions column to staging_rows
alter table staging_rows 
add column if not exists suggestions jsonb;

-- Comment on column
comment on column staging_rows.suggestions is 'List of suggested actions for pending items (e.g. Select Alt Layer, Split Item)';
