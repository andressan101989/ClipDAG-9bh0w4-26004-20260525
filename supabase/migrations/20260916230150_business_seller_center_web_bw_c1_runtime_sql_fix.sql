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
declare v_limit integer:=least(greatest(coalesce(p_limit,30),1),60);v_rows jsonb;v_more boolean;
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
  ) order by updated_at desc,id desc) filter(where rn<=v_limit),'[]'::jsonb),pg_catalog.count(*)>v_limit into v_rows,v_more from numbered;
  return pg_catalog.jsonb_build_object('items',v_rows,'categories',coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',c.id,'name',c.name,'slug',c.slug) order by c.name)
    from public.marketplace_categories c where c.status='active'),'[]'::jsonb),'next_cursor',case when v_more then(
    select pg_catalog.jsonb_build_object('updated_at',updated_at,'id',id) from candidates order by updated_at desc,id desc offset v_limit-1 limit 1
  )else null end);
end;
$function$;

create or replace function public.get_my_business_product(p_business_owner_id uuid,p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare p public.products;v_inventory boolean;v_result jsonb;
begin
  if not(private.business_actor_has_capability(p_business_owner_id,'business.catalog.read')
    or private.business_actor_has_capability(p_business_owner_id,'business.catalog.manage')) then
    raise exception using errcode='42501',message='business_catalog_read_required';
  end if;
  select * into p from public.products where id=p_product_id and seller_id=p_business_owner_id;
  if not found then raise exception using errcode='P0002',message='business_product_not_found';end if;
  v_inventory:=private.business_actor_has_capability(p_business_owner_id,'business.inventory.read')
    or private.business_actor_has_capability(p_business_owner_id,'business.inventory.manage');
  select pg_catalog.jsonb_build_object(
    'product',pg_catalog.jsonb_build_object('id',p.id,'store_id',p.store_id,'category_id',p.category_id,'title',p.title,
      'description',p.description,'price',p.price,'currency',p.currency,'brand',p.brand,'compare_at_price',p.compare_at_price,
      'stock',p.stock,'status',p.status,'tags',p.tags,'product_type',p.product_type,'shipping_profile_id',p.shipping_profile_id,
      'editor_state',p.editor_state,'updated_at',p.updated_at,'readiness_reason',public.marketplace_product_publication_reason(p.id,p_business_owner_id)),
    'media',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('asset_id',l.asset_id,'slot',l.slot,
      'position',l.position,'is_cover',l.is_cover,'url',a.public_url,'media_kind',a.media_kind,'purpose',a.purpose)
      order by l.slot,l.position) from public.media_asset_links l join public.media_assets a on a.id=l.asset_id
      where l.entity_type='shop_product' and l.entity_id=p.id),'[]'::jsonb),
    'options',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',o.id,'name',o.name,'position',o.position,
      'values',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',ov.id,'value',ov.value,'position',ov.position) order by ov.position)
       from public.marketplace_product_option_values ov where ov.option_id=o.id),'[]'::jsonb)) order by o.position)
      from public.marketplace_product_options o where o.product_id=p.id),'[]'::jsonb),
    'variants',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',v.id,'sku',v.sku,'title',v.title,
      'price',v.price,'compare_at_price',v.compare_at_price,'status',v.status,'is_default',v.is_default,'image_asset_id',v.image_asset_id,
      'barcode',v.barcode,'on_hand',case when v_inventory then i.on_hand else null end,'reserved',case when v_inventory then i.reserved else null end,
      'available',case when v_inventory then i.on_hand-i.reserved else null end,'low_stock_threshold',case when v_inventory then i.low_stock_threshold else null end)
      order by v.is_default desc,v.created_at,v.id) from public.marketplace_product_variants v
      left join public.marketplace_inventory_levels i on i.variant_id=v.id where v.product_id=p.id),'[]'::jsonb),
    'categories',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',c.id,'name',c.name,'slug',c.slug) order by c.name)
      from public.marketplace_categories c where c.status='active'),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;

