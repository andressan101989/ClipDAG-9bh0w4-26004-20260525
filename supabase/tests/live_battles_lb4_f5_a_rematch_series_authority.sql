begin;

create temp table f5_financial_baseline as
select
  (select count(*) from public.live_gift_transactions) as gifts,
  (select count(*) from public.financial_transactions) as financial,
  (select count(*) from public.ledger_entries) as ledger,
  (select coalesce(sum(balance), 0) from public.ledger_accounts) as balances;

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1 from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'live_battle_public_states'
  ) then
    execute 'alter publication supabase_realtime add table public.live_battle_public_states';
  end if;
end;
$$;

create function pg_temp.f5_user(p_id integer)
returns uuid language sql immutable
as $$ select ('f5a10000-0000-4000-8000-' || pg_catalog.lpad(p_id::text, 12, '0'))::uuid $$;
create function pg_temp.f5_session(p_id integer)
returns uuid language sql immutable
as $$ select ('f5a20000-0000-4000-8000-' || pg_catalog.lpad(p_id::text, 12, '0'))::uuid $$;

insert into public.gift_catalog (
  id, emoji, label, cost_coins, active, enabled, category,
  animation_type, duration_ms, priority, sort_order
) values ('rose', 'R', 'Rose', 5, true, true, 'basic', 'floating', 1800, 1, 9950)
on conflict (id) do nothing;
insert into public.live_battle_rule_sets (
  rule_version, rose_gift_id, rose_target_units, rose_multiplier,
  rose_duration_seconds, rose_activation_limit_per_side,
  glove_multiplier, glove_duration_seconds, glove_uses_per_side,
  glove_acquisition_mode
) values
  (1, null, 0, 1, 0, 0, 1, 0, 0, 'disabled'),
  (2, 'rose', 10, 2, 30, 1, 3, 15, 1, 'fixed_battle_grant')
on conflict (rule_version) do nothing;
insert into public.live_battle_current_rule_set (singleton, rule_set_id)
select true, id from public.live_battle_rule_sets where rule_version = 2
on conflict (singleton) do nothing;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
)
select pg_temp.f5_user(n), '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', 'lb4f5a-' || n || '@proof.local', 'proof',
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
from pg_catalog.generate_series(1, 10) as n;

insert into public.user_profiles (id, username, display_name, is_admin)
select pg_temp.f5_user(n), 'lb4f5a_' || n, 'LB4-F5-A ' || n, false
from pg_catalog.generate_series(1, 10) as n;

insert into public.live_sessions (
  id, host_id, title, status, viewer_count, started_at, ended_at,
  created_at, last_heartbeat_at, host_disconnected_at, end_reason
)
select pg_temp.f5_session(n), pg_temp.f5_user(n), 'LB4-F5-A session ' || n,
  'live', 0, pg_catalog.clock_timestamp() - interval '1 minute', null,
  pg_catalog.clock_timestamp() - interval '1 minute',
  pg_catalog.clock_timestamp(), null, null
from pg_catalog.generate_series(1, 10) as n;

create function pg_temp.finish_round(
  p_battle_id uuid,
  p_outcome text,
  p_winner uuid default null
)
returns void language plpgsql
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  update public.live_battles
  set status = 'completed', accepted_at = v_now - interval '310 seconds',
      countdown_started_at = v_now - interval '303 seconds',
      scheduled_start_at = v_now - interval '300 seconds',
      started_at = v_now - interval '300 seconds',
      scheduled_end_at = v_now,
      ended_at = v_now, last_transition_actor_id = null,
      last_transition_reason = 'f5a_proof_completed',
      version = greatest(version + 1, 5), updated_at = v_now
  where id = p_battle_id;

  update public.live_battle_score_states
  set challenger_score = case when p_outcome = 'challenger' then 10 else 0 end,
      opponent_score = case when p_outcome = 'opponent' then 10 else 0 end,
      score_version = score_version + 1,
      outcome = p_outcome, winner_user_id = p_winner,
      finalized_at = v_now, updated_at = v_now
  where battle_id = p_battle_id;
end;
$$;

