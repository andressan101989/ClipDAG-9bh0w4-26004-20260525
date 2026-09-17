-- BUSINESS-WEB-BW-C
-- Business-scoped Seller Center projections and capability-aware canonical mutations.
-- No Marketplace domain table or financial authority is created by this migration.

create or replace function private.bw_c_patch_function(
  p_signature text,
  p_replacements jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_oid regprocedure;
  v_definition text;
  v_item jsonb;
  v_from text;
  v_to text;
begin
  v_oid := pg_catalog.to_regprocedure(p_signature);
  if v_oid is null then
    raise exception 'bw_c_function_not_found:%', p_signature;
  end if;
  select pg_catalog.pg_get_functiondef(v_oid::oid) into v_definition;
  for v_item in select value from pg_catalog.jsonb_array_elements(p_replacements)
  loop
    v_from := v_item->>'from';
    v_to := v_item->>'to';
    if pg_catalog.strpos(v_definition, v_from) = 0 then
      raise exception 'bw_c_patch_anchor_not_found:%:%', p_signature, v_from;
    end if;
    v_definition := pg_catalog.replace(v_definition, v_from, v_to);
  end loop;
  v_definition := pg_catalog.replace(v_definition, 'SET search_path TO ''pg_catalog'', ''public''', 'SET search_path TO ''''');
  v_definition := pg_catalog.replace(v_definition, 'SET search_path TO ''public''', 'SET search_path TO ''''');
  execute v_definition;
end;
$function$;

-- Shipping remains canonical; Store/Product relationships provide the scope.
select private.bw_c_patch_function(
  'public.upsert_my_marketplace_shipping_profile(uuid,uuid,text,integer,integer,text,text,jsonb)',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'from', $old$declare actor uuid:=auth.uid();result uuid:=coalesce(p_profile_id,gen_random_uuid());r jsonb;
 country text;region text;rule_id uuid;kept_ids uuid[]:='{}';price numeric;threshold numeric;days_min int;days_max int;
begin
 if actor is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;$old$,
    'to', $new$declare caller uuid:=auth.uid();actor uuid;result uuid:=coalesce(p_profile_id,gen_random_uuid());r jsonb;
country text;region text;rule_id uuid;kept_ids uuid[]:='{}';price numeric;threshold numeric;days_min int;days_max int;
begin
 if caller is null then raise exception using errcode='42501',message='marketplace_auth_required';end if;
 select s.seller_id into actor from public.marketplace_stores s where s.id=p_store_id;
 if actor is null then raise exception using errcode='42501',message='marketplace_store_inactive';end if;
 perform private.business_require_capability(actor,'business.catalog.manage');$new$
  ))
);

-- Bounded, capability-gated read projections for multi-business web access.
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
declare v_limit integer:=pg_catalog.least(pg_catalog.greatest(pg_catalog.coalesce(p_limit,30),1),60);v_rows jsonb;v_more boolean;
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
        then (select pg_catalog.coalesce(pg_catalog.sum(pg_catalog.greatest(i.on_hand-i.reserved,0)),0)
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
  select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',id,'title',title,'status',status,'price',price,'currency',currency,'variant_count',variant_count,
    'readiness_reason',readiness_reason,'updated_at',updated_at,'thumbnail_url',thumbnail_url,'available_stock',available_stock
  ) order by updated_at desc,id desc) filter(where rn<=v_limit),'[]'::jsonb),pg_catalog.count(*)>v_limit into v_rows,v_more from numbered;
  return pg_catalog.jsonb_build_object('items',v_rows,'categories',pg_catalog.coalesce((
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
    'media',pg_catalog.coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('asset_id',l.asset_id,'slot',l.slot,
      'position',l.position,'is_cover',l.is_cover,'url',a.public_url,'media_kind',a.media_kind,'purpose',a.purpose)
      order by l.slot,l.position) from public.media_asset_links l join public.media_assets a on a.id=l.asset_id
      where l.entity_type='shop_product' and l.entity_id=p.id),'[]'::jsonb),
    'options',pg_catalog.coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',o.id,'name',o.name,'position',o.position,
      'values',pg_catalog.coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',ov.id,'value',ov.value,'position',ov.position) order by ov.position)
       from public.marketplace_product_option_values ov where ov.option_id=o.id),'[]'::jsonb)) order by o.position)
      from public.marketplace_product_options o where o.product_id=p.id),'[]'::jsonb),
    'variants',pg_catalog.coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',v.id,'sku',v.sku,'title',v.title,
      'price',v.price,'compare_at_price',v.compare_at_price,'status',v.status,'is_default',v.is_default,'image_asset_id',v.image_asset_id,
      'barcode',v.barcode,'on_hand',case when v_inventory then i.on_hand else null end,'reserved',case when v_inventory then i.reserved else null end,
      'available',case when v_inventory then i.on_hand-i.reserved else null end,'low_stock_threshold',case when v_inventory then i.low_stock_threshold else null end)
      order by v.is_default desc,v.created_at,v.id) from public.marketplace_product_variants v
      left join public.marketplace_inventory_levels i on i.variant_id=v.id where v.product_id=p.id),'[]'::jsonb),
    'categories',pg_catalog.coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',c.id,'name',c.name,'slug',c.slug) order by c.name)
      from public.marketplace_categories c where c.status='active'),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;

create or replace function public.search_my_business_shipping_profiles(
  p_business_owner_id uuid,p_cursor_created_at timestamptz default null,p_cursor_id uuid default null,p_limit integer default 30
)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare v_limit integer:=pg_catalog.least(pg_catalog.greatest(pg_catalog.coalesce(p_limit,30),1),60);v_rows jsonb;v_more boolean;
begin
  if not(private.business_actor_has_capability(p_business_owner_id,'business.catalog.read')
    or private.business_actor_has_capability(p_business_owner_id,'business.catalog.manage')) then
    raise exception using errcode='42501',message='business_catalog_read_required';end if;
  with candidates as(select sp.* from public.marketplace_shipping_profiles sp where sp.seller_id=p_business_owner_id
    and(p_cursor_created_at is null or(sp.created_at,sp.id)<(p_cursor_created_at,p_cursor_id)) order by sp.created_at desc,sp.id desc limit v_limit+1),
  numbered as(select *,pg_catalog.row_number()over(order by created_at desc,id desc)rn from candidates)
  select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',id,'store_id',store_id,'name',name,'status',status,
    'processing_days_min',processing_days_min,'processing_days_max',processing_days_max,'ships_from_country',ships_from_country,
    'return_policy_summary',return_policy_summary,'configuration_status',configuration_status,'created_at',created_at,
    'regions',pg_catalog.coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',r.id,'country_code',r.country_code,
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
declare v_limit integer:=pg_catalog.least(pg_catalog.greatest(pg_catalog.coalesce(p_limit,30),1),60);v_rows jsonb;v_more boolean;
begin
  if not(private.business_actor_has_capability(p_business_owner_id,'business.orders.read')
    or private.business_actor_has_capability(p_business_owner_id,'business.orders.fulfill'))then
    raise exception using errcode='42501',message='business_orders_read_required';end if;
  with candidates as(select o.* from public.marketplace_orders o where o.seller_id=p_business_owner_id
    and(p_status is null or o.status=p_status)and(p_cursor_created_at is null or(o.created_at,o.id)<(p_cursor_created_at,p_cursor_id))
    order by o.created_at desc,o.id desc limit v_limit+1),numbered as(select *,pg_catalog.row_number()over(order by created_at desc,id desc)rn from candidates)
  select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',id,'order_number',order_number,'status',status,
    'currency',currency,'subtotal',subtotal,'shipping_amount',shipping_amount,'total',total,'created_at',created_at,
    'processing_at',processing_at,'shipped_at',shipped_at,'delivered_at',delivered_at,
    'items',pg_catalog.coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('title',i.product_title,'variant',i.variant_title,
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
    'items',pg_catalog.coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i)-'buyer_id'-'seller_id'-'checkout_id')from public.marketplace_order_items i where i.order_id=o.id),'[]'::jsonb),
    'shipment',(select pg_catalog.to_jsonb(s)-'buyer_id'-'seller_id'-'checkout_id' from public.marketplace_order_shipments s where s.order_id=o.id order by s.created_at desc limit 1),
    'shipping_address',case when v_fulfill then(select pg_catalog.jsonb_build_object('recipient_name',a.recipient_name,'line1',a.line1,'line2',a.line2,
      'city',a.city,'region',a.region,'postal_code',a.postal_code,'country',a.country,'phone',a.phone)
      from public.marketplace_checkout_shipping_addresses a where a.checkout_id=o.checkout_id)else null end);
end;$function$;

create or replace function public.search_my_business_returns(
  p_business_owner_id uuid,p_cursor_created_at timestamptz default null,p_cursor_id uuid default null,p_limit integer default 30
)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare v_limit integer:=pg_catalog.least(pg_catalog.greatest(pg_catalog.coalesce(p_limit,30),1),60);v_rows jsonb;v_more boolean;
begin
  if not(private.business_actor_has_capability(p_business_owner_id,'business.returns.read')
    or private.business_actor_has_capability(p_business_owner_id,'business.returns.manage'))then
    raise exception using errcode='42501',message='business_returns_read_required';end if;
  with candidates as(select r.* from public.marketplace_return_requests r where r.seller_id=p_business_owner_id
    and(p_cursor_created_at is null or(r.created_at,r.id)<(p_cursor_created_at,p_cursor_id))order by r.created_at desc,r.id desc limit v_limit+1),
  numbered as(select *,pg_catalog.row_number()over(order by created_at desc,id desc)rn from candidates)
  select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',id,'order_id',order_id,
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
declare v_limit integer:=pg_catalog.least(pg_catalog.greatest(pg_catalog.coalesce(p_limit,30),1),60);v_rows jsonb;v_more boolean;
begin
  if not(private.business_actor_has_capability(p_business_owner_id,'business.disputes.read')
    or private.business_actor_has_capability(p_business_owner_id,'business.disputes.respond'))then
    raise exception using errcode='42501',message='business_disputes_read_required';end if;
  with candidates as(select d.* from public.marketplace_order_disputes d where d.seller_id=p_business_owner_id
    and(p_cursor_created_at is null or(d.created_at,d.id)<(p_cursor_created_at,p_cursor_id))order by d.created_at desc,d.id desc limit v_limit+1),
  numbered as(select *,pg_catalog.row_number()over(order by created_at desc,id desc)rn from candidates)
  select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',id,'order_id',order_id,
    'order_number',(select o.order_number from public.marketplace_orders o where o.id=numbered.order_id),'status',status,
    'reason_code',reason_code,'buyer_note',buyer_note,'created_at',created_at,'resolved_at',resolved_at,
    'seller_response',(select pg_catalog.jsonb_build_object('note',r.note,'created_at',r.created_at,
      'evidence_asset_ids',pg_catalog.coalesce((select pg_catalog.jsonb_agg(l.asset_id order by l.position)from public.media_asset_links l
        where l.entity_type='marketplace_dispute'and l.entity_id=numbered.id and l.slot='seller_evidence'),'[]'::jsonb))
      from public.marketplace_dispute_seller_responses r where r.dispute_id=numbered.id))
    order by created_at desc,id desc)filter(where rn<=v_limit),'[]'::jsonb),pg_catalog.count(*)>v_limit into v_rows,v_more from numbered;
  return pg_catalog.jsonb_build_object('items',v_rows,'next_cursor',case when v_more then(select pg_catalog.jsonb_build_object('created_at',created_at,'id',id)from candidates order by created_at desc,id desc offset v_limit-1 limit 1)else null end);
end;$function$;

revoke all on function public.search_my_business_products(uuid,text,text,timestamptz,uuid,integer) from public,anon;
revoke all on function public.get_my_business_product(uuid,uuid) from public,anon;
revoke all on function public.search_my_business_shipping_profiles(uuid,timestamptz,uuid,integer) from public,anon;
revoke all on function public.search_my_business_orders(uuid,text,timestamptz,uuid,integer) from public,anon;
revoke all on function public.get_my_business_order(uuid,uuid) from public,anon;
revoke all on function public.search_my_business_returns(uuid,timestamptz,uuid,integer) from public,anon;
revoke all on function public.search_my_business_disputes(uuid,timestamptz,uuid,integer) from public,anon;
grant execute on function public.search_my_business_products(uuid,text,text,timestamptz,uuid,integer) to authenticated;
grant execute on function public.get_my_business_product(uuid,uuid) to authenticated;
grant execute on function public.search_my_business_shipping_profiles(uuid,timestamptz,uuid,integer) to authenticated;
grant execute on function public.search_my_business_orders(uuid,text,timestamptz,uuid,integer) to authenticated;
grant execute on function public.get_my_business_order(uuid,uuid) to authenticated;
grant execute on function public.search_my_business_returns(uuid,timestamptz,uuid,integer) to authenticated;
grant execute on function public.search_my_business_disputes(uuid,timestamptz,uuid,integer) to authenticated;

create or replace function public.set_my_marketplace_product_shipping_profile(p_product_id uuid,p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare v_owner uuid;
begin
  select p.seller_id into v_owner from public.products p where p.id=p_product_id and p.deleted_at is null;
  if v_owner is null then raise exception using errcode='42501',message='marketplace_shipping_configuration_required';end if;
  perform private.business_require_capability(v_owner,'business.catalog.manage');
  update public.products p set shipping_profile_id=p_profile_id,updated_at=pg_catalog.now()
  where p.id=p_product_id and p.seller_id=v_owner and exists(
    select 1 from public.marketplace_shipping_profiles sp where sp.id=p_profile_id
      and sp.seller_id=v_owner and sp.store_id=p.store_id and sp.status='active'
      and sp.configuration_status='explicit_ready');
  if not found then raise exception using errcode='42501',message='marketplace_shipping_configuration_required';end if;
end;
$function$;

-- Product media accepts reusable BW-E images without changing READY identity.
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
  image_count int:=pg_catalog.coalesce(pg_catalog.array_length(p_image_asset_ids,1),0);
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
  if image_count>5 or(select pg_catalog.count(distinct x) from pg_catalog.unnest(pg_catalog.coalesce(p_image_asset_ids,'{}')) x)<>image_count then
    raise exception using errcode='22023',message='marketplace_product_image_limit';
  end if;
  if(image_count=0 and p_cover_asset_id is not null)or(image_count>0 and not(p_cover_asset_id=any(p_image_asset_ids)))then
    raise exception using errcode='22023',message='marketplace_product_cover_invalid';
  end if;
  perform id from public.media_assets where id=any(pg_catalog.coalesce(p_image_asset_ids,'{}'))or id=p_video_asset_id order by id for update;
  if image_count>0 then
    select pg_catalog.array_agg(a.public_url order by ids.ordinality) into urls
    from pg_catalog.unnest(p_image_asset_ids) with ordinality ids(id,ordinality)
    join public.media_assets a on a.id=ids.id
    where a.owner_id=owner_id and a.status='ready' and a.visibility='public'
      and a.media_kind='image' and a.purpose in('product_image','business_library') and a.public_url is not null;
    if pg_catalog.coalesce(pg_catalog.array_length(urls,1),0)<>image_count then
      raise exception using errcode='42501',message='marketplace_product_media_not_ready';
    end if;
  end if;
  if p_video_asset_id is not null and not exists(
    select 1 from public.media_assets a where a.id=p_video_asset_id and a.owner_id=owner_id
      and a.status='ready' and a.visibility='public' and a.media_kind='video' and a.purpose='product_video'
      and a.mime_type in('video/mp4','video/quicktime') and a.duration_ms between 1 and 60000 and a.public_url is not null
  )then raise exception using errcode='22023',message='marketplace_product_video_invalid';end if;
  select pg_catalog.coalesce(pg_catalog.array_agg(asset_id),'{}') into old_ids from public.media_asset_links
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
    next_cleanup_attempt_at=pg_catalog.coalesce(next_cleanup_attempt_at,pg_catalog.now()),updated_at=pg_catalog.now()
  where a.id=any(old_ids) and not(a.id=any(pg_catalog.coalesce(p_image_asset_ids,'{}')))
    and a.id is distinct from p_video_asset_id and a.owner_id=owner_id and a.status='ready'
    and a.purpose<>'business_library'
    and not exists(select 1 from public.media_asset_links l where l.asset_id=a.id);
  return pg_catalog.jsonb_build_object('image_count',image_count,'cover_asset_id',p_cover_asset_id,'video_asset_id',p_video_asset_id);
end;
$function$;

-- Fulfillment is operational. The entity-derived seller is capability checked;
-- auth.uid() remains the event actor for audit and idempotency.
select private.bw_c_patch_function(
  'public.seller_start_marketplace_order_processing(uuid,uuid)',
  pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'from', $old$if not found then raise exception using errcode='P0002',message='marketplace_order_not_found';end if;if o.seller_id<>auth.uid() then raise exception using errcode='42501',message='marketplace_order_not_owned';end if;$old$,
      'to', $new$if not found then raise exception using errcode='P0002',message='marketplace_order_not_found';end if;perform private.business_require_capability(o.seller_id,'business.orders.fulfill');$new$
    ),
    pg_catalog.jsonb_build_object(
      'from', $old$if not exists(select 1 from public.marketplace_sellers where user_id=auth.uid() and status='approved') then$old$,
      'to', $new$if not exists(select 1 from public.marketplace_sellers where user_id=o.seller_id and status='approved') then$new$
    )
  )
);

select private.bw_c_patch_function(
  'public.seller_ship_marketplace_order(uuid,text,text,text,text,text,uuid)',
  pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'from', $old$if not found then raise exception using errcode='P0002',message='marketplace_order_not_found';end if;if o.seller_id<>auth.uid() then raise exception using errcode='42501',message='marketplace_order_not_owned';end if;$old$,
      'to', $new$if not found then raise exception using errcode='P0002',message='marketplace_order_not_found';end if;perform private.business_require_capability(o.seller_id,'business.orders.fulfill');$new$
    ),
    pg_catalog.jsonb_build_object(
      'from', $old$where se.user_id=auth.uid() and se.status='approved' and st.status='active'$old$,
      'to', $new$where se.user_id=o.seller_id and se.status='approved' and st.status='active'$new$
    )
  )
);

-- Return approval funds a refund hold and remains owner-only. Rejection is the
-- only member-delegable decision. Label dispatch is operational.
select private.bw_c_patch_function(
  'public.respond_to_marketplace_return(uuid,text,text,uuid)',
  pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'from', $old$  if v_request.seller_id<>v_actor then
    raise exception using errcode='42501',message='marketplace_return_not_owned';
  end if;$old$,
      'to', $new$  if v_decision='approve' and v_request.seller_id<>v_actor then
    raise exception using errcode='42501',message='marketplace_return_owner_required';
  end if;
  if v_decision='reject' then
    perform private.business_require_capability(v_request.seller_id,'business.returns.manage');
  end if;$new$
    ),
    pg_catalog.jsonb_build_object(
      'from', $old$where ms.user_id=v_actor and ms.status='approved'$old$,
      'to', $new$where ms.user_id=v_request.seller_id and ms.status='approved'$new$
    ),
    pg_catalog.jsonb_build_object(
      'from', $old$where st.id=v_request.store_id and st.seller_id=v_actor and st.status='active'$old$,
      'to', $new$where st.id=v_request.store_id and st.seller_id=v_request.seller_id and st.status='active'$new$
    ),
    pg_catalog.jsonb_build_object(
      'from', $old$where seller_id=v_actor and decision_idempotency_key=p_idempotency_key for update;$old$,
      'to', $new$where seller_id=v_request.seller_id and decision_idempotency_key=p_idempotency_key for update;$new$
    )
  )
);

select private.bw_c_patch_function(
  'public.send_marketplace_return_label(uuid,uuid,uuid)',
  pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'from', $old$  if rr.seller_id<>v_actor then
    raise exception using errcode='42501',message='marketplace_return_not_owned';
  end if;$old$,
      'to', $new$  perform private.business_require_capability(rr.seller_id,'business.returns.manage');$new$
    ),
    pg_catalog.jsonb_build_object('from',$old$where x.seller_id=v_actor and x.label_idempotency_key=p_idempotency_key$old$,'to',$new$where x.seller_id=rr.seller_id and x.label_idempotency_key=p_idempotency_key$new$),
    pg_catalog.jsonb_build_object('from',$old$if ma.id is null or ma.owner_id<>v_actor or ma.status<>'ready'$old$,'to',$new$if ma.id is null or ma.owner_id<>rr.seller_id or ma.status<>'ready'$new$),
    pg_catalog.jsonb_build_object('from',$old$where se.user_id=v_actor and se.status='approved'$old$,'to',$new$where se.user_id=rr.seller_id and se.status='approved'$new$),
    pg_catalog.jsonb_build_object('from',$old$where st.id=o.store_id and st.seller_id=v_actor and st.status='active'$old$,'to',$new$where st.id=o.store_id and st.seller_id=rr.seller_id and st.status='active'$new$)
  )
);

select private.bw_c_patch_function(
  'public.respond_to_marketplace_dispute(uuid,text,uuid[],uuid)',
  pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'from', $old$  if v_dispute.seller_id<>auth.uid() then
    raise exception using errcode='42501',message='marketplace_dispute_not_owned';
  end if;$old$,
      'to', $new$  perform private.business_require_capability(v_dispute.seller_id,'business.disputes.respond');$new$
    ),
    pg_catalog.jsonb_build_object('from',$old$where id=any(v_asset_ids) and owner_id=auth.uid() and status='ready'$old$,'to',$new$where id=any(v_asset_ids) and owner_id=v_dispute.seller_id and status='ready'$new$),
    pg_catalog.jsonb_build_object('from',$old$where seller_id=auth.uid() and idempotency_key=p_idempotency_key;$old$,'to',$new$where seller_id=v_dispute.seller_id and idempotency_key=p_idempotency_key;$new$),
    pg_catalog.jsonb_build_object('from',$old$values(p_dispute_id,auth.uid(),v_note,p_idempotency_key)$old$,'to',$new$values(p_dispute_id,v_dispute.seller_id,v_note,p_idempotency_key)$new$)
  )
);

revoke all on function private.bw_c_patch_function(text,jsonb) from public, anon, authenticated;

-- Product draft creation derives the canonical owner from the Store.
select private.bw_c_patch_function(
  'public.create_or_resume_marketplace_product_draft(uuid,uuid,uuid)',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'from', $old$declare actor uuid:=auth.uid();result uuid;slug text;variant_id uuid;draft_sku text;
begin
 if actor is null then raise exception using errcode='42501',message='marketplace_authentication_required';end if;$old$,
    'to', $new$declare caller uuid:=auth.uid();actor uuid;result uuid;slug text;variant_id uuid;draft_sku text;
begin
 if caller is null then raise exception using errcode='42501',message='marketplace_authentication_required';end if;
 select s.seller_id into actor from public.marketplace_stores s where s.id=p_store_id;
 if actor is null then raise exception using errcode='42501',message='marketplace_store_inactive';end if;
 perform private.business_require_capability(actor,'business.catalog.manage');$new$
  ))
);

select private.bw_c_patch_function(
  'public.save_my_marketplace_product_draft(uuid,uuid,text,text,numeric,text,numeric,integer,text[],uuid,text,boolean,boolean,boolean)',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'from', $old$declare actor uuid:=auth.uid();slug text;normalized_price numeric(20,8);normalized_compare_price numeric(20,8);row_status text;
begin
 if actor is null then raise exception using errcode='42501',message='marketplace_authentication_required';end if;$old$,
    'to', $new$declare caller uuid:=auth.uid();actor uuid;slug text;normalized_price numeric(20,8);normalized_compare_price numeric(20,8);row_status text;
begin
 if caller is null then raise exception using errcode='42501',message='marketplace_authentication_required';end if;
 select p.seller_id into actor from public.products p where p.id=p_product_id and p.deleted_at is null;
 if actor is null then raise exception using errcode='42501',message='marketplace_product_not_editable';end if;
 perform private.business_require_capability(actor,'business.catalog.manage');$new$
  ))
);

select private.bw_c_patch_function(
  'public.publish_my_marketplace_product_checked(uuid)',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'from', $old$declare actor uuid:=auth.uid();reason text;result jsonb;
begin
 if actor is null then raise exception using errcode='42501',message='marketplace_authentication_required';end if;$old$,
    'to', $new$declare caller uuid:=auth.uid();actor uuid;reason text;result jsonb;
begin
 if caller is null then raise exception using errcode='42501',message='marketplace_authentication_required';end if;
 select p.seller_id into actor from public.products p where p.id=p_product_id and p.deleted_at is null;
 if actor is null then raise exception using errcode='42501',message='marketplace_product_not_editable';end if;
 perform private.business_require_capability(actor,'business.catalog.manage');$new$
  ))
);

select private.bw_c_patch_function(
  'public.set_marketplace_product_publication(uuid,boolean)',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'from', $old$declare v_user_id uuid:=auth.uid();
begin
  if not public.marketplace_seller_is_approved(v_user_id) then$old$,
    'to', $new$declare v_actor uuid:=auth.uid();v_user_id uuid;
begin
  if v_actor is null then raise exception using errcode='42501',message='marketplace_authentication_required';end if;
  select p.seller_id into v_user_id from public.products p where p.id=p_product_id and p.deleted_at is null;
  if v_user_id is null then raise exception using errcode='42501',message='product_publication_not_allowed';end if;
  perform private.business_require_capability(v_user_id,'business.catalog.manage');
  if not public.marketplace_seller_is_approved(v_user_id) then$new$
  ))
);

select private.bw_c_patch_function(
  'public.soft_delete_marketplace_product(uuid)',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'from', $old$declare v_user_id uuid:=auth.uid();
begin
  if not public.marketplace_seller_is_approved(v_user_id) then$old$,
    'to', $new$declare v_actor uuid:=auth.uid();v_user_id uuid;
begin
  if v_actor is null then raise exception using errcode='42501',message='marketplace_authentication_required';end if;
  select p.seller_id into v_user_id from public.products p where p.id=p_product_id and p.deleted_at is null;
  if v_user_id is null then raise exception using errcode='42501',message='product_not_deletable';end if;
  perform private.business_require_capability(v_user_id,'business.catalog.manage');
  if not public.marketplace_seller_is_approved(v_user_id) then$new$
  ))
);

-- Variant helpers remain the single canonical mutation path.
create or replace function public.marketplace_assert_variant_owner(p_variant_id uuid)
returns public.marketplace_product_variants
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v public.marketplace_product_variants;
begin
  select pv.* into v
  from public.marketplace_product_variants pv
  join public.products p on p.id=pv.product_id
  join public.marketplace_stores s on s.id=pv.store_id
  where pv.id=p_variant_id and pv.seller_id=p.seller_id
    and p.deleted_at is null and s.seller_id=p.seller_id and s.status='active'
  for update of pv;
  if not found then
    raise exception using errcode='42501',message='marketplace_variant_not_editable';
  end if;
  perform private.business_require_capability(v.seller_id,'business.catalog.manage');
  return v;
end;
$function$;

select private.bw_c_patch_function(
  'public.marketplace_mutate_inventory(uuid,integer,boolean,text,uuid)',
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'from', $old$  v:=public.marketplace_assert_variant_owner(p_variant_id);
  if v.status='archived' then$old$,
    'to', $new$  select pv.* into v from public.marketplace_product_variants pv
  join public.products p on p.id=pv.product_id
  join public.marketplace_stores s on s.id=pv.store_id
  where pv.id=p_variant_id and p.deleted_at is null and s.status='active' for update of pv;
  if not found then raise exception using errcode='42501',message='marketplace_variant_not_editable';end if;
  perform private.business_require_capability(v.seller_id,'business.inventory.manage');
  if v.status='archived' then$new$
  ))
);

create or replace function public.set_marketplace_variant_low_stock_threshold(p_variant_id uuid,p_threshold integer)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare v_owner uuid;
begin
  select pv.seller_id into v_owner from public.marketplace_product_variants pv
  join public.products p on p.id=pv.product_id
  where pv.id=p_variant_id and p.deleted_at is null;
  if v_owner is null then raise exception using errcode='42501',message='marketplace_variant_not_editable';end if;
  perform private.business_require_capability(v_owner,'business.inventory.manage');
  if p_threshold is null or p_threshold<0 or p_threshold>1000000000 then
    raise exception using errcode='22023',message='marketplace_invalid_low_stock_threshold';
  end if;
  update public.marketplace_inventory_levels set low_stock_threshold=p_threshold where variant_id=p_variant_id;
end;
$function$;

select private.bw_c_patch_function(
  'public.configure_marketplace_product_variants(uuid,jsonb,jsonb,uuid)',
  pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'from', $old$  v_user uuid:=auth.uid();
  v_fingerprint text;$old$,
      'to', $new$  v_user uuid:=auth.uid();
  v_owner uuid;
  v_fingerprint text;$new$
    ),
    pg_catalog.jsonb_build_object(
      'from', $old$  if not public.marketplace_seller_is_approved(v_user)
     or not exists(
       select 1
       from public.products p
       join public.marketplace_stores s on s.id=p.store_id
       where p.id=p_product_id
         and p.seller_id=v_user
         and p.deleted_at is null
         and s.seller_id=v_user
         and s.status='active'
     ) then
    raise exception using errcode='42501',message='product_not_editable';
  end if;$old$,
      'to', $new$  if v_user is null then raise exception using errcode='42501',message='marketplace_authentication_required';end if;
  select p.seller_id into v_owner from public.products p where p.id=p_product_id and p.deleted_at is null;
  if v_owner is null then raise exception using errcode='42501',message='product_not_editable';end if;
  perform private.business_require_capability(v_owner,'business.catalog.manage');
  if not exists(select 1 from public.marketplace_stores s join public.products p on p.store_id=s.id
    where p.id=p_product_id and p.seller_id=v_owner and s.seller_id=v_owner and s.status='active') then
    raise exception using errcode='42501',message='product_not_editable';
  end if;$new$
    )
  )
);

select private.bw_c_patch_function(
  'public.configure_marketplace_product_variants_mkt_a2_original(uuid,jsonb,jsonb,uuid)',
  pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'from', $old$  v_user uuid:=auth.uid(); p public.products; opt jsonb; val jsonb; vr jsonb;$old$,
      'to', $new$  v_user uuid:=auth.uid(); v_owner uuid; p public.products; opt jsonb; val jsonb; vr jsonb;$new$
    ),
    pg_catalog.jsonb_build_object(
      'from', $old$  select px.* into p from public.products px join public.marketplace_stores s on s.id=px.store_id
  where px.id=p_product_id and px.seller_id=v_user and px.deleted_at is null
    and s.seller_id=v_user and s.status='active' for update of px;
  if not found or not public.marketplace_seller_is_approved(v_user) then
    raise exception using errcode='42501',message='product_not_editable';
  end if;$old$,
      'to', $new$  if v_user is null then raise exception using errcode='42501',message='marketplace_authentication_required';end if;
  select px.seller_id into v_owner from public.products px where px.id=p_product_id and px.deleted_at is null;
  if v_owner is null then raise exception using errcode='42501',message='product_not_editable';end if;
  perform private.business_require_capability(v_owner,'business.catalog.manage');
  select px.* into p from public.products px join public.marketplace_stores s on s.id=px.store_id
  where px.id=p_product_id and px.seller_id=v_owner and px.deleted_at is null
    and s.seller_id=v_owner and s.status='active' for update of px;
  if not found then raise exception using errcode='42501',message='product_not_editable';end if;$new$
    )
  )
);

create or replace function public.marketplace_validate_variant_image(p_product_id uuid,p_asset_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare v_owner uuid;
begin
  if p_asset_id is null then return;end if;
  select p.seller_id into v_owner from public.products p where p.id=p_product_id and p.deleted_at is null;
  if v_owner is null then raise exception using errcode='42501',message='marketplace_variant_image_not_allowed';end if;
  perform private.business_require_capability(v_owner,'business.catalog.manage');
  if not exists(
    select 1 from public.media_assets a join public.media_asset_links l on l.asset_id=a.id
    where a.id=p_asset_id and a.owner_id=v_owner and a.status='ready'
      and a.purpose in('product_image','business_library') and a.media_kind='image'
      and l.entity_type='shop_product' and l.entity_id=p_product_id and l.slot='image'
  ) then raise exception using errcode='42501',message='marketplace_variant_image_not_allowed';end if;
end;
$function$;

drop function private.bw_c_patch_function(text,jsonb);
