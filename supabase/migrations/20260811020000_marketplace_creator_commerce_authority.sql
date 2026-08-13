create table public.marketplace_creator_commerce_authority_state(
  singleton boolean primary key default true check(singleton),
  activated_at timestamptz not null default clock_timestamp()
);

insert into public.marketplace_creator_commerce_authority_state(singleton) values(true);

create table public.marketplace_creator_commerce_attributions(
  id uuid primary key,
  entitlement_id uuid not null references public.marketplace_live_affiliate_offers(id),
  seller_id uuid not null references public.marketplace_sellers(user_id),
  store_id uuid not null references public.marketplace_stores(id),
  product_id uuid not null references public.products(id),
  variant_id uuid references public.marketplace_product_variants(id),
  creator_user_id uuid not null references auth.users(id),
  commission_bps integer not null,
  source_surface text not null,
  source_entity_id uuid not null,
  authorized_by uuid not null references auth.users(id),
  entitlement_updated_at_attribution timestamptz not null,
  attributed_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz,
  idempotency_key uuid not null unique,
  request_fingerprint text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint marketplace_creator_attribution_bps_check check(commission_bps between 1 and 3000),
  constraint marketplace_creator_attribution_source_check
    check(source_surface in('live','direct_creator_link')),
  constraint marketplace_creator_attribution_not_seller check(creator_user_id<>seller_id),
  constraint marketplace_creator_attribution_window_check
    check(expires_at is null or expires_at>attributed_at),
  constraint marketplace_creator_attribution_fingerprint_check check(
    char_length(request_fingerprint)=64 and request_fingerprint~'^[0-9a-f]{64}$')
);

create index marketplace_creator_attribution_entitlement_idx
  on public.marketplace_creator_commerce_attributions(entitlement_id,creator_user_id);
create index marketplace_creator_attribution_product_idx
  on public.marketplace_creator_commerce_attributions(product_id,variant_id,creator_user_id);
create index marketplace_creator_attribution_source_idx
  on public.marketplace_creator_commerce_attributions(source_surface,source_entity_id);

create table public.marketplace_order_item_creator_attributions(
  id uuid primary key,
  attribution_id uuid not null references public.marketplace_creator_commerce_attributions(id),
  entitlement_id uuid not null references public.marketplace_live_affiliate_offers(id),
  checkout_id uuid not null,
  order_id uuid not null,
  order_item_id uuid not null unique,
  seller_id uuid not null,
  store_id uuid not null,
  product_id uuid not null references public.products(id),
  variant_id uuid not null references public.marketplace_product_variants(id),
  creator_user_id uuid not null references auth.users(id),
  commission_bps integer not null,
  source_surface text not null,
  source_entity_id uuid not null,
  attributed_at timestamptz not null,
  idempotency_key uuid not null,
  request_fingerprint text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint marketplace_item_attribution_bps_check check(commission_bps between 1 and 3000),
  constraint marketplace_item_attribution_source_check
    check(source_surface in('live','direct_creator_link')),
  constraint marketplace_item_attribution_not_seller check(creator_user_id<>seller_id),
  constraint marketplace_item_attribution_request_item_key unique(idempotency_key,order_item_id),
  constraint marketplace_item_attribution_fingerprint_check check(
    char_length(request_fingerprint)=64 and request_fingerprint~'^[0-9a-f]{64}$'),
  constraint marketplace_item_attribution_item_identity_fkey
    foreign key(order_item_id,order_id,checkout_id,seller_id,store_id)
    references public.marketplace_order_items(id,order_id,checkout_id,seller_id,store_id),
  constraint marketplace_item_attribution_order_identity_fkey
    foreign key(order_id,checkout_id,seller_id,store_id)
    references public.marketplace_orders(id,checkout_id,seller_id,store_id)
);

create index marketplace_item_attribution_order_idx
  on public.marketplace_order_item_creator_attributions(order_id,creator_user_id);
create index marketplace_item_attribution_attribution_idx
  on public.marketplace_order_item_creator_attributions(attribution_id);

create table public.marketplace_creator_checkout_commands(
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references auth.users(id),
  idempotency_key uuid not null,
  request_fingerprint text not null,
  result_json jsonb not null check(jsonb_typeof(result_json)='object'),
  created_at timestamptz not null default clock_timestamp(),
  constraint marketplace_creator_checkout_command_key unique(buyer_id,idempotency_key),
  constraint marketplace_creator_checkout_fingerprint_check check(
    char_length(request_fingerprint)=64 and request_fingerprint~'^[0-9a-f]{64}$')
);

alter table public.marketplace_creator_commerce_authority_state enable row level security;
alter table public.marketplace_creator_commerce_attributions enable row level security;
alter table public.marketplace_order_item_creator_attributions enable row level security;
alter table public.marketplace_creator_checkout_commands enable row level security;

create or replace function public.marketplace_reject_creator_commerce_snapshot_mutation()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception using errcode='42501',message='marketplace_creator_commerce_snapshot_immutable';
end$$;

create trigger marketplace_creator_attributions_immutable
before update or delete on public.marketplace_creator_commerce_attributions
for each row execute function public.marketplace_reject_creator_commerce_snapshot_mutation();

create trigger marketplace_item_creator_attributions_immutable
before update or delete on public.marketplace_order_item_creator_attributions
for each row execute function public.marketplace_reject_creator_commerce_snapshot_mutation();

create trigger marketplace_creator_checkout_commands_immutable
before update or delete on public.marketplace_creator_checkout_commands
for each row execute function public.marketplace_reject_creator_commerce_snapshot_mutation();