do $$
begin
  if not (select relrowsecurity from pg_catalog.pg_class
          where oid = 'public.live_battle_series'::regclass)
     or not (select relrowsecurity from pg_catalog.pg_class
             where oid = 'public.live_battle_rematch_requests'::regclass)
  then raise exception 'f5a_rls_not_enabled'; end if;
  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename in ('live_battle_series', 'live_battle_rematch_requests')
  ) then raise exception 'f5a_internal_policy_exposed'; end if;
  if has_table_privilege('authenticated', 'public.live_battle_series', 'select')
     or has_table_privilege('service_role', 'public.live_battle_series', 'select')
     or has_table_privilege('authenticated', 'public.live_battle_rematch_requests', 'insert')
  then raise exception 'f5a_internal_table_grant_exposed'; end if;
  if not has_function_privilege('authenticated',
       'public.request_live_battle_rematch(uuid,uuid)', 'execute')
     or has_function_privilege('anon',
       'public.request_live_battle_rematch(uuid,uuid)', 'execute')
     or has_function_privilege('service_role',
       'public.respond_live_battle_rematch(uuid,text)', 'execute')
  then raise exception 'f5a_rpc_acl_invalid'; end if;
  if exists (
    select 1 from pg_catalog.pg_publication_tables
    where schemaname = 'public'
      and tablename in ('live_battle_series', 'live_battle_rematch_requests')
  ) then raise exception 'f5a_internal_realtime_exposure'; end if;
end;
$$;

select pg_catalog.set_config('request.jwt.claim.sub', pg_temp.f5_user(1)::text, true);
create temp table f5_initial as
select public.create_live_battle_invite(
  pg_temp.f5_user(2), pg_temp.f5_session(1), pg_temp.f5_session(2)
) as payload;

do $$
declare
  v_battle uuid := ((select payload from f5_initial)->>'id')::uuid;
begin
  if not exists (
    select 1 from public.live_battles as battle
    join public.live_battle_series as series on series.id = battle.series_id
    where battle.id = v_battle and battle.round_number = 1
      and series.format = 'best_of_5' and series.max_rounds = 5
      and series.wins_required = 3 and series.status = 'active'
  ) then raise exception 'f5a_initial_series_round_invalid'; end if;
  perform pg_temp.finish_round(v_battle, 'challenger', pg_temp.f5_user(1));
end;
$$;

do $$
declare
  v_battle uuid := ((select payload from f5_initial)->>'id')::uuid;
begin
  if exists (
    select 1 from public.live_battle_public_states
    where battle_id = v_battle and (
      rematch_request_id is not null or
      rematch_request_after_battle_id is not null or
      rematch_request_status is not null or
      rematch_request_expires_at is not null
    )
  ) or not exists (
    select 1 from public.live_battle_public_states as projection
    join public.live_battle_series as series on series.id = projection.series_id
    where projection.battle_id = v_battle
      and projection.rematch_window_expires_at = series.rematch_window_expires_at
      and projection.rematch_window_expires_at is not null
  ) then raise exception 'f5a_round_one_projection_without_request_invalid'; end if;
end;
$$;

create temp table f5_request_one as
select public.request_live_battle_rematch(
  ((select payload from f5_initial)->>'id')::uuid,
  'f5a30000-0000-4000-8000-000000000001'::uuid
) as payload;
create temp table f5_request_retry as
select public.request_live_battle_rematch(
  ((select payload from f5_initial)->>'id')::uuid,
  'f5a30000-0000-4000-8000-000000000001'::uuid
) as payload;

do $$
begin
  if (select payload->>'id' from f5_request_one) <>
     (select payload->>'id' from f5_request_retry)
     or (select count(*) from public.live_battle_rematch_requests
         where series_id = ((select payload from f5_request_one)->>'series_id')::uuid) <> 1
  then raise exception 'f5a_request_idempotency_failed'; end if;
  if not exists (
    select 1 from public.live_battle_public_states as projection
    join public.live_battle_rematch_requests as request
      on request.id = projection.rematch_request_id
    where projection.battle_id = ((select payload from f5_initial)->>'id')::uuid
      and projection.rematch_request_after_battle_id = projection.battle_id
      and projection.rematch_request_status = 'pending'
      and projection.rematch_request_expires_at = request.expires_at
      and projection.rematch_window_expires_at is not null
  ) then raise exception 'f5a_round_one_request_anchor_invalid'; end if;
