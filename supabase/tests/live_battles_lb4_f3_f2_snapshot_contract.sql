begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, created_at, updated_at
) values
('71000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lb4f3f2-host-a@proof.local','proof',now(),now()),
('71000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lb4f3f2-host-b@proof.local','proof',now(),now());

insert into public.user_profiles (id, username, display_name, is_admin) values
('71000000-0000-4000-8000-000000000001','lb4f3f2_host_a','LB4-F3-F2 host A',false),
('71000000-0000-4000-8000-000000000002','lb4f3f2_host_b','LB4-F3-F2 host B',false);

insert into public.live_sessions (
  id, host_id, title, status, viewer_count, started_at, ended_at,
  created_at, last_heartbeat_at, host_disconnected_at, end_reason
) values
('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','LB4-F3-F2 A','live',0,'2026-08-27 01:00:00+00',null,'2026-08-27 01:00:00+00','2026-08-27 01:00:00+00',null,null),
('72000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000002','LB4-F3-F2 B','live',0,'2026-08-27 01:00:00+00',null,'2026-08-27 01:00:00+00','2026-08-27 01:00:00+00',null,null);

insert into public.live_battles (
  id, challenger_user_id, opponent_user_id, challenger_session_id, opponent_session_id,
  status, invite_expires_at, accepted_at, countdown_started_at, scheduled_start_at,
  last_transition_actor_id, last_transition_reason, version, created_at, updated_at
) values (
  '73000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002',
  '72000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000002',
  'countdown','2026-08-27 01:00:30+00','2026-08-27 01:00:01+00',
  '2026-08-27 01:00:02+00','2026-08-27 01:00:05+00',
  '71000000-0000-4000-8000-000000000001','countdown_started',3,
  '2026-08-27 01:00:00+00','2026-08-27 01:00:02+00'
);

set local role authenticated;
do $$
declare
  v_snapshot jsonb;
  v_expected text[] := array[
    'battle_id','ended_at','local_host_agora_uid','local_host_user_id',
    'opponent_host_agora_uid','opponent_host_user_id','opponent_session_id',
    'scheduled_end_at','scheduled_start_at','session_id','started_at','status',
    'updated_at','version'
  ];
begin
  v_snapshot := public.get_live_battle_public_snapshot('72000000-0000-4000-8000-000000000001');
  if (select array_agg(key order by key) from pg_catalog.jsonb_object_keys(v_snapshot) key) <> array['server_now','state']
    or pg_catalog.jsonb_typeof(v_snapshot->'server_now') <> 'string'
    or (v_snapshot->>'server_now')::timestamptz is null
    then raise exception 'snapshot_envelope_invalid'; end if;
  if (select array_agg(key order by key) from pg_catalog.jsonb_object_keys(v_snapshot->'state') key) <> v_expected
    or v_snapshot->'state'->>'session_id' <> '72000000-0000-4000-8000-000000000001'
    then raise exception 'snapshot_public_contract_invalid'; end if;

  begin
    insert into public.live_battle_public_states default values;
    raise exception 'authenticated_insert_allowed';
  exception when insufficient_privilege then null; end;
  begin
    update public.live_battle_public_states set version=99;
    raise exception 'authenticated_update_allowed';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.live_battle_public_states;
    raise exception 'authenticated_delete_allowed';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;

alter table public.live_battle_public_states
add column lb4_f3_f2_secret_probe text;

update public.live_battle_public_states
set lb4_f3_f2_secret_probe='must-not-leak'
where session_id='72000000-0000-4000-8000-000000000001';

set local role authenticated;
do $$
declare v_snapshot jsonb;
begin
  v_snapshot := public.get_live_battle_public_snapshot('72000000-0000-4000-8000-000000000001');
  if v_snapshot->'state' ? 'lb4_f3_f2_secret_probe'
    or v_snapshot::text like '%must-not-leak%'
    then raise exception 'future_column_exposed'; end if;
end;
$$;
reset role;

set local role anon;
do $$
begin
  begin
    perform public.get_live_battle_public_snapshot('72000000-0000-4000-8000-000000000001');
    raise exception 'anon_execute_allowed';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;

update public.live_sessions
set status='ended', ended_at='2026-08-27 01:01:00+00', end_reason='host_ended'
where id='72000000-0000-4000-8000-000000000001';

set local role authenticated;
do $$
begin
  if public.get_live_battle_public_snapshot('72000000-0000-4000-8000-000000000001')->'state' <> 'null'::jsonb
    then raise exception 'ended_session_snapshot_visible'; end if;
end;
$$;
reset role;

do $$
declare
  v_proc pg_catalog.pg_proc%rowtype;
  v_definition text;
begin
  select p.* into strict v_proc
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='get_live_battle_public_snapshot'
    and pg_catalog.pg_get_function_identity_arguments(p.oid)='p_session_id uuid';
  v_definition := pg_catalog.pg_get_functiondef(v_proc.oid);

  if v_proc.prosecdef
    or v_proc.provolatile <> 'v'
    or v_proc.proowner <> 'postgres'::regrole
    or not (v_proc.proconfig @> array['search_path=""'])
    or pg_catalog.pg_get_function_result(v_proc.oid) <> 'jsonb'
    then raise exception 'snapshot_rpc_hardening_invalid'; end if;
  if v_proc.proacl <> array['postgres=X/postgres','authenticated=X/postgres']::aclitem[]
    or has_function_privilege('public',v_proc.oid,'execute')
    or has_function_privilege('anon',v_proc.oid,'execute')
    or has_function_privilege('service_role',v_proc.oid,'execute')
    or not has_function_privilege('authenticated',v_proc.oid,'execute')
    then raise exception 'snapshot_rpc_acl_invalid'; end if;
  if v_definition ~* 'to_jsonb[[:space:]]*\([[:space:]]*public_state[[:space:]]*\)'
    or v_definition ~* 'row_to_json'
    or v_definition ~* 'select[[:space:]]+\*'
    or v_definition ~* 'live_battle_events|from public\.live_battles'
    or v_definition ~* '\m(insert|update|delete|merge|truncate)\M'
    then raise exception 'snapshot_rpc_contract_not_frozen'; end if;
  if not (select relrowsecurity from pg_catalog.pg_class where oid='public.live_battle_public_states'::regclass)
    or has_table_privilege('authenticated','public.live_battle_public_states','insert,update,delete')
    or has_table_privilege('anon','public.live_battle_public_states','select')
    then raise exception 'projection_security_regressed'; end if;
end;
$$;

rollback;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='live_battle_public_states'
      and column_name='lb4_f3_f2_secret_probe'
  ) then raise exception 'secret_probe_column_survived_rollback'; end if;
  if exists(select 1 from auth.users where email like 'lb4f3f2-%@proof.local')
    or exists(select 1 from public.live_battles where id::text like '73000000-%')
    or exists(select 1 from public.live_battle_public_states where battle_id::text like '73000000-%')
    then raise exception 'lb4_f3_f2_fixture_cleanup_failed'; end if;
end;
$$;
