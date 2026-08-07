begin;

create table public.marketplace_dispute_decisions (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null unique references public.marketplace_order_disputes(id),
  order_id uuid not null references public.marketplace_orders(id),
  resolver_id uuid not null references auth.users(id),
  outcome text not null check(outcome in('refund_buyer','release_seller','reject_claim','manual_review')),
  reason_code text not null check(reason_code=btrim(reason_code) and char_length(reason_code) between 2 and 100),
  note text check(note is null or(note=btrim(note)and char_length(note)between 1 and 1000)),
  idempotency_key uuid not null,
  financial_result jsonb not null default '{}'::jsonb check(jsonb_typeof(financial_result)='object'),
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(resolver_id,idempotency_key)
);

alter table public.marketplace_dispute_decisions enable row level security;
revoke all on public.marketplace_dispute_decisions from public,anon,authenticated;
grant all on public.marketplace_dispute_decisions to service_role;

create or replace function public.marketplace_reject_dispute_decision_mutation()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception using errcode='42501',message='marketplace_dispute_decision_immutable';
end$$;
create trigger marketplace_dispute_decisions_immutable
before update or delete on public.marketplace_dispute_decisions
for each row execute function public.marketplace_reject_dispute_decision_mutation();

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
  if current_setting('app.marketplace_dispute_refund',true)='on'
    and old.status='held' and new.status='refunded'
    and(old.id,old.payment_id,old.checkout_id,old.order_id,old.seller_id,old.store_id,
        old.currency,old.gross_amount,old.platform_fee_amount,old.seller_net_amount,
        old.fee_bps,old.creator_user_id,old.creator_commission_amount)
       is not distinct from
       (new.id,new.payment_id,new.checkout_id,new.order_id,new.seller_id,new.store_id,
        new.currency,new.gross_amount,new.platform_fee_amount,new.seller_net_amount,
        new.fee_bps,new.creator_user_id,new.creator_commission_amount)
    and new.released_at is null and new.refunded_at is not null then return new;
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