end;
$$;

select pg_catalog.set_config('request.jwt.claim.sub', pg_temp.f5_user(3)::text, true);
do $$
begin
  begin
    perform public.request_live_battle_rematch(
      ((select payload from f5_initial)->>'id')::uuid,
      pg_catalog.gen_random_uuid()
    );
    raise exception 'f5a_third_party_request_allowed';
  exception when sqlstate '42501' then
    if sqlerrm <> 'live_battle_rematch_not_participant' then raise; end if;
  end;
end;
$$;

select pg_catalog.set_config('request.jwt.claim.sub', pg_temp.f5_user(2)::text, true);
create temp table f5_accept as
select public.respond_live_battle_rematch(
  ((select payload from f5_request_one)->>'id')::uuid, 'accept'
) as payload;
create temp table f5_accept_retry as
select public.respond_live_battle_rematch(
  ((select payload from f5_request_one)->>'id')::uuid, 'accept'
) as payload;

do $$
declare
  v_series uuid := ((select payload from f5_request_one)->>'series_id')::uuid;
  v_round_two uuid := ((select payload from f5_accept)->'battle'->>'id')::uuid;
begin
  if v_round_two <> ((select payload from f5_accept_retry)->'battle'->>'id')::uuid
     or (select count(*) from public.live_battles
         where series_id = v_series and round_number = 2) <> 1
  then raise exception 'f5a_double_accept_created_duplicate'; end if;
  if not exists (
    select 1 from public.live_battles
    where id = v_round_two and status = 'countdown'
      and scheduled_start_at = countdown_started_at + interval '3 seconds'
  ) then raise exception 'f5a_rematch_countdown_invalid'; end if;
  if (select count(*) from public.live_battle_events where battle_id = v_round_two) <> 3
     or (select count(*) from public.live_battle_score_states
         where battle_id = v_round_two and challenger_score = 0
           and opponent_score = 0 and outcome = 'pending') <> 1
     or (select count(*) from public.live_battle_power_states
         where battle_id = v_round_two and rose_progress_units = 0
           and glove_uses_consumed = 0) <> 2
  then raise exception 'f5a_fresh_round_state_invalid'; end if;
  if (select count(*) from public.live_battle_public_states
      where battle_id = v_round_two and series_id = v_series
        and round_number = 2 and series_status = 'active'
        and rematch_request_id is null
        and rematch_request_after_battle_id is null
        and rematch_request_status is null
        and rematch_request_expires_at is null
        and rematch_window_expires_at is null) <> 2
  then raise exception 'f5a_projection_orientation_invalid'; end if;
  if exists (
    select 1 from public.live_battle_public_states
    where battle_id = v_round_two and (
      rematch_request_id = ((select payload from f5_request_one)->>'id')::uuid or
      rematch_request_after_battle_id = ((select payload from f5_initial)->>'id')::uuid
    )
  ) then raise exception 'f5a_round_two_projection_leaked_round_one_request'; end if;
end;
$$;

do $$
declare
  v_series uuid := ((select payload from f5_request_one)->>'series_id')::uuid;
  v_round_two uuid := ((select payload from f5_accept)->'battle'->>'id')::uuid;
begin
  perform pg_temp.finish_round(v_round_two, 'opponent', pg_temp.f5_user(2));
  if not exists (
    select 1 from public.live_battle_series
    where id = v_series and challenger_wins = 1 and opponent_wins = 1
      and rounds_completed = 2 and status = 'awaiting_rematch'
  ) then raise exception 'f5a_authoritative_aggregate_invalid'; end if;
  if exists (
    select 1 from public.live_battle_public_states
    where battle_id = v_round_two and (
      rematch_request_id is not null or
      rematch_request_after_battle_id is not null or
      rematch_request_status is not null or
      rematch_request_expires_at is not null
    )
  ) then raise exception 'f5a_round_two_projection_leaked_round_one_request'; end if;
  if not exists (
    select 1 from public.live_battle_public_states as projection
    join public.live_battle_series as series on series.id = projection.series_id
    where projection.battle_id = v_round_two
      and projection.rematch_window_expires_at = series.rematch_window_expires_at
      and projection.rematch_window_expires_at is not null
  ) then raise exception 'f5a_round_two_window_invalid'; end if;
