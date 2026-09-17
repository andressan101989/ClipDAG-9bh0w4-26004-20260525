create or replace function public.search_my_business_products(
  p_business_owner_id uuid,
  p_status text default null,
  p_query text default null,
  p_cursor_updated_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare v_limit integer:=least(greatest(coalesce(p_limit,30),1),60);v_rows jsonb;v_more boolean;v_cursor jsonb;
begin
  if not(private.business_actor_has_capability(p_business_owner_id,'business.catalog.read')
    or private.business_actor_has_capability(p_business_owner_id,'business.catalog.manage')) then
    raise exception using errcode='42501',message='business_catalog_read_required';
  end if;
  if p_status is not null and p_status not in('draft','active','paused','deleted') then
    raise exception using errcode='22023',message='business_product_filter_invalid';
  end if;
  with candidates as(
    select p.*,
      (select a.public_url from public.media_asset_links l join public.media_assets a on a.id=l.asset_id
       where l.entity_type='shop_product' and l.entity_id=p.id and l.slot='image' and a.status='ready'
       order by l.is_cover desc,l.position,l.id limit 1) thumbnail_url,
      (select pg_catalog.count(*) from public.marketplace_product_variants v where v.product_id=p.id and v.status<>'archived') variant_count,
      case when private.business_actor_has_capability(p_business_owner_id,'business.inventory.read')
             or private.business_actor_has_capability(p_business_owner_id,'business.inventory.manage')
        then (select coalesce(pg_catalog.sum(greatest(i.on_hand-i.reserved,0)),0)
          from public.marketplace_product_variants v join public.marketplace_inventory_levels i on i.variant_id=v.id
          where v.product_id=p.id and v.status<>'archived') else null end available_stock,
      public.marketplace_product_publication_reason(p.id,p_business_owner_id) readiness_reason
    from public.products p where p.seller_id=p_business_owner_id
      and (p_status is null or p.status=p_status)
      and (p_query is null or p.title ilike '%'||pg_catalog.replace(p_query,'%','\%')||'%'
        or exists(select 1 from public.marketplace_product_variants v where v.product_id=p.id and v.sku ilike '%'||pg_catalog.replace(p_query,'%','\%')||'%'))
      and (p_cursor_updated_at is null or (p.updated_at,p.id)<(p_cursor_updated_at,p_cursor_id))
    order by p.updated_at desc,p.id desc limit v_limit+1
  ), numbered as(select *,pg_catalog.row_number() over(order by updated_at desc,id desc) rn from candidates)
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',id,'title',title,'status',status,'price',price,'currency',currency,'variant_count',variant_count,
    'readiness_reason',readiness_reason,'updated_at',updated_at,'thumbnail_url',thumbnail_url,'available_stock',available_stock
  ) order by updated_at desc,id desc) filter(where rn<=v_limit),'[]'::jsonb),
  pg_catalog.count(*)>v_limit,
  (select pg_catalog.jsonb_build_object('updated_at',updated_at,'id',id) from numbered where rn=v_limit)
  into v_rows,v_more,v_cursor from numbered;
  return pg_catalog.jsonb_build_object(
    'items',v_rows,
    'categories',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',c.id,'name',c.name,'slug',c.slug) order by c.name)
      from public.marketplace_categories c where c.status='active'),'[]'::jsonb),
    'next_cursor',case when v_more then v_cursor else null end
  );
end;
$function$;

