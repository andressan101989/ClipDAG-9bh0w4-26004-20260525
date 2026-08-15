begin;

-- MKT-B8A is a read-only operational projection over canonical Marketplace
-- facts. It intentionally creates no admin mutation authority.

create index marketplace_orders_admin_created_idx
  on public.marketplace_orders(created_at desc,id desc);
create index marketplace_order_disputes_order_created_idx
  on public.marketplace_order_disputes(order_id,created_at desc);

create or replace function public.marketplace_require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare v_actor uuid:=auth.uid();
begin
  if v_actor is null then
    raise exception using errcode='42501',message='marketplace_admin_auth_required';
  end if;
  if not public.marketplace_actor_is_admin() then
    raise exception using errcode='42501',message='marketplace_admin_forbidden';
  end if;
  return v_actor;
end$$;

create or replace function public.marketplace_admin_range_start(p_range text)
returns timestamptz
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_range='7d' then return now()-interval '7 days'; end if;
  if p_range='30d' then return now()-interval '30 days'; end if;
  if p_range='90d' then return now()-interval '90 days'; end if;
  if p_range='all' then return null; end if;
  raise exception using errcode='22023',message='marketplace_admin_range_invalid';
end$$;

create or replace function public.get_my_marketplace_admin_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare v_actor uuid;v_result jsonb;
begin
  v_actor:=public.marketplace_require_admin();
  select jsonb_build_object(
    'user_id',p.id,
    'username',p.username,
    'display_name',p.display_name,
    'admin',true,
    'capabilities',jsonb_build_array('marketplace:read')
  ) into v_result
  from public.user_profiles p where p.id=v_actor;
  return v_result;
end$$;

create or replace function public.get_marketplace_admin_overview(p_range text default '30d')
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare v_start timestamptz;v_result jsonb;
begin
  perform public.marketplace_require_admin();
  v_start:=public.marketplace_admin_range_start(p_range);

  with
  range_orders as(
    select o.* from public.marketplace_orders o
    where v_start is null or o.created_at>=v_start
  ),
  range_paid as(
    select a.*,p.paid_at,p.status payment_status
    from public.marketplace_payment_allocations a
    join public.marketplace_payments p on p.id=a.payment_id
    where v_start is null or p.paid_at>=v_start
  ),
  paid_items as(
    select i.* from public.marketplace_order_items i
    join range_paid a on a.order_id=i.order_id
  ),
  creator_generated as(
    select count(distinct a.order_id) orders,
      coalesce(sum(a.commission_base_amount),0)::numeric(20,8) gmv,
      coalesce(sum(a.commission_amount),0)::numeric(20,8) amount
    from public.marketplace_order_item_creator_allocations a
    join public.marketplace_payments p on p.id=a.payment_id
    where v_start is null or p.paid_at>=v_start
  ),
  creator_released as(
    select coalesce(sum(l.amount),0)::numeric(20,8) amount
    from public.marketplace_settlement_legs l
    join public.marketplace_order_settlements s on s.id=l.settlement_id
    where l.leg_type='creator_commission'
      and(v_start is null or s.released_at>=v_start)
  ),
  creator_reversed as(
    select coalesce(sum(l.reversal_amount),0)::numeric(20,8) amount
    from public.marketplace_settlement_reversal_legs l
    join public.marketplace_settlement_reversals r on r.id=l.reversal_id
    where l.leg_type='creator_commission'
      and(v_start is null or r.created_at>=v_start)
  )
  select jsonb_build_object(
    'range',p_range,'generated_at',now(),
    'commerce',jsonb_build_object(
      'orders',(select count(*) from range_orders),
      'paid_orders',(select count(*) from range_paid),
      'paid_gmv',(select coalesce(sum(gross_amount),0)::numeric(20,8) from range_paid),
      'units',(select coalesce(sum(quantity),0) from paid_items),
      'pending_fulfillment',(select count(*) from range_orders where status in('confirmed','processing')),
      'shipped',(select count(*) from range_orders where status='shipped'),
      'delivered',(select count(*) from range_orders where status='delivered'),
      'refunded_orders',(select count(*) from range_orders where status in('refunded','partially_refunded')),
      'reversed_orders',(select count(*) from public.marketplace_settlement_reversals r where v_start is null or r.created_at>=v_start),
      'reversed_gross',(select coalesce(sum(r.gross_amount),0)::numeric(20,8) from public.marketplace_settlement_reversals r where v_start is null or r.created_at>=v_start)
    ),
    'sellers',jsonb_build_object(
      'approved',(select count(*) from public.marketplace_sellers where status='approved'),
      'active_stores',(select count(*) from public.marketplace_stores where status='active')
    ),
    'products',jsonb_build_object(
      'active_published',(select count(*) from public.products where status='active' and moderation_status='approved' and published_at is not null and deleted_at is null),
      'requiring_attention',(select count(*) from public.products where deleted_at is null and(moderation_status in('pending','rejected','suspended')or status in('paused','sold_out')))
    ),
    'creator_commerce',jsonb_build_object(
      'attributed_orders',(select orders from creator_generated),
      'attributed_gmv',(select gmv from creator_generated),
      'commission_generated',(select amount from creator_generated),
      'commission_released',(select amount from creator_released),
      'commission_reversed',(select amount from creator_reversed),
      'commission_net',((select amount from creator_released)-(select amount from creator_reversed))::numeric(20,8)
    ),
    'operations',jsonb_build_object(
      'open_disputes',(select count(*) from public.marketplace_order_disputes where status in('open','under_review')),
      'held_allocations',(select count(*) from public.marketplace_payment_allocations where status='held')
    )
  ) into v_result;
  return v_result;
