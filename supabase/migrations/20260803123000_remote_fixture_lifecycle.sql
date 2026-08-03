create table if not exists fixture_ops.fixture_runs (
  fixture_run_id text primary key,
  fixture_suite text not null,
  project_ref text not null,
  status text not null default 'creating' check(status in('creating','testing','quarantined','cleanup_failed')),
  created_at timestamptz not null default now(),
  cleaned_at timestamptz
);
alter table fixture_ops.fixture_runs enable row level security;
revoke all on fixture_ops.fixture_runs from public,anon,authenticated;

create or replace function public.marketplace_fixture_lifecycle(
  p_fixture_suite text,p_fixture_run_id text,p_phase text,p_project_ref text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare n integer:=0;
begin
  if auth.role()<>'service_role' then raise exception using message='fixture_service_role_required'; end if;
  if p_fixture_suite not in('mkt-a4a','mkt-a4b','mkt-a3d2-settlement','mkt-a3d2-multiseller')
     or p_fixture_run_id is null or p_fixture_run_id!~'^[a-z0-9-]{4,80}$'
     or p_project_ref<>'aewwdlvbwpczqyvkwvvj' then raise exception using message='fixture_invalid_identity'; end if;
  insert into fixture_ops.fixture_runs(fixture_run_id,fixture_suite,project_ref)
  values(p_fixture_run_id,p_fixture_suite,p_project_ref)
  on conflict(fixture_run_id)do update set fixture_suite=excluded.fixture_suite;
  if p_phase='begin' then return jsonb_build_object('registered',true); end if;

  insert into fixture_ops.internal_test_fixture_registry(entity_type,entity_id,fixture_suite,fixture_run_id)
  select 'auth_user',u.id,p_fixture_suite,p_fixture_run_id from auth.users u
  where u.email like case p_fixture_suite
    when 'mkt-a4a' then 'mkt-a4a-%-'||p_fixture_run_id||'@example.invalid'
    when 'mkt-a4b' then 'mkt-a4b-%-'||p_fixture_run_id||'@example.invalid'
    when 'mkt-a3d2-multiseller' then 'mkt-a3d2-ms-%-'||p_fixture_run_id||'@example.invalid'
    else 'mkt-a3d2-%-'||p_fixture_run_id||'@example.invalid' end
  on conflict do nothing;
  insert into fixture_ops.internal_test_fixture_registry(entity_type,entity_id,fixture_suite,fixture_run_id)
  select 'profile',p.id,p_fixture_suite,p_fixture_run_id from public.user_profiles p join fixture_ops.internal_test_fixture_registry r on r.entity_type='auth_user'and r.entity_id=p.id and r.fixture_run_id=p_fixture_run_id on conflict do nothing;
  insert into fixture_ops.internal_test_fixture_registry(entity_type,entity_id,fixture_suite,fixture_run_id)
  select 'seller',s.user_id,p_fixture_suite,p_fixture_run_id from public.marketplace_sellers s join fixture_ops.internal_test_fixture_registry r on r.entity_type='auth_user'and r.entity_id=s.user_id and r.fixture_run_id=p_fixture_run_id on conflict do nothing;
  insert into fixture_ops.internal_test_fixture_registry(entity_type,entity_id,fixture_suite,fixture_run_id)
  select 'store',s.id,p_fixture_suite,p_fixture_run_id from public.marketplace_stores s join fixture_ops.internal_test_fixture_registry r on r.entity_type='auth_user'and r.entity_id=s.seller_id and r.fixture_run_id=p_fixture_run_id on conflict do nothing;
  insert into fixture_ops.internal_test_fixture_registry(entity_type,entity_id,fixture_suite,fixture_run_id)
  select 'product',p.id,p_fixture_suite,p_fixture_run_id from public.products p join fixture_ops.internal_test_fixture_registry r on r.entity_type='store'and r.entity_id=p.store_id and r.fixture_run_id=p_fixture_run_id on conflict do nothing;
  insert into fixture_ops.internal_test_fixture_registry(entity_type,entity_id,fixture_suite,fixture_run_id)
  select 'variant',v.id,p_fixture_suite,p_fixture_run_id from public.marketplace_product_variants v join fixture_ops.internal_test_fixture_registry r on r.entity_type='product'and r.entity_id=v.product_id and r.fixture_run_id=p_fixture_run_id on conflict do nothing;
  insert into fixture_ops.internal_test_fixture_registry(entity_type,entity_id,fixture_suite,fixture_run_id)
  select 'live_session',l.id,p_fixture_suite,p_fixture_run_id from public.live_sessions l join fixture_ops.internal_test_fixture_registry r on r.entity_type='auth_user'and r.entity_id=l.host_id and r.fixture_run_id=p_fixture_run_id on conflict do nothing;
  insert into fixture_ops.internal_test_fixture_registry(entity_type,entity_id,fixture_suite,fixture_run_id)
  select 'pin',p.id,p_fixture_suite,p_fixture_run_id from public.live_session_products p join fixture_ops.internal_test_fixture_registry r on r.entity_type='product'and r.entity_id=p.product_id and r.fixture_run_id=p_fixture_run_id on conflict do nothing;
  insert into fixture_ops.internal_test_fixture_registry(entity_type,entity_id,fixture_suite,fixture_run_id)
  select 'affiliate_offer',o.id,p_fixture_suite,p_fixture_run_id from public.marketplace_live_affiliate_offers o join fixture_ops.internal_test_fixture_registry r on r.entity_type='product'and r.entity_id=o.product_id and r.fixture_run_id=p_fixture_run_id on conflict do nothing;
  if p_phase='register' then update fixture_ops.fixture_runs set status='testing'where fixture_run_id=p_fixture_run_id;return jsonb_build_object('registered',true); end if;
  if p_phase<>'cleanup' then raise exception using message='fixture_invalid_phase'; end if;
  update public.live_session_products set status='removed',is_featured=false,unpinned_at=coalesce(unpinned_at,now()),updated_at=now(),version=version+1 where status='active'and id in(select entity_id from fixture_ops.internal_test_fixture_registry where entity_type='pin'and fixture_run_id=p_fixture_run_id);get diagnostics n=row_count;
  update public.marketplace_live_affiliate_offers set status='removed',updated_at=now()where status='active'and id in(select entity_id from fixture_ops.internal_test_fixture_registry where entity_type='affiliate_offer'and fixture_run_id=p_fixture_run_id);
  update public.live_sessions set status='ended',ended_at=coalesce(ended_at,now())where status='live'and id in(select entity_id from fixture_ops.internal_test_fixture_registry where entity_type='live_session'and fixture_run_id=p_fixture_run_id);
  update public.products set status='paused',moderation_status='suspended',published_at=null,updated_at=now()where status<>'deleted'and id in(select entity_id from fixture_ops.internal_test_fixture_registry where entity_type='product'and fixture_run_id=p_fixture_run_id);
  update public.marketplace_stores set status='suspended',updated_at=now()where id in(select entity_id from fixture_ops.internal_test_fixture_registry where entity_type='store'and fixture_run_id=p_fixture_run_id);
  update fixture_ops.internal_test_fixture_registry set cleanup_status=case when entity_type in('product','store','live_session','pin','affiliate_offer')then'quarantined'else'preserved'end where fixture_run_id=p_fixture_run_id;
  update fixture_ops.fixture_runs set status='quarantined',cleaned_at=now()where fixture_run_id=p_fixture_run_id;
  return jsonb_build_object('quarantined',true,'pins_removed',n);
end$$;
revoke all on function public.marketplace_fixture_lifecycle(text,text,text,text)from public,anon,authenticated;
grant execute on function public.marketplace_fixture_lifecycle(text,text,text,text)to service_role;
