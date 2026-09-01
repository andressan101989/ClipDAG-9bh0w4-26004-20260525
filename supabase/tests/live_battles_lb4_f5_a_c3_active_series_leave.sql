begin;

create temp table c3_financial_initial as
select
  (select count(*) from public.live_gift_transactions) as gifts,
  (select count(*) from public.live_battle_score_events) as score_events,
  (select count(*) from public.financial_transactions) as financial,
  (select count(*) from public.ledger_entries) as ledger,
  (select coalesce(sum(balance), 0) from public.ledger_accounts) as balances;

create function pg_temp.c3_user(p_id integer)
returns uuid language sql immutable
as $$ select ('c3a10000-0000-4000-8000-' || pg_catalog.lpad(p_id::text, 12, '0'))::uuid $$;
create function pg_temp.c3_session(p_id integer)
returns uuid language sql immutable
as $$ select ('c3a20000-0000-4000-8000-' || pg_catalog.lpad(p_id::text, 12, '0'))::uuid $$;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
)
select pg_temp.c3_user(n), '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', 'lb4c3-' || n || '@proof.local', 'proof',
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
from pg_catalog.generate_series(1, 20) as n;

insert into public.user_profiles (id, username, display_name, is_admin)
select pg_temp.c3_user(n), 'lb4c3_' || n, 'LB4-F5-A-C3 ' || n, false
from pg_catalog.generate_series(1, 20) as n;

insert into public.live_sessions (
  id, host_id, title, status, viewer_count, started_at, ended_at,
  created_at, last_heartbeat_at, host_disconnected_at, end_reason
)
select pg_temp.c3_session(n), pg_temp.c3_user(n), 'LB4-F5-A-C3 session ' || n,
  'live', 0, pg_catalog.clock_timestamp() - interval '1 minute', null,
  pg_catalog.clock_timestamp() - interval '1 minute',
  pg_catalog.clock_timestamp(), null, null
from pg_catalog.generate_series(1, 18) as n;

insert into public.gift_catalog (
  id, emoji, label, cost_coins, active, enabled, category,
  animation_type, duration_ms, priority, sort_order
) values (
  'lb4_c3_integrity', 'C3', 'C3 integrity', 9, true, true,
  'basic', 'floating', 1800, 1, 9960
);
insert into public.ledger_accounts (owner_id, account_type, balance, currency)
values (pg_temp.c3_user(20), 'user', 500, 'BDAG');

create temp table c3_cases (
  case_id integer primary key,
  initial_status text not null,
  leave_side text not null,
  series_id uuid not null,
  battle_id uuid not null,
  challenger_id uuid not null,
  opponent_id uuid not null,
  actor_id uuid not null,
  event_count_before integer not null,
  series_version_before bigint not null
);

create function pg_temp.c3_prepare_case(
  p_case_id integer,
  p_status text,
  p_leave_side text
)
returns void language plpgsql
as $$
declare
  v_challenger uuid := pg_temp.c3_user((p_case_id * 2) - 1);
  v_opponent uuid := pg_temp.c3_user(p_case_id * 2);
  v_challenger_session uuid := pg_temp.c3_session((p_case_id * 2) - 1);
  v_opponent_session uuid := pg_temp.c3_session(p_case_id * 2);
  v_payload jsonb;
  v_battle_id uuid;
  v_series_id uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', v_challenger::text, true);
  v_payload := public.create_live_battle_invite(
    v_opponent, v_challenger_session, v_opponent_session
  );
  v_battle_id := (v_payload->>'id')::uuid;
  v_series_id := (v_payload->>'series_id')::uuid;

  if p_status = 'accepted' then
    update public.live_battles
    set status = 'accepted', accepted_at = v_now,
        last_transition_actor_id = v_opponent,
        last_transition_reason = 'invite_accepted', version = 2,
        updated_at = v_now
    where id = v_battle_id;
  elsif p_status = 'countdown' then
    update public.live_battles
    set status = 'countdown', accepted_at = v_now,
        countdown_started_at = v_now,
        scheduled_start_at = v_now + interval '3 seconds',
        last_transition_actor_id = v_challenger,
        last_transition_reason = 'countdown_started', version = 3,
        updated_at = v_now
    where id = v_battle_id;
  elsif p_status = 'active' then
    update public.live_battles
    set status = 'active', accepted_at = v_now - interval '4 seconds',
        countdown_started_at = v_now - interval '3 seconds',
        scheduled_start_at = v_now,
        started_at = v_now,
        scheduled_end_at = v_now + interval '300 seconds',
        last_transition_actor_id = null,
        last_transition_reason = 'countdown_elapsed', version = 4,
        updated_at = v_now
    where id = v_battle_id;
  elsif p_status <> 'pending' then
    raise exception 'c3_fixture_status_invalid';
  end if;

  insert into c3_cases (
    case_id, initial_status, leave_side, series_id, battle_id,
    challenger_id, opponent_id, actor_id,
    event_count_before, series_version_before
  )
  select p_case_id, p_status, p_leave_side, v_series_id, v_battle_id,
    v_challenger, v_opponent,
    case when p_leave_side = 'challenger' then v_challenger else v_opponent end,
    (select count(*) from public.live_battle_events where battle_id = v_battle_id),
    (select version from public.live_battle_series where id = v_series_id);