create or replace function public.search_my_business_shipping_profiles(
  p_business_owner_id uuid,p_cursor_created_at timestamptz default null,p_cursor_id uuid default null,p_limit integer default 30
)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare v_limit integer:=least(greatest(coalesce(p_limit,30),1),60);v_rows jsonb;v_more boolean;v_cursor jsonb;
begin
  if not(private.business_actor_has_capability(p_business_owner_id,'business.catalog.read')
    or private.business_actor_has_capability(p_business_owner_id,'business.catalog.manage')) then
    raise exception using errcode='42501',message='business_catalog_read_required';end if;
  with candidates as(select sp.* from public.marketplace_shipping_profiles sp where sp.seller_id=p_business_owner_id
    and(p_cursor_created_at is null or(sp.created_at,sp.id)<(p_cursor_created_at,p_cursor_id)) order by sp.created_at desc,sp.id desc limit v_limit+1),
  numbered as(select *,pg_catalog.row_number()over(order by created_at desc,id desc)rn from candidates)
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',id,'store_id',store_id,'name',name,'status',status,
    'processing_days_min',processing_days_min,'processing_days_max',processing_days_max,'ships_from_country',ships_from_country,
    'return_policy_summary',return_policy_summary,'configuration_status',configuration_status,'created_at',created_at,
    'regions',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',r.id,'country_code',r.country_code,
      'region_code',r.region_code,'shipping_price',r.shipping_price,'free_shipping_threshold',r.free_shipping_threshold,
      'transit_days_min',r.transit_days_min,'transit_days_max',r.transit_days_max,'status',r.status)order by r.country_code,r.region_code)
      from public.marketplace_shipping_profile_regions r where r.profile_id=numbered.id and r.archived_at is null),'[]'::jsonb))
    order by created_at desc,id desc)filter(where rn<=v_limit),'[]'::jsonb),
  pg_catalog.count(*)>v_limit,
  (select pg_catalog.jsonb_build_object('created_at',created_at,'id',id) from numbered where rn=v_limit)
  into v_rows,v_more,v_cursor from numbered;
  return pg_catalog.jsonb_build_object('items',v_rows,'next_cursor',case when v_more then v_cursor else null end);
end;$function$;

create or replace function public.search_my_business_orders(
  p_business_owner_id uuid,p_status text default null,p_cursor_created_at timestamptz default null,p_cursor_id uuid default null,p_limit integer default 30
)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare v_limit integer:=least(greatest(coalesce(p_limit,30),1),60);v_rows jsonb;v_more boolean;v_cursor jsonb;
begin
  if not(private.business_actor_has_capability(p_business_owner_id,'business.orders.read')
    or private.business_actor_has_capability(p_business_owner_id,'business.orders.fulfill'))then
    raise exception using errcode='42501',message='business_orders_read_required';end if;
  with candidates as(select o.* from public.marketplace_orders o where o.seller_id=p_business_owner_id
    and(p_status is null or o.status=p_status)and(p_cursor_created_at is null or(o.created_at,o.id)<(p_cursor_created_at,p_cursor_id))
    order by o.created_at desc,o.id desc limit v_limit+1),numbered as(select *,pg_catalog.row_number()over(order by created_at desc,id desc)rn from candidates)
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',id,'order_number',order_number,'status',status,
    'currency',currency,'subtotal',subtotal,'shipping_amount',shipping_amount,'total',total,'created_at',created_at,
    'processing_at',processing_at,'shipped_at',shipped_at,'delivered_at',delivered_at,
    'items',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('title',i.product_title,'variant',i.variant_title,
      'sku',i.sku,'quantity',i.quantity,'line_total',i.line_total,'image_url',i.image_url)order by i.id)from public.marketplace_order_items i where i.order_id=numbered.id),'[]'::jsonb),
    'shipment',(select pg_catalog.jsonb_build_object('status',s.status,'carrier_name',s.carrier_name,'service_level',s.service_level,
      'tracking_number',s.tracking_number,'tracking_url',s.tracking_url)from public.marketplace_order_shipments s where s.order_id=numbered.id order by s.created_at desc limit 1))
    order by created_at desc,id desc)filter(where rn<=v_limit),'[]'::jsonb),
  pg_catalog.count(*)>v_limit,
  (select pg_catalog.jsonb_build_object('created_at',created_at,'id',id) from numbered where rn=v_limit)
  into v_rows,v_more,v_cursor from numbered;
  return pg_catalog.jsonb_build_object('items',v_rows,'next_cursor',case when v_more then v_cursor else null end);
end;$function$;

