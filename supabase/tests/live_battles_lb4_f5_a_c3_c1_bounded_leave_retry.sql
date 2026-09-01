\set ON_ERROR_STOP on

-- Re-run the complete C3 functional proof against the C3-C1 replacement.
-- It covers both participants in pending/accepted/countdown/active, exact
-- 0/2 projection cardinality, authorization, lookup, terminal idempotency,
-- between-round completion, live-session preservation and economic history.
\ir live_battles_lb4_f5_a_c3_active_series_leave.sql

begin;

do $$
declare
  v_leave_definition text := pg_catalog.pg_get_functiondef(
    'public.leave_live_battle_series(uuid)'::pg_catalog.regprocedure
  );
  v_helper_definition text := pg_catalog.pg_get_functiondef(
    'private.live_battle_series_try_lock_scope(uuid,uuid,uuid,uuid,uuid)'::pg_catalog.regprocedure
  );
  v_leave_config text[];
  v_helper_config text[];
begin
  select procedure.proconfig into v_leave_config
  from pg_catalog.pg_proc as procedure
  where procedure.oid = 'public.leave_live_battle_series(uuid)'::pg_catalog.regprocedure;
  select procedure.proconfig into v_helper_config
  from pg_catalog.pg_proc as procedure
  where procedure.oid =
    'private.live_battle_series_try_lock_scope(uuid,uuid,uuid,uuid,uuid)'::pg_catalog.regprocedure;

  if v_leave_config is distinct from array['search_path=""']::text[] or
     v_helper_config is distinct from array['search_path=""']::text[] then
    raise exception 'c3_c1_search_path_not_empty';
  end if;
  if v_leave_definition !~* '750 milliseconds' or
     v_leave_definition !~* 'live_battle_series_leave_busy' or
     v_leave_definition !~* 'v_max_attempts constant integer := 128' then
    raise exception 'c3_c1_bounded_retry_missing';
  end if;
  if (select pg_catalog.count(*) from pg_catalog.regexp_matches(
       v_helper_definition, 'for update nowait', 'gi')) <> 7 or
     v_helper_definition ~* 'live_battle_transition' then
    raise exception 'c3_c1_lock_helper_invalid';
  end if;
  if v_leave_definition ~* 'lock_timeout' or
     (select pg_catalog.count(*) from pg_catalog.regexp_matches(
       v_leave_definition, 'when lock_not_available', 'gi')) <> 1 then
    raise exception 'c3_c1_lock_capture_not_narrow';
  end if;
  if not has_function_privilege(
       'authenticated', 'public.leave_live_battle_series(uuid)', 'execute') or
     has_function_privilege(
       'anon', 'public.leave_live_battle_series(uuid)', 'execute') or
     has_function_privilege(
       'service_role', 'public.leave_live_battle_series(uuid)', 'execute') or
     has_function_privilege(
       'authenticated',
       'private.live_battle_series_try_lock_scope(uuid,uuid,uuid,uuid,uuid)',
       'execute') or
     has_function_privilege(
       'anon',
       'private.live_battle_series_try_lock_scope(uuid,uuid,uuid,uuid,uuid)',
       'execute') or
     has_function_privilege(
       'service_role',
       'private.live_battle_series_try_lock_scope(uuid,uuid,uuid,uuid,uuid)',
       'execute') then
    raise exception 'c3_c1_acl_invalid';
  end if;
end;
$$;

rollback;