create or replace function public.marketplace_create_creator_commerce_attribution_internal(
  p_entitlement_id uuid,p_creator_user_id uuid,p_variant_id uuid,
  p_source_surface text,p_source_entity_id uuid,p_idempotency_key uuid
)returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_offer public.marketplace_live_affiliate_offers;
  v_product public.products;v_variant public.marketplace_product_variants;
  v_prior public.marketplace_creator_commerce_attributions;
  v_id uuid:=gen_random_uuid();v_fingerprint text;v_now timestamptz:=clock_timestamp();
begin
  if p_entitlement_id is null or p_creator_user_id is null or p_source_entity_id is null
    or p_idempotency_key is null or p_source_surface not in('live','direct_creator_link') then
    raise exception using errcode='22023',message='marketplace_creator_attribution_invalid_input';
  end if;
  v_fingerprint:=encode(extensions.digest(concat_ws('|',
    'marketplace_creator_commerce_attribution',p_entitlement_id,p_creator_user_id,
    coalesce(p_variant_id::text,''),p_source_surface,p_source_entity_id),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'marketplace-creator-attribution-key:'||p_idempotency_key::text,0));
  select * into v_prior from public.marketplace_creator_commerce_attributions
    where idempotency_key=p_idempotency_key;
  if found then
    if v_prior.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='marketplace_creator_attribution_idempotency_conflict';
    end if;
    return jsonb_build_object('id',v_prior.id,'entitlement_id',v_prior.entitlement_id,
      'creator_user_id',v_prior.creator_user_id,'product_id',v_prior.product_id,
      'variant_id',v_prior.variant_id,'commission_bps',v_prior.commission_bps,
      'source_surface',v_prior.source_surface,'source_entity_id',v_prior.source_entity_id,
      'attributed_at',v_prior.attributed_at,'expires_at',v_prior.expires_at);
  end if;
  select * into v_offer from public.marketplace_live_affiliate_offers
    where id=p_entitlement_id;
  if found then
    perform 1 from public.products where id=v_offer.product_id for share;
    select * into v_offer from public.marketplace_live_affiliate_offers
      where id=p_entitlement_id for share;
  end if;
  if not found or v_offer.status<>'active'
    or(v_offer.starts_at is not null and v_offer.starts_at>v_now)
    or(v_offer.ends_at is not null and v_offer.ends_at<=v_now)
    or(v_offer.offer_scope='specific_creator' and v_offer.creator_id<>p_creator_user_id)
    or(v_offer.offer_scope='public_creator' and v_offer.creator_id is not null) then
    raise exception using errcode='22023',message='marketplace_creator_entitlement_ineligible';
  end if;
  select * into v_product from public.products where id=v_offer.product_id;
  if not found or v_product.seller_id<>v_offer.seller_id or v_product.store_id<>v_offer.store_id
    or v_product.status<>'active' or v_product.moderation_status<>'approved'
    or v_product.published_at is null or v_product.deleted_at is not null
    or v_product.product_type<>'physical' or v_product.currency<>'BDAG'
    or not exists(select 1 from public.marketplace_stores s
      where s.id=v_offer.store_id and s.seller_id=v_offer.seller_id and s.status='active')
    or not exists(select 1 from public.marketplace_sellers s
      where s.user_id=v_offer.seller_id and s.status='approved') then
    raise exception using errcode='22023',message='marketplace_creator_entitlement_product_ineligible';
  end if;
  if p_creator_user_id=v_offer.seller_id
    or not exists(select 1 from auth.users u where u.id=p_creator_user_id) then
    raise exception using errcode='23514',message='marketplace_creator_attribution_creator_invalid';
  end if;
  if p_variant_id is not null then
    select * into v_variant from public.marketplace_product_variants where id=p_variant_id;
    if not found or v_variant.product_id<>v_offer.product_id or v_variant.seller_id<>v_offer.seller_id
      or v_variant.store_id<>v_offer.store_id or v_variant.status<>'active'
      or v_variant.archived_at is not null then
      raise exception using errcode='23514',message='marketplace_creator_attribution_variant_mismatch';
    end if;
  end if;
  if p_source_surface='direct_creator_link' and p_source_entity_id<>p_entitlement_id then
    raise exception using errcode='23514',message='marketplace_creator_attribution_source_mismatch';
  end if;
  if p_source_surface='live' and not exists(
    select 1 from public.live_session_products pin
    where pin.id=p_source_entity_id and pin.affiliate_offer_id=v_offer.id
      and pin.product_id=v_offer.product_id and pin.seller_id=v_offer.seller_id
      and pin.store_id=v_offer.store_id and pin.host_id=p_creator_user_id
      and pin.commerce_mode='affiliate_product' and pin.creator_commission_bps=v_offer.commission_bps) then
    raise exception using errcode='23514',message='marketplace_creator_attribution_source_mismatch';
  end if;
  insert into public.marketplace_creator_commerce_attributions(
    id,entitlement_id,seller_id,store_id,product_id,variant_id,creator_user_id,
    commission_bps,source_surface,source_entity_id,authorized_by,
    entitlement_updated_at_attribution,attributed_at,expires_at,idempotency_key,request_fingerprint)
  values(v_id,v_offer.id,v_offer.seller_id,v_offer.store_id,v_offer.product_id,p_variant_id,
    p_creator_user_id,v_offer.commission_bps,p_source_surface,p_source_entity_id,
    v_offer.seller_id,v_offer.updated_at,v_now,v_offer.ends_at,p_idempotency_key,v_fingerprint);
  return jsonb_build_object('id',v_id,'entitlement_id',v_offer.id,
    'creator_user_id',p_creator_user_id,'product_id',v_offer.product_id,
    'variant_id',p_variant_id,'commission_bps',v_offer.commission_bps,
    'source_surface',p_source_surface,'source_entity_id',p_source_entity_id,
    'attributed_at',v_now,'expires_at',v_offer.ends_at);
end$$;

