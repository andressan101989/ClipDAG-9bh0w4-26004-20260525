begin;

create table fixture_ops.fixture_financial_cleanup (
  cleanup_type text not null check(cleanup_type in('held_allocation_refund','fixture_account_sweep')),
  entity_id uuid not null,
  financial_transaction_id uuid not null unique references public.financial_transactions(id),
  amount numeric(20,8) not null check(amount>0 and amount=round(amount,8)),
  created_at timestamptz not null default now(),
  primary key(cleanup_type,entity_id)
);
alter table fixture_ops.fixture_financial_cleanup enable row level security;
revoke all on fixture_ops.fixture_financial_cleanup from public,anon,authenticated;

create or replace function public.marketplace_allocation_release_guard()
returns trigger language plpgsql set search_path=public as $$
begin
  if current_setting('app.marketplace_settlement',true)='on'
    and old.status='held' and new.status='released'
    and(old.id,old.payment_id,old.checkout_id,old.order_id,old.seller_id,old.store_id,
        old.currency,old.gross_amount,old.platform_fee_amount,old.seller_net_amount,
        old.fee_bps,old.creator_user_id,old.creator_commission_amount)
       is not distinct from
       (new.id,new.payment_id,new.checkout_id,new.order_id,new.seller_id,new.store_id,
        new.currency,new.gross_amount,new.platform_fee_amount,new.seller_net_amount,
        new.fee_bps,new.creator_user_id,new.creator_commission_amount)
    and new.released_at is not null and new.refunded_at is null then return new;
  end if;
  if current_setting('app.marketplace_fixture_cleanup',true)='on'
    and old.status='held' and new.status='refunded'
    and(old.id,old.payment_id,old.checkout_id,old.order_id,old.seller_id,old.store_id,
        old.currency,old.gross_amount,old.platform_fee_amount,old.seller_net_amount,
        old.fee_bps,old.creator_user_id,old.creator_commission_amount)
       is not distinct from
       (new.id,new.payment_id,new.checkout_id,new.order_id,new.seller_id,new.store_id,
        new.currency,new.gross_amount,new.platform_fee_amount,new.seller_net_amount,
        new.fee_bps,new.creator_user_id,new.creator_commission_amount)
    and new.released_at is null and new.refunded_at is not null
    and fixture_ops.is_fixture('store',new.store_id) then return new;
  end if;
  raise exception using errcode='42501',message='marketplace_payment_snapshot_immutable';
end$$;

create or replace function fixture_ops.fixture_financial_exposure()
returns jsonb language sql stable security definer set search_path='' as $$
with fu as(select entity_id id from fixture_ops.internal_test_fixture_registry where entity_type='auth_user'),
 fs as(select entity_id id from fixture_ops.internal_test_fixture_registry where entity_type='store'),
 fa as(select a.* from public.marketplace_payment_allocations a join fs on fs.id=a.store_id),
 bal as(select la.balance from public.ledger_accounts la join fu on fu.id=la.owner_id where la.currency='BDAG'and la.account_type='user'),
 funding as(select coalesce(sum(f.amount),0)n from public.financial_transactions f join fu on fu.id=f.initiated_by where f.operation_type='marketplace_test_funding'and f.status='completed'),
 swept as(select coalesce(sum(f.amount),0)n,count(*)c from public.financial_transactions f where f.operation_type='marketplace_fixture_cleanup_sweep'and f.status='completed'),
 refunded as(select coalesce(sum(f.amount),0)n,count(*)c from public.financial_transactions f where f.operation_type='marketplace_fixture_escrow_refund'and f.status='completed'),
 held as(select coalesce(sum(gross_amount),0)n,count(*)c from fa where status='held'),
 fees as(select coalesce(sum(platform_fee_amount)filter(where status='released'),0)n from fa),
 spendable as(select coalesce(sum(balance)filter(where balance>0),0)n from bal)
select jsonb_build_object('fixture_test_funding',funding.n,'fixture_user_spendable',spendable.n,
 'fixture_attributable_escrow',held.n,'platform_fees_returned',fees.n,
 'escrow_refund_total',refunded.n,'escrow_refund_count',refunded.c,
 'fixture_sweep_total',swept.n,'fixture_sweep_count',swept.c,
 'net_platform_impact',funding.n-swept.n-fees.n,
 'unresolved_allocations',held.c)
