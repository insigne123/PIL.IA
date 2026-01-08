-- STORAGE BUCKET POLICIES
-- Allow public access to storage buckets for MVP
-- This fixes "new row violates row-level security policy" errors during file upload

-- Create policy to allow INSERT for all users
create policy "Allow public uploads to yago-source"
on storage.objects for insert
with check (bucket_id = 'yago-source');

create policy "Allow public uploads to yago-processing"
on storage.objects for insert
with check (bucket_id = 'yago-processing');

create policy "Allow public uploads to yago-output"
on storage.objects for insert
with check (bucket_id = 'yago-output');

-- Allow SELECT (download) for all users
create policy "Allow public downloads from yago-source"
on storage.objects for select
using (bucket_id = 'yago-source');

create policy "Allow public downloads from yago-processing"
on storage.objects for select
using (bucket_id = 'yago-processing');

create policy "Allow public downloads from yago-output"
on storage.objects for select
using (bucket_id = 'yago-output');

-- Allow UPDATE for all users
create policy "Allow public updates to yago-source"
on storage.objects for update
using (bucket_id = 'yago-source');

create policy "Allow public updates to yago-processing"
on storage.objects for update
using (bucket_id = 'yago-processing');

create policy "Allow public updates to yago-output"
on storage.objects for update
using (bucket_id = 'yago-output');
