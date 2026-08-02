begin;

create or replace function public.marketplace_resolve_live_affiliate_offer(
  p_product_id uuid,
  p_creator_id uuid
) returns table(
  offer_id uuid,
  seller_id uuid,
  store_id uuid,
  product_id uuid,
  creator_id uuid,
  offer_scope text,
  commission_bps integer,
  starts_at timestamptz,
  ends_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    offer.id,
    offer.seller_id,
    offer.store_id,
    offer.product_id,
    offer.creator_id,
    offer.offer_scope,
    offer.commission_bps,
    offer.starts_at,
    offer.ends_at
  from public.marketplace_live_affiliate_offers offer
  where offer.product_id = p_product_id
    and offer.status = 'active'
    and (offer.starts_at is null or offer.starts_at <= now())
    and (offer.ends_at is null or offer.ends_at > now())
    and (
      (
        offer.offer_scope = 'specific_creator'
        and offer.creator_id = p_creator_id
      )
      or offer.offer_scope = 'public_creator'
    )
  order by
    case
      when offer.offer_scope = 'specific_creator'
        and offer.creator_id = p_creator_id
      then 0
      else 1
    end,
    offer.created_at desc,
    offer.id desc
  limit 1
$$;

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

  with eligible_affiliate_products as (
    select distinct offer.product_id
    from public.marketplace_live_affiliate_offers offer
    where offer.status = 'active'
      and (offer.starts_at is null or offer.starts_at <= now())
      and (offer.ends_at is null or offer.ends_at > now())
      and (
        offer.offer_scope = 'public_creator'
        or (
          offer.offer_scope = 'specific_creator'
          and offer.creator_id = context_row.host_id
        )
      )
  ), current_offers as (
    select
      resolved.offer_id as id,
      resolved.product_id,
      resolved.seller_id,
      resolved.store_id,
      resolved.commission_bps
    from eligible_affiliate_products eligible
    cross join lateral public.marketplace_resolve_live_affiliate_offer(
      eligible.product_id,
      context_row.host_id
    ) resolved
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
      pin.is_featured,
      pin.commerce_mode,
      pin.creator_commission_bps,
      pin.affiliate_offer_id,
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

create or replace function public.pin_live_session_product(p_session_id uuid,p_product_id uuid,p_featured_variant_id uuid,p_idempotency_key uuid)returns jsonb language plpgsql security definer set search_path=public as $$declare actor uuid:=auth.uid();fingerprint text;prior public.live_commerce_commands;c record;p public.products;v public.marketplace_product_variants;r public.live_session_products;result jsonb;offer record;mode text;bps integer;begin if actor is null or p_session_id is null or p_product_id is null or p_idempotency_key is null then raise exception using message='live_commerce_invalid_input';end if;fingerprint:=encode(extensions.digest(concat_ws('|','pin',p_session_id,p_product_id,coalesce(p_featured_variant_id::text,'')),'sha256'),'hex');perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_idempotency_key::text,0));select*into prior from public.live_commerce_commands where actor_id=actor and idempotency_key=p_idempotency_key;if found then if prior.request_fingerprint<>fingerprint then raise exception using message='live_commerce_idempotency_conflict';end if;return prior.result_json;end if;select*into c from public.live_commerce_host_context(p_session_id);perform pg_advisory_xact_lock(hashtextextended('live-pin:'||p_session_id,0));select*into p from public.products where id=p_product_id;if not found or p.status<>'active'or p.moderation_status<>'approved'or p.product_type<>'physical'or p.currency<>'BDAG'or p.deleted_at is not null or not exists(select 1 from public.marketplace_stores st join public.marketplace_sellers ms on ms.user_id=st.seller_id where st.id=p.store_id and st.seller_id=p.seller_id and st.status='active'and ms.status='approved')then raise exception using message='live_commerce_product_unavailable';end if;if p.seller_id=actor then mode:='own_product';bps:=0;else select*into offer from public.marketplace_resolve_live_affiliate_offer(p.id,actor);if not found then raise exception using message='live_affiliate_not_authorized';end if;mode:='affiliate_product';bps:=offer.commission_bps;end if;if p_featured_variant_id is not null and not exists(select 1 from public.marketplace_product_variants where id=p_featured_variant_id and product_id=p.id and status='active'and archived_at is null)then raise exception using message='live_commerce_invalid_variant';end if;if not exists(select 1 from public.marketplace_product_variants x join public.marketplace_inventory_levels i on i.variant_id=x.id where x.product_id=p.id and x.status='active'and x.archived_at is null and i.on_hand>i.reserved)then raise exception using message='live_commerce_out_of_stock';end if;select*into r from public.live_session_products where session_id=p_session_id and product_id=p.id and status='active';if not found then if(select count(*)from public.live_session_products where session_id=p_session_id and status='active')>=20 then raise exception using message='live_commerce_pin_limit';end if;insert into public.live_session_products(session_id,host_id,seller_id,store_id,product_id,featured_variant_id,is_featured,position,commerce_mode,creator_commission_bps,affiliate_offer_id)values(p_session_id,actor,p.seller_id,p.store_id,p.id,p_featured_variant_id,false,(select count(*)from public.live_session_products where session_id=p_session_id and status='active'),mode,bps,offer.offer_id)returning*into r;end if;result:=jsonb_build_object('id',r.id,'status',r.status,'is_featured',r.is_featured,'commerce_mode',r.commerce_mode,'creator_commission_bps',r.creator_commission_bps);insert into public.live_commerce_commands(actor_id,session_id,command_type,idempotency_key,request_fingerprint,result_json)values(actor,p_session_id,'pin',p_idempotency_key,fingerprint,result);return result;end$$;

revoke all on function public.marketplace_resolve_live_affiliate_offer(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.marketplace_resolve_live_affiliate_offer(uuid,uuid)
  to service_role;

revoke all on function public.fetch_my_live_product_candidates(uuid,integer,timestamptz,uuid),
  public.pin_live_session_product(uuid,uuid,uuid,uuid)
  from public, anon;
grant execute on function public.fetch_my_live_product_candidates(uuid,integer,timestamptz,uuid),
  public.pin_live_session_product(uuid,uuid,uuid,uuid)
  to authenticated, service_role;

commit;

