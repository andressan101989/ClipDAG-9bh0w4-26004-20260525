-- R2A-F1: allow the buyer to acknowledge physical delivery after an automatic
-- or Admin settlement has already released the order. The existing held-funds
-- path continues to use marketplace_create_order_settlement_b7f unchanged.
create or replace function public.confirm_marketplace_order_delivery_and_release(
  p_buyer_id uuid,p_order_id uuid,p_idempotency_key uuid
)returns jsonb language plpgsql security definer set search_path=public as $$
declare
  o public.marketplace_orders;sh public.marketplace_order_shipments;
  p public.marketplace_payments;a public.marketplace_payment_allocations;
  s public.marketplace_order_settlements;s_key public.marketplace_order_settlements;
  v_fingerprint text;v_settlement_count integer;
  v_settlement uuid:=gen_random_uuid();v_now timestamptz:=now();
begin
  if p_buyer_id is null or p_order_id is null or p_idempotency_key is null then
    raise exception using errcode='22023',message='marketplace_delivery_invalid_input';
  end if;
  v_fingerprint:=encode(extensions.digest(
    'marketplace_order_confirm_delivery:'||p_order_id::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    p_buyer_id::text||':marketplace-delivery:'||p_idempotency_key::text,0));
  perform pg_advisory_xact_lock(hashtextextended(
    'marketplace-order-settlement:'||p_order_id::text,0));

  select * into o from public.marketplace_orders where id=p_order_id for update;
  if not found then
    raise exception using errcode='P0002',message='marketplace_order_not_found';
  end if;
  if o.buyer_id<>p_buyer_id then
    raise exception using errcode='42501',message='marketplace_order_not_owned';
  end if;

  select * into sh from public.marketplace_order_shipments
    where order_id=o.id for update;
  select mp.* into p from public.marketplace_payments mp
    join public.marketplace_checkout_sessions c on c.id=mp.checkout_id
    where mp.checkout_id=o.checkout_id and c.status='paid' for update of mp;
  select * into a from public.marketplace_payment_allocations
    where order_id=o.id for update;

  select * into s_key from public.marketplace_order_settlements
    where buyer_id=p_buyer_id and idempotency_key=p_idempotency_key;
  if found and(s_key.order_id<>p_order_id or s_key.request_fingerprint<>v_fingerprint)then
    raise exception using errcode='23505',message='marketplace_settlement_idempotency_conflict';
  end if;

  select count(*)::integer into v_settlement_count
  from public.marketplace_order_settlements where order_id=o.id;
  if v_settlement_count>1 then
    raise exception using errcode='23514',message='marketplace_settlement_integrity_error';
  end if;

  if v_settlement_count=1 then
    select * into s from public.marketplace_order_settlements
      where order_id=o.id for update;
    if p.id is null or p.status<>'paid' or p.buyer_id<>o.buyer_id
      or p.checkout_id<>o.checkout_id or p.currency<>'BDAG'
      or a.id is null or a.status<>'released' or a.payment_id<>p.id
      or a.checkout_id<>o.checkout_id or a.seller_id<>o.seller_id
      or a.store_id<>o.store_id or a.currency<>'BDAG'
      or s.status<>'completed' or s.released_at is null
      or s.order_id<>o.id or s.checkout_id<>o.checkout_id
      or s.payment_id<>p.id or s.allocation_id<>a.id
      or s.buyer_id<>o.buyer_id or s.seller_id<>o.seller_id
      or s.store_id<>o.store_id or s.currency<>'BDAG' then
      raise exception using errcode='23514',message='marketplace_settlement_integrity_error';
    end if;
    if exists(select 1 from public.marketplace_settlement_reversals r
      where r.order_id=o.id or r.settlement_id=s.id)then
      raise exception using errcode='23514',message='marketplace_settlement_integrity_error';
    end if;
    if o.status='delivered' and sh.id is not null and sh.status='delivered' then
      return public.marketplace_order_settlement_receipt(s.id,'buyer');
    end if;
    if o.status<>'shipped' then
      raise exception using message='marketplace_order_not_shipped';
    end if;
    if sh.id is null or sh.status<>'shipped' then
      raise exception using message='marketplace_shipment_not_shipped';
    end if;
    if exists(select 1 from public.marketplace_order_disputes d
      where d.order_id=o.id and d.status in('open','under_review'))then
      raise exception using message='marketplace_settlement_dispute_active';
    end if;

    update public.marketplace_orders set status='delivered',delivered_at=v_now,
      fulfillment_updated_at=v_now,fulfillment_version=fulfillment_version+1
      where id=o.id and status='shipped';
    update public.marketplace_order_shipments set status='delivered',delivered_at=v_now
      where id=sh.id and status='shipped';
    insert into public.marketplace_order_events(
      order_id,checkout_id,buyer_id,seller_id,store_id,event_type,from_status,to_status,
      actor_id,actor_role,idempotency_key,metadata,created_at
    )values(
      o.id,o.checkout_id,o.buyer_id,o.seller_id,o.store_id,
      'delivery_confirmed','shipped','delivered',p_buyer_id,'buyer',p_idempotency_key,
      jsonb_build_object(
        'settlement_id',s.id,'currency','BDAG',
        'settlement_already_completed',true,'money_moved',false
      ),v_now
    );
    return public.marketplace_order_settlement_receipt(s.id,'buyer');
  end if;

  -- Existing Path A: release held funds through the canonical B7F engine.
  if p.id is null or p.status<>'paid' then
    raise exception using message='marketplace_order_not_paid';
  end if;
  if o.status<>'shipped' then
    raise exception using message='marketplace_order_not_shipped';
  end if;
  if sh.id is null or sh.status<>'shipped' then
    raise exception using message='marketplace_shipment_not_shipped';
  end if;
  if a.id is null or a.status<>'held' then
    raise exception using message='marketplace_allocation_not_held';
  end if;
  perform public.marketplace_create_order_settlement_b7f(
    p_buyer_id,o.id,v_settlement,p_idempotency_key,v_fingerprint);
  update public.marketplace_orders set status='delivered',delivered_at=v_now,
    fulfillment_updated_at=v_now,fulfillment_version=fulfillment_version+1
    where id=o.id and status='shipped';
  update public.marketplace_order_shipments set status='delivered',delivered_at=v_now
    where id=sh.id and status='shipped';
  insert into public.marketplace_order_events(
    order_id,checkout_id,buyer_id,seller_id,store_id,event_type,from_status,to_status,
    actor_id,actor_role,idempotency_key,metadata,created_at
  )values(
    o.id,o.checkout_id,o.buyer_id,o.seller_id,o.store_id,
    'delivery_confirmed','shipped','delivered',p_buyer_id,'buyer',p_idempotency_key,
    jsonb_build_object('settlement_id',v_settlement,'currency','BDAG'),v_now
  ),(
    o.id,o.checkout_id,o.buyer_id,o.seller_id,o.store_id,
    'escrow_released','delivered','delivered',p_buyer_id,'buyer',p_idempotency_key,
    jsonb_build_object('settlement_id',v_settlement,'currency','BDAG','status','released'),v_now
  );
  return public.marketplace_order_settlement_receipt(v_settlement,'buyer');
end$$;
