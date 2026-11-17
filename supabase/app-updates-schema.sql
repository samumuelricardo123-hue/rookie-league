-- Rookie League — notificações e controle de downloads do aplicativo Windows
-- Execute no Supabase SQL Editor do projeto lxformxabgtgafykvhkw.

create table if not exists public.app_updates (
  id uuid primary key default gen_random_uuid(),
  version text not null,
  download_url text not null check (download_url like 'https://%'),
  notes text not null default '',
  is_active boolean not null default true,
  published_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists app_updates_active_created_idx
  on public.app_updates (is_active, created_at desc);

create table if not exists public.app_update_downloads (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null references public.app_updates(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  pilot_email text,
  pilot_name text,
  download_clicked_at timestamptz not null default now(),
  unique (update_id, user_id)
);

create index if not exists app_update_downloads_update_idx
  on public.app_update_downloads (update_id, download_clicked_at desc);

alter table public.app_updates enable row level security;
alter table public.app_update_downloads enable row level security;

drop policy if exists "Pilots can read active app updates" on public.app_updates;
create policy "Pilots can read active app updates"
on public.app_updates for select to authenticated
using (is_active = true or exists (
  select 1 from public.profiles p
  where p.id = auth.uid() and p.is_admin = true
));

drop policy if exists "Admins can publish app updates" on public.app_updates;
create policy "Admins can publish app updates"
on public.app_updates for insert to authenticated
with check (exists (
  select 1 from public.profiles p
  where p.id = auth.uid() and p.is_admin = true
));

drop policy if exists "Admins can edit app updates" on public.app_updates;
create policy "Admins can edit app updates"
on public.app_updates for update to authenticated
using (exists (
  select 1 from public.profiles p
  where p.id = auth.uid() and p.is_admin = true
))
with check (exists (
  select 1 from public.profiles p
  where p.id = auth.uid() and p.is_admin = true
));

drop policy if exists "Pilots can register own download click" on public.app_update_downloads;
create policy "Pilots can register own download click"
on public.app_update_downloads for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "Pilots and admins can read download records" on public.app_update_downloads;
create policy "Pilots and admins can read download records"
on public.app_update_downloads for select to authenticated
using (
  user_id = auth.uid()
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
);

drop policy if exists "Pilots can update own download click" on public.app_update_downloads;
create policy "Pilots can update own download click"
on public.app_update_downloads for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
