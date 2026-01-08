-- Add excel_sheet column to staging_rows
alter table staging_rows 
add column if not exists excel_sheet text;

-- Optional: Add index for performance if filtering by sheet is common
create index if not exists idx_staging_rows_excel_sheet on staging_rows(excel_sheet);
