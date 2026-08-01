begin;

-- MKT-A3B: pending-payment reservations only. MKT-A3C must consume inventory
-- and transfer BDAG together in one future authoritative transaction.

create table public.marketplace_checkout_sessions (
  id uuid primary key default gen_random_uuid(), reference text unique not null,
  buyer_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending_payment', currency text not null default 'BDAG',
  subtotal numeric(20,8) not null, total numeric(20,8) not null,
  idempotency_key uuid not null, request_fingerprint text not null,
  expires_at timestamptz not null, cancelled_at timestamptz, expired_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint marketplace_checkout_status_check check(status in ('pending_payment','payment_processing','paid','cancelled','expired','failed')),
  constraint marketplace_checkout_currency_check check(currency='BDAG'),
  constraint marketplace_checkout_amount_check check(subtotal>0 and subtotal=round(subtotal,8) and total=subtotal),
  constraint marketplace_checkout_expiry_check check(expires_at>created_at),
  constraint marketplace_checkout_terminal_check check(
    (status='cancelled' and cancelled_at is not null and expired_at is null) or
    (status='expired' and expired_at is not null and cancelled_at is null) or
    (status not in ('cancelled','expired') and cancelled_at is null and expired_at is null)),
  unique(buyer_id,idempotency_key)
);
create unique index marketplace_checkout_one_pending_buyer on public.marketplace_checkout_sessions(buyer_id) where status='pending_payment';
create index marketplace_checkout_pending_expiry_idx on public.marketplace_checkout_sessions(expires_at) where status='pending_payment';

create table public.marketplace_checkout_shipping_addresses (
  checkout_id uuid primary key references public.marketplace_checkout_sessions(id) on delete restrict,
  recipient_name text not null, line1 text not null, line2 text, city text not null,
  region text not null, postal_code text not null, country text not null, phone text,
  created_at timestamptz not null default now(),
  constraint marketplace_shipping_recipient_check check(recipient_name=btrim(recipient_name) and char_length(recipient_name) between 2 and 120),
  constraint marketplace_shipping_line1_check check(line1=btrim(line1) and char_length(line1) between 2 and 180),
  constraint marketplace_shipping_line2_check check(line2 is null or (line2=btrim(line2) and char_length(line2) between 1 and 180)),
  constraint marketplace_shipping_city_check check(city=btrim(city) and char_length(city) between 1 and 100),
  constraint marketplace_shipping_region_check check(region=btrim(region) and char_length(region) between 1 and 100),
  constraint marketplace_shipping_postal_check check(postal_code=btrim(postal_code) and char_length(postal_code) between 1 and 30),
  constraint marketplace_shipping_country_check check(country=btrim(country) and char_length(country) between 2 and 100),
  constraint marketplace_shipping_phone_check check(phone is null or (phone=btrim(phone) and char_length(phone) between 1 and 40))
);

create table public.marketplace_orders (
  id uuid primary key default gen_random_uuid(), order_number text unique not null,
  checkout_id uuid not null references public.marketplace_checkout_sessions(id) on delete restrict,
  buyer_id uuid not null references auth.users(id) on delete restrict,
  seller_id uuid not null references public.marketplace_sellers(user_id) on delete restrict,
  store_id uuid not null references public.marketplace_stores(id) on delete restrict,
  status text not null default 'pending_payment', currency text not null default 'BDAG',
  subtotal numeric(20,8) not null, total numeric(20,8) not null,
  reservation_expires_at timestamptz not null, confirmed_at timestamptz,
  cancelled_at timestamptz, expired_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint marketplace_orders_status_check check(status in ('pending_payment','confirmed','processing','shipped','delivered','cancelled','expired','refunded','partially_refunded')),
  constraint marketplace_orders_currency_check check(currency='BDAG'),
  constraint marketplace_orders_amount_check check(subtotal>0 and subtotal=round(subtotal,8) and total=subtotal),
  constraint marketplace_orders_terminal_check check(
    (status='cancelled' and cancelled_at is not null and expired_at is null) or
    (status='expired' and expired_at is not null and cancelled_at is null) or
    (status not in ('cancelled','expired') and cancelled_at is null and expired_at is null)),
  unique(checkout_id,store_id)
);
create index marketplace_orders_buyer_idx on public.marketplace_orders(buyer_id,created_at desc);

