-- Migration: Add batch versioning system
-- Purpose: Track changes and enable comparison between versions

-- BATCH VERSIONS TABLE
create table batch_versions (
    id uuid primary key default uuid_generate_v4(),
    batch_id uuid references batches(id) on delete cascade not null,
    
    version_number int not null,
    snapshot jsonb not null, -- Complete state of staging_rows
    
    -- Metadata
    changes_summary text,
    created_by text not null,
    created_at timestamptz default now(),
    
    -- Constraints
    unique(batch_id, version_number)
);

create index idx_versions_batch on batch_versions(batch_id, version_number desc);
create index idx_versions_created on batch_versions(created_at desc);

-- VERSION COMPARISONS TABLE (optional, for caching comparisons)
create table version_comparisons (
    id uuid primary key default uuid_generate_v4(),
    version_from uuid references batch_versions(id) on delete cascade not null,
    version_to uuid references batch_versions(id) on delete cascade not null,
    
    -- Diff summary
    items_added int default 0,
    items_removed int default 0,
    items_modified int default 0,
    
    total_price_change numeric,
    total_qty_change numeric,
    
    -- Detailed diff (JSON)
    diff_details jsonb,
    
    created_at timestamptz default now(),
    
    unique(version_from, version_to)
);

create index idx_comparisons_versions on version_comparisons(version_from, version_to);

-- RLS POLICIES
alter table batch_versions enable row level security;
alter table version_comparisons enable row level security;

-- Users can see versions for their batches
create policy "Users can see own batch versions" on batch_versions
    for all using (
        batch_id in (
            select b.id from batches b
            join projects p on p.id = b.project_id
            where p.user_id = auth.uid()::text
        )
    );

-- Users can see comparisons for their versions
create policy "Users can see own version comparisons" on version_comparisons
    for all using (
        version_from in (
            select v.id from batch_versions v
            join batches b on b.id = v.batch_id
            join projects p on p.id = b.project_id
            where p.user_id = auth.uid()::text
        )
    );

-- FUNCTIONS

-- Function to create automatic snapshot
create or replace function create_batch_snapshot(
    p_batch_id uuid,
    p_summary text,
    p_user_id text
)
returns uuid as $$
declare
    v_version_number int;
    v_snapshot jsonb;
    v_version_id uuid;
begin
    -- Get next version number
    select coalesce(max(version_number), 0) + 1
    into v_version_number
    from batch_versions
    where batch_id = p_batch_id;
    
    -- Create snapshot of current staging_rows
    select jsonb_agg(row_to_json(sr))
    into v_snapshot
    from staging_rows sr
    where sr.batch_id = p_batch_id;
    
    -- Insert version
    insert into batch_versions (
        batch_id,
        version_number,
        snapshot,
        changes_summary,
        created_by
    ) values (
        p_batch_id,
        v_version_number,
        v_snapshot,
        p_summary,
        p_user_id
    )
    returning id into v_version_id;
    
    return v_version_id;
end;
$$ language plpgsql;

-- Function to restore a version
create or replace function restore_batch_version(
    p_version_id uuid,
    p_user_id text
)
returns void as $$
declare
    v_batch_id uuid;
    v_snapshot jsonb;
    v_elem jsonb;
begin
    -- Get version data
    select batch_id, snapshot
    into v_batch_id, v_snapshot
    from batch_versions
    where id = p_version_id;
    
    if v_batch_id is null then
        raise exception 'Version not found';
    end if;
    
    -- Create backup of current state first
    perform create_batch_snapshot(
        v_batch_id,
        'Auto-backup before restore',
        p_user_id
    );
    
    -- Delete current staging rows
    delete from staging_rows where batch_id = v_batch_id;
    
    -- Restore from snapshot with new UUIDs to avoid conflicts
    insert into staging_rows (
        id, batch_id, excel_row_index, excel_item_text, excel_unit,
        source_items, qty_final, height_factor, price_candidates,
        price_selected, price_source_url, price_timestamp,
        confidence, confidence_reason, status, created_at,
        unit_price_ref, total_price_ref, price_sources, price_confidence,
        match_confidence, match_reason, excel_sheet
    )
    select 
        uuid_generate_v4(),  -- Generate new UUID to avoid conflicts
        v_batch_id,  -- Ensure correct batch_id
        (elem->>'excel_row_index')::int,
        elem->>'excel_item_text',
        elem->>'excel_unit',
        (elem->'source_items')::jsonb,
        (elem->>'qty_final')::numeric,
        (elem->>'height_factor')::numeric,
        (elem->'price_candidates')::jsonb,
        (elem->>'price_selected')::numeric,
        elem->>'price_source_url',
        (elem->>'price_timestamp')::timestamptz,
        elem->>'confidence',
        elem->>'confidence_reason',
        elem->>'status',
        coalesce((elem->>'created_at')::timestamptz, now()),
        (elem->>'unit_price_ref')::numeric,
        (elem->>'total_price_ref')::numeric,
        (elem->'price_sources')::jsonb,
        elem->>'price_confidence',
        (elem->>'match_confidence')::numeric,
        elem->>'match_reason',
        elem->>'excel_sheet'
    from jsonb_array_elements(v_snapshot) as elem;
    
    -- Update batch status (removed updated_at as it may not exist)
    update batches
    set status = 'ready'
    where id = v_batch_id;
end;
$$ language plpgsql;

-- Trigger to auto-create version on significant changes
create or replace function auto_snapshot_on_export()
returns trigger as $$
begin
    if new.status = 'completed' and old.status != 'completed' then
        perform create_batch_snapshot(
            new.id,
            'Auto-snapshot on export',
            auth.uid()::text
        );
    end if;
    return new;
end;
$$ language plpgsql;

create trigger trigger_auto_snapshot
    after update on batches
    for each row
    when (new.status = 'completed')
    execute function auto_snapshot_on_export();

-- Comments
comment on table batch_versions is 'Stores snapshots of batch state for version control';
comment on table version_comparisons is 'Caches comparison results between versions';
comment on function create_batch_snapshot is 'Creates a new version snapshot of a batch';
comment on function restore_batch_version is 'Restores a batch to a previous version';
