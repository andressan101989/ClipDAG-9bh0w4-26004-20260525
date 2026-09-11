-- Close the last legacy Marketplace authority dependency inside service-only
-- financial/domain cores. The authenticated admin wrapper retains the human
-- subject while temporarily invoking these cores as service_role, so every
-- core binds p_resolver_id to auth.uid() and rechecks the canonical capability.

do $closure$
declare
  v_signature text;
  v_oid oid;
  v_definition text;
  v_rewritten text;
begin
  foreach v_signature in array array[
    'public.fetch_support_marketplace_dispute(uuid,uuid)',
    'public.open_marketplace_post_settlement_review(uuid,uuid,text,text,uuid)',
    'public.release_marketplace_order_after_dispute_resolution(uuid,uuid,uuid,uuid)',
    'public.resolve_marketplace_dispute_held_v1(uuid,uuid,text,text,text,uuid,numeric)',
    'public.resolve_marketplace_dispute(uuid,uuid,text,text,text,uuid,numeric)',
    'public.reverse_marketplace_released_settlement(uuid,uuid,text,text,uuid)'
  ] loop
    v_oid:=to_regprocedure(v_signature);
    if v_oid is null then
      raise exception using errcode='55000',message='a3_marketplace_internal_core_missing',detail=v_signature;
    end if;
    v_definition:=pg_get_functiondef(v_oid);
    if v_definition not ilike '%public.user_profiles%is_admin%'
       and v_definition not ilike '%is_admin%public.user_profiles%' then
      raise exception using errcode='55000',message='a3_marketplace_internal_legacy_guard_missing',detail=v_signature;
    end if;
    v_rewritten:=regexp_replace(
      v_definition,
      'if\s+not\s+exists\s*\(\s*select\s+1\s+from\s+public\.user_profiles\s+where\s+id\s*=\s*p_resolver_id\s+and\s+is_admin\s*=\s*true\s*\)\s*then',
      'if p_resolver_id is distinct from auth.uid() or not public.admin_actor_has_capability(''marketplace.disputes.resolve'') then',
      'gi'
    );
    if v_rewritten=v_definition then
      raise exception using errcode='55000',message='a3_marketplace_internal_legacy_guard_not_rewritten',detail=v_signature;
    end if;
    if v_rewritten ilike '%public.user_profiles%is_admin%'
       or v_rewritten ilike '%is_admin%public.user_profiles%' then
      raise exception using errcode='55000',message='a3_marketplace_internal_legacy_authority_remaining',detail=v_signature;
    end if;
    v_rewritten:=replace(
      v_rewritten,
      'SET search_path TO ''pg_catalog'', ''public''',
      'SET search_path TO ''pg_catalog'', ''private'', ''public'''
    );
    execute v_rewritten;
  end loop;
end
$closure$;

do $postcheck$
begin
  if exists(
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in(
        'fetch_support_marketplace_dispute',
        'open_marketplace_post_settlement_review',
        'release_marketplace_order_after_dispute_resolution',
        'resolve_marketplace_dispute_held_v1',
        'resolve_marketplace_dispute',
        'reverse_marketplace_released_settlement'
      )
      and(
        p.prosrc ilike '%public.user_profiles%is_admin%'
        or p.prosrc ilike '%is_admin%public.user_profiles%'
      )
  ) then
    raise exception using errcode='55000',message='a3_marketplace_internal_authority_postcheck_failed';
  end if;
end
$postcheck$;