create table public.marketplace_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.marketplace_orders(id) on delete restrict,
  checkout_id uuid not null references public.marketplace_checkout_sessions(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  variant_id uuid not null references public.marketplace_product_variants(id) on delete restrict,
  seller_id uuid not null references public.marketplace_sellers(user_id) on delete restrict,
  store_id uuid not null references public.marketplace_stores(id) on delete restrict,
  product_title text not null, variant_title text, sku text not null, option_snapshot jsonb not null,
  image_url text, currency text not null default 'BDAG', unit_price numeric(20,8) not null,
  quantity integer not null, line_total numeric(20,8) not null, created_at timestamptz not null default now(),
  constraint marketplace_order_items_quantity_check check(quantity between 1 and 1000),
  constraint marketplace_order_items_price_check check(unit_price>0 and unit_price=round(unit_price,8) and line_total=round(unit_price*quantity,8)),
  constraint marketplace_order_items_currency_check check(currency='BDAG'),
  constraint marketplace_order_items_options_check check(jsonb_typeof(option_snapshot)='array'),
  constraint marketplace_order_items_image_check check(image_url is null or image_url ~ '^https://'),
  unique(order_id,variant_id)
);

create table public.marketplace_inventory_reservations (
  id uuid primary key default gen_random_uuid(), checkout_id uuid not null references public.marketplace_checkout_sessions(id) on delete restrict,
  order_id uuid not null references public.marketplace_orders(id) on delete restrict,
  order_item_id uuid not null unique references public.marketplace_order_items(id) on delete restrict,
  buyer_id uuid not null references auth.users(id) on delete restrict,
  variant_id uuid not null references public.marketplace_product_variants(id) on delete restrict,
  quantity integer not null, status text not null default 'active', expires_at timestamptz not null,
  released_at timestamptz, release_reason text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint marketplace_reservations_quantity_check check(quantity between 1 and 1000),
  constraint marketplace_reservations_status_check check(status in ('active','consumed','released','expired')),
  constraint marketplace_reservations_release_check check(
    (status in ('released','expired') and released_at is not null) or
    (status in ('active','consumed') and released_at is null)),
  unique(checkout_id,variant_id)
);
create index marketplace_reservations_active_expiry_idx on public.marketplace_inventory_reservations(expires_at) where status='active';

create table public.marketplace_inventory_reservation_events (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.marketplace_inventory_reservations(id) on delete restrict,
  checkout_id uuid not null references public.marketplace_checkout_sessions(id) on delete restrict,
  variant_id uuid not null references public.marketplace_product_variants(id) on delete restrict,
  event_type text not null, quantity_delta integer not null, previous_reserved integer not null,
  resulting_reserved integer not null, reason text, actor_id uuid,
  created_at timestamptz not null default now(),
  constraint marketplace_reservation_event_type_check check(event_type in ('reserve','release','expire','consume')),
  constraint marketplace_reservation_event_math_check check(resulting_reserved-previous_reserved=quantity_delta),
  constraint marketplace_reservation_event_counts_check check(previous_reserved>=0 and resulting_reserved>=0)
);
create index marketplace_reservation_events_variant_idx on public.marketplace_inventory_reservation_events(variant_id,created_at desc);

create trigger marketplace_checkout_set_updated_at before update on public.marketplace_checkout_sessions
for each row execute function public.marketplace_set_updated_at();
create trigger marketplace_orders_set_updated_at before update on public.marketplace_orders
for each row execute function public.marketplace_set_updated_at();
create trigger marketplace_reservations_set_updated_at before update on public.marketplace_inventory_reservations
for each row execute function public.marketplace_set_updated_at();