end$$;

create or replace function public.search_marketplace_admin_orders(
  p_query text default null,
  p_status text default null,
  p_range text default '30d',
  p_store_id uuid default null,
  p_source_surface text default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare v_start timestamptz;v_query text:=nullif(btrim(p_query),'');v_rows jsonb;v_next jsonb;v_count integer;v_has_more boolean;
begin
  perform public.marketplace_require_admin();
  v_start:=public.marketplace_admin_range_start(p_range);
  if p_limit is null or p_limit<1 or p_limit>100 then
    raise exception using errcode='22023',message='marketplace_admin_page_limit_invalid';
  end if;
  if(p_cursor_created_at is null)<>(p_cursor_id is null)then
    raise exception using errcode='22023',message='marketplace_admin_cursor_invalid';
  end if;
  if p_status is not null and p_status not in('pending_payment','confirmed','processing','shipped','delivered','cancelled','expired','refunded','partially_refunded')then
    raise exception using errcode='22023',message='marketplace_admin_order_status_invalid';
  end if;
  if p_source_surface is not null and p_source_surface not in('live','direct_creator_link','creator_showcase','feed','reel')then
    raise exception using errcode='22023',message='marketplace_admin_source_surface_invalid';
  end if;

  with filtered as(
    select o.id,o.order_number,o.created_at,o.status,o.currency,o.total,o.buyer_id,o.seller_id,o.store_id,
      coalesce(bp.display_name,bp.username,'Usuario') buyer_name,
      coalesce(s.display_name,sp.display_name,sp.username,'Vendedor') seller_name,
      st.name store_name,
      (select count(*) from public.marketplace_order_items i where i.order_id=o.id) item_count,
      pa.gross_amount,p.status payment_status,
      sh.status fulfillment_status,
      se.status settlement_status,
      exists(select 1 from public.marketplace_order_disputes d where d.order_id=o.id and d.status in('open','under_review')) dispute_open,
      exists(select 1 from public.marketplace_settlement_reversals r where r.order_id=o.id) reversed,
      coalesce((select jsonb_agg(distinct ca.source_surface order by ca.source_surface) from public.marketplace_order_item_creator_attributions ca where ca.order_id=o.id),'[]'::jsonb) creator_sources
    from public.marketplace_orders o
    join public.marketplace_stores st on st.id=o.store_id
    left join public.marketplace_sellers s on s.user_id=o.seller_id
    left join public.user_profiles bp on bp.id=o.buyer_id
    left join public.user_profiles sp on sp.id=o.seller_id
    left join public.marketplace_payment_allocations pa on pa.order_id=o.id
    left join public.marketplace_payments p on p.id=pa.payment_id
    left join public.marketplace_order_shipments sh on sh.order_id=o.id
    left join public.marketplace_order_settlements se on se.order_id=o.id
    where(v_start is null or o.created_at>=v_start)
      and(p_status is null or o.status=p_status)
      and(p_store_id is null or o.store_id=p_store_id)
      and(p_source_surface is null or exists(select 1 from public.marketplace_order_item_creator_attributions ca where ca.order_id=o.id and ca.source_surface=p_source_surface))
      and(p_cursor_created_at is null or(o.created_at,o.id)<(p_cursor_created_at,p_cursor_id))
      and(v_query is null or o.id::text ilike v_query||'%' or o.order_number ilike '%'||v_query||'%'
        or coalesce(bp.username,'')ilike'%'||v_query||'%' or coalesce(bp.display_name,'')ilike'%'||v_query||'%'
        or st.name ilike'%'||v_query||'%' or coalesce(s.display_name,'')ilike'%'||v_query||'%')
    order by o.created_at desc,o.id desc limit p_limit+1
  ), numbered as(select *,row_number()over(order by created_at desc,id desc)rn from filtered)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'order_number',order_number,'created_at',created_at,'status',status,'currency',currency,
    'amount',coalesce(gross_amount,total),'buyer_name',buyer_name,'seller_name',seller_name,'store_id',store_id,'store_name',store_name,
    'item_count',item_count,'payment_status',payment_status,'fulfillment_status',fulfillment_status,'settlement_status',settlement_status,
    'dispute_open',dispute_open,'reversed',reversed,'creator_commerce',jsonb_array_length(creator_sources)>0,'source_surfaces',creator_sources
  )order by rn)filter(where rn<=p_limit),'[]'::jsonb),least(count(*),p_limit),count(*)>p_limit into v_rows,v_count,v_has_more from numbered;

  if v_has_more then
    with filtered as(
      select o.created_at,o.id from public.marketplace_orders o
      join public.marketplace_stores st on st.id=o.store_id
      left join public.marketplace_sellers s on s.user_id=o.seller_id
      left join public.user_profiles bp on bp.id=o.buyer_id
      where(v_start is null or o.created_at>=v_start)and(p_status is null or o.status=p_status)and(p_store_id is null or o.store_id=p_store_id)
        and(p_source_surface is null or exists(select 1 from public.marketplace_order_item_creator_attributions ca where ca.order_id=o.id and ca.source_surface=p_source_surface))
        and(p_cursor_created_at is null or(o.created_at,o.id)<(p_cursor_created_at,p_cursor_id))
        and(v_query is null or o.id::text ilike v_query||'%' or o.order_number ilike'%'||v_query||'%'or coalesce(bp.username,'')ilike'%'||v_query||'%'or coalesce(bp.display_name,'')ilike'%'||v_query||'%'or st.name ilike'%'||v_query||'%'or coalesce(s.display_name,'')ilike'%'||v_query||'%')
      order by o.created_at desc,o.id desc limit p_limit
    )select jsonb_build_object('created_at',created_at,'id',id)into v_next from filtered order by created_at,id limit 1;
  end if;
  return jsonb_build_object('range',p_range,'orders',v_rows,'next_cursor',v_next,'page_size',v_count);
