begin;

alter table fixture_ops.fixture_runs drop constraint fixture_runs_status_check;
alter table fixture_ops.fixture_runs add constraint fixture_runs_status_check
  check(status in('creating','testing','finalizing','quarantined','cleanup_failed'));
alter table fixture_ops.fixture_runs add column if not exists finalization_result jsonb;

alter table fixture_ops.fixture_financial_cleanup add column if not exists fixture_suite text;
alter table fixture_ops.fixture_financial_cleanup add column if not exists fixture_run_id text;

create or replace function fixture_ops.register_fixture_run_descendants(
  p_fixture_suite text,p_fixture_run_id text
)returns void language plpgsql security definer set search_path=''as $$
begin
 if not exists(select 1 from fixture_ops.fixture_runs where fixture_suite=p_fixture_suite and fixture_run_id=p_fixture_run_id)then
   raise exception using message='fixture_run_not_found';
 end if;
 insert into fixture_ops.internal_test_fixture_registry(entity_type,entity_id,fixture_suite,fixture_run_id)
 select 'profile',p.id,p_fixture_suite,p_fixture_run_id from public.user_profiles p join fixture_ops.internal_test_fixture_registry r on r.entity_type='auth_user'and r.entity_id=p.id where r.fixture_suite=p_fixture_suite and r.fixture_run_id=p_fixture_run_id on conflict do nothing;
 insert into fixture_ops.internal_test_fixture_registry(entity_type,entity_id,fixture_suite,fixture_run_id)
 select 'seller',s.user_id,p_fixture_suite,p_fixture_run_id from public.marketplace_sellers s join fixture_ops.internal_test_fixture_registry r on r.entity_type='auth_user'and r.entity_id=s.user_id where r.fixture_suite=p_fixture_suite and r.fixture_run_id=p_fixture_run_id on conflict do nothing;
 insert into fixture_ops.internal_test_fixture_registry(entity_type,entity_id,fixture_suite,fixture_run_id)
 select 'store',s.id,p_fixture_suite,p_fixture_run_id from public.marketplace_stores s join fixture_ops.internal_test_fixture_registry r on r.entity_type='auth_user'and r.entity_id=s.seller_id where r.fixture_suite=p_fixture_suite and r.fixture_run_id=p_fixture_run_id on conflict do nothing;
 insert into fixture_ops.internal_test_fixture_registry(entity_type,entity_id,fixture_suite,fixture_run_id)
 select 'product',p.id,p_fixture_suite,p_fixture_run_id from public.products p join fixture_ops.internal_test_fixture_registry r on r.entity_type='store'and r.entity_id=p.store_id where r.fixture_suite=p_fixture_suite and r.fixture_run_id=p_fixture_run_id on conflict do nothing;
 insert into fixture_ops.internal_test_fixture_registry(entity_type,entity_id,fixture_suite,fixture_run_id)
 select 'variant',v.id,p_fixture_suite,p_fixture_run_id from public.marketplace_product_variants v join fixture_ops.internal_test_fixture_registry r on r.entity_type='product'and r.entity_id=v.product_id where r.fixture_suite=p_fixture_suite and r.fixture_run_id=p_fixture_run_id on conflict do nothing;
 insert into fixture_ops.internal_test_fixture_registry(entity_type,entity_id,fixture_suite,fixture_run_id)
 select 'live_session',l.id,p_fixture_suite,p_fixture_run_id from public.live_sessions l join fixture_ops.internal_test_fixture_registry r on r.entity_type='auth_user'and r.entity_id=l.host_id where r.fixture_suite=p_fixture_suite and r.fixture_run_id=p_fixture_run_id on conflict do nothing;
 insert into fixture_ops.internal_test_fixture_registry(entity_type,entity_id,fixture_suite,fixture_run_id)
 select 'pin',p.id,p_fixture_suite,p_fixture_run_id from public.live_session_products p join fixture_ops.internal_test_fixture_registry r on r.entity_type='product'and r.entity_id=p.product_id where r.fixture_suite=p_fixture_suite and r.fixture_run_id=p_fixture_run_id on conflict do nothing;
 insert into fixture_ops.internal_test_fixture_registry(entity_type,entity_id,fixture_suite,fixture_run_id)
 select 'affiliate_offer',o.id,p_fixture_suite,p_fixture_run_id from public.marketplace_live_affiliate_offers o join fixture_ops.internal_test_fixture_registry r on r.entity_type='product'and r.entity_id=o.product_id where r.fixture_suite=p_fixture_suite and r.fixture_run_id=p_fixture_run_id on conflict do nothing;
 insert into fixture_ops.internal_test_fixture_registry(entity_type,entity_id,fixture_suite,fixture_run_id)
 select 'checkout',c.id,p_fixture_suite,p_fixture_run_id from public.marketplace_checkout_sessions c join fixture_ops.internal_test_fixture_registry r on r.entity_type='auth_user'and r.entity_id=c.buyer_id where r.fixture_suite=p_fixture_suite and r.fixture_run_id=p_fixture_run_id on conflict do nothing;
 insert into fixture_ops.internal_test_fixture_registry(entity_type,entity_id,fixture_suite,fixture_run_id)
 select 'order',o.id,p_fixture_suite,p_fixture_run_id from public.marketplace_orders o join fixture_ops.internal_test_fixture_registry r on r.entity_type='store'and r.entity_id=o.store_id where r.fixture_suite=p_fixture_suite and r.fixture_run_id=p_fixture_run_id on conflict do nothing;
 insert into fixture_ops.internal_test_fixture_registry(entity_type,entity_id,fixture_suite,fixture_run_id)
 select 'reservation',x.id,p_fixture_suite,p_fixture_run_id from public.marketplace_inventory_reservations x join fixture_ops.internal_test_fixture_registry r on r.entity_type='order'and r.entity_id=x.order_id where r.fixture_suite=p_fixture_suite and r.fixture_run_id=p_fixture_run_id on conflict do nothing;
 insert into fixture_ops.internal_test_fixture_registry(entity_type,entity_id,fixture_suite,fixture_run_id)
 select 'allocation',a.id,p_fixture_suite,p_fixture_run_id from public.marketplace_payment_allocations a join fixture_ops.internal_test_fixture_registry r on r.entity_type='order'and r.entity_id=a.order_id where r.fixture_suite=p_fixture_suite and r.fixture_run_id=p_fixture_run_id on conflict do nothing;
 insert into fixture_ops.internal_test_fixture_registry(entity_type,entity_id,fixture_suite,fixture_run_id)
 select 'payment',p.id,p_fixture_suite,p_fixture_run_id from public.marketplace_payments p join fixture_ops.internal_test_fixture_registry r on r.entity_type='allocation'and r.entity_id in(select a.id from public.marketplace_payment_allocations a where a.payment_id=p.id) where r.fixture_suite=p_fixture_suite and r.fixture_run_id=p_fixture_run_id on conflict do nothing;
