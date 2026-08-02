begin;

create table public.marketplace_live_affiliate_offer_commands (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.marketplace_sellers(user_id),
  idempotency_key uuid not null,
  request_fingerprint text not null check (char_length(btrim(request_fingerprint)) > 0),
  result_json jsonb not null check (jsonb_typeof(result_json) = 'object'),
  created_at timestamptz not null default now(),
  unique (seller_id, idempotency_key)
);

alter table public.marketplace_live_affiliate_offer_commands enable row level security;
revoke all on public.marketplace_live_affiliate_offer_commands from public, anon, authenticated;

create table public.live_commerce_host_purchase_events (
  id uuid primary key,
  session_id uuid not null references public.live_sessions(id),
  host_id uuid not null references auth.users(id),
  buyer_display_name text not null check (char_length(btrim(buyer_display_name)) between 1 and 80),
  product_title text not null check (char_length(btrim(product_title)) between 1 and 200),
  product_image_url text,
  quantity integer not null check (quantity > 0),
  currency text not null default 'BDAG' check (currency = 'BDAG'),
  gross_amount numeric(20,8) not null check (gross_amount > 0),
  creator_commission_amount numeric(20,8) not null default 0 check (creator_commission_amount >= 0),
  created_at timestamptz not null default now()
);

create index live_host_purchase_events_session_idx
  on public.live_commerce_host_purchase_events(session_id, created_at desc, id desc);

alter table public.live_commerce_host_purchase_events enable row level security;
create policy live_host_purchase_events_read
  on public.live_commerce_host_purchase_events
  for select to authenticated
  using (host_id = auth.uid());

revoke all on public.live_commerce_host_purchase_events from public, anon, authenticated;
grant select on public.live_commerce_host_purchase_events to authenticated;

create trigger live_host_purchase_event_immutable
  before update or delete on public.live_commerce_host_purchase_events
  for each row execute function public.reject_marketplace_live_source_mutation();

drop policy if exists live_purchase_host_read on public.live_commerce_purchase_events;
revoke select on public.live_commerce_purchase_events from authenticated;

do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'live_commerce_purchase_events'
  ) then
    alter publication supabase_realtime drop table public.live_commerce_purchase_events;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'live_commerce_host_purchase_events'
  ) then
    alter publication supabase_realtime add table public.live_commerce_host_purchase_events;
  end if;
end
$$;

create or replace function public.marketplace_mirror_live_purchase_for_host()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  item public.marketplace_order_items;
  safe_image text;
begin
  select * into item
  from public.marketplace_order_items
  where id = new.order_item_id;

  select public.marketplace_safe_public_image_url(p.images[1])
  into safe_image
  from public.products p
  where p.id = new.product_id;

  insert into public.live_commerce_host_purchase_events(
    id, session_id, host_id, buyer_display_name, product_title,
    product_image_url, quantity, currency, gross_amount,
    creator_commission_amount, created_at
  ) values (
    new.id, new.session_id, new.host_id, new.buyer_display_name,
    item.product_title, safe_image, new.quantity, new.currency,
    new.gross_amount, new.creator_commission_amount, new.created_at
  ) on conflict (id) do nothing;
  return new;
end
$$;

create trigger marketplace_live_purchase_safe_mirror
  after insert on public.live_commerce_purchase_events
  for each row execute function public.marketplace_mirror_live_purchase_for_host();

revoke all on function public.marketplace_mirror_live_purchase_for_host() from public, anon, authenticated;

create or replace function public.marketplace_live_affiliate_pin_is_valid(
  p_pin_id uuid,
  p_host_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.live_session_products lp
    join public.marketplace_live_affiliate_offers o
      on o.id = lp.affiliate_offer_id
     and o.product_id = lp.product_id
     and o.seller_id = lp.seller_id
     and o.store_id = lp.store_id
    where lp.id = p_pin_id
      and lp.host_id = p_host_id
      and lp.commerce_mode = 'affiliate_product'
      and o.status = 'active'
      and (o.starts_at is null or o.starts_at <= now())
      and (o.ends_at is null or o.ends_at > now())
      and (o.offer_scope = 'public_creator' or o.creator_id = p_host_id)
      and o.commission_bps = lp.creator_commission_bps
  )
