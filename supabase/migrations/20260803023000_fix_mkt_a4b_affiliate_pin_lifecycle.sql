begin;

create or replace function public.fetch_my_live_product_candidates(
  p_session_id uuid,
  p_limit integer default 20,
  p_before_updated_at timestamptz default null,
  p_before_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  context_row record;
  page_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  rows_json jsonb;
  has_more boolean;
begin
  if (p_before_updated_at is null) <> (p_before_id is null) then
    raise exception using message = 'live_commerce_invalid_cursor';
  end if;

  select * into context_row
  from public.live_commerce_host_context(p_session_id);

  with current_offers as (
    select distinct on (offer.product_id)
      offer.id,
      offer.product_id,
      offer.seller_id,
      offer.store_id,
      offer.commission_bps
    from public.marketplace_live_affiliate_offers offer
    where offer.status = 'active'
      and (offer.starts_at is null or offer.starts_at <= now())
      and (offer.ends_at is null or offer.ends_at > now())
      and (
        offer.offer_scope = 'public_creator'
        or offer.creator_id = context_row.host_id
      )
    order by
      offer.product_id,
      (offer.creator_id = context_row.host_id) desc,
      offer.created_at desc,
      offer.id desc
  ), active_pins as (
    select pin.*
    from public.live_session_products pin
    where pin.session_id = p_session_id
      and pin.status = 'active'
  ), universe as (
    select product.id as product_id
    from public.products product
    where product.seller_id = context_row.host_id
    union
    select offer.product_id from current_offers offer
    union
    select pin.product_id from active_pins pin
  ), candidate_rows as (
    select
      product.id,
      product.updated_at,
      product.store_id,
      store.name as store_name,
      coalesce(profile.display_name, profile.username, 'Vendedor') as seller_name,
      product.title,
      public.marketplace_safe_public_image_url(product.images[1]) as image_url,
      coalesce(min(variant.price) filter (
        where variant.status = 'active' and variant.archived_at is null
      ), product.price, 0) as min_price,
      coalesce(max(variant.price) filter (
        where variant.status = 'active' and variant.archived_at is null
      ), product.price, 0) as max_price,
      count(variant.id) filter (
        where variant.status = 'active' and variant.archived_at is null
      ) as active_variant_count,
      coalesce(sum(greatest(inventory.on_hand - inventory.reserved, 0)) filter (
        where variant.status = 'active' and variant.archived_at is null
      ), 0) as available_quantity,
      pin.id as pin_id,
      pin.id is not null as is_pinned,
      coalesce(pin.is_featured, false)
        and (
          pin.commerce_mode = 'own_product'
          or public.marketplace_live_affiliate_pin_is_valid(pin.id, context_row.host_id)
        ) as is_featured,
      case
        when pin.id is not null then pin.commerce_mode
        when product.seller_id = context_row.host_id then 'own_product'
        else 'affiliate_product'
      end as commerce_mode,
      case
        when pin.commerce_mode = 'affiliate_product' then pin.creator_commission_bps
        when product.seller_id = context_row.host_id then 0
        else current_offer.commission_bps
      end as creator_commission_bps,
      case
        when pin.id is null then true
        when pin.commerce_mode = 'own_product' then true
        else public.marketplace_live_affiliate_pin_is_valid(pin.id, context_row.host_id)
      end as pin_offer_valid,
      case when pin.commerce_mode = 'affiliate_product'
        then pin.creator_commission_bps else null end as pinned_creator_commission_bps,
      current_offer.commission_bps as current_offer_commission_bps,
      current_offer.id as current_offer_id,
      pin.affiliate_offer_id as pinned_offer_id,
      case
        when pin.id is null or pin.commerce_mode <> 'affiliate_product' or current_offer.id is null then false
        else current_offer.id is distinct from pin.affiliate_offer_id
          or current_offer.commission_bps is distinct from pin.creator_commission_bps
      end as requires_repin,
      case
        when product.status <> 'active'
          or product.moderation_status <> 'approved'
          or product.deleted_at is not null
          or product.product_type <> 'physical'
          or product.currency <> 'BDAG'
          or store.status is distinct from 'active'
          or seller.status is distinct from 'approved'
          then 'product_unavailable'
        when pin.id is not null
          and pin.commerce_mode = 'affiliate_product'
          and not public.marketplace_live_affiliate_pin_is_valid(pin.id, context_row.host_id)
          and current_offer.id is not null
          and (
            current_offer.id is distinct from pin.affiliate_offer_id
            or current_offer.commission_bps is distinct from pin.creator_commission_bps
          ) then 'affiliate_offer_replaced'
        when pin.id is not null
          and pin.commerce_mode = 'affiliate_product'
          and not public.marketplace_live_affiliate_pin_is_valid(pin.id, context_row.host_id)
          then 'affiliate_offer_unavailable'
        when product.seller_id <> context_row.host_id and current_offer.id is null
          then 'affiliate_offer_unavailable'
        when coalesce(sum(greatest(inventory.on_hand - inventory.reserved, 0)) filter (
          where variant.status = 'active' and variant.archived_at is null
        ), 0) <= 0 then 'out_of_stock'
        else 'available'
      end as candidate_availability
    from universe
    join public.products product on product.id = universe.product_id
    left join public.marketplace_stores store on store.id = product.store_id
    left join public.marketplace_sellers seller on seller.user_id = product.seller_id
    left join public.user_profiles profile on profile.id = product.seller_id
    left join current_offers current_offer on current_offer.product_id = product.id
    left join active_pins pin on pin.product_id = product.id
    left join public.marketplace_product_variants variant on variant.product_id = product.id
    left join public.marketplace_inventory_levels inventory on inventory.variant_id = variant.id
    where (p_before_updated_at is null or (product.updated_at, product.id) < (p_before_updated_at, p_before_id))
      and (
        product.seller_id = context_row.host_id
        or current_offer.id is not null
        or pin.id is not null
      )
    group by
      product.id,
      store.id,
      seller.user_id,
      profile.id,
      pin.id,
      current_offer.id,
      current_offer.commission_bps,
      context_row.host_id
    order by product.updated_at desc, product.id desc
    limit page_limit + 1
  ), numbered as (
    select candidate_rows.*,
      row_number() over (order by updated_at desc, id desc) as row_number
    from candidate_rows
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'product_id', id,
      'store_id', store_id,
      'store_name', store_name,
      'seller_name', seller_name,
      'title', title,
      'image_url', image_url,
      'min_price', min_price,
      'max_price', max_price,
      'active_variant_count', active_variant_count,
      'available_quantity', available_quantity,
      'pin_id', pin_id,
      'is_pinned', is_pinned,
      'is_featured', is_featured,
      'commerce_mode', commerce_mode,
      'creator_commission_bps', creator_commission_bps,
      'candidate_availability', candidate_availability,
      'pin_offer_valid', pin_offer_valid,
      'pinned_creator_commission_bps', pinned_creator_commission_bps,
      'current_offer_commission_bps', current_offer_commission_bps,
      'current_offer_id', current_offer_id,
      'pinned_offer_id', pinned_offer_id,
      'requires_repin', requires_repin,
      'updated_at', updated_at
    ) order by updated_at desc, id desc) filter (where row_number <= page_limit), '[]'::jsonb),
    bool_or(row_number > page_limit)
  into rows_json, has_more
  from numbered;

  return jsonb_build_object(
    'items', rows_json,
    'next_cursor', case when coalesce(has_more, false) then (
      select jsonb_build_object(
        'updated_at', item->>'updated_at',
        'id', item->>'product_id'
      )
      from jsonb_array_elements(rows_json) item
      order by item->>'updated_at', item->>'product_id'
      limit 1
    ) else null end
  );
