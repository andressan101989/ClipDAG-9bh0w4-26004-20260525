-- Keep the Marketplace audit adapter strictly Marketplace-scoped now that its
-- physical table is the global audit, and preserve one permissive category
-- SELECT policy per runtime role.

do $audit_scope$
declare
  v_oid oid:=to_regprocedure('public.search_marketplace_admin_activity(uuid,text,text,uuid,timestamptz,uuid,integer)');
  v_definition text;
  v_rewritten text;
begin
  if v_oid is null then
    raise exception using errcode='55000',message='a3_marketplace_activity_rpc_missing';
  end if;
  v_definition:=pg_get_functiondef(v_oid);
  if v_definition not ilike '%private.admin_action_audit%'
     or v_definition not ilike '%admin_require_capability(''marketplace.audit.read'')%' then
    raise exception using errcode='55000',message='a3_marketplace_activity_contract_changed';
  end if;
  v_rewritten:=replace(
    v_definition,
    'where(p_actor_id is null or a.actor_id=p_actor_id)',
    'where a.domain=''marketplace'' and(p_actor_id is null or a.actor_id=p_actor_id)'
  );
  if v_rewritten=v_definition then
    raise exception using errcode='55000',message='a3_marketplace_activity_scope_not_rewritten';
  end if;
  execute v_rewritten;
end
$audit_scope$;

drop policy marketplace_categories_read_active on public.marketplace_categories;
drop policy marketplace_categories_read_admin on public.marketplace_categories;

create policy marketplace_categories_read_active
on public.marketplace_categories
for select to anon
using(status='active');

create policy marketplace_categories_read_authenticated
on public.marketplace_categories
for select to authenticated
using(status='active' or public.admin_actor_has_capability('marketplace.overview.read'));

do $postcheck$
begin
  if pg_get_functiondef(
    'public.search_marketplace_admin_activity(uuid,text,text,uuid,timestamptz,uuid,integer)'::regprocedure
  ) not ilike '%a.domain=''marketplace''%' then
    raise exception using errcode='55000',message='a3_marketplace_activity_scope_postcheck_failed';
  end if;
  if(
    select count(*)
    from pg_policies
    where schemaname='public' and tablename='marketplace_categories'
      and cmd='SELECT'
      and roles&&array['authenticated']::name[]
  )<>1 then
    raise exception using errcode='55000',message='a3_marketplace_categories_policy_postcheck_failed';
  end if;
end
$postcheck$;
