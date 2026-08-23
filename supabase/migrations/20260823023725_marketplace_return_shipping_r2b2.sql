-- R2B-2: physical buyer-to-seller return shipping after the complete refund
-- amount is already held in marketplace_return_escrow. This migration never
-- moves money, releases escrow, refunds the buyer, or creates a B7R reversal.
begin;

create table public.marketplace_return_shipments(
  id uuid primary key default gen_random_uuid(),
  return_request_id uuid not null references public.marketplace_return_requests(id) on delete restrict,
  order_id uuid not null references public.marketplace_orders(id) on delete restrict,
  buyer_id uuid not null references auth.users(id) on delete restrict,
  seller_id uuid not null references auth.users(id) on delete restrict,
  store_id uuid not null references public.marketplace_stores(id) on delete restrict,
  recipient_name text not null,
  line1 text not null,
  line2 text,
  city text not null,
  region text not null,
  postal_code text not null,
  country text not null,
  phone text,
  seller_instructions text,
  carrier_name text,
  service_level text,
  tracking_number text,
  tracking_url text,
  buyer_note text,
  status text not null default 'awaiting_buyer_shipment',
  instructions_provided_at timestamptz not null default clock_timestamp(),
  shipped_at timestamptz,
  seller_instruction_idempotency_key uuid not null,
  seller_instruction_fingerprint text not null,
  buyer_shipping_idempotency_key uuid,
  buyer_shipping_fingerprint text,
  destination_fingerprint text not null,
  shipped_destination_fingerprint text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint marketplace_return_shipments_return_key unique(return_request_id),
  constraint marketplace_return_shipments_order_key unique(order_id),
  constraint marketplace_return_shipments_seller_idempotency_key
    unique(seller_id,seller_instruction_idempotency_key),
  constraint marketplace_return_shipments_buyer_idempotency_key
    unique(buyer_id,buyer_shipping_idempotency_key),
  constraint marketplace_return_shipments_status_check
    check(status in('awaiting_buyer_shipment','shipped')),
  constraint marketplace_return_shipments_recipient_check check(
    recipient_name=regexp_replace(recipient_name,'^[[:space:]]+|[[:space:]]+$','','g')
    and char_length(recipient_name) between 2 and 120
    and recipient_name!~*'<[[:space:]]*/?[[:alpha:]][^>]*>'
  ),
  constraint marketplace_return_shipments_line1_check check(
    line1=regexp_replace(line1,'^[[:space:]]+|[[:space:]]+$','','g')
    and char_length(line1) between 3 and 200
    and line1!~*'<[[:space:]]*/?[[:alpha:]][^>]*>'
  ),
  constraint marketplace_return_shipments_line2_check check(line2 is null or(
    line2=regexp_replace(line2,'^[[:space:]]+|[[:space:]]+$','','g')
    and char_length(line2) between 1 and 200
    and line2!~*'<[[:space:]]*/?[[:alpha:]][^>]*>'
  )),
  constraint marketplace_return_shipments_city_check check(
    city=regexp_replace(city,'^[[:space:]]+|[[:space:]]+$','','g')
    and char_length(city) between 2 and 120
    and city!~*'<[[:space:]]*/?[[:alpha:]][^>]*>'
  ),
  constraint marketplace_return_shipments_region_check check(
    region=regexp_replace(region,'^[[:space:]]+|[[:space:]]+$','','g')
    and char_length(region) between 1 and 120
    and region!~*'<[[:space:]]*/?[[:alpha:]][^>]*>'
  ),
  constraint marketplace_return_shipments_postal_check check(
    postal_code=regexp_replace(postal_code,'^[[:space:]]+|[[:space:]]+$','','g')
    and char_length(postal_code) between 1 and 30
    and postal_code!~*'<[[:space:]]*/?[[:alpha:]][^>]*>'
  ),
  constraint marketplace_return_shipments_country_check check(country~'^[A-Z]{2}$'),
  constraint marketplace_return_shipments_phone_check check(phone is null or(
    phone=regexp_replace(phone,'^[[:space:]]+|[[:space:]]+$','','g')
    and char_length(phone) between 1 and 40
    and phone!~*'<[[:space:]]*/?[[:alpha:]][^>]*>'
  )),
  constraint marketplace_return_shipments_instructions_check check(
    seller_instructions is null or(
      seller_instructions=regexp_replace(seller_instructions,'^[[:space:]]+|[[:space:]]+$','','g')
      and char_length(seller_instructions) between 1 and 1000
      and seller_instructions!~*'<[[:space:]]*/?[[:alpha:]][^>]*>'
    )
  ),
  constraint marketplace_return_shipments_carrier_check check(carrier_name is null or(
    carrier_name=regexp_replace(carrier_name,'^[[:space:]]+|[[:space:]]+$','','g')
    and char_length(carrier_name) between 2 and 100
    and carrier_name!~*'<[[:space:]]*/?[[:alpha:]][^>]*>'
  )),
  constraint marketplace_return_shipments_service_check check(service_level is null or(
    service_level=regexp_replace(service_level,'^[[:space:]]+|[[:space:]]+$','','g')
    and char_length(service_level) between 1 and 100
    and service_level!~*'<[[:space:]]*/?[[:alpha:]][^>]*>'
  )),
  constraint marketplace_return_shipments_tracking_check check(tracking_number is null or(
    tracking_number=regexp_replace(tracking_number,'^[[:space:]]+|[[:space:]]+$','','g')
    and char_length(tracking_number) between 2 and 120
    and tracking_number!~*'<[[:space:]]*/?[[:alpha:]][^>]*>'
  )),
  constraint marketplace_return_shipments_url_check check(
    tracking_url is null or tracking_url~'^https://[^[:space:]]+$'
  ),
  constraint marketplace_return_shipments_buyer_note_check check(buyer_note is null or(
    buyer_note=regexp_replace(buyer_note,'^[[:space:]]+|[[:space:]]+$','','g')
    and char_length(buyer_note) between 1 and 500
    and buyer_note!~*'<[[:space:]]*/?[[:alpha:]][^>]*>'
  )),
  constraint marketplace_return_shipments_seller_fingerprint_check check(
    char_length(seller_instruction_fingerprint)=64
    and seller_instruction_fingerprint~'^[0-9a-f]{64}$'
  ),
  constraint marketplace_return_shipments_buyer_fingerprint_check check(
    buyer_shipping_fingerprint is null or(
      char_length(buyer_shipping_fingerprint)=64
      and buyer_shipping_fingerprint~'^[0-9a-f]{64}$'
    )
  ),
  constraint marketplace_return_shipments_destination_fingerprint_check check(
    char_length(destination_fingerprint)=64
    and destination_fingerprint~'^[0-9a-f]{64}$'
    and(shipped_destination_fingerprint is null or(
      char_length(shipped_destination_fingerprint)=64
      and shipped_destination_fingerprint~'^[0-9a-f]{64}$'
    ))
  ),
  constraint marketplace_return_shipments_state_check check(
    (status='awaiting_buyer_shipment'
      and carrier_name is null and service_level is null and tracking_number is null
      and tracking_url is null and buyer_note is null and shipped_at is null
      and buyer_shipping_idempotency_key is null and buyer_shipping_fingerprint is null
      and shipped_destination_fingerprint is null)
    or
    (status='shipped'
      and carrier_name is not null and tracking_number is not null and shipped_at is not null
      and buyer_shipping_idempotency_key is not null and buyer_shipping_fingerprint is not null
      and shipped_destination_fingerprint=destination_fingerprint)
  )
);