end$$;

create or replace function public.get_marketplace_admin_order_detail(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare v_result jsonb;
begin
  perform public.marketplace_require_admin();
  if p_order_id is null then raise exception using errcode='22023',message='marketplace_admin_order_id_required';end if;

  select jsonb_build_object(
    'order',jsonb_build_object('id',o.id,'order_number',o.order_number,'status',o.status,'currency',o.currency,'subtotal',o.subtotal,'shipping_amount',o.shipping_amount,'total',o.total,'created_at',o.created_at,'confirmed_at',o.confirmed_at,'processing_at',o.processing_at,'shipped_at',o.shipped_at,'delivered_at',o.delivered_at),
    'buyer',jsonb_build_object('id',o.buyer_id,'username',bp.username,'display_name',bp.display_name),
    'seller',jsonb_build_object('id',o.seller_id,'display_name',coalesce(ms.display_name,sp.display_name),'status',ms.status),
    'store',jsonb_build_object('id',st.id,'name',st.name,'slug',st.slug,'status',st.status),
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',i.id,'product_id',i.product_id,'variant_id',i.variant_id,'product_title',i.product_title,'variant_title',i.variant_title,'sku',i.sku,'image_url',i.image_url,'currency',i.currency,'unit_price',i.unit_price,'quantity',i.quantity,'line_total',i.line_total,
      'creator',case when ca.id is null then null else jsonb_build_object('creator_user_id',ca.creator_user_id,'creator_username',cp.username,'creator_display_name',cp.display_name,'source_surface',ca.source_surface,'source_entity_id',ca.source_entity_id,'historical_bps',ca.commission_bps,'item_gmv',coalesce(al.commission_base_amount,i.line_total),'allocation_amount',al.commission_amount,'allocation_id',al.id)end
    )order by i.created_at,i.id)from public.marketplace_order_items i left join public.marketplace_order_item_creator_attributions ca on ca.order_item_id=i.id left join public.marketplace_order_item_creator_allocations al on al.order_item_id=i.id left join public.user_profiles cp on cp.id=ca.creator_user_id where i.order_id=o.id),'[]'::jsonb),
    'payment',(select jsonb_build_object('id',p.id,'status',p.status,'currency',p.currency,'gross_amount',p.gross_amount,'escrow_amount',p.escrow_amount,'fee_bps',p.fee_bps,'paid_at',p.paid_at,'refunded_at',p.refunded_at)from public.marketplace_payments p where p.checkout_id=o.checkout_id),
    'payment_allocation',(select jsonb_build_object('id',a.id,'status',a.status,'gross_amount',a.gross_amount,'platform_fee_amount',a.platform_fee_amount,'seller_net_amount',a.seller_net_amount,'creator_commission_amount',a.creator_commission_amount,'released_at',a.released_at,'refunded_at',a.refunded_at)from public.marketplace_payment_allocations a where a.order_id=o.id),
    'shipping',jsonb_build_object(
      'address',(select jsonb_build_object('recipient_name',a.recipient_name,'line1',a.line1,'line2',a.line2,'city',a.city,'region',a.region,'postal_code',a.postal_code,'country',a.country)from public.marketplace_checkout_shipping_addresses a where a.checkout_id=o.checkout_id),
      'shipment',(select jsonb_build_object('status',s.status,'carrier_name',s.carrier_name,'service_level',s.service_level,'tracking_number',s.tracking_number,'tracking_url',s.tracking_url,'shipped_at',s.shipped_at,'estimated_delivery_at',s.estimated_delivery_at,'delivered_at',s.delivered_at)from public.marketplace_order_shipments s where s.order_id=o.id)
    ),
    'creator_attributions',coalesce((select jsonb_agg(jsonb_build_object('order_item_id',a.order_item_id,'creator_user_id',a.creator_user_id,'source_surface',a.source_surface,'source_entity_id',a.source_entity_id,'product_id',a.product_id,'variant_id',a.variant_id,'historical_bps',a.commission_bps,'attributed_at',a.attributed_at)order by a.order_item_id)from public.marketplace_order_item_creator_attributions a where a.order_id=o.id),'[]'::jsonb),
    'creator_allocations',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'order_item_id',a.order_item_id,'creator_user_id',a.creator_user_id,'commission_bps',a.commission_bps,'item_gmv',a.commission_base_amount,'commission_amount',a.commission_amount,'created_at',a.created_at)order by a.order_item_id)from public.marketplace_order_item_creator_allocations a where a.order_id=o.id),'[]'::jsonb),
    'settlement',(select jsonb_build_object('id',s.id,'status',s.status,'gross_amount',s.gross_amount,'seller_net_amount',s.seller_net_amount,'platform_fee_amount',s.platform_fee_amount,'creator_commission_amount',s.creator_commission_amount,'released_at',s.released_at)from public.marketplace_order_settlements s where s.order_id=o.id),
    'settlement_legs',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'leg_type',l.leg_type,'beneficiary_user_id',l.beneficiary_user_id,'amount',l.amount,'status',l.status,'created_at',l.created_at)order by l.leg_key)from public.marketplace_order_settlements s join public.marketplace_settlement_legs l on l.settlement_id=s.id where s.order_id=o.id),'[]'::jsonb),
    'dispute',(select jsonb_build_object('id',d.id,'status',d.status,'reason_code',d.reason_code,'buyer_note',d.buyer_note,'created_at',d.created_at,'resolved_at',d.resolved_at)from public.marketplace_order_disputes d where d.order_id=o.id order by d.created_at desc limit 1),
    'reversal',(select jsonb_build_object('id',r.id,'gross_amount',r.gross_amount,'currency',r.currency,'reason_code',r.reason_code,'created_at',r.created_at)from public.marketplace_settlement_reversals r where r.order_id=o.id),
    'reversal_legs',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'leg_type',l.leg_type,'beneficiary_user_id',l.beneficiary_user_id,'original_amount',l.original_amount,'reversal_amount',l.reversal_amount,'created_at',l.created_at)order by l.id)from public.marketplace_settlement_reversals r join public.marketplace_settlement_reversal_legs l on l.reversal_id=r.id where r.order_id=o.id),'[]'::jsonb),
    'timeline',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'event_type',e.event_type,'from_status',e.from_status,'to_status',e.to_status,'actor_role',e.actor_role,'reason_code',e.reason_code,'created_at',e.created_at)order by e.created_at,e.id)from public.marketplace_order_events e where e.order_id=o.id),'[]'::jsonb)
  ) into v_result
  from public.marketplace_orders o
  left join public.user_profiles bp on bp.id=o.buyer_id
  left join public.user_profiles sp on sp.id=o.seller_id
  join public.marketplace_sellers ms on ms.user_id=o.seller_id
  join public.marketplace_stores st on st.id=o.store_id
  where o.id=p_order_id;
  if v_result is null then raise exception using errcode='P0002',message='marketplace_admin_order_not_found';end if;
  return v_result;
