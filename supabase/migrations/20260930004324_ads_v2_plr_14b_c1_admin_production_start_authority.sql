begin;

create or replace function public.set_admin_advertising_launch_mode_v1(
  p_launch_mode text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid;
  v_previous_role text;
  v_receipt jsonb;
  v_from_mode text;
  v_exact_replay boolean:=false;
begin
  v_actor:=public.admin_require_capability('advertising.rollout.manage');
  if p_launch_mode is null or p_launch_mode not in('PRODUCTION','DISARMED') then
    raise exception using errcode='42501',message='advertising_admin_launch_mode_forbidden';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode='22023',message='advertising_idempotency_key_required';
  end if;

  select launch_mode into strict v_from_mode
  from private.advertising_canary_policy
  where singleton
  for update;
  select exists(
    select 1 from private.admin_action_audit
    where idempotency_scope='v1|admin|advertising|launch_mode.transition'
      and idempotency_key=p_idempotency_key
      and actor_id=v_actor
      and metadata->'receipt'->>'to_mode'=p_launch_mode
  ) into v_exact_replay;
  if not v_exact_replay and(
    p_launch_mode='PRODUCTION' and v_from_mode<>'DISARMED'
    or p_launch_mode='DISARMED' and v_from_mode<>'PRODUCTION'
  ) then
    raise exception using errcode='55000',message='advertising_admin_launch_transition_invalid';
  end if;

  -- PostgREST browser requests do not call the internal launch authority directly.
  -- This narrow bridge validates the actor first, then supplies the trusted role
  -- context expected by the existing state machine for this transaction only.
  v_previous_role:=coalesce(pg_catalog.current_setting('request.jwt.claim.role',true),'');
  begin
    perform pg_catalog.set_config('request.jwt.claim.role','authenticated',true);
    v_receipt:=public.set_advertising_launch_mode_v2(
      p_launch_mode,
      p_idempotency_key
    );
    perform pg_catalog.set_config('request.jwt.claim.role',v_previous_role,true);
  exception when others then
    perform pg_catalog.set_config('request.jwt.claim.role',v_previous_role,true);
    raise;
  end;

  if v_actor is distinct from (select actor_id from private.admin_action_audit
    where idempotency_scope='v1|admin|advertising|launch_mode.transition'
      and idempotency_key=p_idempotency_key) then
    raise exception using errcode='42501',message='advertising_admin_launch_actor_mismatch';
  end if;
  return v_receipt;
end;
$$;

revoke all on function public.set_advertising_launch_mode_v2(
  text,uuid,uuid,uuid,uuid,uuid,text,timestamptz,numeric,integer,numeric,integer
) from public,anon,authenticated,service_role;
grant execute on function public.set_advertising_launch_mode_v2(
  text,uuid,uuid,uuid,uuid,uuid,text,timestamptz,numeric,integer,numeric,integer
) to service_role;

revoke all on function public.set_admin_advertising_launch_mode_v1(text,uuid)
from public,anon,authenticated,service_role;
grant execute on function public.set_admin_advertising_launch_mode_v1(text,uuid)
to authenticated;

do $$
declare
  v_internal_definition text;
  v_wrapper_definition text;
begin
  v_internal_definition:=pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.set_advertising_launch_mode_v2(text,uuid,uuid,uuid,uuid,uuid,text,timestamptz,numeric,integer,numeric,integer)'::pg_catalog.regprocedure
  ));
  v_wrapper_definition:=pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.set_admin_advertising_launch_mode_v1(text,uuid)'::pg_catalog.regprocedure
  ));

  if v_internal_definition not like '%advertising_internal_authority_required%'
    or v_internal_definition not like '%advertising.rollout.manage%'
    or v_internal_definition not like '%advertising_admin_launch_mode_forbidden%' then
    raise exception using errcode='55000',message='ads_v2_plr_14b_c1_internal_authority_guard_missing';
  end if;
  if v_wrapper_definition not like '%admin_require_capability(''advertising.rollout.manage'')%'
    or v_wrapper_definition not like '%set_advertising_launch_mode_v2%'
    or v_wrapper_definition not like '%advertising_admin_launch_transition_invalid%'
    or v_wrapper_definition not like '%set_config(''request.jwt.claim.role'',''authenticated'',true)%' then
    raise exception using errcode='55000',message='ads_v2_plr_14b_c1_admin_bridge_invalid';
  end if;
  if pg_catalog.has_function_privilege('anon','public.set_admin_advertising_launch_mode_v1(text,uuid)','execute')
    or not pg_catalog.has_function_privilege('authenticated','public.set_admin_advertising_launch_mode_v1(text,uuid)','execute')
    or pg_catalog.has_function_privilege('anon','public.set_advertising_launch_mode_v2(text,uuid,uuid,uuid,uuid,uuid,text,timestamptz,numeric,integer,numeric,integer)','execute')
    or pg_catalog.has_function_privilege('authenticated','public.set_advertising_launch_mode_v2(text,uuid,uuid,uuid,uuid,uuid,text,timestamptz,numeric,integer,numeric,integer)','execute')
    or not pg_catalog.has_function_privilege('service_role','public.set_advertising_launch_mode_v2(text,uuid,uuid,uuid,uuid,uuid,text,timestamptz,numeric,integer,numeric,integer)','execute') then
    raise exception using errcode='55000',message='ads_v2_plr_14b_c1_acl_postcheck_failed';
  end if;
end;
$$;

commit;
