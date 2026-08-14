begin;

create index marketplace_item_attribution_creator_time_idx
  on public.marketplace_order_item_creator_attributions(creator_user_id,created_at desc,order_id);
create index marketplace_item_creator_creator_time_idx
  on public.marketplace_order_item_creator_allocations(creator_user_id,created_at desc,order_id);
create index marketplace_creator_settlement_leg_time_idx
  on public.marketplace_settlement_legs(beneficiary_user_id,created_at desc,settlement_id)
  where leg_type='creator_commission';
create index marketplace_creator_reversal_leg_time_idx
  on public.marketplace_settlement_reversal_legs(beneficiary_user_id,created_at desc,reversal_id)
  where leg_type='creator_commission';
create index marketplace_commerce_creator_source_event_idx
  on public.marketplace_commerce_events(source_type,source_entity_id,product_id,occurred_at desc)
  where event_name in('product_view','add_to_cart');

create view public.marketplace_creator_commerce_analytics_facts
with(security_invoker=true) as
with creator_releases as(
  select s.order_id,l.beneficiary_user_id creator_user_id,s.released_at,
    round(sum(l.amount),8)::numeric(20,8) released_amount
  from public.marketplace_order_settlements s
  join public.marketplace_settlement_legs l on l.settlement_id=s.id
    and l.leg_type='creator_commission' and l.status='completed'
  where s.status='completed'
  group by s.order_id,l.beneficiary_user_id,s.released_at
),creator_reversals as(
  select r.order_id,l.beneficiary_user_id creator_user_id,r.created_at reversed_at,
    round(sum(l.reversal_amount),8)::numeric(20,8) reversed_amount
  from public.marketplace_settlement_reversals r
  join public.marketplace_settlement_reversal_legs l on l.reversal_id=r.id
    and l.leg_type='creator_commission'
  group by r.order_id,l.beneficiary_user_id,r.created_at
)
select s.creator_user_id,s.source_surface,s.source_entity_id,s.product_id,s.order_id,
  s.order_item_id,i.product_title,i.image_url,i.quantity,a.commission_base_amount attributed_gmv,
  a.commission_amount commission_generated,p.paid_at,
  cr.released_at,case when cr.released_at is null then 0::numeric else a.commission_amount end::numeric(20,8) commission_released,
  rv.reversed_at,case when rv.reversed_at is null then 0::numeric else a.commission_amount end::numeric(20,8) commission_reversed
from public.marketplace_order_item_creator_attributions s
join public.marketplace_order_item_creator_allocations a on a.order_item_id=s.order_item_id
  and a.creator_user_id=s.creator_user_id and a.order_id=s.order_id
join public.marketplace_order_items i on i.id=s.order_item_id
join public.marketplace_payments p on p.id=a.payment_id
left join creator_releases cr on cr.order_id=s.order_id and cr.creator_user_id=s.creator_user_id
left join creator_reversals rv on rv.order_id=s.order_id and rv.creator_user_id=s.creator_user_id;

create view public.marketplace_creator_commerce_event_facts
with(security_invoker=true) as
select e.id,e.event_name,e.occurred_at,e.product_id,'creator_showcase'::text source_surface,
  s.creator_user_id,s.id source_entity_id
from public.marketplace_commerce_events e
join public.marketplace_creator_showcase_items s on e.source_type='creator'
  and s.id=e.source_entity_id and s.product_id=e.product_id
where e.event_name in('product_view','add_to_cart')
union all
select e.id,e.event_name,e.occurred_at,e.product_id,t.content_type,
  t.creator_user_id,t.id
from public.marketplace_commerce_events e
join public.marketplace_creator_content_product_tags t
  on ((e.source_type='feed' and t.content_type='feed')or(e.source_type='clip' and t.content_type='reel'))
  and t.id=e.source_entity_id and t.product_id=e.product_id
where e.event_name in('product_view','add_to_cart')
union all
select e.id,e.event_name,e.occurred_at,e.product_id,'live'::text,
  p.host_id,p.id
