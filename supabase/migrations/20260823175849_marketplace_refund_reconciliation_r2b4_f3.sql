begin;

create or replace function public.reconcile_marketplace_payments()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
with canonical_dispute_refunds as (
  -- Held/pre-release refunds are canonical only when the immutable decision,
  -- completed escrow-to-buyer transfer, balanced ledger entries and event agree.
  select d.order_id, null::uuid as settlement_id
  from public.marketplace_order_disputes d
  join public.marketplace_dispute_decisions dd
    on dd.dispute_id=d.id and dd.order_id=d.order_id
  join public.marketplace_orders o on o.id=d.order_id
  join public.marketplace_payments p on p.checkout_id=o.checkout_id
  join public.marketplace_payment_allocations a
    on a.order_id=o.id and a.payment_id=p.id and a.checkout_id=o.checkout_id
  join public.financial_transactions ft
    on dd.financial_result->>'financial_transaction_id'=ft.id::text
  join public.ledger_accounts src on src.id=ft.from_account_id
  join public.ledger_accounts dst on dst.id=ft.to_account_id
  where d.status='resolved' and d.resolved_at is not null
    and (d.checkout_id,d.buyer_id,d.seller_id)
      is not distinct from(o.checkout_id,o.buyer_id,o.seller_id)
    and dd.outcome='refund_buyer'
    and dd.financial_result->'money_moved'='true'::jsonb
    and dd.financial_result->'refund_amount'=to_jsonb(a.gross_amount)
    and o.status='refunded' and p.status='refunded' and p.refunded_at is not null
    and a.status='refunded' and a.refunded_at is not null
    and (o.currency,p.currency,a.currency) is not distinct from('BDAG','BDAG','BDAG')
    and (o.total,p.gross_amount,p.escrow_amount,a.gross_amount)
      is not distinct from(a.gross_amount,a.gross_amount,a.gross_amount,a.gross_amount)
    and not exists(select 1 from public.marketplace_order_settlements s where s.order_id=o.id)
    and not exists(select 1 from public.marketplace_settlement_reversals r where r.order_id=o.id)
    and ft.operation_type='marketplace_dispute_refund'
    and ft.amount=a.gross_amount and ft.fee_amount=0 and ft.currency='BDAG'
    and ft.status='completed' and ft.reference_type='marketplace_order'
    and ft.reference_id=o.id::text and ft.initiated_by=dd.resolver_id
    and src.owner_id is null and src.account_type='marketplace_escrow' and src.currency='BDAG'
    and dst.owner_id=o.buyer_id and dst.account_type='user' and dst.currency='BDAG'
    and 2=(select count(*) from public.ledger_entries le where le.txn_id=ft.id)
    and a.gross_amount=(select coalesce(sum(le.amount),0) from public.ledger_entries le
      where le.txn_id=ft.id and le.entry_type='debit' and le.account_id=ft.from_account_id)
    and a.gross_amount=(select coalesce(sum(le.amount),0) from public.ledger_entries le
      where le.txn_id=ft.id and le.entry_type='credit' and le.account_id=ft.to_account_id)
    and exists(
      select 1 from public.marketplace_order_events ev
      where ev.order_id=o.id and ev.checkout_id=o.checkout_id
        and ev.buyer_id=o.buyer_id and ev.seller_id=o.seller_id and ev.store_id=o.store_id
        and ev.event_type='refund_created' and ev.to_status='refunded'
        and ev.actor_id=dd.resolver_id and ev.actor_role='admin'
        and ev.idempotency_key=dd.idempotency_key
        and ev.metadata->>'dispute_id'=d.id::text
        and ev.metadata->>'decision_id'=dd.id::text
        and ev.metadata->>'outcome'='refund_buyer'
    )

  union all

  -- Released/post-settlement refunds additionally require the canonical full
  -- reversal header, exact reversed legs and its completed buyer refund.
  select d.order_id, s.id
  from public.marketplace_order_disputes d
  join public.marketplace_dispute_decisions dd
    on dd.dispute_id=d.id and dd.order_id=d.order_id
  join public.marketplace_settlement_reversals r
    on r.dispute_id=d.id and r.order_id=d.order_id and r.resolver_id=dd.resolver_id
    and dd.financial_result->>'reversal_id'=r.id::text
    and dd.financial_result->>'buyer_refund_transaction_id'=r.buyer_refund_transaction_id::text
  join public.marketplace_order_settlements s on s.id=r.settlement_id and s.order_id=r.order_id
  join public.marketplace_orders o on o.id=r.order_id
  join public.marketplace_payments p on p.id=r.payment_id and p.checkout_id=r.checkout_id
  join public.marketplace_payment_allocations a
    on a.id=r.allocation_id and a.payment_id=p.id and a.order_id=o.id and a.checkout_id=o.checkout_id
  join public.financial_transactions ft on ft.id=r.buyer_refund_transaction_id
  join public.ledger_accounts src on src.id=ft.from_account_id
  join public.ledger_accounts dst on dst.id=ft.to_account_id
  where d.status='resolved' and d.resolved_at is not null
    and (d.checkout_id,d.buyer_id,d.seller_id)
      is not distinct from(o.checkout_id,o.buyer_id,o.seller_id)
    and dd.outcome='refund_buyer'
    and dd.financial_result->'money_moved'='true'::jsonb
    and dd.financial_result->'gross_refund_amount'=to_jsonb(r.gross_amount)
    and (r.payment_id,r.allocation_id,r.checkout_id,r.order_id,r.buyer_id)
      is not distinct from(s.payment_id,s.allocation_id,s.checkout_id,s.order_id,s.buyer_id)
    and s.status='completed' and s.released_at is not null and s.currency='BDAG'
    and o.status='refunded' and p.status='refunded' and p.refunded_at is not null
    and a.status='refunded' and a.refunded_at is not null
    and (o.currency,p.currency,a.currency,r.currency)
      is not distinct from('BDAG','BDAG','BDAG','BDAG')
    and (o.total,p.gross_amount,p.escrow_amount,a.gross_amount,s.gross_amount,r.gross_amount)
      is not distinct from(r.gross_amount,r.gross_amount,r.gross_amount,r.gross_amount,r.gross_amount,r.gross_amount)
    and ft.operation_type='marketplace_post_settlement_refund'
    and ft.amount=r.gross_amount and ft.fee_amount=0 and ft.currency='BDAG'
    and ft.status='completed' and ft.reference_type='marketplace_settlement_reversal'
    and ft.reference_id=r.id::text and ft.initiated_by=r.resolver_id
    and src.owner_id is null and src.account_type='marketplace_escrow' and src.currency='BDAG'
    and dst.owner_id=r.buyer_id and dst.account_type='user' and dst.currency='BDAG'
    and 2=(select count(*) from public.ledger_entries le where le.txn_id=ft.id)
    and r.gross_amount=(select coalesce(sum(le.amount),0) from public.ledger_entries le
      where le.txn_id=ft.id and le.entry_type='debit' and le.account_id=ft.from_account_id)
    and r.gross_amount=(select coalesce(sum(le.amount),0) from public.ledger_entries le
      where le.txn_id=ft.id and le.entry_type='credit' and le.account_id=ft.to_account_id)
    and r.gross_amount=(select coalesce(sum(rl.reversal_amount),0)
      from public.marketplace_settlement_reversal_legs rl where rl.reversal_id=r.id)
    and (select count(*) from public.marketplace_settlement_reversal_legs rl where rl.reversal_id=r.id)
      =(select count(*) from public.marketplace_settlement_legs sl
        where sl.settlement_id=s.id and sl.amount>0)
    and not exists(
      select 1
      from public.marketplace_settlement_reversal_legs rl
      join public.marketplace_settlement_legs sl on sl.id=rl.original_settlement_leg_id
      left join public.financial_transactions rft on rft.id=rl.reversal_financial_transaction_id
      where rl.reversal_id=r.id and(
        rl.settlement_id<>s.id or sl.settlement_id<>s.id
        or rl.leg_type<>sl.leg_type or rl.original_amount<>sl.amount
        or rl.reversal_amount<>sl.amount or rl.source_account_id<>sl.destination_account_id
        or rft.id is null or rft.status<>'completed' or rft.currency<>'BDAG'
        or rft.amount<>rl.reversal_amount or rft.from_account_id<>rl.source_account_id
        or rft.to_account_id<>rl.destination_account_id
      )
    )
    and exists(
      select 1 from public.marketplace_order_events ev
      where ev.order_id=o.id and ev.checkout_id=o.checkout_id
        and ev.buyer_id=o.buyer_id and ev.seller_id=o.seller_id and ev.store_id=o.store_id
        and ev.event_type='refund_created' and ev.to_status='refunded'
        and ev.actor_id=dd.resolver_id and ev.actor_role='admin'
        and ev.idempotency_key=dd.idempotency_key
        and ev.metadata->>'dispute_id'=d.id::text
        and ev.metadata->>'decision_id'=dd.id::text
        and ev.metadata->>'reversal_id'=r.id::text
        and ev.metadata->>'buyer_refund_transaction_id'=r.buyer_refund_transaction_id::text
    )
), canonical_return_refunds as (
  select rr.order_id, rr.settlement_id
  from public.marketplace_return_requests rr
  join public.marketplace_return_refunds rf on rf.return_request_id=rr.id
  join public.marketplace_return_refund_holds h
    on h.id=rf.hold_id and h.return_request_id=rr.id
  join public.marketplace_order_settlements s
    on s.id=rf.settlement_id and s.id=rr.settlement_id and s.id=h.settlement_id
  join public.marketplace_orders o on o.id=rr.order_id and o.id=rf.order_id and o.id=h.order_id
  join public.marketplace_payments p on p.id=rf.payment_id and p.id=h.payment_id and p.id=s.payment_id
  join public.marketplace_payment_allocations a
    on a.id=rf.allocation_id and a.id=h.allocation_id and a.id=s.allocation_id
  join public.financial_transactions ft on ft.id=rf.financial_transaction_id
  join public.ledger_accounts src on src.id=ft.from_account_id
  join public.ledger_accounts dst on dst.id=ft.to_account_id
  where rr.status='refunded' and rr.decided_at is not null
    and (rr.order_id,rr.checkout_id,rr.buyer_id,rr.seller_id,rr.store_id)
      is not distinct from(o.id,o.checkout_id,o.buyer_id,o.seller_id,o.store_id)
    and (rf.order_id,rf.payment_id,rf.allocation_id,rf.settlement_id,
         rf.buyer_id,rf.seller_id,rf.store_id)
      is not distinct from(o.id,p.id,a.id,s.id,o.buyer_id,o.seller_id,o.store_id)
    and (h.order_id,h.payment_id,h.allocation_id,h.checkout_id,h.settlement_id,
         h.buyer_id,h.seller_id,h.store_id)
      is not distinct from(o.id,p.id,a.id,o.checkout_id,s.id,o.buyer_id,o.seller_id,o.store_id)
    and (s.payment_id,s.allocation_id,s.checkout_id,s.order_id,s.buyer_id,s.seller_id,s.store_id)
      is not distinct from(p.id,a.id,o.checkout_id,o.id,o.buyer_id,o.seller_id,o.store_id)
    and s.status='completed' and s.released_at is not null
    and h.status='held' and h.held_at is not null
    and o.status='refunded' and p.status='refunded' and p.refunded_at is not null
    and a.status='refunded' and a.refunded_at is not null
    and rf.refunded_at is not null
    and (o.currency,p.currency,a.currency,s.currency,h.currency,rf.currency)
      is not distinct from('BDAG','BDAG','BDAG','BDAG','BDAG','BDAG')
    and (o.total,p.gross_amount,p.escrow_amount,a.gross_amount,s.gross_amount,h.gross_amount,rf.gross_amount)
      is not distinct from(rf.gross_amount,rf.gross_amount,rf.gross_amount,rf.gross_amount,
                           rf.gross_amount,rf.gross_amount,rf.gross_amount)
    and ft.operation_type='marketplace_return_refund'
    and ft.amount=rf.gross_amount and ft.fee_amount=0 and ft.currency='BDAG'
    and ft.status='completed' and ft.reference_type='marketplace_return_refund'
    and ft.reference_id=rf.id::text and ft.initiated_by=rr.seller_id
    and src.owner_id is null and src.account_type='marketplace_return_escrow' and src.currency='BDAG'
    and dst.owner_id=rr.buyer_id and dst.account_type='user' and dst.currency='BDAG'
    and 2=(select count(*) from public.ledger_entries le where le.txn_id=ft.id)
    and rf.gross_amount=(select coalesce(sum(le.amount),0) from public.ledger_entries le
      where le.txn_id=ft.id and le.entry_type='debit' and le.account_id=ft.from_account_id)
    and rf.gross_amount=(select coalesce(sum(le.amount),0) from public.ledger_entries le
      where le.txn_id=ft.id and le.entry_type='credit' and le.account_id=ft.to_account_id)
    and (
      (rf.resolution_mode='keep_item' and not exists(
        select 1 from public.marketplace_return_shipments rs where rs.return_request_id=rr.id
      ))
      or
      (rf.resolution_mode='returned_item' and exists(
        select 1 from public.marketplace_return_shipments rs
        where rs.return_request_id=rr.id and rs.order_id=o.id
          and (rs.buyer_id,rs.seller_id,rs.store_id)
            is not distinct from(o.buyer_id,o.seller_id,o.store_id)
          and rs.status='received' and rs.shipped_at is not null
          and rs.received_at is not null and rs.received_by=o.seller_id
          and rs.seller_receipt_idempotency_key is not null
          and rs.seller_receipt_fingerprint is not null
      ))
    )
    and exists(
      select 1 from public.marketplace_order_events ev
      where ev.order_id=o.id and ev.checkout_id=o.checkout_id
        and ev.buyer_id=o.buyer_id and ev.seller_id=o.seller_id and ev.store_id=o.store_id
        and ev.event_type='refund_created' and ev.to_status='refunded'
        and ev.actor_id=rr.seller_id and ev.actor_role='seller'
        and ev.idempotency_key=rf.idempotency_key
        and ev.metadata->>'return_request_id'=rr.id::text
        and ev.metadata->>'return_refund_id'=rf.id::text
        and ev.metadata->>'refund_hold_id'=h.id::text
        and ev.metadata->>'buyer_refund_transaction_id'=ft.id::text
        and ev.metadata->>'resolution_mode'=rf.resolution_mode
        and ev.metadata->'money_moved'='true'::jsonb
        and ev.metadata->'gross_refund_amount'=to_jsonb(rf.gross_amount)
    )
), paid_orders as (
  select o.id,o.status order_status,o.store_id,c.status checkout_status,
    p.status payment_status,a.status allocation_status
  from public.marketplace_checkout_sessions c
  join public.marketplace_orders o on o.checkout_id=c.id
  left join public.marketplace_payments p on p.checkout_id=c.id
  left join public.marketplace_payment_allocations a on a.order_id=o.id
  where c.status='paid'
), classified as (
  select po.*,
    case
      when po.order_status in('confirmed','processing','shipped','delivered')
        and po.allocation_status in('held','released') then 'normal'
      when po.order_status='refunded' and po.allocation_status='refunded'
        and fixture_ops.is_fixture('store',po.store_id) then 'refunded_fixture'
      when po.order_status='refunded' and po.payment_status='refunded'
        and po.allocation_status='refunded'
        and exists(select 1 from canonical_dispute_refunds x where x.order_id=po.id)
        then 'refunded_dispute'
      when po.order_status='refunded' and po.payment_status='refunded'
        and po.allocation_status='refunded'
        and exists(select 1 from canonical_return_refunds x where x.order_id=po.id)
        then 'refunded_return'
      else null
    end state_class
  from paid_orders po
), state_counts as (
  select
    count(*)filter(where order_status='confirmed') confirmed,
    count(*)filter(where order_status='processing') processing,
    count(*)filter(where order_status='shipped') shipped,
    count(*)filter(where order_status='delivered') delivered,
    count(*)filter(where state_class='refunded_fixture') refunded_fixture,
    count(*)filter(where state_class='refunded_dispute') refunded_dispute,
    count(*)filter(where state_class='refunded_return') refunded_return,
    count(*)filter(where state_class is null) invalid
  from classified
)
select jsonb_build_object(
  'paid_without_payment',(select count(*)from public.marketplace_checkout_sessions c left join public.marketplace_payments p on p.checkout_id=c.id where c.status='paid'and p.id is null),
  'payment_without_transaction',(select count(*)from public.marketplace_payments p left join public.financial_transactions f on f.id=p.financial_transaction_id where f.id is null),
  'unbalanced_transactions',(select count(*)from public.marketplace_payments p where(select coalesce(sum(case when entry_type='debit'then amount else-amount end),0)from public.ledger_entries where txn_id=p.financial_transaction_id)<>0),
  'allocation_mismatches',(select count(*)from public.marketplace_payments p where p.escrow_amount<>(select coalesce(sum(gross_amount),0)from public.marketplace_payment_allocations a where a.payment_id=p.id)),
  'paid_with_active_reservations',(select count(*)from public.marketplace_payments p join public.marketplace_inventory_reservations r on r.checkout_id=p.checkout_id where r.status='active'),
  'consumed_without_sale',(select count(*)from public.marketplace_inventory_reservations r left join public.marketplace_inventory_movements m on m.idempotency_key=r.id and m.movement_type='sale'where r.status='consumed'and m.id is null),
  'confirmed_state_mismatches',(select invalid from state_counts),
  'confirmed_state_breakdown',(select jsonb_build_object(
    'confirmed',confirmed,'processing',processing,'shipped',shipped,'delivered',delivered,
    'refunded_fixture',refunded_fixture,'refunded_dispute',refunded_dispute,
    'refunded_return',refunded_return,'invalid',invalid)from state_counts),
  'invalid_confirmed_state_details',(select coalesce(jsonb_agg(jsonb_build_object(
    'order_id',id,'checkout_status',checkout_status,'order_status',order_status,
    'payment_status',payment_status,'allocation_status',allocation_status)order by id),'[]'::jsonb)
    from classified where state_class is null),
  'invalid_inventory',(select count(*)from public.marketplace_inventory_levels where on_hand<0 or reserved<0 or reserved>on_hand),
  'escrow_shortfall',greatest((select coalesce(sum(gross_amount),0)from public.marketplace_payment_allocations where status='held')-(select coalesce(balance,0)from public.ledger_accounts where owner_id is null and account_type='marketplace_escrow'),0)
);
$$;

