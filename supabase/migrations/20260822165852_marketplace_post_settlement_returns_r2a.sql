-- R2A: full-order, seller-discretionary return requests after a completed
-- Marketplace settlement. This phase records request/decision state only and
-- deliberately performs no refund, reversal, allocation, settlement, or ledger
-- mutation.
begin;

create table public.marketplace_return_requests(
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.marketplace_orders(id) on delete restrict,
  checkout_id uuid not null references public.marketplace_checkout_sessions(id) on delete restrict,
  settlement_id uuid not null references public.marketplace_order_settlements(id) on delete restrict,
  buyer_id uuid not null references auth.users(id) on delete restrict,
  seller_id uuid not null references auth.users(id) on delete restrict,
  store_id uuid not null references public.marketplace_stores(id) on delete restrict,
  status text not null default 'requested',
  buyer_note text not null,
  seller_note text,
  request_idempotency_key uuid not null,
  request_fingerprint text not null,
  decision_idempotency_key uuid,
  decision_fingerprint text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint marketplace_return_requests_order_key unique(order_id),
  constraint marketplace_return_requests_settlement_key unique(settlement_id),
  constraint marketplace_return_requests_buyer_idempotency_key
    unique(buyer_id,request_idempotency_key),
  constraint marketplace_return_requests_status_check
    check(status in('requested','approved','rejected')),
  constraint marketplace_return_requests_buyer_note_check check(
    buyer_note=regexp_replace(buyer_note,'^[[:space:]]+|[[:space:]]+$','','g')
    and char_length(buyer_note) between 3 and 1000
    and buyer_note!~*'<[[:space:]]*/?[[:alpha:]][^>]*>'
  ),
  constraint marketplace_return_requests_seller_note_check check(
    seller_note is null or(
      seller_note=regexp_replace(seller_note,'^[[:space:]]+|[[:space:]]+$','','g')
      and char_length(seller_note) between 1 and 1000
      and seller_note!~*'<[[:space:]]*/?[[:alpha:]][^>]*>'
    )
  ),
  constraint marketplace_return_requests_request_fingerprint_check check(
    char_length(request_fingerprint)=64 and request_fingerprint~'^[0-9a-f]{64}$'
  ),
  constraint marketplace_return_requests_decision_fingerprint_check check(
    decision_fingerprint is null or(
      char_length(decision_fingerprint)=64 and decision_fingerprint~'^[0-9a-f]{64}$'
    )
  ),
  constraint marketplace_return_requests_decision_state_check check(
    (status='requested' and seller_note is null and decision_idempotency_key is null
      and decision_fingerprint is null and decided_at is null)
    or
    (status in('approved','rejected') and decision_idempotency_key is not null
      and decision_fingerprint is not null and decided_at is not null)
  )
);

create unique index marketplace_return_requests_seller_decision_idempotency_key
  on public.marketplace_return_requests(seller_id,decision_idempotency_key)
  where decision_idempotency_key is not null;
create index marketplace_return_requests_buyer_created_idx
  on public.marketplace_return_requests(buyer_id,created_at desc,id desc);
create index marketplace_return_requests_seller_created_idx
  on public.marketplace_return_requests(seller_id,created_at desc,id desc);

alter table public.marketplace_return_requests enable row level security;
revoke all on table public.marketplace_return_requests from public,anon,authenticated;
grant all on table public.marketplace_return_requests to service_role;

alter table public.marketplace_order_events
  drop constraint marketplace_order_events_type_check;
alter table public.marketplace_order_events
  add constraint marketplace_order_events_type_check check(event_type in(
    'order_confirmed','processing_started','shipment_created','shipment_updated','order_shipped',
    'delivery_confirmed','escrow_released','order_cancelled','refund_created','dispute_opened',
    'dispute_resolved','return_requested','return_approved','return_rejected'
  ));

alter table public.marketplace_order_events
  drop constraint marketplace_order_events_transition_check;
alter table public.marketplace_order_events
  add constraint marketplace_order_events_transition_check check(
    (event_type='order_confirmed' and to_status='confirmed') or
    (event_type='processing_started' and from_status='confirmed' and to_status='processing') or
    (event_type in('shipment_created','order_shipped') and from_status='processing' and to_status='shipped') or
    event_type in(
      'shipment_updated','delivery_confirmed','escrow_released','order_cancelled','refund_created',
      'dispute_opened','dispute_resolved','return_requested','return_approved','return_rejected'
    )
  );

create function public.request_marketplace_return(
  p_order_id uuid,
  p_buyer_note text,
  p_idempotency_key uuid
)returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_actor uuid:=auth.uid();
  v_order public.marketplace_orders;
  v_payment public.marketplace_payments;
  v_allocation public.marketplace_payment_allocations;
  v_settlement public.marketplace_order_settlements;
  v_request public.marketplace_return_requests;
  v_note text:=regexp_replace(coalesce(p_buyer_note,''),'^[[:space:]]+|[[:space:]]+$','','g');
  v_fingerprint text;
  v_settlement_count integer;
