begin;

-- B8C is an admin-only observational layer. Canonical commerce, creator,
-- promotion and Ads authorities remain unchanged.

-- The existing indexes lead with seller/target and cannot satisfy the global
-- keyset ordering used by the three admin lists.
create index marketplace_promotions_admin_created_idx on public.marketplace_product_promotions(created_at desc,id desc);
create index marketplace_ads_admin_created_idx on public.marketplace_ad_campaigns(created_at desc,id desc);
create index marketplace_admin_activity_created_idx on public.marketplace_admin_action_audit(created_at desc,id desc);

create or replace function public.get_my_marketplace_admin_access()
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public as $$
declare v_actor uuid;v_profile public.user_profiles;
begin
  v_actor:=public.marketplace_require_admin();
  select*into strict v_profile from public.user_profiles where id=v_actor;
  return jsonb_build_object('user_id',v_profile.id,'username',v_profile.username,'display_name',v_profile.display_name,'admin',true,
    'capabilities',jsonb_build_array('marketplace:read','marketplace:disputes','marketplace:sellers','marketplace:products',
      'marketplace:creator-commerce','marketplace:promotions','marketplace:ads','marketplace:health','marketplace:audit'));
end;$$;

create or replace function public.get_marketplace_admin_creator_commerce_overview(p_range text default '30d')
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_start timestamptz;v_summary jsonb;v_surfaces jsonb;v_events jsonb;
begin
  perform public.marketplace_require_admin();v_start:=public.marketplace_admin_range_start(p_range);
  select jsonb_build_object('active_creators',count(distinct creator_user_id),'attributed_orders',count(distinct order_id),
    'units',coalesce(sum(quantity),0),'attributed_gmv',coalesce(sum(attributed_gmv),0),
    'commission_generated',coalesce(sum(commission_generated),0),'commission_released',coalesce(sum(commission_released),0),
    'commission_reversed',coalesce(sum(commission_reversed),0),
    'commission_net',coalesce(sum(commission_released),0)-coalesce(sum(commission_reversed),0)) into v_summary
  from public.marketplace_creator_commerce_analytics_facts where v_start is null or paid_at>=v_start;
  select coalesce(jsonb_agg(x order by (x->>'attributed_gmv')::numeric desc,x->>'source_surface'),'[]') into v_surfaces from(
    select jsonb_build_object('source_surface',source_surface,'orders',count(distinct order_id),'units',sum(quantity),
      'attributed_gmv',sum(attributed_gmv),'commission_generated',sum(commission_generated),
      'commission_released',sum(commission_released),'commission_reversed',sum(commission_reversed),
      'commission_net',sum(commission_released)-sum(commission_reversed))x
    from public.marketplace_creator_commerce_analytics_facts where v_start is null or paid_at>=v_start group by source_surface)s;
  select jsonb_build_object('product_opens',count(*)filter(where event_name='product_view'),
    'add_to_cart',count(*)filter(where event_name='add_to_cart')) into v_events
  from public.marketplace_creator_commerce_event_facts where v_start is null or occurred_at>=v_start;
  return jsonb_build_object('range',p_range,'generated_at',statement_timestamp(),'summary',v_summary||v_events,'surface_breakdown',v_surfaces);
end;$$;

