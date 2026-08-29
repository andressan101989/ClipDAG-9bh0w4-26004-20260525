begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
)
select
  ('8a000000-0000-4000-8000-' || pg_catalog.lpad(n::text, 12, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated',
  'authenticated',
  'lb4f3f3f1f2-host-' || n || '@proof.local',
  'proof',
  pg_catalog.clock_timestamp(),
  pg_catalog.clock_timestamp()
from pg_catalog.generate_series(1, 1200) n;

insert into public.user_profiles (id, username, display_name, is_admin)
select
  ('8a000000-0000-4000-8000-' || pg_catalog.lpad(n::text, 12, '0'))::uuid,
  'lb4f3f3f1f2_host_' || n,
  'LB4-F3-F3-F1-F2 host ' || n,
  false
from pg_catalog.generate_series(1, 1200) n;

insert into public.live_sessions (
  id, host_id, title, status, viewer_count, started_at, ended_at,
  created_at, last_heartbeat_at, host_disconnected_at, end_reason
)
select
  ('8b000000-0000-4000-8000-' || pg_catalog.lpad(n::text, 12, '0'))::uuid,
  ('8a000000-0000-4000-8000-' || pg_catalog.lpad(n::text, 12, '0'))::uuid,
  'LB4-F3-F3-F1-F2 session ' || n,
  'live', 0,
  pg_catalog.clock_timestamp() - interval '20 minutes', null,
  pg_catalog.clock_timestamp() - interval '20 minutes',
  pg_catalog.clock_timestamp(), null, null
from pg_catalog.generate_series(1, 1200) n;

create function pg_temp.proof_user(p_id integer)
returns uuid language sql immutable
as $$
  select ('8a000000-0000-4000-8000-' || pg_catalog.lpad(p_id::text, 12, '0'))::uuid
$$;

create function pg_temp.proof_session(p_id integer)
returns uuid language sql immutable
as $$
  select ('8b000000-0000-4000-8000-' || pg_catalog.lpad(p_id::text, 12, '0'))::uuid
$$;

create function pg_temp.proof_battle(p_id integer)
returns uuid language sql immutable
as $$
  select ('8c000000-0000-4000-8000-' || pg_catalog.lpad(p_id::text, 12, '0'))::uuid
$$;

create function pg_temp.add_battle(
  p_id integer,
  p_challenger integer,
  p_opponent integer,
  p_status text,
  p_accepted_age interval default interval '0 seconds'
)
returns uuid
language plpgsql
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_id uuid := pg_temp.proof_battle(p_id);
  v_accepted_at timestamptz;
  v_countdown_at timestamptz;
  v_scheduled_start_at timestamptz;
  v_started_at timestamptz;
  v_scheduled_end_at timestamptz;
  v_actor uuid;
  v_reason text;
  v_version bigint;
begin
  if p_status = 'pending' then
    v_actor := pg_temp.proof_user(p_challenger);
    v_reason := 'invite_created';
    v_version := 1;
  elsif p_status = 'accepted' then
    v_accepted_at := v_now - p_accepted_age;
    v_actor := pg_temp.proof_user(p_opponent);
    v_reason := 'invite_accepted';
    v_version := 2;
  elsif p_status = 'countdown' then
    v_accepted_at := v_now - interval '20 seconds';
    v_countdown_at := v_now - interval '3 seconds';
    v_scheduled_start_at := v_now;
    v_actor := pg_temp.proof_user(p_challenger);
    v_reason := 'countdown_started';
    v_version := 3;
  elsif p_status = 'active' then
    v_accepted_at := v_now - interval '310 seconds';
    v_countdown_at := v_now - interval '303 seconds';
    v_scheduled_start_at := v_now - interval '300 seconds';
    v_started_at := v_scheduled_start_at;
    v_scheduled_end_at := v_now;
    v_actor := null;
    v_reason := 'countdown_elapsed';
    v_version := 4;
  else
    raise exception 'unsupported proof status';
  end if;

  insert into public.live_battles (
    id, challenger_user_id, opponent_user_id,
    challenger_session_id, opponent_session_id,
    status, invite_expires_at, accepted_at, countdown_started_at,
    scheduled_start_at, started_at, scheduled_end_at, ended_at,
    last_transition_actor_id, last_transition_reason, version, created_at, updated_at
  ) values (
    v_id,
    pg_temp.proof_user(p_challenger),
    pg_temp.proof_user(p_opponent),
    pg_temp.proof_session(p_challenger),
    pg_temp.proof_session(p_opponent),
    p_status,
    case when p_status = 'pending' then v_now + interval '30 seconds'
         else v_now - interval '5 minutes' end,
    v_accepted_at,
    v_countdown_at,
    v_scheduled_start_at,
    v_started_at,
    v_scheduled_end_at,
    null,
    v_actor,
    v_reason,
    v_version,
    v_now - interval '20 minutes',
    coalesce(v_started_at, v_countdown_at, v_accepted_at, v_now)
  );
  return v_id;
end;
$$;

create function pg_temp.assert_transition_rejected(
  p_battle_id uuid,
  p_expected_status text,
  p_next_status text,
  p_actor_user_id uuid,
  p_reason text,
  p_marker text
)
returns void
language plpgsql
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_before_events bigint;
  v_after_events bigint;
  v_sqlstate text;
  v_message text;
begin
  select pg_catalog.to_jsonb(b) into strict v_before
  from public.live_battles b where b.id = p_battle_id;
  select pg_catalog.count(*) into v_before_events
  from public.live_battle_events where battle_id = p_battle_id;

  begin
    perform private.live_battle_transition(
      p_battle_id, p_expected_status, p_next_status,
      p_actor_user_id, p_reason, pg_catalog.clock_timestamp()
    );
    raise exception using message = p_marker;
  exception when others then
    get stacked diagnostics
      v_sqlstate = returned_sqlstate,
      v_message = message_text;
    if v_sqlstate <> '42501'
      or v_message <> 'live_battle_transition_actor_invalid'
    then
      raise exception 'transition_wrong_sqlstate_or_message: %, %, %',
        p_marker, v_sqlstate, v_message;
    end if;
  end;

  select pg_catalog.to_jsonb(b) into strict v_after
  from public.live_battles b where b.id = p_battle_id;
  select pg_catalog.count(*) into v_after_events
  from public.live_battle_events where battle_id = p_battle_id;
  if v_after is distinct from v_before then
    raise exception 'transition_rejection_mutated_row: %', p_marker;
  end if;
  if v_after_events is distinct from v_before_events then
    raise exception 'transition_rejection_added_event: %', p_marker;
  end if;
end;
$$;

create function pg_temp.assert_transition_allowed(
  p_battle_id uuid,
  p_expected_status text,
  p_next_status text,
  p_actor_user_id uuid,
  p_reason text,
  p_marker text
)
returns void
language plpgsql
as $$
declare
  v_before public.live_battles%rowtype;
  v_after public.live_battles%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_events bigint;
begin
  select * into strict v_before
  from public.live_battles where id = p_battle_id;
  v_after := private.live_battle_transition(
    p_battle_id, p_expected_status, p_next_status,
    p_actor_user_id, p_reason, v_now
  );
  select pg_catalog.count(*) into v_events
  from public.live_battle_events e
  where e.battle_id = p_battle_id
    and e.from_status = p_expected_status
    and e.to_status = p_next_status
    and e.actor_user_id is not distinct from p_actor_user_id
    and e.reason = p_reason
    and e.version = v_before.version + 1
    and e.created_at = v_now;
  if v_after.status is distinct from p_next_status
    or v_after.version is distinct from v_before.version + 1
    or v_after.last_transition_actor_id is distinct from p_actor_user_id
    or v_after.last_transition_reason is distinct from p_reason
    or v_events <> 1
  then
    raise exception 'transition_positive_failed: %', p_marker;
  end if;
end;
$$;

-- pending -> accepted: exact opponent actor and exact non-null reason.
select pg_temp.add_battle(1, 1, 2, 'pending');
select pg_temp.assert_transition_allowed(pg_temp.proof_battle(1), 'pending', 'accepted', pg_temp.proof_user(2), 'invite_accepted', 'accept_positive');
select pg_temp.add_battle(2, 3, 4, 'pending');
select pg_temp.assert_transition_rejected(pg_temp.proof_battle(2), 'pending', 'accepted', pg_temp.proof_user(4), null, 'accept_null_reason');
select pg_temp.add_battle(3, 5, 6, 'pending');
select pg_temp.assert_transition_rejected(pg_temp.proof_battle(3), 'pending', 'accepted', pg_temp.proof_user(6), 'wrong_reason', 'accept_wrong_reason');
select pg_temp.add_battle(4, 7, 8, 'pending');
select pg_temp.assert_transition_rejected(pg_temp.proof_battle(4), 'pending', 'accepted', pg_temp.proof_user(7), 'invite_accepted', 'accept_wrong_actor');
select pg_temp.add_battle(5, 9, 10, 'pending');
select pg_temp.assert_transition_rejected(pg_temp.proof_battle(5), 'pending', 'accepted', null, 'invite_accepted', 'accept_null_actor');

-- pending -> rejected: exact opponent actor and exact non-null reason.
select pg_temp.add_battle(6, 11, 12, 'pending');
select pg_temp.assert_transition_allowed(pg_temp.proof_battle(6), 'pending', 'rejected', pg_temp.proof_user(12), 'invite_rejected', 'reject_positive');
select pg_temp.add_battle(7, 13, 14, 'pending');
select pg_temp.assert_transition_rejected(pg_temp.proof_battle(7), 'pending', 'rejected', pg_temp.proof_user(14), null, 'reject_null_reason');
select pg_temp.add_battle(8, 15, 16, 'pending');
select pg_temp.assert_transition_rejected(pg_temp.proof_battle(8), 'pending', 'rejected', pg_temp.proof_user(16), 'wrong_reason', 'reject_wrong_reason');
select pg_temp.add_battle(9, 17, 18, 'pending');
select pg_temp.assert_transition_rejected(pg_temp.proof_battle(9), 'pending', 'rejected', pg_temp.proof_user(17), 'invite_rejected', 'reject_wrong_actor');
select pg_temp.add_battle(10, 19, 20, 'pending');
select pg_temp.assert_transition_rejected(pg_temp.proof_battle(10), 'pending', 'rejected', null, 'invite_rejected', 'reject_null_actor');

-- pending -> expired: exact null actor and exact non-null reason.
select pg_temp.add_battle(11, 21, 22, 'pending');
select pg_temp.assert_transition_allowed(pg_temp.proof_battle(11), 'pending', 'expired', null, 'invite_expired', 'expire_positive');
select pg_temp.add_battle(12, 23, 24, 'pending');
select pg_temp.assert_transition_rejected(pg_temp.proof_battle(12), 'pending', 'expired', null, null, 'expire_null_reason');
select pg_temp.add_battle(13, 25, 26, 'pending');
select pg_temp.assert_transition_rejected(pg_temp.proof_battle(13), 'pending', 'expired', null, 'wrong_reason', 'expire_wrong_reason');
select pg_temp.add_battle(14, 27, 28, 'pending');
select pg_temp.assert_transition_rejected(pg_temp.proof_battle(14), 'pending', 'expired', pg_temp.proof_user(27), 'invite_expired', 'expire_nonnull_actor');

-- accepted -> countdown: participant actor is mandatory; null actor is the critical regression.
select pg_temp.add_battle(15, 29, 30, 'accepted');
select pg_temp.assert_transition_allowed(pg_temp.proof_battle(15), 'accepted', 'countdown', pg_temp.proof_user(29), 'countdown_started', 'countdown_positive');
select pg_temp.add_battle(16, 31, 32, 'accepted');
select pg_temp.assert_transition_rejected(pg_temp.proof_battle(16), 'accepted', 'countdown', pg_temp.proof_user(31), null, 'countdown_null_reason');
select pg_temp.add_battle(17, 33, 34, 'accepted');
select pg_temp.assert_transition_rejected(pg_temp.proof_battle(17), 'accepted', 'countdown', pg_temp.proof_user(33), 'wrong_reason', 'countdown_wrong_reason');
select pg_temp.add_battle(18, 35, 36, 'accepted');
select pg_temp.assert_transition_rejected(pg_temp.proof_battle(18), 'accepted', 'countdown', pg_temp.proof_user(100), 'countdown_started', 'countdown_wrong_actor');
select pg_temp.add_battle(19, 37, 38, 'accepted');
select pg_temp.assert_transition_rejected(pg_temp.proof_battle(19), 'accepted', 'countdown', null, 'countdown_started', 'countdown_null_actor_not_rejected');

-- countdown -> active and active -> completed require null actor and exact reasons.
select pg_temp.add_battle(20, 39, 40, 'countdown');
select pg_temp.assert_transition_allowed(pg_temp.proof_battle(20), 'countdown', 'active', null, 'countdown_elapsed', 'active_positive');
select pg_temp.add_battle(21, 41, 42, 'countdown');
select pg_temp.assert_transition_rejected(pg_temp.proof_battle(21), 'countdown', 'active', null, null, 'active_null_reason');
select pg_temp.add_battle(22, 43, 44, 'countdown');
select pg_temp.assert_transition_rejected(pg_temp.proof_battle(22), 'countdown', 'active', null, 'wrong_reason', 'active_wrong_reason');
select pg_temp.add_battle(23, 45, 46, 'countdown');
select pg_temp.assert_transition_rejected(pg_temp.proof_battle(23), 'countdown', 'active', pg_temp.proof_user(45), 'countdown_elapsed', 'active_nonnull_actor');
select pg_temp.add_battle(24, 47, 48, 'active');
select pg_temp.assert_transition_allowed(pg_temp.proof_battle(24), 'active', 'completed', null, 'battle_duration_elapsed', 'complete_positive');
select pg_temp.add_battle(25, 49, 50, 'active');
select pg_temp.assert_transition_rejected(pg_temp.proof_battle(25), 'active', 'completed', null, null, 'complete_null_reason');
select pg_temp.add_battle(26, 51, 52, 'active');
select pg_temp.assert_transition_rejected(pg_temp.proof_battle(26), 'active', 'completed', null, 'wrong_reason', 'complete_wrong_reason');
select pg_temp.add_battle(27, 53, 54, 'active');
select pg_temp.assert_transition_rejected(pg_temp.proof_battle(27), 'active', 'completed', pg_temp.proof_user(53), 'battle_duration_elapsed', 'complete_nonnull_actor');

-- All five established cancellation authorities remain valid.
select pg_temp.add_battle(28, 55, 56, 'accepted');
select pg_temp.assert_transition_allowed(pg_temp.proof_battle(28), 'accepted', 'cancelled', pg_temp.proof_user(55), 'challenger_cancelled', 'cancel_challenger_positive');
select pg_temp.add_battle(29, 57, 58, 'accepted');
select pg_temp.assert_transition_allowed(pg_temp.proof_battle(29), 'accepted', 'cancelled', pg_temp.proof_user(58), 'opponent_cancelled', 'cancel_opponent_positive');
select pg_temp.add_battle(30, 59, 60, 'accepted');
select pg_temp.assert_transition_allowed(pg_temp.proof_battle(30), 'accepted', 'cancelled', null, 'accepted_start_timeout', 'cancel_timeout_positive');
select pg_temp.add_battle(31, 61, 62, 'accepted');
select pg_temp.assert_transition_allowed(pg_temp.proof_battle(31), 'accepted', 'cancelled', null, 'session_not_live_after_accept', 'cancel_after_accept_positive');
select pg_temp.add_battle(32, 63, 64, 'countdown');
select pg_temp.assert_transition_allowed(pg_temp.proof_battle(32), 'countdown', 'cancelled', null, 'session_not_live_before_start', 'cancel_before_start_positive');

-- Deadline and lifecycle regressions use the existing locked reconciler unchanged.
select pg_temp.add_battle(40, 81, 82, 'accepted');
do $$
declare
  v_before public.live_battles%rowtype;
  v_result public.live_battles%rowtype;
begin
  select * into strict v_before from public.live_battles where id = pg_temp.proof_battle(40);
  v_result := private.live_battle_reconcile_locked(v_before.id, v_before.accepted_at + interval '29 seconds');
  if v_result.status <> 'accepted' or v_result.version <> v_before.version then
    raise exception 'accepted_29_seconds_changed';
  end if;
  v_result := private.live_battle_reconcile_locked(v_before.id, v_before.accepted_at + interval '30 seconds');
  if v_result.status <> 'cancelled'
    or v_result.version <> v_before.version + 1
    or v_result.last_transition_reason <> 'accepted_start_timeout'
  then raise exception 'accepted_30_seconds_not_cancelled'; end if;
end;
$$;

select pg_temp.add_battle(41, 83, 84, 'accepted', interval '31 seconds');
update public.live_sessions set status = 'ended', ended_at = pg_catalog.clock_timestamp(), end_reason = 'proof'
where id = pg_temp.proof_session(84);
do $$
declare v_result public.live_battles%rowtype;
begin
  v_result := private.live_battle_reconcile_locked(pg_temp.proof_battle(41), pg_catalog.clock_timestamp());
  if v_result.status <> 'cancelled' or v_result.last_transition_reason <> 'session_not_live_after_accept'
  then raise exception 'session_liveness_priority_failed'; end if;
end;
$$;

select pg_temp.add_battle(42, 85, 86, 'pending');
do $$
declare v_before public.live_battles%rowtype; v_result public.live_battles%rowtype;
begin
  select * into strict v_before from public.live_battles where id = pg_temp.proof_battle(42);
  v_result := private.live_battle_reconcile_locked(v_before.id, v_before.invite_expires_at);
  if v_result.status <> 'expired' or v_result.last_transition_reason <> 'invite_expired'
  then raise exception 'pending_expiry_failed'; end if;
end;
$$;

select pg_temp.add_battle(43, 87, 88, 'countdown');
do $$
declare v_result public.live_battles%rowtype;
begin
  v_result := private.live_battle_reconcile_locked(pg_temp.proof_battle(43), pg_catalog.clock_timestamp());
  if v_result.status <> 'active' or v_result.last_transition_reason <> 'countdown_elapsed'
  then raise exception 'countdown_activation_failed'; end if;
end;
$$;

select pg_temp.add_battle(44, 89, 90, 'countdown');
update public.live_sessions set status = 'ended', ended_at = pg_catalog.clock_timestamp(), end_reason = 'proof'
where id = pg_temp.proof_session(90);
do $$
declare v_result public.live_battles%rowtype;
begin
  v_result := private.live_battle_reconcile_locked(pg_temp.proof_battle(44), pg_catalog.clock_timestamp());
  if v_result.status <> 'cancelled' or v_result.last_transition_reason <> 'session_not_live_before_start'
  then raise exception 'countdown_liveness_cancel_failed'; end if;
end;
$$;

select pg_temp.add_battle(45, 91, 92, 'active');
do $$
declare
  v_result public.live_battles%rowtype;
  v_events bigint;
begin
  v_result := private.live_battle_reconcile_locked(pg_temp.proof_battle(45), pg_catalog.clock_timestamp());
  if v_result.status <> 'completed' or v_result.last_transition_reason <> 'battle_duration_elapsed'
  then raise exception 'active_completion_failed'; end if;
  v_result := private.live_battle_reconcile_locked(pg_temp.proof_battle(45), pg_catalog.clock_timestamp());
  select pg_catalog.count(*) into v_events from public.live_battle_events
  where battle_id = pg_temp.proof_battle(45) and reason = 'battle_duration_elapsed';
  if v_result.status <> 'completed' or v_events <> 1
  then raise exception 'reconcile_not_idempotent'; end if;
end;
$$;

-- Busy decisions remain unchanged for current Battles.
select pg_temp.add_battle(46, 93, 94, 'accepted');
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', pg_temp.proof_user(93)::text, true);
do $$
begin
  begin
    perform public.create_live_battle_invite(
      pg_temp.proof_user(94), pg_temp.proof_session(93), pg_temp.proof_session(94)
    );
    raise exception 'pair_busy_regression';
  exception when sqlstate '55000' then
    if sqlerrm <> 'live_battle_pair_busy' then raise; end if;
  end;
end;
$$;
reset role;

select pg_temp.add_battle(47, 95, 96, 'pending');
select pg_temp.add_battle(48, 96, 97, 'accepted');
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', pg_temp.proof_user(96)::text, true);
do $$
begin
  begin
    perform public.respond_live_battle_invite(pg_temp.proof_battle(47), true);
    raise exception 'participant_busy_regression';
  exception when sqlstate '55000' then
    if sqlerrm <> 'live_battle_participant_busy' then raise; end if;
  end;
end;
$$;
reset role;

-- Representative planner volume: terminal rows dominate; each partial index has due candidates.
insert into public.live_battles (
  id, challenger_user_id, opponent_user_id,
  challenger_session_id, opponent_session_id,
  status, invite_expires_at, ended_at,
  last_transition_actor_id, last_transition_reason, version, created_at, updated_at
)
select
  ('8d900000-0000-4000-8000-' || pg_catalog.lpad(n::text, 12, '0'))::uuid,
  pg_temp.proof_user(1199), pg_temp.proof_user(1200),
  pg_temp.proof_session(1199), pg_temp.proof_session(1200),
  'rejected', pg_catalog.clock_timestamp() - interval '10 minutes',
  pg_catalog.clock_timestamp() - interval '9 minutes',
  pg_temp.proof_user(1200), 'invite_rejected', 2,
  pg_catalog.clock_timestamp() - interval '20 minutes',
  pg_catalog.clock_timestamp() - interval '9 minutes'
from pg_catalog.generate_series(1, 20000) n;

insert into public.live_battles (
  id, challenger_user_id, opponent_user_id, challenger_session_id, opponent_session_id,
  status, invite_expires_at, last_transition_actor_id, last_transition_reason,
  version, created_at, updated_at
)
select
  ('8d100000-0000-4000-8000-' || pg_catalog.lpad(n::text, 12, '0'))::uuid,
  pg_temp.proof_user(200 + n), pg_temp.proof_user(800 + n),
  pg_temp.proof_session(200 + n), pg_temp.proof_session(800 + n),
  'pending', pg_catalog.clock_timestamp() - interval '1 minute',
  pg_temp.proof_user(200 + n), 'invite_created', 1,
  pg_catalog.clock_timestamp() - interval '2 minutes',
  pg_catalog.clock_timestamp() - interval '2 minutes'
from pg_catalog.generate_series(1, 50) n;

insert into public.live_battles (
  id, challenger_user_id, opponent_user_id, challenger_session_id, opponent_session_id,
  status, invite_expires_at, accepted_at, last_transition_actor_id, last_transition_reason,
  version, created_at, updated_at
)
select
  ('8d200000-0000-4000-8000-' || pg_catalog.lpad(n::text, 12, '0'))::uuid,
  pg_temp.proof_user(250 + n), pg_temp.proof_user(850 + n),
  pg_temp.proof_session(250 + n), pg_temp.proof_session(850 + n),
  'accepted', pg_catalog.clock_timestamp() - interval '2 minutes',
  pg_catalog.clock_timestamp() - interval '31 seconds',
  pg_temp.proof_user(850 + n), 'invite_accepted', 2,
  pg_catalog.clock_timestamp() - interval '10 minutes',
  pg_catalog.clock_timestamp() - interval '31 seconds'
from pg_catalog.generate_series(1, 50) n;

insert into public.live_battles (
  id, challenger_user_id, opponent_user_id, challenger_session_id, opponent_session_id,
  status, invite_expires_at, accepted_at, last_transition_actor_id, last_transition_reason,
  version, created_at, updated_at
)
select
  ('8d300000-0000-4000-8000-' || pg_catalog.lpad(n::text, 12, '0'))::uuid,
  pg_temp.proof_user(300 + n), pg_temp.proof_user(900 + n),
  pg_temp.proof_session(300 + n), pg_temp.proof_session(900 + n),
  'accepted', pg_catalog.clock_timestamp() - interval '2 minutes',
  pg_catalog.clock_timestamp() - interval '10 seconds',
  pg_temp.proof_user(900 + n), 'invite_accepted', 2,
  pg_catalog.clock_timestamp() - interval '10 minutes',
  pg_catalog.clock_timestamp() - interval '10 seconds'
from pg_catalog.generate_series(1, 50) n;

update public.live_sessions
set status = 'ended', ended_at = pg_catalog.clock_timestamp(), end_reason = 'proof-plan'
where id in (select pg_temp.proof_session(900 + n) from pg_catalog.generate_series(1, 50) n);

insert into public.live_battles (
  id, challenger_user_id, opponent_user_id, challenger_session_id, opponent_session_id,
  status, invite_expires_at, accepted_at, countdown_started_at, scheduled_start_at,
  last_transition_actor_id, last_transition_reason, version, created_at, updated_at
)
select
  ('8d400000-0000-4000-8000-' || pg_catalog.lpad(n::text, 12, '0'))::uuid,
  pg_temp.proof_user(350 + n), pg_temp.proof_user(950 + n),
  pg_temp.proof_session(350 + n), pg_temp.proof_session(950 + n),
  'countdown', pg_catalog.statement_timestamp() - interval '5 minutes',
  pg_catalog.statement_timestamp() - interval '1 minute',
  pg_catalog.statement_timestamp() - interval '3 seconds', pg_catalog.statement_timestamp(),
  pg_temp.proof_user(350 + n), 'countdown_started', 3,
  pg_catalog.statement_timestamp() - interval '10 minutes', pg_catalog.statement_timestamp()
from pg_catalog.generate_series(1, 50) n;

insert into public.live_battles (
  id, challenger_user_id, opponent_user_id, challenger_session_id, opponent_session_id,
  status, invite_expires_at, accepted_at, countdown_started_at, scheduled_start_at,
  started_at, scheduled_end_at, last_transition_actor_id, last_transition_reason,
  version, created_at, updated_at
)
select
  ('8d500000-0000-4000-8000-' || pg_catalog.lpad(n::text, 12, '0'))::uuid,
  pg_temp.proof_user(400 + n), pg_temp.proof_user(1000 + n),
  pg_temp.proof_session(400 + n), pg_temp.proof_session(1000 + n),
  'active', pg_catalog.statement_timestamp() - interval '10 minutes',
  pg_catalog.statement_timestamp() - interval '6 minutes',
  pg_catalog.statement_timestamp() - interval '303 seconds',
  pg_catalog.statement_timestamp() - interval '300 seconds',
  pg_catalog.statement_timestamp() - interval '300 seconds', pg_catalog.statement_timestamp(),
  null, 'countdown_elapsed', 4,
  pg_catalog.statement_timestamp() - interval '20 minutes', pg_catalog.statement_timestamp()
from pg_catalog.generate_series(1, 50) n;

analyze public.live_battles;

-- EXPLAIN the complete query used by private.reconcile_due_live_battles().
prepare lb4_f3_f3_f1_f2_due_plan(timestamptz, integer) as
with due_candidates as materialized (
  select b.id, b.status, b.invite_expires_at as due_at
  from public.live_battles b
  where b.status = 'pending'
    and b.invite_expires_at <= $1
  union all
  select b.id, b.status, b.accepted_at as due_at
  from public.live_battles b
  where b.status = 'accepted'
    and b.accepted_at <= $1 - interval '30 seconds'
  union all
  select b.id, b.status, b.accepted_at as due_at
  from public.live_battles b
  where b.status = 'accepted'
    and b.accepted_at > $1 - interval '30 seconds'
    and not private.live_battle_session_pair_is_live(
      b.challenger_session_id, b.challenger_user_id,
      b.opponent_session_id, b.opponent_user_id
    )
  union all
  select b.id, b.status, b.scheduled_start_at as due_at
  from public.live_battles b
  where b.status = 'countdown'
    and b.scheduled_start_at <= $1
  union all
  select b.id, b.status, b.scheduled_end_at as due_at
  from public.live_battles b
  where b.status = 'active'
    and b.scheduled_end_at <= $1
)
select b.id, b.status
from public.live_battles b
join due_candidates d on d.id = b.id
order by d.due_at, b.id
for update of b skip locked
limit $2;

do $$
declare
  v_line record;
  v_plan text := '';
  v_start integer;
  v_fragment text;
  v_index text;
  v_column text;
  v_index_names text[] := array[
    'live_battles_pending_expiry_idx',
    'live_battles_accepted_deadline_idx',
    'live_battles_countdown_start_idx',
    'live_battles_active_end_idx'
  ];
  v_column_names text[] := array[
    'invite_expires_at',
    'accepted_at',
    'scheduled_start_at',
    'scheduled_end_at'
  ];
  v_i integer;
begin
  for v_line in execute
    'explain (costs off) execute lb4_f3_f3_f1_f2_due_plan(pg_catalog.clock_timestamp(), 100)'
  loop
    v_plan := v_plan || coalesce(v_line."QUERY PLAN", '') || E'\n';
  end loop;

  raise notice 'LB4_F3_F3_F1_F2_FULL_DUE_PLAN:%', E'\n' || v_plan;

  for v_i in 1..pg_catalog.array_length(v_index_names, 1) loop
    v_index := v_index_names[v_i];
    v_column := v_column_names[v_i];
    v_start := pg_catalog.strpos(v_plan, v_index);
    if v_start = 0 then
      raise exception 'full_due_plan_missing_index: %, %', v_index, v_plan;
    end if;
    v_fragment := pg_catalog.substr(v_plan, v_start, 700);
    if pg_catalog.strpos(v_fragment, 'Index Cond') = 0
      or pg_catalog.strpos(v_fragment, v_column) = 0
    then
      raise exception 'full_due_plan_deadline_not_index_cond: %, %', v_index, v_plan;
    end if;
  end loop;

  if (pg_catalog.length(v_plan) - pg_catalog.length(
        pg_catalog.replace(v_plan, 'live_battles_accepted_deadline_idx', '')
      )) / pg_catalog.length('live_battles_accepted_deadline_idx') < 2
  then
    raise exception 'full_due_plan_accepted_index_not_used_twice: %', v_plan;
  end if;

  if (pg_catalog.length(v_plan) - pg_catalog.length(
        pg_catalog.replace(v_plan, 'live_battles_pkey', '')
      )) / pg_catalog.length('live_battles_pkey') > 1
  then
    raise exception 'full_due_plan_branch_pkey_scan: %', v_plan;
  end if;
end;
$$;

deallocate lb4_f3_f3_f1_f2_due_plan;

do $$
declare v_proc record;
begin
  for v_proc in
    select p.oid, p.proname, p.prosecdef, p.proowner, p.proconfig, p.proacl
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('live_battle_transition', 'reconcile_due_live_battles')
  loop
    if v_proc.proowner <> 'postgres'::regrole
      or not (v_proc.proconfig @> array['search_path=""'])
      or v_proc.proacl <> array['postgres=X/postgres']::aclitem[]
      or pg_catalog.has_function_privilege('public', v_proc.oid, 'execute')
      or pg_catalog.has_function_privilege('anon', v_proc.oid, 'execute')
      or pg_catalog.has_function_privilege('authenticated', v_proc.oid, 'execute')
      or pg_catalog.has_function_privilege('service_role', v_proc.oid, 'execute')
      or (v_proc.proname = 'reconcile_due_live_battles' and not v_proc.prosecdef)
      or (v_proc.proname = 'live_battle_transition' and v_proc.prosecdef)
    then raise exception 'private_function_acl_invalid: %', v_proc.proname; end if;
  end loop;
  if not found then raise exception 'private_function_acl_invalid: missing'; end if;

  if (select pg_catalog.count(*) from cron.job
      where jobname = 'reconcile-due-live-battles') <> 1
    or not exists (
      select 1 from cron.job
      where jobname = 'reconcile-due-live-battles'
        and schedule = '* * * * *'
        and command = 'select private.reconcile_due_live_battles(100);'
        and active
        and username = 'postgres'
    )
  then raise exception 'battle_cron_changed'; end if;

  if (select pg_catalog.count(*) from pg_catalog.pg_indexes
      where schemaname = 'public' and tablename = 'live_battles'
        and indexname in (
          'live_battles_pending_expiry_idx',
          'live_battles_accepted_deadline_idx',
          'live_battles_countdown_start_idx',
          'live_battles_active_end_idx'
        )) <> 4
  then raise exception 'full_due_plan_missing_index: catalog'; end if;
end;
$$;

rollback;

do $$
begin
  if exists (
    select 1 from auth.users where email like 'lb4f3f3f1f2-host-%@proof.local'
  ) or exists (
    select 1 from public.live_battles
    where id::text like '8c000000-%' or id::text like '8d%'
  ) or exists (
    select 1 from public.live_battle_events
    where battle_id::text like '8c000000-%' or battle_id::text like '8d%'
  ) or exists (
    select 1 from public.live_battle_public_states
    where battle_id::text like '8c000000-%' or battle_id::text like '8d%'
  ) then raise exception 'lb4_f3_f3_f1_f2_fixture_cleanup_failed'; end if;
end;
$$;