create or replace function public.create_marketplace_creator_commerce_attribution(
  p_entitlement_id uuid,p_creator_user_id uuid,p_variant_id uuid,
  p_source_surface text,p_source_entity_id uuid,p_idempotency_key uuid
)returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then
    raise exception using errcode='42501',message='marketplace_creator_attribution_service_role_required';
  end if;
  return public.marketplace_create_creator_commerce_attribution_internal(
    p_entitlement_id,p_creator_user_id,p_variant_id,p_source_surface,p_source_entity_id,
    p_idempotency_key);
end$$;

create or replace function public.marketplace_freeze_order_item_creator_attribution_internal(
  p_order_item_id uuid,p_attribution_id uuid,p_idempotency_key uuid
)returns uuid language plpgsql security definer set search_path=public as $$
declare
  v_item public.marketplace_order_items;v_order public.marketplace_orders;
  v_attr public.marketplace_creator_commerce_attributions;
  v_offer public.marketplace_live_affiliate_offers;v_prior record;
  v_id uuid:=gen_random_uuid();v_fingerprint text;v_now timestamptz:=clock_timestamp();
begin
  select * into v_item from public.marketplace_order_items where id=p_order_item_id for update;
  if not found then raise exception using errcode='P0002',message='marketplace_order_item_not_found';end if;
  select * into v_order from public.marketplace_orders where id=v_item.order_id for update;
  select * into v_attr from public.marketplace_creator_commerce_attributions
    where id=p_attribution_id for update;
  if not found then raise exception using errcode='P0002',message='marketplace_creator_attribution_not_found';end if;
  perform 1 from public.products where id=v_attr.product_id for share;
  select * into v_offer from public.marketplace_live_affiliate_offers
    where id=v_attr.entitlement_id for share;
  if v_order.status<>'pending_payment'
    or exists(select 1 from public.marketplace_payments p where p.checkout_id=v_order.checkout_id)
    or exists(select 1 from public.marketplace_order_settlements s where s.order_id=v_order.id)
    or v_order.status in('refunded','partially_refunded') then
    raise exception using errcode='22023',message='marketplace_creator_attribution_freeze_ineligible';
  end if;
  if v_offer.status<>'active' or(v_offer.starts_at is not null and v_offer.starts_at>v_now)
    or(v_offer.ends_at is not null and v_offer.ends_at<=v_now)
    or(v_attr.expires_at is not null and v_attr.expires_at<=v_now) then
    raise exception using errcode='22023',message='marketplace_creator_entitlement_ineligible';
  end if;
  if (v_item.order_id,v_item.checkout_id,v_item.seller_id,v_item.store_id,v_item.product_id)
      is distinct from(v_order.id,v_order.checkout_id,v_attr.seller_id,v_attr.store_id,v_attr.product_id)
    or v_item.variant_id is distinct from coalesce(v_attr.variant_id,v_item.variant_id)
    or(v_attr.variant_id is not null and v_item.variant_id<>v_attr.variant_id)
    or(v_attr.entitlement_id,v_attr.seller_id,v_attr.store_id,v_attr.product_id,
       v_attr.creator_user_id,v_attr.commission_bps)
      is distinct from(v_offer.id,v_offer.seller_id,v_offer.store_id,v_offer.product_id,
        case when v_offer.offer_scope='specific_creator' then v_offer.creator_id else v_attr.creator_user_id end,
        v_offer.commission_bps) then
    raise exception using errcode='23514',message='marketplace_creator_attribution_item_mismatch';
  end if;
  select * into v_prior from public.marketplace_order_item_creator_attributions
    where order_item_id=v_item.id;
  if found then
    if v_prior.attribution_id<>v_attr.id then
      raise exception using errcode='23505',message='marketplace_creator_item_attribution_conflict';
    end if;
    return v_prior.id;
  end if;
  v_fingerprint:=encode(extensions.digest(concat_ws('|',
    'marketplace_order_item_creator_attribution',v_item.id,v_attr.id,v_order.id,
    v_order.checkout_id,v_item.seller_id,v_item.store_id,v_item.product_id,v_item.variant_id,
    v_attr.creator_user_id,v_attr.entitlement_id,v_attr.commission_bps,
    v_attr.source_surface,v_attr.source_entity_id),'sha256'),'hex');
  insert into public.marketplace_order_item_creator_attributions(
    id,attribution_id,entitlement_id,checkout_id,order_id,order_item_id,seller_id,store_id,
    product_id,variant_id,creator_user_id,commission_bps,source_surface,source_entity_id,
    attributed_at,idempotency_key,request_fingerprint)
  values(v_id,v_attr.id,v_attr.entitlement_id,v_order.checkout_id,v_order.id,v_item.id,
    v_item.seller_id,v_item.store_id,v_item.product_id,v_item.variant_id,v_attr.creator_user_id,
    v_attr.commission_bps,v_attr.source_surface,v_attr.source_entity_id,v_attr.attributed_at,
    p_idempotency_key,v_fingerprint);
  return v_id;
end$$;

create or replace function public.freeze_marketplace_order_item_creator_attribution(
  p_order_item_id uuid,p_attribution_id uuid,p_idempotency_key uuid
)returns uuid language plpgsql security definer set search_path=public as $$
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then
    raise exception using errcode='42501',message='marketplace_creator_snapshot_service_role_required';
  end if;
  return public.marketplace_freeze_order_item_creator_attribution_internal(
    p_order_item_id,p_attribution_id,p_idempotency_key);
end$$;

create or replace function public.create_marketplace_creator_checkout_reservation(
  p_items jsonb,p_shipping_address jsonb,p_idempotency_key uuid
)returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_buyer uuid:=auth.uid();v_element jsonb;v_base_items jsonb;v_normalized jsonb;
  v_fingerprint text;v_prior public.marketplace_creator_checkout_commands;
  v_result jsonb;v_checkout uuid;v_row record;