create or replace function public.marketplace_reject_order_item_mutation()
returns trigger language plpgsql set search_path=public as $$ begin
  raise exception using errcode='42501',message='marketplace_order_items_immutable';
end; $$;
create trigger marketplace_order_items_immutable before update or delete on public.marketplace_order_items
for each row execute function public.marketplace_reject_order_item_mutation();
create trigger marketplace_reservation_events_append_only before update or delete on public.marketplace_inventory_reservation_events
for each row execute function public.marketplace_reject_order_item_mutation();

create or replace function public.marketplace_checkout_response(p_checkout_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
select jsonb_build_object(
 'checkout',jsonb_build_object('id',c.id,'reference',c.reference,'status',c.status,'currency',c.currency,
   'subtotal',c.subtotal,'total',c.total,'expires_at',c.expires_at,'created_at',c.created_at),
 'shipping_address',jsonb_build_object('recipient_name',a.recipient_name,'line1',a.line1,'line2',a.line2,
   'city',a.city,'region',a.region,'postal_code',a.postal_code,'country',a.country,'phone',a.phone),
 'orders',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'order_number',o.order_number,
   'seller_id',o.seller_id,'store_id',o.store_id,'status',o.status,'subtotal',o.subtotal,'total',o.total,
   'reservation_expires_at',o.reservation_expires_at,'items',coalesce((select jsonb_agg(jsonb_build_object(
     'id',i.id,'product_id',i.product_id,'variant_id',i.variant_id,'product_title',i.product_title,
     'variant_title',i.variant_title,'sku',i.sku,'options',i.option_snapshot,'image_url',i.image_url,
     'currency',i.currency,'unit_price',i.unit_price,'quantity',i.quantity,'line_total',i.line_total,
     'reservation_status',r.status) order by i.created_at)
     from public.marketplace_order_items i join public.marketplace_inventory_reservations r on r.order_item_id=i.id
     where i.order_id=o.id),'[]'::jsonb)) order by o.created_at)
   from public.marketplace_orders o where o.checkout_id=c.id),'[]'::jsonb)
)
from public.marketplace_checkout_sessions c
join public.marketplace_checkout_shipping_addresses a on a.checkout_id=c.id
where c.id=p_checkout_id;
$$;

create or replace function public.marketplace_release_checkout(p_checkout_id uuid,p_terminal_status text,p_reason text,p_actor uuid)
returns void language plpgsql security definer set search_path=public as $$
declare r record; l public.marketplace_inventory_levels; v_products uuid[]:=array[]::uuid[];
begin
  if p_terminal_status not in ('cancelled','expired') then raise exception using message='marketplace_invalid_release_status'; end if;
  perform 1 from public.marketplace_checkout_sessions where id=p_checkout_id for update;
  for r in select ir.* from public.marketplace_inventory_reservations ir
    where ir.checkout_id=p_checkout_id and ir.status='active' order by ir.variant_id for update loop
    select * into l from public.marketplace_inventory_levels where variant_id=r.variant_id for update;
    if l.reserved<r.quantity then raise exception using message='marketplace_invalid_reserved_inventory'; end if;
    update public.marketplace_inventory_levels set reserved=reserved-r.quantity,version=version+1 where variant_id=r.variant_id;
    insert into public.marketplace_inventory_reservation_events(reservation_id,checkout_id,variant_id,event_type,
      quantity_delta,previous_reserved,resulting_reserved,reason,actor_id)
    values(r.id,p_checkout_id,r.variant_id,case when p_terminal_status='expired' then 'expire' else 'release' end,
      -r.quantity,l.reserved,l.reserved-r.quantity,p_reason,p_actor);
    update public.marketplace_inventory_reservations set status=case when p_terminal_status='expired' then 'expired' else 'released' end,
      released_at=now(),release_reason=p_reason where id=r.id and status='active';
    v_products:=array_append(v_products,(select product_id from public.marketplace_product_variants where id=r.variant_id));
  end loop;
  update public.marketplace_orders set status=p_terminal_status,
    cancelled_at=case when p_terminal_status='cancelled' then now() else null end,
    expired_at=case when p_terminal_status='expired' then now() else null end
    where checkout_id=p_checkout_id and status='pending_payment';
  update public.marketplace_checkout_sessions set status=p_terminal_status,
    cancelled_at=case when p_terminal_status='cancelled' then now() else null end,
    expired_at=case when p_terminal_status='expired' then now() else null end
    where id=p_checkout_id and status='pending_payment';
  for r in select distinct unnest(v_products) product_id loop perform public.refresh_marketplace_product_projection(r.product_id); end loop;