create index marketplace_return_shipments_seller_status_idx
  on public.marketplace_return_shipments(seller_id,status,created_at desc,id desc);
create index marketplace_return_shipments_buyer_status_idx
  on public.marketplace_return_shipments(buyer_id,status,created_at desc,id desc);

alter table public.marketplace_return_shipments enable row level security;
revoke all on table public.marketplace_return_shipments from public,anon,authenticated,service_role;
grant select on table public.marketplace_return_shipments to service_role;

create function public.marketplace_return_shipment_guard()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if tg_op='DELETE' then
    raise exception using errcode='42501',message='marketplace_return_shipment_immutable';
  end if;
  if new.id<>old.id or new.return_request_id<>old.return_request_id
    or new.order_id<>old.order_id or new.buyer_id<>old.buyer_id
    or new.seller_id<>old.seller_id or new.store_id<>old.store_id
    or new.created_at<>old.created_at or new.instructions_provided_at<old.instructions_provided_at then
    raise exception using errcode='42501',message='marketplace_return_shipment_identity_immutable';
  end if;
  if old.status='shipped' then
    raise exception using errcode='42501',message='marketplace_return_shipment_immutable';
  end if;
  if new.status='awaiting_buyer_shipment' then
    if new.carrier_name is not null or new.tracking_number is not null
      or new.shipped_at is not null or new.buyer_shipping_idempotency_key is not null then
      raise exception using errcode='23514',message='marketplace_return_shipment_state_invalid';
    end if;
  elsif new.status='shipped' then
    if new.recipient_name<>old.recipient_name or new.line1<>old.line1
      or new.line2 is distinct from old.line2 or new.city<>old.city
      or new.region<>old.region or new.postal_code<>old.postal_code
      or new.country<>old.country or new.phone is distinct from old.phone
      or new.seller_instructions is distinct from old.seller_instructions
      or new.seller_instruction_idempotency_key<>old.seller_instruction_idempotency_key
      or new.seller_instruction_fingerprint<>old.seller_instruction_fingerprint
      or new.destination_fingerprint<>old.destination_fingerprint then
      raise exception using errcode='42501',message='marketplace_return_destination_immutable';
    end if;
  else
    raise exception using errcode='23514',message='marketplace_return_shipment_state_invalid';
  end if;
  return new;
