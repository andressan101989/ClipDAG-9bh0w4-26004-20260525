begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
)
select
  ('74000000-0000-4000-8000-' || pg_catalog.lpad(n::text, 12, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated',
  'authenticated',
  'lb4f3f3-host-' || n || '@proof.local',
  'proof',
  pg_catalog.clock_timestamp(),
  pg_catalog.clock_timestamp()
from pg_catalog.generate_series(1, 16) n;

insert into public.user_profiles (id, username, display_name, is_admin)
select
  ('74000000-0000-4000-8000-' || pg_catalog.lpad(n::text, 12, '0'))::uuid,
  'lb4f3f3_host_' || n,
  'LB4-F3-F3 host ' || n,
  false
from pg_catalog.generate_series(1, 16) n;

insert into public.live_sessions (
  id, host_id, title, status, viewer_count, started_at, ended_at,
  created_at, last_heartbeat_at, host_disconnected_at, end_reason
)
select
  ('75000000-0000-4000-8000-' || pg_catalog.lpad(n::text, 12, '0'))::uuid,
  ('74000000-0000-4000-8000-' || pg_catalog.lpad(n::text, 12, '0'))::uuid,
  'LB4-F3-F3 session ' || n,
  'live',
  0,
  pg_catalog.clock_timestamp() - interval '20 minutes',
  null,
  pg_catalog.clock_timestamp() - interval '20 minutes',
  pg_catalog.clock_timestamp(),
  null,
  null
from pg_catalog.generate_series(1, 16) n;

-- Active and already due: the canonical transition must produce v5 exactly once.
with t as (select pg_catalog.clock_timestamp() as now_at)
insert into public.live_battles (
  id, challenger_user_id, opponent_user_id,
  challenger_session_id, opponent_session_id,
  status, invite_expires_at, accepted_at, countdown_started_at,
  scheduled_start_at, started_at, scheduled_end_at, ended_at,
  last_transition_actor_id, last_transition_reason, version, created_at, updated_at
)
select
  '76000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000002',
  '75000000-0000-4000-8000-000000000001',
  '75000000-0000-4000-8000-000000000002',
  'active', t.now_at - interval '340 seconds', t.now_at - interval '365 seconds',
  t.now_at - interval '364 seconds', t.now_at - interval '361 seconds',
  t.now_at - interval '361 seconds', t.now_at - interval '61 seconds', null,
  null, 'countdown_elapsed', 4, t.now_at - interval '370 seconds',
  t.now_at - interval '361 seconds'
from t;

do $$
declare
  v_count integer;
  v_battle public.live_battles%rowtype;
  v_events integer;
begin
  v_count := private.reconcile_due_live_battles(100);
  if v_count <> 1 then raise exception 'active_due_completed'; end if;

  select * into strict v_battle from public.live_battles
  where id = '76000000-0000-4000-8000-000000000001';
  if v_battle.status <> 'completed' then raise exception 'active_due_completed'; end if;
  if v_battle.ended_at is distinct from v_battle.scheduled_end_at then
    raise exception 'active_due_ended_at_not_scheduled_end';
  end if;
  if v_battle.version <> 5 then
    raise exception 'active_due_version_not_incremented_once';
  end if;
  select pg_catalog.count(*) into v_events
  from public.live_battle_events
  where battle_id = v_battle.id
    and from_status = 'active'
    and to_status = 'completed'
    and reason = 'battle_duration_elapsed'
    and version = 5;
  if v_events <> 1 then raise exception 'active_due_event_not_exactly_once'; end if;

  v_count := private.reconcile_due_live_battles(100);
  select pg_catalog.count(*) into v_events
  from public.live_battle_events
  where battle_id = v_battle.id and reason = 'battle_duration_elapsed';
  if v_count <> 0 or v_events <> 1 then
    raise exception 'active_due_repeat_not_idempotent';
  end if;

  if (select pg_catalog.count(*) from public.live_battle_public_states
      where battle_id = v_battle.id and status = 'completed') <> 2 then
    raise exception 'projection_not_completed';
  end if;
end;
$$;

-- A future active Battle is not due and must remain unchanged.
with t as (select pg_catalog.clock_timestamp() as now_at)
insert into public.live_battles (
  id, challenger_user_id, opponent_user_id,
  challenger_session_id, opponent_session_id,
  status, invite_expires_at, accepted_at, countdown_started_at,
  scheduled_start_at, started_at, scheduled_end_at, ended_at,
  last_transition_actor_id, last_transition_reason, version, created_at, updated_at
)
select
  '76000000-0000-4000-8000-000000000002',
  '74000000-0000-4000-8000-000000000003',
  '74000000-0000-4000-8000-000000000004',
  '75000000-0000-4000-8000-000000000003',
  '75000000-0000-4000-8000-000000000004',
  'active', t.now_at - interval '180 seconds', t.now_at - interval '205 seconds',
  t.now_at - interval '204 seconds', t.now_at - interval '201 seconds',
  t.now_at - interval '201 seconds', t.now_at + interval '99 seconds', null,
  null, 'countdown_elapsed', 4, t.now_at - interval '210 seconds',
  t.now_at - interval '201 seconds'
from t;

do $$
begin
  if private.reconcile_due_live_battles(100) <> 0
    or (select status from public.live_battles
        where id = '76000000-0000-4000-8000-000000000002') <> 'active'
    then raise exception 'active_future_changed'; end if;
end;
$$;

-- The same pair may invite again after its due active Battle is reconciled.
with t as (select pg_catalog.clock_timestamp() as now_at)
insert into public.live_battles (
  id, challenger_user_id, opponent_user_id,
  challenger_session_id, opponent_session_id,
  status, invite_expires_at, accepted_at, countdown_started_at,
  scheduled_start_at, started_at, scheduled_end_at, ended_at,
  last_transition_actor_id, last_transition_reason, version, created_at, updated_at
)
select
  '76000000-0000-4000-8000-000000000003',
  '74000000-0000-4000-8000-000000000005',
  '74000000-0000-4000-8000-000000000006',
  '75000000-0000-4000-8000-000000000005',
  '75000000-0000-4000-8000-000000000006',
  'active', t.now_at - interval '340 seconds', t.now_at - interval '365 seconds',
  t.now_at - interval '364 seconds', t.now_at - interval '361 seconds',
  t.now_at - interval '361 seconds', t.now_at - interval '61 seconds', null,
  null, 'countdown_elapsed', 4, t.now_at - interval '370 seconds',
  t.now_at - interval '361 seconds'
from t;

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub', '74000000-0000-4000-8000-000000000005', true
);
do $$
declare v_new jsonb;
begin
  v_new := public.create_live_battle_invite(
    '74000000-0000-4000-8000-000000000006',
    '75000000-0000-4000-8000-000000000005',
    '75000000-0000-4000-8000-000000000006'
  );
  if v_new->>'status' <> 'pending'
    or v_new->>'id' = '76000000-0000-4000-8000-000000000003'
    or (select status from public.live_battles
        where id = '76000000-0000-4000-8000-000000000003') <> 'completed'
    then raise exception 'same_pair_due_not_replaced'; end if;
end;
$$;
reset role;

-- A genuinely current active Battle for the pair continues to block.
set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub', '74000000-0000-4000-8000-000000000003', true
);
do $$
begin
  begin
    perform public.create_live_battle_invite(
      '74000000-0000-4000-8000-000000000004',
      '75000000-0000-4000-8000-000000000003',
      '75000000-0000-4000-8000-000000000004'
    );
    raise exception 'same_pair_live_missing_pair_busy';
  exception when sqlstate '55000' then
    if sqlerrm <> 'live_battle_pair_busy' then raise; end if;
  end;