begin
  if v_actor is null then
    raise exception using errcode='42501',message='marketplace_auth_required';
  end if;
  if p_order_id is null or p_idempotency_key is null
     or char_length(v_note) not between 3 and 1000
     or v_note~*'<[[:space:]]*/?[[:alpha:]][^>]*>' then
    raise exception using errcode='22023',message='marketplace_return_invalid_input';
  end if;

  v_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object(
    'order_id',p_order_id,'buyer_note',v_note
  )::text,'UTF8'),'sha256'),'hex');

  perform pg_advisory_xact_lock(hashtextextended('marketplace-return:'||p_order_id::text,0));
  select * into v_order from public.marketplace_orders where id=p_order_id for update;
  if not found or v_order.buyer_id<>v_actor then
    raise exception using errcode='42501',message='marketplace_return_order_not_found';
  end if;

  select * into v_request
  from public.marketplace_return_requests
  where buyer_id=v_actor and request_idempotency_key=p_idempotency_key
  for update;
  if found then
    if v_request.order_id<>p_order_id or v_request.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='marketplace_return_idempotency_conflict';
    end if;
    return jsonb_build_object(
      'return_request',jsonb_build_object(
        'id',v_request.id,'order_id',v_request.order_id,'status',v_request.status,
        'buyer_note',v_request.buyer_note,'seller_note',v_request.seller_note,
        'created_at',v_request.created_at,'decided_at',v_request.decided_at
      ),'money_moved',false
    );
  end if;

  if exists(select 1 from public.marketplace_return_requests where order_id=p_order_id) then
    raise exception using errcode='23505',message='marketplace_return_already_requested';
  end if;
  if v_order.status<>'delivered' then
    raise exception using errcode='22023',message='marketplace_return_not_eligible';
  end if;

  select * into v_payment
  from public.marketplace_payments
  where checkout_id=v_order.checkout_id for update;
  if not found or v_payment.buyer_id<>v_actor or v_payment.status<>'paid' then
    raise exception using errcode='22023',message='marketplace_return_not_eligible';
  end if;

  select * into v_allocation
  from public.marketplace_payment_allocations
  where order_id=v_order.id and payment_id=v_payment.id for update;
  if not found or v_allocation.checkout_id<>v_order.checkout_id
     or v_allocation.seller_id<>v_order.seller_id
     or v_allocation.store_id<>v_order.store_id or v_allocation.status<>'released' then
    raise exception using errcode='22023',message='marketplace_return_not_eligible';
  end if;

  select count(*) into v_settlement_count
  from public.marketplace_order_settlements where order_id=v_order.id;
  if v_settlement_count<>1 then
    raise exception using errcode='22023',message='marketplace_return_not_eligible';
  end if;
  select * into v_settlement
  from public.marketplace_order_settlements
  where order_id=v_order.id for update;
  if v_settlement.checkout_id<>v_order.checkout_id
     or v_settlement.payment_id<>v_payment.id
     or v_settlement.allocation_id<>v_allocation.id
     or v_settlement.buyer_id<>v_order.buyer_id
     or v_settlement.seller_id<>v_order.seller_id
     or v_settlement.store_id<>v_order.store_id
     or v_settlement.status<>'completed'
     or v_settlement.released_at is null then
    raise exception using errcode='22023',message='marketplace_return_not_eligible';
  end if;
  if exists(select 1 from public.marketplace_settlement_reversals r
            where r.order_id=v_order.id or r.settlement_id=v_settlement.id) then
    raise exception using errcode='22023',message='marketplace_return_not_eligible';
  end if;
  if exists(select 1 from public.marketplace_order_disputes d
            where d.order_id=v_order.id and d.status in('open','under_review')) then
    raise exception using errcode='22023',message='marketplace_return_active_dispute';
  end if;

  insert into public.marketplace_return_requests(
    order_id,checkout_id,settlement_id,buyer_id,seller_id,store_id,status,buyer_note,
    request_idempotency_key,request_fingerprint
  )values(
    v_order.id,v_order.checkout_id,v_settlement.id,v_order.buyer_id,v_order.seller_id,
    v_order.store_id,'requested',v_note,p_idempotency_key,v_fingerprint
  )returning * into v_request;

  insert into public.marketplace_order_events(
    order_id,checkout_id,buyer_id,seller_id,store_id,event_type,from_status,to_status,
    actor_id,actor_role,reason_code,idempotency_key,metadata,created_at
  )values(
    v_order.id,v_order.checkout_id,v_order.buyer_id,v_order.seller_id,v_order.store_id,
    'return_requested',v_order.status,v_order.status,v_actor,'buyer','marketplace_return_requested',
    p_idempotency_key,jsonb_build_object('return_request_id',v_request.id,'status','requested'),v_request.created_at
  );

  return jsonb_build_object(
    'return_request',jsonb_build_object(
      'id',v_request.id,'order_id',v_request.order_id,'status',v_request.status,
      'buyer_note',v_request.buyer_note,'seller_note',v_request.seller_note,
      'created_at',v_request.created_at,'decided_at',v_request.decided_at
    ),'money_moved',false
  );
