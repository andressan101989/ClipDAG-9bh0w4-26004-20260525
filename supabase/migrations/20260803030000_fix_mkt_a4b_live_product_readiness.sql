begin;

create or replace function public.marketplace_evaluate_live_product_readiness(
  p_product_id uuid,
  p_host_id uuid
) returns table(
  availability text,
  reason_code text,
  active_variant_count integer,
  available_quantity integer,
  seller_status text,
  store_status text,
  moderation_status text
)
language sql stable security definer set search_path = public
as $$
  with evaluated as (
    select p.id, p.status product_status, p.moderation_status, p.deleted_at,
      p.product_type, p.currency, s.status store_status, ms.status seller_status,
      count(v.id) filter(where v.status='active' and v.archived_at is null)::integer active_variants,
      count(i.variant_id) filter(where v.status='active' and v.archived_at is null)::integer inventory_rows,
      count(v.id) filter(where v.status='active' and v.archived_at is null and v.is_default)::integer default_variants,
      coalesce(sum(greatest(i.on_hand-i.reserved,0)) filter(where v.status='active' and v.archived_at is null),0)::integer available
    from public.products p
    left join public.marketplace_stores s on s.id=p.store_id and s.seller_id=p.seller_id
    left join public.marketplace_sellers ms on ms.user_id=p.seller_id
    left join public.marketplace_product_variants v on v.product_id=p.id
    left join public.marketplace_inventory_levels i on i.variant_id=v.id
    where p.id=p_product_id
    group by p.id,s.status,ms.status
  ), classified as (
    select *, case
      when seller_status is distinct from 'approved' then 'seller_not_approved'
      when store_status is distinct from 'active' then 'store_not_active'
      when deleted_at is not null then 'product_deleted'
      when product_status is distinct from 'active' then 'product_not_active'
      when moderation_status is distinct from 'approved' then 'product_not_approved'
      when product_type is distinct from 'physical' then 'unsupported_product_type'
      when currency is distinct from 'BDAG' then 'unsupported_currency'
      when active_variants=0 then 'no_active_variant'
      when default_variants<>1 then 'inventory_not_configured'
      when inventory_rows<active_variants then 'inventory_not_configured'
      when available<=0 then 'out_of_stock'
      else 'ready' end reason
    from evaluated
  )
  select case when reason='ready' then 'available'
              when reason='out_of_stock' then 'out_of_stock'
              else 'product_unavailable' end,
    reason,active_variants,available,seller_status,store_status,moderation_status
  from classified
$$;

with eligible as (
  select p.* from public.products p
  join public.marketplace_stores s on s.id=p.store_id and s.seller_id=p.seller_id and s.status='active'
  join public.marketplace_sellers ms on ms.user_id=p.seller_id and ms.status='approved'
  where p.status='active' and p.moderation_status='approved' and p.deleted_at is null
    and p.product_type='physical' and p.currency='BDAG'
    and not exists(select 1 from public.marketplace_product_options o where o.product_id=p.id)
    and not exists(select 1 from public.marketplace_product_variants v where v.product_id=p.id and v.status<>'archived')
), inserted as (
  insert into public.marketplace_product_variants(
    product_id,store_id,seller_id,sku,sku_normalized,title,price,compare_at_price,status,is_default,combination_key
  )
  select e.id,e.store_id,e.seller_id,'LEGACY-'||upper(replace(e.id::text,'-','')),
    'LEGACY-'||upper(replace(e.id::text,'-','')),'Predeterminada',e.price,
    case when e.compare_at_price>=e.price then e.compare_at_price else null end,'active',true,''
  from eligible e on conflict do nothing returning id,product_id,seller_id
), inventory_inserted as (
  insert into public.marketplace_inventory_levels(variant_id,on_hand,reserved)
  select i.id,greatest(coalesce(p.stock,0),0),0 from inserted i join public.products p on p.id=i.product_id
  on conflict(variant_id) do nothing returning variant_id,on_hand
)
insert into public.marketplace_inventory_movements(
  variant_id,seller_id,movement_type,delta,previous_on_hand,resulting_on_hand,reason,idempotency_key,request_fingerprint,created_by
)
select ii.variant_id,v.seller_id,'backfill',ii.on_hand,0,ii.on_hand,
  'MKT-A4B structural legacy readiness repair',
  gen_random_uuid(),
  encode(extensions.digest('mkt-a4b-readiness:'||ii.variant_id,'sha256'),'hex'),null
