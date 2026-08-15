begin;

-- B8C-C1: align the read-only admin projection with frozen B7D temporal
-- semantics. No commerce, allocation, settlement, reversal, or Ads authority
-- is changed here.

create or replace function public.get_marketplace_admin_creator_commerce_overview(p_range text default '30d')
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_end timestamptz:=clock_timestamp();v_start timestamptz;v_summary jsonb;v_surfaces jsonb;
begin
  perform public.marketplace_require_admin();
  if p_range not in('7d','30d','90d','all')then raise exception using errcode='22023',message='marketplace_admin_creator_range_invalid';end if;
  v_start:=case p_range when'7d'then v_end-interval'7 days'when'30d'then v_end-interval'30 days'when'90d'then v_end-interval'90 days'else null end;
  with facts as materialized(select*from public.marketplace_creator_commerce_analytics_facts),
  events as materialized(select*from public.marketplace_creator_commerce_event_facts),
  sales as materialized(select*from facts where(v_start is null or paid_at>=v_start)and paid_at<v_end),
  releases as materialized(select*from facts where commission_released>0 and(v_start is null or released_at>=v_start)and released_at<v_end),
  reversals as materialized(select*from facts where commission_reversed>0 and(v_start is null or reversed_at>=v_start)and reversed_at<v_end),
  engagement as materialized(select*from events where(v_start is null or occurred_at>=v_start)and occurred_at<v_end),
  creators as(select creator_user_id from sales union select creator_user_id from releases union select creator_user_id from reversals union select creator_user_id from engagement),
  surfaces as(select source_surface from sales union select source_surface from releases union select source_surface from reversals union select source_surface from engagement)
  select jsonb_build_object('active_creators',(select count(*)::int from creators),'attributed_orders',(select count(distinct order_id)::int from sales),
    'units',coalesce((select sum(quantity)from sales),0)::bigint,'attributed_gmv',coalesce((select round(sum(attributed_gmv),8)from sales),0)::numeric(20,8),
    'commission_generated',coalesce((select round(sum(commission_generated),8)from sales),0)::numeric(20,8),
    'commission_released',coalesce((select round(sum(commission_released),8)from releases),0)::numeric(20,8),
    'commission_reversed',coalesce((select round(sum(commission_reversed),8)from reversals),0)::numeric(20,8),
    'commission_net',coalesce((select round(sum(commission_released),8)from releases),0)-coalesce((select round(sum(commission_reversed),8)from reversals),0),
    'product_opens',(select count(*)::int from engagement where event_name='product_view'),'add_to_cart',(select count(*)::int from engagement where event_name='add_to_cart')),
   coalesce((select jsonb_agg(jsonb_build_object('source_surface',k.source_surface,
    'product_opens',(select count(*)::int from engagement e where e.source_surface=k.source_surface and e.event_name='product_view'),
    'add_to_cart',(select count(*)::int from engagement e where e.source_surface=k.source_surface and e.event_name='add_to_cart'),
    'orders',(select count(distinct order_id)::int from sales s where s.source_surface=k.source_surface),
    'units',coalesce((select sum(quantity)from sales s where s.source_surface=k.source_surface),0)::bigint,
    'attributed_gmv',coalesce((select round(sum(attributed_gmv),8)from sales s where s.source_surface=k.source_surface),0)::numeric(20,8),
    'commission_generated',coalesce((select round(sum(commission_generated),8)from sales s where s.source_surface=k.source_surface),0)::numeric(20,8),
    'commission_released',coalesce((select round(sum(commission_released),8)from releases r where r.source_surface=k.source_surface),0)::numeric(20,8),
    'commission_reversed',coalesce((select round(sum(commission_reversed),8)from reversals r where r.source_surface=k.source_surface),0)::numeric(20,8),
    'commission_net',coalesce((select round(sum(commission_released),8)from releases r where r.source_surface=k.source_surface),0)-coalesce((select round(sum(commission_reversed),8)from reversals r where r.source_surface=k.source_surface),0))
    order by coalesce((select sum(attributed_gmv)from sales s where s.source_surface=k.source_surface),0)desc,k.source_surface)from surfaces k),'[]'::jsonb)
  into v_summary,v_surfaces;
  return jsonb_build_object('range',p_range,'generated_at',v_end,'timezone','UTC','summary',v_summary,'surface_breakdown',v_surfaces);
end;$$;

