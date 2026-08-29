begin;

create index live_battles_accepted_deadline_idx
  on public.live_battles (accepted_at)
  where status = 'accepted';

create or replace function private.live_battle_transition(
  p_battle_id uuid,
  p_expected_status text,
  p_next_status text,
  p_actor_user_id uuid,
  p_reason text,
  p_now timestamptz
)
returns public.live_battles
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_battle public.live_battles%rowtype;
  v_next_version bigint;
begin
  select * into v_battle
  from public.live_battles b
  where b.id = p_battle_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'live_battle_not_found';
  end if;
  if v_battle.status <> p_expected_status then
    raise exception using errcode = '55000', message = 'live_battle_state_changed';
  end if;
  if not (
    (p_expected_status = 'pending' and p_next_status in ('accepted', 'rejected', 'cancelled', 'expired')) or
    (p_expected_status = 'accepted' and p_next_status in ('countdown', 'cancelled')) or
    (p_expected_status = 'countdown' and p_next_status in ('active', 'cancelled')) or
    (p_expected_status = 'active' and p_next_status in ('completed', 'cancelled'))
  ) then
    raise exception using errcode = '55000', message = 'live_battle_transition_invalid';
  end if;

  if p_next_status = 'accepted' and
     (p_actor_user_id is distinct from v_battle.opponent_user_id or p_reason <> 'invite_accepted') then
    raise exception using errcode = '42501', message = 'live_battle_transition_actor_invalid';
  elsif p_next_status = 'rejected' and
     (p_actor_user_id is distinct from v_battle.opponent_user_id or p_reason <> 'invite_rejected') then
    raise exception using errcode = '42501', message = 'live_battle_transition_actor_invalid';
  elsif p_next_status = 'expired' and
     (p_actor_user_id is not null or p_reason <> 'invite_expired') then
    raise exception using errcode = '42501', message = 'live_battle_transition_actor_invalid';
  elsif p_next_status = 'countdown' and
     (p_actor_user_id not in (v_battle.challenger_user_id, v_battle.opponent_user_id) or
      p_reason <> 'countdown_started') then
    raise exception using errcode = '42501', message = 'live_battle_transition_actor_invalid';
  elsif p_next_status = 'active' and
     (p_actor_user_id is not null or p_reason <> 'countdown_elapsed') then
    raise exception using errcode = '42501', message = 'live_battle_transition_actor_invalid';
  elsif p_next_status = 'completed' and
     (p_actor_user_id is not null or p_reason <> 'battle_duration_elapsed') then
    raise exception using errcode = '42501', message = 'live_battle_transition_actor_invalid';
  elsif p_next_status = 'cancelled' and not (
    (p_actor_user_id = v_battle.challenger_user_id and p_reason = 'challenger_cancelled') or
    (p_actor_user_id = v_battle.opponent_user_id and p_reason = 'opponent_cancelled') or
    (p_expected_status = 'accepted' and p_actor_user_id is null and
     p_reason in ('accepted_start_timeout', 'session_not_live_after_accept')) or
    (p_expected_status = 'countdown' and p_actor_user_id is null and
     p_reason = 'session_not_live_before_start')
  ) then
    raise exception using errcode = '42501', message = 'live_battle_transition_actor_invalid';
  end if;

  v_next_version := v_battle.version + 1;
  update public.live_battles b
  set status = p_next_status,
      accepted_at = case when p_next_status = 'accepted' then p_now else b.accepted_at end,
      countdown_started_at = case when p_next_status = 'countdown' then p_now else b.countdown_started_at end,
      scheduled_start_at = case when p_next_status = 'countdown' then p_now + interval '3 seconds' else b.scheduled_start_at end,
      started_at = case when p_next_status = 'active' then b.scheduled_start_at else b.started_at end,
      scheduled_end_at = case when p_next_status = 'active' then b.scheduled_start_at + interval '300 seconds' else b.scheduled_end_at end,
      ended_at = case
        when p_next_status = 'expired' then b.invite_expires_at
        when p_next_status = 'completed' then b.scheduled_end_at
        when p_next_status in ('rejected', 'cancelled') then p_now
        else b.ended_at
      end,
      last_transition_actor_id = p_actor_user_id,
      last_transition_reason = p_reason,
      version = v_next_version,
      updated_at = p_now
  where b.id = p_battle_id
    and b.status = p_expected_status
    and b.version = v_battle.version
  returning * into v_battle;
  if not found then
    raise exception using errcode = '55000', message = 'live_battle_state_changed';
  end if;

  insert into public.live_battle_events (
    battle_id, actor_user_id, from_status, to_status, reason, version, created_at
  ) values (
    v_battle.id, p_actor_user_id, p_expected_status, p_next_status,
    p_reason, v_next_version, p_now
  );
  return v_battle;
