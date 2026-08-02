begin;

create or replace function public.reconcile_marketplace_payments()
returns jsonb
language sql
security definer
stable
set search_path=public
as $$
  with paid_orders as (
    select o.id,o.status order_status,c.status checkout_status,
      p.status payment_status,a.status allocation_status
    from public.marketplace_checkout_sessions c
    join public.marketplace_orders o on o.checkout_id=c.id
    left join public.marketplace_payments p on p.checkout_id=c.id
    left join public.marketplace_payment_allocations a on a.order_id=o.id
    where c.status='paid'
  ), state_counts as (
    select
      count(*) filter(where order_status='confirmed') confirmed,
      count(*) filter(where order_status='processing') processing,
      count(*) filter(where order_status='shipped') shipped,
      count(*) filter(where order_status='delivered') delivered,
      count(*) filter(where order_status not in ('confirmed','processing','shipped','delivered')) invalid
    from paid_orders
  )
  select jsonb_build_object(
   'paid_without_payment',(select count(*) from public.marketplace_checkout_sessions c left join public.marketplace_payments p on p.checkout_id=c.id where c.status='paid' and p.id is null),
   'payment_without_transaction',(select count(*) from public.marketplace_payments p left join public.financial_transactions f on f.id=p.financial_transaction_id where f.id is null),
   'unbalanced_transactions',(select count(*) from public.marketplace_payments p where (select coalesce(sum(case when entry_type='debit' then amount else -amount end),0) from public.ledger_entries where txn_id=p.financial_transaction_id)<>0),
   'allocation_mismatches',(select count(*) from public.marketplace_payments p where p.escrow_amount<>(select coalesce(sum(gross_amount),0) from public.marketplace_payment_allocations a where a.payment_id=p.id)),
   'paid_with_active_reservations',(select count(*) from public.marketplace_payments p join public.marketplace_inventory_reservations r on r.checkout_id=p.checkout_id where r.status='active'),
   'consumed_without_sale',(select count(*) from public.marketplace_inventory_reservations r left join public.marketplace_inventory_movements m on m.idempotency_key=r.id and m.movement_type='sale' where r.status='consumed' and m.id is null),
   'confirmed_state_mismatches',(select invalid from state_counts),
   'confirmed_state_breakdown',(select jsonb_build_object('confirmed',confirmed,'processing',processing,'shipped',shipped,'delivered',delivered,'invalid',invalid) from state_counts),
   'invalid_confirmed_state_details',(select coalesce(jsonb_agg(jsonb_build_object('order_id',id,'checkout_status',checkout_status,'order_status',order_status,'payment_status',payment_status,'allocation_status',allocation_status) order by id),'[]'::jsonb) from paid_orders where order_status not in ('confirmed','processing','shipped','delivered')),
   'invalid_inventory',(select count(*) from public.marketplace_inventory_levels where on_hand<0 or reserved<0 or reserved>on_hand),
   'escrow_shortfall',greatest((select coalesce(sum(gross_amount),0) from public.marketplace_payment_allocations where status='held')-(select coalesce(balance,0) from public.ledger_accounts where owner_id is null and account_type='marketplace_escrow'),0)
  );
$$;

revoke all on function public.reconcile_marketplace_payments() from public,anon,authenticated;
grant execute on function public.reconcile_marketplace_payments() to service_role;

commit;