from public.marketplace_commerce_events e
join public.live_session_products p on e.source_type='live'
  and p.id=e.source_entity_id and p.product_id=e.product_id
  and p.commerce_mode='affiliate_product'
where e.event_name in('product_view','add_to_cart')
union all
select e.id,e.event_name,e.occurred_at,e.product_id,'direct_creator_link'::text,
  o.creator_id,o.id
from public.marketplace_commerce_events e
join public.marketplace_live_affiliate_offers o on e.source_type='affiliate'
  and o.id=e.source_entity_id and o.product_id=e.product_id
  and o.offer_scope='specific_creator' and o.creator_id is not null
where e.event_name in('product_view','add_to_cart');

revoke all on public.marketplace_creator_commerce_analytics_facts from public,anon,authenticated;
revoke all on public.marketplace_creator_commerce_event_facts from public,anon,authenticated;
grant select on public.marketplace_creator_commerce_analytics_facts to service_role;
grant select on public.marketplace_creator_commerce_event_facts to service_role;

create or replace function public.get_my_marketplace_creator_commerce_analytics(p_range text default '30d')
returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  actor uuid:=auth.uid();
  v_end timestamptz:=clock_timestamp();
  v_start timestamptz;
  v_result jsonb;
begin
  if actor is null then
    raise exception using errcode='42501',message='marketplace_auth_required';
  end if;
  if p_range not in('7d','30d','90d','all') then
    raise exception using errcode='22023',message='marketplace_creator_analytics_range_invalid';
  end if;
  v_start:=case p_range when'7d'then v_end-interval'7 days' when'30d'then v_end-interval'30 days'
    when'90d'then v_end-interval'90 days' else null end;

  with facts as materialized(
    select * from public.marketplace_creator_commerce_analytics_facts where creator_user_id=actor
  ),events as materialized(
    select * from public.marketplace_creator_commerce_event_facts where creator_user_id=actor
  ),sales as materialized(
    select * from facts where(v_start is null or paid_at>=v_start)and paid_at<v_end
  ),releases as materialized(
    select * from facts where commission_released>0 and(v_start is null or released_at>=v_start)and released_at<v_end
  ),reversals as materialized(
    select * from facts where commission_reversed>0 and(v_start is null or reversed_at>=v_start)and reversed_at<v_end
  ),engagement as materialized(
    select * from events where(v_start is null or occurred_at>=v_start)and occurred_at<v_end
  ),summary as(
    select
      (select count(*)::int from engagement where event_name='product_view')product_opens,
      (select count(*)::int from engagement where event_name='add_to_cart')add_to_cart,
      (select count(distinct order_id)::int from sales)attributed_orders,
      coalesce((select sum(quantity)from sales),0)::bigint units_sold,
      coalesce((select round(sum(attributed_gmv),8)from sales),0)::numeric(20,8)attributed_gmv,
      coalesce((select round(sum(commission_generated),8)from sales),0)::numeric(20,8)commission_generated,
      coalesce((select round(sum(commission_released),8)from releases),0)::numeric(20,8)commission_released,
      coalesce((select round(sum(commission_reversed),8)from reversals),0)::numeric(20,8)commission_reversed
  ),surface_keys as(
    select source_surface from sales union select source_surface from releases union select source_surface from reversals union select source_surface from engagement
  ),surface_json as(
    select coalesce(jsonb_agg(jsonb_build_object(
      'source_surface',k.source_surface,
      'product_opens',(select count(*)::int from engagement e where e.source_surface=k.source_surface and e.event_name='product_view'),
      'add_to_cart',(select count(*)::int from engagement e where e.source_surface=k.source_surface and e.event_name='add_to_cart'),
      'orders',(select count(distinct order_id)::int from sales f where f.source_surface=k.source_surface),
      'units_sold',coalesce((select sum(quantity)from sales f where f.source_surface=k.source_surface),0),
      'attributed_gmv',coalesce((select round(sum(attributed_gmv),8)from sales f where f.source_surface=k.source_surface),0),
      'commission_generated',coalesce((select round(sum(commission_generated),8)from sales f where f.source_surface=k.source_surface),0),
      'commission_released',coalesce((select round(sum(commission_released),8)from releases f where f.source_surface=k.source_surface),0),
      'commission_reversed',coalesce((select round(sum(commission_reversed),8)from reversals f where f.source_surface=k.source_surface),0),
      'commission_net',coalesce((select round(sum(commission_released),8)from releases f where f.source_surface=k.source_surface),0)
        -coalesce((select round(sum(commission_reversed),8)from reversals f where f.source_surface=k.source_surface),0)
    )order by coalesce((select sum(attributed_gmv)from sales f where f.source_surface=k.source_surface),0)desc,k.source_surface),'[]'::jsonb)value
    from surface_keys k
  ),product_keys as(
    select product_id from sales union select product_id from releases union select product_id from reversals union select product_id from engagement
  ),product_ranked as(
    select k.product_id,
      coalesce(max(p.title),(select max(product_title)from facts f where f.product_id=k.product_id),'Producto')title,
      coalesce(case when max(p.images[1])~'^https://'then max(p.images[1])end,(select max(image_url)from facts f where f.product_id=k.product_id))image_url,
      (select count(*)::int from engagement e where e.product_id=k.product_id and e.event_name='product_view')product_opens,
      (select count(*)::int from engagement e where e.product_id=k.product_id and e.event_name='add_to_cart')add_to_cart,
      (select count(distinct order_id)::int from sales f where f.product_id=k.product_id)orders,
      coalesce((select sum(quantity)from sales f where f.product_id=k.product_id),0)::bigint units_sold,
      coalesce((select round(sum(attributed_gmv),8)from sales f where f.product_id=k.product_id),0)::numeric(20,8)attributed_gmv,
      coalesce((select round(sum(commission_generated),8)from sales f where f.product_id=k.product_id),0)::numeric(20,8)commission_generated,
      coalesce((select round(sum(commission_released),8)from releases f where f.product_id=k.product_id),0)::numeric(20,8)commission_released,
      coalesce((select round(sum(commission_reversed),8)from reversals f where f.product_id=k.product_id),0)::numeric(20,8)commission_reversed
    from product_keys k left join public.products p on p.id=k.product_id group by k.product_id
  ),product_json as(
    select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('commission_net',x.commission_released-x.commission_reversed)
      order by x.attributed_gmv desc,x.units_sold desc,x.product_opens desc,x.product_id)filter(where x.rn<=10),'[]'::jsonb)value
    from(select p.*,row_number()over(order by attributed_gmv desc,units_sold desc,product_opens desc,product_id)rn from product_ranked p)x
  ),trend_source as(
    select paid_at event_at,attributed_gmv,commission_generated,0::numeric commission_released,0::numeric commission_reversed,order_id from sales
    union all select released_at,0,0,commission_released,0,null::uuid from releases
    union all select reversed_at,0,0,0,commission_reversed,null::uuid from reversals
  ),trend_json as(
    select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket,'orders',orders,'attributed_gmv',attributed_gmv,
      'commission_generated',commission_generated,'commission_released',commission_released,
      'commission_reversed',commission_reversed,'commission_net',commission_released-commission_reversed)order by bucket),'[]'::jsonb)value
    from(select case when p_range='all'then to_char(date_trunc('month',event_at at time zone'UTC'),'YYYY-MM')
        else to_char((event_at at time zone'UTC')::date,'YYYY-MM-DD')end bucket,
      count(distinct order_id)::int orders,round(sum(attributed_gmv),8)::numeric(20,8)attributed_gmv,
      round(sum(commission_generated),8)::numeric(20,8)commission_generated,
      round(sum(commission_released),8)::numeric(20,8)commission_released,
      round(sum(commission_reversed),8)::numeric(20,8)commission_reversed
      from trend_source group by 1)x
  )
  select jsonb_build_object('range',p_range,'generated_at',v_end,'timezone','UTC','summary',jsonb_build_object(
    'product_opens',s.product_opens,'add_to_cart',s.add_to_cart,'attributed_orders',s.attributed_orders,
    'units_sold',s.units_sold,'attributed_gmv',s.attributed_gmv,'commission_generated',s.commission_generated,
    'commission_released',s.commission_released,'commission_reversed',s.commission_reversed,
    'commission_net',s.commission_released-s.commission_reversed),
    'surface_breakdown',sf.value,'top_products',pr.value,'trend',tr.value)into v_result
  from summary s cross join surface_json sf cross join product_json pr cross join trend_json tr;
  return v_result;