create or replace function public.search_my_business_returns(
  p_business_owner_id uuid,p_cursor_created_at timestamptz default null,p_cursor_id uuid default null,p_limit integer default 30
)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare v_limit integer:=least(greatest(coalesce(p_limit,30),1),60);v_rows jsonb;v_more boolean;v_cursor jsonb;
begin
  if not(private.business_actor_has_capability(p_business_owner_id,'business.returns.read')
    or private.business_actor_has_capability(p_business_owner_id,'business.returns.manage'))then
    raise exception using errcode='42501',message='business_returns_read_required';end if;
  with candidates as(select r.* from public.marketplace_return_requests r where r.seller_id=p_business_owner_id
    and(p_cursor_created_at is null or(r.created_at,r.id)<(p_cursor_created_at,p_cursor_id))order by r.created_at desc,r.id desc limit v_limit+1),
  numbered as(select *,pg_catalog.row_number()over(order by created_at desc,id desc)rn from candidates)
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',id,'order_id',order_id,
    'order_number',(select o.order_number from public.marketplace_orders o where o.id=numbered.order_id),'status',status,
    'buyer_note',buyer_note,'seller_note',seller_note,'created_at',created_at,'decided_at',decided_at,
    'shipment',(select pg_catalog.jsonb_build_object('id',s.id,'status',s.status,'return_label_asset_id',s.return_label_asset_id,
      'label_sent_at',s.label_sent_at,'tracking_number',s.tracking_number,'received_at',s.received_at)
      from public.marketplace_return_shipments s where s.return_request_id=numbered.id),
    'refund_status',(select rf.status from public.marketplace_return_refunds rf where rf.return_request_id=numbered.id limit 1))
    order by created_at desc,id desc)filter(where rn<=v_limit),'[]'::jsonb),
  pg_catalog.count(*)>v_limit,
  (select pg_catalog.jsonb_build_object('created_at',created_at,'id',id) from numbered where rn=v_limit)
  into v_rows,v_more,v_cursor from numbered;
  return pg_catalog.jsonb_build_object('items',v_rows,'next_cursor',case when v_more then v_cursor else null end);
end;$function$;

create or replace function public.search_my_business_disputes(
  p_business_owner_id uuid,p_cursor_created_at timestamptz default null,p_cursor_id uuid default null,p_limit integer default 30
)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare v_limit integer:=least(greatest(coalesce(p_limit,30),1),60);v_rows jsonb;v_more boolean;v_cursor jsonb;
begin
  if not(private.business_actor_has_capability(p_business_owner_id,'business.disputes.read')
    or private.business_actor_has_capability(p_business_owner_id,'business.disputes.respond'))then
    raise exception using errcode='42501',message='business_disputes_read_required';end if;
  with candidates as(select d.* from public.marketplace_order_disputes d where d.seller_id=p_business_owner_id
    and(p_cursor_created_at is null or(d.created_at,d.id)<(p_cursor_created_at,p_cursor_id))order by d.created_at desc,d.id desc limit v_limit+1),
  numbered as(select *,pg_catalog.row_number()over(order by created_at desc,id desc)rn from candidates)
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',id,'order_id',order_id,
    'order_number',(select o.order_number from public.marketplace_orders o where o.id=numbered.order_id),'status',status,
    'reason_code',reason_code,'buyer_note',buyer_note,'created_at',created_at,'resolved_at',resolved_at,
    'seller_response',(select pg_catalog.jsonb_build_object('note',r.note,'created_at',r.created_at,
      'evidence_asset_ids',coalesce((select pg_catalog.jsonb_agg(l.asset_id order by l.position)from public.media_asset_links l
        where l.entity_type='marketplace_dispute'and l.entity_id=numbered.id and l.slot='seller_evidence'),'[]'::jsonb))
      from public.marketplace_dispute_seller_responses r where r.dispute_id=numbered.id))
    order by created_at desc,id desc)filter(where rn<=v_limit),'[]'::jsonb),
  pg_catalog.count(*)>v_limit,
  (select pg_catalog.jsonb_build_object('created_at',created_at,'id',id) from numbered where rn=v_limit)
  into v_rows,v_more,v_cursor from numbered;
  return pg_catalog.jsonb_build_object('items',v_rows,'next_cursor',case when v_more then v_cursor else null end);
end;$function$;
