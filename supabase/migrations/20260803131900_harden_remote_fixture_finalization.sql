begin;

do $$begin
 if exists(select fixture_run_id from fixture_ops.fixture_runs group by fixture_run_id having count(*)>1)then
   raise exception using message='fixture_run_identity_historical_duplicates';
 end if;
end$$;
alter table fixture_ops.fixture_runs drop constraint fixture_runs_pkey;
alter table fixture_ops.fixture_runs add primary key(fixture_suite,fixture_run_id);
alter table fixture_ops.fixture_runs add column if not exists failure_code text;

create or replace function fixture_ops.register_fixture_run_roots(p_fixture_suite text,p_fixture_run_id text,p_project_ref text)
returns void language plpgsql security definer set search_path=''as $$
begin
 if coalesce(auth.role(),'')<>'service_role'then raise exception using errcode='42501',message='fixture_service_role_required';end if;
 if p_project_ref<>'aewwdlvbwpczqyvkwvvj'then raise exception using message='fixture_invalid_project';end if;
 if not exists(select 1 from fixture_ops.fixture_runs where fixture_suite=p_fixture_suite and fixture_run_id=p_fixture_run_id and project_ref=p_project_ref)then raise exception using message='fixture_run_not_found';end if;
 insert into fixture_ops.internal_test_fixture_registry(entity_type,entity_id,fixture_suite,fixture_run_id)
 select 'auth_user',u.id,p_fixture_suite,p_fixture_run_id from auth.users u where u.email like case p_fixture_suite
  when'mkt-a4a'then'mkt-a4a-%-'||p_fixture_run_id||'@example.invalid'
  when'mkt-a4b'then'mkt-a4b-%-'||p_fixture_run_id||'@example.invalid'
  when'mkt-a3d2-multiseller'then'mkt-a3d2-ms-%-'||p_fixture_run_id||'@example.invalid'
  when'mkt-a3d2-settlement'then'mkt-a3d2-%-'||p_fixture_run_id||'@example.invalid'
  else null end on conflict do nothing;
end$$;
revoke all on function fixture_ops.register_fixture_run_roots(text,text,text)from public,anon,authenticated;

create or replace function public.marketplace_fixture_lifecycle(p_fixture_suite text,p_fixture_run_id text,p_phase text,p_project_ref text)
returns jsonb language plpgsql security definer set search_path=''as $$
begin
 if coalesce(auth.role(),'')<>'service_role'then raise exception using errcode='42501',message='fixture_service_role_required';end if;
 if p_fixture_suite not in('mkt-a4a','mkt-a4b','mkt-a3d2-settlement','mkt-a3d2-multiseller')or p_fixture_run_id is null or p_fixture_run_id!~'^[a-z0-9-]{12,120}$'or p_project_ref<>'aewwdlvbwpczqyvkwvvj'then raise exception using message='fixture_invalid_identity';end if;
 if exists(select 1 from fixture_ops.fixture_runs where fixture_run_id=p_fixture_run_id and(fixture_suite<>p_fixture_suite or project_ref<>p_project_ref))then raise exception using message='fixture_run_identity_collision';end if;
 insert into fixture_ops.fixture_runs(fixture_suite,fixture_run_id,project_ref)values(p_fixture_suite,p_fixture_run_id,p_project_ref)
 on conflict(fixture_suite,fixture_run_id)do nothing;
 if not exists(select 1 from fixture_ops.fixture_runs where fixture_suite=p_fixture_suite and fixture_run_id=p_fixture_run_id and project_ref=p_project_ref)then raise exception using message='fixture_run_identity_collision';end if;
 if p_phase='begin'then return jsonb_build_object('registered',true,'fixture_suite',p_fixture_suite,'fixture_run_id',p_fixture_run_id);end if;
 perform fixture_ops.register_fixture_run_roots(p_fixture_suite,p_fixture_run_id,p_project_ref);
 perform fixture_ops.register_fixture_run_descendants(p_fixture_suite,p_fixture_run_id);
 if p_phase='register'then update fixture_ops.fixture_runs set status='testing',failure_code=null where fixture_suite=p_fixture_suite and fixture_run_id=p_fixture_run_id;return jsonb_build_object('registered',true,'fixture_suite',p_fixture_suite,'fixture_run_id',p_fixture_run_id);end if;
 if p_phase='cleanup'then return public.finalize_marketplace_fixture_run(p_fixture_suite,p_fixture_run_id,p_project_ref);end if;
 raise exception using message='fixture_invalid_phase';