create or replace function public.marketplace_dispute_resolution_receipt(p_decision_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
select jsonb_build_object(
  'decision',jsonb_build_object('id',d.id,'dispute_id',d.dispute_id,'order_id',d.order_id,
    'outcome',d.outcome,'reason_code',d.reason_code,'financial_result',d.financial_result,'decided_at',d.decided_at),
  'dispute',jsonb_build_object('status',x.status,'resolved_at',x.resolved_at),
  'order',jsonb_build_object('status',o.status),
  'payment',jsonb_build_object('status',p.status,'gross_amount',p.gross_amount),
  'allocation',jsonb_build_object('status',a.status,'gross_amount',a.gross_amount,
    'seller_net_amount',a.seller_net_amount,'creator_commission_amount',a.creator_commission_amount,
    'platform_fee_amount',a.platform_fee_amount)
)
from public.marketplace_dispute_decisions d
join public.marketplace_order_disputes x on x.id=d.dispute_id
join public.marketplace_orders o on o.id=d.order_id
join public.marketplace_payments p on p.checkout_id=o.checkout_id
join public.marketplace_payment_allocations a on a.order_id=o.id
where d.id=p_decision_id
$$;

create or replace function public.fetch_support_marketplace_dispute(p_resolver_id uuid,p_dispute_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare d public.marketplace_order_disputes;o public.marketplace_orders;p public.marketplace_payments;a public.marketplace_payment_allocations;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception using errcode='42501',message='marketplace_dispute_resolution_auth_required';end if;
  if not exists(select 1 from public.user_profiles where id=p_resolver_id and is_admin=true)then raise exception using errcode='42501',message='marketplace_dispute_resolution_forbidden';end if;
  select*into d from public.marketplace_order_disputes where id=p_dispute_id;
  if not found then raise exception using errcode='P0002',message='marketplace_dispute_not_found';end if;
  select*into strict o from public.marketplace_orders where id=d.order_id;
  select*into strict p from public.marketplace_payments where checkout_id=o.checkout_id;
  select*into strict a from public.marketplace_payment_allocations where order_id=o.id;
  return jsonb_build_object('dispute',jsonb_build_object('id',d.id,'status',d.status,'reason_code',d.reason_code,'created_at',d.created_at),
    'order',jsonb_build_object('id',o.id,'status',o.status),'payment',jsonb_build_object('status',p.status,'gross_amount',p.gross_amount),
    'allocation',jsonb_build_object('status',a.status,'gross_amount',a.gross_amount,'seller_net_amount',a.seller_net_amount,
      'creator_commission_amount',a.creator_commission_amount,'platform_fee_amount',a.platform_fee_amount));
end$$;

create or replace function public.resolve_marketplace_dispute(
  p_resolver_id uuid,p_dispute_id uuid,p_outcome text,p_reason_code text,p_note text,p_idempotency_key uuid,p_partial_amount numeric default null
)returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.marketplace_order_disputes;o public.marketplace_orders;p public.marketplace_payments;a public.marketplace_payment_allocations;
  prior public.marketplace_dispute_decisions;decision_id uuid:=gen_random_uuid();tx uuid;escrow uuid;buyer_account uuid;
  escrow_balance numeric;allocation_count integer;now_at timestamptz:=now();result jsonb:='{}'::jsonb;settlement jsonb;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception using errcode='42501',message='marketplace_dispute_resolution_auth_required';end if;
  if not exists(select 1 from public.user_profiles where id=p_resolver_id and is_admin=true)then raise exception using errcode='42501',message='marketplace_dispute_resolution_forbidden';end if;
  if p_partial_amount is not null then raise exception using errcode='22023',message='marketplace_partial_refund_unsupported';end if;
  if p_dispute_id is null or p_idempotency_key is null or p_outcome not in('refund_buyer','release_seller','reject_claim','manual_review')
    or char_length(btrim(coalesce(p_reason_code,'')))not between 2 and 100
    or(p_note is not null and char_length(btrim(p_note))not between 1 and 1000)then raise exception using errcode='22023',message='marketplace_dispute_resolution_invalid_input';end if;
  perform pg_advisory_xact_lock(hashtextextended('marketplace-dispute-resolution:'||p_dispute_id::text,0));
  select*into d from public.marketplace_order_disputes where id=p_dispute_id for update;
  if not found then raise exception using errcode='P0002',message='marketplace_dispute_not_found';end if;
  select*into prior from public.marketplace_dispute_decisions where resolver_id=p_resolver_id and idempotency_key=p_idempotency_key;
  if found then
    if(prior.dispute_id,prior.outcome,prior.reason_code,coalesce(prior.note,''))is distinct from(p_dispute_id,p_outcome,btrim(p_reason_code),coalesce(nullif(btrim(p_note),''),''))then raise exception using errcode='23505',message='marketplace_dispute_conflicting_decision';end if;
    return public.marketplace_dispute_resolution_receipt(prior.id);
  end if;
  select*into prior from public.marketplace_dispute_decisions where dispute_id=p_dispute_id;
  if found then
    if prior.outcome<>p_outcome then raise exception using errcode='23505',message='marketplace_dispute_conflicting_decision';end if;
    raise exception using errcode='23505',message='marketplace_dispute_already_resolved';
  end if;
  if d.status not in('open','under_review')then raise exception using errcode='22023',message='marketplace_dispute_not_open';end if;
  select*into o from public.marketplace_orders where id=d.order_id for update;
  if not found or o.status not in('confirmed','processing','shipped','delivered')then raise exception using errcode='22023',message='marketplace_refund_order_state_invalid';end if;
  select*into p from public.marketplace_payments where checkout_id=o.checkout_id for update;
  if not found or p.status<>'paid'then raise exception using errcode='22023',message=case when p.status='refunded'then'marketplace_refund_already_completed'else'marketplace_refund_payment_not_paid'end;end if;
  perform 1 from public.marketplace_payment_allocations where payment_id=p.id order by id for update;
  select count(*)into allocation_count from public.marketplace_payment_allocations where payment_id=p.id;
  select*into a from public.marketplace_payment_allocations where order_id=o.id;
  if not found then raise exception using errcode='22023',message='marketplace_refund_allocation_not_held';end if;
  if p_outcome='refund_buyer'and(allocation_count<>1 or a.status<>'held')then
    p_outcome:='manual_review';result:=jsonb_build_object('code','marketplace_refund_requires_manual_review','money_moved',false);
  elsif p_outcome='refund_buyer'then
    if a.gross_amount<>p.gross_amount or a.gross_amount<>o.total
      or o.total<>round(o.subtotal+o.shipping_amount,8)
      or a.gross_amount<>a.seller_net_amount+a.creator_commission_amount+a.platform_fee_amount then raise exception using errcode='23514',message='marketplace_refund_reconciliation_failed';end if;
    escrow:=public.ensure_marketplace_escrow_account();buyer_account:=public.ensure_ledger_account(o.buyer_id);
    perform 1 from public.ledger_accounts where id=any(array[escrow,buyer_account])order by id for update;
    select balance into escrow_balance from public.ledger_accounts where id=escrow and currency='BDAG'and not frozen;
    if escrow_balance is null or escrow_balance<a.gross_amount then raise exception using errcode='23514',message='marketplace_refund_reconciliation_failed';end if;
    tx:=gen_random_uuid();
    insert into public.financial_transactions(id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,reference_type,reference_id,idempotency_key,initiated_by)
    values(tx,escrow,buyer_account,'marketplace_dispute_refund',a.gross_amount,0,'BDAG','completed','marketplace_order',o.id::text,'marketplace-dispute-refund:'||d.id,p_resolver_id);
    perform public.ledger_debit(tx,escrow,a.gross_amount,'Marketplace held dispute refund',jsonb_build_object('fin_txn_id',tx,'order_id',o.id,'dispute_id',d.id));
    perform public.ledger_credit(tx,buyer_account,a.gross_amount,'Marketplace held dispute refund',jsonb_build_object('fin_txn_id',tx,'order_id',o.id,'dispute_id',d.id));
    perform set_config('app.marketplace_dispute_refund','on',true);
    update public.marketplace_payment_allocations set status='refunded',refunded_at=now_at where id=a.id;
    update public.marketplace_payments set status='refunded',refunded_at=now_at,updated_at=now_at where id=p.id;
    update public.marketplace_orders set status='refunded',fulfillment_updated_at=now_at,fulfillment_version=fulfillment_version+1 where id=o.id;
    result:=jsonb_build_object('money_moved',true,'refund_amount',a.gross_amount,'financial_transaction_id',tx,
      'seller_allocation','refunded','creator_allocation','refunded','platform_allocation','refunded');
  elsif p_outcome='release_seller'then
    update public.marketplace_order_disputes set status='resolved',resolved_at=now_at where id=d.id;
    settlement:=public.confirm_marketplace_order_delivery_and_release(o.buyer_id,o.id,p_idempotency_key);
    result:=jsonb_build_object('money_moved',true,'settlement',settlement);
  elsif p_outcome='reject_claim'then result:=jsonb_build_object('money_moved',false,'settlement_eligible',true);
  else result:=jsonb_build_object('money_moved',false,'requires_human_follow_up',true);end if;
  if p_outcome<>'release_seller'then
    update public.marketplace_order_disputes set status=case p_outcome when'reject_claim'then'rejected'when'manual_review'then'under_review'else'resolved'end,
      resolved_at=case when p_outcome='manual_review'then null else now_at end where id=d.id;
  end if;
  insert into public.marketplace_dispute_decisions(id,dispute_id,order_id,resolver_id,outcome,reason_code,note,idempotency_key,financial_result,decided_at)
  values(decision_id,d.id,o.id,p_resolver_id,p_outcome,btrim(p_reason_code),nullif(btrim(p_note),''),p_idempotency_key,result,now_at);
  insert into public.marketplace_order_events(order_id,checkout_id,buyer_id,seller_id,store_id,event_type,from_status,to_status,actor_id,actor_role,reason_code,idempotency_key,metadata,created_at)
  values(o.id,o.checkout_id,o.buyer_id,o.seller_id,o.store_id,case when p_outcome='refund_buyer'then'refund_created'else'dispute_resolved'end,
    o.status,case when p_outcome='refund_buyer'then'refunded'else o.status end,p_resolver_id,'admin',btrim(p_reason_code),p_idempotency_key,
    jsonb_build_object('decision_id',decision_id,'outcome',p_outcome,'financial_result',result),now_at);
  return public.marketplace_dispute_resolution_receipt(decision_id);
end$$;

alter table public.marketplace_order_events drop constraint marketplace_order_events_type_check;
alter table public.marketplace_order_events add constraint marketplace_order_events_type_check check(event_type in(
  'order_confirmed','processing_started','shipment_created','shipment_updated','order_shipped','delivery_confirmed',
  'escrow_released','order_cancelled','refund_created','dispute_opened','dispute_resolved'));

revoke all on function public.marketplace_reject_dispute_decision_mutation(),public.marketplace_dispute_resolution_receipt(uuid),
  public.fetch_support_marketplace_dispute(uuid,uuid),public.resolve_marketplace_dispute(uuid,uuid,text,text,text,uuid,numeric)
from public,anon,authenticated;
grant execute on function public.fetch_support_marketplace_dispute(uuid,uuid),public.resolve_marketplace_dispute(uuid,uuid,text,text,text,uuid,numeric)to service_role;

comment on function public.resolve_marketplace_dispute(uuid,uuid,text,text,text,uuid,numeric)is
  'Trusted service-role-only held-funds dispute resolution. Uses frozen allocation values; no partial or post-release refunds.';
comment on table public.marketplace_dispute_decisions is
  'Immutable support decision and frozen financial result for one Marketplace dispute.';

commit;