end; $$;

create or replace function public.expire_marketplace_checkout_reservations(p_limit integer default 100)
returns integer language plpgsql security definer set search_path=public as $$
declare c record; v_count integer:=0;
begin
  if p_limit<1 or p_limit>100 then raise exception using errcode='22023',message='marketplace_invalid_expiration_limit'; end if;
  for c in select id from public.marketplace_checkout_sessions where status='pending_payment' and expires_at<=now()
    order by expires_at,id for update skip locked limit p_limit loop
    perform public.marketplace_release_checkout(c.id,'expired','reservation_expired',null); v_count:=v_count+1;
  end loop;
  return v_count;
end; $$;

create or replace function public.create_marketplace_checkout_reservation(p_items jsonb,p_shipping_address jsonb,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_fingerprint text; v_prior public.marketplace_checkout_sessions;
  v_checkout uuid:=gen_random_uuid(); v_expires timestamptz:=now()+interval '15 minutes';
  v_subtotal numeric(20,8):=0; x record; v_variant public.marketplace_product_variants;
  v_product public.products; v_inventory public.marketplace_inventory_levels; v_order uuid; v_item uuid;
  v_line numeric(20,8); v_options jsonb; v_image text; v_address jsonb; v_total_qty bigint;
begin
  if v_user is null then raise exception using errcode='42501',message='marketplace_auth_required'; end if;
  if p_idempotency_key is null then raise exception using errcode='22023',message='marketplace_idempotency_key_required'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>100 then
    raise exception using errcode='22023',message='marketplace_invalid_checkout_items'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) e where jsonb_typeof(e)<>'object' or jsonb_object_length(e)<>2
    or not(e?'variant_id' and e?'quantity') or (e->>'variant_id') is null or (e->>'quantity')!~ '^[1-9][0-9]{0,2}$') then
    raise exception using errcode='22023',message='marketplace_invalid_checkout_items'; end if;
  if (select count(*)<>count(distinct (e->>'variant_id')) from jsonb_array_elements(p_items)e) then
    raise exception using errcode='22023',message='marketplace_duplicate_variant'; end if;
  select sum((e->>'quantity')::integer) into v_total_qty from jsonb_array_elements(p_items)e;
  if v_total_qty>1000 then raise exception using errcode='22023',message='marketplace_invalid_checkout_items'; end if;
  v_address:=jsonb_build_object('recipient_name',btrim(coalesce(p_shipping_address->>'recipient_name','')),
    'line1',btrim(coalesce(p_shipping_address->>'line1','')),'line2',nullif(btrim(coalesce(p_shipping_address->>'line2','')),''),
    'city',btrim(coalesce(p_shipping_address->>'city','')),'region',btrim(coalesce(p_shipping_address->>'region','')),
    'postal_code',btrim(coalesce(p_shipping_address->>'postal_code','')),'country',btrim(coalesce(p_shipping_address->>'country','')),
    'phone',nullif(btrim(coalesce(p_shipping_address->>'phone','')),''));
  if char_length(v_address->>'recipient_name') not between 2 and 120 or char_length(v_address->>'line1') not between 2 and 180
    or char_length(v_address->>'city') not between 1 and 100 or char_length(v_address->>'region') not between 1 and 100
    or char_length(v_address->>'postal_code') not between 1 and 30 or char_length(v_address->>'country') not between 2 and 100
    or char_length(coalesce(v_address->>'line2',''))>180 or char_length(coalesce(v_address->>'phone',''))>40 then
    raise exception using errcode='22023',message='marketplace_invalid_shipping_address'; end if;
  v_fingerprint:=encode(digest((select jsonb_agg(jsonb_build_object('variant_id',e->>'variant_id','quantity',(e->>'quantity')::integer)
    order by e->>'variant_id')::text from jsonb_array_elements(p_items)e)||v_address::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_user::text||':'||p_idempotency_key::text,0));
  perform pg_advisory_xact_lock(hashtextextended('marketplace-checkout-buyer:'||v_user::text,0));
  select * into v_prior from public.marketplace_checkout_sessions where buyer_id=v_user and idempotency_key=p_idempotency_key;
  if found then
    if v_prior.request_fingerprint<>v_fingerprint then raise exception using errcode='23505',message='marketplace_idempotency_conflict'; end if;
    return public.marketplace_checkout_response(v_prior.id);
  end if;
  perform public.expire_marketplace_checkout_reservations(100);
  if exists(select 1 from public.marketplace_checkout_sessions where buyer_id=v_user and status='pending_payment') then
    raise exception using errcode='23505',message='marketplace_active_checkout_exists'; end if;
  perform 1 from public.marketplace_inventory_levels l join public.marketplace_product_variants v on v.id=l.variant_id
    join jsonb_array_elements(p_items)e on v.id=(e->>'variant_id')::uuid order by v.id for update of v,l;
  for x in select (e->>'variant_id')::uuid variant_id,(e->>'quantity')::integer quantity
    from jsonb_array_elements(p_items)e order by (e->>'variant_id')::uuid loop
    select * into v_variant from public.marketplace_product_variants where id=x.variant_id;
    if not found or v_variant.status<>'active' or v_variant.archived_at is not null then raise exception using message='marketplace_variant_unavailable'; end if;
    select * into v_product from public.products where id=v_variant.product_id;
    if not found or v_product.status<>'active' or v_product.published_at is null or v_product.deleted_at is not null
      or v_product.moderation_status<>'approved' or v_product.currency<>'BDAG'
      or not exists(select 1 from public.marketplace_stores s where s.id=v_variant.store_id and s.status='active')
      or not public.marketplace_seller_is_approved(v_variant.seller_id) then raise exception using message='marketplace_product_unavailable'; end if;
    if v_variant.seller_id=v_user then raise exception using message='marketplace_own_product_forbidden'; end if;
    select * into v_inventory from public.marketplace_inventory_levels where variant_id=x.variant_id;
    if v_inventory.on_hand-v_inventory.reserved<x.quantity then
      raise exception using message='marketplace_insufficient_inventory',detail=jsonb_build_object('variant_id',x.variant_id,
        'requested',x.quantity,'available',greatest(v_inventory.on_hand-v_inventory.reserved,0))::text; end if;
    v_subtotal:=v_subtotal+round(v_variant.price*x.quantity,8);
  end loop;
  insert into public.marketplace_checkout_sessions(id,reference,buyer_id,subtotal,total,idempotency_key,request_fingerprint,expires_at)
    values(v_checkout,'CHK-'||upper(substr(replace(v_checkout::text,'-',''),1,16)),v_user,v_subtotal,v_subtotal,p_idempotency_key,v_fingerprint,v_expires);
  insert into public.marketplace_checkout_shipping_addresses(checkout_id,recipient_name,line1,line2,city,region,postal_code,country,phone)
    values(v_checkout,v_address->>'recipient_name',v_address->>'line1',v_address->>'line2',v_address->>'city',v_address->>'region',v_address->>'postal_code',v_address->>'country',v_address->>'phone');
  for x in select (e->>'variant_id')::uuid variant_id,(e->>'quantity')::integer quantity from jsonb_array_elements(p_items)e order by (e->>'variant_id')::uuid loop
    select * into v_variant from public.marketplace_product_variants where id=x.variant_id;
    select * into v_product from public.products where id=v_variant.product_id;
    select id into v_order from public.marketplace_orders where checkout_id=v_checkout and store_id=v_variant.store_id;
    if v_order is null then v_order:=gen_random_uuid(); insert into public.marketplace_orders(id,order_number,checkout_id,buyer_id,seller_id,store_id,subtotal,total,reservation_expires_at)
      values(v_order,'ORD-'||upper(substr(replace(v_order::text,'-',''),1,16)),v_checkout,v_user,v_variant.seller_id,v_variant.store_id,v_variant.price*x.quantity,v_variant.price*x.quantity,v_expires);
    else update public.marketplace_orders set subtotal=subtotal+v_variant.price*x.quantity,total=total+v_variant.price*x.quantity where id=v_order; end if;
    select coalesce(jsonb_agg(jsonb_build_object('option_id',o.id,'option_name',o.name,'value_id',ov.id,'value',ov.value) order by o.position),'[]'::jsonb)
      into v_options from public.marketplace_variant_option_values vv join public.marketplace_product_option_values ov on ov.id=vv.option_value_id
      join public.marketplace_product_options o on o.id=ov.option_id where vv.variant_id=x.variant_id;
    select a.public_url into v_image from public.media_assets a where a.id=v_variant.image_asset_id and a.status='ready';
    v_line:=round(v_variant.price*x.quantity,8); v_item:=gen_random_uuid();
    insert into public.marketplace_order_items(id,order_id,checkout_id,product_id,variant_id,seller_id,store_id,product_title,variant_title,sku,option_snapshot,image_url,unit_price,quantity,line_total)
      values(v_item,v_order,v_checkout,v_product.id,v_variant.id,v_variant.seller_id,v_variant.store_id,v_product.title,v_variant.title,v_variant.sku,v_options,v_image,v_variant.price,x.quantity,v_line);
    select * into v_inventory from public.marketplace_inventory_levels where variant_id=x.variant_id;
    update public.marketplace_inventory_levels set reserved=reserved+x.quantity,version=version+1 where variant_id=x.variant_id;
    insert into public.marketplace_inventory_reservations(checkout_id,order_id,order_item_id,buyer_id,variant_id,quantity,expires_at)
      values(v_checkout,v_order,v_item,v_user,x.variant_id,x.quantity,v_expires) returning id into v_item;
    insert into public.marketplace_inventory_reservation_events(reservation_id,checkout_id,variant_id,event_type,quantity_delta,previous_reserved,resulting_reserved,reason,actor_id)
      values(v_item,v_checkout,x.variant_id,'reserve',x.quantity,v_inventory.reserved,v_inventory.reserved+x.quantity,'checkout_created',v_user);
  end loop;
  for x in select distinct v.product_id from public.marketplace_product_variants v join jsonb_array_elements(p_items)e on v.id=(e->>'variant_id')::uuid loop
    perform public.refresh_marketplace_product_projection(x.product_id); end loop;
  return public.marketplace_checkout_response(v_checkout);