end$$;

revoke all on function public.marketplace_require_admin() from public,anon,authenticated,service_role;
revoke all on function public.marketplace_admin_range_start(text) from public,anon,authenticated,service_role;
grant execute on function public.marketplace_require_admin() to service_role;
grant execute on function public.marketplace_admin_range_start(text) to service_role;

revoke all on function public.get_my_marketplace_admin_access() from public,anon,authenticated,service_role;
revoke all on function public.get_marketplace_admin_overview(text) from public,anon,authenticated,service_role;
revoke all on function public.search_marketplace_admin_orders(text,text,text,uuid,text,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.get_marketplace_admin_order_detail(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_my_marketplace_admin_access() to authenticated,service_role;
grant execute on function public.get_marketplace_admin_overview(text) to authenticated,service_role;
grant execute on function public.search_marketplace_admin_orders(text,text,text,uuid,text,timestamptz,uuid,integer) to authenticated,service_role;
grant execute on function public.get_marketplace_admin_order_detail(uuid) to authenticated,service_role;

comment on function public.get_marketplace_admin_overview(text) is 'B8A read-only server-derived Marketplace operations overview.';
comment on function public.search_marketplace_admin_orders(text,text,text,uuid,text,timestamptz,uuid,integer) is 'B8A bounded cursor-paginated read-only order search.';
comment on function public.get_marketplace_admin_order_detail(uuid) is 'B8A read-only canonical order, payment, fulfillment, creator, settlement, dispute, and reversal trace.';

commit;