end;
$$;

create trigger marketplace_return_shipments_guard
before update or delete on public.marketplace_return_shipments
for each row execute function public.marketplace_return_shipment_guard();

alter table public.marketplace_order_events
  drop constraint marketplace_order_events_type_check;
alter table public.marketplace_order_events
  add constraint marketplace_order_events_type_check check(event_type in(
    'order_confirmed','processing_started','shipment_created','shipment_updated','order_shipped',
    'delivery_confirmed','escrow_released','order_cancelled','refund_created','dispute_opened',
    'dispute_resolved','return_requested','return_approved','return_rejected',
    'return_instructions_provided','return_shipped'
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
      'return_instructions_provided','return_shipped'
    )
  );

create function public.marketplace_return_shipment_json(p_return_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
select case when rs.id is null then null else jsonb_build_object(
  'status',rs.status,
  'destination',jsonb_build_object(
    'recipient_name',rs.recipient_name,'line1',rs.line1,'line2',rs.line2,
    'city',rs.city,'region',rs.region,'postal_code',rs.postal_code,
    'country',rs.country,'phone',rs.phone
  ),
  'seller_instructions',rs.seller_instructions,
  'carrier_name',rs.carrier_name,'service_level',rs.service_level,
  'tracking_number',rs.tracking_number,'tracking_url',rs.tracking_url,
  'buyer_note',rs.buyer_note,
  'instructions_provided_at',rs.instructions_provided_at,
  'shipped_at',rs.shipped_at
)end
from (select 1) seed
left join public.marketplace_return_shipments rs on rs.return_request_id=p_return_id;
$$;

create function public.marketplace_return_shipment_receipt(p_return_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
select jsonb_build_object(
  'return_id',rr.id,'order_id',rr.order_id,
  'return_shipment',public.marketplace_return_shipment_json(rr.id),
  'money_moved',false
)
from public.marketplace_return_requests rr where rr.id=p_return_id;
$$;

create function public.prepare_marketplace_return_shipment(
  p_return_id uuid,
  p_recipient_name text,
  p_line1 text,
  p_line2 text,
  p_city text,
  p_region text,
  p_postal_code text,
  p_country text,
  p_phone text,
  p_instructions text,
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
  v_recipient text:=regexp_replace(coalesce(p_recipient_name,''),'^[[:space:]]+|[[:space:]]+$','','g');
  v_line1 text:=regexp_replace(coalesce(p_line1,''),'^[[:space:]]+|[[:space:]]+$','','g');
  v_line2 text:=nullif(regexp_replace(coalesce(p_line2,''),'^[[:space:]]+|[[:space:]]+$','','g'),'');
  v_city text:=regexp_replace(coalesce(p_city,''),'^[[:space:]]+|[[:space:]]+$','','g');
  v_region text:=regexp_replace(coalesce(p_region,''),'^[[:space:]]+|[[:space:]]+$','','g');
  v_postal text:=regexp_replace(coalesce(p_postal_code,''),'^[[:space:]]+|[[:space:]]+$','','g');
  v_country text:=upper(regexp_replace(coalesce(p_country,''),'^[[:space:]]+|[[:space:]]+$','','g'));
  v_phone text:=nullif(regexp_replace(coalesce(p_phone,''),'^[[:space:]]+|[[:space:]]+$','','g'),'');
  v_instructions text:=nullif(regexp_replace(coalesce(p_instructions,''),'^[[:space:]]+|[[:space:]]+$','','g'),'');
  v_fingerprint text;
  v_destination_fingerprint text;
  v_prior_fingerprint text;
  v_prior_return uuid;
  v_now timestamptz:=clock_timestamp();
begin
  if v_actor is null then
    raise exception using errcode='42501',message='marketplace_auth_required';
  end if;
  if p_return_id is null or p_idempotency_key is null
    or char_length(v_recipient) not between 2 and 120
    or char_length(v_line1) not between 3 and 200
    or(v_line2 is not null and char_length(v_line2)>200)
    or char_length(v_city) not between 2 and 120
    or char_length(v_region) not between 1 and 120
    or char_length(v_postal) not between 1 and 30
    or v_country!~'^[A-Z]{2}$'
    or(v_phone is not null and char_length(v_phone)>40)
    or(v_instructions is not null and char_length(v_instructions)>1000)
    or concat_ws('',v_recipient,v_line1,coalesce(v_line2,''),v_city,v_region,v_postal,
         coalesce(v_phone,''),coalesce(v_instructions,''))~*'<[[:space:]]*/?[[:alpha:]][^>]*>' then
    raise exception using errcode='22023',message='marketplace_return_destination_invalid_input';
  end if;
  v_destination_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object(
    'recipient_name',v_recipient,'line1',v_line1,'line2',v_line2,'city',v_city,
    'region',v_region,'postal_code',v_postal,'country',v_country,'phone',v_phone,
    'seller_instructions',v_instructions
  )::text,'UTF8'),'sha256'),'hex');
  v_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object(
    'return_id',p_return_id,'destination_fingerprint',v_destination_fingerprint
  )::text,'UTF8'),'sha256'),'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'marketplace-return-shipment-seller:'||p_return_id::text||':'||p_idempotency_key::text,0));
  select * into rr from public.marketplace_return_requests where id=p_return_id for update;
  if not found then raise exception using errcode='P0002',message='marketplace_return_not_found';end if;
  if rr.seller_id<>v_actor then
    raise exception using errcode='42501',message='marketplace_return_not_owned';
  end if;
  select (e.metadata->>'request_fingerprint'),(e.metadata->>'return_request_id')::uuid
    into v_prior_fingerprint,v_prior_return
  from public.marketplace_order_events e
  where e.order_id=rr.order_id and e.actor_id=v_actor
    and e.idempotency_key=p_idempotency_key and e.event_type='return_instructions_provided';
  if found then
    if v_prior_return<>rr.id or v_prior_fingerprint<>v_fingerprint then
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
  select * into h from public.marketplace_return_refund_holds
    where return_request_id=rr.id for update;
  select * into rs from public.marketplace_return_shipments
    where return_request_id=rr.id for update;

  if rr.status<>'approved' or o.id is null or o.id<>rr.order_id
    or o.buyer_id<>rr.buyer_id or o.seller_id<>v_actor or o.store_id<>rr.store_id
    or o.checkout_id<>rr.checkout_id or o.status<>'delivered'
    or s.id is null or s.order_id<>o.id or s.checkout_id<>o.checkout_id
    or s.payment_id<>p.id or s.allocation_id<>a.id or s.buyer_id<>o.buyer_id
    or s.seller_id<>o.seller_id or s.store_id<>o.store_id
    or s.status<>'completed' or s.released_at is null
    or p.id is null or p.checkout_id<>o.checkout_id or p.buyer_id<>o.buyer_id or p.status<>'paid'
    or a.id is null or a.order_id<>o.id or a.checkout_id<>o.checkout_id
    or a.seller_id<>o.seller_id or a.store_id<>o.store_id or a.status<>'released'
    or h.id is null or h.status<>'held' or h.settlement_id<>s.id
    or h.payment_id<>p.id or h.allocation_id<>a.id or h.order_id<>o.id
    or h.buyer_id<>o.buyer_id or h.seller_id<>o.seller_id or h.store_id<>o.store_id
    or h.currency<>'BDAG' or h.gross_amount<>s.gross_amount then
    raise exception using errcode='55000',message='marketplace_return_shipment_not_eligible';
  end if;
  if not exists(select 1 from public.marketplace_sellers se
    where se.user_id=v_actor and se.status='approved')
    or not exists(select 1 from public.marketplace_stores st
      where st.id=o.store_id and st.seller_id=v_actor and st.status='active')then
    raise exception using errcode='42501',message='marketplace_seller_not_approved';
  end if;
  if exists(select 1 from public.marketplace_settlement_reversals rv
      where rv.order_id=o.id or rv.settlement_id=s.id)
    or exists(select 1 from public.marketplace_order_disputes d
      where d.order_id=o.id and d.status in('open','under_review'))then
    raise exception using errcode='55000',message='marketplace_return_shipment_incompatible_review';
  end if;
  if rs.id is not null and rs.status='shipped' then
    raise exception using errcode='55000',message='marketplace_return_destination_immutable';
  end if;

  if rs.id is null then
    insert into public.marketplace_return_shipments(
      return_request_id,order_id,buyer_id,seller_id,store_id,
      recipient_name,line1,line2,city,region,postal_code,country,phone,seller_instructions,
      seller_instruction_idempotency_key,seller_instruction_fingerprint,destination_fingerprint,
      instructions_provided_at,created_at,updated_at
    )values(
      rr.id,o.id,o.buyer_id,o.seller_id,o.store_id,
      v_recipient,v_line1,v_line2,v_city,v_region,v_postal,v_country,v_phone,v_instructions,
      p_idempotency_key,v_fingerprint,v_destination_fingerprint,v_now,v_now,v_now
    )returning * into rs;
  else
    update public.marketplace_return_shipments set
      recipient_name=v_recipient,line1=v_line1,line2=v_line2,city=v_city,region=v_region,
      postal_code=v_postal,country=v_country,phone=v_phone,seller_instructions=v_instructions,
      seller_instruction_idempotency_key=p_idempotency_key,
      seller_instruction_fingerprint=v_fingerprint,destination_fingerprint=v_destination_fingerprint,
      instructions_provided_at=v_now,updated_at=v_now
    where id=rs.id returning * into rs;
  end if;

  insert into public.marketplace_order_events(
    order_id,checkout_id,buyer_id,seller_id,store_id,event_type,from_status,to_status,
    actor_id,actor_role,reason_code,idempotency_key,metadata,created_at
  )values(
    o.id,o.checkout_id,o.buyer_id,o.seller_id,o.store_id,'return_instructions_provided',
    o.status,o.status,v_actor,'seller','marketplace_return_instructions_provided',p_idempotency_key,
    jsonb_build_object('return_request_id',rr.id,'return_shipment_id',rs.id,
      'request_fingerprint',v_fingerprint),v_now
  );
  return public.marketplace_return_shipment_receipt(rr.id);
