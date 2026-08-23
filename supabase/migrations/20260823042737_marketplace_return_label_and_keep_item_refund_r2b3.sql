-- R2B-3: seller-issued private PDF labels and immediate seller-authorized
-- keep-item refunds. Reuses the canonical media pipeline and consumes the
-- immutable R2B-1 return hold; it does not introduce a parallel escrow path.
begin;

alter table public.marketplace_return_requests
  drop constraint marketplace_return_requests_status_check;
alter table public.marketplace_return_requests
  add constraint marketplace_return_requests_status_check
  check(status in('requested','approved','rejected','refunded'));
alter table public.marketplace_return_requests
  drop constraint marketplace_return_requests_decision_state_check;
alter table public.marketplace_return_requests
  add constraint marketplace_return_requests_decision_state_check check(
    (status='requested' and seller_note is null and decision_idempotency_key is null
      and decision_fingerprint is null and decided_at is null)
    or
    (status in('approved','rejected','refunded') and decision_idempotency_key is not null
      and decision_fingerprint is not null and decided_at is not null)
  );

alter table public.media_asset_links
  drop constraint media_asset_links_entity_type_check;
alter table public.media_asset_links
  add constraint media_asset_links_entity_type_check check(entity_type in(
    'user_profile','video_post','story','chat_message','shop_product',
    'exclusive_content','marketplace_store','marketplace_dispute',
    'marketplace_return_shipment'
  ));
create unique index marketplace_return_label_link_unique
  on public.media_asset_links(entity_id,slot)
  where entity_type='marketplace_return_shipment' and slot='return_label';

alter table public.marketplace_return_shipments
  add column return_label_asset_id uuid references public.media_assets(id) on delete restrict,
  add column label_sent_at timestamptz,
  add column label_idempotency_key uuid,
  add column label_fingerprint text;
create unique index marketplace_return_shipments_label_asset_unique
  on public.marketplace_return_shipments(return_label_asset_id)
  where return_label_asset_id is not null;
create unique index marketplace_return_shipments_label_idempotency_unique
  on public.marketplace_return_shipments(seller_id,label_idempotency_key)
  where label_idempotency_key is not null;
alter table public.marketplace_return_shipments
  add constraint marketplace_return_shipments_label_fingerprint_check check(
    label_fingerprint is null or(
      char_length(label_fingerprint)=64 and label_fingerprint~'^[0-9a-f]{64}$'
    )
  );
alter table public.marketplace_return_shipments
  drop constraint marketplace_return_shipments_state_check;
alter table public.marketplace_return_shipments
  add constraint marketplace_return_shipments_state_check check(
    (status='awaiting_buyer_shipment' and shipped_at is null
      and buyer_note is null and buyer_shipping_idempotency_key is null
      and buyer_shipping_fingerprint is null and shipped_destination_fingerprint is null
      and(
        (return_label_asset_id is null and label_sent_at is null
          and label_idempotency_key is null and label_fingerprint is null
          and carrier_name is null and service_level is null
          and tracking_number is null and tracking_url is null)
        or
        (return_label_asset_id is not null and label_sent_at is not null
          and label_idempotency_key is not null and label_fingerprint is not null
          and carrier_name is not null and tracking_number is not null)
      ))
    or
    (status='shipped' and carrier_name is not null and tracking_number is not null and shipped_at is not null
      and buyer_shipping_idempotency_key is not null and buyer_shipping_fingerprint is not null
      and shipped_destination_fingerprint=destination_fingerprint
      and(
        (return_label_asset_id is null and label_sent_at is null
          and label_idempotency_key is null and label_fingerprint is null)
        or
        (return_label_asset_id is not null and label_sent_at is not null
          and label_idempotency_key is not null and label_fingerprint is not null)
      ))
  );

create or replace function public.marketplace_return_shipment_guard()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if tg_op='DELETE' then
    raise exception using errcode='42501',message='marketplace_return_shipment_immutable';
  end if;
  if(new.id,new.return_request_id,new.order_id,new.buyer_id,new.seller_id,new.store_id,new.created_at)
      is distinct from
    (old.id,old.return_request_id,old.order_id,old.buyer_id,old.seller_id,old.store_id,old.created_at)
    or new.instructions_provided_at<old.instructions_provided_at then
    raise exception using errcode='42501',message='marketplace_return_shipment_identity_immutable';
  end if;
  if old.status='shipped' then
    raise exception using errcode='42501',message='marketplace_return_shipment_immutable';
  end if;
  if old.return_label_asset_id is not null and(
    (new.recipient_name,new.line1,new.line2,new.city,new.region,new.postal_code,new.country,
      new.phone,new.seller_instructions,new.seller_instruction_idempotency_key,
      new.seller_instruction_fingerprint,new.destination_fingerprint,
      new.return_label_asset_id,new.label_sent_at,new.label_idempotency_key,
      new.label_fingerprint,new.carrier_name,new.service_level,new.tracking_number,new.tracking_url)
    is distinct from
    (old.recipient_name,old.line1,old.line2,old.city,old.region,old.postal_code,old.country,
      old.phone,old.seller_instructions,old.seller_instruction_idempotency_key,
      old.seller_instruction_fingerprint,old.destination_fingerprint,
      old.return_label_asset_id,old.label_sent_at,old.label_idempotency_key,
      old.label_fingerprint,old.carrier_name,old.service_level,old.tracking_number,old.tracking_url)
  )then
    raise exception using errcode='42501',message='marketplace_return_destination_immutable';
  end if;
  if new.status not in('awaiting_buyer_shipment','shipped') then
    raise exception using errcode='23514',message='marketplace_return_shipment_state_invalid';
  end if;
  if new.status='shipped' and old.return_label_asset_id is null then
    raise exception using errcode='23514',message='marketplace_return_label_required';
  end if;
  return new;
end;
$$;

alter table public.marketplace_order_events
  drop constraint marketplace_order_events_type_check;
alter table public.marketplace_order_events
  add constraint marketplace_order_events_type_check check(event_type in(
    'order_confirmed','processing_started','shipment_created','shipment_updated','order_shipped',
    'delivery_confirmed','escrow_released','order_cancelled','refund_created','dispute_opened',
    'dispute_resolved','return_requested','return_approved','return_rejected',
    'return_instructions_provided','return_label_sent','return_shipped'
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
      'dispute_opened','dispute_resolved','return_requested','return_approved','return_rejected',
      'return_instructions_provided','return_label_sent','return_shipped'
    )
  );

create table public.marketplace_return_refunds(
  id uuid primary key default gen_random_uuid(),
  return_request_id uuid not null references public.marketplace_return_requests(id) on delete restrict,
  hold_id uuid not null references public.marketplace_return_refund_holds(id) on delete restrict,
  settlement_id uuid not null references public.marketplace_order_settlements(id) on delete restrict,
  payment_id uuid not null references public.marketplace_payments(id) on delete restrict,
  allocation_id uuid not null references public.marketplace_payment_allocations(id) on delete restrict,
  order_id uuid not null references public.marketplace_orders(id) on delete restrict,
  buyer_id uuid not null references auth.users(id) on delete restrict,
  seller_id uuid not null references auth.users(id) on delete restrict,
  store_id uuid not null references public.marketplace_stores(id) on delete restrict,
  gross_amount numeric(20,8) not null,
  currency text not null default 'BDAG',
  resolution_mode text not null default 'keep_item',
  financial_transaction_id uuid not null references public.financial_transactions(id) on delete restrict,
  idempotency_key uuid not null,
  request_fingerprint text not null,
  refunded_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  constraint marketplace_return_refunds_return_key unique(return_request_id),
  constraint marketplace_return_refunds_hold_key unique(hold_id),
  constraint marketplace_return_refunds_settlement_key unique(settlement_id),
  constraint marketplace_return_refunds_payment_key unique(payment_id),
  constraint marketplace_return_refunds_allocation_key unique(allocation_id),
  constraint marketplace_return_refunds_order_key unique(order_id),
  constraint marketplace_return_refunds_transaction_key unique(financial_transaction_id),
  constraint marketplace_return_refunds_seller_idempotency_key unique(seller_id,idempotency_key),
  constraint marketplace_return_refunds_amount_check check(gross_amount>0 and gross_amount=round(gross_amount,8)),
  constraint marketplace_return_refunds_currency_check check(currency='BDAG'),
  constraint marketplace_return_refunds_mode_check check(resolution_mode='keep_item'),
  constraint marketplace_return_refunds_fingerprint_check check(
    char_length(request_fingerprint)=64 and request_fingerprint~'^[0-9a-f]{64}$'
  )
);
alter table public.marketplace_return_refunds enable row level security;
revoke all on table public.marketplace_return_refunds from public,anon,authenticated,service_role;
grant select on table public.marketplace_return_refunds to service_role;