create or replace function public.search_marketplace_admin_creators(p_query text default null,p_range text default '30d',
  p_cursor_last_sale timestamptz default null,p_cursor_creator_id uuid default null,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_start timestamptz;v_query text:=nullif(btrim(p_query),'');v_rows jsonb;v_page jsonb;v_more boolean;
begin
  perform public.marketplace_require_admin();v_start:=public.marketplace_admin_range_start(p_range);
  if p_limit is null or p_limit<1 or p_limit>100 or (v_query is not null and char_length(v_query)>100)
    or ((p_cursor_last_sale is null)<>(p_cursor_creator_id is null)) then
    raise exception using errcode='22023',message='marketplace_admin_creator_search_invalid';end if;
  with surface_totals as(
    select f.creator_user_id,f.source_surface,sum(f.attributed_gmv)attributed_gmv
    from public.marketplace_creator_commerce_analytics_facts f
    where v_start is null or f.paid_at>=v_start group by f.creator_user_id,f.source_surface),
  top_surfaces as(
    select distinct on(creator_user_id)creator_user_id,source_surface
    from surface_totals order by creator_user_id,attributed_gmv desc,source_surface),
  grouped as(
    select f.creator_user_id,max(f.paid_at)last_sale,count(distinct f.order_id)orders,sum(f.attributed_gmv)gmv,
      sum(f.commission_generated)generated,sum(f.commission_released)released,sum(f.commission_reversed)reversed
    from public.marketplace_creator_commerce_analytics_facts f where v_start is null or f.paid_at>=v_start group by f.creator_user_id),
  rows as(select jsonb_build_object('creator_id',g.creator_user_id,'username',u.username,'display_name',u.display_name,
    'orders',g.orders,'attributed_gmv',g.gmv,'commission_generated',g.generated,'commission_released',g.released,
    'commission_reversed',g.reversed,'commission_net',g.released-g.reversed,'top_surface',t.source_surface,'last_sale',g.last_sale)j
    from grouped g join top_surfaces t on t.creator_user_id=g.creator_user_id join public.user_profiles u on u.id=g.creator_user_id
    where (v_query is null or u.username ilike '%'||v_query||'%' or u.display_name ilike '%'||v_query||'%')
      and (p_cursor_last_sale is null or (g.last_sale,g.creator_user_id)<(p_cursor_last_sale,p_cursor_creator_id))
    order by g.last_sale desc,g.creator_user_id desc limit p_limit+1)
  select coalesce(jsonb_agg(j),'[]')into v_rows from rows;
  v_more:=jsonb_array_length(v_rows)>p_limit;
  select coalesce(jsonb_agg(value order by ord),'[]')into v_page from jsonb_array_elements(v_rows)with ordinality e(value,ord)where ord<=p_limit;
  return jsonb_build_object('range',p_range,'creators',v_page,'page_size',jsonb_array_length(v_page),'next_cursor',
    case when v_more then jsonb_build_object('last_sale',v_page->(p_limit-1)->>'last_sale','creator_id',v_page->(p_limit-1)->>'creator_id')else null end);
end;$$;

create or replace function public.get_marketplace_admin_creator_detail(p_creator_id uuid,p_range text default '30d')
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_start timestamptz;v_identity jsonb;v_summary jsonb;v_surfaces jsonb;v_products jsonb;v_items jsonb;v_events jsonb;
begin
  perform public.marketplace_require_admin();if p_creator_id is null then raise exception using errcode='22023',message='marketplace_admin_creator_required';end if;
  v_start:=public.marketplace_admin_range_start(p_range);
  select jsonb_build_object('id',id,'username',username,'display_name',display_name)into v_identity from public.user_profiles where id=p_creator_id;
  if v_identity is null then raise exception using errcode='P0002',message='marketplace_admin_creator_not_found';end if;
  select jsonb_build_object('orders',count(distinct order_id),'units',coalesce(sum(quantity),0),'attributed_gmv',coalesce(sum(attributed_gmv),0),
    'commission_generated',coalesce(sum(commission_generated),0),'commission_released',coalesce(sum(commission_released),0),
    'commission_reversed',coalesce(sum(commission_reversed),0),'commission_net',coalesce(sum(commission_released),0)-coalesce(sum(commission_reversed),0))into v_summary
  from public.marketplace_creator_commerce_analytics_facts where creator_user_id=p_creator_id and(v_start is null or paid_at>=v_start);
  select coalesce(jsonb_agg(j order by (j->>'attributed_gmv')::numeric desc),'[]')into v_surfaces from(select jsonb_build_object('source_surface',source_surface,
    'orders',count(distinct order_id),'units',sum(quantity),'attributed_gmv',sum(attributed_gmv),'commission_generated',sum(commission_generated),
    'commission_released',sum(commission_released),'commission_reversed',sum(commission_reversed),'commission_net',sum(commission_released)-sum(commission_reversed))j
    from public.marketplace_creator_commerce_analytics_facts where creator_user_id=p_creator_id and(v_start is null or paid_at>=v_start)group by source_surface)s;
  select coalesce(jsonb_agg(j order by (j->>'attributed_gmv')::numeric desc),'[]')into v_products from(select jsonb_build_object('product_id',product_id,
    'title',max(product_title),'image_url',max(image_url),'orders',count(distinct order_id),'units',sum(quantity),'attributed_gmv',sum(attributed_gmv),
    'commission_generated',sum(commission_generated),'commission_released',sum(commission_released),'commission_reversed',sum(commission_reversed))j
    from public.marketplace_creator_commerce_analytics_facts where creator_user_id=p_creator_id and(v_start is null or paid_at>=v_start)
    group by product_id order by sum(attributed_gmv)desc limit 10)s;
  select coalesce(jsonb_agg(to_jsonb(f)order by f.paid_at desc,f.order_item_id desc),'[]')into v_items from(
    select * from public.marketplace_creator_commerce_analytics_facts where creator_user_id=p_creator_id and(v_start is null or paid_at>=v_start)
    order by paid_at desc,order_item_id desc limit 50)f;
  select jsonb_build_object('product_opens',count(*)filter(where event_name='product_view'),'add_to_cart',count(*)filter(where event_name='add_to_cart'))into v_events
  from public.marketplace_creator_commerce_event_facts where creator_user_id=p_creator_id and(v_start is null or occurred_at>=v_start);
  return jsonb_build_object('range',p_range,'creator',v_identity,'summary',v_summary||v_events,'surface_breakdown',v_surfaces,'top_products',v_products,'item_trace',v_items);
end;$$;

create or replace function public.search_marketplace_admin_promotions(p_query text default null,p_state text default null,
  p_cursor_created_at timestamptz default null,p_cursor_id uuid default null,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_query text:=nullif(btrim(p_query),'');v_rows jsonb;v_page jsonb;v_more boolean;
begin
  perform public.marketplace_require_admin();
  if p_limit is null or p_limit<1 or p_limit>100 or(v_query is not null and char_length(v_query)>100)
    or(p_state is not null and p_state not in('scheduled','active','ended','cancelled'))or((p_cursor_created_at is null)<>(p_cursor_id is null))then
    raise exception using errcode='22023',message='marketplace_admin_promotion_search_invalid';end if;
  with rows as(select jsonb_build_object('id',p.id,'seller_id',p.seller_id,'seller_name',coalesce(u.display_name,u.username,'—'),'store_id',p.store_id,'store_name',s.name,
    'product_id',p.product_id,'product_title',pr.title,'variant_id',p.variant_id,'variant_title',v.title,'promotion_type',p.promotion_type,
    'configured_value',coalesce(p.percentage_off,p.fixed_amount_bdag,p.promotional_price_bdag),'starts_at',p.starts_at,'ends_at',p.ends_at,
    'state',case when p.status='cancelled'then'cancelled'when p.status='ended'or now()>=p.ends_at then'ended'when now()<p.starts_at then'scheduled'else'active'end,
    'current_price',case when v.id is null then null else public.marketplace_effective_price(p.product_id,v.id,now())end,
    'historical_orders',(select count(distinct oi.order_id)from public.marketplace_order_items oi where oi.promotion_id=p.id),
    'historical_units',(select coalesce(sum(oi.quantity),0)from public.marketplace_order_items oi where oi.promotion_id=p.id),'created_at',p.created_at)j
    from public.marketplace_product_promotions p join public.products pr on pr.id=p.product_id join public.marketplace_stores s on s.id=p.store_id
    join public.user_profiles u on u.id=p.seller_id left join public.marketplace_product_variants v on v.id=coalesce(p.variant_id,(select v0.id from public.marketplace_product_variants v0 where v0.product_id=p.product_id and v0.status='active'and v0.archived_at is null order by v0.is_default desc,v0.created_at limit 1))
    where(v_query is null or pr.title ilike'%'||v_query||'%'or s.name ilike'%'||v_query||'%'or u.username ilike'%'||v_query||'%')
      and(p_state is null or p_state=case when p.status='cancelled'then'cancelled'when p.status='ended'or now()>=p.ends_at then'ended'when now()<p.starts_at then'scheduled'else'active'end)
      and(p_cursor_created_at is null or(p.created_at,p.id)<(p_cursor_created_at,p_cursor_id))order by p.created_at desc,p.id desc limit p_limit+1)
  select coalesce(jsonb_agg(j),'[]')into v_rows from rows;v_more:=jsonb_array_length(v_rows)>p_limit;
  select coalesce(jsonb_agg(value order by ord),'[]')into v_page from jsonb_array_elements(v_rows)with ordinality e(value,ord)where ord<=p_limit;
  return jsonb_build_object('promotions',v_page,'page_size',jsonb_array_length(v_page),'next_cursor',case when v_more then jsonb_build_object('created_at',v_page->(p_limit-1)->>'created_at','id',v_page->(p_limit-1)->>'id')else null end);
end;$$;

create or replace function public.get_marketplace_admin_promotion_detail(p_promotion_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_result jsonb;
begin
  perform public.marketplace_require_admin();
  select jsonb_build_object('promotion',to_jsonb(p)-'idempotency_key','seller',jsonb_build_object('id',u.id,'username',u.username,'display_name',u.display_name),
    'store',jsonb_build_object('id',s.id,'name',s.name,'slug',s.slug,'status',s.status),'product',jsonb_build_object('id',pr.id,'title',pr.title,'status',pr.status,'moderation_status',pr.moderation_status),
    'variant',case when v.id is null then null else jsonb_build_object('id',v.id,'title',v.title,'sku',v.sku,'price',v.price,'status',v.status)end,
    'current_price',case when v.id is null then null else public.marketplace_effective_price(p.product_id,v.id,now())end,
    'historical_usage',coalesce((select jsonb_agg(jsonb_build_object('order_id',oi.order_id,'order_item_id',oi.id,'quantity',oi.quantity,'base_unit_price',oi.base_unit_price,'discount_amount',oi.discount_amount,'unit_price',oi.unit_price,'line_total',oi.line_total)order by o.created_at desc)from public.marketplace_order_items oi join public.marketplace_orders o on o.id=oi.order_id where oi.promotion_id=p.id),'[]'))into v_result
  from public.marketplace_product_promotions p join public.user_profiles u on u.id=p.seller_id join public.marketplace_stores s on s.id=p.store_id join public.products pr on pr.id=p.product_id
  left join public.marketplace_product_variants v on v.id=coalesce(p.variant_id,(select v0.id from public.marketplace_product_variants v0 where v0.product_id=p.product_id and v0.status='active'and v0.archived_at is null order by v0.is_default desc,v0.created_at limit 1))where p.id=p_promotion_id;
  if v_result is null then raise exception using errcode='P0002',message='marketplace_admin_promotion_not_found';end if;return v_result;
end;$$;

create or replace function public.search_marketplace_admin_ads(p_query text default null,p_status text default null,p_attention boolean default null,
  p_cursor_created_at timestamptz default null,p_cursor_id uuid default null,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_query text:=nullif(btrim(p_query),'');v_rows jsonb;v_page jsonb;v_more boolean;
begin
  perform public.marketplace_require_admin();if p_limit is null or p_limit<1 or p_limit>100 or(v_query is not null and char_length(v_query)>100)
    or(p_status is not null and p_status not in('draft','scheduled','active','paused','exhausted','completed','cancelled'))or((p_cursor_created_at is null)<>(p_cursor_id is null))then
    raise exception using errcode='22023',message='marketplace_admin_ads_search_invalid';end if;
  with rows as(select jsonb_build_object('id',c.id,'name',c.name,'seller_id',c.seller_id,'seller_name',coalesce(u.display_name,u.username,'—'),'store_id',c.store_id,'store_name',s.name,'product_id',c.product_id,'product_title',p.title,
    'status',c.status,'eligibility_state',c.eligibility_state,'eligibility_reason',c.eligibility_reason,'starts_at',c.starts_at,'ends_at',c.ends_at,
    'total_budget',c.total_budget_bdag,'spent',c.spent_bdag,'released',c.released_bdag,'remaining_reserved',c.total_budget_bdag-c.spent_bdag-c.released_bdag,
    'funded_at',c.funded_at,'completed_at',c.completed_at,'attention',(c.ends_at<=now()and c.funded_at is not null and c.status in('scheduled','active','paused'))or(c.status in('active','scheduled')and not c.eligibility_state),'created_at',c.created_at)j
    from public.marketplace_ad_campaigns c join public.user_profiles u on u.id=c.seller_id join public.marketplace_stores s on s.id=c.store_id join public.products p on p.id=c.product_id
    where(v_query is null or c.name ilike'%'||v_query||'%'or p.title ilike'%'||v_query||'%'or s.name ilike'%'||v_query||'%')and(p_status is null or c.status=p_status)
      and(p_attention is null or p_attention=((c.ends_at<=now()and c.funded_at is not null and c.status in('scheduled','active','paused'))or(c.status in('active','scheduled')and not c.eligibility_state)))
      and(p_cursor_created_at is null or(c.created_at,c.id)<(p_cursor_created_at,p_cursor_id))order by c.created_at desc,c.id desc limit p_limit+1)
  select coalesce(jsonb_agg(j),'[]')into v_rows from rows;v_more:=jsonb_array_length(v_rows)>p_limit;
  select coalesce(jsonb_agg(value order by ord),'[]')into v_page from jsonb_array_elements(v_rows)with ordinality e(value,ord)where ord<=p_limit;
  return jsonb_build_object('campaigns',v_page,'page_size',jsonb_array_length(v_page),'next_cursor',case when v_more then jsonb_build_object('created_at',v_page->(p_limit-1)->>'created_at','id',v_page->(p_limit-1)->>'id')else null end);
end;$$;

create or replace function public.get_marketplace_admin_ad_detail(p_campaign_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_result jsonb;
begin perform public.marketplace_require_admin();
  select jsonb_build_object('campaign',to_jsonb(c)-'creation_idempotency_key'-'funding_idempotency_key','seller',jsonb_build_object('id',u.id,'username',u.username,'display_name',u.display_name),
    'store',jsonb_build_object('id',s.id,'name',s.name,'status',s.status),'product',jsonb_build_object('id',p.id,'title',p.title,'status',p.status,'moderation_status',p.moderation_status),
    'financial',jsonb_build_object('total_budget',c.total_budget_bdag,'spent',c.spent_bdag,'released',c.released_bdag,'remaining_reserved',c.total_budget_bdag-c.spent_bdag-c.released_bdag),
    'financial_events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'event_type',e.event_type,'amount',e.amount_bdag,'financial_transaction_id',e.financial_transaction_id,'created_at',e.created_at)order by e.created_at)from public.marketplace_ad_financial_events e where e.campaign_id=c.id),'[]'),
    'finalization',(select to_jsonb(f)-'idempotency_key'from public.marketplace_ad_finalizations f where f.campaign_id=c.id),
    'delivery',jsonb_build_object('materializations',(select count(*)from public.marketplace_ad_delivery_materializations m where m.campaign_id=c.id),'eligible_elapsed_seconds',c.eligible_elapsed_seconds),
    'events',coalesce((select jsonb_object_agg(event_type,n)from(select event_type,count(*)n from public.marketplace_ad_events where campaign_id=c.id group by event_type)e),'{}'),
    'attribution',jsonb_build_object('orders',(select count(distinct a.order_id)from public.marketplace_order_ad_attribution a where a.campaign_id=c.id),'units',(select count(*)from public.marketplace_order_ad_attribution a where a.campaign_id=c.id),'gmv',(select coalesce(sum(a.attributed_gmv_bdag),0)from public.marketplace_order_ad_attribution a where a.campaign_id=c.id)))into v_result
  from public.marketplace_ad_campaigns c join public.user_profiles u on u.id=c.seller_id join public.marketplace_stores s on s.id=c.store_id join public.products p on p.id=c.product_id where c.id=p_campaign_id;
  if v_result is null then raise exception using errcode='P0002',message='marketplace_admin_ad_not_found';end if;return v_result;end;$$;

create or replace function public.marketplace_admin_health_failure_count(p_value jsonb)
returns integer language plpgsql immutable set search_path=pg_catalog,public as $$
declare v_count integer:=0;v_child jsonb;
begin
 if jsonb_typeof(p_value)='object'then for v_child in select value from jsonb_each(p_value)loop v_count:=v_count+public.marketplace_admin_health_failure_count(v_child);end loop;
 elsif jsonb_typeof(p_value)='array'then for v_child in select value from jsonb_array_elements(p_value)loop v_count:=v_count+public.marketplace_admin_health_failure_count(v_child);end loop;
 elsif jsonb_typeof(p_value)='number'and(p_value#>>'{}')::numeric<>0 then v_count:=1;end if;return v_count;
end;$$;

create or replace function public.marketplace_admin_health_group(p_name text,p_counters jsonb)
returns jsonb language sql immutable set search_path=pg_catalog,public as $$
select jsonb_build_object('name',p_name,'check_count',(select count(*)from jsonb_each(p_counters)),
 'failing_check_count',public.marketplace_admin_health_failure_count(p_counters),'counters',p_counters,
 'healthy',public.marketplace_admin_health_failure_count(p_counters)=0);$$;

create or replace function public.get_marketplace_admin_health()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_groups jsonb;v_attention jsonb;
begin perform public.marketplace_require_admin();
  v_groups:=jsonb_build_array(
    public.marketplace_admin_health_group('payments',public.reconcile_marketplace_payments()),
    public.marketplace_admin_health_group('settlements',public.reconcile_marketplace_settlements()),
    public.marketplace_admin_health_group('creator_commerce',public.reconcile_marketplace_creator_commerce()),
    public.marketplace_admin_health_group('creator_showcase',public.reconcile_marketplace_creator_showcase()),
    public.marketplace_admin_health_group('creator_content_tags',public.reconcile_marketplace_creator_content_tags()),
    public.marketplace_admin_health_group('creator_allocations',public.reconcile_marketplace_multi_creator_allocations()),
    public.marketplace_admin_health_group('live_creator_commissions',public.reconcile_marketplace_live_commissions()),
    public.marketplace_admin_health_group('creator_analytics',public.reconcile_marketplace_creator_commerce_analytics()),
    public.marketplace_admin_health_group('reversals',public.reconcile_marketplace_settlement_reversals()),
    public.marketplace_admin_health_group('ads_finance',public.reconcile_marketplace_ad_finance()),
    public.marketplace_admin_health_group('ads_eligibility',public.reconcile_marketplace_ad_eligibility_clock()),
    public.marketplace_admin_health_group('ads_finalization',public.reconcile_marketplace_ad_finalization()),
    public.marketplace_admin_health_group('ads_delivery',public.reconcile_marketplace_ad_delivery()),
    public.marketplace_admin_health_group('ads_events',public.reconcile_marketplace_ad_events()),
    public.marketplace_admin_health_group('admin_operations',public.reconcile_marketplace_admin_operations()));
  select coalesce(jsonb_agg(j),'[]')into v_attention from(
    select jsonb_build_object('reason_code','ads_expired_unfinalized','entity_type','ad_campaign','entity_id',id,'severity','critical','message','Campaña vencida con reserva pendiente.')j from public.marketplace_ad_campaigns where funded_at is not null and ends_at<=now()and status in('scheduled','active','paused')
    union all select jsonb_build_object('reason_code','ads_active_ineligible','entity_type','ad_campaign','entity_id',id,'severity','warning','message','Campaña activa o programada sin elegibilidad actual.')from public.marketplace_ad_campaigns where status in('active','scheduled')and not eligibility_state)s;
  return jsonb_build_object('checked_at',statement_timestamp(),'healthy',not exists(select 1 from jsonb_array_elements(v_groups)g where not(g->>'healthy')::boolean),'groups',v_groups,'attention',v_attention);
end;$$;

create or replace function public.search_marketplace_admin_activity(p_actor_id uuid default null,p_action text default null,p_target_type text default null,
  p_target_id uuid default null,p_cursor_created_at timestamptz default null,p_cursor_id uuid default null,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_rows jsonb;v_page jsonb;v_more boolean;
begin perform public.marketplace_require_admin();
  if p_limit is null or p_limit<1 or p_limit>100 or(p_action is not null and char_length(p_action)>120)or(p_target_type is not null and char_length(p_target_type)>80)
    or((p_cursor_created_at is null)<>(p_cursor_id is null))then raise exception using errcode='22023',message='marketplace_admin_activity_search_invalid';end if;
  with rows as(select jsonb_build_object('id',a.id,'actor_id',a.actor_id,'actor_username',u.username,'actor_display_name',u.display_name,'action',a.action,'target_type',a.target_type,'target_id',a.target_id,'reason_code',a.reason_code,'metadata',a.metadata,'created_at',a.created_at)j
    from public.marketplace_admin_action_audit a join public.user_profiles u on u.id=a.actor_id where(p_actor_id is null or a.actor_id=p_actor_id)and(p_action is null or a.action=p_action)and(p_target_type is null or a.target_type=p_target_type)and(p_target_id is null or a.target_id=p_target_id)
    and(p_cursor_created_at is null or(a.created_at,a.id)<(p_cursor_created_at,p_cursor_id))order by a.created_at desc,a.id desc limit p_limit+1)
  select coalesce(jsonb_agg(j),'[]')into v_rows from rows;v_more:=jsonb_array_length(v_rows)>p_limit;
  select coalesce(jsonb_agg(value order by ord),'[]')into v_page from jsonb_array_elements(v_rows)with ordinality e(value,ord)where ord<=p_limit;
  return jsonb_build_object('activity',v_page,'page_size',jsonb_array_length(v_page),'next_cursor',case when v_more then jsonb_build_object('created_at',v_page->(p_limit-1)->>'created_at','id',v_page->(p_limit-1)->>'id')else null end);
end;$$;

revoke all on function public.marketplace_admin_health_failure_count(jsonb),public.marketplace_admin_health_group(text,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.marketplace_admin_health_failure_count(jsonb),public.marketplace_admin_health_group(text,jsonb)to service_role;

revoke all on function public.get_marketplace_admin_creator_commerce_overview(text),public.search_marketplace_admin_creators(text,text,timestamptz,uuid,integer),
 public.get_marketplace_admin_creator_detail(uuid,text),public.search_marketplace_admin_promotions(text,text,timestamptz,uuid,integer),
 public.get_marketplace_admin_promotion_detail(uuid),public.search_marketplace_admin_ads(text,text,boolean,timestamptz,uuid,integer),
 public.get_marketplace_admin_ad_detail(uuid),public.get_marketplace_admin_health(),
 public.search_marketplace_admin_activity(uuid,text,text,uuid,timestamptz,uuid,integer)from public,anon,authenticated,service_role;
grant execute on function public.get_marketplace_admin_creator_commerce_overview(text),public.search_marketplace_admin_creators(text,text,timestamptz,uuid,integer),
 public.get_marketplace_admin_creator_detail(uuid,text),public.search_marketplace_admin_promotions(text,text,timestamptz,uuid,integer),
 public.get_marketplace_admin_promotion_detail(uuid),public.search_marketplace_admin_ads(text,text,boolean,timestamptz,uuid,integer),
 public.get_marketplace_admin_ad_detail(uuid),public.get_marketplace_admin_health(),
 public.search_marketplace_admin_activity(uuid,text,text,uuid,timestamptz,uuid,integer)to authenticated,service_role;

-- Internal Ads finance remains internal.
revoke all on function public.spend_marketplace_ad_budget(uuid,numeric,uuid),public.release_marketplace_ad_unused_budget(uuid,uuid),
 public.finalize_marketplace_ad_campaign_delivery(uuid,uuid),public.finalize_expired_marketplace_ad_campaigns(integer)from public,anon,authenticated;
grant execute on function public.spend_marketplace_ad_budget(uuid,numeric,uuid),public.release_marketplace_ad_unused_budget(uuid,uuid),
 public.finalize_marketplace_ad_campaign_delivery(uuid,uuid),public.finalize_expired_marketplace_ad_campaigns(integer)to service_role;

notify pgrst,'reload schema';
commit;
