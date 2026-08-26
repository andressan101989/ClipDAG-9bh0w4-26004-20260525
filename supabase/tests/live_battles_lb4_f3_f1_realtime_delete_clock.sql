begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  created_at, updated_at
) values
('51000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lb4f3f1-host-a@proof.local','proof',now(),now()),
('51000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','lb4f3f1-host-b@proof.local','proof',now(),now());

insert into public.user_profiles (id, username, display_name, is_admin) values
('51000000-0000-4000-8000-000000000001','lb4f3f1_host_a','LB4-F3-F1 host A',false),
('51000000-0000-4000-8000-000000000002','lb4f3f1_host_b','LB4-F3-F1 host B',false);

insert into public.live_sessions (
  id, host_id, title, status, viewer_count, started_at, ended_at,
  created_at, last_heartbeat_at, host_disconnected_at, end_reason
) values
('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','LB4-F3-F1 A','live',0,'2026-08-26 12:00:00+00',null,'2026-08-26 12:00:00+00','2026-08-26 12:00:00+00',null,null),
('52000000-0000-4000-8000-000000000002','51000000-0000-4000-8000-000000000002','LB4-F3-F1 B','live',0,'2026-08-26 12:00:00+00',null,'2026-08-26 12:00:00+00','2026-08-26 12:00:00+00',null,null);

insert into public.live_battles (
  id, challenger_user_id, opponent_user_id, challenger_session_id, opponent_session_id,
  status, invite_expires_at, accepted_at, countdown_started_at, scheduled_start_at,
  last_transition_actor_id, last_transition_reason, version, created_at, updated_at
) values (
  '53000000-0000-4000-8000-000000000001',
  '51000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002',
  '52000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000002',
  'countdown','2026-08-26 12:00:30+00','2026-08-26 12:00:01+00',
  '2026-08-26 12:00:02+00','2026-08-26 12:00:05+00',
  '51000000-0000-4000-8000-000000000001','countdown_started',3,
  '2026-08-26 12:00:00+00','2026-08-26 12:00:02+00'
);

set local role authenticated;
do $$
declare
  v_snapshot jsonb;
begin
  v_snapshot := public.get_live_battle_public_snapshot('52000000-0000-4000-8000-000000000001');
  if jsonb_typeof(v_snapshot->'server_now') <> 'string'
    or (v_snapshot->>'server_now')::timestamptz is null
    then raise exception 'snapshot_server_now_invalid'; end if;
  if jsonb_typeof(v_snapshot->'state') <> 'object'
    or v_snapshot->'state'->>'session_id' <> '52000000-0000-4000-8000-000000000001'
    or v_snapshot->'state'->>'battle_id' <> '53000000-0000-4000-8000-000000000001'
    then raise exception 'observable_snapshot_invalid'; end if;
  if (select count(*) from jsonb_object_keys(v_snapshot->'state')) <> 14
    then raise exception 'snapshot_not_exactly_sanitized'; end if;
  begin
    update public.live_battle_public_states set version=99;
    raise exception 'authenticated_update_allowed';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;

set local role anon;
do $$
begin
  begin
    perform public.get_live_battle_public_snapshot('52000000-0000-4000-8000-000000000001');
    raise exception 'anon_execute_allowed';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;

update public.live_sessions
set status='ended', ended_at='2026-08-26 12:01:00+00', end_reason='host_ended'
where id='52000000-0000-4000-8000-000000000001';

set local role authenticated;
do $$
declare
  v_snapshot jsonb;
begin
  v_snapshot := public.get_live_battle_public_snapshot('52000000-0000-4000-8000-000000000001');
  if v_snapshot->'state' <> 'null'::jsonb
    then raise exception 'ended_session_snapshot_visible'; end if;
end;
$$;
reset role;

do $$
declare
  v_proc pg_catalog.pg_proc%rowtype;
begin
  select p.* into strict v_proc
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='get_live_battle_public_snapshot'
    and pg_catalog.pg_get_function_identity_arguments(p.oid)='p_session_id uuid';

  if v_proc.prosecdef
    or v_proc.provolatile <> 'v'
    or v_proc.proowner <> 'postgres'::regrole
    or not (v_proc.proconfig @> array['search_path=""'])
    then raise exception 'snapshot_rpc_hardening_invalid'; end if;
  if has_function_privilege('public',v_proc.oid,'execute')
    or has_function_privilege('anon',v_proc.oid,'execute')
    or has_function_privilege('service_role',v_proc.oid,'execute')
    or not has_function_privilege('authenticated',v_proc.oid,'execute')
    or pg_catalog.array_length(v_proc.proacl,1) <> 2
    then raise exception 'snapshot_rpc_acl_invalid'; end if;
  if pg_catalog.pg_get_functiondef(v_proc.oid) ~* '\m(insert|update|delete|merge|truncate)\M'
    or pg_catalog.pg_get_functiondef(v_proc.oid) ~* 'live_battles|live_battle_events'
    or pg_catalog.pg_get_functiondef(v_proc.oid) !~ 'public.live_battle_public_states'
    then raise exception 'snapshot_rpc_authority_invalid'; end if;

  if (select count(*) from pg_catalog.pg_policies where schemaname='public' and tablename='live_battle_public_states') <> 1
    or not (select relrowsecurity from pg_catalog.pg_class where oid='public.live_battle_public_states'::regclass)
    or has_table_privilege('authenticated','public.live_battle_public_states','insert,update,delete')
    or has_table_privilege('anon','public.live_battle_public_states','select')
    then raise exception 'projection_security_regressed'; end if;
  if not exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname='sync_live_battle_public_states'
      and p.prosecdef and p.proowner='postgres'::regrole
      and p.proconfig @> array['search_path=""']
  ) then raise exception 'projection_helper_regressed'; end if;
  if (select count(*) from pg_catalog.pg_trigger where tgrelid='public.live_battles'::regclass and tgname='live_battles_sync_public_states' and not tgisinternal) <> 1
    then raise exception 'projection_trigger_regressed'; end if;
  if (select count(*) from pg_catalog.pg_publication p join pg_catalog.pg_publication_rel pr on pr.prpubid=p.oid where p.pubname='supabase_realtime' and pr.prrelid='public.live_battle_public_states'::regclass) <> 1
    or exists (select 1 from pg_catalog.pg_publication p join pg_catalog.pg_publication_rel pr on pr.prpubid=p.oid where p.pubname='supabase_realtime' and pr.prrelid='public.live_battle_events'::regclass)
    then raise exception 'projection_realtime_regressed'; end if;
end;
$$;

rollback;

do $$
begin
  if exists(select 1 from auth.users where email like 'lb4f3f1-%@proof.local')
    or exists(select 1 from public.live_battles where id::text like '53000000-%')
    or exists(select 1 from public.live_battle_public_states where battle_id::text like '53000000-%')
    then raise exception 'lb4_f3_f1_fixture_cleanup_failed'; end if;
end;
$$;