create function public.marketplace_reject_return_refund_mutation()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  raise exception using errcode='42501',message='marketplace_return_refund_immutable';
end;
$$;
create trigger marketplace_return_refunds_immutable
before update or delete on public.marketplace_return_refunds
for each row execute function public.marketplace_reject_return_refund_mutation();

create or replace function public.marketplace_payment_refund_guard()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='UPDATE'
    and(current_setting('app.marketplace_dispute_refund',true)='on'
      or current_setting('app.marketplace_return_refund',true)='on')
    and old.status='paid' and new.status='refunded'
    and(old.id,old.checkout_id,old.buyer_id,old.currency,old.gross_amount,old.escrow_amount,
        old.fee_bps,old.financial_transaction_id,old.idempotency_key,old.request_fingerprint,
        old.paid_at,old.created_at)
       is not distinct from
       (new.id,new.checkout_id,new.buyer_id,new.currency,new.gross_amount,new.escrow_amount,
        new.fee_bps,new.financial_transaction_id,new.idempotency_key,new.request_fingerprint,
        new.paid_at,new.created_at)
    and old.refunded_at is null and new.refunded_at is not null then return new;
  end if;
  raise exception using errcode='42501',message='marketplace_payment_snapshot_immutable';
end;
$$;

do $$
declare v_body text;v_extended text;
begin
  select p.prosrc into strict v_body from pg_proc p
  where p.oid='public.marketplace_allocation_release_guard()'::regprocedure;
  if position('marketplace_return_keep_item_refund_guard' in v_body)=0 then
    v_extended:=regexp_replace(v_body,'^[[:space:]]*begin',E'begin\n  -- marketplace_return_keep_item_refund_guard\n  if tg_op=''UPDATE''\n    and current_setting(''app.marketplace_return_refund'',true)=''on''\n    and old.status=''released'' and new.status=''refunded''\n    and(old.id,old.payment_id,old.checkout_id,old.order_id,old.seller_id,old.store_id,\n        old.currency,old.gross_amount,old.platform_fee_amount,old.seller_net_amount,\n        old.fee_bps,old.creator_user_id,old.creator_commission_amount)\n       is not distinct from\n       (new.id,new.payment_id,new.checkout_id,new.order_id,new.seller_id,new.store_id,\n        new.currency,new.gross_amount,new.platform_fee_amount,new.seller_net_amount,\n        new.fee_bps,new.creator_user_id,new.creator_commission_amount)\n    and old.released_at is not null and new.released_at is not distinct from old.released_at\n    and old.refunded_at is null and new.refunded_at is not null then return new;\n  end if;','');
    if v_extended=v_body then
      raise exception using errcode='P0001',message='marketplace_return_allocation_guard_extension_failed';
    end if;
    execute 'create or replace function public.marketplace_allocation_release_guard() returns trigger language plpgsql set search_path=public as '
      ||quote_literal(v_extended);
  end if;
end;
$$;