end;
$$;

create or replace function private.live_battle_reconcile_locked(
  p_battle_id uuid,
  p_now timestamptz
)
returns public.live_battles
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_battle public.live_battles%rowtype;
begin
  loop
    select * into v_battle
    from public.live_battles b
    where b.id = p_battle_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'live_battle_not_found';
    end if;

    if v_battle.status = 'pending' and v_battle.invite_expires_at <= p_now then
      v_battle := private.live_battle_transition(
        v_battle.id, 'pending', 'expired', null, 'invite_expired', p_now
      );
    elsif v_battle.status = 'accepted' then
      if not private.live_battle_session_pair_is_live(
        v_battle.challenger_session_id,
        v_battle.challenger_user_id,
        v_battle.opponent_session_id,
        v_battle.opponent_user_id
      ) then
        v_battle := private.live_battle_transition(
          v_battle.id, 'accepted', 'cancelled', null,
          'session_not_live_after_accept', p_now
        );
      elsif v_battle.accepted_at + interval '30 seconds' <= p_now then
        v_battle := private.live_battle_transition(
          v_battle.id, 'accepted', 'cancelled', null,
          'accepted_start_timeout', p_now
        );
      else
        return v_battle;
      end if;
    elsif v_battle.status = 'countdown' and v_battle.scheduled_start_at <= p_now then
      if private.live_battle_session_pair_is_live(
        v_battle.challenger_session_id,
        v_battle.challenger_user_id,
        v_battle.opponent_session_id,
        v_battle.opponent_user_id
      ) then
        v_battle := private.live_battle_transition(
          v_battle.id, 'countdown', 'active', null, 'countdown_elapsed', p_now
        );
      else
        v_battle := private.live_battle_transition(
          v_battle.id, 'countdown', 'cancelled', null,
          'session_not_live_before_start', p_now
        );
      end if;
    elsif v_battle.status = 'active' and v_battle.scheduled_end_at <= p_now then
      v_battle := private.live_battle_transition(
        v_battle.id, 'active', 'completed', null, 'battle_duration_elapsed', p_now
      );
    else
      return v_battle;
    end if;
  end loop;
  return v_battle;
end;
$$;

