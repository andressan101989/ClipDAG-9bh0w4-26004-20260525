begin;

create or replace function public.leave_live_battle_series(p_series_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz;
  v_series_snapshot public.live_battle_series%rowtype;
  v_series public.live_battle_series%rowtype;
  v_latest public.live_battles%rowtype;
  v_reason text;
  v_cancelled_active_round boolean := false;
begin
  if v_actor is null then
    raise exception using
      errcode = '42501', message = 'live_battle_series_auth_required';
  end if;

  -- This first read validates identity without taking the series lock. The
  -- canonical user/session locks below serialize series actions, while the
  -- Battle lock remains the first durable lifecycle-row lock.
  select series.* into v_series_snapshot
  from public.live_battle_series as series
  where series.id = p_series_id;
  if not found then
    raise exception using
      errcode = 'P0002', message = 'live_battle_series_not_found';
  end if;
  if v_actor not in (
    v_series_snapshot.challenger_user_id,
    v_series_snapshot.opponent_user_id
  ) then
    raise exception using
      errcode = '42501', message = 'live_battle_series_not_participant';
  end if;

  -- cancel_live_battle takes the Battle lock before assigning its actor FK.
  -- Never wait for that Battle while retaining FOR UPDATE locks on users:
  -- a failed NOWAIT attempt rolls this subtransaction back, releases the
  -- canonical user/session locks, and retries the same successful order.
  loop
    begin
      perform private.live_battle_lock_users(
        v_series_snapshot.challenger_user_id,
        v_series_snapshot.opponent_user_id
      );
      perform private.live_battle_lock_sessions(
        v_series_snapshot.challenger_session_id,
        v_series_snapshot.opponent_session_id
      );

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
      exit;
    exception
      when lock_not_available then
        perform pg_catalog.pg_sleep(0.01);
    end;
  end loop;

  -- The clock is authoritative only after the Battle lock is held. Reconcile
  -- may complete an elapsed round and must win over a later leave request.
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

  -- live_battle_transition finalizes score before its series rebuild trigger.
  -- Taking the explicit series lock here therefore preserves Battle -> score
  -- -> series order and avoids the historical series -> Battle inversion.
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
    return private.live_battle_series_to_json(v_series);
  end if;

  if v_series.status in ('completed', 'cancelled') then
    return private.live_battle_series_to_json(v_series);
  end if;

  -- The latest round completed while waiting for its lock, or the call was
  -- already between rounds. Preserve the accumulated result and never rewrite
  -- a finalized score as cancelled.
  if v_latest.status = 'completed' and v_series.rounds_completed > 0 then
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
    return private.live_battle_series_to_json(v_series);
  end if;

  raise exception using
    errcode = '55000', message = 'live_battle_series_leave_state_invalid';
end;
$$;

alter function public.leave_live_battle_series(uuid) owner to postgres;
revoke all on function public.leave_live_battle_series(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.leave_live_battle_series(uuid)
  to authenticated;

commit;
