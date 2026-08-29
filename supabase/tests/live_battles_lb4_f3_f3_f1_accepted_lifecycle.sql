begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
)
select
  ('77000000-0000-4000-8000-' || pg_catalog.lpad(n::text, 12, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated',
  'authenticated',
  'lb4f3f3f1-host-' || n || '@proof.local',
  'proof',
  pg_catalog.clock_timestamp(),
  pg_catalog.clock_timestamp()
from pg_catalog.generate_series(1, 140) n;

insert into public.user_profiles (id, username, display_name, is_admin)
select
  ('77000000-0000-4000-8000-' || pg_catalog.lpad(n::text, 12, '0'))::uuid,
  'lb4f3f3f1_host_' || n,
  'LB4-F3-F3-F1 host ' || n,
  false
from pg_catalog.generate_series(1, 140) n;

insert into public.live_sessions (
  id, host_id, title, status, viewer_count, started_at, ended_at,
  created_at, last_heartbeat_at, host_disconnected_at, end_reason
)
select
  ('78000000-0000-4000-8000-' || pg_catalog.lpad(n::text, 12, '0'))::uuid,
  ('77000000-0000-4000-8000-' || pg_catalog.lpad(n::text, 12, '0'))::uuid,
  'LB4-F3-F3-F1 session ' || n,
  'live', 0,
  pg_catalog.clock_timestamp() - interval '20 minutes', null,
  pg_catalog.clock_timestamp() - interval '20 minutes',
  pg_catalog.clock_timestamp(), null, null
from pg_catalog.generate_series(1, 140) n;

create function pg_temp.add_battle(
  p_id integer,
  p_challenger integer,
  p_opponent integer,
  p_challenger_session integer,
  p_opponent_session integer,
  p_status text,
  p_accepted_age interval default interval '0 seconds',
  p_active_remaining interval default interval '60 seconds'
)
returns uuid
language plpgsql
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_id uuid := ('79000000-0000-4000-8000-' || pg_catalog.lpad(p_id::text, 12, '0'))::uuid;
  v_accepted_at timestamptz;
  v_countdown_at timestamptz;
  v_start_at timestamptz;
  v_end_at timestamptz;
  v_actor uuid;
  v_reason text;
  v_version bigint;
begin
  if p_status = 'pending' then
    v_actor := ('77000000-0000-4000-8000-' || pg_catalog.lpad(p_challenger::text, 12, '0'))::uuid;
    v_reason := 'invite_created';
    v_version := 1;
  elsif p_status = 'accepted' then
    v_accepted_at := v_now - p_accepted_age;
    v_actor := ('77000000-0000-4000-8000-' || pg_catalog.lpad(p_opponent::text, 12, '0'))::uuid;
    v_reason := 'invite_accepted';
    v_version := 2;
  elsif p_status = 'countdown' then
    v_accepted_at := v_now - interval '20 seconds';
    v_countdown_at := v_now;
    v_start_at := v_countdown_at + interval '3 seconds';
    v_actor := ('77000000-0000-4000-8000-' || pg_catalog.lpad(p_challenger::text, 12, '0'))::uuid;
    v_reason := 'countdown_started';
    v_version := 3;
  elsif p_status = 'active' then
    v_countdown_at := v_now + p_active_remaining - interval '303 seconds';
    v_accepted_at := v_countdown_at - interval '1 second';
    v_start_at := v_countdown_at + interval '3 seconds';
    v_end_at := v_start_at + interval '300 seconds';
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
    ('77000000-0000-4000-8000-' || pg_catalog.lpad(p_challenger::text, 12, '0'))::uuid,
    ('77000000-0000-4000-8000-' || pg_catalog.lpad(p_opponent::text, 12, '0'))::uuid,
    ('78000000-0000-4000-8000-' || pg_catalog.lpad(p_challenger_session::text, 12, '0'))::uuid,
    ('78000000-0000-4000-8000-' || pg_catalog.lpad(p_opponent_session::text, 12, '0'))::uuid,
    p_status,
    case when p_status = 'pending' then v_now + interval '30 seconds'
         else v_now - interval '500 seconds' end,
    v_accepted_at,
    v_countdown_at,
    v_start_at,
    case when p_status = 'active' then v_start_at else null end,
    v_end_at,
    null,
    v_actor,
    v_reason,
    v_version,
    v_now - interval '600 seconds',
    coalesce(v_countdown_at, v_accepted_at, v_now - interval '1 second')
  );
  return v_id;
end;
$$;

-- At 29 seconds an accepted Battle remains accepted; at exactly 30 it cancels once.
select pg_temp.add_battle(1, 1, 2, 1, 2, 'accepted', interval '0 seconds');
do $$
declare
  v_battle public.live_battles%rowtype;
  v_result public.live_battles%rowtype;
begin
  select * into strict v_battle from public.live_battles
  where id = '79000000-0000-4000-8000-000000000001';
  v_result := private.live_battle_reconcile_locked(
    v_battle.id, v_battle.accepted_at + interval '29 seconds'
  );
  if v_result.status <> 'accepted' then raise exception 'accepted_29_seconds_changed'; end if;
  if v_result.status <> 'accepted' then raise exception 'accepted_live_pair_changed'; end if;
end;
$$;

select pg_temp.add_battle(2, 3, 4, 3, 4, 'accepted', interval '0 seconds');
do $$
declare
  v_battle public.live_battles%rowtype;
  v_result public.live_battles%rowtype;
  v_event_count integer;
begin
  select * into strict v_battle from public.live_battles
  where id = '79000000-0000-4000-8000-000000000002';
  v_result := private.live_battle_reconcile_locked(
    v_battle.id, v_battle.accepted_at + interval '30 seconds'
  );
  if v_result.status <> 'cancelled' then raise exception 'accepted_30_seconds_not_cancelled'; end if;
  if v_result.last_transition_reason <> 'accepted_start_timeout'
    or v_result.last_transition_actor_id is not null
    or v_result.version <> 3
    or v_result.ended_at is distinct from v_battle.accepted_at + interval '30 seconds'
  then raise exception 'accepted_timeout_reason_actor_or_version_invalid'; end if;
  select pg_catalog.count(*) into v_event_count
  from public.live_battle_events
  where battle_id = v_result.id
    and from_status = 'accepted'
    and to_status = 'cancelled'
    and actor_user_id is null
    and reason = 'accepted_start_timeout'
    and version = 3;
  if v_event_count <> 1 then raise exception 'accepted_timeout_event_invalid'; end if;
  v_result := private.live_battle_reconcile_locked(
    v_battle.id, v_battle.accepted_at + interval '60 seconds'
  );
  select pg_catalog.count(*) into v_event_count
  from public.live_battle_events where battle_id = v_result.id;
  if v_result.version <> 3 or v_event_count <> 1 then
    raise exception 'accepted_timeout_repeat_not_idempotent';
  end if;
end;
$$;

-- Session loss wins over timeout and emits the distinct canonical reason.
select pg_temp.add_battle(3, 5, 6, 5, 6, 'accepted', interval '0 seconds');
update public.live_sessions
set status = 'ended', ended_at = pg_catalog.clock_timestamp(), end_reason = 'proof'
where id = '78000000-0000-4000-8000-000000000006';
do $$
declare
  v_battle public.live_battles%rowtype;
  v_result public.live_battles%rowtype;
begin
  select * into strict v_battle from public.live_battles
  where id = '79000000-0000-4000-8000-000000000003';
  v_result := private.live_battle_reconcile_locked(
    v_battle.id, v_battle.accepted_at + interval '10 seconds'
  );
  if v_result.status <> 'cancelled'
    or v_result.last_transition_reason <> 'session_not_live_after_accept'
    or v_result.last_transition_actor_id is not null
    or v_result.version <> 3
  then raise exception 'accepted_ended_session_not_cancelled'; end if;
end;
$$;

-- The bounded cron reconciler selects both accepted deadline and liveness cases.
select pg_temp.add_battle(17, 28, 29, 28, 29, 'accepted', interval '31 seconds');
do $$
declare
  v_count integer;
  v_reason text;
begin
  v_count := private.reconcile_due_live_battles(100);
  select last_transition_reason into v_reason from public.live_battles
  where id = '79000000-0000-4000-8000-000000000017';
  if v_count <> 1 or v_reason <> 'accepted_start_timeout'
  then raise exception 'accepted_due_cron_not_reconciled: count %, reason %', v_count, v_reason; end if;
end;
$$;

select pg_temp.add_battle(18, 133, 134, 133, 134, 'accepted', interval '1 second');
update public.live_sessions
set status = 'ended', ended_at = pg_catalog.clock_timestamp(), end_reason = 'proof'
where id = '78000000-0000-4000-8000-000000000134';
do $$
declare
  v_count integer;
  v_reason text;
begin
  v_count := private.reconcile_due_live_battles(100);
  select last_transition_reason into v_reason from public.live_battles
  where id = '79000000-0000-4000-8000-000000000018';
  if v_count <> 1 or v_reason <> 'session_not_live_after_accept'
  then raise exception 'accepted_ended_cron_not_reconciled: count %, reason %', v_count, v_reason; end if;
end;
$$;

-- Same-pair decisions preserve a current accepted block and replace stale accepted rows.
select pg_temp.add_battle(4, 7, 8, 7, 8, 'accepted', interval '0 seconds');
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '77000000-0000-4000-8000-000000000007', true);
do $$
begin
  begin
    perform public.create_live_battle_invite(
      '77000000-0000-4000-8000-000000000008',
      '78000000-0000-4000-8000-000000000007',
      '78000000-0000-4000-8000-000000000008'
    );
    raise exception 'accepted_current_missing_pair_busy';
  exception when sqlstate '55000' then
    if sqlerrm <> 'live_battle_pair_busy' then raise; end if;
  end;