from inventory_inserted ii join public.marketplace_product_variants v on v.id=ii.variant_id
on conflict do nothing;

insert into public.marketplace_inventory_levels(variant_id,on_hand,reserved)
select v.id,greatest(coalesce(p.stock,0),0),0
from public.marketplace_product_variants v join public.products p on p.id=v.product_id
join public.marketplace_stores s on s.id=p.store_id and s.status='active'
join public.marketplace_sellers ms on ms.user_id=p.seller_id and ms.status='approved'
where p.status='active' and p.moderation_status='approved' and p.deleted_at is null
  and p.product_type='physical' and p.currency='BDAG'
  and not exists(select 1 from public.marketplace_product_options o where o.product_id=p.id)
  and v.status='active' and v.archived_at is null
  and (select count(*) from public.marketplace_product_variants x where x.product_id=p.id and x.status<>'archived')=1
  and not exists(select 1 from public.marketplace_inventory_levels i where i.variant_id=v.id)
on conflict(variant_id) do nothing;

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
      case
        when pin.id is not null and pin.commerce_mode = 'affiliate_product'
          and not public.marketplace_live_affiliate_pin_is_valid(pin.id, context_row.host_id)
          and current_offer.id is not null then 'affiliate_offer_replaced'
        when pin.id is not null and pin.commerce_mode = 'affiliate_product'
          and not public.marketplace_live_affiliate_pin_is_valid(pin.id, context_row.host_id) then 'affiliate_offer_unavailable'
        when product.seller_id <> context_row.host_id and current_offer.id is null then 'affiliate_offer_unavailable'
        else readiness.reason_code
      end as readiness_reason_code,
      pin.affiliate_offer_id as pinned_offer_id,
      case
        when pin.id is null or pin.commerce_mode <> 'affiliate_product' or current_offer.id is null then false
        else current_offer.id is distinct from pin.affiliate_offer_id
          or current_offer.commission_bps is distinct from pin.creator_commission_bps
      end as requires_repin,
      case
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
        when readiness.reason_code = 'ready' then 'available'
        when readiness.reason_code = 'out_of_stock' then 'out_of_stock'
        else 'product_unavailable'
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
    cross join lateral public.marketplace_evaluate_live_product_readiness(product.id, context_row.host_id) readiness
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
      readiness.reason_code,
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
      'readiness_reason_code', readiness_reason_code,
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