create or replace function public.marketplace_return_shipment_json(p_return_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
select case when rs.id is null then null else jsonb_build_object(
  'status',rs.status,
  'destination',jsonb_build_object(
    'recipient_name',rs.recipient_name,'line1',rs.line1,'line2',rs.line2,
    'city',rs.city,'region',rs.region,'postal_code',rs.postal_code,
    'country',rs.country,'phone',rs.phone
  ),
  'seller_instructions',rs.seller_instructions,
  'return_label_asset_id',rs.return_label_asset_id,
  'return_label_file_name',ma.original_filename,
  'label_sent_at',rs.label_sent_at,
  'carrier_name',rs.carrier_name,'service_level',rs.service_level,
  'tracking_number',rs.tracking_number,'tracking_url',rs.tracking_url,
  'buyer_note',rs.buyer_note,
  'instructions_provided_at',rs.instructions_provided_at,
  'shipped_at',rs.shipped_at
)end
from (select 1) seed
left join public.marketplace_return_shipments rs on rs.return_request_id=p_return_id
left join public.media_assets ma on ma.id=rs.return_label_asset_id;
$$;

create or replace function public.marketplace_return_refund_hold_receipt(
  p_return_id uuid,p_money_moved boolean
)returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
select jsonb_build_object(
  'return_request',jsonb_build_object(
    'id',rr.id,'order_id',rr.order_id,'status',rr.status,
    'buyer_note',rr.buyer_note,'seller_note',rr.seller_note,
    'created_at',rr.created_at,'decided_at',rr.decided_at,
    'refund_hold',case when h.id is null then null else jsonb_build_object(
      'status',h.status,'gross_amount',h.gross_amount,'held_at',h.held_at
    )end,
    'refund',case when rf.id is null then null else jsonb_build_object(
      'mode',rf.resolution_mode,'gross_amount',rf.gross_amount,'refunded_at',rf.refunded_at
    )end,
    'return_shipment',public.marketplace_return_shipment_json(rr.id)
  ),
  'money_moved',p_money_moved
)
from public.marketplace_return_requests rr
left join public.marketplace_return_refund_holds h on h.return_request_id=rr.id
left join public.marketplace_return_refunds rf on rf.return_request_id=rr.id
where rr.id=p_return_id;
$$;

create or replace function public.marketplace_return_shipment_receipt(p_return_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
select jsonb_build_object(
  'return_id',rr.id,'order_id',rr.order_id,
  'return_shipment',public.marketplace_return_shipment_json(rr.id),
  'money_moved',false
)
from public.marketplace_return_requests rr where rr.id=p_return_id;
$$;

create function public.send_marketplace_return_label(
  p_return_id uuid,
  p_label_asset_id uuid,
  p_carrier_name text,
  p_service_level text,
  p_tracking_number text,
  p_tracking_url text,
  p_idempotency_key uuid
)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_actor uuid:=auth.uid();
  rr public.marketplace_return_requests;
  h public.marketplace_return_refund_holds;
  o public.marketplace_orders;
  s public.marketplace_order_settlements;
  p public.marketplace_payments;
  a public.marketplace_payment_allocations;
  rs public.marketplace_return_shipments;
  ma public.media_assets;
  v_carrier text:=regexp_replace(coalesce(p_carrier_name,''),'^[[:space:]]+|[[:space:]]+$','','g');
  v_service text:=nullif(regexp_replace(coalesce(p_service_level,''),'^[[:space:]]+|[[:space:]]+$','','g'),'');
  v_tracking text:=regexp_replace(coalesce(p_tracking_number,''),'^[[:space:]]+|[[:space:]]+$','','g');
  v_url text:=nullif(regexp_replace(coalesce(p_tracking_url,''),'^[[:space:]]+|[[:space:]]+$','','g'),'');
  v_fingerprint text;
  v_now timestamptz:=clock_timestamp();
begin
  if v_actor is null then
    raise exception using errcode='42501',message='marketplace_auth_required';
  end if;
  if p_return_id is null or p_label_asset_id is null or p_idempotency_key is null
    or char_length(v_carrier) not between 2 and 100
    or char_length(v_tracking) not between 2 and 120
    or(v_service is not null and char_length(v_service)>100)
    or(v_url is not null and v_url!~'^https://[^[:space:]]+$')
    or concat_ws('',v_carrier,v_tracking,coalesce(v_service,''))
       ~*'<[[:space:]]*/?[[:alpha:]][^>]*>' then
    raise exception using errcode='22023',message='marketplace_return_label_invalid_input';
  end if;
  v_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object(
    'return_id',p_return_id,'label_asset_id',p_label_asset_id,
    'carrier_name',v_carrier,'service_level',v_service,
    'tracking_number',v_tracking,'tracking_url',v_url
  )::text,'UTF8'),'sha256'),'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'marketplace-return-label:'||p_return_id::text,0));
  select * into rr from public.marketplace_return_requests where id=p_return_id for update;
  if not found then raise exception using errcode='P0002',message='marketplace_return_not_found';end if;
  if rr.seller_id<>v_actor then
    raise exception using errcode='42501',message='marketplace_return_not_owned';
  end if;
  select * into rs from public.marketplace_return_shipments
    where return_request_id=rr.id for update;
  if rs.id is not null and rs.label_idempotency_key=p_idempotency_key then
    if rs.label_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='marketplace_return_shipment_idempotency_conflict';
    end if;
    return public.marketplace_return_shipment_receipt(rr.id);
  end if;
  if exists(select 1 from public.marketplace_return_shipments x
    where x.seller_id=v_actor and x.label_idempotency_key=p_idempotency_key
      and x.return_request_id<>rr.id)then
    raise exception using errcode='23505',message='marketplace_return_shipment_idempotency_conflict';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'marketplace-return-review-order:'||rr.order_id::text,0));
  select * into o from public.marketplace_orders where id=rr.order_id for update;
  select * into s from public.marketplace_order_settlements where id=rr.settlement_id for update;
  select * into p from public.marketplace_payments where id=s.payment_id for update;
  select * into a from public.marketplace_payment_allocations where id=s.allocation_id for update;
  select * into h from public.marketplace_return_refund_holds
    where return_request_id=rr.id for update;
  select * into ma from public.media_assets where id=p_label_asset_id for update;

  if rr.status<>'approved' or o.id is null or o.status<>'delivered'
    or(o.id,o.checkout_id,o.buyer_id,o.seller_id,o.store_id)
      is distinct from(rr.order_id,rr.checkout_id,rr.buyer_id,rr.seller_id,rr.store_id)
    or s.id is null or s.status<>'completed' or s.released_at is null
    or p.id is null or p.status<>'paid' or p.refunded_at is not null
    or a.id is null or a.status<>'released' or a.refunded_at is not null
    or(s.payment_id,s.allocation_id,s.order_id,s.checkout_id,s.buyer_id,s.seller_id,s.store_id)
      is distinct from(p.id,a.id,o.id,o.checkout_id,o.buyer_id,o.seller_id,o.store_id)
    or h.id is null or h.status<>'held' or h.gross_amount<>s.gross_amount
    or rs.id is null or rs.status<>'awaiting_buyer_shipment'
    or rs.return_label_asset_id is not null then
    raise exception using errcode='55000',message='marketplace_return_shipment_not_eligible';
  end if;
  if ma.id is null or ma.owner_id<>v_actor or ma.status<>'ready'
    or ma.visibility<>'private' or ma.media_kind<>'document'
    or ma.purpose<>'return_label' or ma.mime_type<>'application/pdf'
    or ma.size_bytes is null or ma.size_bytes>10000000 then
    raise exception using errcode='22023',message='marketplace_return_label_invalid_input';
  end if;
  if not exists(select 1 from public.marketplace_sellers se
      where se.user_id=v_actor and se.status='approved')
    or not exists(select 1 from public.marketplace_stores st
      where st.id=o.store_id and st.seller_id=v_actor and st.status='active')then
    raise exception using errcode='42501',message='marketplace_seller_not_approved';
  end if;
  if exists(select 1 from public.marketplace_return_refunds rf where rf.return_request_id=rr.id)
    or exists(select 1 from public.marketplace_settlement_reversals rv
      where rv.order_id=o.id or rv.settlement_id=s.id)
    or exists(select 1 from public.marketplace_order_disputes d
      where d.order_id=o.id and d.status in('open','under_review'))then
    raise exception using errcode='55000',message='marketplace_return_shipment_incompatible_review';
  end if;

  update public.marketplace_return_shipments set
    return_label_asset_id=ma.id,label_sent_at=v_now,
    label_idempotency_key=p_idempotency_key,label_fingerprint=v_fingerprint,
    carrier_name=v_carrier,service_level=v_service,
    tracking_number=v_tracking,tracking_url=v_url,updated_at=v_now
  where id=rs.id returning * into rs;
  insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
  values(ma.id,'marketplace_return_shipment',rs.id,'return_label',0);
  insert into public.marketplace_order_events(
    order_id,checkout_id,buyer_id,seller_id,store_id,event_type,from_status,to_status,
    actor_id,actor_role,reason_code,idempotency_key,metadata,created_at
  )values(
    o.id,o.checkout_id,o.buyer_id,o.seller_id,o.store_id,'return_label_sent',
    o.status,o.status,v_actor,'seller','marketplace_return_label_sent',p_idempotency_key,
    jsonb_build_object('return_request_id',rr.id,'return_shipment_id',rs.id,
      'return_label_asset_id',ma.id,'request_fingerprint',v_fingerprint,'money_moved',false),v_now
  );
  return public.marketplace_return_shipment_receipt(rr.id);
end;
$$;

drop function public.ship_marketplace_return(uuid,text,text,text,text,text,uuid);

create function public.confirm_marketplace_return_shipment(
  p_return_id uuid,p_buyer_note text,p_idempotency_key uuid
)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_actor uuid:=auth.uid();
  rr public.marketplace_return_requests;
  h public.marketplace_return_refund_holds;
  o public.marketplace_orders;
  s public.marketplace_order_settlements;
  p public.marketplace_payments;
  a public.marketplace_payment_allocations;
  rs public.marketplace_return_shipments;
  v_note text:=nullif(regexp_replace(coalesce(p_buyer_note,''),'^[[:space:]]+|[[:space:]]+$','','g'),'');
  v_fingerprint text;
  v_now timestamptz:=clock_timestamp();
