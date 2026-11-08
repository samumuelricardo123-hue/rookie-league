-- Rookie League: armazenamento privado de telemetria por volta.
-- Execute no Supabase SQL Editor do projeto rookie-league.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'rookie-telemetry',
  'rookie-telemetry',
  false,
  52428800,
  array['application/x-ndjson', 'text/plain']
)
on conflict (id) do update
set public = false,
    file_size_limit = 52428800,
    allowed_mime_types = array['application/x-ndjson', 'text/plain'];

drop policy if exists rookie_telemetry_upload_own_folder on storage.objects;
create policy rookie_telemetry_upload_own_folder
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'rookie-telemetry'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists rookie_telemetry_read_own_folder on storage.objects;
create policy rookie_telemetry_read_own_folder
on storage.objects
for select
to authenticated
using (
  bucket_id = 'rookie-telemetry'
  and (storage.foldername(name))[1] = auth.uid()::text
);