create or replace function public.pin_live_session_product(p_session_id uuid,p_product_id uuid,p_featured_variant_id uuid,p_idempotency_key uuid)returns jsonb language plpgsql security definer set search_path=public as $$declare actor uuid:=auth.uid();fingerprint text;prior public.live_commerce_commands;c record;p public.products;v public.marketplace_product_variants;r public.live_session_products;result jsonb;resolved_offer_id uuid;resolved_offer_bps integer;readiness record;mode text;bps integer;begin if actor is null or p_session_id is null or p_product_id is null or p_idempotency_key is null then raise exception using message='live_commerce_invalid_input';end if;fingerprint:=encode(extensions.digest(concat_ws('|','pin',p_session_id,p_product_id,coalesce(p_featured_variant_id::text,'')),'sha256'),'hex');perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_idempotency_key::text,0));select*into prior from public.live_commerce_commands where actor_id=actor and idempotency_key=p_idempotency_key;if found then if prior.request_fingerprint<>fingerprint then raise exception using message='live_commerce_idempotency_conflict';end if;return prior.result_json;end if;select*into c from public.live_commerce_host_context(p_session_id);perform pg_advisory_xact_lock(hashtextextended('live-pin:'||p_session_id,0));select*into p from public.products where id=p_product_id;if not found or p.status<>'active'or p.moderation_status<>'approved'or p.product_type<>'physical'or p.currency<>'BDAG'or p.deleted_at is not null or not exists(select 1 from public.marketplace_stores st join public.marketplace_sellers ms on ms.user_id=st.seller_id where st.id=p.store_id and st.seller_id=p.seller_id and st.status='active'and ms.status='approved')then raise exception using message='live_commerce_product_unavailable';end if;select*into readiness from public.marketplace_evaluate_live_product_readiness(p.id,actor);if readiness.reason_code not in('ready','out_of_stock')then raise exception using message='live_product_readiness_'||readiness.reason_code;end if;if readiness.reason_code='out_of_stock'then raise exception using message='live_product_readiness_out_of_stock';end if;if p.seller_id=actor then mode:='own_product';bps:=0;else select offer_id,commission_bps into resolved_offer_id,resolved_offer_bps from public.marketplace_resolve_live_affiliate_offer(p.id,actor);if not found then raise exception using message='live_affiliate_not_authorized';end if;mode:='affiliate_product';bps:=resolved_offer_bps;end if;if p_featured_variant_id is not null and not exists(select 1 from public.marketplace_product_variants where id=p_featured_variant_id and product_id=p.id and status='active'and archived_at is null)then raise exception using message='live_commerce_invalid_variant';end if;if not exists(select 1 from public.marketplace_product_variants x join public.marketplace_inventory_levels i on i.variant_id=x.id where x.product_id=p.id and x.status='active'and x.archived_at is null and i.on_hand>i.reserved)then raise exception using message='live_commerce_out_of_stock';end if;select*into r from public.live_session_products where session_id=p_session_id and product_id=p.id and status='active';if not found then if(select count(*)from public.live_session_products where session_id=p_session_id and status='active')>=20 then raise exception using message='live_commerce_pin_limit';end if;insert into public.live_session_products(session_id,host_id,seller_id,store_id,product_id,featured_variant_id,is_featured,position,commerce_mode,creator_commission_bps,affiliate_offer_id)values(p_session_id,actor,p.seller_id,p.store_id,p.id,p_featured_variant_id,false,(select count(*)from public.live_session_products where session_id=p_session_id and status='active'),mode,bps,resolved_offer_id)returning*into r;end if;result:=jsonb_build_object('id',r.id,'status',r.status,'is_featured',r.is_featured,'commerce_mode',r.commerce_mode,'creator_commission_bps',r.creator_commission_bps);insert into public.live_commerce_commands(actor_id,session_id,command_type,idempotency_key,request_fingerprint,result_json)values(actor,p_session_id,'pin',p_idempotency_key,fingerprint,result);return result;end$$;