end$$;
revoke all on function fixture_ops.register_fixture_run_descendants(text,text)from public,anon,authenticated;

create or replace function fixture_ops.fixture_financial_exposure(p_fixture_suite text,p_fixture_run_id text)
returns jsonb language sql stable security definer set search_path=''as $$
with reg as(select entity_type,entity_id from fixture_ops.internal_test_fixture_registry where fixture_suite=p_fixture_suite and fixture_run_id=p_fixture_run_id),
 users as(select entity_id id from reg where entity_type='auth_user'),stores as(select entity_id id from reg where entity_type='store'),
 alloc as(select a.* from public.marketplace_payment_allocations a join stores s on s.id=a.store_id),
 funding as(select coalesce(sum(f.amount),0)n from public.financial_transactions f join users u on u.id=f.initiated_by where f.operation_type='marketplace_test_funding'and f.status='completed'),
 sweeps as(select coalesce(sum(c.amount),0)n from fixture_ops.fixture_financial_cleanup c where c.cleanup_type='fixture_account_sweep'and c.fixture_suite=p_fixture_suite and c.fixture_run_id=p_fixture_run_id),
 refunds as(select coalesce(sum(c.amount),0)n from fixture_ops.fixture_financial_cleanup c where c.cleanup_type='held_allocation_refund'and c.fixture_suite=p_fixture_suite and c.fixture_run_id=p_fixture_run_id),
 balances as(select coalesce(sum(greatest(l.balance,0)),0)n from public.ledger_accounts l join users u on u.id=l.owner_id where l.account_type='user'and l.currency='BDAG'),
 reservations as(select count(*)n from public.marketplace_inventory_reservations x join reg r on r.entity_type='reservation'and r.entity_id=x.id where x.status='active'),
 amounts as(select coalesce(sum(gross_amount)filter(where status='held'),0)escrow,count(*)filter(where status='held')unresolved,count(*)filter(where status='released')settled,coalesce(sum(platform_fee_amount)filter(where status='released'),0)fees,coalesce(sum(creator_commission_amount)filter(where status='released'),0)commissions,coalesce(sum(seller_net_amount-creator_commission_amount)filter(where status='released'),0)seller_net from alloc)