end;
$$;

create function public.ship_marketplace_return(
  p_return_id uuid,
  p_carrier_name text,
  p_service_level text,
  p_tracking_number text,
  p_tracking_url text,
  p_buyer_note text,
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
  v_carrier text:=regexp_replace(coalesce(p_carrier_name,''),'^[[:space:]]+|[[:space:]]+$','','g');
  v_service text:=nullif(regexp_replace(coalesce(p_service_level,''),'^[[:space:]]+|[[:space:]]+$','','g'),'');
  v_tracking text:=regexp_replace(coalesce(p_tracking_number,''),'^[[:space:]]+|[[:space:]]+$','','g');
  v_url text:=nullif(regexp_replace(coalesce(p_tracking_url,''),'^[[:space:]]+|[[:space:]]+$','','g'),'');
  v_note text:=nullif(regexp_replace(coalesce(p_buyer_note,''),'^[[:space:]]+|[[:space:]]+$','','g'),'');
  v_fingerprint text;
  v_prior_fingerprint text;
  v_prior_return uuid;
  v_now timestamptz:=clock_timestamp();
begin
  if v_actor is null then
    raise exception using errcode='42501',message='marketplace_auth_required';
  end if;
  if p_return_id is null or p_idempotency_key is null
    or char_length(v_carrier) not between 2 and 100
    or char_length(v_tracking) not between 2 and 120
    or(v_service is not null and char_length(v_service)>100)
    or(v_url is not null and v_url!~'^https://[^[:space:]]+$')
    or(v_note is not null and char_length(v_note)>500)
    or concat_ws('',v_carrier,v_tracking,coalesce(v_service,''),coalesce(v_note,''))
       ~*'<[[:space:]]*/?[[:alpha:]][^>]*>' then
    raise exception using errcode='22023',message='marketplace_return_tracking_invalid_input';
  end if;
  v_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object(
    'return_id',p_return_id,'carrier_name',v_carrier,'service_level',v_service,
    'tracking_number',v_tracking,'tracking_url',v_url,'buyer_note',v_note
  )::text,'UTF8'),'sha256'),'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    'marketplace-return-shipment-buyer:'||p_return_id::text||':'||p_idempotency_key::text,0));
  select * into rr from public.marketplace_return_requests where id=p_return_id for update;
  if not found then raise exception using errcode='P0002',message='marketplace_return_not_found';end if;
  if rr.buyer_id<>v_actor then
    raise exception using errcode='42501',message='marketplace_return_not_owned';
  end if;
  select (e.metadata->>'request_fingerprint'),(e.metadata->>'return_request_id')::uuid
    into v_prior_fingerprint,v_prior_return
  from public.marketplace_order_events e
  where e.order_id=rr.order_id and e.actor_id=v_actor
    and e.idempotency_key=p_idempotency_key and e.event_type='return_shipped';
  if found then
    if v_prior_return<>rr.id or v_prior_fingerprint<>v_fingerprint then
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
  select * into h from public.marketplace_return_refund_holds
    where return_request_id=rr.id for update;
  select * into rs from public.marketplace_return_shipments
    where return_request_id=rr.id for update;

  if rr.status<>'approved' or o.id is null or o.id<>rr.order_id
    or o.buyer_id<>v_actor or o.seller_id<>rr.seller_id or o.store_id<>rr.store_id
    or o.checkout_id<>rr.checkout_id or o.status<>'delivered'
    or s.id is null or s.order_id<>o.id or s.checkout_id<>o.checkout_id
    or s.payment_id<>p.id or s.allocation_id<>a.id or s.buyer_id<>o.buyer_id
    or s.seller_id<>o.seller_id or s.store_id<>o.store_id
    or s.status<>'completed' or s.released_at is null
    or p.id is null or p.checkout_id<>o.checkout_id or p.buyer_id<>o.buyer_id or p.status<>'paid'
    or a.id is null or a.order_id<>o.id or a.checkout_id<>o.checkout_id
    or a.seller_id<>o.seller_id or a.store_id<>o.store_id or a.status<>'released'
    or h.id is null or h.status<>'held' or h.settlement_id<>s.id
    or h.payment_id<>p.id or h.allocation_id<>a.id or h.order_id<>o.id
    or h.buyer_id<>o.buyer_id or h.seller_id<>o.seller_id or h.store_id<>o.store_id
    or h.currency<>'BDAG' or h.gross_amount<>s.gross_amount
    or rs.id is null then
    raise exception using errcode='55000',message='marketplace_return_shipment_not_eligible';
  end if;
  if exists(select 1 from public.marketplace_settlement_reversals rv
      where rv.order_id=o.id or rv.settlement_id=s.id)
    or exists(select 1 from public.marketplace_order_disputes d
      where d.order_id=o.id and d.status in('open','under_review'))then
    raise exception using errcode='55000',message='marketplace_return_shipment_incompatible_review';
  end if;
  if rs.status='shipped' then
    raise exception using errcode='55000',message='marketplace_return_already_shipped';
  end if;
  if rs.status<>'awaiting_buyer_shipment' then
    raise exception using errcode='55000',message='marketplace_return_shipment_not_eligible';
  end if;

  update public.marketplace_return_shipments set
    status='shipped',carrier_name=v_carrier,service_level=v_service,
    tracking_number=v_tracking,tracking_url=v_url,buyer_note=v_note,
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
    'return_shipment',public.marketplace_return_shipment_json(rr.id)
   )from public.marketplace_return_requests rr where rr.order_id=o.id)
 );