begin
  if v_actor is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
  if p_return_id is null or p_idempotency_key is null
    or(v_note is not null and(char_length(v_note)>500
      or v_note~*'<[[:space:]]*/?[[:alpha:]][^>]*>'))then
    raise exception using errcode='22023',message='marketplace_return_tracking_invalid_input';
  end if;
  v_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object(
    'return_id',p_return_id,'buyer_note',v_note
  )::text,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'marketplace-return-shipment-buyer:'||p_return_id::text,0));
  select * into rr from public.marketplace_return_requests where id=p_return_id for update;
  if not found then raise exception using errcode='P0002',message='marketplace_return_not_found';end if;
  if rr.buyer_id<>v_actor then raise exception using errcode='42501',message='marketplace_return_not_owned';end if;
  select * into rs from public.marketplace_return_shipments where return_request_id=rr.id for update;
  if rs.id is not null and rs.buyer_shipping_idempotency_key=p_idempotency_key then
    if rs.buyer_shipping_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='marketplace_return_shipment_idempotency_conflict';
    end if;
    return public.marketplace_return_shipment_receipt(rr.id);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'marketplace-return-review-order:'||rr.order_id::text,0));
  select * into o from public.marketplace_orders where id=rr.order_id for update;
  select * into s from public.marketplace_order_settlements where id=rr.settlement_id for update;
  select * into p from public.marketplace_payments where id=s.payment_id for update;
  select * into a from public.marketplace_payment_allocations where id=s.allocation_id for update;
  select * into h from public.marketplace_return_refund_holds where return_request_id=rr.id for update;
  if rr.status<>'approved' or o.id is null or o.buyer_id<>v_actor or o.status<>'delivered'
    or s.id is null or s.status<>'completed' or s.released_at is null
    or p.id is null or p.status<>'paid' or a.id is null or a.status<>'released'
    or h.id is null or h.status<>'held' or h.gross_amount<>s.gross_amount
    or rs.id is null or rs.status<>'awaiting_buyer_shipment'
    or rs.return_label_asset_id is null or rs.label_sent_at is null
    or rs.carrier_name is null or rs.tracking_number is null then
    raise exception using errcode='55000',message='marketplace_return_shipment_not_eligible';
  end if;
  if exists(select 1 from public.marketplace_return_refunds rf where rf.return_request_id=rr.id)
    or exists(select 1 from public.marketplace_settlement_reversals rv
      where rv.order_id=o.id or rv.settlement_id=s.id)
    or exists(select 1 from public.marketplace_order_disputes d
      where d.order_id=o.id and d.status in('open','under_review'))then
    raise exception using errcode='55000',message='marketplace_return_shipment_incompatible_review';
  end if;
  update public.marketplace_return_shipments set
    status='shipped',buyer_note=v_note,
    buyer_shipping_idempotency_key=p_idempotency_key,
    buyer_shipping_fingerprint=v_fingerprint,
    shipped_destination_fingerprint=destination_fingerprint,
    shipped_at=v_now,updated_at=v_now
  where id=rs.id returning * into rs;
  insert into public.marketplace_order_events(
    order_id,checkout_id,buyer_id,seller_id,store_id,event_type,from_status,to_status,
    actor_id,actor_role,reason_code,idempotency_key,metadata,created_at
  )values(
    o.id,o.checkout_id,o.buyer_id,o.seller_id,o.store_id,'return_shipped',
    o.status,o.status,v_actor,'buyer','marketplace_return_shipped',p_idempotency_key,
    jsonb_build_object('return_request_id',rr.id,'return_shipment_id',rs.id,
      'request_fingerprint',v_fingerprint,'money_moved',false),v_now
  );
  return public.marketplace_return_shipment_receipt(rr.id);
end;
$$;

create function public.refund_marketplace_return_without_shipment(
  p_return_id uuid,p_seller_note text,p_idempotency_key uuid
)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_actor uuid:=auth.uid();
  rr public.marketplace_return_requests;
  h public.marketplace_return_refund_holds;
  prior public.marketplace_return_refunds;
  o public.marketplace_orders;
  s public.marketplace_order_settlements;
  p public.marketplace_payments;
  a public.marketplace_payment_allocations;
  v_note text:=nullif(regexp_replace(coalesce(p_seller_note,''),'^[[:space:]]+|[[:space:]]+$','','g'),'');
  v_fingerprint text;
  v_decision_key uuid;
  v_refund_id uuid:=gen_random_uuid();
  v_tx_id uuid:=gen_random_uuid();
  v_return_escrow uuid;
  v_buyer_account uuid;
  v_escrow_balance numeric(20,8);
  v_rows integer;
  v_now timestamptz:=clock_timestamp();