create or replace function public.search_my_business_shipping_profiles(
  p_business_owner_id uuid,p_cursor_created_at timestamptz default null,p_cursor_id uuid default null,p_limit integer default 30
)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare v_limit integer:=least(greatest(coalesce(p_limit,30),1),60);v_rows jsonb;v_more boolean;
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
    order by created_at desc,id desc)filter(where rn<=v_limit),'[]'::jsonb),pg_catalog.count(*)>v_limit into v_rows,v_more from numbered;
  return pg_catalog.jsonb_build_object('items',v_rows,'next_cursor',case when v_more then(select pg_catalog.jsonb_build_object('created_at',created_at,'id',id)from candidates order by created_at desc,id desc offset v_limit-1 limit 1)else null end);
end;$function$;

create or replace function public.search_my_business_orders(
  p_business_owner_id uuid,p_status text default null,p_cursor_created_at timestamptz default null,p_cursor_id uuid default null,p_limit integer default 30
)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare v_limit integer:=least(greatest(coalesce(p_limit,30),1),60);v_rows jsonb;v_more boolean;
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
    order by created_at desc,id desc)filter(where rn<=v_limit),'[]'::jsonb),pg_catalog.count(*)>v_limit into v_rows,v_more from numbered;
  return pg_catalog.jsonb_build_object('items',v_rows,'next_cursor',case when v_more then(select pg_catalog.jsonb_build_object('created_at',created_at,'id',id)from candidates order by created_at desc,id desc offset v_limit-1 limit 1)else null end);
end;$function$;

create or replace function public.get_my_business_order(p_business_owner_id uuid,p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare o public.marketplace_orders;v_fulfill boolean;
begin
  if not(private.business_actor_has_capability(p_business_owner_id,'business.orders.read')
    or private.business_actor_has_capability(p_business_owner_id,'business.orders.fulfill'))then
    raise exception using errcode='42501',message='business_orders_read_required';end if;
  select * into o from public.marketplace_orders where id=p_order_id and seller_id=p_business_owner_id;
  if not found then raise exception using errcode='P0002',message='business_order_not_found';end if;
  v_fulfill:=private.business_actor_has_capability(p_business_owner_id,'business.orders.fulfill');
  return pg_catalog.jsonb_build_object('id',o.id,'order_number',o.order_number,'status',o.status,'currency',o.currency,
    'subtotal',o.subtotal,'shipping_amount',o.shipping_amount,'total',o.total,'created_at',o.created_at,
    'items',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i)-'buyer_id'-'seller_id'-'checkout_id')from public.marketplace_order_items i where i.order_id=o.id),'[]'::jsonb),
    'shipment',(select pg_catalog.to_jsonb(s)-'buyer_id'-'seller_id'-'checkout_id' from public.marketplace_order_shipments s where s.order_id=o.id order by s.created_at desc limit 1),
    'shipping_address',case when v_fulfill then(select pg_catalog.jsonb_build_object('recipient_name',a.recipient_name,'line1',a.line1,'line2',a.line2,
      'city',a.city,'region',a.region,'postal_code',a.postal_code,'country',a.country,'phone',a.phone)
      from public.marketplace_checkout_shipping_addresses a where a.checkout_id=o.checkout_id)else null end);
end;$function$;

create or replace function public.search_my_business_returns(
  p_business_owner_id uuid,p_cursor_created_at timestamptz default null,p_cursor_id uuid default null,p_limit integer default 30
)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare v_limit integer:=least(greatest(coalesce(p_limit,30),1),60);v_rows jsonb;v_more boolean;
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
    order by created_at desc,id desc)filter(where rn<=v_limit),'[]'::jsonb),pg_catalog.count(*)>v_limit into v_rows,v_more from numbered;
  return pg_catalog.jsonb_build_object('items',v_rows,'next_cursor',case when v_more then(select pg_catalog.jsonb_build_object('created_at',created_at,'id',id)from candidates order by created_at desc,id desc offset v_limit-1 limit 1)else null end);
end;$function$;

create or replace function public.search_my_business_disputes(
  p_business_owner_id uuid,p_cursor_created_at timestamptz default null,p_cursor_id uuid default null,p_limit integer default 30
)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare v_limit integer:=least(greatest(coalesce(p_limit,30),1),60);v_rows jsonb;v_more boolean;
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
    order by created_at desc,id desc)filter(where rn<=v_limit),'[]'::jsonb),pg_catalog.count(*)>v_limit into v_rows,v_more from numbered;
  return pg_catalog.jsonb_build_object('items',v_rows,'next_cursor',case when v_more then(select pg_catalog.jsonb_build_object('created_at',created_at,'id',id)from candidates order by created_at desc,id desc offset v_limit-1 limit 1)else null end);