end;
$$;
reset role;

-- A due conflict involving one participant is reconciled before acceptance.
with t as (select pg_catalog.clock_timestamp() as now_at)
insert into public.live_battles (
  id, challenger_user_id, opponent_user_id,
  challenger_session_id, opponent_session_id,
  status, invite_expires_at, accepted_at, countdown_started_at,
  scheduled_start_at, started_at, scheduled_end_at, ended_at,
  last_transition_actor_id, last_transition_reason, version, created_at, updated_at
)
select
  '76000000-0000-4000-8000-000000000004',
  '74000000-0000-4000-8000-000000000007',
  '74000000-0000-4000-8000-000000000008',
  '75000000-0000-4000-8000-000000000007',
  '75000000-0000-4000-8000-000000000008',
  'pending', t.now_at + interval '29 seconds', null, null, null, null, null, null,
  '74000000-0000-4000-8000-000000000007', 'invite_created', 1,
  t.now_at - interval '1 second', t.now_at - interval '1 second'
from t;

with t as (select pg_catalog.clock_timestamp() as now_at)
insert into public.live_battles (
  id, challenger_user_id, opponent_user_id,
  challenger_session_id, opponent_session_id,
  status, invite_expires_at, accepted_at, countdown_started_at,
  scheduled_start_at, started_at, scheduled_end_at, ended_at,
  last_transition_actor_id, last_transition_reason, version, created_at, updated_at
)
select
  '76000000-0000-4000-8000-000000000005',
  '74000000-0000-4000-8000-000000000008',
  '74000000-0000-4000-8000-000000000009',
  '75000000-0000-4000-8000-000000000008',
  '75000000-0000-4000-8000-000000000009',
  'active', t.now_at - interval '340 seconds', t.now_at - interval '365 seconds',
  t.now_at - interval '364 seconds', t.now_at - interval '361 seconds',
  t.now_at - interval '361 seconds', t.now_at - interval '61 seconds', null,
  null, 'countdown_elapsed', 4, t.now_at - interval '370 seconds',
  t.now_at - interval '361 seconds'