end;
$$;

select pg_temp.c3_prepare_case(1, 'pending', 'challenger');
select pg_temp.c3_prepare_case(2, 'pending', 'opponent');
select pg_temp.c3_prepare_case(3, 'accepted', 'challenger');
select pg_temp.c3_prepare_case(4, 'accepted', 'opponent');
select pg_temp.c3_prepare_case(5, 'countdown', 'challenger');
select pg_temp.c3_prepare_case(6, 'countdown', 'opponent');
select pg_temp.c3_prepare_case(7, 'active', 'challenger');
select pg_temp.c3_prepare_case(8, 'active', 'opponent');

-- One confirmed gift is immutable economic history. It must survive leave.
select pg_catalog.set_config('request.jwt.claim.sub', pg_temp.c3_user(20)::text, true);
select * from public.send_live_battle_gift(
  (select battle_id from c3_cases where case_id = 7),
  (select challenger_id from c3_cases where case_id = 7),
  'lb4_c3_integrity',
  'c3-gift-before-leave'
);

create temp table c3_after_confirmed_gift as
select
  (select count(*) from public.live_gift_transactions) as gifts,
  (select count(*) from public.live_battle_score_events) as score_events,
  (select count(*) from public.financial_transactions) as financial,
  (select count(*) from public.ledger_entries) as ledger,
  (select coalesce(sum(balance), 0) from public.ledger_accounts) as balances;

do $$
declare
  v_case c3_cases%rowtype;
  v_result jsonb;
  v_events integer;
  v_series_version bigint;
  v_completed_at timestamptz;