from funding,swept,refunded,held,fees,spendable
$$;
revoke all on function fixture_ops.fixture_financial_exposure()from public,anon,authenticated;

create or replace function public.neutralize_marketplace_fixture_financials()
returns jsonb language plpgsql security definer set search_path=public as $$
declare a record;o record;account_row record;escrow uuid;platform uuid;buyer_account uuid;
 tx uuid;before_state jsonb;after_state jsonb;v_escrow numeric;v_now timestamptz:=now();
begin
 if coalesce(auth.role(),'')<>'service_role'then
   raise exception using errcode='42501',message='fixture_service_role_required';
 end if;
 before_state:=fixture_ops.fixture_financial_exposure();
 escrow:=public.ensure_marketplace_escrow_account();platform:=public.ensure_marketplace_platform_account();
 for a in select pa.* from public.marketplace_payment_allocations pa
   join fixture_ops.internal_test_fixture_registry r on r.entity_type='store'and r.entity_id=pa.store_id
   where pa.status='held'order by pa.id for update of pa loop
   select*into strict o from public.marketplace_orders where id=a.order_id for update;
   if not fixture_ops.is_fixture('auth_user',o.buyer_id)then
     raise exception using message='fixture_cleanup_nonfixture_buyer';
   end if;
   if exists(select 1 from fixture_ops.fixture_financial_cleanup where cleanup_type='held_allocation_refund'and entity_id=a.id)then
     raise exception using message='fixture_cleanup_state_mismatch';
   end if;
   buyer_account:=public.ensure_ledger_account(o.buyer_id);
   perform 1 from public.ledger_accounts where id=any(array[escrow,buyer_account])order by id for update;
   select balance into v_escrow from public.ledger_accounts where id=escrow and currency='BDAG'and not frozen;
   if v_escrow is null or v_escrow<a.gross_amount then raise exception using message='fixture_cleanup_escrow_insufficient';end if;
   tx:=gen_random_uuid();
   insert into public.financial_transactions(id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,reference_type,reference_id,idempotency_key,initiated_by)
   values(tx,escrow,buyer_account,'marketplace_fixture_escrow_refund',a.gross_amount,0,'BDAG','completed','marketplace_fixture_cleanup',a.id::text,'fixture-refund:'||a.id,o.buyer_id);
   perform public.ledger_debit(tx,escrow,a.gross_amount,'Fixture escrow refund',jsonb_build_object('fixture_cleanup',true,'allocation_id',a.id));
   perform public.ledger_credit(tx,buyer_account,a.gross_amount,'Fixture escrow refund',jsonb_build_object('fixture_cleanup',true,'allocation_id',a.id));
   insert into fixture_ops.fixture_financial_cleanup(cleanup_type,entity_id,financial_transaction_id,amount)values('held_allocation_refund',a.id,tx,a.gross_amount);
   perform set_config('app.marketplace_fixture_cleanup','on',true);
   update public.marketplace_payment_allocations set status='refunded',refunded_at=v_now where id=a.id and status='held';
   update public.marketplace_orders set status='refunded',fulfillment_updated_at=v_now,fulfillment_version=fulfillment_version+1 where id=o.id;
   insert into public.marketplace_order_events(order_id,checkout_id,buyer_id,seller_id,store_id,event_type,from_status,to_status,actor_id,actor_role,reason_code,idempotency_key,metadata,created_at)
   values(o.id,o.checkout_id,o.buyer_id,o.seller_id,o.store_id,'refund_created',o.status,'refunded',null,'system','marketplace_fixture_cleanup',tx,jsonb_build_object('fixture_cleanup',true,'allocation_id',a.id),v_now);
 end loop;
 for account_row in select la.* from public.ledger_accounts la
   join fixture_ops.internal_test_fixture_registry r on r.entity_type='auth_user'and r.entity_id=la.owner_id
   where la.account_type='user'and la.currency='BDAG'and la.balance>0 order by la.id for update of la loop
   if account_row.frozen then raise exception using message='fixture_cleanup_account_frozen';end if;
   if exists(select 1 from fixture_ops.fixture_financial_cleanup where cleanup_type='fixture_account_sweep'and entity_id=account_row.id)then
     raise exception using message='fixture_cleanup_state_mismatch';
   end if;
   perform 1 from public.ledger_accounts where id=platform for update;
   tx:=gen_random_uuid();
   insert into public.financial_transactions(id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,reference_type,reference_id,idempotency_key,initiated_by)
   values(tx,account_row.id,platform,'marketplace_fixture_cleanup_sweep',account_row.balance,0,'BDAG','completed','marketplace_fixture_cleanup',account_row.id::text,'fixture-sweep:'||account_row.id,account_row.owner_id);
   perform public.ledger_debit(tx,account_row.id,account_row.balance,'Fixture account sweep',jsonb_build_object('fixture_cleanup',true));
   perform public.ledger_credit(tx,platform,account_row.balance,'Fixture account sweep',jsonb_build_object('fixture_cleanup',true));
   insert into fixture_ops.fixture_financial_cleanup(cleanup_type,entity_id,financial_transaction_id,amount)values('fixture_account_sweep',account_row.id,tx,account_row.balance);
 end loop;
 after_state:=fixture_ops.fixture_financial_exposure();
 if (after_state->>'fixture_user_spendable')::numeric<>0 or(after_state->>'fixture_attributable_escrow')::numeric<>0 or(after_state->>'unresolved_allocations')::int<>0 or(after_state->>'net_platform_impact')::numeric<>0 then
   raise exception using message='fixture_cleanup_neutralization_incomplete',detail=after_state::text;
 end if;
 return jsonb_build_object('before',before_state,'after',after_state);