begin
  if v_buyer is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
  if p_idempotency_key is null or jsonb_typeof(p_items)<>'array'
    or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>100 then
    raise exception using errcode='22023',message='marketplace_creator_checkout_invalid_items';
  end if;
  for v_element in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_element)<>'object' or not(v_element?'variant_id') or not(v_element?'quantity')
      or(v_element-'variant_id'-'quantity'-'attribution_id')<>'{}'::jsonb
      or(v_element->>'quantity')!~'^[1-9][0-9]{0,2}$'
      or(v_element?'attribution_id' and nullif(v_element->>'attribution_id','') is null) then
      raise exception using errcode='22023',message='marketplace_creator_checkout_invalid_items';
    end if;
  end loop;
  select jsonb_agg(jsonb_build_object('variant_id',(e->>'variant_id')::uuid,
      'quantity',(e->>'quantity')::integer)
      order by(e->>'variant_id')::uuid),
    jsonb_agg(jsonb_build_object('variant_id',(e->>'variant_id')::uuid,
      'quantity',(e->>'quantity')::integer,
      'attribution_id',case when e?'attribution_id' then(e->>'attribution_id')::uuid else null end)
      order by(e->>'variant_id')::uuid)
  into v_base_items,v_normalized from jsonb_array_elements(p_items)e;
  if(select count(*)<>count(distinct(e->>'variant_id')) from jsonb_array_elements(p_items)e) then
    raise exception using errcode='22023',message='marketplace_duplicate_variant';
  end if;
  v_fingerprint:=encode(extensions.digest(concat_ws('|','marketplace_creator_checkout',
    v_buyer,v_normalized::text,coalesce(p_shipping_address,'{}'::jsonb)::text),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'marketplace-creator-checkout:'||v_buyer::text||':'||p_idempotency_key::text,0));
  select * into v_prior from public.marketplace_creator_checkout_commands
    where buyer_id=v_buyer and idempotency_key=p_idempotency_key;
  if found then
    if v_prior.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='marketplace_creator_checkout_idempotency_conflict';
    end if;
    return v_prior.result_json;
  end if;
  perform 1 from public.marketplace_creator_commerce_attributions a
    join jsonb_array_elements(v_normalized)e
      on a.id=nullif(e->>'attribution_id','')::uuid
    order by a.id for update of a;
  perform 1 from public.marketplace_live_affiliate_offers o
    join public.marketplace_creator_commerce_attributions a on a.entitlement_id=o.id
    join jsonb_array_elements(v_normalized)e
      on a.id=nullif(e->>'attribution_id','')::uuid
    order by o.id for share of o;
  v_result:=public.create_marketplace_checkout_reservation(
    v_base_items,p_shipping_address,p_idempotency_key);
  v_checkout:=(v_result->'checkout'->>'id')::uuid;
  for v_row in
    select i.id item_id,(e->>'attribution_id')::uuid attribution_id
    from jsonb_array_elements(v_normalized)e
    join public.marketplace_order_items i on i.checkout_id=v_checkout
      and i.variant_id=(e->>'variant_id')::uuid
    where e->>'attribution_id' is not null order by i.id
  loop
    perform public.marketplace_freeze_order_item_creator_attribution_internal(
      v_row.item_id,v_row.attribution_id,p_idempotency_key);
  end loop;
  if(select count(*) from jsonb_array_elements(v_normalized)e where e->>'attribution_id' is not null)
    <>(select count(*) from public.marketplace_order_item_creator_attributions s
      where s.checkout_id=v_checkout and s.idempotency_key=p_idempotency_key) then
    raise exception using errcode='23514',message='marketplace_creator_checkout_attribution_mismatch';
  end if;
  insert into public.marketplace_creator_checkout_commands(
    buyer_id,idempotency_key,request_fingerprint,result_json)
  values(v_buyer,p_idempotency_key,v_fingerprint,v_result);
  return v_result;
end$$;

-- Existing LIVE checkouts and purchases are reconstructed from their already-durable
-- pin and order-source snapshots. No financial row is changed.
insert into public.marketplace_creator_commerce_attributions(
  id,entitlement_id,seller_id,store_id,product_id,variant_id,creator_user_id,
  commission_bps,source_surface,source_entity_id,authorized_by,
  entitlement_updated_at_attribution,attributed_at,expires_at,idempotency_key,request_fingerprint,created_at)
select md5('marketplace-live-attribution:'||src.order_id::text)::uuid,
  pin.affiliate_offer_id,src.seller_id,src.store_id,src.product_id,src.variant_id,
  src.live_host_id,pin.creator_commission_bps,'live',src.live_session_product_id,
  src.seller_id,case when offer.status='active' then offer.updated_at else src.captured_at end,
  src.captured_at,offer.ends_at,
  md5('marketplace-live-attribution-key:'||src.order_id::text)::uuid,
  encode(extensions.digest(concat_ws('|','marketplace_creator_commerce_attribution',
    pin.affiliate_offer_id,src.live_host_id,src.variant_id,'live',src.live_session_product_id),
    'sha256'),'hex'),src.captured_at
from public.marketplace_live_order_sources src
join public.live_session_products pin on pin.id=src.live_session_product_id
join public.marketplace_live_affiliate_offers offer on offer.id=pin.affiliate_offer_id
where pin.commerce_mode='affiliate_product'
on conflict(idempotency_key) do nothing;

insert into public.marketplace_order_item_creator_attributions(
  id,attribution_id,entitlement_id,checkout_id,order_id,order_item_id,seller_id,store_id,
  product_id,variant_id,creator_user_id,commission_bps,source_surface,source_entity_id,
  attributed_at,idempotency_key,request_fingerprint,created_at)