from t;

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub', '74000000-0000-4000-8000-000000000008', true
);
do $$
declare v_result jsonb;
begin
  v_result := public.respond_live_battle_invite(
    '76000000-0000-4000-8000-000000000004', true
  );
  if v_result->>'status' <> 'accepted'
    or (select status from public.live_battles
        where id = '76000000-0000-4000-8000-000000000005') <> 'completed'
    then raise exception 'participant_due_not_reconciled'; end if;
end;
$$;
reset role;

-- A genuinely active participant conflict remains a hard block.
with t as (select pg_catalog.clock_timestamp() as now_at)
insert into public.live_battles (
  id, challenger_user_id, opponent_user_id,
  challenger_session_id, opponent_session_id,
  status, invite_expires_at, accepted_at, countdown_started_at,
  scheduled_start_at, started_at, scheduled_end_at, ended_at,
  last_transition_actor_id, last_transition_reason, version, created_at, updated_at
)
select
  '76000000-0000-4000-8000-000000000006',
  '74000000-0000-4000-8000-000000000010',
  '74000000-0000-4000-8000-000000000011',
  '75000000-0000-4000-8000-000000000010',
  '75000000-0000-4000-8000-000000000011',
  'pending', t.now_at + interval '29 seconds', null, null, null, null, null, null,
  '74000000-0000-4000-8000-000000000010', 'invite_created', 1,
  t.now_at - interval '1 second', t.now_at - interval '1 second'
from t;

with t as (select pg_catalog.clock_timestamp() as now_at)
insert into public.live_battles (
  id, challenger_user_id, opponent_user_id,
  challenger_session_id, opponent_session_id,
  status, invite_expires_at, accepted_at, countdown_started_at,
  scheduled_start_at, started_at, scheduled_end_at, ended_at,
  last_transition_actor_id, last_transition_reason, version, created_at, updated_at
)
select
  '76000000-0000-4000-8000-000000000007',
  '74000000-0000-4000-8000-000000000011',
  '74000000-0000-4000-8000-000000000012',
  '75000000-0000-4000-8000-000000000011',
  '75000000-0000-4000-8000-000000000012',
  'active', t.now_at - interval '180 seconds', t.now_at - interval '205 seconds',
  t.now_at - interval '204 seconds', t.now_at - interval '201 seconds',
  t.now_at - interval '201 seconds', t.now_at + interval '99 seconds', null,
  null, 'countdown_elapsed', 4, t.now_at - interval '210 seconds',
  t.now_at - interval '201 seconds'
from t;

set local role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub', '74000000-0000-4000-8000-000000000011', true
);
do $$
begin
  begin
    perform public.respond_live_battle_invite(
      '76000000-0000-4000-8000-000000000006', true
    );
    raise exception 'participant_live_missing_busy';
  exception when sqlstate '55000' then
    if sqlerrm <> 'live_battle_participant_busy' then raise; end if;
  end;