begin
  for v_case in select * from c3_cases order by case_id loop
    perform pg_catalog.set_config('request.jwt.claim.sub', v_case.actor_id::text, true);
    v_result := public.leave_live_battle_series(v_case.series_id);
    if v_result->>'status' <> 'cancelled' then
      raise exception 'c3_active_leave_series_not_cancelled_%', v_case.case_id;
    end if;
    if not exists (
      select 1 from public.live_battles as battle
      where battle.id = v_case.battle_id
        and battle.status = 'cancelled'
        and battle.ended_at is not null
        and battle.last_transition_actor_id = v_case.actor_id
        and battle.last_transition_reason = v_case.leave_side || '_cancelled'
    ) then raise exception 'c3_active_leave_battle_invalid_%', v_case.case_id; end if;
    if not exists (
      select 1 from public.live_battle_score_states as score
      where score.battle_id = v_case.battle_id
        and score.outcome = 'cancelled'
        and score.winner_user_id is null
        and score.finalized_at is not null
    ) then raise exception 'c3_active_leave_score_invalid_%', v_case.case_id; end if;
    if not exists (
      select 1 from public.live_battle_series as series
      where series.id = v_case.series_id
        and series.status = 'cancelled'
        and series.champion_user_id is null
        and series.completed_at is not null
        and series.rematch_window_expires_at is null
        and series.rounds_completed = 0
        and series.challenger_wins = 0
        and series.opponent_wins = 0
        and series.ties = 0
    ) then raise exception 'c3_active_leave_series_invalid_%', v_case.case_id; end if;
    if (select count(*) from public.live_battle_events
        where battle_id = v_case.battle_id and to_status = 'cancelled') <> 1
    then raise exception 'c3_active_leave_terminal_event_count_%', v_case.case_id; end if;
    if exists (
      select 1 from public.live_battle_rematch_requests
      where series_id = v_case.series_id and status = 'pending'
    ) then raise exception 'c3_active_leave_pending_request_%', v_case.case_id; end if;
    if exists (
      select 1 from public.live_sessions
      where id in (
        (select challenger_session_id from public.live_battles where id = v_case.battle_id),
        (select opponent_session_id from public.live_battles where id = v_case.battle_id)
      ) and status <> 'live'
    ) then raise exception 'c3_active_leave_ended_live_%', v_case.case_id; end if;
    if exists (
      select 1 from public.live_battle_public_states
      where battle_id = v_case.battle_id
        and (status <> 'cancelled' or outcome <> 'cancelled' or series_status <> 'cancelled')
    ) then raise exception 'c3_active_leave_projection_stale_%', v_case.case_id; end if;

    select count(*), max(series.version), max(series.completed_at)
    into v_events, v_series_version, v_completed_at
    from public.live_battle_events as event
    join public.live_battle_series as series on series.id = v_case.series_id
    where event.battle_id = v_case.battle_id;
    perform public.leave_live_battle_series(v_case.series_id);
    if (select count(*) from public.live_battle_events where battle_id = v_case.battle_id) <> v_events
       or (select version from public.live_battle_series where id = v_case.series_id) <> v_series_version
       or (select completed_at from public.live_battle_series where id = v_case.series_id)
          is distinct from v_completed_at
    then raise exception 'c3_active_leave_not_idempotent_%', v_case.case_id; end if;
  end loop;
end;
$$;

-- A gift after cancellation must fail before any financial mutation.
do $$
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', pg_temp.c3_user(20)::text, true);
  begin
    perform public.send_live_battle_gift(
      (select battle_id from c3_cases where case_id = 7),
      (select challenger_id from c3_cases where case_id = 7),
      'lb4_c3_integrity',
      'c3-gift-after-leave'
    );
    raise exception 'c3_gift_after_cancel_allowed';
  exception
    when sqlstate 'P0001' then
      if sqlerrm not in ('live_battle_gift_not_active', 'live_battle_gift_deadline_elapsed') then
        raise;
      end if;
  end;
end;
$$;

do $$
begin
  if (select gifts from c3_after_confirmed_gift) <>
       (select gifts + 1 from c3_financial_initial)
     or (select score_events from c3_after_confirmed_gift) <>
       (select score_events + 1 from c3_financial_initial)
  then raise exception 'c3_confirmed_gift_missing_score_fact'; end if;
  if (select gifts from c3_after_confirmed_gift) <>
       (select count(*) from public.live_gift_transactions)
     or (select score_events from c3_after_confirmed_gift) <>
       (select count(*) from public.live_battle_score_events)
     or (select financial from c3_after_confirmed_gift) <>
       (select count(*) from public.financial_transactions)
     or (select ledger from c3_after_confirmed_gift) <>
       (select count(*) from public.ledger_entries)
     or (select balances from c3_after_confirmed_gift) <>
       (select coalesce(sum(balance), 0) from public.ledger_accounts)
  then raise exception 'c3_leave_changed_financial_state'; end if;
  if exists (
    select 1 from public.live_battle_score_events as event
    left join public.live_gift_transactions as gift
      on gift.id = event.gift_transaction_id
    where gift.id is null
  ) then raise exception 'c3_score_without_gift'; end if;
end;
$$;

