begin;

create table public.marketplace_commerce_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  event_version smallint not null default 1,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid references auth.users(id) on delete set null,
  client_session_id uuid,
  product_id uuid references public.products(id) on delete set null,
  variant_id uuid references public.marketplace_product_variants(id) on delete set null,
  seller_id uuid references public.marketplace_sellers(user_id) on delete set null,
  store_id uuid references public.marketplace_stores(id) on delete set null,
  order_id uuid references public.marketplace_orders(id) on delete restrict,
  order_item_id uuid references public.marketplace_order_items(id) on delete restrict,
  quantity integer,
  unit_price_bdag numeric(20,8),
  gross_merchandise_bdag numeric(20,8),
  source_type text not null default 'unknown',
  source_entity_id uuid,
  source_creator_id uuid references auth.users(id) on delete set null,
  source_live_session_id uuid references public.live_sessions(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  idempotency_key text,
  created_at timestamptz not null default now(),
  constraint marketplace_commerce_event_name_check check(event_name in('product_view','product_media_view','variant_selected','add_to_cart','checkout_started','purchase_completed')),
  constraint marketplace_commerce_event_version_check check(event_version=1),
  constraint marketplace_commerce_source_check check(source_type in('direct','shop','search','feed','clip','live','creator','affiliate','unknown')),
  constraint marketplace_commerce_quantity_check check(quantity is null or quantity between 1 and 1000),
  constraint marketplace_commerce_money_check check(
    (unit_price_bdag is null or (unit_price_bdag>0 and unit_price_bdag=round(unit_price_bdag,8))) and
    (gross_merchandise_bdag is null or (gross_merchandise_bdag>0 and gross_merchandise_bdag=round(gross_merchandise_bdag,8)))
  ),
  constraint marketplace_commerce_metadata_check check(jsonb_typeof(metadata)='object' and pg_column_size(metadata)<=2048),
  constraint marketplace_commerce_purchase_shape_check check(
    (event_name<>'purchase_completed' and order_id is null and order_item_id is null and unit_price_bdag is null and gross_merchandise_bdag is null)
    or
    (event_name='purchase_completed' and order_id is not null and order_item_id is not null and quantity is not null and unit_price_bdag is not null and gross_merchandise_bdag is not null)
  )
);

create unique index marketplace_commerce_event_idempotency_unique
  on public.marketplace_commerce_events(actor_user_id,event_name,idempotency_key)
  where idempotency_key is not null and event_name<>'purchase_completed';
create unique index marketplace_commerce_purchase_item_unique
  on public.marketplace_commerce_events(order_item_id)
  where event_name='purchase_completed';
create index marketplace_commerce_seller_time_idx on public.marketplace_commerce_events(seller_id,occurred_at desc);
create index marketplace_commerce_product_time_idx on public.marketplace_commerce_events(product_id,occurred_at desc);
create index marketplace_commerce_event_time_idx on public.marketplace_commerce_events(event_name,occurred_at desc);
create index marketplace_commerce_source_time_idx on public.marketplace_commerce_events(source_type,occurred_at desc);

alter table public.marketplace_commerce_events enable row level security;
revoke all on public.marketplace_commerce_events from public,anon,authenticated;
grant select,insert on public.marketplace_commerce_events to service_role;

create or replace function public.reject_marketplace_commerce_event_mutation()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception using errcode='42501',message='marketplace_analytics_event_immutable';
end;$$;
create trigger marketplace_commerce_event_immutable
before update or delete on public.marketplace_commerce_events
for each row execute function public.reject_marketplace_commerce_event_mutation();

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
  if p_source_type is null or p_source_type not in('direct','shop','search','feed','clip','live','creator','affiliate','unknown') then
    raise exception using errcode='22023',message='marketplace_analytics_source_invalid';
  end if;
  if p_product_id is null then raise exception using errcode='22023',message='marketplace_analytics_product_required';end if;
  if p_metadata is null or jsonb_typeof(p_metadata)<>'object' or pg_column_size(p_metadata)>2048 then
    raise exception using errcode='22023',message='marketplace_analytics_metadata_invalid';
  end if;
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
  on conflict(actor_user_id,event_name,idempotency_key) where idempotency_key is not null and event_name<>'purchase_completed'
  do update set id=marketplace_commerce_events.id
  returning id into event_id;
  return event_id;
end;$$;

revoke all on function public.record_marketplace_commerce_event(text,uuid,uuid,uuid,text,uuid,uuid,uuid,integer,jsonb,text) from public,anon;
grant execute on function public.record_marketplace_commerce_event(text,uuid,uuid,uuid,text,uuid,uuid,uuid,integer,jsonb,text) to authenticated,service_role;

create or replace function public.marketplace_record_confirmed_purchase_analytics()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  item public.marketplace_order_items;
  live_source public.marketplace_live_order_sources;
  source_name text:='unknown';
  source_creator uuid;
  source_live uuid;
begin
  if old.status='pending_payment' and new.status='confirmed' then
    select * into live_source from public.marketplace_live_order_sources where order_id=new.id;
    if found then
      source_name:='live'; source_creator:=live_source.live_host_id; source_live:=live_source.live_session_id;
    end if;
    for item in select * from public.marketplace_order_items where order_id=new.id loop
      insert into public.marketplace_commerce_events(event_name,actor_user_id,product_id,variant_id,seller_id,store_id,order_id,order_item_id,quantity,unit_price_bdag,gross_merchandise_bdag,source_type,source_creator_id,source_live_session_id,metadata,idempotency_key)
      values('purchase_completed',new.buyer_id,item.product_id,item.variant_id,item.seller_id,item.store_id,new.id,item.id,item.quantity,item.unit_price,item.line_total,source_name,source_creator,source_live,'{}'::jsonb,'purchase:'||item.id::text)
      on conflict(order_item_id) where event_name='purchase_completed' do nothing;
    end loop;
  end if;
  return new;
