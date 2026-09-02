\set ON_ERROR_STOP on

-- Re-run the complete C3-C1 proof against the strict table-lock replacement.
-- That proof recursively covers C3 lifecycle semantics and finishes in ROLLBACK.
\ir live_battles_lb4_f5_a_c3_c1_bounded_leave_retry.sql

begin;

do $$
declare
  v_leave_oid oid :=
    'public.leave_live_battle_series(uuid)'::pg_catalog.regprocedure;
  v_helper_oid oid :=
    'private.live_battle_series_try_lock_scope_strict(uuid)'::pg_catalog.regprocedure;
  v_leave_definition text := pg_catalog.pg_get_functiondef(v_leave_oid);
  v_helper_definition text := pg_catalog.pg_get_functiondef(v_helper_oid);
  v_leave_config text[];
  v_helper_config text[];
  v_leave_definer boolean;
  v_helper_definer boolean;
  v_leave_owner text;
  v_helper_owner text;
  v_public_execute boolean;
  v_lock text;
  v_position integer;
  v_previous_position integer := 0;
begin
  select procedure.proconfig, procedure.prosecdef,
         pg_catalog.pg_get_userbyid(procedure.proowner)
  into v_leave_config, v_leave_definer, v_leave_owner
  from pg_catalog.pg_proc as procedure
  where procedure.oid = v_leave_oid;

  select procedure.proconfig, procedure.prosecdef,
         pg_catalog.pg_get_userbyid(procedure.proowner)
  into v_helper_config, v_helper_definer, v_helper_owner
  from pg_catalog.pg_proc as procedure
  where procedure.oid = v_helper_oid;

  if v_leave_config is distinct from array['search_path=""']::text[] or
     v_helper_config is distinct from array['search_path=""']::text[] then
    raise exception 'c3_c1_c1_search_path_not_empty';
  end if;
  if not v_leave_definer or v_helper_definer then
    raise exception 'c3_c1_c1_security_identity_invalid';
  end if;
  if v_leave_owner <> 'postgres' or v_helper_owner <> 'postgres' then
    raise exception 'c3_c1_c1_owner_invalid';
  end if;

  foreach v_lock in array array[
    'lock table auth.users in row share mode nowait',
    'lock table public.live_sessions in row share mode nowait',
    'lock table public.live_battles in row exclusive mode nowait',
    'lock table public.live_battle_score_states in row exclusive mode nowait',
    'lock table public.live_battle_series in row exclusive mode nowait',
    'lock table public.live_battle_rematch_requests in row exclusive mode nowait',
    'lock table public.live_battle_public_states in row exclusive mode nowait',
    'lock table public.live_battle_events in row exclusive mode nowait',
    'lock table public.live_battle_rule_sets in row share mode nowait',
    'lock table public.live_battle_power_states in row exclusive mode nowait',
    'lock table public.live_battle_boost_events in access share mode nowait',
    'lock table public.live_gift_transactions in access share mode nowait',
    'lock table public.live_battle_score_events in access share mode nowait'
  ] loop
    v_position := pg_catalog.strpos(pg_catalog.lower(v_helper_definition), v_lock);
    if v_position <= v_previous_position then
      raise exception 'c3_c1_c1_table_lock_order_invalid:%', v_lock;
    end if;
    v_previous_position := v_position;
  end loop;

  if (select pg_catalog.count(*) from pg_catalog.regexp_matches(
       v_helper_definition, 'lock table [^;]+ nowait', 'gi')) <> 13 then
    raise exception 'c3_c1_c1_table_lock_closure_invalid';
  end if;
  if pg_catalog.strpos(
       pg_catalog.lower(v_helper_definition),
       'select series.* into v_series_snapshot'
     ) <= v_previous_position then
    raise exception 'c3_c1_c1_series_lookup_precedes_table_locks';
  end if;
  if v_helper_definition !~* 'order by actor.id[[:space:]]+for update nowait' or
     v_helper_definition !~* 'order by session.id[[:space:]]+for update nowait' or
     v_helper_definition !~* 'order by battle.round_number desc, battle.id desc[[:space:]]+limit 1[[:space:]]+for update nowait' or
     v_helper_definition !~* 'live_battle_rule_sets[\s\S]*for key share nowait' or
     v_helper_definition !~* 'live_battle_power_states[\s\S]*for update nowait' then
    raise exception 'c3_c1_c1_row_lock_closure_invalid';
  end if;
  if v_helper_definition ~* 'live_battle_transition|reconcile_live_battle|sync_live_battle|insert into|update public|delete from' then
    raise exception 'c3_c1_c1_helper_became_authority';
  end if;

  if v_leave_definition !~* 'interval ''750 milliseconds''' or
     v_leave_definition !~* 'v_max_attempts constant integer := 128' or
     v_leave_definition !~* 'least[\s\S]*0.010[\s\S]*extract\(epoch from v_remaining\)' or
     v_leave_definition !~* 'errcode = ''55P03'', message = ''live_battle_series_leave_busy''' then
    raise exception 'c3_c1_c1_budget_contract_invalid';
  end if;
  if v_leave_definition ~* 'lock_timeout|statement_timeout' or
     (select pg_catalog.count(*) from pg_catalog.regexp_matches(
       v_leave_definition, 'when lock_not_available', 'gi')) <> 1 or
     v_leave_definition !~* 'begin[\s\S]*live_battle_series_try_lock_scope_strict[\s\S]*exception[[:space:]]+when lock_not_available then[\s\S]*end;' then
    raise exception 'c3_c1_c1_lock_capture_not_narrow';
  end if;

  if not pg_catalog.has_function_privilege(
       'authenticated', v_leave_oid, 'execute') or
     pg_catalog.has_function_privilege('anon', v_leave_oid, 'execute') or
     pg_catalog.has_function_privilege('service_role', v_leave_oid, 'execute') or
     pg_catalog.has_function_privilege('authenticated', v_helper_oid, 'execute') or
     pg_catalog.has_function_privilege('anon', v_helper_oid, 'execute') or
     pg_catalog.has_function_privilege('service_role', v_helper_oid, 'execute') then
    raise exception 'c3_c1_c1_role_acl_invalid';
  end if;

  select exists(
    select 1
    from pg_catalog.pg_proc as procedure,
         lateral pg_catalog.aclexplode(
           coalesce(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) as acl
    where procedure.oid in (v_leave_oid, v_helper_oid)
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) into v_public_execute;
  if v_public_execute then
    raise exception 'c3_c1_c1_public_acl_invalid';
  end if;
end;
$$;

rollback;
