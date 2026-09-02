begin;

-- Complete lock closure for leave_live_battle_series, in global order:
-- users/sessions -> Battle -> score -> series -> requests/projection ->
-- lifecycle/power/economic-read auxiliaries.  ROW EXCLUSIVE is used where
-- the canonical path performs DML, ROW SHARE where it takes row locks only,
-- and ACCESS SHARE for relations read under MVCC.
create or replace function private.live_battle_series_try_lock_scope_strict(
  p_series_id uuid
)
returns public.live_battles
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
  v_series_snapshot public.live_battle_series%rowtype;
  v_latest public.live_battles%rowtype;
begin
  lock table auth.users in row share mode nowait;
  lock table public.live_sessions in row share mode nowait;
  lock table public.live_battles in row exclusive mode nowait;
  lock table public.live_battle_score_states in row exclusive mode nowait;
  lock table public.live_battle_series in row exclusive mode nowait;
  lock table public.live_battle_rematch_requests in row exclusive mode nowait;
  lock table public.live_battle_public_states in row exclusive mode nowait;
  lock table public.live_battle_events in row exclusive mode nowait;
  lock table public.live_battle_rule_sets in access share mode nowait;
  lock table public.live_battle_power_states in row exclusive mode nowait;
  lock table public.live_battle_boost_events in access share mode nowait;
  lock table public.live_gift_transactions in access share mode nowait;
  lock table public.live_battle_score_events in access share mode nowait;

  select series.* into v_series_snapshot
  from public.live_battle_series as series
  where series.id = p_series_id;
  if not found then
    raise exception using
      errcode = 'P0002', message = 'live_battle_series_not_found';
  end if;

  if v_series_snapshot.challenger_user_id is null or
     v_series_snapshot.opponent_user_id is null or
     v_series_snapshot.challenger_user_id =
       v_series_snapshot.opponent_user_id then
    raise exception using
      errcode = '22023', message = 'live_battle_users_invalid';
  end if;

  perform actor.id
  from auth.users as actor
  where actor.id in (
    v_series_snapshot.challenger_user_id,
    v_series_snapshot.opponent_user_id
  )
  order by actor.id
  for update nowait;

  select pg_catalog.count(*)::integer into v_count
  from auth.users as actor
  where actor.id in (
    v_series_snapshot.challenger_user_id,
    v_series_snapshot.opponent_user_id
  );
  if v_count <> 2 then
    raise exception using
      errcode = 'P0002', message = 'live_battle_user_not_found';
  end if;

  if v_series_snapshot.challenger_session_id is null or
     v_series_snapshot.opponent_session_id is null or
     v_series_snapshot.challenger_session_id =
       v_series_snapshot.opponent_session_id then
    raise exception using
      errcode = '22023', message = 'live_battle_sessions_invalid';
  end if;

  perform session.id
  from public.live_sessions as session
  where session.id in (
    v_series_snapshot.challenger_session_id,
    v_series_snapshot.opponent_session_id
  )
  order by session.id
  for update nowait;

  select pg_catalog.count(*)::integer into v_count
  from public.live_sessions as session
  where session.id in (
    v_series_snapshot.challenger_session_id,
    v_series_snapshot.opponent_session_id
  );
  if v_count <> 2 then
    raise exception using
      errcode = 'P0002', message = 'live_battle_session_not_found';
  end if;

  select battle.* into v_latest
  from public.live_battles as battle
  where battle.series_id = p_series_id
  order by battle.round_number desc, battle.id desc
  limit 1
  for update nowait;
  if not found then
    raise exception using
      errcode = 'P0002', message = 'live_battle_series_round_not_found';
  end if;

  perform score.battle_id
  from public.live_battle_score_states as score
  where score.battle_id = v_latest.id
  for update nowait;

  perform series.id
  from public.live_battle_series as series
  where series.id = p_series_id
  for update nowait;

  perform request.id
  from public.live_battle_rematch_requests as request
  where request.series_id = p_series_id
  order by request.id
  for update nowait;

  perform projection.session_id
  from public.live_battle_public_states as projection
  where projection.battle_id = v_latest.id
  order by projection.session_id
  for update nowait;

  perform rule.id
  from public.live_battle_rule_sets as rule
  where rule.id = v_latest.battle_rule_set_id
  for key share nowait;

  perform power.battle_id
  from public.live_battle_power_states as power
  where power.battle_id = v_latest.id
  order by power.side
  for update nowait;

  return v_latest;
end;
$$;

alter function private.live_battle_series_try_lock_scope_strict(uuid)
  owner to postgres;