end;
$$;
reset role;

select pg_temp.add_battle(5, 9, 10, 9, 10, 'accepted', interval '31 seconds');
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '77000000-0000-4000-8000-000000000009', true);
do $$
declare v_new jsonb;
begin
  v_new := public.create_live_battle_invite(
    '77000000-0000-4000-8000-000000000010',
    '78000000-0000-4000-8000-000000000009',
    '78000000-0000-4000-8000-000000000010'
  );
  if v_new->>'status' <> 'pending'
    or v_new->>'id' = '79000000-0000-4000-8000-000000000005'
    or (select status from public.live_battles
        where id = '79000000-0000-4000-8000-000000000005') <> 'cancelled'
  then raise exception 'accepted_due_pair_not_replaced'; end if;
end;
$$;
reset role;

select pg_temp.add_battle(6, 11, 12, 11, 12, 'accepted', interval '5 seconds');
update public.live_sessions
set status = 'ended', ended_at = pg_catalog.clock_timestamp(), end_reason = 'proof'
where id = '78000000-0000-4000-8000-000000000012';
insert into public.live_sessions (
  id, host_id, title, status, viewer_count, started_at, ended_at,
  created_at, last_heartbeat_at, host_disconnected_at, end_reason
) values (
  '78000000-0000-4000-8000-000000000212',
  '77000000-0000-4000-8000-000000000012',
  'replacement session 12', 'live', 0,
  pg_catalog.clock_timestamp(), null, pg_catalog.clock_timestamp(),
  pg_catalog.clock_timestamp(), null, null
);
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '77000000-0000-4000-8000-000000000011', true);
do $$
declare v_new jsonb;
begin
  v_new := public.create_live_battle_invite(
    '77000000-0000-4000-8000-000000000012',
    '78000000-0000-4000-8000-000000000011',
    '78000000-0000-4000-8000-000000000212'
  );
  if v_new->>'status' <> 'pending'
    or (select last_transition_reason from public.live_battles
        where id = '79000000-0000-4000-8000-000000000006') <> 'session_not_live_after_accept'
  then raise exception 'accepted_ended_pair_not_replaced'; end if;
