-- Add match_reason column to staging_rows for AI traceability
alter table staging_rows 
add column if not exists match_reason text;

comment on column staging_rows.match_reason is 'Explanation of why the AI selected the matched layers';