end$$;
revoke all on function public.marketplace_fixture_lifecycle(text,text,text,text)from public,anon,authenticated;
grant execute on function public.marketplace_fixture_lifecycle(text,text,text,text)to service_role;

create or replace function public.finalize_marketplace_fixture_run(p_fixture_suite text,p_fixture_run_id text,p_project_ref text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare exposure jsonb;result jsonb;products_active int;stores_active int;sessions_live int;pins_active int;offers_active int;failure text;
begin
 if coalesce(auth.role(),'')<>'service_role'then raise exception using errcode='42501',message='fixture_service_role_required';end if;
 if p_project_ref<>'aewwdlvbwpczqyvkwvvj'then raise exception using message='fixture_invalid_project';end if;
 perform pg_advisory_xact_lock(hashtextextended('fixture-finalize:'||p_fixture_suite||':'||p_fixture_run_id,0));
 select finalization_result into result from fixture_ops.fixture_runs where fixture_suite=p_fixture_suite and fixture_run_id=p_fixture_run_id and project_ref=p_project_ref for update;if not found then raise exception using message='fixture_run_not_found';end if;if result is not null then return result;end if;
 update fixture_ops.fixture_runs set status='finalizing',failure_code=null where fixture_suite=p_fixture_suite and fixture_run_id=p_fixture_run_id;
 begin
  perform fixture_ops.register_fixture_run_roots(p_fixture_suite,p_fixture_run_id,p_project_ref);
  perform fixture_ops.register_fixture_run_descendants(p_fixture_suite,p_fixture_run_id);
  if exists(select 1 from public.marketplace_checkout_sessions c join fixture_ops.internal_test_fixture_registry cr on cr.entity_type='checkout'and cr.entity_id=c.id and cr.fixture_suite=p_fixture_suite and cr.fixture_run_id=p_fixture_run_id where c.status='pending_payment'and(
    not exists(select 1 from fixture_ops.internal_test_fixture_registry ur where ur.entity_type='auth_user'and ur.entity_id=c.buyer_id and ur.fixture_suite=p_fixture_suite and ur.fixture_run_id=p_fixture_run_id)
    or exists(select 1 from public.marketplace_orders o where o.checkout_id=c.id and not exists(select 1 from fixture_ops.internal_test_fixture_registry sr where sr.entity_type='store'and sr.entity_id=o.store_id and sr.fixture_suite=p_fixture_suite and sr.fixture_run_id=p_fixture_run_id))
    or exists(select 1 from public.marketplace_order_items i where i.checkout_id=c.id and(not exists(select 1 from fixture_ops.internal_test_fixture_registry pr where pr.entity_type='product'and pr.entity_id=i.product_id and pr.fixture_suite=p_fixture_suite and pr.fixture_run_id=p_fixture_run_id)or not exists(select 1 from fixture_ops.internal_test_fixture_registry vr join public.marketplace_product_variants v on v.id=vr.entity_id where vr.entity_type='variant'and vr.entity_id=i.variant_id and vr.fixture_suite=p_fixture_suite and vr.fixture_run_id=p_fixture_run_id and v.product_id=i.product_id)))
    or exists(select 1 from public.marketplace_inventory_reservations x where x.checkout_id=c.id and x.status='active'and(not exists(select 1 from fixture_ops.internal_test_fixture_registry rr where rr.entity_type='reservation'and rr.entity_id=x.id and rr.fixture_suite=p_fixture_suite and rr.fixture_run_id=p_fixture_run_id)or not exists(select 1 from fixture_ops.internal_test_fixture_registry vr where vr.entity_type='variant'and vr.entity_id=x.variant_id and vr.fixture_suite=p_fixture_suite and vr.fixture_run_id=p_fixture_run_id)))))then raise exception using message='fixture_cleanup_mixed_checkout_forbidden';end if;
  update public.live_session_products set status='removed',is_featured=false,unpinned_at=coalesce(unpinned_at,now()),updated_at=now(),version=version+1 where status='active'and id in(select entity_id from fixture_ops.internal_test_fixture_registry where entity_type='pin'and fixture_suite=p_fixture_suite and fixture_run_id=p_fixture_run_id);
  update public.marketplace_live_affiliate_offers set status='removed',updated_at=now()where status='active'and id in(select entity_id from fixture_ops.internal_test_fixture_registry where entity_type='affiliate_offer'and fixture_suite=p_fixture_suite and fixture_run_id=p_fixture_run_id);
  update public.live_sessions set status='ended',ended_at=coalesce(ended_at,now())where status='live'and id in(select entity_id from fixture_ops.internal_test_fixture_registry where entity_type='live_session'and fixture_suite=p_fixture_suite and fixture_run_id=p_fixture_run_id);
  update public.products set status='paused',moderation_status='suspended',published_at=null,updated_at=now()where status<>'deleted'and id in(select entity_id from fixture_ops.internal_test_fixture_registry where entity_type='product'and fixture_suite=p_fixture_suite and fixture_run_id=p_fixture_run_id);
  update public.marketplace_stores set status='suspended',updated_at=now()where id in(select entity_id from fixture_ops.internal_test_fixture_registry where entity_type='store'and fixture_suite=p_fixture_suite and fixture_run_id=p_fixture_run_id);
  update fixture_ops.internal_test_fixture_registry set cleanup_status=case when entity_type in('product','store','live_session','pin','affiliate_offer')then'quarantined'else'preserved'end where fixture_suite=p_fixture_suite and fixture_run_id=p_fixture_run_id;
  exposure:=fixture_ops.neutralize_marketplace_fixture_run(p_fixture_suite,p_fixture_run_id,p_project_ref);
  select count(*)into products_active from public.products where status='active'and moderation_status='approved'and deleted_at is null and id in(select entity_id from fixture_ops.internal_test_fixture_registry where entity_type='product'and fixture_suite=p_fixture_suite and fixture_run_id=p_fixture_run_id);
  select count(*)into stores_active from public.marketplace_stores where status='active'and id in(select entity_id from fixture_ops.internal_test_fixture_registry where entity_type='store'and fixture_suite=p_fixture_suite and fixture_run_id=p_fixture_run_id);
  select count(*)into sessions_live from public.live_sessions where status='live'and id in(select entity_id from fixture_ops.internal_test_fixture_registry where entity_type='live_session'and fixture_suite=p_fixture_suite and fixture_run_id=p_fixture_run_id);
  select count(*)into pins_active from public.live_session_products where status='active'and id in(select entity_id from fixture_ops.internal_test_fixture_registry where entity_type='pin'and fixture_suite=p_fixture_suite and fixture_run_id=p_fixture_run_id);
  select count(*)into offers_active from public.marketplace_live_affiliate_offers where status='active'and id in(select entity_id from fixture_ops.internal_test_fixture_registry where entity_type='affiliate_offer'and fixture_suite=p_fixture_suite and fixture_run_id=p_fixture_run_id);
  if products_active<>0 or stores_active<>0 or sessions_live<>0 or pins_active<>0 or offers_active<>0 then raise exception using message='fixture_run_quarantine_incomplete';end if;
  result:=jsonb_build_object('quarantined',true,'financial_neutralized',true,'status','quarantined','fixture_suite',p_fixture_suite,'fixture_run_id',p_fixture_run_id,'products_active',products_active,'stores_active',stores_active,'sessions_live',sessions_live,'pins_active',pins_active,'offers_active',offers_active,'fixture_user_spendable',(exposure->>'fixture_user_spendable')::numeric,'fixture_attributable_escrow',(exposure->>'fixture_attributable_escrow')::numeric,'active_reservations',(exposure->>'active_reservations')::int,'unresolved_allocations',(exposure->>'unresolved_allocations')::int,'net_platform_impact',(exposure->>'net_platform_impact')::numeric);
 exception when others then
  failure:=case when sqlerrm in('fixture_cleanup_mixed_checkout_forbidden','fixture_run_neutralization_incomplete','fixture_run_quarantine_incomplete','fixture_cleanup_escrow_insufficient','fixture_cleanup_account_frozen','fixture_cleanup_nonfixture_buyer')then sqlerrm else'fixture_finalization_failed'end;
 end;
 if failure is not null then update fixture_ops.fixture_runs set status='cleanup_failed',cleaned_at=null,finalization_result=null,failure_code=failure where fixture_suite=p_fixture_suite and fixture_run_id=p_fixture_run_id;return jsonb_build_object('quarantined',false,'financial_neutralized',false,'status','cleanup_failed','fixture_suite',p_fixture_suite,'fixture_run_id',p_fixture_run_id,'failure_code',failure);end if;
 update fixture_ops.fixture_runs set status='quarantined',cleaned_at=now(),finalization_result=result,failure_code=null where fixture_suite=p_fixture_suite and fixture_run_id=p_fixture_run_id;return result;
end$$;
revoke all on function public.finalize_marketplace_fixture_run(text,text,text)from public,anon,authenticated;
grant execute on function public.finalize_marketplace_fixture_run(text,text,text)to service_role;

commit;