end;
$$;
reset role;

-- A current accepted participant blocks; due and ended accepted conflicts reconcile first.
select pg_temp.add_battle(7, 13, 14, 13, 14, 'pending');
select pg_temp.add_battle(8, 14, 15, 14, 15, 'accepted', interval '0 seconds');
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '77000000-0000-4000-8000-000000000014', true);
do $$
begin
  begin
    perform public.respond_live_battle_invite(
      '79000000-0000-4000-8000-000000000007', true
    );
    raise exception 'accepted_current_missing_participant_busy';
  exception when sqlstate '55000' then
    if sqlerrm <> 'live_battle_participant_busy' then raise; end if;
  end;
end;
$$;
reset role;

select pg_temp.add_battle(9, 16, 17, 16, 17, 'pending');
select pg_temp.add_battle(10, 17, 18, 17, 18, 'accepted', interval '31 seconds');
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '77000000-0000-4000-8000-000000000017', true);
do $$
declare v_result jsonb;
begin
  v_result := public.respond_live_battle_invite(
    '79000000-0000-4000-8000-000000000009', true
  );
  if v_result->>'status' <> 'accepted'
    or (select status from public.live_battles
        where id = '79000000-0000-4000-8000-000000000010') <> 'cancelled'
  then raise exception 'accepted_due_participant_not_reconciled'; end if;