revoke all on function private.live_battle_series_try_lock_scope_strict(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.leave_live_battle_series(p_series_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz;
  v_lock_deadline timestamptz :=
    pg_catalog.clock_timestamp() + interval '750 milliseconds';
  v_remaining interval;
  v_sleep_seconds double precision;
  v_attempts integer := 0;
  v_max_attempts constant integer := 128;
  v_lock_acquired boolean := false;
  v_series_snapshot public.live_battle_series%rowtype;
  v_series public.live_battle_series%rowtype;
  v_latest public.live_battles%rowtype;
  v_reason text;
  v_cancelled_active_round boolean := false;
  v_result jsonb;
begin
  if v_actor is null then
    raise exception using
      errcode = '42501', message = 'live_battle_series_auth_required';
  end if;

  while v_attempts < v_max_attempts loop
    if pg_catalog.clock_timestamp() >= v_lock_deadline then
      raise exception using
        errcode = '55P03', message = 'live_battle_series_leave_busy';
    end if;

    v_attempts := v_attempts + 1;
    v_lock_acquired := true;
    begin
      v_latest := private.live_battle_series_try_lock_scope_strict(
        p_series_id
      );
    exception
      when lock_not_available then
        v_lock_acquired := false;
    end;

    if v_lock_acquired then
      if pg_catalog.clock_timestamp() >= v_lock_deadline then
        raise exception using
          errcode = '55P03', message = 'live_battle_series_leave_busy';
      end if;
      exit;
    end if;

    v_remaining := v_lock_deadline - pg_catalog.clock_timestamp();
    if v_remaining <= interval '0 milliseconds' then
      raise exception using
        errcode = '55P03', message = 'live_battle_series_leave_busy';
    end if;
    v_sleep_seconds := least(
      0.010::double precision,
      extract(epoch from v_remaining)::double precision
    );
    perform pg_catalog.pg_sleep(v_sleep_seconds);
  end loop;

  if not v_lock_acquired then
    raise exception using
      errcode = '55P03', message = 'live_battle_series_leave_busy';
  end if;

  select series.* into strict v_series_snapshot
  from public.live_battle_series as series
  where series.id = p_series_id;

  if v_actor not in (
    v_series_snapshot.challenger_user_id,
    v_series_snapshot.opponent_user_id
  ) then
    raise exception using
      errcode = '42501', message = 'live_battle_series_not_participant';
  end if;

  v_now := pg_catalog.clock_timestamp();
  v_latest := private.live_battle_reconcile_locked(v_latest.id, v_now);

  if v_series_snapshot.status not in ('completed', 'cancelled') and
     v_latest.status in ('pending', 'accepted', 'countdown', 'active') then
    v_reason := case
      when v_actor = v_latest.challenger_user_id then 'challenger_cancelled'
      else 'opponent_cancelled'
    end;
    v_latest := private.live_battle_transition(
      v_latest.id,
      v_latest.status,
      'cancelled',
      v_actor,
      v_reason,
      v_now
    );
    v_cancelled_active_round := true;
  end if;

  select series.* into strict v_series
  from public.live_battle_series as series
  where series.id = p_series_id
  for update;

  if v_actor not in (v_series.challenger_user_id, v_series.opponent_user_id) then
    raise exception using
      errcode = '42501', message = 'live_battle_series_not_participant';
  end if;

  v_series := private.reconcile_live_battle_series_locked(p_series_id, v_now);

  if v_cancelled_active_round then
    update public.live_battle_rematch_requests as request
    set status = 'cancelled', responded_by_user_id = null,
        responded_at = v_now, updated_at = v_now
    where request.series_id = p_series_id
      and request.status = 'pending';

    v_series := private.reconcile_live_battle_series_locked(p_series_id, v_now);
    if v_series.status <> 'cancelled' or
       v_series.champion_user_id is not null or
       v_series.completed_at is null or
       v_series.rematch_window_expires_at is not null then
      raise exception using
        errcode = '55000', message = 'live_battle_series_leave_incomplete';
    end if;
    perform private.sync_live_battle_series_projection_locked(p_series_id, v_now);
    v_result := private.live_battle_series_to_json(v_series);
  elsif v_series.status in ('completed', 'cancelled') then
    v_result := private.live_battle_series_to_json(v_series);
  elsif v_latest.status = 'completed' and v_series.rounds_completed > 0 then
    update public.live_battle_rematch_requests as request
    set status = 'cancelled', responded_by_user_id = null,
        responded_at = v_now, updated_at = v_now
    where request.series_id = p_series_id
      and request.status = 'pending';

    update public.live_battle_series as series
    set status = 'completed',
        champion_user_id = private.live_battle_series_champion(
          series.challenger_user_id,
          series.opponent_user_id,
          series.challenger_wins,
          series.opponent_wins
        ),
        rematch_window_expires_at = null,
        completed_at = v_now,
        updated_at = v_now,
        version = series.version + 1
    where series.id = p_series_id
    returning * into v_series;
    perform private.sync_live_battle_series_projection_locked(p_series_id, v_now);
    v_result := private.live_battle_series_to_json(v_series);
  else
    raise exception using
      errcode = '55000', message = 'live_battle_series_leave_state_invalid';
  end if;

  return v_result;
end;
$$;

alter function public.leave_live_battle_series(uuid) owner to postgres;
revoke all on function public.leave_live_battle_series(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.leave_live_battle_series(uuid)
  to authenticated;

commit;