$$;

revoke all on function public.marketplace_live_affiliate_pin_is_valid(uuid,uuid) from public, anon, authenticated;

create or replace function public.marketplace_validate_featured_affiliate_pin()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.is_featured and new.commerce_mode = 'affiliate_product'
    and not public.marketplace_live_affiliate_pin_is_valid(new.id, new.host_id) then
    raise exception using message = 'live_affiliate_offer_unavailable';
  end if;
  return new;
end
$$;

create trigger live_featured_affiliate_offer_guard
  before update of is_featured on public.live_session_products
  for each row when (new.is_featured)
  execute function public.marketplace_validate_featured_affiliate_pin();

revoke all on function public.marketplace_validate_featured_affiliate_pin() from public, anon, authenticated;

create or replace function public.upsert_my_live_affiliate_offer(
  p_product_id uuid,
  p_offer_scope text,
  p_creator_id uuid,
  p_commission_bps integer,
  p_status text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  fingerprint text;
  prior public.marketplace_live_affiliate_offer_commands;
  product_row public.products;
  store_row public.marketplace_stores;
  offer_row public.marketplace_live_affiliate_offers;
  result jsonb;
begin
  if actor is null or p_product_id is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'live_affiliate_invalid_offer';
  end if;
  if p_offer_scope not in ('public_creator','specific_creator')
    or p_status not in ('active','paused','removed')
    or p_commission_bps not between 1 and 3000
    or (p_offer_scope = 'public_creator' and p_creator_id is not null)
    or (p_offer_scope = 'specific_creator' and p_creator_id is null)
    or (p_ends_at is not null and p_starts_at is not null and p_ends_at <= p_starts_at) then
    raise exception using message = 'live_affiliate_invalid_offer';
  end if;

  fingerprint := encode(extensions.digest(concat_ws('|', 'affiliate-offer', p_product_id,
    p_offer_scope, coalesce(p_creator_id::text,''), p_commission_bps, p_status,
    coalesce(p_starts_at::text,''), coalesce(p_ends_at::text,'')), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':live-offer:' || p_idempotency_key::text, 0));
  select * into prior from public.marketplace_live_affiliate_offer_commands
    where seller_id = actor and idempotency_key = p_idempotency_key;
  if found then
    if prior.request_fingerprint <> fingerprint then
      raise exception using message = 'live_affiliate_offer_idempotency_conflict';
    end if;
    return prior.result_json;
  end if;

  select * into product_row from public.products where id = p_product_id and seller_id = actor for update;
  select * into store_row from public.marketplace_stores
    where id = product_row.store_id and seller_id = actor and status = 'active';
  if product_row.id is null or store_row.id is null
    or not exists (select 1 from public.marketplace_sellers where user_id = actor and status = 'approved')
    or product_row.status <> 'active' or product_row.moderation_status <> 'approved'
    or product_row.deleted_at is not null or product_row.product_type <> 'physical'
    or product_row.currency <> 'BDAG' then
    raise exception using message = 'live_affiliate_product_unavailable';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('live-offer:' || p_product_id::text || ':' || coalesce(p_creator_id::text,'public'), 0));
  update public.marketplace_live_affiliate_offers
    set status = 'removed', updated_at = now()
    where product_id = product_row.id and status = 'active'
      and coalesce(creator_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(p_creator_id, '00000000-0000-0000-0000-000000000000'::uuid);
  insert into public.marketplace_live_affiliate_offers(
    seller_id, store_id, product_id, creator_id, offer_scope,
    commission_bps, status, starts_at, ends_at
  ) values (
    actor, store_row.id, product_row.id, p_creator_id, p_offer_scope,
    p_commission_bps, p_status, p_starts_at, p_ends_at
  ) returning * into offer_row;

  result := jsonb_build_object('id', offer_row.id, 'product_id', offer_row.product_id,
    'offer_scope', offer_row.offer_scope, 'creator_id', offer_row.creator_id,
    'commission_bps', offer_row.commission_bps, 'status', offer_row.status,
    'starts_at', offer_row.starts_at, 'ends_at', offer_row.ends_at);
  insert into public.marketplace_live_affiliate_offer_commands(
    seller_id, idempotency_key, request_fingerprint, result_json
  ) values (actor, p_idempotency_key, fingerprint, result);
  return result;
end
$$;

revoke all on function public.upsert_my_live_affiliate_offer(uuid,text,uuid,integer,text) from authenticated;
revoke all on function public.upsert_my_live_affiliate_offer(uuid,text,uuid,integer,text,timestamptz,timestamptz,uuid) from public, anon;
grant execute on function public.upsert_my_live_affiliate_offer(uuid,text,uuid,integer,text,timestamptz,timestamptz,uuid) to authenticated, service_role;

create or replace function public.fetch_live_session_products(p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id, 'product_id', q.product_id, 'store_id', q.store_id,
    'store_name', q.store_name, 'seller_name', q.seller_name,
    'title', q.title, 'description', q.description, 'image_url', q.image_url,
    'min_price', q.min_price, 'max_price', q.max_price,
    'compare_at_price', q.compare_at_price,
    'active_variant_count', q.variant_count,
    'available_quantity', q.available_quantity,
    'featured_variant_id', q.safe_featured_variant_id,
    'is_featured', q.is_featured, 'position', q.position,
    'sold_count', q.sold_count, 'commerce_mode', q.commerce_mode,
    'availability', case
      when q.commerce_mode = 'affiliate_product' and not q.affiliate_valid then 'affiliate_offer_unavailable'
      when q.base_eligible and q.available_quantity > 0 then 'available'
      when q.base_eligible then 'out_of_stock'
      else 'product_unavailable'
    end
  ) order by q.is_featured desc, q.position, q.id), '[]'::jsonb)
  from (
    select lp.id, lp.product_id, lp.store_id, lp.featured_variant_id,
      lp.is_featured, lp.position, lp.commerce_mode,
      st.name store_name, coalesce(up.display_name, up.username) seller_name,
      p.title, p.description, public.marketplace_safe_public_image_url(p.images[1]) image_url,
      min(v.price) filter (where v.status = 'active' and v.archived_at is null) min_price,
      max(v.price) filter (where v.status = 'active' and v.archived_at is null) max_price,
      max(v.compare_at_price) filter (where v.status = 'active' and v.archived_at is null) compare_at_price,
      count(v.id) filter (where v.status = 'active' and v.archived_at is null) variant_count,
      coalesce(sum(greatest(i.on_hand - i.reserved, 0)) filter (
        where v.status = 'active' and v.archived_at is null
      ), 0) available_quantity,
      (array_agg(v.id order by v.id) filter (
        where v.id = lp.featured_variant_id and v.status = 'active'
          and v.archived_at is null
          and greatest(coalesce(i.on_hand,0) - coalesce(i.reserved,0),0) > 0
      ))[1] safe_featured_variant_id,
      coalesce((select sum(e.quantity) from public.live_commerce_purchase_events e
        where e.session_id = lp.session_id and e.product_id = lp.product_id), 0) sold_count,
      p.status = 'active' and p.moderation_status = 'approved'
        and p.deleted_at is null and p.product_type = 'physical'
        and p.currency = 'BDAG' and st.status = 'active' and ms.status = 'approved' base_eligible,
      (lp.commerce_mode = 'own_product'
        or public.marketplace_live_affiliate_pin_is_valid(lp.id, lp.host_id)) affiliate_valid
    from public.live_session_products lp
    join public.live_sessions l on l.id = lp.session_id and l.status = 'live'
    join public.products p on p.id = lp.product_id
    join public.marketplace_stores st on st.id = lp.store_id
    join public.marketplace_sellers ms on ms.user_id = lp.seller_id
    join public.user_profiles up on up.id = lp.seller_id
    left join public.marketplace_product_variants v on v.product_id = p.id
    left join public.marketplace_inventory_levels i on i.variant_id = v.id
    where lp.session_id = p_session_id and lp.status = 'active'
    group by lp.id, st.id, up.id, p.id, ms.user_id
  ) q