end;
$$;

do $$
begin
  begin
    perform public.request_live_battle_rematch(
      ((select payload from f5_initial)->>'id')::uuid,
      'f5a30000-0000-4000-8000-000000000099'::uuid
    );
    raise exception 'f5a_old_round_request_allowed';
  exception when sqlstate '55000' then
    if sqlerrm <> 'live_battle_rematch_round_not_latest' then raise; end if;
  end;
end;
$$;

select pg_catalog.set_config('request.jwt.claim.sub', pg_temp.f5_user(1)::text, true);
create temp table f5_request_two as
select public.request_live_battle_rematch(
  ((select payload from f5_accept)->'battle'->>'id')::uuid,
  'f5a30000-0000-4000-8000-000000000002'::uuid
) as payload;

do $$
begin
  if not exists (
    select 1 from public.live_battle_public_states as projection
    join public.live_battle_rematch_requests as request
      on request.id = projection.rematch_request_id
    where projection.battle_id = ((select payload from f5_accept)->'battle'->>'id')::uuid
      and projection.rematch_request_after_battle_id = projection.battle_id
      and projection.rematch_request_status = 'pending'
      and projection.rematch_request_expires_at = request.expires_at
      and projection.rematch_window_expires_at is not null
  ) then raise exception 'f5a_round_two_request_anchor_invalid'; end if;
end;
$$;

select pg_catalog.set_config('request.jwt.claim.sub', pg_temp.f5_user(2)::text, true);
create temp table f5_accept_two as
select public.respond_live_battle_rematch(
  ((select payload from f5_request_two)->>'id')::uuid, 'accept'
) as payload;

do $$
declare
  v_round_three uuid := ((select payload from f5_accept_two)->'battle'->>'id')::uuid;
begin
  if (select count(*) from public.live_battles
      where series_id = ((select payload from f5_request_one)->>'series_id')::uuid
        and round_number = 3 and id = v_round_three) <> 1
  then raise exception 'f5a_round_three_creation_invalid'; end if;
  if exists (
    select 1 from public.live_battle_public_states
    where battle_id = v_round_three and (
      rematch_request_id is not null or
      rematch_request_after_battle_id is not null or
      rematch_request_status is not null or
      rematch_request_expires_at is not null
    )
  ) then raise exception 'f5a_round_three_projection_leaked_historical_request'; end if;
  perform pg_temp.finish_round(v_round_three, 'challenger', pg_temp.f5_user(1));
end;
$$;

select pg_catalog.set_config('request.jwt.claim.sub', pg_temp.f5_user(1)::text, true);
create temp table f5_reject_request as
select public.request_live_battle_rematch(
  ((select payload from f5_accept_two)->'battle'->>'id')::uuid,
  'f5a30000-0000-4000-8000-000000000003'::uuid
) as payload;
select pg_catalog.set_config('request.jwt.claim.sub', pg_temp.f5_user(2)::text, true);
select public.respond_live_battle_rematch(
  ((select payload from f5_reject_request)->>'id')::uuid, 'reject'
);

do $$
begin
  if not exists (
    select 1 from public.live_battle_series
    where id = ((select payload from f5_request_one)->>'series_id')::uuid
      and status = 'completed' and champion_user_id = pg_temp.f5_user(1)
      and completed_at is not null
  ) then raise exception 'f5a_reject_series_result_invalid'; end if;
  if not exists (
    select 1 from public.live_battle_public_states
    where battle_id = ((select payload from f5_accept_two)->'battle'->>'id')::uuid
      and rematch_request_id = ((select payload from f5_reject_request)->>'id')::uuid
      and rematch_request_after_battle_id = battle_id
      and rematch_request_status = 'rejected'
      and rematch_request_expires_at is not null
      and rematch_window_expires_at is null
  ) then raise exception 'f5a_rejected_request_projection_invalid'; end if;