begin
  if v_actor is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
  if p_return_id is null or p_idempotency_key is null
    or(v_note is not null and(char_length(v_note)>1000
      or v_note~*'<[[:space:]]*/?[[:alpha:]][^>]*>'))then
    raise exception using errcode='22023',message='marketplace_return_decision_invalid_input';
  end if;
  v_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object(
    'return_id',p_return_id,'resolution_mode','keep_item','seller_note',v_note
  )::text,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'marketplace-return-keep-item-refund:'||p_return_id::text,0));
  select * into rr from public.marketplace_return_requests where id=p_return_id for update;
  if not found then raise exception using errcode='P0002',message='marketplace_return_not_found';end if;
  if rr.seller_id<>v_actor then raise exception using errcode='42501',message='marketplace_return_not_owned';end if;
  select * into prior from public.marketplace_return_refunds
    where seller_id=v_actor and idempotency_key=p_idempotency_key for update;
  if found then
    if prior.return_request_id<>rr.id or prior.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='marketplace_return_refund_idempotency_conflict';
    end if;
    return public.marketplace_return_refund_hold_receipt(rr.id,false);
  end if;
  if rr.status='refunded' then
    raise exception using errcode='55000',message='marketplace_return_refund_already_completed';
  end if;
  if rr.status not in('requested','approved')
    or exists(select 1 from public.marketplace_return_shipments rs where rs.return_request_id=rr.id)then
    raise exception using errcode='55000',message='marketplace_return_refund_not_eligible';
  end if;
  if not exists(select 1 from public.marketplace_sellers se
      where se.user_id=v_actor and se.status='approved')
    or not exists(select 1 from public.marketplace_stores st
      where st.id=rr.store_id and st.seller_id=v_actor and st.status='active')then
    raise exception using errcode='42501',message='marketplace_seller_not_approved';
  end if;

  if rr.status='requested' then
    v_decision_key:=md5(p_idempotency_key::text||':keep-item-approve')::uuid;
    perform public.respond_to_marketplace_return(rr.id,'approve',v_note,v_decision_key);
    select * into rr from public.marketplace_return_requests where id=p_return_id for update;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'marketplace-return-review-order:'||rr.order_id::text,0));
  select * into o from public.marketplace_orders where id=rr.order_id for update;
  select * into s from public.marketplace_order_settlements where id=rr.settlement_id for update;
  select * into p from public.marketplace_payments where id=s.payment_id for update;
  select * into a from public.marketplace_payment_allocations where id=s.allocation_id for update;
  select * into h from public.marketplace_return_refund_holds where return_request_id=rr.id for update;
  if rr.status<>'approved' or o.id is null or o.status<>'delivered'
    or(o.id,o.checkout_id,o.buyer_id,o.seller_id,o.store_id)
      is distinct from(rr.order_id,rr.checkout_id,rr.buyer_id,rr.seller_id,rr.store_id)
    or s.id is null or s.status<>'completed' or s.released_at is null
    or p.id is null or p.status<>'paid' or p.refunded_at is not null
    or a.id is null or a.status<>'released' or a.refunded_at is not null
    or(s.payment_id,s.allocation_id,s.order_id,s.checkout_id,s.buyer_id,s.seller_id,s.store_id)
      is distinct from(p.id,a.id,o.id,o.checkout_id,o.buyer_id,o.seller_id,o.store_id)
    or h.id is null or h.status<>'held' or h.gross_amount<>s.gross_amount
    or h.currency<>'BDAG' then
    raise exception using errcode='55000',message='marketplace_return_refund_not_eligible';
  end if;
  if exists(select 1 from public.marketplace_return_shipments rs where rs.return_request_id=rr.id)
    or exists(select 1 from public.marketplace_settlement_reversals rv
      where rv.order_id=o.id or rv.settlement_id=s.id)
    or exists(select 1 from public.marketplace_order_disputes d
      where d.order_id=o.id and d.status in('open','under_review'))then
    raise exception using errcode='55000',message='marketplace_return_refund_not_eligible';
  end if;

  v_return_escrow:=public.ensure_marketplace_return_escrow_account();
  v_buyer_account:=public.ensure_ledger_account(o.buyer_id);
  perform 1 from public.ledger_accounts la
    where la.id=any(array[v_return_escrow,v_buyer_account]) order by la.id for update;
  select balance into v_escrow_balance from public.ledger_accounts
    where id=v_return_escrow and owner_id is null
      and account_type='marketplace_return_escrow' and currency='BDAG' and not frozen;
  if v_escrow_balance is null or v_escrow_balance<h.gross_amount then
    raise exception using errcode='23514',message='marketplace_return_refund_escrow_insufficient';
  end if;

  insert into public.financial_transactions(
    id,from_account_id,to_account_id,operation_type,amount,fee_amount,currency,status,
    reference_type,reference_id,idempotency_key,initiated_by
  )values(
    v_tx_id,v_return_escrow,v_buyer_account,'marketplace_return_refund',h.gross_amount,0,
    'BDAG','completed','marketplace_return_refund',v_refund_id::text,
    p_idempotency_key::text,v_actor
  );
  insert into public.marketplace_return_refunds(
    id,return_request_id,hold_id,settlement_id,payment_id,allocation_id,order_id,
    buyer_id,seller_id,store_id,gross_amount,currency,resolution_mode,
    financial_transaction_id,idempotency_key,request_fingerprint,refunded_at,created_at
  )values(
    v_refund_id,rr.id,h.id,s.id,p.id,a.id,o.id,o.buyer_id,o.seller_id,o.store_id,
    h.gross_amount,'BDAG','keep_item',v_tx_id,p_idempotency_key,v_fingerprint,v_now,v_now
  );
  perform public.ledger_debit(v_tx_id,v_return_escrow,h.gross_amount,
    'Marketplace keep-item return refund',
    jsonb_build_object('return_request_id',rr.id,'refund_hold_id',h.id,'return_refund_id',v_refund_id));
  perform public.ledger_credit(v_tx_id,v_buyer_account,h.gross_amount,
    'Marketplace keep-item return refund',
    jsonb_build_object('return_request_id',rr.id,'refund_hold_id',h.id,'return_refund_id',v_refund_id));

  perform set_config('app.marketplace_return_refund','on',true);
  update public.marketplace_payment_allocations set status='refunded',refunded_at=v_now
    where id=a.id and status='released';get diagnostics v_rows=row_count;
  if v_rows<>1 then raise exception using errcode='23514',message='marketplace_return_refund_state_transition_failed';end if;
  update public.marketplace_payments set status='refunded',refunded_at=v_now,updated_at=v_now
    where id=p.id and status='paid';get diagnostics v_rows=row_count;
  if v_rows<>1 then raise exception using errcode='23514',message='marketplace_return_refund_state_transition_failed';end if;
  update public.marketplace_orders set status='refunded',fulfillment_updated_at=v_now,
    fulfillment_version=fulfillment_version+1
    where id=o.id and status='delivered';get diagnostics v_rows=row_count;
  if v_rows<>1 then raise exception using errcode='23514',message='marketplace_return_refund_state_transition_failed';end if;
  update public.marketplace_return_requests set status='refunded',updated_at=v_now
    where id=rr.id and status='approved';get diagnostics v_rows=row_count;
  if v_rows<>1 then raise exception using errcode='23514',message='marketplace_return_refund_state_transition_failed';end if;

  insert into public.marketplace_order_events(
    order_id,checkout_id,buyer_id,seller_id,store_id,event_type,from_status,to_status,
    actor_id,actor_role,reason_code,idempotency_key,metadata,created_at
  )values(
    o.id,o.checkout_id,o.buyer_id,o.seller_id,o.store_id,'refund_created',
    o.status,'refunded',v_actor,'seller','marketplace_return_refund_without_shipment',
    p_idempotency_key,jsonb_build_object(
      'return_request_id',rr.id,'return_refund_id',v_refund_id,
      'refund_hold_id',h.id,'buyer_refund_transaction_id',v_tx_id,
      'gross_refund_amount',h.gross_amount,'resolution_mode','keep_item',
      'request_fingerprint',v_fingerprint,'money_moved',true
    ),v_now
  );
  return public.marketplace_return_refund_hold_receipt(rr.id,true);
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
    'seller_response',case when auth.uid()=o.seller_id then(
      select jsonb_build_object(
        'id',r.id,'note',r.note,'created_at',r.created_at,
        'evidence_asset_ids',coalesce((select jsonb_agg(sl.asset_id order by sl.position)
          from public.media_asset_links sl where sl.entity_type='marketplace_dispute'
            and sl.entity_id=d.id and sl.slot='seller_evidence'),'[]'::jsonb)
      )from public.marketplace_dispute_seller_responses r where r.dispute_id=d.id
    )else null end)
   from public.marketplace_order_disputes d left join public.marketplace_dispute_decisions x on x.dispute_id=d.id
   where d.order_id=o.id order by d.created_at desc limit 1),
  'return_eligible',auth.uid()=o.buyer_id
    and o.status='delivered'
    and(select count(*)from public.marketplace_order_settlements se where se.order_id=o.id)=1
    and exists(
      select 1 from public.marketplace_payments p
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
    'created_at',rr.created_at,'decided_at',rr.decided_at,
    'refund_hold',(select jsonb_build_object(
      'status',h.status,'gross_amount',h.gross_amount,'held_at',h.held_at
    )from public.marketplace_return_refund_holds h where h.return_request_id=rr.id),
    'refund',(select jsonb_build_object(
      'mode',rf.resolution_mode,'gross_amount',rf.gross_amount,'refunded_at',rf.refunded_at
    )from public.marketplace_return_refunds rf where rf.return_request_id=rr.id),
    'return_shipment',public.marketplace_return_shipment_json(rr.id)
   )from public.marketplace_return_requests rr where rr.order_id=o.id)
 );
end$$;

create or replace function public.fetch_my_marketplace_returns(
  p_limit integer default 20,p_before_created_at timestamptz default null,p_before_id uuid default null
)returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=auth.uid();v_limit integer;v_store uuid;
begin
  if v_actor is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
  if not exists(select 1 from public.marketplace_sellers where user_id=v_actor and status='approved') then raise exception using errcode='42501',message='marketplace_seller_not_approved';end if;
  select id into v_store from public.marketplace_stores where seller_id=v_actor and status='active';
  if v_store is null then raise exception using errcode='42501',message='marketplace_store_inactive';end if;
  if p_limit is null or p_limit<1 or p_limit>50 then raise exception using errcode='22023',message='marketplace_invalid_limit';end if;
  if(p_before_created_at is null)<>(p_before_id is null)then raise exception using errcode='22023',message='marketplace_invalid_cursor';end if;
  v_limit:=p_limit;
  return(with scoped as(
    select rr.id,rr.status,rr.created_at,o.id order_id,o.order_number,o.status order_status,
      st.id store_id,st.name store_name,h.id is not null funded,rs.status shipping_status,
      case when rr.status='requested'then'decision_pending'
        when rr.status='approved'and h.id is null then'funds_pending'
        when rr.status='approved'and rs.id is null then'destination_pending'
        when rr.status='approved'and rs.return_label_asset_id is null then'label_pending'
        when rr.status='approved'and rs.status='shipped'then'return_in_transit'
        else null end attention_reason
    from public.marketplace_return_requests rr
    join public.marketplace_orders o on o.id=rr.order_id and o.seller_id=v_actor
    join public.marketplace_stores st on st.id=o.store_id and st.id=v_store
    left join public.marketplace_return_refund_holds h on h.return_request_id=rr.id and h.status='held'
    left join public.marketplace_return_shipments rs on rs.return_request_id=rr.id
    where rr.seller_id=v_actor
  ),attention as(select * from scoped where attention_reason is not null),
  paged as(select * from attention
    where p_before_created_at is null or(created_at,id)<(p_before_created_at,p_before_id)
    order by created_at desc,id desc limit v_limit+1),
  selected as(select * from paged order by created_at desc,id desc limit v_limit)
  select jsonb_build_object(
    'attention_count',(select count(*)from attention),
    'requested_count',(select count(*)from attention where attention_reason='decision_pending'),
    'approved_count',(select count(*)from attention where status='approved'),
    'funding_pending_count',(select count(*)from attention where attention_reason='funds_pending'),
    'destination_pending_count',(select count(*)from attention where attention_reason='destination_pending'),
    'label_pending_count',(select count(*)from attention where attention_reason='label_pending'),
    'in_transit_count',(select count(*)from attention where attention_reason='return_in_transit'),
    'returns',coalesce((select jsonb_agg(jsonb_build_object(
      'return_id',id,'status',status,'created_at',created_at,'attention_reason',attention_reason,
      'return_shipping_status',shipping_status,
      'order_id',order_id,'order_number',order_number,'order_status',order_status,
      'store_id',store_id,'store_name',store_name
    )order by created_at desc,id desc)from selected),'[]'::jsonb),
    'next_cursor',case when(select count(*)from paged)>v_limit then(
      select jsonb_build_object('created_at',created_at,'id',id)
      from selected order by created_at asc,id asc limit 1
    )else null end
  ));