select md5('marketplace-live-item-attribution:'||src.order_id::text)::uuid,a.id,
  a.entitlement_id,src.checkout_id,src.order_id,item.id,src.seller_id,src.store_id,
  src.product_id,src.variant_id,src.live_host_id,a.commission_bps,'live',
  src.live_session_product_id,a.attributed_at,a.idempotency_key,
  encode(extensions.digest(concat_ws('|','marketplace_order_item_creator_attribution',
    item.id,a.id,src.order_id,src.checkout_id,src.seller_id,src.store_id,src.product_id,
    src.variant_id,src.live_host_id,a.entitlement_id,a.commission_bps,'live',
    src.live_session_product_id),'sha256'),'hex'),a.created_at
from public.marketplace_live_order_sources src
join public.live_session_products pin on pin.id=src.live_session_product_id
join public.marketplace_creator_commerce_attributions a
  on a.id=md5('marketplace-live-attribution:'||src.order_id::text)::uuid
join public.marketplace_order_items item
  on item.order_id=src.order_id and item.variant_id=src.variant_id
where pin.commerce_mode='affiliate_product'
on conflict(order_item_id) do nothing;

create or replace function public.marketplace_snapshot_live_creator_attribution()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_pin public.live_session_products;v_item uuid;v_receipt jsonb;v_key uuid;
begin
  select * into v_pin from public.live_session_products where id=new.live_session_product_id;
  if not found then
    raise exception using errcode='23514',message='marketplace_live_attribution_source_invalid';
  end if;
  if v_pin.commerce_mode='own_product' then return new;end if;
  select id into v_item from public.marketplace_order_items
    where order_id=new.order_id and variant_id=new.variant_id order by id limit 1;
  if v_item is null then
    raise exception using errcode='23514',message='marketplace_live_attribution_item_missing';
  end if;
  v_key:=md5('marketplace-live-attribution-key:'||new.order_id::text)::uuid;
  v_receipt:=public.marketplace_create_creator_commerce_attribution_internal(
    v_pin.affiliate_offer_id,new.live_host_id,new.variant_id,'live',
    new.live_session_product_id,v_key);
  perform public.marketplace_freeze_order_item_creator_attribution_internal(
    v_item,(v_receipt->>'id')::uuid,v_key);
  return new;
end$$;

create trigger marketplace_live_order_source_creator_attribution
after insert on public.marketplace_live_order_sources
for each row execute function public.marketplace_snapshot_live_creator_attribution();

create or replace function public.finalize_marketplace_creator_commerce_for_order(
  p_order_id uuid,p_idempotency_key uuid
)returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_order public.marketplace_orders;v_payment public.marketplace_payments;
  v_allocation public.marketplace_payment_allocations;v_payload jsonb;v_count integer;
  v_receipt jsonb;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' then
    raise exception using errcode='42501',message='marketplace_creator_finalizer_service_role_required';
  end if;
  if p_order_id is null or p_idempotency_key is null then
    raise exception using errcode='22023',message='marketplace_creator_finalizer_invalid_input';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'marketplace-order-settlement:'||p_order_id::text,0));
  select * into v_order from public.marketplace_orders where id=p_order_id for update;
  if not found then raise exception using errcode='P0002',message='marketplace_order_not_found';end if;
  select * into v_payment from public.marketplace_payments
    where checkout_id=v_order.checkout_id for update;
  select * into v_allocation from public.marketplace_payment_allocations
    where order_id=v_order.id for update;
  select count(*),jsonb_agg(jsonb_build_object(
      'order_item_id',s.order_item_id,'creator_user_id',s.creator_user_id,
      'commission_bps',s.commission_bps) order by s.order_item_id)
  into v_count,v_payload from public.marketplace_order_item_creator_attributions s
    where s.order_id=v_order.id;
  if v_count=0 then
    return jsonb_build_object('order_id',v_order.id,'money_moved',false,
      'allocation_count',0,'creator_commission_amount',0,'allocations','[]'::jsonb);
  end if;
  if v_payment.id is null or v_payment.status<>'paid' or v_allocation.id is null
    or v_allocation.status<>'held' then
    raise exception using errcode='22023',message='marketplace_creator_finalizer_state_ineligible';
  end if;
  if exists(select 1 from public.marketplace_order_settlements s where s.order_id=v_order.id)
    and not exists(select 1 from public.marketplace_order_item_creator_allocations a
      where a.order_id=v_order.id and a.idempotency_key=p_idempotency_key) then
    raise exception using errcode='22023',message='marketplace_creator_finalizer_after_settlement';
  end if;
  v_receipt:=public.apply_marketplace_order_item_creator_allocations(
    v_order.id,v_payload,p_idempotency_key);
  return jsonb_build_object('order_id',v_order.id,'money_moved',false,
    'allocation_count',v_count,'creator_commission_amount',
      coalesce((v_receipt->>'creator_commission_amount')::numeric,0),
    'creator_user_id',v_receipt->'creator_user_id','b7f_receipt',v_receipt);
end$$;

-- B7A shifts the legacy LIVE scalar calculation from the BEFORE phase to the
-- canonical B7F finalizer in the AFTER phase of the same allocation insert.
-- No externally visible timing or formula changes.
create or replace function public.marketplace_apply_live_commission()
returns trigger language plpgsql set search_path=public as $$
declare v_source public.marketplace_live_order_sources;v_pin public.live_session_products;
begin
  select * into v_source from public.marketplace_live_order_sources where order_id=new.order_id;
  if found then
    select * into v_pin from public.live_session_products where id=v_source.live_session_product_id;
    if v_pin.commerce_mode='affiliate_product' and not exists(
      select 1 from public.marketplace_order_item_creator_attributions s
      where s.order_id=new.order_id and s.source_surface='live'
        and s.source_entity_id=v_pin.id and s.creator_user_id=v_pin.host_id
        and s.entitlement_id=v_pin.affiliate_offer_id
        and s.commission_bps=v_pin.creator_commission_bps) then
      raise exception using errcode='23514',message='marketplace_live_commission_attribution_missing';
    end if;
  end if;
  new.creator_user_id:=null;
  new.creator_commission_amount:=0;
  new.seller_net_amount:=new.gross_amount-new.platform_fee_amount;
  return new;