end;
$$;

-- Nonterminal, non-LIVE, expiry, and leave behavior use a reusable second pair.
select pg_catalog.set_config('request.jwt.claim.sub', pg_temp.f5_user(9)::text, true);
create temp table f5_expiry_initial as
select public.create_live_battle_invite(
  pg_temp.f5_user(10), pg_temp.f5_session(9), pg_temp.f5_session(10)
) as payload;
do $$
begin
  begin
    perform public.request_live_battle_rematch(
      ((select payload from f5_expiry_initial)->>'id')::uuid,
      pg_catalog.gen_random_uuid()
    );
    raise exception 'f5a_nonterminal_round_request_allowed';
  exception when sqlstate '55000' then
    if sqlerrm <> 'live_battle_rematch_round_not_completed' then raise; end if;
  end;
  perform pg_temp.finish_round(
    ((select payload from f5_expiry_initial)->>'id')::uuid,
    'tie', null
  );
end;
$$;

update public.live_sessions
set status = 'ended', ended_at = pg_catalog.clock_timestamp(), end_reason = 'proof'
where id = pg_temp.f5_session(10);
do $$
begin
  begin
    perform public.request_live_battle_rematch(
      ((select payload from f5_expiry_initial)->>'id')::uuid,
      pg_catalog.gen_random_uuid()
    );
    raise exception 'f5a_non_live_rematch_allowed';
  exception when sqlstate '55000' then
    if sqlerrm <> 'live_battle_rematch_sessions_not_live' then raise; end if;
  end;
end;
$$;
update public.live_sessions
set status = 'live', ended_at = null, end_reason = null,
    last_heartbeat_at = pg_catalog.clock_timestamp()
where id = pg_temp.f5_session(10);

create temp table f5_expiring_request as
select public.request_live_battle_rematch(
  ((select payload from f5_expiry_initial)->>'id')::uuid,
  'f5a30000-0000-4000-8000-000000000010'::uuid
) as payload;
update public.live_battle_score_states
set finalized_at = pg_catalog.clock_timestamp() - interval '40 seconds',
    updated_at = pg_catalog.clock_timestamp()
where battle_id = ((select payload from f5_expiry_initial)->>'id')::uuid;
update public.live_battle_rematch_requests
set created_at = pg_catalog.clock_timestamp() - interval '50 seconds',
    expires_at = pg_catalog.clock_timestamp() - interval '10 seconds'
where id = ((select payload from f5_expiring_request)->>'id')::uuid;
select private.reconcile_due_live_battle_series(100);
do $$
begin
  if not exists (
    select 1 from public.live_battle_rematch_requests
    where id = ((select payload from f5_expiring_request)->>'id')::uuid
      and status = 'expired' and responded_at is not null
  ) or not exists (
    select 1 from public.live_battle_series
    where id = ((select payload from f5_expiring_request)->>'series_id')::uuid
      and status = 'completed' and completed_at is not null
  ) or not exists (
    select 1 from public.live_battle_public_states
    where battle_id = ((select payload from f5_expiry_initial)->>'id')::uuid
      and rematch_request_id = ((select payload from f5_expiring_request)->>'id')::uuid
      and rematch_request_after_battle_id = battle_id
      and rematch_request_status = 'expired'
      and rematch_request_expires_at is not null
      and rematch_window_expires_at is null
  ) then raise exception 'f5a_expiry_reconciliation_invalid'; end if;
end;
$$;