end$$;

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
          when rr.status='approved'and rs.status='shipped'then'return_in_transit'
          else null end
       )from public.marketplace_return_requests rr
       left join public.marketplace_return_refund_holds h on h.return_request_id=rr.id and h.status='held'
       left join public.marketplace_return_shipments rs on rs.return_request_id=rr.id
       where rr.order_id=o.id and rr.seller_id=auth.uid() and(
         rr.status='requested' or(rr.status='approved' and(
           h.id is null or rs.id is null or rs.status='shipped'
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
        'return_id',rr.id,'status',rr.status,'return_shipping_status',rs.status
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

create function public.reconcile_marketplace_return_shipments()
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
  'invalid_return_status',(select count(*)from public.marketplace_return_shipments rs
    where rs.status not in('awaiting_buyer_shipment','shipped')),
  'missing_destination',(select count(*)from public.marketplace_return_shipments rs
    where char_length(rs.recipient_name)<2 or char_length(rs.line1)<3
      or char_length(rs.city)<2 or char_length(rs.region)<1
      or char_length(rs.postal_code)<1 or rs.country!~'^[A-Z]{2}$'),
  'invalid_tracking_state',(select count(*)from public.marketplace_return_shipments rs
    where(rs.status='awaiting_buyer_shipment' and(
      rs.carrier_name is not null or rs.tracking_number is not null or rs.shipped_at is not null))
      or(rs.status='shipped' and(
        rs.carrier_name is null or rs.tracking_number is null or rs.shipped_at is null))),
  'shipped_without_tracking',(select count(*)from public.marketplace_return_shipments rs
    where rs.status='shipped' and(char_length(rs.carrier_name)<2 or char_length(rs.tracking_number)<2)),
  'shipped_without_timestamp',(select count(*)from public.marketplace_return_shipments rs
    where rs.status='shipped' and rs.shipped_at is null),
  'destination_changed_after_shipping',(select count(*)from public.marketplace_return_shipments rs
    where rs.status='shipped' and rs.shipped_destination_fingerprint is distinct from rs.destination_fingerprint),
  'duplicate_shipping_event',(select count(*)from(
    select rs.id from public.marketplace_return_shipments rs
    join public.marketplace_order_events e on e.order_id=rs.order_id
      and e.event_type='return_shipped'
      and e.metadata->>'return_shipment_id'=rs.id::text
    group by rs.id having count(*)>1
  )duplicates),
  'return_shipment_count',(select count(*)from public.marketplace_return_shipments)
);
$$;

revoke all on function public.marketplace_return_shipment_guard() from public,anon,authenticated,service_role;
revoke all on function public.marketplace_return_shipment_json(uuid) from public,anon,authenticated,service_role;
revoke all on function public.marketplace_return_shipment_receipt(uuid) from public,anon,authenticated,service_role;
revoke all on function public.prepare_marketplace_return_shipment(
  uuid,text,text,text,text,text,text,text,text,text,uuid
)from public,anon,authenticated;
revoke all on function public.ship_marketplace_return(
  uuid,text,text,text,text,text,uuid
)from public,anon,authenticated;
revoke all on function public.reconcile_marketplace_return_shipments()
  from public,anon,authenticated;

grant execute on function public.prepare_marketplace_return_shipment(
  uuid,text,text,text,text,text,text,text,text,text,uuid
)to authenticated,service_role;
grant execute on function public.ship_marketplace_return(
  uuid,text,text,text,text,text,uuid
)to authenticated,service_role;
grant execute on function public.reconcile_marketplace_return_shipments()
  to service_role;

-- Preserve the existing canonical read grants after replacing their bodies.
revoke all on function public.fetch_my_marketplace_order_lifecycle(uuid)
  from public,anon,authenticated;
revoke all on function public.fetch_my_marketplace_sales(text,integer,timestamptz,uuid)
  from public,anon,authenticated;
revoke all on function public.fetch_my_marketplace_returns(integer,timestamptz,uuid)
  from public,anon,authenticated;
revoke all on function public.fetch_my_marketplace_orders(text,integer,timestamptz,uuid)
  from public,anon,authenticated;
grant execute on function public.fetch_my_marketplace_order_lifecycle(uuid)
  to authenticated,service_role;
grant execute on function public.fetch_my_marketplace_sales(text,integer,timestamptz,uuid)
  to authenticated,service_role;
grant execute on function public.fetch_my_marketplace_returns(integer,timestamptz,uuid)
  to authenticated,service_role;
grant execute on function public.fetch_my_marketplace_orders(text,integer,timestamptz,uuid)
  to authenticated,service_role;

commit;
