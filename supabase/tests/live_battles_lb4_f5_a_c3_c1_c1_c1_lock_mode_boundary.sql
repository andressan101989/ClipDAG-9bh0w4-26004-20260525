\set ON_ERROR_STOP on

-- Preserve the full C3-C1-C1 proof, then verify the append-only replacement.
\ir live_battles_lb4_f5_a_c3_c1_c1_strict_leave_lock_budget.sql

begin;

do $$
declare
  v_leave_oid oid :=
    'public.leave_live_battle_series(uuid)'::pg_catalog.regprocedure;
  v_helper_oid oid :=
    'private.live_battle_series_try_lock_scope_strict(uuid)'::pg_catalog.regprocedure;
  v_leave_definition text := pg_catalog.pg_get_functiondef(v_leave_oid);
  v_helper_definition text := pg_catalog.pg_get_functiondef(v_helper_oid);
  v_lock text;
  v_position integer;
  v_previous_position integer := 0;
  v_snapshot_position integer;
  v_authorization_position integer;
  v_first_row_lock_position integer;
  v_leave_config text[];
  v_helper_config text[];
  v_leave_definer boolean;
  v_helper_definer boolean;
begin
  select procedure.proconfig, procedure.prosecdef
  into v_leave_config, v_leave_definer
  from pg_catalog.pg_proc as procedure
  where procedure.oid = v_leave_oid;

  select procedure.proconfig, procedure.prosecdef
  into v_helper_config, v_helper_definer
  from pg_catalog.pg_proc as procedure
  where procedure.oid = v_helper_oid;

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
      raise exception 'c3_c1_c1_c1_table_lock_order_invalid:%', v_lock;
    end if;
    v_previous_position := v_position;
  end loop;

  if (select pg_catalog.count(*) from pg_catalog.regexp_matches(
       v_helper_definition, 'lock table [^;]+ nowait', 'gi')) <> 13 then
    raise exception 'c3_c1_c1_c1_table_lock_closure_invalid';
  end if;
  if v_helper_definition ~* 'lock table public\.live_battle_rule_sets[[:space:]]+in access share mode nowait' or
     v_helper_definition !~* 'live_battle_rule_sets[\s\S]*for key share nowait' then
    raise exception 'c3_c1_c1_c1_rule_set_lock_boundary_invalid';
  end if;

  v_snapshot_position := pg_catalog.strpos(
    pg_catalog.lower(v_helper_definition),
    'select series.* into v_series_snapshot'
  );
  v_authorization_position := pg_catalog.strpos(
    pg_catalog.lower(v_helper_definition),
    'if v_actor is null or v_actor not in'
  );
  v_first_row_lock_position := pg_catalog.strpos(
    pg_catalog.lower(v_helper_definition),
    'perform actor.id'
  );
  if not (
    v_previous_position < v_snapshot_position and
    v_snapshot_position < v_authorization_position and
    v_authorization_position < v_first_row_lock_position
  ) or v_helper_definition !~* 'errcode = ''42501'', message = ''live_battle_series_not_participant''' then
    raise exception 'c3_c1_c1_c1_early_authorization_invalid';
  end if;

  if v_leave_config is distinct from array['search_path=""']::text[] or
     v_helper_config is distinct from array['search_path=""']::text[] or
     not v_leave_definer or v_helper_definer or
     v_leave_definition !~* 'v_actor uuid := auth\.uid\(\)' or
     v_leave_definition !~* 'interval ''750 milliseconds''' or
     v_leave_definition !~* 'v_max_attempts constant integer := 128' or
     v_leave_definition ~* 'lock_timeout|statement_timeout' then
    raise exception 'c3_c1_c1_c1_security_or_budget_invalid';
  end if;

  if not pg_catalog.has_function_privilege(
       'authenticated', v_leave_oid, 'execute') or
     pg_catalog.has_function_privilege('anon', v_leave_oid, 'execute') or
     pg_catalog.has_function_privilege('service_role', v_leave_oid, 'execute') or
     pg_catalog.has_function_privilege('authenticated', v_helper_oid, 'execute') or
     pg_catalog.has_function_privilege('anon', v_helper_oid, 'execute') or
     pg_catalog.has_function_privilege('service_role', v_helper_oid, 'execute') then
    raise exception 'c3_c1_c1_c1_role_acl_invalid';
  end if;
  if exists(
    select 1
    from pg_catalog.pg_proc as procedure,
         lateral pg_catalog.aclexplode(
           coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
         ) as acl
    where procedure.oid in (v_leave_oid, v_helper_oid)
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'c3_c1_c1_c1_public_acl_invalid';
  end if;
end;
$$;

rollback;