end;
$$;
reset role;

select pg_temp.add_battle(11, 19, 20, 19, 20, 'accepted', interval '5 seconds');
update public.live_sessions
set status = 'ended', ended_at = pg_catalog.clock_timestamp(), end_reason = 'proof'
where id = '78000000-0000-4000-8000-000000000020';
insert into public.live_sessions (
  id, host_id, title, status, viewer_count, started_at, ended_at,
  created_at, last_heartbeat_at, host_disconnected_at, end_reason
) values (
  '78000000-0000-4000-8000-000000000220',
  '77000000-0000-4000-8000-000000000020',
  'replacement session 20', 'live', 0,
  pg_catalog.clock_timestamp(), null, pg_catalog.clock_timestamp(),
  pg_catalog.clock_timestamp(), null, null
);
select pg_temp.add_battle(12, 21, 20, 21, 220, 'pending');
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '77000000-0000-4000-8000-000000000020', true);
do $$
declare v_result jsonb;
begin
  v_result := public.respond_live_battle_invite(
    '79000000-0000-4000-8000-000000000012', true
  );
  if v_result->>'status' <> 'accepted'
    or (select last_transition_reason from public.live_battles
        where id = '79000000-0000-4000-8000-000000000011') <> 'session_not_live_after_accept'
  then raise exception 'accepted_ended_participant_not_reconciled'; end if;
end;
$$;
reset role;

-- Future countdown and active conflicts retain participant_busy.
select pg_temp.add_battle(13, 22, 23, 22, 23, 'pending');
select pg_temp.add_battle(14, 23, 24, 23, 24, 'countdown');
select pg_temp.add_battle(15, 25, 26, 25, 26, 'pending');
select pg_temp.add_battle(16, 26, 27, 26, 27, 'active');
do $$
declare
  v_case record;
begin
  for v_case in
    select * from (values
      ('79000000-0000-4000-8000-000000000013'::uuid,
       '77000000-0000-4000-8000-000000000023'::uuid),
      ('79000000-0000-4000-8000-000000000015'::uuid,
       '77000000-0000-4000-8000-000000000026'::uuid)
    ) v(battle_id, actor_id)
  loop
    perform pg_catalog.set_config('request.jwt.claim.sub', v_case.actor_id::text, true);
    begin
      perform public.respond_live_battle_invite(v_case.battle_id, true);
      raise exception 'countdown_or_active_missing_participant_busy';
    exception when sqlstate '55000' then
      if sqlerrm <> 'live_battle_participant_busy' then raise; end if;
    end;
  end loop;
