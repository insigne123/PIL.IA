-- EXCEL MAPS
create table if not exists excel_maps (
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

alter table excel_maps enable row level security;

-- Policy
do $$ 
begin
    if not exists (select 1 from pg_policies where policyname = 'Users can see own excel maps') then
        create policy "Users can see own excel maps" on excel_maps
            for all using ( batch_id in (select id from batches where project_id in (select id from projects where user_id = auth.uid()::text)) );
    end if;
end $$;