end$$;

create or replace function public.marketplace_record_live_purchase()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_source public.marketplace_live_order_sources;v_pin public.live_session_products;
  v_item public.marketplace_order_items;v_allocation public.marketplace_payment_allocations;
  v_buyer_name text;v_key uuid;
begin
  if exists(select 1 from public.marketplace_order_item_creator_attributions s
    where s.order_id=new.order_id) then
    v_key:=md5('marketplace-creator-finalize:'||new.order_id::text)::uuid;
    perform public.finalize_marketplace_creator_commerce_for_order(new.order_id,v_key);
  end if;
  select * into v_allocation from public.marketplace_payment_allocations where id=new.id;
  select * into v_source from public.marketplace_live_order_sources where order_id=new.order_id;
  if not found then return new;end if;
  select * into v_pin from public.live_session_products where id=v_source.live_session_product_id;
  select * into v_item from public.marketplace_order_items
    where order_id=new.order_id order by id limit 1;
  if v_item.id is null then
    raise exception using errcode='23514',message='marketplace_live_commission_integrity_error';
  end if;
  if v_pin.commerce_mode='affiliate_product' then
    if v_allocation.creator_user_id is distinct from v_pin.host_id
      or v_allocation.creator_commission_amount
        is distinct from round(v_item.line_total*v_pin.creator_commission_bps/10000.0,8)
      or v_allocation.creator_commission_amount<=0 then
      raise exception using errcode='23514',message='marketplace_live_commission_integrity_error';
    end if;
  elsif v_allocation.creator_commission_amount<>0 or v_allocation.creator_user_id is not null then
    raise exception using errcode='23514',message='marketplace_live_commission_integrity_error';
  end if;
  select coalesce(nullif(btrim(display_name),''),username,'Comprador') into v_buyer_name
    from public.user_profiles where id=v_source.buyer_id;
  insert into public.marketplace_live_commission_sources(
    checkout_id,order_id,payment_id,allocation_id,live_session_id,host_id,seller_id,store_id,
    product_id,variant_id,affiliate_offer_id,commerce_mode,creator_commission_bps,
    creator_commission_amount)
  values(v_allocation.checkout_id,v_allocation.order_id,v_allocation.payment_id,v_allocation.id,
    v_source.live_session_id,v_source.live_host_id,v_allocation.seller_id,v_allocation.store_id,
    v_source.product_id,v_source.variant_id,v_pin.affiliate_offer_id,v_pin.commerce_mode,
    v_pin.creator_commission_bps,v_allocation.creator_commission_amount);
  insert into public.live_commerce_purchase_events(
    session_id,host_id,buyer_id,checkout_id,order_id,order_item_id,product_id,variant_id,
    quantity,gross_amount,creator_commission_amount,creator_commission_status,buyer_display_name)
  values(v_source.live_session_id,v_source.live_host_id,v_source.buyer_id,v_allocation.checkout_id,
    v_allocation.order_id,v_item.id,v_item.product_id,v_item.variant_id,v_item.quantity,
    v_allocation.gross_amount,v_allocation.creator_commission_amount,
    case when v_allocation.creator_commission_amount>0 then'held'else'none'end,
    left(v_buyer_name,80));
  return new;
end$$;