end;
$$;

create or replace function public.fetch_my_marketplace_orders(
  p_status text default null,p_limit integer default 20,
  p_before_created_at timestamptz default null,p_before_id uuid default null
)returns jsonb language plpgsql security definer set search_path=public as $$
declare v_limit integer:=least(greatest(coalesce(p_limit,20),1),50);
begin
  if auth.uid() is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
  if p_status is not null and p_status not in(
    'confirmed','processing','shipped','delivered','cancelled','refunded','partially_refunded'
  )then raise exception using errcode='22023',message='marketplace_invalid_order_status';end if;
  return coalesce((select jsonb_agg(x.row order by x.created_at desc,x.id desc)from(
    select o.created_at,o.id,jsonb_build_object(
      'id',o.id,'order_number',o.order_number,'checkout_id',o.checkout_id,'checkout_reference',c.reference,
      'status',o.status,'store_id',o.store_id,'store_name',st.name,'total',o.total,'currency',o.currency,
      'created_at',o.created_at,'confirmed_at',o.confirmed_at,'processing_at',o.processing_at,
      'shipped_at',o.shipped_at,'delivered_at',o.delivered_at,
      'first_item_title',(select i.product_title from public.marketplace_order_items i where i.order_id=o.id order by i.created_at limit 1),
      'first_item_image',(select i.image_url from public.marketplace_order_items i where i.order_id=o.id order by i.created_at limit 1),
      'distinct_lines',(select count(*)from public.marketplace_order_items i where i.order_id=o.id),
      'total_quantity',(select sum(i.quantity)from public.marketplace_order_items i where i.order_id=o.id),
      'carrier_name',sh.carrier_name,'tracking_number',sh.tracking_number,'payment_status',p.status,
      'return_progress',(select jsonb_build_object(
        'return_id',rr.id,'status',rr.status,'return_shipping_status',rs.status,
        'label_sent',rs.return_label_asset_id is not null
       )from public.marketplace_return_requests rr
       join public.marketplace_return_refund_holds h on h.return_request_id=rr.id and h.status='held'
       left join public.marketplace_return_shipments rs on rs.return_request_id=rr.id
       where rr.order_id=o.id and rr.buyer_id=auth.uid() and rr.status='approved')
    )row
    from public.marketplace_orders o
    join public.marketplace_checkout_sessions c on c.id=o.checkout_id and c.status='paid'
    join public.marketplace_stores st on st.id=o.store_id
    join public.marketplace_payments p on p.checkout_id=o.checkout_id and p.paid_at is not null
      and p.status in('paid','partially_refunded','refunded')
    left join public.marketplace_order_shipments sh on sh.order_id=o.id
    where o.buyer_id=auth.uid() and(p_status is null or o.status=p_status)
      and(p_before_created_at is null or(o.created_at,o.id)<(p_before_created_at,p_before_id))
    order by o.created_at desc,o.id desc limit v_limit
  )x),'[]'::jsonb);
end;
$$;

create or replace function public.fetch_my_marketplace_sales(
  p_status text default null,p_limit integer default 20,
  p_before_created_at timestamptz default null,p_before_id uuid default null
)returns jsonb language plpgsql security definer set search_path=public as $$
declare v_limit int:=least(greatest(coalesce(p_limit,20),1),50);v_store uuid;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
  if not exists(select 1 from public.marketplace_sellers where user_id=auth.uid() and status='approved') then raise exception using errcode='42501',message='marketplace_seller_not_approved';end if;
  select id into v_store from public.marketplace_stores where seller_id=auth.uid() and status='active';
  if v_store is null then raise exception using errcode='42501',message='marketplace_store_inactive';end if;
  if p_status is not null and p_status not in('confirmed','processing','shipped','delivered','cancelled','refunded','partially_refunded') then raise exception using errcode='22023',message='marketplace_invalid_order_status';end if;
  return coalesce((select jsonb_agg(x.row order by x.created_at desc,x.id desc)from(
    select o.created_at,o.id,jsonb_build_object(
      'id',o.id,'order_number',o.order_number,'checkout_id',o.checkout_id,'checkout_reference',c.reference,
      'status',o.status,'store_id',o.store_id,'store_name',st.name,'total',o.total,'currency',o.currency,
      'created_at',o.created_at,'confirmed_at',o.confirmed_at,'processing_at',o.processing_at,
      'shipped_at',o.shipped_at,'delivered_at',o.delivered_at,'recipient_name',sa.recipient_name,
      'city',sa.city,'region',sa.region,'country',sa.country,
      'distinct_lines',(select count(*)from public.marketplace_order_items i where i.order_id=o.id),
      'total_quantity',(select sum(i.quantity)from public.marketplace_order_items i where i.order_id=o.id),
      'gross_amount',a.gross_amount,'platform_fee_amount',a.platform_fee_amount,
      'seller_net_amount',a.seller_net_amount,'allocation_status',a.status,'released_at',a.released_at,
      'carrier_name',sh.carrier_name,'tracking_number',sh.tracking_number,
      'active_dispute',(select jsonb_build_object(
        'id',d.id,'status',d.status,'reason_code',d.reason_code,'created_at',d.created_at,
        'seller_response_submitted',exists(select 1 from public.marketplace_dispute_seller_responses sr where sr.dispute_id=d.id)
       )from public.marketplace_order_disputes d
       where d.order_id=o.id and d.seller_id=auth.uid() and d.status in('open','under_review')
       order by d.created_at desc,d.id desc limit 1),
      'active_return_request',(select jsonb_build_object(
        'id',rr.id,'status',rr.status,'created_at',rr.created_at,
        'attention_reason',case
          when rr.status='requested'then'decision_pending'
          when rr.status='approved'and h.id is null then'funds_pending'
          when rr.status='approved'and rs.id is null then'destination_pending'
          when rr.status='approved'and rs.return_label_asset_id is null then'label_pending'
          when rr.status='approved'and rs.status='shipped'then'return_in_transit'
          else null end
       )from public.marketplace_return_requests rr
       left join public.marketplace_return_refund_holds h on h.return_request_id=rr.id and h.status='held'
       left join public.marketplace_return_shipments rs on rs.return_request_id=rr.id
       where rr.order_id=o.id and rr.seller_id=auth.uid() and(
         rr.status='requested' or(rr.status='approved' and(
           h.id is null or rs.id is null or rs.return_label_asset_id is null or rs.status='shipped'
         ))
       )order by rr.created_at desc,rr.id desc limit 1)
    )row
    from public.marketplace_orders o
    join public.marketplace_checkout_sessions c on c.id=o.checkout_id and c.status='paid'
    join public.marketplace_stores st on st.id=o.store_id
    join public.marketplace_checkout_shipping_addresses sa on sa.checkout_id=o.checkout_id
    join public.marketplace_payment_allocations a on a.order_id=o.id
    left join public.marketplace_order_shipments sh on sh.order_id=o.id
    where o.seller_id=auth.uid() and o.store_id=v_store and(p_status is null or o.status=p_status)
      and(p_before_created_at is null or(o.created_at,o.id)<(p_before_created_at,p_before_id))
    order by o.created_at desc,o.id desc limit v_limit
  )x),'[]'::jsonb);
