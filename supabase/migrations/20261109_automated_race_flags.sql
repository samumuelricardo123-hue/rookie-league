-- Automatizacao de bandeiras: tempos absolutos no servidor, sem depender de abas abertas.
-- Estado efetivo calculado em cada consulta, preservando auditoria do comando original.
create or replace function public.race_chat_flag_state()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with flag as (
    select mode, version, updated_at from public.race_chat_flags
    where room_name = 'rookie-general'
  ), elapsed as (
    select mode, version, updated_at,
      greatest(0, extract(epoch from (now() - updated_at)))::numeric as seconds
    from flag
  )
  select jsonb_build_object(
    'mode', case
      when mode = 'RED' and seconds < 420 then 'RED'
      when mode = 'RED' and seconds < 630 then 'YELLOW'
      when mode = 'RED' and seconds < 635 then 'START'
      when mode = 'VSC' and seconds < 120 then 'VSC'
      when mode = 'VSC' and seconds < 123 then 'VSC_END'
      else 'GREEN'
    end,
    'source_mode', mode,
    'version', version,
    'updated_at', updated_at,
    'server_time', now(),
    'remaining_seconds', case
      when mode = 'RED' and seconds < 420 then ceil(420 - seconds)
      when mode = 'RED' and seconds < 630 then ceil(630 - seconds)
      when mode = 'RED' and seconds < 635 then ceil(635 - seconds)
      when mode = 'VSC' and seconds < 120 then ceil(120 - seconds)
      when mode = 'VSC' and seconds < 123 then ceil(123 - seconds)
      else 0
    end,
    'lights_total', case when mode = 'RED' and seconds >= 630 and seconds < 635 then 5
      when mode = 'VSC' and seconds >= 120 and seconds < 123 then 3 else 0 end,
    'lights_on', case
      when mode = 'RED' and seconds >= 630 and seconds < 635 then least(5, floor(seconds - 630)::int + 1)
      when mode = 'VSC' and seconds >= 120 and seconds < 123 then greatest(0, 3 - floor(seconds - 120)::int - 1)
      else 0 end,
    'message', case
      when mode = 'RED' and seconds < 420 then 'BANDEIRA VERMELHA: corrida interrompida. Aguarde a direcao de prova.'
      when mode = 'RED' and seconds < 630 then 'PROCEDIMENTO DE RELARGADA: bandeira amarela. Mantenha a ordem, velocidade controlada e nao ultrapasse. Aguarde as luzes.'
      when mode = 'RED' and seconds < 635 then 'RELARGADA: cinco luzes acendem uma a uma. Aguarde apagar todas.'
      when mode = 'VSC' and seconds < 120 then 'VSC: reduza a velocidade e nao ultrapasse. Aguarde o fim do procedimento.'
      when mode = 'VSC' and seconds < 123 then 'FIM DO VSC: tres luzes se apagam uma por uma. Aguarde a bandeira verde.'
      else 'BANDEIRA VERDE: pista liberada. Corrida retomada.'
    end
  ) from elapsed;
$$;
revoke all on function public.race_chat_flag_state() from public, anon;
grant execute on function public.race_chat_flag_state() to authenticated;