create or replace function public.feature_live_session_product(p_session_id uuid,p_live_session_product_id uuid,p_idempotency_key uuid)returns jsonb language plpgsql security definer set search_path=public as $$declare actor uuid:=auth.uid();fingerprint text;prior public.live_commerce_commands;c record;r public.live_session_products;readiness record;result jsonb;begin if actor is null or p_session_id is null or p_live_session_product_id is null or p_idempotency_key is null then raise exception using message='live_commerce_invalid_input';end if;fingerprint:=encode(extensions.digest(concat_ws('|','feature',p_session_id,p_live_session_product_id),'sha256'),'hex');perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_idempotency_key::text,0));select*into prior from public.live_commerce_commands where actor_id=actor and idempotency_key=p_idempotency_key;if found then if prior.request_fingerprint<>fingerprint then raise exception using message='live_commerce_idempotency_conflict';end if;return prior.result_json;end if;select*into c from public.live_commerce_host_context(p_session_id);perform pg_advisory_xact_lock(hashtextextended('live-feature:'||p_session_id,0));select*into r from public.live_session_products where id=p_live_session_product_id and session_id=p_session_id and status='active'for update;if not found then raise exception using message='live_commerce_pin_not_found';end if;select*into readiness from public.marketplace_evaluate_live_product_readiness(r.product_id,actor);if readiness.reason_code<>'ready'then raise exception using message='live_product_readiness_'||readiness.reason_code;end if;if not exists(select 1 from public.products p join public.marketplace_stores st on st.id=p.store_id and st.status='active'join public.marketplace_sellers ms on ms.user_id=p.seller_id and ms.status='approved'join public.marketplace_product_variants v on v.product_id=p.id and v.status='active'and v.archived_at is null join public.marketplace_inventory_levels i on i.variant_id=v.id and i.on_hand>i.reserved where p.id=r.product_id and p.status='active'and p.moderation_status='approved'and p.deleted_at is null and p.product_type='physical'and p.currency='BDAG')or(r.commerce_mode='affiliate_product'and not exists(select 1 from public.marketplace_live_affiliate_offers o where o.id=r.affiliate_offer_id and o.status='active'and(o.starts_at is null or o.starts_at<=now())and(o.ends_at is null or o.ends_at>now())and(o.offer_scope='public_creator'or o.creator_id=actor)))then raise exception using message='live_commerce_product_unavailable';end if;update public.live_session_products set is_featured=(id=r.id),version=version+1 where session_id=p_session_id and status='active'and is_featured is distinct from(id=r.id);result:=jsonb_build_object('id',r.id,'is_featured',true);insert into public.live_commerce_commands(actor_id,session_id,command_type,idempotency_key,request_fingerprint,result_json)values(actor,p_session_id,'feature',p_idempotency_key,fingerprint,result);return result;end$$;

create or replace function public.publish_marketplace_product(p_product_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare readiness record;
begin
  perform public.set_marketplace_product_publication(p_product_id,true);
  select * into readiness from public.marketplace_evaluate_live_product_readiness(p_product_id,auth.uid());
  if readiness.reason_code not in('ready','out_of_stock') then
    raise exception using message='marketplace_product_not_ready_'||coalesce(readiness.reason_code,'product_unavailable');
  end if;
end$$;

create or replace function public.fetch_marketplace_ready_product_ids(
  p_category text default null,p_seller_id uuid default null,p_search text default null,p_limit integer default 30
) returns uuid[] language sql stable security definer set search_path=public as $$
  select coalesce(array_agg(p.id order by p.created_at desc),'{}'::uuid[])
  from (select p.* from public.products p
    cross join lateral public.marketplace_evaluate_live_product_readiness(p.id,p.seller_id) r
    where r.reason_code='ready'
      and (p_category is null or p.category=p_category)
      and (p_seller_id is null or p.seller_id=p_seller_id)
      and (p_search is null or p.title ilike '%'||p_search||'%')
    order by p.created_at desc limit least(greatest(coalesce(p_limit,30),1),100)
  ) p
$$;

revoke all on function public.marketplace_evaluate_live_product_readiness(uuid,uuid) from public,anon,authenticated;
grant execute on function public.marketplace_evaluate_live_product_readiness(uuid,uuid) to service_role;
revoke all on function public.fetch_marketplace_ready_product_ids(text,uuid,text,integer) from public,anon;
grant execute on function public.fetch_marketplace_ready_product_ids(text,uuid,text,integer) to anon,authenticated,service_role;
grant execute on function public.fetch_my_live_product_candidates(uuid,integer,timestamptz,uuid),public.pin_live_session_product(uuid,uuid,uuid,uuid),public.feature_live_session_product(uuid,uuid,uuid),public.publish_marketplace_product(uuid) to authenticated,service_role;

commit;