select jsonb_build_object('fixture_test_funding',funding.n,'fixture_user_spendable',balances.n,'fixture_attributable_escrow',amounts.escrow,'active_reservations',reservations.n,'unresolved_allocations',amounts.unresolved,'settled_allocations',amounts.settled,'platform_fees_returned',amounts.fees,'creator_commissions_released',amounts.commissions,'seller_net_released',amounts.seller_net,'escrow_refund_total',refunds.n,'account_sweep_total',sweeps.n,'net_platform_impact',funding.n-sweeps.n-amounts.fees)from funding,sweeps,refunds,balances,reservations,amounts
$$;
revoke all on function fixture_ops.fixture_financial_exposure(text,text)from public,anon,authenticated;

create or replace function fixture_ops.neutralize_marketplace_fixture_run(p_fixture_suite text,p_fixture_run_id text,p_project_ref text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record;o public.marketplace_orders;c record;acct record;escrow uuid;platform uuid;buyer_account uuid;tx uuid;state jsonb;v_balance numeric;v_debits numeric;v_credits numeric;
begin
 if coalesce(auth.role(),'')<>'service_role'then raise exception using errcode='42501',message='fixture_service_role_required';end if;
 if p_project_ref<>'aewwdlvbwpczqyvkwvvj'then raise exception using message='fixture_invalid_project';end if;
 if not exists(select 1 from fixture_ops.fixture_runs where fixture_suite=p_fixture_suite and fixture_run_id=p_fixture_run_id and project_ref=p_project_ref)then raise exception using message='fixture_run_not_found';end if;
 perform pg_advisory_xact_lock(hashtextextended('fixture-finalize:'||p_fixture_suite||':'||p_fixture_run_id,0));
 perform fixture_ops.register_fixture_run_descendants(p_fixture_suite,p_fixture_run_id);
 for c in select x.id checkout_id from public.marketplace_checkout_sessions x join fixture_ops.internal_test_fixture_registry r on r.entity_type='checkout'and r.entity_id=x.id and r.fixture_suite=p_fixture_suite and r.fixture_run_id=p_fixture_run_id where x.status='pending_payment'order by x.id for update of x loop
   perform public.marketplace_release_checkout(c.checkout_id,'cancelled','marketplace_fixture_cleanup',null);
 end loop;
 escrow:=public.ensure_marketplace_escrow_account();platform:=public.ensure_marketplace_platform_account();
 for a in select pa.* from public.marketplace_payment_allocations pa join fixture_ops.internal_test_fixture_registry r on r.entity_type='allocation'and r.entity_id=pa.id and r.fixture_suite=p_fixture_suite and r.fixture_run_id=p_fixture_run_id where pa.status='held'order by pa.id for update of pa loop
   select * into strict o from public.marketplace_orders where id=a.order_id for update;
   if not exists(select 1 from fixture_ops.internal_test_fixture_registry where entity_type='auth_user'and entity_id=o.buyer_id and fixture_suite=p_fixture_suite and fixture_run_id=p_fixture_run_id)then raise exception using message='fixture_cleanup_nonfixture_buyer';end if;
   if exists(select 1 from fixture_ops.fixture_financial_cleanup where cleanup_type='held_allocation_refund'and entity_id=a.id)then continue;end if;
   buyer_account:=public.ensure_ledger_account(o.buyer_id);perform 1 from public.ledger_accounts where id=any(array[escrow,buyer_account])order by id for update;
   select balance into v_balance from public.ledger_accounts where id=escrow and currency='BDAG'and not frozen;if v_balance is null or v_balance<a.gross_amount then raise exception using message='fixture_cleanup_escrow_insufficient';end if;
   tx:=gen_random_uuid();insert into public.financial_transactions(id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,reference_type,reference_id,idempotency_key,initiated_by)values(tx,escrow,buyer_account,'marketplace_fixture_escrow_refund',a.gross_amount,0,'BDAG','completed','marketplace_fixture_run',a.id::text,'fixture-refund:'||p_fixture_suite||':'||p_fixture_run_id||':'||a.id,o.buyer_id);
   perform public.ledger_debit(tx,escrow,a.gross_amount,'Fixture escrow refund',jsonb_build_object('fixture_suite',p_fixture_suite,'fixture_run_id',p_fixture_run_id,'allocation_id',a.id));perform public.ledger_credit(tx,buyer_account,a.gross_amount,'Fixture escrow refund',jsonb_build_object('fixture_suite',p_fixture_suite,'fixture_run_id',p_fixture_run_id,'allocation_id',a.id));
   insert into fixture_ops.fixture_financial_cleanup(cleanup_type,entity_id,financial_transaction_id,amount,fixture_suite,fixture_run_id)values('held_allocation_refund',a.id,tx,a.gross_amount,p_fixture_suite,p_fixture_run_id);
   perform set_config('app.marketplace_fixture_cleanup','on',true);update public.marketplace_payment_allocations set status='refunded',refunded_at=now()where id=a.id and status='held';update public.marketplace_orders set status='refunded',fulfillment_updated_at=now(),fulfillment_version=fulfillment_version+1 where id=o.id;
   insert into public.marketplace_order_events(order_id,checkout_id,buyer_id,seller_id,store_id,event_type,from_status,to_status,actor_id,actor_role,reason_code,idempotency_key,metadata)values(o.id,o.checkout_id,o.buyer_id,o.seller_id,o.store_id,'refund_created',o.status,'refunded',null,'system','marketplace_fixture_cleanup',tx,jsonb_build_object('fixture_suite',p_fixture_suite,'fixture_run_id',p_fixture_run_id));
 end loop;
 for acct in select l.* from public.ledger_accounts l join fixture_ops.internal_test_fixture_registry r on r.entity_type='auth_user'and r.entity_id=l.owner_id and r.fixture_suite=p_fixture_suite and r.fixture_run_id=p_fixture_run_id where l.account_type='user'and l.currency='BDAG'and l.balance>0 order by l.id for update of l loop
   if acct.frozen then raise exception using message='fixture_cleanup_account_frozen';end if;if exists(select 1 from fixture_ops.fixture_financial_cleanup where cleanup_type='fixture_account_sweep'and entity_id=acct.id)then continue;end if;
   perform 1 from public.ledger_accounts where id=platform for update;tx:=gen_random_uuid();
   insert into public.financial_transactions(id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,reference_type,reference_id,idempotency_key,initiated_by)values(tx,acct.id,platform,'marketplace_fixture_cleanup_sweep',acct.balance,0,'BDAG','completed','marketplace_fixture_run',acct.id::text,'fixture-sweep:'||p_fixture_suite||':'||p_fixture_run_id||':'||acct.id,acct.owner_id);
   perform public.ledger_debit(tx,acct.id,acct.balance,'Fixture account sweep',jsonb_build_object('fixture_suite',p_fixture_suite,'fixture_run_id',p_fixture_run_id));perform public.ledger_credit(tx,platform,acct.balance,'Fixture account sweep',jsonb_build_object('fixture_suite',p_fixture_suite,'fixture_run_id',p_fixture_run_id));
   insert into fixture_ops.fixture_financial_cleanup(cleanup_type,entity_id,financial_transaction_id,amount,fixture_suite,fixture_run_id)values('fixture_account_sweep',acct.id,tx,acct.balance,p_fixture_suite,p_fixture_run_id);
 end loop;
 state:=fixture_ops.fixture_financial_exposure(p_fixture_suite,p_fixture_run_id);
 select coalesce(sum(case when e.entry_type='debit'then e.amount else 0 end),0),coalesce(sum(case when e.entry_type='credit'then e.amount else 0 end),0)into v_debits,v_credits from public.ledger_entries e join fixture_ops.fixture_financial_cleanup c on c.financial_transaction_id=e.txn_id where c.fixture_suite=p_fixture_suite and c.fixture_run_id=p_fixture_run_id;
 if (state->>'fixture_user_spendable')::numeric<>0 or(state->>'fixture_attributable_escrow')::numeric<>0 or(state->>'active_reservations')::int<>0 or(state->>'unresolved_allocations')::int<>0 or(state->>'net_platform_impact')::numeric<>0 or v_debits<>v_credits then raise exception using message='fixture_run_neutralization_incomplete',detail=state::text;end if;
 return state||jsonb_build_object('cleanup_ledger_debits',v_debits,'cleanup_ledger_credits',v_credits);
end$$;
revoke all on function fixture_ops.neutralize_marketplace_fixture_run(text,text,text)from public,anon,authenticated;
grant execute on function fixture_ops.neutralize_marketplace_fixture_run(text,text,text)to service_role;

create or replace function public.finalize_marketplace_fixture_run(p_fixture_suite text,p_fixture_run_id text,p_project_ref text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare exposure jsonb;result jsonb;products_active int;stores_active int;sessions_live int;pins_active int;offers_active int;
begin
 if coalesce(auth.role(),'')<>'service_role'then raise exception using errcode='42501',message='fixture_service_role_required';end if;
 if p_project_ref<>'aewwdlvbwpczqyvkwvvj'then raise exception using message='fixture_invalid_project';end if;
 perform pg_advisory_xact_lock(hashtextextended('fixture-finalize:'||p_fixture_suite||':'||p_fixture_run_id,0));
 select finalization_result into result from fixture_ops.fixture_runs where fixture_suite=p_fixture_suite and fixture_run_id=p_fixture_run_id and project_ref=p_project_ref for update;if not found then raise exception using message='fixture_run_not_found';end if;if result is not null then return result;end if;
 update fixture_ops.fixture_runs set status='finalizing'where fixture_suite=p_fixture_suite and fixture_run_id=p_fixture_run_id;
 perform fixture_ops.register_fixture_run_descendants(p_fixture_suite,p_fixture_run_id);
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
 result:=jsonb_build_object('quarantined',true,'financial_neutralized',true,'fixture_run_id',p_fixture_run_id,'products_active',products_active,'stores_active',stores_active,'sessions_live',sessions_live,'pins_active',pins_active,'offers_active',offers_active,'fixture_user_spendable',(exposure->>'fixture_user_spendable')::numeric,'fixture_attributable_escrow',(exposure->>'fixture_attributable_escrow')::numeric,'active_reservations',(exposure->>'active_reservations')::int,'unresolved_allocations',(exposure->>'unresolved_allocations')::int,'net_platform_impact',(exposure->>'net_platform_impact')::numeric);
 update fixture_ops.fixture_runs set status='quarantined',cleaned_at=now(),finalization_result=result where fixture_suite=p_fixture_suite and fixture_run_id=p_fixture_run_id;return result;
end$$;
revoke all on function public.finalize_marketplace_fixture_run(text,text,text)from public,anon,authenticated;
grant execute on function public.finalize_marketplace_fixture_run(text,text,text)to service_role;

commit;
