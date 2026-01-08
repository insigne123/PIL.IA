-- DISABLE ROW LEVEL SECURITY
-- Since we are using Firebase Auth, Supabase does not recognize the user session.
-- For this MVP, we will disable RLS and rely on client-side ID filtering and server-side validtion.

alter table projects disable row level security;
alter table batches disable row level security;
alter table batch_files disable row level security;
alter table staging_rows disable row level security;
alter table jobs disable row level security;
alter table outputs disable row level security;
alter table excel_maps disable row level security;

-- Optionally, we can drop the policies if disabling isn't enough (though disabling usually overrides)
-- drop policy "Users can see own projects" on projects;
-- etc...
