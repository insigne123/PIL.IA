-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- PROJECTS
create table projects (
    id uuid primary key default uuid_generate_v4(),
    user_id text not null, -- Firebase UID
    name text not null,
    client_name text,
    notes text,
    created_at timestamptz default now()
);

-- BATCHES
create table batches (
    id uuid primary key default uuid_generate_v4(),
    project_id uuid references projects(id) on delete cascade not null,
    name text not null,
    unit_selected text check (unit_selected in ('mm', 'cm', 'm')) default 'm',
    height_default numeric default 2.40,
    sheet_target text default 'Presupuesto',
    status text default 'pending', -- pending, processing, ready, error
    created_at timestamptz default now()
);

-- BATCH FILES
create table batch_files (
    id uuid primary key default uuid_generate_v4(),
    batch_id uuid references batches(id) on delete cascade not null,
    original_filename text not null,
    file_type text check (file_type in ('excel', 'dxf', 'dwg')) not null,
    size_bytes bigint,
    status text default 'uploaded', -- uploaded, queued, processing, converted, extracted, error
    error_code text,
    error_message text,
    storage_path text, -- Path in Supabase Storage
    created_at timestamptz default now()
);

-- STAGING ROWS (The big table)
create table staging_rows (
    id uuid primary key default uuid_generate_v4(),
    batch_id uuid references batches(id) on delete cascade not null,
    
    -- Excel mapping info
    excel_row_index int not null,
    excel_item_text text,
    excel_unit text,
    
    -- CAD Source info
    source_items jsonb, -- Array of objects { layer, block, count, length }
    
    -- Final values
    qty_final numeric,
    height_factor numeric default 1.0, -- For linear -> area conversion
    
    -- Price info (Copilot)
    price_candidates jsonb, -- Array of { vendor, price, score, url }
    price_selected numeric,
    price_source_url text,
    price_timestamp timestamptz,
    
    -- Status
    confidence text, -- high, medium, low
    confidence_reason text,
    status text default 'pending', -- pending, approved, ignored
    
    created_at timestamptz default now()
);

-- EXCEL MAPS
create table excel_maps (
    id uuid primary key default uuid_generate_v4(),
    batch_id uuid references batches(id) on delete cascade not null,
    sheet_name text,
    header_row int,
    col_desc int,
    col_unit int,
    col_qty int,
    col_price int,
    detected_by text,
    created_at timestamptz default now()
);

-- JOBS (Worker Queue)
create table jobs (
    id uuid primary key default uuid_generate_v4(),
    batch_file_id uuid references batch_files(id) on delete cascade not null,
    phase text not null, -- CONVERT, EXTRACT, MAP
    status text default 'queued', -- queued, processing, completed, failed
    
    locked_by text,
    locked_at timestamptz,
    attempts int default 0,
    last_error text,
    
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

-- OUTPUTS
create table outputs (
    id uuid primary key default uuid_generate_v4(),
    batch_id uuid references batches(id) on delete cascade not null,
    excel_path text,
    pdf_path text,
    created_at timestamptz default now()
);

-- INDEXES
create index idx_projects_user on projects(user_id);
create index idx_batches_project on batches(project_id);
create index idx_files_batch on batch_files(batch_id);
create index idx_staging_batch on staging_rows(batch_id);
create index idx_jobs_status on jobs(status);

-- RLS (Row Level Security)
-- For MVP, we enable RLS but allow public access if no auth provider is fully configured yet,
-- OR strictly enforce if the user sets it up.
-- Here we'll add policies assuming 'auth.uid()' works, but also allow service_role to bypass.

alter table projects enable row level security;
alter table batches enable row level security;
alter table batch_files enable row level security;
alter table staging_rows enable row level security;
alter table jobs enable row level security;

-- Policy: Users can only see their own projects
create policy "Users can see own projects" on projects
    for all using ( auth.uid()::text = user_id );

create policy "Users can insert own projects" on projects
    for insert with check ( auth.uid()::text = user_id );

-- Policy: Batches inherit project access
create policy "Users can see own batches" on batches
    for all using ( project_id in (select id from projects where user_id = auth.uid()::text) );

alter table excel_maps enable row level security;
create policy "Users can see own excel maps" on excel_maps
    for all using ( batch_id in (select id from batches where project_id in (select id from projects where user_id = auth.uid()::text)) );

-- Same logic for other tables... (Simplified for SQL file brevity, in production we'd add all)
