-- Migration: Add matching feedback and metrics tables
-- Purpose: Enable learning from user corrections and track system performance

-- MATCHING FEEDBACK TABLE
-- Captures user corrections to improve matching over time
create table matching_feedback (
    id uuid primary key default uuid_generate_v4(),
    batch_id uuid references batches(id) on delete cascade not null,
    
    -- Original suggestion
    excel_item_text text not null,
    excel_unit text,
    suggested_match_id text, -- JSON path to suggested CAD item
    suggested_confidence numeric,
    
    -- User correction
    actual_match_id text, -- JSON path to actual CAD item chosen
    correction_type text check (correction_type in ('accept', 'reject', 'modify', 'manual')),
    
    -- Context
    user_id text not null,
    session_id text,
    
    created_at timestamptz default now()
);

create index idx_feedback_batch on matching_feedback(batch_id);
create index idx_feedback_user on matching_feedback(user_id);
create index idx_feedback_created on matching_feedback(created_at);

-- Composite indexes for common queries
create index idx_feedback_user_created on matching_feedback(user_id, created_at desc);
create index idx_feedback_batch_correction on matching_feedback(batch_id, correction_type) 
    where correction_type = 'accept';

-- BATCH METRICS TABLE
-- Track performance, quality, and costs per batch
create table batch_metrics (
    id uuid primary key default uuid_generate_v4(),
    batch_id uuid references batches(id) on delete cascade not null,
    
    -- Performance metrics (milliseconds)
    processing_time_ms int,
    matching_time_ms int,
    pricing_time_ms int,
    validation_time_ms int,
    
    -- Quality metrics
    total_items int not null,
    auto_matched int default 0,
    manual_corrections int default 0,
    validation_errors int default 0,
    validation_warnings int default 0,
    
    -- Matching accuracy
    high_confidence_matches int default 0, -- >0.8
    medium_confidence_matches int default 0, -- 0.4-0.8
    low_confidence_matches int default 0, -- <0.4
    
    -- Pricing metrics
    items_with_price int default 0,
    avg_price_confidence numeric,
    price_cache_hits int default 0,
    price_api_calls int default 0,
    
    -- Cost tracking
    ai_tokens_used int default 0,
    search_api_calls int default 0,
    estimated_cost_usd numeric default 0,
    
    -- Post-processing accuracy (updated after user review)
    matching_accuracy numeric, -- % of correct matches
    pricing_accuracy numeric, -- % of accurate prices
    
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create index idx_metrics_batch on batch_metrics(batch_id);
create index idx_metrics_created on batch_metrics(created_at);

-- Composite index for dashboard queries
create index idx_metrics_batch_created on batch_metrics(batch_id, created_at desc);

-- PRICE CACHE TABLE
-- Cache pricing results to reduce API calls and improve speed
create table price_cache (
    id uuid primary key default uuid_generate_v4(),
    
    -- Item identification
    item_normalized text not null, -- Normalized description
    unit text,
    
    -- Pricing data
    average_price numeric not null,
    currency text default 'CLP',
    sources jsonb, -- Array of PriceSource objects
    confidence text check (confidence in ('high', 'medium', 'low')),
    
    -- Cache metadata
    last_updated timestamptz default now(),
    hit_count int default 0,
    
    created_at timestamptz default now()
);

create index idx_price_cache_item on price_cache(item_normalized, unit);
create index idx_price_cache_updated on price_cache(last_updated);
create index idx_price_cache_hits on price_cache(hit_count desc);

-- VALIDATION RULES TABLE
-- Store configurable validation rules
create table validation_rules (
    id uuid primary key default uuid_generate_v4(),
    
    name text not null,
    description text,
    rule_type text check (rule_type in ('range', 'ratio', 'consistency', 'business')) not null,
    
    -- Rule configuration (JSON)
    config jsonb not null,
    
    -- Severity
    severity text check (severity in ('error', 'warning', 'info')) default 'warning',
    
    -- Scope
    enabled boolean default true,
    user_id text, -- null = global rule
    
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create index idx_validation_rules_enabled on validation_rules(enabled) where enabled = true;
create index idx_validation_rules_user on validation_rules(user_id);

-- VALIDATION RESULTS TABLE
-- Store validation results for each staging row
create table validation_results (
    id uuid primary key default uuid_generate_v4(),
    
    staging_row_id uuid not null, -- references staging_rows(id) but no FK to allow cleanup
    batch_id uuid references batches(id) on delete cascade not null,
    rule_id uuid references validation_rules(id) on delete cascade,
    
    -- Result
    passed boolean not null,
    severity text not null,
    message text,
    details jsonb,
    
    -- Override
    overridden boolean default false,
    override_reason text,
    override_by text,
    override_at timestamptz,
    
    created_at timestamptz default now()
);

create index idx_validation_results_staging on validation_results(staging_row_id);
create index idx_validation_results_batch on validation_results(batch_id);
create index idx_validation_results_failed on validation_results(passed) where passed = false;

-- RLS POLICIES
alter table matching_feedback enable row level security;
alter table batch_metrics enable row level security;
alter table price_cache enable row level security;
alter table validation_rules enable row level security;
alter table validation_results enable row level security;

-- Users can see their own feedback
create policy "Users can see own feedback" on matching_feedback
    for all using (
        batch_id in (
            select b.id from batches b
            join projects p on p.id = b.project_id
            where p.user_id = auth.uid()::text
        )
    );

-- Users can see metrics for their batches
create policy "Users can see own metrics" on batch_metrics
    for all using (
        batch_id in (
            select b.id from batches b
            join projects p on p.id = b.project_id
            where p.user_id = auth.uid()::text
        )
    );

-- Price cache is readable by all authenticated users
create policy "Authenticated users can read price cache" on price_cache
    for select using (auth.role() = 'authenticated');

-- Only service role can write to price cache
create policy "Service role can write price cache" on price_cache
    for insert with check (auth.role() = 'service_role');

-- Users can see global rules and their own rules
create policy "Users can see validation rules" on validation_rules
    for select using (
        enabled = true and (
            user_id is null or 
            user_id = auth.uid()::text
        )
    );

-- Users can manage their own rules
create policy "Users can manage own validation rules" on validation_rules
    for all using (user_id = auth.uid()::text);

-- Users can see validation results for their batches
create policy "Users can see own validation results" on validation_results
    for all using (
        batch_id in (
            select b.id from batches b
            join projects p on p.id = b.project_id
            where p.user_id = auth.uid()::text
        )
    );

-- FUNCTIONS

-- Function to update batch metrics
create or replace function update_batch_metrics()
returns trigger as $$
begin
    update batch_metrics
    set updated_at = now()
    where batch_id = new.batch_id;
    return new;
end;
$$ language plpgsql;

-- Trigger to update metrics when feedback is added
create trigger trigger_update_metrics_on_feedback
    after insert on matching_feedback
    for each row
    execute function update_batch_metrics();

-- Function to increment price cache hit count
create or replace function increment_cache_hits(cache_id uuid)
returns void as $$
begin
    update price_cache
    set hit_count = hit_count + 1,
        last_updated = now()
    where id = cache_id;
end;
$$ language plpgsql;

-- Comments
comment on table matching_feedback is 'Stores user corrections to matching suggestions for learning';
comment on table batch_metrics is 'Tracks performance, quality, and cost metrics per batch';
comment on table price_cache is 'Caches pricing results to reduce API calls';
comment on table validation_rules is 'Configurable validation rules for staging rows';
comment on table validation_results is 'Results of validation checks on staging rows';