end;
$$;



create or replace function public.media_asset_has_valid_links(p_asset_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.media_asset_links l
    join public.media_assets a on a.id=l.asset_id
    where l.asset_id=p_asset_id and(
      (l.entity_type='user_profile' and exists(
        select 1 from public.user_profiles u where u.id=l.entity_id and u.avatar_url=a.public_url))
      or(l.entity_type='video_post' and exists(select 1 from public.videos v where v.id=l.entity_id))
      or(l.entity_type='story' and exists(
        select 1 from public.stories s where s.id=l.entity_id and s.expires_at>now()))
      or(l.entity_type='shop_product' and exists(
        select 1 from public.products p where p.id=l.entity_id and p.status<>'deleted'))
      or(l.entity_type='marketplace_store' and exists(
        select 1 from public.marketplace_stores s where s.id=l.entity_id and(
          (l.slot='logo' and s.logo_asset_id=l.asset_id)
          or(l.slot='banner' and s.banner_asset_id=l.asset_id))))
      or(l.entity_type='marketplace_dispute' and l.slot in('buyer_evidence','seller_evidence') and exists(
        select 1 from public.marketplace_order_disputes d where d.id=l.entity_id))
      or(l.entity_type='marketplace_return_shipment' and l.slot='return_label' and exists(
        select 1 from public.marketplace_return_shipments rs
        where rs.id=l.entity_id and rs.return_label_asset_id=l.asset_id))
    )
  );
$$;

create or replace function public.reconcile_marketplace_return_refund_holds()
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
with escrow as(
  select
    (coalesce((select sum(h.gross_amount)from public.marketplace_return_refund_holds h
      where h.status='held'),0)-coalesce((select sum(r.gross_amount)
      from public.marketplace_return_refunds r),0))::numeric expected,
    coalesce((select sum(a.balance)from public.ledger_accounts a
      where a.owner_id is null and a.account_type='marketplace_return_escrow'
        and a.currency='BDAG'),0)::numeric actual
)
select jsonb_build_object(
  'orphan_hold',(select count(*)from public.marketplace_return_refund_holds h
    left join public.marketplace_return_requests rr on rr.id=h.return_request_id
    left join public.marketplace_order_settlements s on s.id=h.settlement_id
    left join public.marketplace_payments p on p.id=h.payment_id
    left join public.marketplace_payment_allocations a on a.id=h.allocation_id
    left join public.marketplace_orders o on o.id=h.order_id
    left join public.marketplace_stores st on st.id=h.store_id
    where rr.id is null or s.id is null or p.id is null or a.id is null or o.id is null or st.id is null),
  'orphan_hold_leg',(select count(*)from public.marketplace_return_refund_hold_legs l
    left join public.marketplace_return_refund_holds h on h.id=l.hold_id
    left join public.marketplace_settlement_legs x on x.id=l.original_settlement_leg_id
    where h.id is null or x.id is null),
  'duplicate_original_leg',(select count(*)from(
    select original_settlement_leg_id from public.marketplace_return_refund_hold_legs
    group by 1 having count(*)>1)x),
  'hold_amount_mismatch',(select count(*)from public.marketplace_return_refund_holds h
    join public.marketplace_order_settlements s on s.id=h.settlement_id
    where h.currency<>'BDAG' or h.status<>'held' or h.held_at is null
      or h.gross_amount<>s.gross_amount or h.currency<>s.currency),
  'hold_leg_sum_mismatch',(select count(*)from public.marketplace_return_refund_holds h
    where h.gross_amount<>(select coalesce(sum(l.amount),0)
      from public.marketplace_return_refund_hold_legs l where l.hold_id=h.id)),
  'settlement_identity_mismatch',(select count(*)from public.marketplace_return_refund_holds h
    join public.marketplace_return_requests rr on rr.id=h.return_request_id
    join public.marketplace_order_settlements s on s.id=h.settlement_id
    join public.marketplace_payments p on p.id=h.payment_id
    join public.marketplace_payment_allocations a on a.id=h.allocation_id
    join public.marketplace_orders o on o.id=h.order_id
    where(h.settlement_id,h.payment_id,h.allocation_id,h.checkout_id,h.order_id,
          h.buyer_id,h.seller_id,h.store_id,h.currency,h.gross_amount)
      is distinct from(rr.settlement_id,s.payment_id,s.allocation_id,o.checkout_id,o.id,
          o.buyer_id,o.seller_id,o.store_id,s.currency,s.gross_amount)
      or(s.payment_id,s.allocation_id,s.checkout_id,s.order_id,s.buyer_id,s.seller_id,s.store_id)
        is distinct from(p.id,a.id,o.checkout_id,o.id,o.buyer_id,o.seller_id,o.store_id)
      or(a.payment_id,a.checkout_id,a.order_id,a.seller_id,a.store_id)
        is distinct from(p.id,o.checkout_id,o.id,o.seller_id,o.store_id)),
  'wrong_leg_type',(select count(*)from public.marketplace_return_refund_hold_legs l
    join public.marketplace_return_refund_holds h on h.id=l.hold_id
    join public.marketplace_settlement_legs x on x.id=l.original_settlement_leg_id
    where l.leg_type not in('seller_net','platform_fee','creator_commission')
      or l.settlement_id<>h.settlement_id or l.settlement_id<>x.settlement_id
      or l.leg_type<>x.leg_type or l.amount<>x.amount
      or l.beneficiary_user_id is distinct from x.beneficiary_user_id),
  'wrong_source_account',(select count(*)from public.marketplace_return_refund_hold_legs l
    join public.marketplace_settlement_legs x on x.id=l.original_settlement_leg_id
    left join public.ledger_accounts a on a.id=l.source_account_id
    where l.source_account_id<>x.destination_account_id or a.id is null or a.currency<>'BDAG'
      or(l.leg_type in('seller_net','creator_commission')and(
        a.owner_id is distinct from l.beneficiary_user_id or a.account_type<>'user'))
      or(l.leg_type='platform_fee'and(a.owner_id is not null or a.account_type<>'platform'))),
  'wrong_destination_account',(select count(*)from public.marketplace_return_refund_hold_legs l
    left join public.ledger_accounts a on a.id=l.destination_account_id
    where a.id is null or a.owner_id is not null
      or a.account_type<>'marketplace_return_escrow' or a.currency<>'BDAG'),
  'missing_transaction',(select count(*)from public.marketplace_return_refund_hold_legs l
    left join public.financial_transactions f on f.id=l.financial_transaction_id where f.id is null),
  'transaction_amount_mismatch',(select count(*)from public.marketplace_return_refund_hold_legs l
    join public.financial_transactions f on f.id=l.financial_transaction_id
    where f.amount<>l.amount or f.fee_amount<>0),
  'transaction_currency_mismatch',(select count(*)from public.marketplace_return_refund_hold_legs l
    join public.financial_transactions f on f.id=l.financial_transaction_id where f.currency<>'BDAG'),
  'transaction_status_mismatch',(select count(*)from public.marketplace_return_refund_hold_legs l
    join public.financial_transactions f on f.id=l.financial_transaction_id where f.status<>'completed'),
  'transaction_reference_mismatch',(select count(*)from public.marketplace_return_refund_hold_legs l
    join public.marketplace_return_refund_holds h on h.id=l.hold_id
    join public.financial_transactions f on f.id=l.financial_transaction_id
    where f.reference_type<>'marketplace_return_refund_hold' or f.reference_id<>h.id::text
      or f.idempotency_key<>h.id::text||':'||l.original_settlement_leg_id::text
      or f.initiated_by is distinct from h.seller_id
      or(f.from_account_id,f.to_account_id)is distinct from(l.source_account_id,l.destination_account_id)
      or f.operation_type<>case l.leg_type
        when'seller_net'then'marketplace_return_seller_hold'
        when'platform_fee'then'marketplace_return_platform_hold'
        when'creator_commission'then'marketplace_return_creator_hold'end),
  'funded_return_state_mismatch',(select count(*)from public.marketplace_return_refund_holds h
    join public.marketplace_return_requests rr on rr.id=h.return_request_id
    where rr.status not in('approved','refunded')),
  'refund_identity_mismatch',(select count(*)from public.marketplace_return_refunds r
    join public.marketplace_return_refund_holds h on h.id=r.hold_id
    join public.marketplace_return_requests rr on rr.id=r.return_request_id
    where(r.return_request_id,r.settlement_id,r.payment_id,r.allocation_id,r.order_id,
      r.buyer_id,r.seller_id,r.store_id,r.gross_amount,r.currency)
      is distinct from(h.return_request_id,h.settlement_id,h.payment_id,h.allocation_id,h.order_id,
      h.buyer_id,h.seller_id,h.store_id,h.gross_amount,h.currency)
      or rr.status<>'refunded'),
  'refund_transaction_mismatch',(select count(*)from public.marketplace_return_refunds r
    left join public.financial_transactions f on f.id=r.financial_transaction_id
    where f.id is null or f.operation_type<>'marketplace_return_refund'
      or f.amount<>r.gross_amount or f.currency<>'BDAG' or f.status<>'completed'
      or f.reference_type<>'marketplace_return_refund' or f.reference_id<>r.id::text
      or f.initiated_by is distinct from r.seller_id),
  'return_escrow_expected_held_total',(select expected from escrow),
  'return_escrow_actual_balance',(select actual from escrow),
  'return_escrow_difference',(select actual-expected from escrow),
  'return_escrow_surplus',(select greatest(actual-expected,0)from escrow),
  'return_escrow_shortage',(select greatest(expected-actual,0)from escrow)
)$$;