create or replace function public.reconcile_marketplace_settlements()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
with e as(
  select id,balance from public.ledger_accounts
  where owner_id is null and account_type='marketplace_escrow' and currency='BDAG'
),p as(
  select id from public.ledger_accounts
  where owner_id is null and account_type='platform' and currency='BDAG'
),h as(
  select coalesce(sum(gross_amount),0) n from public.marketplace_payment_allocations where status='held'
),x as(
  select coalesce(sum(balance),0) n from e
),sr as(
  select s.*,
    case when legacy.actor_id is not null then 'admin' else s.release_actor_role end
      effective_release_actor_role,
    case when legacy.actor_id is not null then legacy.actor_id else s.release_actor_id end
      effective_release_actor_id
  from public.marketplace_order_settlements s
  left join lateral(
    select aa.actor_id
    from public.marketplace_admin_action_audit aa
    join public.marketplace_order_disputes d
      on d.id=aa.target_id and d.order_id=s.order_id
    where s.release_actor_role='buyer'
      and aa.action='dispute_release_seller'
      and aa.target_type='dispute'
      and aa.metadata->>'result_kind'='post_reject_release'
      and aa.metadata->>'canonical_id'=s.id::text
      and coalesce((aa.metadata->>'money_moved')::boolean,false)=true
      and aa.actor_id=s.release_actor_id
    limit 1
  )legacy on true
),lt as(
  select l.*,s.order_id,s.buyer_id,s.seller_id,
    s.effective_release_actor_id,s.effective_release_actor_role,
    f.id tx,f.operation_type,f.amount tx_amount,f.currency tx_currency,f.status tx_status,
    f.reference_type,f.reference_id,f.from_account_id,f.to_account_id,f.initiated_by
  from public.marketplace_settlement_legs l
  join sr s on s.id=l.settlement_id
  left join public.financial_transactions f on f.id=l.financial_transaction_id
),canonical_dispute_refunds as(
  select r.settlement_id
  from public.marketplace_settlement_reversals r
  join public.marketplace_order_settlements s
    on s.id=r.settlement_id and s.payment_id=r.payment_id and s.allocation_id=r.allocation_id
    and s.checkout_id=r.checkout_id and s.order_id=r.order_id and s.buyer_id=r.buyer_id
  join public.marketplace_orders o on o.id=r.order_id
  join public.marketplace_payments m on m.id=r.payment_id and m.checkout_id=r.checkout_id
  join public.marketplace_payment_allocations a
    on a.id=r.allocation_id and a.payment_id=m.id and a.checkout_id=r.checkout_id and a.order_id=o.id
  join public.marketplace_order_disputes d on d.id=r.dispute_id and d.order_id=o.id
  join public.marketplace_dispute_decisions dd
    on dd.dispute_id=d.id and dd.order_id=o.id and dd.resolver_id=r.resolver_id
    and dd.financial_result->>'reversal_id'=r.id::text
    and dd.financial_result->>'buyer_refund_transaction_id'=r.buyer_refund_transaction_id::text
  join public.financial_transactions ft on ft.id=r.buyer_refund_transaction_id
  join public.ledger_accounts src on src.id=ft.from_account_id
  join public.ledger_accounts dst on dst.id=ft.to_account_id
  where s.status='completed' and s.released_at is not null
    and a.status='refunded' and a.refunded_at is not null
    and m.status='refunded' and m.refunded_at is not null and o.status='refunded'
    and d.status='resolved' and d.resolved_at is not null and dd.outcome='refund_buyer'
    and dd.financial_result->'money_moved'='true'::jsonb
    and dd.financial_result->'gross_refund_amount'=to_jsonb(r.gross_amount)
    and (d.checkout_id,d.buyer_id,d.seller_id)
      is not distinct from(o.checkout_id,o.buyer_id,o.seller_id)
    and (s.currency,m.currency,a.currency,o.currency,r.currency)
      is not distinct from('BDAG','BDAG','BDAG','BDAG','BDAG')
    and (s.gross_amount,m.gross_amount,m.escrow_amount,a.gross_amount,o.total,r.gross_amount)
      is not distinct from(r.gross_amount,r.gross_amount,r.gross_amount,r.gross_amount,r.gross_amount,r.gross_amount)
    and ft.operation_type='marketplace_post_settlement_refund'
    and ft.amount=r.gross_amount and ft.fee_amount=0 and ft.currency='BDAG'
    and ft.status='completed' and ft.reference_type='marketplace_settlement_reversal'
    and ft.reference_id=r.id::text and ft.initiated_by=r.resolver_id
    and src.owner_id is null and src.account_type='marketplace_escrow' and src.currency='BDAG'
    and dst.owner_id=r.buyer_id and dst.account_type='user' and dst.currency='BDAG'
    and 2=(select count(*) from public.ledger_entries le where le.txn_id=ft.id)
    and r.gross_amount=(select coalesce(sum(le.amount),0) from public.ledger_entries le
      where le.txn_id=ft.id and le.entry_type='debit' and le.account_id=ft.from_account_id)
    and r.gross_amount=(select coalesce(sum(le.amount),0) from public.ledger_entries le
      where le.txn_id=ft.id and le.entry_type='credit' and le.account_id=ft.to_account_id)
    and r.gross_amount=(select coalesce(sum(rl.reversal_amount),0)
      from public.marketplace_settlement_reversal_legs rl where rl.reversal_id=r.id)
    and (select count(*) from public.marketplace_settlement_reversal_legs rl where rl.reversal_id=r.id)
      =(select count(*) from public.marketplace_settlement_legs sl
        where sl.settlement_id=s.id and sl.amount>0)
    and not exists(
      select 1
      from public.marketplace_settlement_reversal_legs rl
      join public.marketplace_settlement_legs sl on sl.id=rl.original_settlement_leg_id
      left join public.financial_transactions rft on rft.id=rl.reversal_financial_transaction_id
      where rl.reversal_id=r.id and(
        rl.settlement_id<>s.id or sl.settlement_id<>s.id
        or rl.leg_type<>sl.leg_type or rl.original_amount<>sl.amount
        or rl.reversal_amount<>sl.amount or rl.source_account_id<>sl.destination_account_id
        or rft.id is null or rft.status<>'completed' or rft.currency<>'BDAG'
        or rft.amount<>rl.reversal_amount or rft.from_account_id<>rl.source_account_id
        or rft.to_account_id<>rl.destination_account_id
      )
    )
    and exists(
      select 1 from public.marketplace_order_events ev
      where ev.order_id=o.id and ev.checkout_id=o.checkout_id
        and ev.buyer_id=o.buyer_id and ev.seller_id=o.seller_id and ev.store_id=o.store_id
        and ev.event_type='refund_created' and ev.to_status='refunded'
        and ev.actor_id=dd.resolver_id and ev.actor_role='admin'
        and ev.idempotency_key=dd.idempotency_key
        and ev.metadata->>'dispute_id'=d.id::text
        and ev.metadata->>'decision_id'=dd.id::text
        and ev.metadata->>'reversal_id'=r.id::text
        and ev.metadata->>'buyer_refund_transaction_id'=r.buyer_refund_transaction_id::text
    )
),canonical_return_refunds as(
  select rf.settlement_id
  from public.marketplace_return_refunds rf
  join public.marketplace_return_requests rr on rr.id=rf.return_request_id
  join public.marketplace_return_refund_holds h
    on h.id=rf.hold_id and h.return_request_id=rr.id
  join public.marketplace_order_settlements s
    on s.id=rf.settlement_id and s.id=rr.settlement_id and s.id=h.settlement_id
  join public.marketplace_orders o on o.id=rr.order_id and o.id=rf.order_id and o.id=h.order_id
  join public.marketplace_payments m on m.id=rf.payment_id and m.id=h.payment_id and m.id=s.payment_id
  join public.marketplace_payment_allocations a
    on a.id=rf.allocation_id and a.id=h.allocation_id and a.id=s.allocation_id
  join public.financial_transactions ft on ft.id=rf.financial_transaction_id
  join public.ledger_accounts src on src.id=ft.from_account_id
  join public.ledger_accounts dst on dst.id=ft.to_account_id
  where rr.status='refunded' and rr.decided_at is not null
    and (rr.order_id,rr.checkout_id,rr.buyer_id,rr.seller_id,rr.store_id)
      is not distinct from(o.id,o.checkout_id,o.buyer_id,o.seller_id,o.store_id)
    and (rf.order_id,rf.payment_id,rf.allocation_id,rf.settlement_id,
         rf.buyer_id,rf.seller_id,rf.store_id)
      is not distinct from(o.id,m.id,a.id,s.id,o.buyer_id,o.seller_id,o.store_id)
    and (h.order_id,h.payment_id,h.allocation_id,h.checkout_id,h.settlement_id,
         h.buyer_id,h.seller_id,h.store_id)
      is not distinct from(o.id,m.id,a.id,o.checkout_id,s.id,o.buyer_id,o.seller_id,o.store_id)
    and s.status='completed' and s.released_at is not null
    and h.status='held' and h.held_at is not null
    and o.status='refunded' and m.status='refunded' and m.refunded_at is not null
    and a.status='refunded' and a.refunded_at is not null and rf.refunded_at is not null
    and (o.currency,m.currency,a.currency,s.currency,h.currency,rf.currency)
      is not distinct from('BDAG','BDAG','BDAG','BDAG','BDAG','BDAG')
    and (o.total,m.gross_amount,m.escrow_amount,a.gross_amount,s.gross_amount,h.gross_amount,rf.gross_amount)
      is not distinct from(rf.gross_amount,rf.gross_amount,rf.gross_amount,rf.gross_amount,
                           rf.gross_amount,rf.gross_amount,rf.gross_amount)
    and ft.operation_type='marketplace_return_refund'
    and ft.amount=rf.gross_amount and ft.fee_amount=0 and ft.currency='BDAG'
    and ft.status='completed' and ft.reference_type='marketplace_return_refund'
    and ft.reference_id=rf.id::text and ft.initiated_by=rr.seller_id
    and src.owner_id is null and src.account_type='marketplace_return_escrow' and src.currency='BDAG'
    and dst.owner_id=rr.buyer_id and dst.account_type='user' and dst.currency='BDAG'
    and 2=(select count(*) from public.ledger_entries le where le.txn_id=ft.id)
    and rf.gross_amount=(select coalesce(sum(le.amount),0) from public.ledger_entries le
      where le.txn_id=ft.id and le.entry_type='debit' and le.account_id=ft.from_account_id)
    and rf.gross_amount=(select coalesce(sum(le.amount),0) from public.ledger_entries le
      where le.txn_id=ft.id and le.entry_type='credit' and le.account_id=ft.to_account_id)
    and (
      (rf.resolution_mode='keep_item' and not exists(
        select 1 from public.marketplace_return_shipments rs where rs.return_request_id=rr.id
      ))
      or
      (rf.resolution_mode='returned_item' and exists(
        select 1 from public.marketplace_return_shipments rs
        where rs.return_request_id=rr.id and rs.order_id=o.id
          and (rs.buyer_id,rs.seller_id,rs.store_id)
            is not distinct from(o.buyer_id,o.seller_id,o.store_id)
          and rs.status='received' and rs.shipped_at is not null
          and rs.received_at is not null and rs.received_by=o.seller_id
          and rs.seller_receipt_idempotency_key is not null
          and rs.seller_receipt_fingerprint is not null
      ))
    )
    and exists(
      select 1 from public.marketplace_order_events ev
      where ev.order_id=o.id and ev.checkout_id=o.checkout_id
        and ev.buyer_id=o.buyer_id and ev.seller_id=o.seller_id and ev.store_id=o.store_id
        and ev.event_type='refund_created' and ev.to_status='refunded'
        and ev.actor_id=rr.seller_id and ev.actor_role='seller'
        and ev.idempotency_key=rf.idempotency_key
        and ev.metadata->>'return_request_id'=rr.id::text
        and ev.metadata->>'return_refund_id'=rf.id::text
        and ev.metadata->>'refund_hold_id'=h.id::text
        and ev.metadata->>'buyer_refund_transaction_id'=ft.id::text
        and ev.metadata->>'resolution_mode'=rf.resolution_mode
        and ev.metadata->'money_moved'='true'::jsonb
        and ev.metadata->'gross_refund_amount'=to_jsonb(rf.gross_amount)
    )
),settlement_refund_classification as(
  select s.id,
    exists(select 1 from canonical_return_refunds x where x.settlement_id=s.id) refunded_after_return,
    exists(select 1 from canonical_dispute_refunds x where x.settlement_id=s.id) refunded_after_dispute
  from public.marketplace_order_settlements s
)
select jsonb_build_object(
  'released_without_settlement',(select count(*) from public.marketplace_payment_allocations a left join public.marketplace_order_settlements s on s.allocation_id=a.id where a.status='released' and s.id is null),
  'settlement_without_release',(select count(*) from public.marketplace_order_settlements s join public.marketplace_payment_allocations a on a.id=s.allocation_id left join settlement_refund_classification c on c.id=s.id where a.status is distinct from 'released' and not coalesce(c.refunded_after_return or c.refunded_after_dispute,false)),
  'refunded_settlement_breakdown',(select jsonb_build_object(
    'refunded_after_return',count(*)filter(where refunded_after_return),
    'refunded_after_dispute',count(*)filter(where refunded_after_dispute))
    from settlement_refund_classification),
  'delivered_with_held_allocation',(select count(*) from public.marketplace_orders o join public.marketplace_payment_allocations a on a.order_id=o.id where o.status='delivered' and a.status='held'),
  'released_order_not_delivered',(select count(*) from public.marketplace_payment_allocations a left join sr s on s.allocation_id=a.id join public.marketplace_orders o on o.id=a.order_id where a.status='released' and(s.id is null or(s.effective_release_actor_role='buyer'and o.status is distinct from 'delivered')or(s.effective_release_actor_role='admin'and o.status not in('shipped','delivered')))),
  'released_shipment_not_delivered',(select count(*) from public.marketplace_payment_allocations a left join sr s on s.allocation_id=a.id left join public.marketplace_order_shipments sh on sh.order_id=a.order_id where a.status='released' and(s.id is null or(s.effective_release_actor_role='buyer'and(sh.id is null or sh.status is distinct from 'delivered' or sh.delivered_at is null))or(s.effective_release_actor_role='admin'and(sh.id is null or sh.status not in('shipped','delivered'))))),
  'delivery_timestamp_mismatch',(select count(*) from sr s join public.marketplace_orders o on o.id=s.order_id left join public.marketplace_order_shipments sh on sh.order_id=o.id where s.effective_release_actor_role='buyer'and(sh.id is null or o.delivered_at is null or sh.delivered_at is null or o.delivered_at is distinct from sh.delivered_at or s.confirmed_at is distinct from o.delivered_at)),
  'settlement_amount_mismatch',(select count(*) from public.marketplace_order_settlements s join public.marketplace_payment_allocations a on a.id=s.allocation_id where(s.currency,s.gross_amount,s.seller_net_amount,s.platform_fee_amount)is distinct from(a.currency,a.gross_amount,a.seller_net_amount,a.platform_fee_amount)),
  'settlement_leg_sum_mismatch',(select count(*) from public.marketplace_order_settlements s where s.gross_amount is distinct from(select coalesce(sum(amount),0) from public.marketplace_settlement_legs l where l.settlement_id=s.id and l.status='completed')),
  'missing_seller_leg',(select count(*) from public.marketplace_order_settlements s where not exists(select 1 from public.marketplace_settlement_legs l where l.settlement_id=s.id and l.leg_type='seller_net')),
  'missing_platform_leg',(select count(*) from public.marketplace_order_settlements s where not exists(select 1 from public.marketplace_settlement_legs l where l.settlement_id=s.id and l.leg_type='platform_fee')),
  'duplicate_seller_leg',(select count(*) from(select settlement_id from public.marketplace_settlement_legs where leg_type='seller_net' group by 1 having count(*)>1)q),
  'duplicate_platform_leg',(select count(*) from(select settlement_id from public.marketplace_settlement_legs where leg_type='platform_fee' group by 1 having count(*)>1)q),
  'positive_leg_without_transaction',(select count(*) from lt where amount>0 and tx is null),
  'transaction_amount_mismatch',(select count(*) from lt where amount>0 and tx is not null and tx_amount is distinct from amount),
  'transaction_currency_mismatch',(select count(*) from lt where amount>0 and tx is not null and tx_currency is distinct from 'BDAG'),
  'transaction_status_mismatch',(select count(*) from lt where amount>0 and tx is not null and tx_status is distinct from 'completed'),
  'transaction_operation_type_mismatch',(select count(*) from lt where amount>0 and tx is not null and operation_type is distinct from case leg_type when'seller_net'then'marketplace_seller_settlement'when'platform_fee'then'marketplace_platform_fee_settlement'else operation_type end),
  'transaction_reference_mismatch',(select count(*) from lt where amount>0 and tx is not null and(reference_type is distinct from'marketplace_order'or reference_id is distinct from order_id::text or initiated_by is distinct from case effective_release_actor_role when'buyer'then buyer_id when'admin'then effective_release_actor_id end)),
  'transaction_source_account_mismatch',(select count(*) from lt where amount>0 and tx is not null and not exists(select 1 from e where e.id is not distinct from from_account_id)),
  'transaction_destination_account_mismatch',(select count(*) from lt where amount>0 and tx is not null and((leg_type='seller_net'and not exists(select 1 from public.ledger_accounts a where a.id is not distinct from to_account_id and a.owner_id is not distinct from seller_id and a.account_type='user'and a.currency='BDAG'))or(leg_type='platform_fee'and not exists(select 1 from p where p.id is not distinct from to_account_id)))),
  'seller_beneficiary_mismatch',(select count(*) from lt where leg_type='seller_net'and beneficiary_user_id is distinct from seller_id),
  'platform_beneficiary_mismatch',(select count(*) from lt where leg_type='platform_fee'and beneficiary_user_id is not null),
  'settlement_order_identity_mismatch',(select count(*) from public.marketplace_order_settlements s join public.marketplace_orders o on o.id=s.order_id where(s.checkout_id,s.buyer_id,s.seller_id,s.store_id,s.currency,s.gross_amount)is distinct from(o.checkout_id,o.buyer_id,o.seller_id,o.store_id,o.currency,o.total)),
  'settlement_payment_identity_mismatch',(select count(*) from public.marketplace_order_settlements s join public.marketplace_payments m on m.id=s.payment_id where(s.checkout_id,s.buyer_id,s.currency)is distinct from(m.checkout_id,m.buyer_id,m.currency)),
  'settlement_allocation_identity_mismatch',(select count(*) from public.marketplace_order_settlements s join public.marketplace_payment_allocations a on a.id=s.allocation_id where(s.payment_id,s.checkout_id,s.order_id,s.seller_id,s.store_id,s.currency)is distinct from(a.payment_id,a.checkout_id,a.order_id,a.seller_id,a.store_id,a.currency)),
  'escrow_expected_held_total',(select n from h),
  'escrow_actual_balance',(select n from x),
  'escrow_difference',(select x.n-h.n from x,h),
  'escrow_shortage',(select greatest(h.n-x.n,0)from x,h),
  'escrow_surplus',(select greatest(x.n-h.n,0)from x,h)
);
$$;

