-- Add detected_unit column to batch_files for mismatch detection
alter table batch_files 
add column if not exists detected_unit text check (detected_unit in ('mm', 'cm', 'm'));

comment on column batch_files.detected_unit is 'Unit detected from DXF $INSUNITS header';