$$;

create or replace function public.create_live_marketplace_checkout_reservation(
  p_session_id uuid,
  p_live_session_product_id uuid,
  p_variant_id uuid,
  p_quantity integer,
  p_shipping_address jsonb,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  live_row public.live_sessions;
  pin public.live_session_products;
  variant public.marketplace_product_variants;
  result jsonb;
  checkout uuid;
  v_order_id uuid;
begin
  select * into live_row from public.live_sessions where id = p_session_id for share;
  if not found or live_row.status <> 'live' then
    raise exception using message = 'live_commerce_live_ended';
  end if;
  select * into pin from public.live_session_products
    where id = p_live_session_product_id and session_id = live_row.id and status = 'active' for share;
  if not found then raise exception using message = 'live_commerce_pin_unavailable'; end if;
  if pin.commerce_mode = 'affiliate_product'
    and not public.marketplace_live_affiliate_pin_is_valid(pin.id, live_row.host_id) then
    raise exception using message = 'live_affiliate_offer_unavailable';
  end if;
  select * into variant from public.marketplace_product_variants
    where id = p_variant_id and product_id = pin.product_id and status = 'active' and archived_at is null;
  if not found then raise exception using message = 'live_commerce_invalid_variant'; end if;
  if auth.uid() = pin.seller_id then raise exception using message = 'marketplace_own_product_forbidden'; end if;

  result := public.create_marketplace_checkout_reservation(
    jsonb_build_array(jsonb_build_object('variant_id', p_variant_id, 'quantity', p_quantity)),
    p_shipping_address, p_idempotency_key
  );
  checkout := (result->'checkout'->>'id')::uuid;
  select id into v_order_id from public.marketplace_orders where checkout_id = checkout;
  insert into public.marketplace_live_order_sources(
    checkout_id, order_id, buyer_id, seller_id, store_id, live_session_id,
    live_host_id, live_session_product_id, product_id, variant_id
  ) values (
    checkout, v_order_id, auth.uid(), pin.seller_id, pin.store_id, live_row.id,
    live_row.host_id, pin.id, pin.product_id, variant.id
  ) on conflict (order_id) do nothing;
  if not exists (
    select 1 from public.marketplace_live_order_sources src
    where src.order_id = v_order_id and src.live_session_id = live_row.id
      and src.live_session_product_id = pin.id and src.variant_id = variant.id
  ) then raise exception using message = 'marketplace_idempotency_conflict'; end if;
  return result;
end
$$;

create or replace function public.fetch_my_live_shop_stats(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.live_sessions l
    where l.id = p_session_id and l.host_id = auth.uid()
  ) then raise exception using errcode = '42501', message = 'live_commerce_host_not_eligible'; end if;
  select jsonb_build_object(
    'orders_count', count(e.id),
    'gross_sales', coalesce(sum(e.gross_amount), 0),
    'creator_commission_held', coalesce(sum(e.creator_commission_amount) filter (where a.status = 'held'), 0),
    'creator_commission_released', coalesce(sum(e.creator_commission_amount) filter (where a.status = 'released'), 0),
    'units_sold', coalesce(sum(e.quantity), 0)
  ) into result
  from public.live_commerce_purchase_events e
  join public.marketplace_payment_allocations a on a.order_id = e.order_id
  where e.session_id = p_session_id and e.host_id = auth.uid();
  return result;
end
$$;

revoke all on function public.fetch_my_live_shop_stats(uuid) from public, anon;
grant execute on function public.fetch_my_live_shop_stats(uuid) to authenticated, service_role;

commit;