create or replace function public.reconcile_marketplace_creator_commerce()
returns jsonb language sql stable security definer set search_path=public as $$
with entitlement as(
  select e.*,s.user_id existing_seller,st.id existing_store,p.id existing_product,
    p.seller_id product_seller,p.store_id product_store,
    u.id existing_specific_creator
  from public.marketplace_live_affiliate_offers e
  left join public.marketplace_sellers s on s.user_id=e.seller_id
  left join public.marketplace_stores st on st.id=e.store_id
  left join public.products p on p.id=e.product_id
  left join auth.users u on u.id=e.creator_id
),attribution as(
  select a.*,e.id existing_entitlement,e.seller_id entitlement_seller,
    e.store_id entitlement_store,e.product_id entitlement_product,
    e.creator_id entitlement_creator,e.offer_scope entitlement_scope,
    e.commission_bps entitlement_bps,e.status entitlement_status,
    e.starts_at entitlement_starts_at,e.ends_at entitlement_ends_at,
    e.updated_at current_entitlement_updated_at,pv.id existing_variant,
    pv.product_id variant_product,pv.seller_id variant_seller,pv.store_id variant_store,
    u.id existing_creator
  from public.marketplace_creator_commerce_attributions a
  left join public.marketplace_live_affiliate_offers e on e.id=a.entitlement_id
  left join public.marketplace_product_variants pv on pv.id=a.variant_id
  left join auth.users u on u.id=a.creator_user_id
),snapshot as(
  select s.*,a.id existing_attribution,a.entitlement_id attribution_entitlement,
    a.seller_id attribution_seller,a.store_id attribution_store,
    a.product_id attribution_product,a.variant_id attribution_variant,
    a.creator_user_id attribution_creator,a.commission_bps attribution_bps,
    a.source_surface attribution_surface,a.source_entity_id attribution_source,
    i.id existing_item,i.order_id item_order,i.checkout_id item_checkout,
    i.seller_id item_seller,i.store_id item_store,i.product_id item_product,
    i.variant_id item_variant,i.line_total item_line_total,
    o.status order_status,pay.status payment_status,pa.id payment_allocation_id
  from public.marketplace_order_item_creator_attributions s
  left join public.marketplace_creator_commerce_attributions a on a.id=s.attribution_id
  left join public.marketplace_order_items i on i.id=s.order_item_id
  left join public.marketplace_orders o on o.id=s.order_id
  left join public.marketplace_payments pay on pay.checkout_id=s.checkout_id
  left join public.marketplace_payment_allocations pa on pa.order_id=s.order_id
),order_stats as(
  select s.order_id,count(*) attributed_count,count(distinct s.creator_user_id) creator_count,
    count(distinct s.commission_bps) bps_count,max(s.order_item_id::text)::uuid residual_item,
    round(sum(i.line_total),8) attributed_base,
    round(sum(round(i.line_total*s.commission_bps/10000.0,8)),8) provisional
  from public.marketplace_order_item_creator_attributions s
  join public.marketplace_order_items i on i.id=s.order_item_id group by s.order_id
),b7f as(
  select b.*,s.attribution_id,s.entitlement_id,s.source_surface,s.source_entity_id,
    i.line_total,stats.attributed_count,stats.creator_count,stats.bps_count,
    stats.residual_item,stats.attributed_base,stats.provisional,
    (select count(*) from public.marketplace_order_items oi where oi.order_id=b.order_id) order_item_count
  from public.marketplace_order_item_creator_allocations b
  left join public.marketplace_order_item_creator_attributions s on s.order_item_id=b.order_item_id
  left join public.marketplace_order_items i on i.id=b.order_item_id
  left join order_stats stats on stats.order_id=b.order_id
),activation as(
  select activated_at from public.marketplace_creator_commerce_authority_state where singleton
)
select jsonb_build_object(
  'orphan_entitlement',(select count(*) from entitlement where existing_seller is null
    or existing_store is null or existing_product is null),
  'wrong_entitlement_seller',(select count(*) from entitlement
    where product_seller is distinct from seller_id),
  'wrong_entitlement_store',(select count(*) from entitlement
    where product_store is distinct from store_id),
  'wrong_entitlement_product',(select count(*) from entitlement
    where existing_product is null),
  'wrong_entitlement_variant',(select count(*) from attribution
    where variant_id is not null and(existing_variant is null
      or variant_product is distinct from entitlement_product
      or variant_seller is distinct from entitlement_seller
      or variant_store is distinct from entitlement_store)),
  'missing_creator',(select count(*) from attribution where existing_creator is null),
  'invalid_entitlement_bps',(select count(*) from entitlement
    where commission_bps not between 1 and 3000),
  'invalid_entitlement_status',(select count(*) from entitlement
    where status not in('active','paused','removed')),
  'orphan_attribution',(select count(*) from attribution
    where existing_entitlement is null or existing_creator is null),
  'attribution_entitlement_mismatch',(select count(*) from attribution
    where commission_bps is distinct from entitlement_bps),
  'attribution_product_mismatch',(select count(*) from attribution
    where product_id is distinct from entitlement_product),
  'attribution_variant_mismatch',(select count(*) from attribution
    where variant_id is not null and(existing_variant is null
      or variant_product is distinct from product_id)),
  'attribution_creator_mismatch',(select count(*) from attribution
    where entitlement_scope='specific_creator'
      and creator_user_id is distinct from entitlement_creator),
  'attribution_seller_mismatch',(select count(*) from attribution
    where seller_id is distinct from entitlement_seller),
  'attribution_store_mismatch',(select count(*) from attribution
    where store_id is distinct from entitlement_store),
  'expired_attribution_created',(select count(*) from attribution
    where(entitlement_starts_at is not null and attributed_at<entitlement_starts_at)
      or(entitlement_ends_at is not null and attributed_at>=entitlement_ends_at)),
  'revoked_entitlement_new_attribution',(select count(*) from attribution
    where entitlement_status<>'active'
      and entitlement_updated_at_attribution is not distinct from current_entitlement_updated_at),
  'orphan_order_item_attribution',(select count(*) from snapshot
    where existing_attribution is null or existing_item is null),
  'order_item_product_mismatch',(select count(*) from snapshot
    where product_id is distinct from item_product
      or product_id is distinct from attribution_product),
  'order_item_variant_mismatch',(select count(*) from snapshot
    where variant_id is distinct from item_variant
      or(attribution_variant is not null and variant_id is distinct from attribution_variant)),
  'order_item_creator_mismatch',(select count(*) from snapshot
    where creator_user_id is distinct from attribution_creator),
  'order_item_commission_bps_mismatch',(select count(*) from snapshot
    where commission_bps is distinct from attribution_bps),
  'order_item_source_mismatch',(select count(*) from snapshot
    where source_surface is distinct from attribution_surface
      or source_entity_id is distinct from attribution_source),
  'duplicate_order_item_creator_attribution',(select count(*) from(
    select order_item_id from public.marketplace_order_item_creator_attributions
    group by order_item_id having count(*)>1)d),
  'frozen_attribution_mutation',(select count(*) from snapshot where request_fingerprint is distinct from
    encode(extensions.digest(concat_ws('|','marketplace_order_item_creator_attribution',
      order_item_id,attribution_id,order_id,checkout_id,seller_id,store_id,product_id,variant_id,
      creator_user_id,entitlement_id,commission_bps,source_surface,source_entity_id),
      'sha256'),'hex')),
  'missing_b7f_allocation',(select count(*) from snapshot
    where payment_status='paid' and payment_allocation_id is not null
      and not exists(select 1 from public.marketplace_order_item_creator_allocations b
        where b.order_item_id=snapshot.order_item_id)),
  'unexpected_b7f_allocation',(select count(*) from b7f cross join activation
    where b7f.created_at>=activation.activated_at and b7f.attribution_id is null),
  'b7f_creator_mismatch',(select count(*) from b7f
    join public.marketplace_order_item_creator_attributions s on s.order_item_id=b7f.order_item_id
    where b7f.creator_user_id is distinct from s.creator_user_id),
  'b7f_bps_mismatch',(select count(*) from b7f
    join public.marketplace_order_item_creator_attributions s on s.order_item_id=b7f.order_item_id
    where b7f.commission_bps is distinct from s.commission_bps),
  'b7f_base_mismatch',(select count(*) from b7f
    where attribution_id is not null and commission_base_amount is distinct from line_total),
  'b7f_amount_mismatch',(select count(*) from b7f
    where attribution_id is not null and commission_amount is distinct from
      round(line_total*commission_bps/10000.0,8)+case
        when order_item_id=residual_item and attributed_count=order_item_count
          and creator_count=1 and bps_count=1
        then round(attributed_base*commission_bps/10000.0,8)-provisional else 0 end),
  'allocation_without_valid_attribution',(select count(*) from b7f cross join activation
    where b7f.created_at>=activation.activated_at and(
      attribution_id is null or entitlement_id is null
      or creator_user_id is distinct from(select s.creator_user_id
        from public.marketplace_order_item_creator_attributions s
        where s.order_item_id=b7f.order_item_id))),
  'settlement_without_creator_authority',(select count(*)
    from public.marketplace_order_settlements s cross join activation
    where s.created_at>=activation.activated_at and s.creator_commission_amount>0
      and not exists(select 1 from public.marketplace_order_item_creator_attributions a
        where a.order_id=s.order_id)),
  'live_source_attribution_mismatch',(select count(*)
    from public.marketplace_order_item_creator_attributions s
    left join public.marketplace_live_order_sources src
      on src.live_session_product_id=s.source_entity_id and src.order_id=s.order_id
    left join public.live_session_products pin on pin.id=s.source_entity_id
    where s.source_surface='live' and(src.id is null or pin.id is null
      or src.product_id is distinct from s.product_id
      or src.variant_id is distinct from s.variant_id
      or src.live_host_id is distinct from s.creator_user_id
      or pin.affiliate_offer_id is distinct from s.entitlement_id
      or pin.creator_commission_bps is distinct from s.commission_bps)),
  'self_attribution_violation',(select count(*) from attribution
    where creator_user_id=seller_id),
  'request_fingerprint_invalid',(
    (select count(*) from attribution where char_length(request_fingerprint)<>64
      or request_fingerprint!~'^[0-9a-f]{64}$'
      or request_fingerprint is distinct from encode(extensions.digest(concat_ws('|',
        'marketplace_creator_commerce_attribution',entitlement_id,creator_user_id,
        coalesce(variant_id::text,''),source_surface,source_entity_id),'sha256'),'hex'))
    +(select count(*) from snapshot where char_length(request_fingerprint)<>64
      or request_fingerprint!~'^[0-9a-f]{64}$'))
)$$;

