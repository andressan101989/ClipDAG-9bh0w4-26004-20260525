begin;

create or replace function public.record_marketplace_commerce_event(
  p_event_name text,
  p_product_id uuid,
  p_variant_id uuid default null,
  p_client_session_id uuid default null,
  p_source_type text default 'unknown',
  p_source_entity_id uuid default null,
  p_source_creator_id uuid default null,
  p_source_live_session_id uuid default null,
  p_quantity integer default null,
  p_metadata jsonb default '{}'::jsonb,
  p_idempotency_key text default null
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  actor uuid:=auth.uid();
  p public.products;
  event_id uuid;
begin
  if p_event_name not in('product_view','product_media_view','variant_selected','add_to_cart','checkout_started') then
    raise exception using errcode='22023',message='marketplace_analytics_event_invalid';
  end if;
  if actor is null and p_client_session_id is null then
    raise exception using errcode='22023',message='marketplace_analytics_session_required';
  end if;
  if p_source_type is null or p_source_type not in('direct','shop','search','feed','clip','live','creator','affiliate','unknown') then
    raise exception using errcode='22023',message='marketplace_analytics_source_invalid';
  end if;
  if p_product_id is null then raise exception using errcode='22023',message='marketplace_analytics_product_required';end if;
  if p_metadata is null or jsonb_typeof(p_metadata)<>'object' or pg_column_size(p_metadata)>2048 then
    raise exception using errcode='22023',message='marketplace_analytics_metadata_invalid';
  end if;
  if p_event_name in('product_view','variant_selected','add_to_cart') and p_metadata<>'{}'::jsonb then
    raise exception using errcode='22023',message='marketplace_analytics_metadata_invalid';
  end if;
  if p_event_name='product_media_view' and (
    exists(select 1 from jsonb_object_keys(p_metadata) k where k not in('media_kind','media_position'))
    or (p_metadata?'media_kind' and (jsonb_typeof(p_metadata->'media_kind')<>'string' or p_metadata->>'media_kind' not in('image','video')))
    or (p_metadata?'media_position' and (jsonb_typeof(p_metadata->'media_position')<>'number' or (p_metadata->>'media_position')!~'^[0-9]+$' or (p_metadata->>'media_position')::numeric>20))
  ) then raise exception using errcode='22023',message='marketplace_analytics_metadata_invalid';end if;
  if p_event_name='checkout_started' and (
    exists(select 1 from jsonb_object_keys(p_metadata) k where k not in('item_count','store_count'))
    or (p_metadata?'item_count' and (jsonb_typeof(p_metadata->'item_count')<>'number' or (p_metadata->>'item_count')!~'^[0-9]+$' or (p_metadata->>'item_count')::numeric not between 1 and 1000))
    or (p_metadata?'store_count' and (jsonb_typeof(p_metadata->'store_count')<>'number' or (p_metadata->>'store_count')!~'^[0-9]+$' or (p_metadata->>'store_count')::numeric not between 1 and 100))
  ) then raise exception using errcode='22023',message='marketplace_analytics_metadata_invalid';end if;
  if p_quantity is not null and (p_quantity<1 or p_quantity>1000) then
    raise exception using errcode='22023',message='marketplace_analytics_quantity_invalid';
  end if;
  select * into p from public.products
   where id=p_product_id and status='active' and moderation_status='approved' and published_at is not null and deleted_at is null;
  if not found then raise exception using errcode='22023',message='marketplace_analytics_product_invalid';end if;
  if p_variant_id is not null and not exists(select 1 from public.marketplace_product_variants v where v.id=p_variant_id and v.product_id=p.id) then
    raise exception using errcode='22023',message='marketplace_analytics_variant_invalid';
  end if;
  if p_event_name='add_to_cart' and (p_variant_id is null or p_quantity is null) then
    raise exception using errcode='22023',message='marketplace_analytics_cart_invalid';
  end if;
  insert into public.marketplace_commerce_events(event_name,actor_user_id,client_session_id,product_id,variant_id,seller_id,store_id,quantity,source_type,source_entity_id,source_creator_id,source_live_session_id,metadata,idempotency_key)
  values(p_event_name,actor,p_client_session_id,p.id,p_variant_id,p.seller_id,p.store_id,p_quantity,p_source_type,p_source_entity_id,p_source_creator_id,p_source_live_session_id,p_metadata,p_idempotency_key)
  on conflict do nothing returning id into event_id;
  if event_id is null and p_idempotency_key is not null then
    if actor is not null then
      select id into event_id from public.marketplace_commerce_events
       where actor_user_id=actor and event_name=p_event_name and idempotency_key=p_idempotency_key;
    else
      select id into event_id from public.marketplace_commerce_events
       where client_session_id=p_client_session_id and event_name=p_event_name and idempotency_key=p_idempotency_key;
    end if;
  end if;
  if event_id is null then raise exception using errcode='23505',message='marketplace_analytics_idempotency_conflict';end if;
  return event_id;
end;$$;

create or replace function public.get_my_marketplace_commerce_analytics(p_date_from timestamptz,p_date_to timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid(); result jsonb;
begin
  if actor is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
  if p_date_from is null or p_date_to is null or p_date_from>=p_date_to or p_date_to-p_date_from>interval '366 days' then raise exception using errcode='22023',message='marketplace_analytics_range_invalid';end if;
  if not exists(select 1 from public.marketplace_sellers where user_id=actor) then raise exception using errcode='42501',message='marketplace_seller_required';end if;
  with e as materialized(select * from public.marketplace_commerce_events where seller_id=actor and occurred_at>=p_date_from and occurred_at<p_date_to),summary as(
    select count(*)filter(where event_name='product_view') views,
      count(distinct coalesce(actor_user_id::text,'session:'||client_session_id::text))filter(where event_name='product_view' and(actor_user_id is not null or client_session_id is not null)) unique_viewer_sessions,
      count(*)filter(where event_name='add_to_cart') carts,count(*)filter(where event_name='checkout_started') checkouts,
      count(distinct order_id)filter(where event_name='purchase_completed') orders,count(*)filter(where event_name='purchase_completed') purchase_items,
      coalesce(sum(quantity)filter(where event_name='purchase_completed'),0) units,coalesce(sum(gross_merchandise_bdag)filter(where event_name='purchase_completed'),0)::numeric(20,8) gmv from e
  ),products_json as(
    select coalesce(jsonb_agg(to_jsonb(x)order by x.gmv_bdag desc,x.units_sold desc,x.views desc),'[]'::jsonb)value from(
      select e.product_id,max(p.title) title,count(*)filter(where event_name='product_view')::int views,count(*)filter(where event_name='add_to_cart')::int add_to_cart,
       count(distinct order_id)filter(where event_name='purchase_completed')::int purchase_orders,count(*)filter(where event_name='purchase_completed')::int purchase_items,
       coalesce(sum(quantity)filter(where event_name='purchase_completed'),0)::int units_sold,coalesce(sum(gross_merchandise_bdag)filter(where event_name='purchase_completed'),0)::numeric(20,8) gmv_bdag,
       case when count(*)filter(where event_name='product_view')=0 then 0 else round(100.0*count(*)filter(where event_name='add_to_cart')/count(*)filter(where event_name='product_view'),2)end view_to_cart_event_rate,
       case when count(*)filter(where event_name='product_view')=0 then 0 else round(100.0*count(*)filter(where event_name='purchase_completed')/count(*)filter(where event_name='product_view'),2)end view_to_purchase_event_rate
      from e left join public.products p on p.id=e.product_id where e.product_id is not null group by e.product_id)x
  ),daily_json as(
    select coalesce(jsonb_agg(to_jsonb(x)order by x.event_day),'[]'::jsonb)value from(
      select (occurred_at at time zone 'UTC')::date event_day,count(*)filter(where event_name='product_view')::int views,count(*)filter(where event_name='add_to_cart')::int add_to_cart,
       count(distinct order_id)filter(where event_name='purchase_completed')::int orders,count(*)filter(where event_name='purchase_completed')::int purchase_items,
       coalesce(sum(quantity)filter(where event_name='purchase_completed'),0)::int units_sold,coalesce(sum(gross_merchandise_bdag)filter(where event_name='purchase_completed'),0)::numeric(20,8) gmv_bdag from e group by 1)x
  ),source_json as(
    select coalesce(jsonb_agg(to_jsonb(x)order by x.source_type),'[]'::jsonb)value from(
      select source_type,count(*)filter(where event_name='product_view')::int views,count(*)filter(where event_name='add_to_cart')::int add_to_cart,
       count(distinct order_id)filter(where event_name='purchase_completed')::int orders,count(*)filter(where event_name='purchase_completed')::int purchase_items,
       coalesce(sum(quantity)filter(where event_name='purchase_completed'),0)::int units_sold,coalesce(sum(gross_merchandise_bdag)filter(where event_name='purchase_completed'),0)::numeric(20,8) gmv_bdag from e group by source_type)x
  )
  select jsonb_build_object('date_from',p_date_from,'date_to',p_date_to,'timezone','UTC','summary',jsonb_build_object(
    'product_views',s.views,'unique_viewer_sessions',s.unique_viewer_sessions,'add_to_cart_events',s.carts,'checkout_started',s.checkouts,
    'orders',s.orders,'purchase_items',s.purchase_items,'units_sold',s.units,'gross_merchandise_bdag',s.gmv,
    'view_to_cart_event_rate',case when s.views=0 then 0 else round(100.0*s.carts/s.views,2)end,
    'view_to_purchase_event_rate',case when s.views=0 then 0 else round(100.0*s.purchase_items/s.views,2)end),
    'products',p.value,'daily',d.value,'sources',so.value)into result from summary s cross join products_json p cross join daily_json d cross join source_json so;
  return result;
end;$$;

create or replace function public.get_my_marketplace_variant_analytics(p_date_from timestamptz,p_date_to timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid(); result jsonb;
begin
  if actor is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
  if p_date_from is null or p_date_to is null or p_date_from>=p_date_to or p_date_to-p_date_from>interval '366 days' then raise exception using errcode='22023',message='marketplace_analytics_range_invalid';end if;
  if not exists(select 1 from public.marketplace_sellers where user_id=actor) then raise exception using errcode='42501',message='marketplace_seller_required';end if;
  select coalesce(jsonb_agg(to_jsonb(x)order by x.gmv_bdag desc,x.units_sold desc,x.add_to_cart desc),'[]'::jsonb)into result from(
    select e.product_id,e.variant_id,max(p.title) product_title,max(v.sku) sku,count(*)filter(where e.event_name='variant_selected')::int selections,
      count(*)filter(where e.event_name='add_to_cart')::int add_to_cart,count(distinct e.order_id)filter(where e.event_name='purchase_completed')::int purchase_orders,
      count(*)filter(where e.event_name='purchase_completed')::int purchase_items,coalesce(sum(e.quantity)filter(where e.event_name='purchase_completed'),0)::int units_sold,
      coalesce(sum(e.gross_merchandise_bdag)filter(where e.event_name='purchase_completed'),0)::numeric(20,8) gmv_bdag
    from public.marketplace_commerce_events e left join public.products p on p.id=e.product_id left join public.marketplace_product_variants v on v.id=e.variant_id
    where e.seller_id=actor and e.variant_id is not null and e.occurred_at>=p_date_from and e.occurred_at<p_date_to group by e.product_id,e.variant_id)x;
  return result;
end;$$;

comment on function public.record_marketplace_commerce_event(text,uuid,uuid,uuid,text,uuid,uuid,uuid,integer,jsonb,text) is
  'Records allowlisted, privacy-bounded client analytics. Anonymous callers must supply a random commerce session UUID; device identifiers are not accepted.';
comment on function public.get_my_marketplace_commerce_analytics(timestamptz,timestamptz) is
  'Seller analytics V1. Event rates are event activity ratios and may exceed 100%; they are not user/session cohort conversion. Purchases lack a durable originating commerce-session ID, so true view-to-order funnel conversion is deferred.';
comment on table public.marketplace_commerce_events is
  'Append-only Marketplace analytics V1. Normal client RPC metadata is event-key allowlisted and accepts no address/email/phone/wallet PII. Product, variant, seller and store attribution follows ON DELETE SET NULL; Marketplace currently soft-deletes products, but a future hard delete would remove those historical dimensions.';

commit;
