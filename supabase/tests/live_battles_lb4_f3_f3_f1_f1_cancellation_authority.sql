begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
)
select
  ('7a000000-0000-4000-8000-' || pg_catalog.lpad(n::text, 12, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated',
  'authenticated',
  'lb4f3f3f1f1-host-' || n || '@proof.local',
  'proof',
  pg_catalog.clock_timestamp(),
  pg_catalog.clock_timestamp()
from pg_catalog.generate_series(1, 40) n;

insert into public.user_profiles (id, username, display_name, is_admin)
select
  ('7a000000-0000-4000-8000-' || pg_catalog.lpad(n::text, 12, '0'))::uuid,
  'lb4f3f3f1f1_host_' || n,
  'LB4-F3-F3-F1-F1 host ' || n,
  false
from pg_catalog.generate_series(1, 40) n;

insert into public.live_sessions (
  id, host_id, title, status, viewer_count, started_at, ended_at,
  created_at, last_heartbeat_at, host_disconnected_at, end_reason
)
select
  ('7b000000-0000-4000-8000-' || pg_catalog.lpad(n::text, 12, '0'))::uuid,
  ('7a000000-0000-4000-8000-' || pg_catalog.lpad(n::text, 12, '0'))::uuid,
  'LB4-F3-F3-F1-F1 session ' || n,
  'live', 0,
  pg_catalog.clock_timestamp() - interval '20 minutes', null,
  pg_catalog.clock_timestamp() - interval '20 minutes',
  pg_catalog.clock_timestamp(), null, null
from pg_catalog.generate_series(1, 40) n;

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
  v_id uuid := ('7c000000-0000-4000-8000-' || pg_catalog.lpad(p_id::text, 12, '0'))::uuid;
  v_accepted_at timestamptz;
  v_countdown_at timestamptz;
  v_scheduled_start_at timestamptz;
  v_actor uuid;
  v_reason text;
  v_version bigint;
begin
  if p_status = 'pending' then
    v_actor := ('7a000000-0000-4000-8000-' || pg_catalog.lpad(p_challenger::text, 12, '0'))::uuid;
    v_reason := 'invite_created';
    v_version := 1;
  elsif p_status = 'accepted' then
    v_accepted_at := v_now - p_accepted_age;
    v_actor := ('7a000000-0000-4000-8000-' || pg_catalog.lpad(p_opponent::text, 12, '0'))::uuid;
    v_reason := 'invite_accepted';
    v_version := 2;
  elsif p_status = 'countdown' then
    v_accepted_at := v_now - interval '10 seconds';
    v_countdown_at := v_now;
    v_scheduled_start_at := v_now + interval '3 seconds';
    v_actor := ('7a000000-0000-4000-8000-' || pg_catalog.lpad(p_challenger::text, 12, '0'))::uuid;
    v_reason := 'countdown_started';
    v_version := 3;
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
    ('7a000000-0000-4000-8000-' || pg_catalog.lpad(p_challenger::text, 12, '0'))::uuid,
    ('7a000000-0000-4000-8000-' || pg_catalog.lpad(p_opponent::text, 12, '0'))::uuid,
    ('7b000000-0000-4000-8000-' || pg_catalog.lpad(p_challenger::text, 12, '0'))::uuid,
    ('7b000000-0000-4000-8000-' || pg_catalog.lpad(p_opponent::text, 12, '0'))::uuid,
    p_status,
    case when p_status = 'pending' then v_now + interval '30 seconds'
         else v_now - interval '5 minutes' end,
    v_accepted_at,
    v_countdown_at,
    v_scheduled_start_at,
    null,
    null,
    null,
    v_actor,
    v_reason,
    v_version,
    v_now - interval '10 minutes',
    coalesce(v_countdown_at, v_accepted_at, v_now)
  );
  return v_id;
end;
$$;

create function pg_temp.assert_cancel_rejected(
  p_battle_id uuid,
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
  v_before_events bigint;
  v_after_events bigint;
  v_sqlstate text;
  v_message text;
begin
  select * into strict v_before
  from public.live_battles where id = p_battle_id;
  select pg_catalog.count(*) into v_before_events
  from public.live_battle_events where battle_id = p_battle_id;

  begin
    perform private.live_battle_transition(
      p_battle_id,
      v_before.status,
      'cancelled',
      p_actor_user_id,
      p_reason,
      pg_catalog.clock_timestamp()
    );
    raise exception using message = p_marker;
  exception when others then
    get stacked diagnostics
      v_sqlstate = returned_sqlstate,
      v_message = message_text;
    if v_sqlstate <> '42501'
      or v_message <> 'live_battle_transition_actor_invalid'
    then
      raise exception 'rejected_case_wrong_sqlstate_or_message: %, %, %, %',
        p_marker, v_sqlstate, v_message, p_reason;
    end if;
  end;

  select * into strict v_after
  from public.live_battles where id = p_battle_id;
  select pg_catalog.count(*) into v_after_events
  from public.live_battle_events where battle_id = p_battle_id;
  if v_after.status is distinct from v_before.status
    or v_after.version is distinct from v_before.version
    or v_after.ended_at is distinct from v_before.ended_at
    or v_after_events is distinct from v_before_events
  then
    raise exception 'rejected_case_mutated_state: %', p_marker;
  end if;
end;
$$;

create function pg_temp.assert_cancel_allowed(
  p_battle_id uuid,
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
  v_event_count bigint;
begin
  select * into strict v_before
  from public.live_battles where id = p_battle_id;
  v_after := private.live_battle_transition(
    p_battle_id,
    v_before.status,
    'cancelled',
    p_actor_user_id,
    p_reason,
    v_now
  );
  select pg_catalog.count(*) into v_event_count
  from public.live_battle_events e
  where e.battle_id = p_battle_id
    and e.from_status = v_before.status
    and e.to_status = 'cancelled'
    and e.actor_user_id is not distinct from p_actor_user_id
    and e.reason = p_reason
    and e.version = v_before.version + 1
    and e.created_at = v_now;
  if v_after.status <> 'cancelled'
    or v_after.version <> v_before.version + 1
    or v_after.ended_at is distinct from v_now
    or v_after.last_transition_actor_id is distinct from p_actor_user_id
    or v_after.last_transition_reason <> p_reason
    or v_event_count <> 1
  then
    raise exception '%', p_marker;
  end if;
end;
$$;

-- Negative authority matrix: every rejected call must be 42501/canonical and mutation-free.
select pg_temp.add_battle(1, 1, 2, 'accepted');
select pg_temp.assert_cancel_rejected(
  '7c000000-0000-4000-8000-000000000001', null,
  'challenger_cancelled', 'null_challenger_manual_not_rejected'
);
select pg_temp.add_battle(2, 3, 4, 'accepted');
select pg_temp.assert_cancel_rejected(
  '7c000000-0000-4000-8000-000000000002', null,
  'opponent_cancelled', 'null_opponent_manual_not_rejected'
);
select pg_temp.add_battle(3, 5, 6, 'accepted');
select pg_temp.assert_cancel_rejected(
  '7c000000-0000-4000-8000-000000000003',
  '7a000000-0000-4000-8000-000000000005',
  'opponent_cancelled', 'challenger_opponent_reason_not_rejected'
);
select pg_temp.add_battle(4, 7, 8, 'accepted');
select pg_temp.assert_cancel_rejected(
  '7c000000-0000-4000-8000-000000000004',
  '7a000000-0000-4000-8000-000000000008',
  'challenger_cancelled', 'opponent_challenger_reason_not_rejected'
);
select pg_temp.add_battle(5, 9, 10, 'accepted');
select pg_temp.assert_cancel_rejected(
  '7c000000-0000-4000-8000-000000000005',
  '7a000000-0000-4000-8000-000000000040',
  'challenger_cancelled', 'third_user_manual_not_rejected'
);
select pg_temp.add_battle(6, 11, 12, 'accepted');
select pg_temp.assert_cancel_rejected(
  '7c000000-0000-4000-8000-000000000006',
  '7a000000-0000-4000-8000-000000000011',
  'accepted_start_timeout', 'nonnull_timeout_not_rejected'
);
select pg_temp.add_battle(7, 13, 14, 'accepted');
select pg_temp.assert_cancel_rejected(
  '7c000000-0000-4000-8000-000000000007',
  '7a000000-0000-4000-8000-000000000013',
  'session_not_live_after_accept', 'nonnull_after_accept_not_rejected'
);
select pg_temp.add_battle(8, 15, 16, 'countdown');
select pg_temp.assert_cancel_rejected(
  '7c000000-0000-4000-8000-000000000008',
  '7a000000-0000-4000-8000-000000000015',
  'session_not_live_before_start', 'nonnull_before_start_not_rejected'
);
select pg_temp.add_battle(9, 17, 18, 'accepted');
select pg_temp.assert_cancel_rejected(
  '7c000000-0000-4000-8000-000000000009', null,
  'unknown_reason', 'null_unknown_reason_not_rejected'
);
select pg_temp.assert_cancel_rejected(
  '7c000000-0000-4000-8000-000000000009', null,
  null, 'null_reason_not_rejected'
);
select pg_temp.add_battle(10, 19, 20, 'countdown');
select pg_temp.assert_cancel_rejected(
  '7c000000-0000-4000-8000-000000000010', null,
  'accepted_start_timeout', 'timeout_wrong_state_not_rejected'
);
select pg_temp.add_battle(11, 21, 22, 'countdown');
select pg_temp.assert_cancel_rejected(
  '7c000000-0000-4000-8000-000000000011', null,
  'session_not_live_after_accept', 'after_accept_wrong_state_not_rejected'
);
select pg_temp.add_battle(12, 23, 24, 'accepted');
select pg_temp.assert_cancel_rejected(
  '7c000000-0000-4000-8000-000000000012', null,
  'session_not_live_before_start', 'before_start_wrong_state_not_rejected'
);

-- Positive authority matrix: exact actor/reason/state combinations emit one canonical event.
select pg_temp.add_battle(13, 25, 26, 'accepted');
select pg_temp.assert_cancel_allowed(
  '7c000000-0000-4000-8000-000000000013',
  '7a000000-0000-4000-8000-000000000025',
  'challenger_cancelled', 'challenger_manual_positive_failed'
);
select pg_temp.add_battle(14, 27, 28, 'accepted');
select pg_temp.assert_cancel_allowed(
  '7c000000-0000-4000-8000-000000000014',
  '7a000000-0000-4000-8000-000000000028',
  'opponent_cancelled', 'opponent_manual_positive_failed'
);
select pg_temp.add_battle(15, 29, 30, 'accepted');
select pg_temp.assert_cancel_allowed(
  '7c000000-0000-4000-8000-000000000015', null,
  'accepted_start_timeout', 'accepted_timeout_positive_failed'
);
select pg_temp.add_battle(16, 31, 32, 'accepted');
select pg_temp.assert_cancel_allowed(
  '7c000000-0000-4000-8000-000000000016', null,
  'session_not_live_after_accept', 'accepted_session_positive_failed'
);
select pg_temp.add_battle(17, 33, 34, 'countdown');
select pg_temp.assert_cancel_allowed(
  '7c000000-0000-4000-8000-000000000017', null,
  'session_not_live_before_start', 'countdown_session_positive_failed'
);

-- Exact accepted deadline remains open at 29 seconds and cancels at 30 seconds.
select pg_temp.add_battle(18, 35, 36, 'accepted');
do $$
declare
  v_before public.live_battles%rowtype;
  v_result public.live_battles%rowtype;
begin
  select * into strict v_before from public.live_battles
  where id = '7c000000-0000-4000-8000-000000000018';
  v_result := private.live_battle_reconcile_locked(
    v_before.id, v_before.accepted_at + interval '29 seconds'
  );
  if v_result.status <> 'accepted' or v_result.version <> v_before.version
  then raise exception 'accepted_29_seconds_changed'; end if;
  v_result := private.live_battle_reconcile_locked(
    v_before.id, v_before.accepted_at + interval '30 seconds'
  );
  if v_result.status <> 'cancelled'
    or v_result.version <> v_before.version + 1
    or v_result.last_transition_reason <> 'accepted_start_timeout'
    or v_result.last_transition_actor_id is not null
  then raise exception 'accepted_30_seconds_not_cancelled'; end if;
end;
$$;

-- EXPLAIN the exact accepted-deadline branch used by the reconciler.
set local enable_seqscan = off;
do $$
declare
  v_line record;
  v_plan text := '';
begin
  for v_line in execute $plan$
    explain (costs off)
    select b.id, b.status, b.accepted_at as due_at
    from public.live_battles b
    where b.status = 'accepted'
      and b.accepted_at <= timestamptz '2999-01-01 00:00:00+00' - interval '30 seconds'
  $plan$
  loop
    v_plan := v_plan || coalesce(v_line."QUERY PLAN", '') || E'\n';
  end loop;
  if pg_catalog.strpos(v_plan, 'live_battles_accepted_deadline_idx') = 0
  then raise exception 'accepted_deadline_index_not_used: %', v_plan; end if;
  if pg_catalog.strpos(v_plan, 'Index Cond') = 0
    or pg_catalog.strpos(v_plan, 'accepted_at') = 0
  then raise exception 'accepted_deadline_not_index_cond: %', v_plan; end if;
end;
$$;

-- Existing public busy behavior remains unchanged for current accepted conflicts.
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub', '7a000000-0000-4000-8000-000000000001', true
);
do $$
begin
  begin
    perform public.create_live_battle_invite(
      '7a000000-0000-4000-8000-000000000002',
      '7b000000-0000-4000-8000-000000000001',
      '7b000000-0000-4000-8000-000000000002'
    );
    raise exception 'busy_regression';
  exception when sqlstate '55000' then
    if sqlerrm <> 'live_battle_pair_busy' then raise; end if;
  end;
end;
$$;
reset role;

select pg_temp.add_battle(19, 37, 38, 'pending');
select pg_temp.add_battle(20, 38, 39, 'accepted');
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub', '7a000000-0000-4000-8000-000000000038', true
);
do $$
begin
  begin
    perform public.respond_live_battle_invite(
      '7c000000-0000-4000-8000-000000000019', true
    );
    raise exception 'busy_regression';
  exception when sqlstate '55000' then
    if sqlerrm <> 'live_battle_participant_busy' then raise; end if;
  end;
end;
$$;
reset role;

do $$
declare
  v_proc record;
begin
  for v_proc in
    select
      p.oid,
      p.proname,
      p.prosecdef,
      p.proowner,
      p.proconfig,
      p.proacl
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in (
        'live_battle_transition',
        'live_battle_reconcile_locked',
        'reconcile_due_live_battles'
      )
  loop
    if v_proc.proowner <> 'postgres'::regrole
      or not (v_proc.proconfig @> array['search_path=""'])
      or v_proc.proacl <> array['postgres=X/postgres']::aclitem[]
      or pg_catalog.has_function_privilege('public', v_proc.oid, 'execute')
      or pg_catalog.has_function_privilege('anon', v_proc.oid, 'execute')
      or pg_catalog.has_function_privilege('authenticated', v_proc.oid, 'execute')
      or pg_catalog.has_function_privilege('service_role', v_proc.oid, 'execute')
      or (v_proc.proname = 'reconcile_due_live_battles' and not v_proc.prosecdef)
      or (v_proc.proname <> 'reconcile_due_live_battles' and v_proc.prosecdef)
    then raise exception 'private_function_acl_invalid: %', v_proc.proname; end if;
  end loop;
  if not found then raise exception 'private_function_acl_invalid: missing'; end if;

  if (select pg_catalog.count(*) from pg_catalog.pg_indexes
      where schemaname = 'public'
        and tablename = 'live_battles'
        and indexname = 'live_battles_accepted_deadline_idx') <> 1
  then raise exception 'accepted_deadline_index_not_used: missing or duplicate'; end if;

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
  then raise exception 'battle_cron_not_singular'; end if;
end;
$$;

rollback;

do $$
begin
  if exists (
    select 1 from auth.users where email like 'lb4f3f3f1f1-host-%@proof.local'
  ) or exists (
    select 1 from public.live_battles where id::text like '7c000000-%'
  ) or exists (
    select 1 from public.live_battle_events where battle_id::text like '7c000000-%'
  ) or exists (
    select 1 from public.live_battle_public_states where battle_id::text like '7c000000-%'
  ) then raise exception 'lb4_f3_f3_f1_f1_fixture_cleanup_failed'; end if;
end;
$$;