comment on table public.marketplace_creator_commerce_attributions is
  'Server-issued, non-financial creator-commerce attribution. Supported B7A surfaces are live and direct_creator_link. Future showcase/feed/reel surfaces must resolve the same seller offer before adding their constrained surface value.';
comment on table public.marketplace_order_item_creator_attributions is
  'Immutable checkout-time entitlement snapshot consumed by the service-only B7A finalizer and B7F financial allocation authority.';
comment on function public.create_marketplace_creator_checkout_reservation(jsonb,jsonb,uuid) is
  'Authenticated checkout trust boundary. Each item accepts only variant_id, quantity, and an optional opaque attribution_id; commission and commercial identities are server-derived.';
comment on function public.finalize_marketplace_creator_commerce_for_order(uuid,uuid) is
  'Service-only B7A to B7F handoff. Acquires the canonical settlement lock before materializing B7F item allocations.';

revoke all on public.marketplace_creator_commerce_authority_state,
  public.marketplace_creator_commerce_attributions,
  public.marketplace_order_item_creator_attributions,
  public.marketplace_creator_checkout_commands from public,anon,authenticated;
revoke all on public.marketplace_creator_commerce_authority_state,
  public.marketplace_creator_commerce_attributions,
  public.marketplace_order_item_creator_attributions,
  public.marketplace_creator_checkout_commands from service_role;
grant select on public.marketplace_creator_commerce_authority_state,
  public.marketplace_creator_commerce_attributions,
  public.marketplace_order_item_creator_attributions,
  public.marketplace_creator_checkout_commands to service_role;

revoke all on function public.marketplace_reject_creator_commerce_snapshot_mutation(),
  public.marketplace_create_creator_commerce_attribution_internal(uuid,uuid,uuid,text,uuid,uuid),
  public.marketplace_freeze_order_item_creator_attribution_internal(uuid,uuid,uuid),
  public.marketplace_snapshot_live_creator_attribution(),
  public.marketplace_apply_live_commission(),
  public.marketplace_record_live_purchase() from public,anon,authenticated,service_role;

revoke all on function public.create_marketplace_creator_commerce_attribution(
  uuid,uuid,uuid,text,uuid,uuid),
  public.freeze_marketplace_order_item_creator_attribution(uuid,uuid,uuid),
  public.finalize_marketplace_creator_commerce_for_order(uuid,uuid),
  public.reconcile_marketplace_creator_commerce() from public,anon,authenticated;
grant execute on function public.create_marketplace_creator_commerce_attribution(
  uuid,uuid,uuid,text,uuid,uuid),
  public.freeze_marketplace_order_item_creator_attribution(uuid,uuid,uuid),
  public.finalize_marketplace_creator_commerce_for_order(uuid,uuid),
  public.reconcile_marketplace_creator_commerce() to service_role;

revoke all on function public.create_marketplace_creator_checkout_reservation(jsonb,jsonb,uuid)
  from public,anon;
grant execute on function public.create_marketplace_creator_checkout_reservation(jsonb,jsonb,uuid)
  to authenticated,service_role;