end;
$$;

create function public.respond_to_marketplace_return(
  p_return_id uuid,
  p_decision text,
  p_seller_note text,
  p_idempotency_key uuid
)returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_actor uuid:=auth.uid();
  v_request public.marketplace_return_requests;
  v_prior public.marketplace_return_requests;
  v_decision text:=lower(regexp_replace(coalesce(p_decision,''),'^[[:space:]]+|[[:space:]]+$','','g'));
  v_note text:=nullif(regexp_replace(coalesce(p_seller_note,''),'^[[:space:]]+|[[:space:]]+$','','g'),'');
  v_status text;
  v_fingerprint text;
  v_now timestamptz:=clock_timestamp();
begin
  if v_actor is null then
    raise exception using errcode='42501',message='marketplace_auth_required';
  end if;
  if p_return_id is null or p_idempotency_key is null or v_decision not in('approve','reject')
     or (v_note is not null and(char_length(v_note)>1000
       or v_note~*'<[[:space:]]*/?[[:alpha:]][^>]*>')) then
    raise exception using errcode='22023',message='marketplace_return_decision_invalid_input';
  end if;
  v_status:=case v_decision when'approve'then'approved'else'rejected'end;
  v_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object(
    'return_id',p_return_id,'decision',v_decision,'seller_note',v_note
  )::text,'UTF8'),'sha256'),'hex');

  perform pg_advisory_xact_lock(hashtextextended('marketplace-return-decision:'||p_return_id::text,0));
  select * into v_request
  from public.marketplace_return_requests where id=p_return_id for update;
  if not found then
    raise exception using errcode='P0002',message='marketplace_return_not_found';
  end if;
  if v_request.seller_id<>v_actor then
    raise exception using errcode='42501',message='marketplace_return_not_owned';
  end if;

  select * into v_prior
  from public.marketplace_return_requests
  where seller_id=v_actor and decision_idempotency_key=p_idempotency_key
  for update;
  if found then
    if v_prior.id<>p_return_id or v_prior.decision_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='marketplace_return_decision_idempotency_conflict';
    end if;
    return jsonb_build_object(
      'return_request',jsonb_build_object(
        'id',v_prior.id,'order_id',v_prior.order_id,'status',v_prior.status,
        'buyer_note',v_prior.buyer_note,'seller_note',v_prior.seller_note,
        'created_at',v_prior.created_at,'decided_at',v_prior.decided_at
      ),'money_moved',false
    );
  end if;
  if v_request.status<>'requested' then
    raise exception using errcode='23505',message='marketplace_return_already_decided';
  end if;

  update public.marketplace_return_requests set
    status=v_status,
    seller_note=v_note,
    decision_idempotency_key=p_idempotency_key,
    decision_fingerprint=v_fingerprint,
    decided_at=v_now,
    updated_at=v_now
  where id=v_request.id
  returning * into v_request;

  insert into public.marketplace_order_events(
    order_id,checkout_id,buyer_id,seller_id,store_id,event_type,from_status,to_status,
    actor_id,actor_role,reason_code,idempotency_key,metadata,created_at
  )values(
    v_request.order_id,v_request.checkout_id,v_request.buyer_id,v_request.seller_id,v_request.store_id,
    case when v_status='approved'then'return_approved'else'return_rejected'end,
    (select status from public.marketplace_orders where id=v_request.order_id),
    (select status from public.marketplace_orders where id=v_request.order_id),
    v_actor,'seller',case when v_status='approved'then'marketplace_return_approved'else'marketplace_return_rejected'end,
    p_idempotency_key,jsonb_build_object('return_request_id',v_request.id,'status',v_status),v_now
  );

  return jsonb_build_object(
    'return_request',jsonb_build_object(
      'id',v_request.id,'order_id',v_request.order_id,'status',v_request.status,
      'buyer_note',v_request.buyer_note,'seller_note',v_request.seller_note,
      'created_at',v_request.created_at,'decided_at',v_request.decided_at
    ),'money_moved',false
  );
end;
$$;