end$$;
revoke all on function public.neutralize_marketplace_fixture_financials()from public,anon,authenticated;
grant execute on function public.neutralize_marketplace_fixture_financials()to service_role;

create or replace function public.reconcile_marketplace_payments()
returns jsonb language sql security definer stable set search_path=public as $$
with paid_orders as(select o.id,o.status order_status,o.store_id,c.status checkout_status,p.status payment_status,a.status allocation_status
 from public.marketplace_checkout_sessions c join public.marketplace_orders o on o.checkout_id=c.id
 left join public.marketplace_payments p on p.checkout_id=c.id left join public.marketplace_payment_allocations a on a.order_id=o.id where c.status='paid'),
 classified as(select*,(order_status in('confirmed','processing','shipped','delivered')and allocation_status in('held','released'))or(order_status='refunded'and allocation_status='refunded'and fixture_ops.is_fixture('store',store_id))valid from paid_orders),
 state_counts as(select count(*)filter(where order_status='confirmed')confirmed,count(*)filter(where order_status='processing')processing,count(*)filter(where order_status='shipped')shipped,count(*)filter(where order_status='delivered')delivered,count(*)filter(where order_status='refunded'and valid)refunded_fixture,count(*)filter(where not valid)invalid from classified)
select jsonb_build_object(
 'paid_without_payment',(select count(*)from public.marketplace_checkout_sessions c left join public.marketplace_payments p on p.checkout_id=c.id where c.status='paid'and p.id is null),
 'payment_without_transaction',(select count(*)from public.marketplace_payments p left join public.financial_transactions f on f.id=p.financial_transaction_id where f.id is null),
 'unbalanced_transactions',(select count(*)from public.marketplace_payments p where(select coalesce(sum(case when entry_type='debit'then amount else-amount end),0)from public.ledger_entries where txn_id=p.financial_transaction_id)<>0),
 'allocation_mismatches',(select count(*)from public.marketplace_payments p where p.escrow_amount<>(select coalesce(sum(gross_amount),0)from public.marketplace_payment_allocations a where a.payment_id=p.id)),
 'paid_with_active_reservations',(select count(*)from public.marketplace_payments p join public.marketplace_inventory_reservations r on r.checkout_id=p.checkout_id where r.status='active'),
 'consumed_without_sale',(select count(*)from public.marketplace_inventory_reservations r left join public.marketplace_inventory_movements m on m.idempotency_key=r.id and m.movement_type='sale'where r.status='consumed'and m.id is null),
 'confirmed_state_mismatches',(select invalid from state_counts),
 'confirmed_state_breakdown',(select jsonb_build_object('confirmed',confirmed,'processing',processing,'shipped',shipped,'delivered',delivered,'refunded_fixture',refunded_fixture,'invalid',invalid)from state_counts),
 'invalid_confirmed_state_details',(select coalesce(jsonb_agg(jsonb_build_object('order_id',id,'checkout_status',checkout_status,'order_status',order_status,'payment_status',payment_status,'allocation_status',allocation_status)order by id),'[]'::jsonb)from classified where not valid),
 'invalid_inventory',(select count(*)from public.marketplace_inventory_levels where on_hand<0 or reserved<0 or reserved>on_hand),
 'escrow_shortfall',greatest((select coalesce(sum(gross_amount),0)from public.marketplace_payment_allocations where status='held')-(select coalesce(balance,0)from public.ledger_accounts where owner_id is null and account_type='marketplace_escrow'),0));