exception when others then
  -- Analytics is observational: never reverse or block the authoritative paid transition.
  raise warning 'marketplace_purchase_analytics_failed order=% sqlstate=%',new.id,sqlstate;
  return new;
end;$$;
create trigger marketplace_confirmed_purchase_analytics
after update of status on public.marketplace_orders
for each row execute function public.marketplace_record_confirmed_purchase_analytics();

create or replace function public.get_my_marketplace_commerce_analytics(p_date_from timestamptz,p_date_to timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid(); result jsonb;
begin
  if actor is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
  if p_date_from is null or p_date_to is null or p_date_from>=p_date_to or p_date_to-p_date_from>interval '366 days' then
    raise exception using errcode='22023',message='marketplace_analytics_range_invalid';
  end if;
  if not exists(select 1 from public.marketplace_sellers where user_id=actor) then
    raise exception using errcode='42501',message='marketplace_seller_required';
  end if;
  with e as materialized(
    select * from public.marketplace_commerce_events where seller_id=actor and occurred_at>=p_date_from and occurred_at<p_date_to
  ),summary as(
    select count(*)filter(where event_name='product_view') views,
      count(distinct coalesce(actor_user_id::text,'session:'||client_session_id::text))filter(where event_name='product_view' and(actor_user_id is not null or client_session_id is not null)) unique_viewer_sessions,
      count(*)filter(where event_name='add_to_cart') carts,
      count(*)filter(where event_name='checkout_started') checkouts,
      count(*)filter(where event_name='purchase_completed') purchases,
      coalesce(sum(quantity)filter(where event_name='purchase_completed'),0) units,
      coalesce(sum(gross_merchandise_bdag)filter(where event_name='purchase_completed'),0)::numeric(20,8) gmv
    from e
  ),products_json as(
    select coalesce(jsonb_agg(to_jsonb(x)order by x.gmv_bdag desc,x.units_sold desc,x.views desc),'[]'::jsonb) value from(
      select e.product_id,max(p.title) title,count(*)filter(where event_name='product_view')::int views,count(*)filter(where event_name='add_to_cart')::int add_to_cart,
       count(*)filter(where event_name='purchase_completed')::int purchases,coalesce(sum(quantity)filter(where event_name='purchase_completed'),0)::int units_sold,
       coalesce(sum(gross_merchandise_bdag)filter(where event_name='purchase_completed'),0)::numeric(20,8) gmv_bdag,
       case when count(*)filter(where event_name='product_view')=0 then 0 else round(100.0*count(*)filter(where event_name='add_to_cart')/count(*)filter(where event_name='product_view'),2)end view_to_cart_rate,
       case when count(*)filter(where event_name='product_view')=0 then 0 else round(100.0*count(*)filter(where event_name='purchase_completed')/count(*)filter(where event_name='product_view'),2)end view_to_purchase_rate
      from e left join public.products p on p.id=e.product_id where e.product_id is not null group by e.product_id
    )x
  ),daily_json as(
    select coalesce(jsonb_agg(to_jsonb(x)order by x.event_day),'[]'::jsonb)value from(
      select (occurred_at at time zone 'UTC')::date event_day,count(*)filter(where event_name='product_view')::int views,count(*)filter(where event_name='add_to_cart')::int add_to_cart,
       count(*)filter(where event_name='purchase_completed')::int purchases,coalesce(sum(quantity)filter(where event_name='purchase_completed'),0)::int units_sold,
       coalesce(sum(gross_merchandise_bdag)filter(where event_name='purchase_completed'),0)::numeric(20,8) gmv_bdag from e group by 1
    )x
  ),source_json as(
    select coalesce(jsonb_agg(to_jsonb(x)order by x.source_type),'[]'::jsonb)value from(
      select source_type,count(*)filter(where event_name='product_view')::int views,count(*)filter(where event_name='add_to_cart')::int add_to_cart,
       count(*)filter(where event_name='purchase_completed')::int purchases,coalesce(sum(quantity)filter(where event_name='purchase_completed'),0)::int units_sold,
       coalesce(sum(gross_merchandise_bdag)filter(where event_name='purchase_completed'),0)::numeric(20,8) gmv_bdag from e group by source_type
    )x
  )
  select jsonb_build_object('date_from',p_date_from,'date_to',p_date_to,'timezone','UTC','summary',jsonb_build_object(
    'product_views',s.views,'unique_viewer_sessions',s.unique_viewer_sessions,'add_to_cart_events',s.carts,'checkout_started',s.checkouts,'purchases',s.purchases,'units_sold',s.units,'gross_merchandise_bdag',s.gmv,
    'conversion_view_to_cart',case when s.views=0 then 0 else round(100.0*s.carts/s.views,2)end,
    'conversion_view_to_purchase',case when s.views=0 then 0 else round(100.0*s.purchases/s.views,2)end),
    'products',p.value,'daily',d.value,'sources',so.value) into result
  from summary s cross join products_json p cross join daily_json d cross join source_json so;
  return result;
end;$$;

revoke all on function public.get_my_marketplace_commerce_analytics(timestamptz,timestamptz) from public,anon;
grant execute on function public.get_my_marketplace_commerce_analytics(timestamptz,timestamptz) to authenticated,service_role;

comment on table public.marketplace_commerce_events is 'Append-only Marketplace analytics V1. Observational only; contains no commerce authority or buyer address PII.';
comment on column public.marketplace_commerce_events.gross_merchandise_bdag is 'Merchandise-only gross value from immutable order_item.line_total; excludes shipping, fees, refunds and seller net.';

commit;