end;$function$;

create or replace function public.set_my_marketplace_product_media_v2(
  p_product_id uuid,p_image_asset_ids uuid[],p_cover_asset_id uuid,p_video_asset_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor uuid:=auth.uid();
  owner_id uuid;
  image_count int:=coalesce(pg_catalog.array_length(p_image_asset_ids,1),0);
  urls text[]:='{}';
  old_ids uuid[];
begin
  if actor is null then raise exception using errcode='42501',message='marketplace_authentication_required';end if;
  select p.seller_id into owner_id from public.products p where p.id=p_product_id and p.deleted_at is null for update;
  if owner_id is null then raise exception using errcode='42501',message='marketplace_product_not_editable';end if;
  perform private.business_require_capability(owner_id,'business.catalog.manage');
  if not(private.business_actor_has_capability(owner_id,'business.media.read')
    or private.business_actor_has_capability(owner_id,'business.media.manage')) then
    raise exception using errcode='42501',message='business_media_capability_required';
  end if;
  if image_count>5 or(select pg_catalog.count(distinct x) from pg_catalog.unnest(coalesce(p_image_asset_ids,'{}')) x)<>image_count then
    raise exception using errcode='22023',message='marketplace_product_image_limit';
  end if;
  if(image_count=0 and p_cover_asset_id is not null)or(image_count>0 and not(p_cover_asset_id=any(p_image_asset_ids)))then
    raise exception using errcode='22023',message='marketplace_product_cover_invalid';
  end if;
  perform id from public.media_assets where id=any(coalesce(p_image_asset_ids,'{}'))or id=p_video_asset_id order by id for update;
  if image_count>0 then
    select pg_catalog.array_agg(a.public_url order by ids.ordinality) into urls
    from pg_catalog.unnest(p_image_asset_ids) with ordinality ids(id,ordinality)
    join public.media_assets a on a.id=ids.id
    where a.owner_id=owner_id and a.status='ready' and a.visibility='public'
      and a.media_kind='image' and a.purpose in('product_image','business_library') and a.public_url is not null;
    if coalesce(pg_catalog.array_length(urls,1),0)<>image_count then
      raise exception using errcode='42501',message='marketplace_product_media_not_ready';
    end if;
  end if;
  if p_video_asset_id is not null and not exists(
    select 1 from public.media_assets a where a.id=p_video_asset_id and a.owner_id=owner_id
      and a.status='ready' and a.visibility='public' and a.media_kind='video' and a.purpose='product_video'
      and a.mime_type in('video/mp4','video/quicktime') and a.duration_ms between 1 and 60000 and a.public_url is not null
  )then raise exception using errcode='22023',message='marketplace_product_video_invalid';end if;
  select coalesce(pg_catalog.array_agg(asset_id),'{}') into old_ids from public.media_asset_links
    where entity_type='shop_product' and entity_id=p_product_id and slot in('image','video');
  delete from public.media_asset_links where entity_type='shop_product' and entity_id=p_product_id and slot in('image','video');
  insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position,is_cover)
    select p_image_asset_ids[i],'shop_product',p_product_id,'image',i-1,p_image_asset_ids[i]=p_cover_asset_id
    from pg_catalog.generate_subscripts(p_image_asset_ids,1) i;
  if p_video_asset_id is not null then
    insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position,is_cover)
      values(p_video_asset_id,'shop_product',p_product_id,'video',0,false);
  end if;
  update public.products set images=urls,editor_saved_at=pg_catalog.now(),updated_at=pg_catalog.now() where id=p_product_id;
  update public.media_assets a set status='delete_pending',error_code='product_media_unlinked',
    next_cleanup_attempt_at=coalesce(next_cleanup_attempt_at,pg_catalog.now()),updated_at=pg_catalog.now()
  where a.id=any(old_ids) and not(a.id=any(coalesce(p_image_asset_ids,'{}')))
    and a.id is distinct from p_video_asset_id and a.owner_id=owner_id and a.status='ready'
    and a.purpose<>'business_library'
    and not exists(select 1 from public.media_asset_links l where l.asset_id=a.id);
  return pg_catalog.jsonb_build_object('image_count',image_count,'cover_asset_id',p_cover_asset_id,'video_asset_id',p_video_asset_id);
end;
$function$;