end;
$$;

-- 101 current pending rows involving the participant do not enter the lock loop.
select pg_temp.add_battle(200, 30, 132, 30, 132, 'pending');
select pg_temp.add_battle(200 + n, 30, 30 + n, 30, 30 + n, 'pending')
from pg_catalog.generate_series(1, 101) n;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '77000000-0000-4000-8000-000000000132', true);
do $$
declare v_result jsonb;
begin
  v_result := public.respond_live_battle_invite(
    '79000000-0000-4000-8000-000000000200', true
  );
  if v_result->>'status' <> 'accepted'
  then raise exception 'pending_rows_blocked_acceptance'; end if;
end;
$$;
reset role;
do $$
begin
  if (select pg_catalog.count(*) from public.live_battles
      where challenger_user_id = '77000000-0000-4000-8000-000000000030'
        and status = 'pending') <> 101
  then raise exception 'pending_rows_blocked_acceptance'; end if;
end;
$$;

do $$
declare
  v_proc pg_catalog.pg_proc%rowtype;
begin
  if not exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and tablename = 'live_battles'
      and indexname = 'live_battles_accepted_deadline_idx'
      and indexdef like '%(accepted_at)%WHERE (status = ''accepted''::text)%'
  ) then raise exception 'accepted_index_missing_or_invalid'; end if;

  select p.* into strict v_proc
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname = 'reconcile_due_live_battles'
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_limit integer';
  if not v_proc.prosecdef
    or v_proc.proowner <> 'postgres'::regrole
    or not (v_proc.proconfig @> array['search_path=""'])
    or v_proc.proacl <> array['postgres=X/postgres']::aclitem[]
    or pg_catalog.has_function_privilege('public', v_proc.oid, 'execute')
    or pg_catalog.has_function_privilege('anon', v_proc.oid, 'execute')
    or pg_catalog.has_function_privilege('authenticated', v_proc.oid, 'execute')
    or pg_catalog.has_function_privilege('service_role', v_proc.oid, 'execute')
  then raise exception 'private_reconciler_acl_invalid'; end if;

  if (select pg_catalog.count(*) from cron.job
      where jobname = 'reconcile-due-live-battles') <> 1
    or not exists (
      select 1 from cron.job
      where jobname = 'reconcile-due-live-battles'
        and schedule = '* * * * *'
        and command = 'select private.reconcile_due_live_battles(100);'
        and active and username = 'postgres'
    ) then raise exception 'battle_cron_not_singular'; end if;

  if exists (
    select 1 from public.live_battle_public_states p
    join public.live_battles b on b.id = p.battle_id
    where b.id in (
      '79000000-0000-4000-8000-000000000002',
      '79000000-0000-4000-8000-000000000003',
      '79000000-0000-4000-8000-000000000005',
      '79000000-0000-4000-8000-000000000006',
      '79000000-0000-4000-8000-000000000010',
      '79000000-0000-4000-8000-000000000011'
    )
  ) then raise exception 'accepted_projection_regressed'; end if;
end;
$$;

rollback;

do $$
begin
  if exists (
    select 1 from auth.users where email like 'lb4f3f3f1-host-%@proof.local'
  ) or exists (
    select 1 from public.live_battles where id::text like '79000000-%'
  ) or exists (
    select 1 from public.live_battle_events where battle_id::text like '79000000-%'
  ) or exists (
    select 1 from public.live_battle_public_states where battle_id::text like '79000000-%'
  ) then raise exception 'lb4_f3_f3_f1_fixture_cleanup_failed'; end if;
end;
$$;