create temp table f5_leave_initial as
select public.create_live_battle_invite(
  pg_temp.f5_user(10), pg_temp.f5_session(9), pg_temp.f5_session(10)
) as payload;
select pg_temp.finish_round(
  ((select payload from f5_leave_initial)->>'id')::uuid,
  'challenger', pg_temp.f5_user(9)
);
create temp table f5_leave_request as
select public.request_live_battle_rematch(
  ((select payload from f5_leave_initial)->>'id')::uuid,
  'f5a30000-0000-4000-8000-000000000011'::uuid
) as payload;
select public.leave_live_battle_series(
  ((select payload from f5_leave_request)->>'series_id')::uuid
);
do $$
begin
  if not exists (
    select 1 from public.live_battle_series
    where id = ((select payload from f5_leave_request)->>'series_id')::uuid
      and status = 'completed' and champion_user_id = pg_temp.f5_user(9)
  ) or not exists (
    select 1 from public.live_battle_rematch_requests
    where id = ((select payload from f5_leave_request)->>'id')::uuid
      and status = 'cancelled'
  ) or not exists (
    select 1 from public.live_battle_public_states
    where battle_id = ((select payload from f5_leave_initial)->>'id')::uuid
      and rematch_request_id = ((select payload from f5_leave_request)->>'id')::uuid
      and rematch_request_after_battle_id = battle_id
      and rematch_request_status = 'cancelled'
      and rematch_window_expires_at is null
  ) or exists (
    select 1 from public.live_sessions
    where id in (pg_temp.f5_session(9), pg_temp.f5_session(10))
      and status <> 'live'
  ) then raise exception 'f5a_leave_series_invalid'; end if;
end;
$$;

create temp table f5_stale_initial as
select public.create_live_battle_invite(
  pg_temp.f5_user(10), pg_temp.f5_session(9), pg_temp.f5_session(10)
) as payload;
update public.live_battles
set created_at = pg_catalog.clock_timestamp() - interval '2 seconds',
    invite_expires_at = pg_catalog.clock_timestamp() - interval '1 second',
    updated_at = pg_catalog.clock_timestamp()
where id = ((select payload from f5_stale_initial)->>'id')::uuid;
create temp table f5_after_stale as
select public.create_live_battle_invite(
  pg_temp.f5_user(10), pg_temp.f5_session(9), pg_temp.f5_session(10)
) as payload;
do $$
begin
  if (select payload->>'id' from f5_stale_initial) =
     (select payload->>'id' from f5_after_stale)
     or not exists (
       select 1 from public.live_battle_series
       where id = ((select payload from f5_stale_initial)->>'series_id')::uuid
         and status = 'cancelled'
     )
     or not exists (
       select 1 from public.live_battles
       where id = ((select payload from f5_after_stale)->>'id')::uuid
         and round_number = 1 and status = 'pending'
     )
  then raise exception 'f5a_stale_series_reconciliation_invalid'; end if;
end;
$$;

-- Direct aggregate fixtures cover early 3-0, 3-2, and a tied five-round result.
create function pg_temp.seed_series(p_first integer)
returns uuid language plpgsql
as $$
declare v_id uuid := pg_catalog.gen_random_uuid();
begin
  insert into public.live_battle_series (
    id, challenger_user_id, opponent_user_id,
    challenger_session_id, opponent_session_id,
    format, max_rounds, wins_required, status
  ) values (
    v_id, pg_temp.f5_user(p_first), pg_temp.f5_user(p_first + 1),
    pg_temp.f5_session(p_first), pg_temp.f5_session(p_first + 1),
    'best_of_5', 5, 3, 'active'
  );
  return v_id;
end;
$$;

create function pg_temp.add_finished_round(
  p_series uuid, p_round integer, p_outcome text
)
returns uuid language plpgsql
as $$
declare
  v_series public.live_battle_series%rowtype;
  v_battle uuid := pg_catalog.gen_random_uuid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_winner uuid;
begin
  select * into strict v_series from public.live_battle_series where id = p_series;
  v_winner := case p_outcome when 'challenger' then v_series.challenger_user_id
    when 'opponent' then v_series.opponent_user_id else null end;
  insert into public.live_battles (
    id, challenger_user_id, opponent_user_id,
    challenger_session_id, opponent_session_id,
    status, invite_expires_at, accepted_at, countdown_started_at,
    scheduled_start_at, started_at, scheduled_end_at, ended_at,
    last_transition_actor_id, last_transition_reason,
    version, created_at, updated_at, series_id, round_number
  ) values (
    v_battle, v_series.challenger_user_id, v_series.opponent_user_id,
    v_series.challenger_session_id, v_series.opponent_session_id,
    'completed', v_now - interval '390 seconds', v_now - interval '380 seconds',
    v_now - interval '303 seconds', v_now - interval '300 seconds',
    v_now - interval '300 seconds', v_now, v_now,
    null, 'f5a_fixture_completed', 5,
    v_now - interval '400 seconds', v_now, p_series, p_round
  );
  update public.live_battle_score_states
  set challenger_score = case when p_outcome = 'challenger' then 10 else 0 end,
      opponent_score = case when p_outcome = 'opponent' then 10 else 0 end,
      score_version = 1, outcome = p_outcome, winner_user_id = v_winner,
      finalized_at = v_now, updated_at = v_now
  where battle_id = v_battle;
  return v_battle;