create or replace function public.search_marketplace_admin_creators_v2(p_query text default null,p_range text default '30d',
 p_cursor_activity_at timestamptz default null,p_cursor_creator_id uuid default null,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_end timestamptz:=clock_timestamp();v_start timestamptz;v_query text:=nullif(btrim(p_query),'');v_rows jsonb;v_page jsonb;v_more boolean;
begin
 perform public.marketplace_require_admin();
 if p_range not in('7d','30d','90d','all')or p_limit is null or p_limit<1 or p_limit>100 or(v_query is not null and char_length(v_query)>100)
   or((p_cursor_activity_at is null)<>(p_cursor_creator_id is null))then raise exception using errcode='22023',message='marketplace_admin_creator_search_invalid';end if;
 v_start:=case p_range when'7d'then v_end-interval'7 days'when'30d'then v_end-interval'30 days'when'90d'then v_end-interval'90 days'else null end;
 with facts as materialized(select*from public.marketplace_creator_commerce_analytics_facts),events as materialized(select*from public.marketplace_creator_commerce_event_facts),
 sales as materialized(select*from facts where(v_start is null or paid_at>=v_start)and paid_at<v_end),
 releases as materialized(select*from facts where commission_released>0 and(v_start is null or released_at>=v_start)and released_at<v_end),
 reversals as materialized(select*from facts where commission_reversed>0 and(v_start is null or reversed_at>=v_start)and reversed_at<v_end),
 engagement as materialized(select*from events where(v_start is null or occurred_at>=v_start)and occurred_at<v_end),
 activity as(select creator_user_id,paid_at activity_at,source_surface,attributed_gmv,1 weight from sales union all select creator_user_id,released_at,source_surface,0,1 from releases union all select creator_user_id,reversed_at,source_surface,0,1 from reversals union all select creator_user_id,occurred_at,source_surface,0,1 from engagement),
 members as(select creator_user_id,max(activity_at)activity_at from activity group by creator_user_id),
 surface_totals as(select creator_user_id,source_surface,sum(attributed_gmv)gmv,sum(weight)activity_count from activity group by creator_user_id,source_surface),
 top_surfaces as(select distinct on(creator_user_id)creator_user_id,source_surface from surface_totals order by creator_user_id,gmv desc,activity_count desc,source_surface),
 rows as(select jsonb_build_object('creator_id',m.creator_user_id,'username',u.username,'display_name',u.display_name,
  'orders',(select count(distinct order_id)::int from sales s where s.creator_user_id=m.creator_user_id),
  'attributed_gmv',coalesce((select round(sum(attributed_gmv),8)from sales s where s.creator_user_id=m.creator_user_id),0),
  'commission_generated',coalesce((select round(sum(commission_generated),8)from sales s where s.creator_user_id=m.creator_user_id),0),
  'commission_released',coalesce((select round(sum(commission_released),8)from releases r where r.creator_user_id=m.creator_user_id),0),
  'commission_reversed',coalesce((select round(sum(commission_reversed),8)from reversals r where r.creator_user_id=m.creator_user_id),0),
  'commission_net',coalesce((select round(sum(commission_released),8)from releases r where r.creator_user_id=m.creator_user_id),0)-coalesce((select round(sum(commission_reversed),8)from reversals r where r.creator_user_id=m.creator_user_id),0),
  'top_surface',t.source_surface,'last_activity_at',m.activity_at)j
 from members m join top_surfaces t using(creator_user_id)join public.user_profiles u on u.id=m.creator_user_id
 where(v_query is null or u.username ilike'%'||v_query||'%'or u.display_name ilike'%'||v_query||'%')and(p_cursor_activity_at is null or(m.activity_at,m.creator_user_id)<(p_cursor_activity_at,p_cursor_creator_id))
 order by m.activity_at desc,m.creator_user_id desc limit p_limit+1)
 select coalesce(jsonb_agg(j),'[]')into v_rows from rows;
 v_more:=jsonb_array_length(v_rows)>p_limit;
 select coalesce(jsonb_agg(value order by ord),'[]')into v_page from jsonb_array_elements(v_rows)with ordinality e(value,ord)where ord<=p_limit;
 return jsonb_build_object('range',p_range,'creators',v_page,'page_size',jsonb_array_length(v_page),'next_cursor',case when v_more then jsonb_build_object('activity_at',v_page->(p_limit-1)->>'last_activity_at','creator_id',v_page->(p_limit-1)->>'creator_id')else null end);
end;$$;

create or replace function public.get_marketplace_admin_creator_detail(p_creator_id uuid,p_range text default '30d')
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_end timestamptz:=clock_timestamp();v_start timestamptz;v_identity jsonb;v_summary jsonb;v_surfaces jsonb;v_products jsonb;v_items jsonb;
begin
 perform public.marketplace_require_admin();if p_creator_id is null then raise exception using errcode='22023',message='marketplace_admin_creator_required';end if;
 if p_range not in('7d','30d','90d','all')then raise exception using errcode='22023',message='marketplace_admin_creator_range_invalid';end if;
 v_start:=case p_range when'7d'then v_end-interval'7 days'when'30d'then v_end-interval'30 days'when'90d'then v_end-interval'90 days'else null end;
 select jsonb_build_object('id',id,'username',username,'display_name',display_name)into v_identity from public.user_profiles where id=p_creator_id;
 if v_identity is null then raise exception using errcode='P0002',message='marketplace_admin_creator_not_found';end if;
 with facts as materialized(select*from public.marketplace_creator_commerce_analytics_facts where creator_user_id=p_creator_id),events as materialized(select*from public.marketplace_creator_commerce_event_facts where creator_user_id=p_creator_id),
 sales as materialized(select*from facts where(v_start is null or paid_at>=v_start)and paid_at<v_end),releases as materialized(select*from facts where commission_released>0 and(v_start is null or released_at>=v_start)and released_at<v_end),
 reversals as materialized(select*from facts where commission_reversed>0 and(v_start is null or reversed_at>=v_start)and reversed_at<v_end),engagement as materialized(select*from events where(v_start is null or occurred_at>=v_start)and occurred_at<v_end),
 surface_keys as(select source_surface from sales union select source_surface from releases union select source_surface from reversals union select source_surface from engagement),
 product_keys as(select product_id from sales union select product_id from releases union select product_id from reversals union select product_id from engagement),
 relevant as(select order_item_id,greatest(paid_at,coalesce(released_at,'-infinity'),coalesce(reversed_at,'-infinity'))activity_at from facts where order_item_id in(select order_item_id from sales union select order_item_id from releases union select order_item_id from reversals))
 select jsonb_build_object('orders',(select count(distinct order_id)::int from sales),'units',coalesce((select sum(quantity)from sales),0)::bigint,
  'attributed_gmv',coalesce((select round(sum(attributed_gmv),8)from sales),0),'commission_generated',coalesce((select round(sum(commission_generated),8)from sales),0),
  'commission_released',coalesce((select round(sum(commission_released),8)from releases),0),'commission_reversed',coalesce((select round(sum(commission_reversed),8)from reversals),0),
  'commission_net',coalesce((select round(sum(commission_released),8)from releases),0)-coalesce((select round(sum(commission_reversed),8)from reversals),0),
  'product_opens',(select count(*)::int from engagement where event_name='product_view'),'add_to_cart',(select count(*)::int from engagement where event_name='add_to_cart')),
 coalesce((select jsonb_agg(jsonb_build_object('source_surface',k.source_surface,'product_opens',(select count(*)::int from engagement e where e.source_surface=k.source_surface and e.event_name='product_view'),'add_to_cart',(select count(*)::int from engagement e where e.source_surface=k.source_surface and e.event_name='add_to_cart'),'orders',(select count(distinct order_id)::int from sales s where s.source_surface=k.source_surface),'units',coalesce((select sum(quantity)from sales s where s.source_surface=k.source_surface),0),'attributed_gmv',coalesce((select round(sum(attributed_gmv),8)from sales s where s.source_surface=k.source_surface),0),'commission_generated',coalesce((select round(sum(commission_generated),8)from sales s where s.source_surface=k.source_surface),0),'commission_released',coalesce((select round(sum(commission_released),8)from releases r where r.source_surface=k.source_surface),0),'commission_reversed',coalesce((select round(sum(commission_reversed),8)from reversals r where r.source_surface=k.source_surface),0),'commission_net',coalesce((select round(sum(commission_released),8)from releases r where r.source_surface=k.source_surface),0)-coalesce((select round(sum(commission_reversed),8)from reversals r where r.source_surface=k.source_surface),0))order by coalesce((select sum(attributed_gmv)from sales s where s.source_surface=k.source_surface),0)desc,k.source_surface)from surface_keys k),'[]'),
 coalesce((select jsonb_agg(jsonb_build_object('product_id',k.product_id,'title',coalesce((select p.title from public.products p where p.id=k.product_id),(select max(product_title)from facts f where f.product_id=k.product_id),'Producto'),'image_url',coalesce((select case when p.images[1]~'^https://'then p.images[1]end from public.products p where p.id=k.product_id),(select max(image_url)from facts f where f.product_id=k.product_id)),'orders',(select count(distinct order_id)::int from sales s where s.product_id=k.product_id),'units',coalesce((select sum(quantity)from sales s where s.product_id=k.product_id),0),'attributed_gmv',coalesce((select round(sum(attributed_gmv),8)from sales s where s.product_id=k.product_id),0),'commission_generated',coalesce((select round(sum(commission_generated),8)from sales s where s.product_id=k.product_id),0),'commission_released',coalesce((select round(sum(commission_released),8)from releases r where r.product_id=k.product_id),0),'commission_reversed',coalesce((select round(sum(commission_reversed),8)from reversals r where r.product_id=k.product_id),0))order by coalesce((select sum(attributed_gmv)from sales s where s.product_id=k.product_id),0)desc)from product_keys k),'[]'),
 coalesce((select jsonb_agg(to_jsonb(x)order by x.activity_at desc,x.order_item_id desc)from(select f.creator_user_id,f.source_surface,f.source_entity_id,f.product_id,f.order_id,f.order_item_id,f.product_title,f.quantity,a.commission_bps historical_bps,f.attributed_gmv,f.commission_generated,f.commission_released,f.commission_reversed,f.paid_at,f.released_at,f.reversed_at,r.activity_at from facts f join relevant r using(order_item_id)join public.marketplace_order_item_creator_attributions a on a.order_item_id=f.order_item_id and a.creator_user_id=f.creator_user_id and a.order_id=f.order_id order by r.activity_at desc,f.order_item_id desc limit 50)x),'[]')
 into v_summary,v_surfaces,v_products,v_items;
 return jsonb_build_object('range',p_range,'generated_at',v_end,'timezone','UTC','creator',v_identity,'summary',v_summary,'surface_breakdown',v_surfaces,'top_products',v_products,'item_trace',v_items);
end;$$;

-- Canonical reconciliation payloads contain two documented observational
-- structures: payment state distribution and settlement expected/actual
-- escrow totals. Their dedicated mismatch counters remain authoritative.
create or replace function public.marketplace_admin_health_failure_count(p_group text,p_value jsonb)
returns integer language plpgsql immutable set search_path=pg_catalog,public as $$
declare v_count integer:=0;v_key text;v_child jsonb;
begin
 if jsonb_typeof(p_value)='object'then
  for v_key,v_child in select key,value from jsonb_each(p_value)loop
   if(p_group='payments'and v_key='confirmed_state_breakdown')or(p_group='settlements'and v_key in('escrow_expected_held_total','escrow_actual_balance'))then continue;end if;
   v_count:=v_count+public.marketplace_admin_health_failure_count(p_group,v_child);
  end loop;
 elsif jsonb_typeof(p_value)='array'then v_count:=jsonb_array_length(p_value);
 elsif jsonb_typeof(p_value)='number'and(p_value#>>'{}')::numeric<>0 then v_count:=1;
 end if;return v_count;
end;$$;

create or replace function public.marketplace_admin_health_group(p_name text,p_counters jsonb)
returns jsonb language sql immutable set search_path=pg_catalog,public as $$
select jsonb_build_object('name',p_name,'check_count',(select count(*)from jsonb_each(p_counters)),
 'failing_check_count',public.marketplace_admin_health_failure_count(p_name,p_counters),'counters',p_counters,
 'healthy',public.marketplace_admin_health_failure_count(p_name,p_counters)=0);$$;

revoke all on function public.search_marketplace_admin_creators_v2(text,text,timestamptz,uuid,integer)from public,anon,authenticated,service_role;
grant execute on function public.search_marketplace_admin_creators_v2(text,text,timestamptz,uuid,integer)to authenticated,service_role;
revoke all on function public.marketplace_admin_health_failure_count(text,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.marketplace_admin_health_failure_count(text,jsonb)to service_role;

notify pgrst,'reload schema';
commit;
