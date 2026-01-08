-- Add missing column to batch_files table
-- This column is referenced in worker/pipeline.ts but was missing from the original schema

alter table batch_files add column if not exists storage_json_path text;
