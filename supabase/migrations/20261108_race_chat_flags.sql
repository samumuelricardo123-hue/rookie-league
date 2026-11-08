-- Apply in Supabase SQL Editor before enabling Race Chat flag controls.
create table if not exists public.race_chat_flags (
  room_name text primary key,
  mode text not null check (mode in ('GREEN','VSC','RED')),
  version bigint not null default 0,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.race_chat_flags enable row level security;
revoke all on public.race_chat_flags from anon, authenticated;
grant select on public.race_chat_flags to authenticated;
drop policy if exists "Authenticated users read race flags" on public.race_chat_flags;
create policy "Authenticated users read race flags" on public.race_chat_flags
  for select to authenticated using (room_name = 'rookie-general');

create or replace function public.set_race_chat_flag(p_mode text)
returns public.race_chat_flags
language plpgsql security definer set search_path = ''
as $$
declare v_row public.race_chat_flags;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles
    where id = auth.uid() and is_admin is true
  ) then
    raise exception 'Apenas administradores podem controlar bandeiras';
  end if;
  if p_mode is null or p_mode not in ('GREEN','VSC','RED') then
    raise exception 'Bandeira invalida';
  end if;
  insert into public.race_chat_flags(room_name,mode,version,updated_by,updated_at)
  values ('rookie-general',p_mode,1,auth.uid(),now())
  on conflict (room_name) do update set
    mode=excluded.mode,
    version=public.race_chat_flags.version+1,
    updated_by=auth.uid(),
    updated_at=now()
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.set_race_chat_flag(text) from public, anon;
grant execute on function public.set_race_chat_flag(text) to authenticated;
insert into public.race_chat_flags(room_name,mode,version)
values ('rookie-general','GREEN',0)
on conflict (room_name) do nothing;