create or replace function public.reconcile_marketplace_return_shipments()
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
select jsonb_build_object(
  'orphan_return_shipment',(select count(*)from public.marketplace_return_shipments rs
    left join public.marketplace_return_requests rr on rr.id=rs.return_request_id
    left join public.marketplace_orders o on o.id=rs.order_id
    left join public.marketplace_stores st on st.id=rs.store_id
    where rr.id is null or o.id is null or st.id is null),
  'return_identity_mismatch',(select count(*)from public.marketplace_return_shipments rs
    join public.marketplace_return_requests rr on rr.id=rs.return_request_id
    join public.marketplace_orders o on o.id=rs.order_id
    where rr.order_id<>rs.order_id or rr.buyer_id<>rs.buyer_id or rr.seller_id<>rs.seller_id
      or rr.store_id<>rs.store_id or o.buyer_id<>rs.buyer_id or o.seller_id<>rs.seller_id
      or o.store_id<>rs.store_id),
  'unfunded_return_shipment',(select count(*)from public.marketplace_return_shipments rs
    join public.marketplace_return_requests rr on rr.id=rs.return_request_id
    left join public.marketplace_return_refund_holds h on h.return_request_id=rr.id
      and h.order_id=rs.order_id and h.status='held'
    where rr.status<>'approved' or h.id is null),
  'missing_return_label_link',(select count(*)from public.marketplace_return_shipments rs
    where rs.return_label_asset_id is not null and not exists(
      select 1 from public.media_asset_links l where l.asset_id=rs.return_label_asset_id
        and l.entity_type='marketplace_return_shipment' and l.entity_id=rs.id and l.slot='return_label')),
  'invalid_return_label_asset',(select count(*)from public.marketplace_return_shipments rs
    left join public.media_assets a on a.id=rs.return_label_asset_id
    where rs.return_label_asset_id is not null and(a.id is null or a.owner_id<>rs.seller_id
      or a.status<>'ready' or a.visibility<>'private' or a.media_kind<>'document'
      or a.purpose<>'return_label' or a.mime_type<>'application/pdf')),
  'legacy_shipped_without_label',(select count(*)from public.marketplace_return_shipments rs
    where rs.status='shipped' and rs.return_label_asset_id is null),
  'invalid_tracking_state',(select count(*)from public.marketplace_return_shipments rs
    where(rs.return_label_asset_id is null and(
      rs.carrier_name is not null or rs.tracking_number is not null or rs.label_sent_at is not null))
      or(rs.return_label_asset_id is not null and(
        rs.carrier_name is null or rs.tracking_number is null or rs.label_sent_at is null))
      or(rs.status='shipped' and rs.shipped_at is null)),
  'destination_changed_after_shipping',(select count(*)from public.marketplace_return_shipments rs
    where rs.status='shipped' and rs.shipped_destination_fingerprint is distinct from rs.destination_fingerprint),
  'return_shipment_count',(select count(*)from public.marketplace_return_shipments)
);
$$;

comment on table public.marketplace_return_refunds is
  'Immutable consumption records for seller-authorized immediate return refunds where the buyer keeps the product.';
comment on function public.send_marketplace_return_label(uuid,uuid,text,text,text,text,uuid) is
  'Seller-only authority that links one private PDF return label and freezes seller-provided carrier/tracking data.';
comment on function public.confirm_marketplace_return_shipment(uuid,text,uuid) is
  'Buyer-only confirmation after dropping the labeled package at the carrier; it cannot alter seller tracking data.';
comment on function public.refund_marketplace_return_without_shipment(uuid,text,uuid) is
  'Seller-only atomic keep-item refund consuming the canonical return escrow hold and crediting the buyer immediately.';

revoke all on function public.marketplace_reject_return_refund_mutation()
  from public,anon,authenticated,service_role;
revoke all on function public.send_marketplace_return_label(uuid,uuid,text,text,text,text,uuid)
  from public,anon,authenticated;
revoke all on function public.confirm_marketplace_return_shipment(uuid,text,uuid)
  from public,anon,authenticated;
revoke all on function public.refund_marketplace_return_without_shipment(uuid,text,uuid)
  from public,anon,authenticated;
grant execute on function public.send_marketplace_return_label(uuid,uuid,text,text,text,text,uuid)
  to authenticated,service_role;
grant execute on function public.confirm_marketplace_return_shipment(uuid,text,uuid)
  to authenticated,service_role;
grant execute on function public.refund_marketplace_return_without_shipment(uuid,text,uuid)
  to authenticated,service_role;

-- Preserve canonical read authorities after replacing their bodies.
revoke all on function public.fetch_my_marketplace_order_lifecycle(uuid)
  from public,anon,authenticated;
revoke all on function public.fetch_my_marketplace_returns(integer,timestamptz,uuid)
  from public,anon,authenticated;
revoke all on function public.fetch_my_marketplace_orders(text,integer,timestamptz,uuid)
  from public,anon,authenticated;
revoke all on function public.fetch_my_marketplace_sales(text,integer,timestamptz,uuid)
  from public,anon,authenticated;
grant execute on function public.fetch_my_marketplace_order_lifecycle(uuid)
  to authenticated,service_role;
grant execute on function public.fetch_my_marketplace_returns(integer,timestamptz,uuid)
  to authenticated,service_role;
grant execute on function public.fetch_my_marketplace_orders(text,integer,timestamptz,uuid)
  to authenticated,service_role;
grant execute on function public.fetch_my_marketplace_sales(text,integer,timestamptz,uuid)
  to authenticated,service_role;

commit;