create or replace function private.reconcile_due_live_battles(
  p_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_server_now timestamptz := pg_catalog.clock_timestamp();
  v_candidate record;
  v_reconciled public.live_battles%rowtype;
  v_reconciled_count integer := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception using
      errcode = '22023',
      message = 'live_battle_reconcile_limit_invalid';
  end if;

  for v_candidate in
    select b.id, b.status
    from public.live_battles b
    where
      (b.status = 'pending' and b.invite_expires_at <= v_server_now) or
      (b.status = 'accepted' and (
        b.accepted_at + interval '30 seconds' <= v_server_now or
        not private.live_battle_session_pair_is_live(
          b.challenger_session_id,
          b.challenger_user_id,
          b.opponent_session_id,
          b.opponent_user_id
        )
      )) or
      (b.status = 'countdown' and b.scheduled_start_at <= v_server_now) or
      (b.status = 'active' and b.scheduled_end_at <= v_server_now)
    order by
      case b.status
        when 'pending' then b.invite_expires_at
        when 'accepted' then b.accepted_at + interval '30 seconds'
        when 'countdown' then b.scheduled_start_at
        when 'active' then b.scheduled_end_at
      end,
      b.id
    for update skip locked
    limit p_limit
  loop
    v_reconciled := private.live_battle_reconcile_locked(
      v_candidate.id,
      v_server_now
    );
    if v_reconciled.status is distinct from v_candidate.status then
      v_reconciled_count := v_reconciled_count + 1;
    end if;
  end loop;

  return v_reconciled_count;
end;
$$;

create or replace function public.create_live_battle_invite(
  p_opponent_user_id uuid,
  p_challenger_session_id uuid,
  p_opponent_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_challenger_session public.live_sessions%rowtype;
  v_opponent_session public.live_sessions%rowtype;
  v_existing public.live_battles%rowtype;
  v_battle public.live_battles%rowtype;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'live_battle_auth_required';
  end if;
  if p_opponent_user_id is null or p_opponent_user_id = v_actor then
    raise exception using errcode = '22023', message = 'live_battle_opponent_invalid';
  end if;
  if p_challenger_session_id is null or p_opponent_session_id is null or
     p_challenger_session_id = p_opponent_session_id then
    raise exception using errcode = '22023', message = 'live_battle_sessions_invalid';
  end if;

  perform private.live_battle_lock_users(v_actor, p_opponent_user_id);
  perform private.live_battle_lock_sessions(p_challenger_session_id, p_opponent_session_id);

  select * into v_challenger_session from public.live_sessions s
  where s.id = p_challenger_session_id;
  select * into v_opponent_session from public.live_sessions s
  where s.id = p_opponent_session_id;
  if v_challenger_session.host_id <> v_actor then
    raise exception using errcode = '42501', message = 'live_battle_challenger_not_host';
  end if;
  if v_opponent_session.host_id <> p_opponent_user_id then
    raise exception using errcode = '42501', message = 'live_battle_opponent_not_host';
  end if;
  if not private.live_battle_session_pair_is_live(
    p_challenger_session_id,
    v_actor,
    p_opponent_session_id,
    p_opponent_user_id
  ) then
    raise exception using errcode = '55000', message = 'live_battle_session_not_live';
  end if;

  select * into v_existing
  from public.live_battles b
  where b.status in ('pending', 'accepted', 'countdown', 'active')
    and ((b.challenger_user_id = v_actor and b.opponent_user_id = p_opponent_user_id) or
         (b.challenger_user_id = p_opponent_user_id and b.opponent_user_id = v_actor))
  order by b.created_at desc
  limit 1
  for update;
  if found then
    v_existing := private.live_battle_reconcile_locked(v_existing.id, v_now);
  end if;
  if v_existing.status = 'pending' and v_existing.ended_at is null then
    if v_existing.challenger_user_id = v_actor and
       v_existing.opponent_user_id = p_opponent_user_id and
       v_existing.challenger_session_id = p_challenger_session_id and
       v_existing.opponent_session_id = p_opponent_session_id then
      return private.live_battle_to_json(v_existing);
    end if;
    raise exception using errcode = '55000', message = 'live_battle_pair_busy';
  elsif v_existing.status in ('accepted', 'countdown', 'active') then
    raise exception using errcode = '55000', message = 'live_battle_pair_busy';
  end if;

  insert into public.live_battles (
    challenger_user_id, opponent_user_id,
    challenger_session_id, opponent_session_id,
    status, invite_expires_at, last_transition_actor_id,
    last_transition_reason, version, created_at, updated_at
  ) values (
    v_actor, p_opponent_user_id,
    p_challenger_session_id, p_opponent_session_id,
    'pending', v_now + interval '30 seconds', v_actor,
    'invite_created', 1, v_now, v_now
  ) returning * into v_battle;

  insert into public.live_battle_events (
    battle_id, actor_user_id, from_status, to_status, reason, version, created_at
  ) values (
    v_battle.id, v_actor, null, 'pending', 'invite_created', 1, v_now
  );
  return private.live_battle_to_json(v_battle);
end;
$$;

create or replace function public.respond_live_battle_invite(
  p_battle_id uuid,
  p_accept boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_seed public.live_battles%rowtype;
  v_battle public.live_battles%rowtype;
  v_challenger_session public.live_sessions%rowtype;
  v_opponent_session public.live_sessions%rowtype;
  v_conflict record;
  v_conflict_count integer := 0;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'live_battle_auth_required';
  end if;
  if p_accept is null then
    raise exception using errcode = '22023', message = 'live_battle_response_invalid';
  end if;
  select * into v_seed from public.live_battles b where b.id = p_battle_id;
  if not found then raise exception using errcode = 'P0002', message = 'live_battle_not_found'; end if;
  if v_seed.opponent_user_id <> v_actor then
    raise exception using errcode = '42501', message = 'live_battle_response_forbidden';
  end if;

  perform private.live_battle_lock_users(v_seed.challenger_user_id, v_seed.opponent_user_id);
  perform private.live_battle_lock_sessions(v_seed.challenger_session_id, v_seed.opponent_session_id);
  select * into v_battle from public.live_battles b where b.id = p_battle_id for update;
  if v_battle.opponent_user_id <> v_actor then
    raise exception using errcode = '42501', message = 'live_battle_response_forbidden';
  end if;
  v_battle := private.live_battle_reconcile_locked(v_battle.id, v_now);
  if v_battle.status = 'expired' then
    return private.live_battle_to_json(v_battle);
  end if;
  if (p_accept and v_battle.status = 'accepted') or
     (not p_accept and v_battle.status = 'rejected') then
    return private.live_battle_to_json(v_battle);
  end if;
  if v_battle.status <> 'pending' then
    raise exception using errcode = '55000', message = 'live_battle_response_state_invalid';
  end if;

  select * into v_challenger_session from public.live_sessions s
  where s.id = v_battle.challenger_session_id;
  select * into v_opponent_session from public.live_sessions s
  where s.id = v_battle.opponent_session_id;
  if v_challenger_session.host_id <> v_battle.challenger_user_id or
     v_opponent_session.host_id <> v_battle.opponent_user_id then
    raise exception using errcode = '42501', message = 'live_battle_host_authority_changed';
  end if;

  if not p_accept then
    v_battle := private.live_battle_transition(
      v_battle.id, 'pending', 'rejected', v_actor, 'invite_rejected', v_now
    );
    return private.live_battle_to_json(v_battle);
  end if;
  if not private.live_battle_session_pair_is_live(
    v_battle.challenger_session_id,
    v_battle.challenger_user_id,
    v_battle.opponent_session_id,
    v_battle.opponent_user_id
  ) then
    raise exception using errcode = '55000', message = 'live_battle_session_not_live';
  end if;

  for v_conflict in
    select b.id
    from public.live_battles b
    where b.id <> v_battle.id
      and b.status in ('accepted', 'countdown', 'active')
      and (
        b.challenger_user_id in (v_battle.challenger_user_id, v_battle.opponent_user_id) or
        b.opponent_user_id in (v_battle.challenger_user_id, v_battle.opponent_user_id)
      )
    order by b.id
    for update
    limit 101
  loop
    v_conflict_count := v_conflict_count + 1;
    if v_conflict_count > 100 then
      raise exception using
        errcode = '54000',
        message = 'live_battle_conflict_scan_limit_exceeded';
    end if;
    perform private.live_battle_reconcile_locked(v_conflict.id, v_now);
  end loop;

  if exists (
    select 1 from public.live_battles b
    where b.id <> v_battle.id
      and b.status in ('accepted', 'countdown', 'active')
      and (
        b.challenger_user_id in (v_battle.challenger_user_id, v_battle.opponent_user_id) or
        b.opponent_user_id in (v_battle.challenger_user_id, v_battle.opponent_user_id)
      )
  ) then
    raise exception using errcode = '55000', message = 'live_battle_participant_busy';
  end if;

  v_battle := private.live_battle_transition(
    v_battle.id, 'pending', 'accepted', v_actor, 'invite_accepted', v_now
  );
  return private.live_battle_to_json(v_battle);
end;
$$;

alter function private.live_battle_transition(uuid, text, text, uuid, text, timestamptz)
  owner to postgres;
alter function private.live_battle_reconcile_locked(uuid, timestamptz)
  owner to postgres;
alter function private.reconcile_due_live_battles(integer)
  owner to postgres;
alter function public.create_live_battle_invite(uuid, uuid, uuid)
  owner to postgres;
alter function public.respond_live_battle_invite(uuid, boolean)
  owner to postgres;

revoke all on function private.live_battle_transition(uuid, text, text, uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.live_battle_reconcile_locked(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.reconcile_due_live_battles(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.create_live_battle_invite(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.respond_live_battle_invite(uuid, boolean)
  from public, anon, authenticated, service_role;

grant execute on function public.create_live_battle_invite(uuid, uuid, uuid)
  to authenticated;
grant execute on function public.respond_live_battle_invite(uuid, boolean)
  to authenticated;

do $$
begin
  if (select pg_catalog.count(*) from cron.job
      where jobname = 'reconcile-due-live-battles') <> 1
    or not exists (
      select 1
      from cron.job
      where jobname = 'reconcile-due-live-battles'
        and schedule = '* * * * *'
        and command = 'select private.reconcile_due_live_battles(100);'
        and active
        and username = 'postgres'
    )
  then
    raise exception 'live Battle reconciliation cron contract invalid';
  end if;
end;
$$;

select private.reconcile_due_live_battles(100);

commit;