-- Authorization and lookup failures remain exact.
do $$
declare
  v_series uuid := (select series_id from c3_cases where case_id = 1);
begin
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.leave_live_battle_series(v_series);
    raise exception 'c3_unauthenticated_leave_allowed';
  exception when insufficient_privilege then null; end;

  perform pg_catalog.set_config('request.jwt.claim.sub', pg_temp.c3_user(19)::text, true);
  begin
    perform public.leave_live_battle_series(v_series);
    raise exception 'c3_nonparticipant_leave_allowed';
  exception when insufficient_privilege then null; end;

  perform pg_catalog.set_config('request.jwt.claim.sub', pg_temp.c3_user(1)::text, true);
  begin
    perform public.leave_live_battle_series('c3afffff-0000-4000-8000-000000000001');
    raise exception 'c3_missing_series_allowed';
  exception when no_data_found then null; end;
end;
$$;

-- Completed while waiting / between rounds preserves the real winner and
-- accumulated counters, and cancels only the pending rematch request.
select pg_temp.c3_prepare_case(9, 'active', 'challenger');
do $$
declare
  v_case c3_cases%rowtype := (select c from c3_cases c where case_id = 9);
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_result jsonb;
begin
  update public.live_battles
  set status = 'completed', accepted_at = v_now - interval '304 seconds',
      countdown_started_at = v_now - interval '303 seconds',
      scheduled_start_at = v_now - interval '300 seconds',
      started_at = v_now - interval '300 seconds', scheduled_end_at = v_now,
      ended_at = v_now, last_transition_actor_id = null,
      last_transition_reason = 'battle_duration_elapsed', version = 5,
      updated_at = v_now
  where id = v_case.battle_id;
  update public.live_battle_score_states
  set challenger_score = 12, opponent_score = 3, score_version = 1,
      outcome = 'challenger', winner_user_id = v_case.challenger_id,
      finalized_at = v_now, updated_at = v_now
  where battle_id = v_case.battle_id;
  insert into public.live_battle_rematch_requests (
    series_id, after_battle_id, requested_by_user_id, status,
    idempotency_key, expires_at, created_at, updated_at
  ) values (
    v_case.series_id, v_case.battle_id, v_case.challenger_id, 'pending',
    'c3a30000-0000-4000-8000-000000000009',
    v_now + interval '30 seconds', v_now, v_now
  );
  update public.live_battle_series
  set status = 'rematch_pending', rematch_window_expires_at = v_now + interval '30 seconds',
      completed_at = null, updated_at = v_now
  where id = v_case.series_id;

  perform pg_catalog.set_config('request.jwt.claim.sub', v_case.actor_id::text, true);
  v_result := public.leave_live_battle_series(v_case.series_id);
  if v_result->>'status' <> 'completed'
     or (v_result->>'challenger_wins')::integer <> 1
     or (v_result->>'rounds_completed')::integer <> 1
     or (v_result->>'champion_user_id')::uuid <> v_case.challenger_id
  then raise exception 'c3_between_round_result_changed'; end if;
  if (select status from public.live_battles where id = v_case.battle_id) <> 'completed'
     or (select outcome from public.live_battle_score_states where battle_id = v_case.battle_id) <> 'challenger'
     or exists (
       select 1 from public.live_battle_rematch_requests
       where series_id = v_case.series_id and status = 'pending'
     )
  then raise exception 'c3_between_round_path_invalid'; end if;
end;
$$;

do $$
begin
  if not has_function_privilege(
       'authenticated', 'public.leave_live_battle_series(uuid)', 'execute')
     or has_function_privilege(
       'anon', 'public.leave_live_battle_series(uuid)', 'execute')
     or has_function_privilege(
       'service_role', 'public.leave_live_battle_series(uuid)', 'execute')
  then raise exception 'c3_leave_rpc_acl_invalid'; end if;
  if exists (
    select 1 from pg_catalog.pg_publication_tables
    where tablename in ('live_battle_series', 'live_battle_rematch_requests')
  ) then raise exception 'c3_internal_realtime_exposure'; end if;
end;
$$;

rollback;