end;
$$;

create temp table f5_aggregate_series(kind text primary key, series_id uuid);
insert into f5_aggregate_series values
  ('three_zero', pg_temp.seed_series(3)),
  ('three_two', pg_temp.seed_series(5)),
  ('five_tie', pg_temp.seed_series(7));

select pg_temp.add_finished_round((select series_id from f5_aggregate_series where kind='three_zero'), n, 'challenger')
from pg_catalog.generate_series(1, 3) as n;
select pg_temp.add_finished_round(
  (select series_id from f5_aggregate_series where kind='three_two'), n,
  (array['challenger','opponent','challenger','opponent','challenger'])[n]
) from pg_catalog.generate_series(1, 5) as n;
select pg_temp.add_finished_round(
  (select series_id from f5_aggregate_series where kind='five_tie'), n,
  (array['challenger','opponent','challenger','opponent','tie'])[n]
) from pg_catalog.generate_series(1, 5) as n;

do $$
begin
  if not exists (
    select 1 from public.live_battle_series
    where id = (select series_id from f5_aggregate_series where kind='three_zero')
      and status = 'completed' and challenger_wins = 3
      and opponent_wins = 0 and rounds_completed = 3
      and champion_user_id = pg_temp.f5_user(3)
  ) then raise exception 'f5a_three_zero_invalid'; end if;
  if not exists (
    select 1 from public.live_battle_series
    where id = (select series_id from f5_aggregate_series where kind='three_two')
      and status = 'completed' and challenger_wins = 3
      and opponent_wins = 2 and rounds_completed = 5
      and champion_user_id = pg_temp.f5_user(5)
  ) then raise exception 'f5a_three_two_invalid'; end if;
  if not exists (
    select 1 from public.live_battle_series
    where id = (select series_id from f5_aggregate_series where kind='five_tie')
      and status = 'completed' and challenger_wins = 2
      and opponent_wins = 2 and ties = 1 and rounds_completed = 5
      and champion_user_id is null
  ) then raise exception 'f5a_five_round_tie_invalid'; end if;
  begin
    perform pg_temp.add_finished_round(
      (select series_id from f5_aggregate_series where kind='five_tie'), 6, 'tie'
    );
    raise exception 'f5a_round_six_allowed';
  exception when check_violation then null;
  end;
end;
$$;

do $$
begin
  if exists (
    select 1 from public.live_battle_public_states as projection
    join public.live_battles as battle on battle.id = projection.battle_id
    where projection.local_battle_side <> case
      when projection.session_id = battle.challenger_session_id then 'challenger'
      else 'opponent' end
  ) then raise exception 'f5a_local_side_not_canonical'; end if;
  if (select count(*) from pg_catalog.pg_publication_tables
      where schemaname = 'public' and tablename = 'live_battle_public_states') <> 1
  then raise exception 'f5a_realtime_subscription_count_invalid'; end if;
  if (select count(*) from public.live_gift_transactions) <>
       (select gifts from f5_financial_baseline)
     or (select count(*) from public.financial_transactions) <>
       (select financial from f5_financial_baseline)
     or (select count(*) from public.ledger_entries) <>
       (select ledger from f5_financial_baseline)
     or (select coalesce(sum(balance), 0) from public.ledger_accounts) <>
       (select balances from f5_financial_baseline)
  then raise exception 'f5a_financial_state_changed'; end if;
end;
$$;

rollback;
