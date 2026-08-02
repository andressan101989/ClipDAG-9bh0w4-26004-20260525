begin;

create or replace function public.reconcile_marketplace_settlements()
returns jsonb
language sql
stable
security definer
set search_path=public
as $$
with
escrow as (
  select id, balance from public.ledger_accounts
  where owner_id is null and account_type='marketplace_escrow' and currency='BDAG'
),
platform as (
  select id from public.ledger_accounts
  where owner_id is null and account_type='platform' and currency='BDAG'
),
held as (
  select coalesce(sum(gross_amount),0)::numeric(20,8) total
  from public.marketplace_payment_allocations where status='held'
),
actual as (
  select coalesce(sum(balance),0)::numeric(20,8) total from escrow
),
leg_tx as (
  select l.*,s.order_id,s.buyer_id,s.seller_id,
         f.id transaction_id,f.operation_type,f.amount transaction_amount,
         f.currency transaction_currency,f.status transaction_status,
         f.reference_type,f.reference_id,f.from_account_id,f.to_account_id,f.initiated_by
  from public.marketplace_settlement_legs l
  join public.marketplace_order_settlements s on s.id=l.settlement_id
  left join public.financial_transactions f on f.id=l.financial_transaction_id
)
select jsonb_build_object(
 'released_without_settlement',(select count(*) from public.marketplace_payment_allocations a left join public.marketplace_order_settlements s on s.allocation_id=a.id where a.status='released' and s.id is null),
 'settlement_without_release',(select count(*) from public.marketplace_order_settlements s join public.marketplace_payment_allocations a on a.id=s.allocation_id where a.status<>'released'),
 'delivered_with_held_allocation',(select count(*) from public.marketplace_orders o join public.marketplace_payment_allocations a on a.order_id=o.id where o.status='delivered' and a.status='held'),
 'released_order_not_delivered',(select count(*) from public.marketplace_payment_allocations a join public.marketplace_orders o on o.id=a.order_id where a.status='released' and o.status<>'delivered'),
 'released_shipment_not_delivered',(select count(*) from public.marketplace_payment_allocations a join public.marketplace_order_shipments sh on sh.order_id=a.order_id where a.status='released' and sh.status<>'delivered'),
 'delivery_timestamp_mismatch',(select count(*) from public.marketplace_order_settlements s join public.marketplace_orders o on o.id=s.order_id join public.marketplace_order_shipments sh on sh.order_id=o.id where o.delivered_at is null or sh.delivered_at is null or o.delivered_at<>sh.delivered_at or s.confirmed_at<>o.delivered_at),
 'settlement_amount_mismatch',(select count(*) from public.marketplace_order_settlements s join public.marketplace_payment_allocations a on a.id=s.allocation_id where (s.currency,s.gross_amount,s.seller_net_amount,s.platform_fee_amount) is distinct from (a.currency,a.gross_amount,a.seller_net_amount,a.platform_fee_amount)),
 'settlement_leg_sum_mismatch',(select count(*) from public.marketplace_order_settlements s where s.gross_amount<>(select coalesce(sum(l.amount),0) from public.marketplace_settlement_legs l where l.settlement_id=s.id and l.status='completed')),
 'missing_seller_leg',(select count(*) from public.marketplace_order_settlements s where not exists(select 1 from public.marketplace_settlement_legs l where l.settlement_id=s.id and l.leg_type='seller_net')),
 'missing_platform_leg',(select count(*) from public.marketplace_order_settlements s where not exists(select 1 from public.marketplace_settlement_legs l where l.settlement_id=s.id and l.leg_type='platform_fee')),
 'duplicate_seller_leg',(select count(*) from (select settlement_id from public.marketplace_settlement_legs where leg_type='seller_net' group by settlement_id having count(*)>1)x),
 'duplicate_platform_leg',(select count(*) from (select settlement_id from public.marketplace_settlement_legs where leg_type='platform_fee' group by settlement_id having count(*)>1)x),
 'positive_leg_without_transaction',(select count(*) from leg_tx where amount>0 and transaction_id is null),
 'transaction_amount_mismatch',(select count(*) from leg_tx where amount>0 and transaction_id is not null and transaction_amount<>amount),
 'transaction_currency_mismatch',(select count(*) from leg_tx where amount>0 and transaction_id is not null and transaction_currency<>'BDAG'),
 'transaction_status_mismatch',(select count(*) from leg_tx where amount>0 and transaction_id is not null and transaction_status<>'completed'),
 'transaction_operation_type_mismatch',(select count(*) from leg_tx where amount>0 and transaction_id is not null and operation_type<>case leg_type when 'seller_net' then 'marketplace_seller_settlement' when 'platform_fee' then 'marketplace_platform_fee_settlement' else operation_type end),
 'transaction_reference_mismatch',(select count(*) from leg_tx where amount>0 and transaction_id is not null and (reference_type<>'marketplace_order' or reference_id<>order_id::text or initiated_by<>buyer_id)),
 'transaction_source_account_mismatch',(select count(*) from leg_tx where amount>0 and transaction_id is not null and not exists(select 1 from escrow e where e.id=from_account_id)),
 'transaction_destination_account_mismatch',(select count(*) from leg_tx where amount>0 and transaction_id is not null and ((leg_type='seller_net' and not exists(select 1 from public.ledger_accounts a where a.id=to_account_id and a.owner_id=seller_id and a.account_type='user' and a.currency='BDAG')) or (leg_type='platform_fee' and not exists(select 1 from platform p where p.id=to_account_id)))),
 'seller_beneficiary_mismatch',(select count(*) from leg_tx where leg_type='seller_net' and beneficiary_user_id is distinct from seller_id),
 'platform_beneficiary_mismatch',(select count(*) from leg_tx where leg_type='platform_fee' and beneficiary_user_id is not null),
 'settlement_order_identity_mismatch',(select count(*) from public.marketplace_order_settlements s join public.marketplace_orders o on o.id=s.order_id where (s.checkout_id,s.buyer_id,s.seller_id,s.store_id,s.currency,s.gross_amount) is distinct from (o.checkout_id,o.buyer_id,o.seller_id,o.store_id,o.currency,o.total)),
 'settlement_payment_identity_mismatch',(select count(*) from public.marketplace_order_settlements s join public.marketplace_payments p on p.id=s.payment_id where s.checkout_id<>p.checkout_id or s.buyer_id<>p.buyer_id or s.currency<>p.currency),
 'settlement_allocation_identity_mismatch',(select count(*) from public.marketplace_order_settlements s join public.marketplace_payment_allocations a on a.id=s.allocation_id where (s.payment_id,s.checkout_id,s.order_id,s.seller_id,s.store_id,s.currency) is distinct from (a.payment_id,a.checkout_id,a.order_id,a.seller_id,a.store_id,a.currency)),
 'escrow_expected_held_total',(select total from held),
 'escrow_actual_balance',(select total from actual),
 'escrow_difference',(select actual.total-held.total from actual,held),
 'escrow_shortage',(select greatest(held.total-actual.total,0) from actual,held),
 'escrow_surplus',(select greatest(actual.total-held.total,0) from actual,held)
);
$$;

revoke all on function public.reconcile_marketplace_settlements() from public,anon,authenticated;
grant execute on function public.reconcile_marketplace_settlements() to service_role;

commit;