end$$;

create or replace function public.reconcile_marketplace_creator_commerce_analytics()
returns jsonb language sql stable security definer set search_path=public as $$
with activation as(select activated_at from public.marketplace_creator_commerce_authority_state where singleton),
allocation_totals as(
 select order_id,creator_user_id,round(sum(commission_amount),8)amount from public.marketplace_order_item_creator_allocations group by order_id,creator_user_id
),leg_totals as(
 select s.order_id,l.beneficiary_user_id creator_user_id,round(sum(l.amount),8)amount
 from public.marketplace_order_settlements s join public.marketplace_settlement_legs l on l.settlement_id=s.id and l.leg_type='creator_commission'
 group by s.order_id,l.beneficiary_user_id
),reversal_totals as(
 select r.order_id,l.beneficiary_user_id creator_user_id,round(sum(l.reversal_amount),8)amount
 from public.marketplace_settlement_reversals r join public.marketplace_settlement_reversal_legs l on l.reversal_id=r.id and l.leg_type='creator_commission'
 group by r.order_id,l.beneficiary_user_id
)
select jsonb_build_object(
 'creator_item_attribution_without_allocation',(select count(*)from public.marketplace_order_item_creator_attributions s cross join activation x where s.created_at>=x.activated_at and exists(select 1 from public.marketplace_payments p where p.checkout_id=s.checkout_id)and not exists(select 1 from public.marketplace_order_item_creator_allocations a where a.order_item_id=s.order_item_id)),
 'creator_allocation_without_item_attribution',(select count(*)from public.marketplace_order_item_creator_allocations a cross join activation x where a.created_at>=x.activated_at and not exists(select 1 from public.marketplace_order_item_creator_attributions s where s.order_item_id=a.order_item_id)),
 'creator_allocation_creator_mismatch',(select count(*)from public.marketplace_order_item_creator_allocations a join public.marketplace_order_item_creator_attributions s on s.order_item_id=a.order_item_id where a.creator_user_id<>s.creator_user_id),
 'creator_allocation_product_mismatch',(select count(*)from public.marketplace_order_item_creator_allocations a join public.marketplace_order_item_creator_attributions s on s.order_item_id=a.order_item_id join public.marketplace_order_items i on i.id=a.order_item_id where s.product_id<>i.product_id),
 'creator_generated_commission_mismatch',(select count(*)from allocation_totals a join public.marketplace_payment_allocations p on p.order_id=a.order_id where a.amount>p.creator_commission_amount),
 'creator_settlement_leg_without_creator_allocation',(select count(*)from leg_totals l left join allocation_totals a using(order_id,creator_user_id)where a.order_id is null),
 'creator_settlement_beneficiary_mismatch',(select count(*)from leg_totals l join allocation_totals a using(order_id,creator_user_id)where l.amount<>a.amount),
 'creator_reversal_leg_without_settlement_leg',(select count(*)from public.marketplace_settlement_reversal_legs r left join public.marketplace_settlement_legs l on l.id=r.original_settlement_leg_id where r.leg_type='creator_commission'and l.id is null),
 'creator_reversal_beneficiary_mismatch',(select count(*)from public.marketplace_settlement_reversal_legs r join public.marketplace_settlement_legs l on l.id=r.original_settlement_leg_id where r.leg_type='creator_commission'and(r.beneficiary_user_id,r.reversal_amount)is distinct from(l.beneficiary_user_id,l.amount)),
 'creator_net_commission_negative_unexplained',(select count(*)from reversal_totals r left join leg_totals l using(order_id,creator_user_id)where r.amount>coalesce(l.amount,0)),
 'creator_surface_invalid',(select count(*)from public.marketplace_order_item_creator_attributions where source_surface not in('live','direct_creator_link','creator_showcase','feed','reel')),
 'creator_source_entity_missing_currently_required_identity',(select count(*)from public.marketplace_order_item_creator_attributions s where(s.source_surface='creator_showcase'and not exists(select 1 from public.marketplace_creator_showcase_items x where x.id=s.source_entity_id))or(s.source_surface in('feed','reel')and not exists(select 1 from public.marketplace_creator_content_product_tags x where x.id=s.source_entity_id))or(s.source_surface='live'and not exists(select 1 from public.live_session_products x where x.id=s.source_entity_id))or(s.source_surface='direct_creator_link'and not exists(select 1 from public.marketplace_live_affiliate_offers x where x.id=s.source_entity_id))),
 'creator_item_gmv_basis_mismatch',(select count(*)from public.marketplace_order_item_creator_allocations a join public.marketplace_order_items i on i.id=a.order_item_id where a.commission_base_amount<>i.line_total),
 'creator_order_count_orphan',(select count(*)from public.marketplace_order_item_creator_attributions s left join public.marketplace_orders o on o.id=s.order_id where o.id is null),
 'creator_analytics_event_source_unresolvable',(select count(*)from public.marketplace_commerce_events e where e.event_name in('product_view','add_to_cart')and((e.source_type='feed'and not exists(select 1 from public.marketplace_creator_content_product_tags t where t.id=e.source_entity_id and t.content_type='feed'))or(e.source_type='clip'and not exists(select 1 from public.marketplace_creator_content_product_tags t where t.id=e.source_entity_id and t.content_type='reel')))),
 'creator_event_product_mismatch',(select count(*)from public.marketplace_commerce_events e where e.event_name in('product_view','add_to_cart')and((e.source_type='creator'and exists(select 1 from public.marketplace_creator_showcase_items s where s.id=e.source_entity_id and s.product_id<>e.product_id))or(e.source_type in('feed','clip')and exists(select 1 from public.marketplace_creator_content_product_tags t where t.id=e.source_entity_id and t.product_id<>e.product_id))or(e.source_type='live'and exists(select 1 from public.live_session_products p where p.id=e.source_entity_id and p.product_id<>e.product_id)))),
 'creator_settlement_total_mismatch',(select count(*)from allocation_totals a join leg_totals l using(order_id,creator_user_id)where a.amount<>l.amount),
 'creator_reversal_total_mismatch',(select count(*)from reversal_totals r join leg_totals l using(order_id,creator_user_id)where r.amount<>l.amount)
)$$;

revoke all on function public.get_my_marketplace_creator_commerce_analytics(text) from public,anon;
grant execute on function public.get_my_marketplace_creator_commerce_analytics(text) to authenticated,service_role;
revoke all on function public.reconcile_marketplace_creator_commerce_analytics() from public,anon,authenticated;
grant execute on function public.reconcile_marketplace_creator_commerce_analytics() to service_role;

comment on view public.marketplace_creator_commerce_analytics_facts is
  'Read-only B7D projection of immutable B7A/B7F item economics and actual B7F/B7R money movement; it is not financial authority.';
comment on view public.marketplace_creator_commerce_event_facts is
  'Read-only B7D mapping of B3 events to canonical creator source entities. Client-supplied creator IDs are intentionally ignored.';
comment on function public.get_my_marketplace_creator_commerce_analytics(text) is
  'Private self-only creator commerce analytics. UTC windows are server-derived; amounts come from canonical allocation, settlement, and reversal facts.';

commit;