create or replace function public.fetch_my_marketplace_order_lifecycle(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare o public.marketplace_orders;
begin
 select*into o from public.marketplace_orders where id=p_order_id;
 if o.id is null then raise exception using message='marketplace_order_not_found';end if;
 if auth.uid()not in(o.buyer_id,o.seller_id)then raise exception using errcode='42501',message='marketplace_order_not_owned';end if;
 return jsonb_build_object(
  'shipping_amount',o.shipping_amount,
  'shipping',(select jsonb_build_object('estimated_delivery_at',sh.estimated_delivery_at)from public.marketplace_order_shipments sh where sh.order_id=o.id),
  'shipping_snapshot',(select jsonb_build_object('processing_days_min',min(s.processing_days_min),'processing_days_max',max(s.processing_days_max),
   'transit_days_min',min(s.transit_days_min),'transit_days_max',max(s.transit_days_max),'return_policy_summary',max(s.return_policy_summary))
   from public.marketplace_order_shipping_snapshots s where s.order_id=o.id),
  'dispute',(select jsonb_build_object(
    'id',d.id,'status',d.status,'reason_code',d.reason_code,'buyer_note',d.buyer_note,'created_at',d.created_at,
    'outcome',x.outcome,'decided_at',x.decided_at,
    'affected_item_ids',coalesce((select jsonb_agg(di.order_item_id order by di.order_item_id)
      from public.marketplace_dispute_items di where di.dispute_id=d.id),'[]'::jsonb),
    'buyer_evidence_asset_ids',coalesce((select jsonb_agg(l.asset_id order by l.position)
      from public.media_asset_links l where l.entity_type='marketplace_dispute'
        and l.entity_id=d.id and l.slot='buyer_evidence'),'[]'::jsonb),
    'seller_response',case when auth.uid()=o.seller_id then (
      select jsonb_build_object(
        'id',r.id,'note',r.note,'created_at',r.created_at,
        'evidence_asset_ids',coalesce((select jsonb_agg(sl.asset_id order by sl.position)
          from public.media_asset_links sl where sl.entity_type='marketplace_dispute'
            and sl.entity_id=d.id and sl.slot='seller_evidence'),'[]'::jsonb)
      ) from public.marketplace_dispute_seller_responses r where r.dispute_id=d.id
    ) else null end)
   from public.marketplace_order_disputes d left join public.marketplace_dispute_decisions x on x.dispute_id=d.id
   where d.order_id=o.id order by d.created_at desc limit 1),
  'return_eligible',auth.uid()=o.buyer_id
    and o.status='delivered'
    and (select count(*) from public.marketplace_order_settlements se where se.order_id=o.id)=1
    and exists(
      select 1
      from public.marketplace_payments p
      join public.marketplace_payment_allocations a on a.payment_id=p.id and a.order_id=o.id
        and a.checkout_id=o.checkout_id
      join public.marketplace_order_settlements se on se.order_id=o.id and se.payment_id=p.id
        and se.allocation_id=a.id and se.checkout_id=o.checkout_id
      where p.checkout_id=o.checkout_id and p.buyer_id=o.buyer_id and p.status='paid'
        and a.seller_id=o.seller_id and a.store_id=o.store_id and a.status='released'
        and se.buyer_id=o.buyer_id and se.seller_id=o.seller_id and se.store_id=o.store_id
        and se.status='completed' and se.released_at is not null
        and not exists(select 1 from public.marketplace_settlement_reversals rv
                       where rv.order_id=o.id or rv.settlement_id=se.id)
    )
    and not exists(select 1 from public.marketplace_return_requests rr where rr.order_id=o.id)
    and not exists(select 1 from public.marketplace_order_disputes ad
                   where ad.order_id=o.id and ad.status in('open','under_review')),
  'return_request',(select jsonb_build_object(
    'id',rr.id,'status',rr.status,'buyer_note',rr.buyer_note,'seller_note',rr.seller_note,
    'created_at',rr.created_at,'decided_at',rr.decided_at
   )from public.marketplace_return_requests rr where rr.order_id=o.id)
 );
end$$;

revoke all on function public.request_marketplace_return(uuid,text,uuid),
  public.respond_to_marketplace_return(uuid,text,text,uuid)
from public,anon,authenticated;
grant execute on function public.request_marketplace_return(uuid,text,uuid),
  public.respond_to_marketplace_return(uuid,text,text,uuid)
to authenticated,service_role;

revoke all on function public.fetch_my_marketplace_order_lifecycle(uuid) from public,anon,authenticated;
grant execute on function public.fetch_my_marketplace_order_lifecycle(uuid) to authenticated,service_role;

comment on table public.marketplace_return_requests is
  'Full-order seller-discretionary return requests after completed Marketplace settlement; R2A records no money movement.';
comment on function public.request_marketplace_return(uuid,text,uuid) is
  'Buyer-owned idempotent post-settlement full-order return request authority. Requires delivered plus canonical released settlement and moves no money.';
comment on function public.respond_to_marketplace_return(uuid,text,text,uuid) is
  'Seller-owned idempotent approve/reject decision authority for a requested return. It performs no refund or settlement reversal.';

commit;