-- The new refund breakdown is operational context, not a corruption counter.
create or replace function public.marketplace_admin_health_failure_count(
  p_group text,
  p_value jsonb
)
returns integer
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare v_count integer:=0;v_key text;v_child jsonb;
begin
 if jsonb_typeof(p_value)='object'then
  for v_key,v_child in select key,value from jsonb_each(p_value)loop
   if(p_group='payments'and v_key='confirmed_state_breakdown')
     or(p_group='settlements'and v_key in(
       'escrow_expected_held_total','escrow_actual_balance','refunded_settlement_breakdown'
     ))then continue;end if;
   v_count:=v_count+public.marketplace_admin_health_failure_count(p_group,v_child);
  end loop;
 elsif jsonb_typeof(p_value)='array'then
  v_count:=jsonb_array_length(p_value);
 elsif jsonb_typeof(p_value)='number'then
  v_count:=greatest((p_value#>>'{}')::numeric,0)::integer;
 end if;
 return v_count;
end;
$$;

revoke all on function public.reconcile_marketplace_payments()
  from public, anon, authenticated;
revoke all on function public.reconcile_marketplace_settlements()
  from public, anon, authenticated;
revoke all on function public.marketplace_admin_health_failure_count(text,jsonb)
  from public, anon, authenticated, service_role;

grant execute on function public.reconcile_marketplace_payments()
  to service_role;
grant execute on function public.reconcile_marketplace_settlements()
  to service_role;
grant execute on function public.marketplace_admin_health_failure_count(text,jsonb)
  to service_role;

comment on function public.reconcile_marketplace_payments() is
  'Read-only Marketplace payment integrity counters. Canonical fixture, dispute and return refunds are observed separately; arbitrary refunded states remain failures.';
comment on function public.reconcile_marketplace_settlements() is
  'Read-only Marketplace settlement integrity counters. Released allocations later refunded through canonical return or post-settlement dispute evidence are observed separately.';
comment on function public.marketplace_admin_health_failure_count(text,jsonb) is
  'Counts true Marketplace health failures while excluding named observational breakdowns and settlement escrow balance observations.';

notify pgrst, 'reload schema';

commit;