end
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
  select * into live_row
  from public.live_sessions
  where id = p_session_id
  for share;
  if not found or live_row.status <> 'live' then
    raise exception using message = 'live_commerce_live_ended';
  end if;

  select * into pin
  from public.live_session_products
  where id = p_live_session_product_id
    and session_id = live_row.id
    and status = 'active'
  for share;
  if not found then
    raise exception using message = 'live_commerce_pin_unavailable';
  end if;

  if pin.commerce_mode = 'affiliate_product' and auth.uid() = live_row.host_id then
    raise exception using message = 'live_affiliate_self_purchase_forbidden';
  end if;
  if auth.uid() = pin.seller_id then
    raise exception using message = 'marketplace_own_product_forbidden';
  end if;
  if pin.commerce_mode = 'affiliate_product'
    and not public.marketplace_live_affiliate_pin_is_valid(pin.id, live_row.host_id) then
    raise exception using message = 'live_affiliate_offer_unavailable';
  end if;

  select * into variant
  from public.marketplace_product_variants
  where id = p_variant_id
    and product_id = pin.product_id
    and status = 'active'
    and archived_at is null;
  if not found then
    raise exception using message = 'live_commerce_invalid_variant';
  end if;

  result := public.create_marketplace_checkout_reservation(
    jsonb_build_array(jsonb_build_object('variant_id', p_variant_id, 'quantity', p_quantity)),
    p_shipping_address,
    p_idempotency_key
  );
  checkout := (result->'checkout'->>'id')::uuid;
  select marketplace_orders.id into v_order_id
  from public.marketplace_orders
  where checkout_id = checkout;

  insert into public.marketplace_live_order_sources(
    checkout_id, order_id, buyer_id, seller_id, store_id, live_session_id,
    live_host_id, live_session_product_id, product_id, variant_id
  ) values (
    checkout, v_order_id, auth.uid(), pin.seller_id, pin.store_id, live_row.id,
    live_row.host_id, pin.id, pin.product_id, variant.id
  ) on conflict (order_id) do nothing;

  if not exists (
    select 1
    from public.marketplace_live_order_sources source
    where source.order_id = v_order_id
      and source.live_session_id = live_row.id
      and source.live_session_product_id = pin.id
      and source.variant_id = variant.id
  ) then
    raise exception using message = 'marketplace_idempotency_conflict';
  end if;
  return result;
end
$$;

insert into public.live_commerce_host_purchase_events(
  id,
  session_id,
  host_id,
  buyer_display_name,
  product_title,
  product_image_url,
  quantity,
  currency,
  gross_amount,
  creator_commission_amount,
  created_at
)
select
  event.id,
  event.session_id,
  event.host_id,
  event.buyer_display_name,
  item.product_title,
  public.marketplace_safe_public_image_url(product.images[1]),
  event.quantity,
  event.currency,
  event.gross_amount,
  event.creator_commission_amount,
  event.created_at
from public.live_commerce_purchase_events event
join public.marketplace_order_items item on item.id = event.order_item_id
join public.products product on product.id = event.product_id
on conflict (id) do nothing;

commit;