end;
$$;
reset role;

-- Two due pending rows prove that the requested batch size is enforced.
with t as (select pg_catalog.clock_timestamp() as now_at)
insert into public.live_battles (
  id, challenger_user_id, opponent_user_id,
  challenger_session_id, opponent_session_id,
  status, invite_expires_at, last_transition_actor_id,
  last_transition_reason, version, created_at, updated_at
)
select
  '76000000-0000-4000-8000-000000000008'::uuid,
  '74000000-0000-4000-8000-000000000013'::uuid,
  '74000000-0000-4000-8000-000000000014'::uuid,
  '75000000-0000-4000-8000-000000000013'::uuid,
  '75000000-0000-4000-8000-000000000014'::uuid,
  'pending', t.now_at - interval '2 seconds',
  '74000000-0000-4000-8000-000000000013'::uuid, 'invite_created', 1,
  t.now_at - interval '32 seconds', t.now_at - interval '32 seconds'
from t
union all
select
  '76000000-0000-4000-8000-000000000009'::uuid,
  '74000000-0000-4000-8000-000000000015'::uuid,
  '74000000-0000-4000-8000-000000000016'::uuid,
  '75000000-0000-4000-8000-000000000015'::uuid,
  '75000000-0000-4000-8000-000000000016'::uuid,
  'pending', t.now_at - interval '1 second',
  '74000000-0000-4000-8000-000000000015'::uuid, 'invite_created', 1,
  t.now_at - interval '31 seconds', t.now_at - interval '31 seconds'
from t;

do $$
declare
  v_reconciled integer;
  v_expired integer;
begin
  v_reconciled := private.reconcile_due_live_battles(1);
  select pg_catalog.count(*) into v_expired from public.live_battles
        where id in (
          '76000000-0000-4000-8000-000000000008',
          '76000000-0000-4000-8000-000000000009'
        ) and status = 'expired';
  if v_reconciled <> 1 or v_expired <> 1 then
    raise exception 'batch_limit_not_respected: reconciled %, expired %',
      v_reconciled, v_expired;
  end if;
  perform private.reconcile_due_live_battles(100);

  begin
    perform private.reconcile_due_live_battles(0);
    raise exception 'zero_batch_limit_allowed';
  exception when sqlstate '22023' then null; end;
  begin
    perform private.reconcile_due_live_battles(501);
    raise exception 'oversized_batch_limit_allowed';
  exception when sqlstate '22023' then null; end;
end;
$$;

do $$
declare
  v_proc pg_catalog.pg_proc%rowtype;
  v_job_id bigint;
begin
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
        and active
        and username = 'postgres'
    ) then raise exception 'battle_cron_not_singular'; end if;

  select cron.schedule(
    'reconcile-due-live-battles',
    '* * * * *',
    'select private.reconcile_due_live_battles(100);'
  ) into v_job_id;
  if (select pg_catalog.count(*) from cron.job
      where jobname = 'reconcile-due-live-battles') <> 1
  then raise exception 'battle_cron_idempotence_failed'; end if;

  if not (select relrowsecurity from pg_catalog.pg_class
          where oid = 'public.live_battle_public_states'::regclass)
    or pg_catalog.has_table_privilege(
      'authenticated', 'public.live_battle_public_states', 'insert,update,delete'
    )
    or pg_catalog.has_table_privilege(
      'anon', 'public.live_battle_public_states', 'select'
    )
    or not exists (
      select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'live_battle_public_states'
    )
    or exists (
      select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'live_battle_events'
    )
  then raise exception 'battle_security_or_realtime_regressed'; end if;
end;
$$;

rollback;

do $$
begin
  if exists (
    select 1 from auth.users where email like 'lb4f3f3-host-%@proof.local'
  ) or exists (
    select 1 from public.live_battles where id::text like '76000000-%'
  ) or exists (
    select 1 from public.live_battle_events where battle_id::text like '76000000-%'
  ) or exists (
    select 1 from public.live_battle_public_states where battle_id::text like '76000000-%'
  ) then raise exception 'lb4_f3_f3_fixture_cleanup_failed'; end if;
end;
$$;
