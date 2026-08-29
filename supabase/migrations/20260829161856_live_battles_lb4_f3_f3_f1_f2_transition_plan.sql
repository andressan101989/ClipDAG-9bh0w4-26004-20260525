begin;

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
  if v_battle.status is distinct from p_expected_status then
    raise exception using errcode = '55000', message = 'live_battle_state_changed';
  end if;
  if not coalesce(
    (p_expected_status = 'pending' and p_next_status in ('accepted', 'rejected', 'cancelled', 'expired')) or
    (p_expected_status = 'accepted' and p_next_status in ('countdown', 'cancelled')) or
    (p_expected_status = 'countdown' and p_next_status in ('active', 'cancelled')) or
    (p_expected_status = 'active' and p_next_status in ('completed', 'cancelled')),
    false
  ) then
    raise exception using errcode = '55000', message = 'live_battle_transition_invalid';
  end if;

  if p_next_status = 'accepted' and (
    p_actor_user_id is distinct from v_battle.opponent_user_id
    or p_reason is distinct from 'invite_accepted'
  ) then
    raise exception using errcode = '42501', message = 'live_battle_transition_actor_invalid';
  elsif p_next_status = 'rejected' and (
    p_actor_user_id is distinct from v_battle.opponent_user_id
    or p_reason is distinct from 'invite_rejected'
  ) then
    raise exception using errcode = '42501', message = 'live_battle_transition_actor_invalid';
  elsif p_next_status = 'expired' and (
    p_actor_user_id is not null
    or p_reason is distinct from 'invite_expired'
  ) then
    raise exception using errcode = '42501', message = 'live_battle_transition_actor_invalid';
  elsif p_next_status = 'countdown' and (
    p_actor_user_id is null
    or p_actor_user_id not in (
      v_battle.challenger_user_id,
      v_battle.opponent_user_id
    )
    or p_reason is distinct from 'countdown_started'
  ) then
    raise exception using errcode = '42501', message = 'live_battle_transition_actor_invalid';
  elsif p_next_status = 'active' and (
    p_actor_user_id is not null
    or p_reason is distinct from 'countdown_elapsed'
  ) then
    raise exception using errcode = '42501', message = 'live_battle_transition_actor_invalid';
  elsif p_next_status = 'completed' and (
    p_actor_user_id is not null
    or p_reason is distinct from 'battle_duration_elapsed'
  ) then
    raise exception using errcode = '42501', message = 'live_battle_transition_actor_invalid';
  elsif p_next_status = 'cancelled' and not (
    p_reason is not null and (
      (
        p_actor_user_id is not null
        and p_actor_user_id = v_battle.challenger_user_id
        and p_reason = 'challenger_cancelled'
      ) or
      (
        p_actor_user_id is not null
        and p_actor_user_id = v_battle.opponent_user_id
        and p_reason = 'opponent_cancelled'
      ) or
      (
        p_expected_status = 'accepted'
        and p_actor_user_id is null
        and p_reason in ('accepted_start_timeout', 'session_not_live_after_accept')
      ) or
      (
        p_expected_status = 'countdown'
        and p_actor_user_id is null
        and p_reason = 'session_not_live_before_start'
      )
    )
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
    with due_candidates as materialized (
      select b.id, b.status, b.invite_expires_at as due_at
      from public.live_battles b
      where b.status = 'pending'
        and b.invite_expires_at <= v_server_now
      union all
      select b.id, b.status, b.accepted_at as due_at
      from public.live_battles b
      where b.status = 'accepted'
        and b.accepted_at <= v_server_now - interval '30 seconds'
      union all
      select b.id, b.status, b.accepted_at as due_at
      from public.live_battles b
      where b.status = 'accepted'
        and b.accepted_at > v_server_now - interval '30 seconds'
        and not private.live_battle_session_pair_is_live(
          b.challenger_session_id,
          b.challenger_user_id,
          b.opponent_session_id,
          b.opponent_user_id
        )
      union all
      select b.id, b.status, b.scheduled_start_at as due_at
      from public.live_battles b
      where b.status = 'countdown'
        and b.scheduled_start_at <= v_server_now
      union all
      select b.id, b.status, b.scheduled_end_at as due_at
      from public.live_battles b
      where b.status = 'active'
        and b.scheduled_end_at <= v_server_now
    )
    select b.id, b.status
    from public.live_battles b
    join due_candidates d on d.id = b.id
    order by d.due_at, b.id
    for update of b skip locked
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

alter function private.live_battle_transition(uuid, text, text, uuid, text, timestamptz)
  owner to postgres;
alter function private.reconcile_due_live_battles(integer)
  owner to postgres;

revoke all on function private.live_battle_transition(uuid, text, text, uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.reconcile_due_live_battles(integer)
  from public, anon, authenticated, service_role;

commit;