end; $$;

create or replace function public.cancel_marketplace_checkout_reservation(p_checkout_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.marketplace_checkout_sessions;
begin
  select * into c from public.marketplace_checkout_sessions where id=p_checkout_id and buyer_id=auth.uid() for update;
  if not found then raise exception using errcode='P0002',message='marketplace_checkout_not_found'; end if;
  if c.status in ('cancelled','expired') then return public.marketplace_checkout_response(c.id); end if;
  if c.status<>'pending_payment' then raise exception using errcode='22023',message='marketplace_checkout_not_cancellable'; end if;
  perform public.marketplace_release_checkout(c.id,'cancelled','buyer_cancelled',auth.uid());
  return public.marketplace_checkout_response(c.id);
end; $$;

create or replace function public.fetch_my_marketplace_checkout(p_checkout_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null or not exists(select 1 from public.marketplace_checkout_sessions where id=p_checkout_id and buyer_id=auth.uid()) then
    raise exception using errcode='P0002',message='marketplace_checkout_not_found'; end if;
  return public.marketplace_checkout_response(p_checkout_id);
end; $$;

create or replace function public.fetch_my_active_marketplace_checkout()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='marketplace_auth_required'; end if;
  perform public.expire_marketplace_checkout_reservations(100);
  select id into v_id from public.marketplace_checkout_sessions where buyer_id=auth.uid() and status='pending_payment' limit 1;
  return case when v_id is null then null else public.marketplace_checkout_response(v_id) end;
end; $$;

alter table public.marketplace_checkout_sessions enable row level security;
alter table public.marketplace_checkout_shipping_addresses enable row level security;
alter table public.marketplace_orders enable row level security;
alter table public.marketplace_order_items enable row level security;
alter table public.marketplace_inventory_reservations enable row level security;
alter table public.marketplace_inventory_reservation_events enable row level security;
create policy marketplace_checkout_buyer_read on public.marketplace_checkout_sessions for select to authenticated using(buyer_id=auth.uid());
create policy marketplace_shipping_buyer_read on public.marketplace_checkout_shipping_addresses for select to authenticated using(exists(select 1 from public.marketplace_checkout_sessions c where c.id=checkout_id and c.buyer_id=auth.uid()));
create policy marketplace_orders_buyer_read on public.marketplace_orders for select to authenticated using(buyer_id=auth.uid());
create policy marketplace_order_items_buyer_read on public.marketplace_order_items for select to authenticated using(exists(select 1 from public.marketplace_checkout_sessions c where c.id=checkout_id and c.buyer_id=auth.uid()));
create policy marketplace_reservations_buyer_read on public.marketplace_inventory_reservations for select to authenticated using(buyer_id=auth.uid());

revoke all on public.marketplace_checkout_sessions,public.marketplace_checkout_shipping_addresses,public.marketplace_orders,
 public.marketplace_order_items,public.marketplace_inventory_reservations,public.marketplace_inventory_reservation_events from public,anon,authenticated;
grant select on public.marketplace_checkout_sessions,public.marketplace_checkout_shipping_addresses,public.marketplace_orders,
 public.marketplace_order_items,public.marketplace_inventory_reservations to authenticated;
grant all on public.marketplace_checkout_sessions,public.marketplace_checkout_shipping_addresses,public.marketplace_orders,
 public.marketplace_order_items,public.marketplace_inventory_reservations,public.marketplace_inventory_reservation_events to service_role;
revoke all on function public.marketplace_checkout_response(uuid),public.marketplace_release_checkout(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.marketplace_checkout_response(uuid),public.marketplace_release_checkout(uuid,text,text,uuid) to service_role;
revoke all on function public.create_marketplace_checkout_reservation(jsonb,jsonb,uuid),public.cancel_marketplace_checkout_reservation(uuid),
 public.expire_marketplace_checkout_reservations(integer),public.fetch_my_marketplace_checkout(uuid),public.fetch_my_active_marketplace_checkout() from public,anon;
grant execute on function public.create_marketplace_checkout_reservation(jsonb,jsonb,uuid),public.cancel_marketplace_checkout_reservation(uuid),
 public.expire_marketplace_checkout_reservations(integer),public.fetch_my_marketplace_checkout(uuid),public.fetch_my_active_marketplace_checkout() to authenticated,service_role;

do $$ begin
  if exists(select 1 from pg_extension where extname='pg_cron') and not exists(select 1 from cron.job where jobname='expire-marketplace-checkout-reservations') then
    perform cron.schedule('expire-marketplace-checkout-reservations','* * * * *','select public.expire_marketplace_checkout_reservations(100)');
  end if;
exception when undefined_table or insufficient_privilege then null; end $$;

commit;
