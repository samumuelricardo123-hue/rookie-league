-- Compartilhamento controlado de análises de telemetria por campeonato.
-- Arquivos JSONL continuam privados no Storage.
begin;

create table if not exists public.telemetry_championship_shares (
  id uuid primary key default gen_random_uuid(),
  championship_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint telemetry_championship_shares_user_champ_unique unique (championship_id, user_id)
);

create index if not exists telemetry_championship_shares_lookup_idx
  on public.telemetry_championship_shares(championship_id, enabled, user_id);

alter table public.telemetry_championship_shares enable row level security;

drop policy if exists telemetry_championship_shares_select_own on public.telemetry_championship_shares;
create policy telemetry_championship_shares_select_own
  on public.telemetry_championship_shares for select to authenticated
  using (user_id = auth.uid());

drop policy if exists telemetry_championship_shares_insert_approved on public.telemetry_championship_shares;
create policy telemetry_championship_shares_insert_approved
  on public.telemetry_championship_shares for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.championship_registrations r
      where r.user_id = auth.uid()
        and r.championship_id = telemetry_championship_shares.championship_id
        and r.status = 'approved'
    )
  );

drop policy if exists telemetry_championship_shares_update_approved on public.telemetry_championship_shares;
create policy telemetry_championship_shares_update_approved
  on public.telemetry_championship_shares for update to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.championship_registrations r
      where r.user_id = auth.uid()
        and r.championship_id = telemetry_championship_shares.championship_id
        and r.status = 'approved'
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.championship_registrations r
      where r.user_id = auth.uid()
        and r.championship_id = telemetry_championship_shares.championship_id
        and r.status = 'approved'
    )
  );

commit;