$$;
revoke all on function public.reconcile_marketplace_payments()from public,anon,authenticated;
grant execute on function public.reconcile_marketplace_payments()to service_role;

-- Business analytics exclude fixture-owned sessions, products, stores, buyers,
-- and orders. Reconciliation functions above continue to inspect all history.
create or replace function public.fetch_my_live_shop_stats(p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;begin
 if auth.uid()is null or not exists(select 1 from public.live_sessions l where l.id=p_session_id and l.host_id=auth.uid())then raise exception using errcode='42501',message='live_commerce_host_not_eligible';end if;
 select jsonb_build_object('orders_count',count(e.id),'gross_sales',coalesce(sum(e.gross_amount),0),'creator_commission_held',coalesce(sum(e.creator_commission_amount)filter(where a.status='held'),0),'creator_commission_released',coalesce(sum(e.creator_commission_amount)filter(where a.status='released'),0),'units_sold',coalesce(sum(e.quantity),0))into result
 from public.live_commerce_purchase_events e join public.marketplace_payment_allocations a on a.order_id=e.order_id
 where e.session_id=p_session_id and e.host_id=auth.uid()and not fixture_ops.is_fixture('live_session',e.session_id)and not fixture_ops.is_fixture('product',e.product_id)and not fixture_ops.is_fixture('auth_user',e.buyer_id)and not fixture_ops.is_fixture('store',a.store_id);
 return result;end$$;
revoke all on function public.fetch_my_live_shop_stats(uuid)from public,anon;
grant execute on function public.fetch_my_live_shop_stats(uuid)to authenticated,service_role;

create or replace function public.fetch_my_live_purchase_events(p_session_id uuid,p_limit integer default 50)
returns jsonb language sql stable security definer set search_path=public as $$
select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'buyer_display_name',e.buyer_display_name,'product_title',i.product_title,'quantity',e.quantity,'gross_amount',e.gross_amount,'creator_commission_amount',e.creator_commission_amount,'creator_commission_status',case when e.creator_commission_amount=0 then'none'when a.status='released'then'released'else'held'end,'created_at',e.created_at)order by e.created_at desc),'[]'::jsonb)
from(select*from public.live_commerce_purchase_events x where x.session_id=p_session_id and x.host_id=auth.uid()and not fixture_ops.is_fixture('live_session',x.session_id)and not fixture_ops.is_fixture('product',x.product_id)and not fixture_ops.is_fixture('auth_user',x.buyer_id)order by x.created_at desc limit least(greatest(coalesce(p_limit,50),1),100))e
join public.marketplace_order_items i on i.id=e.order_item_id join public.marketplace_payment_allocations a on a.order_id=e.order_id and not fixture_ops.is_fixture('store',a.store_id)
$$;
revoke all on function public.fetch_my_live_purchase_events(uuid,integer)from public,anon;
grant execute on function public.fetch_my_live_purchase_events(uuid,integer)to authenticated,service_role;

-- Execute once as the migration owner. The operation itself remains callable
-- only by service_role and is safe to retry.
select set_config('request.jwt.claim.role','service_role',true);
select public.neutralize_marketplace_fixture_financials();

commit;
