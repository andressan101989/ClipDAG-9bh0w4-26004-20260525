begin;

-- Forward-only repair for PostgreSQL runtime resolution. Preserve the deployed
-- RPC signature, authorization, locking, pricing, and reservation semantics.
create or replace function public.create_marketplace_checkout_reservation(p_items jsonb,p_shipping_address jsonb,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_fingerprint text; v_prior public.marketplace_checkout_sessions;
  v_checkout uuid:=gen_random_uuid(); v_expires timestamptz:=now()+interval '15 minutes';
  v_subtotal numeric(20,8):=0; x record; v_variant public.marketplace_product_variants;
  v_product public.products; v_inventory public.marketplace_inventory_levels; v_order uuid; v_item uuid;
  v_line numeric(20,8); v_options jsonb; v_image text; v_address jsonb; v_total_qty bigint;
begin
  if v_user is null then raise exception using errcode='42501',message='marketplace_auth_required'; end if;
  if p_idempotency_key is null then raise exception using errcode='22023',message='marketplace_idempotency_key_required'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>100 then
    raise exception using errcode='22023',message='marketplace_invalid_checkout_items'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) e where jsonb_typeof(e)<>'object'
    or not(e?'variant_id' and e?'quantity')
    or (select count(*) from jsonb_object_keys(e))<>2
    or (e->>'variant_id') is null or (e->>'quantity')!~ '^[1-9][0-9]{0,2}$') then
    raise exception using errcode='22023',message='marketplace_invalid_checkout_items'; end if;
  if (select count(*)<>count(distinct (e->>'variant_id')) from jsonb_array_elements(p_items)e) then
    raise exception using errcode='22023',message='marketplace_duplicate_variant'; end if;
  select sum((e->>'quantity')::integer) into v_total_qty from jsonb_array_elements(p_items)e;
  if v_total_qty>1000 then raise exception using errcode='22023',message='marketplace_invalid_checkout_items'; end if;
  v_address:=jsonb_build_object('recipient_name',btrim(coalesce(p_shipping_address->>'recipient_name','')),
    'line1',btrim(coalesce(p_shipping_address->>'line1','')),'line2',nullif(btrim(coalesce(p_shipping_address->>'line2','')),''),
    'city',btrim(coalesce(p_shipping_address->>'city','')),'region',btrim(coalesce(p_shipping_address->>'region','')),
    'postal_code',btrim(coalesce(p_shipping_address->>'postal_code','')),'country',btrim(coalesce(p_shipping_address->>'country','')),
    'phone',nullif(btrim(coalesce(p_shipping_address->>'phone','')),''));
  if char_length(v_address->>'recipient_name') not between 2 and 120 or char_length(v_address->>'line1') not between 2 and 180
    or char_length(v_address->>'city') not between 1 and 100 or char_length(v_address->>'region') not between 1 and 100
    or char_length(v_address->>'postal_code') not between 1 and 30 or char_length(v_address->>'country') not between 2 and 100
    or char_length(coalesce(v_address->>'line2',''))>180 or char_length(coalesce(v_address->>'phone',''))>40 then
    raise exception using errcode='22023',message='marketplace_invalid_shipping_address'; end if;
  v_fingerprint:=pg_catalog.encode(extensions.digest((select jsonb_agg(jsonb_build_object('variant_id',e->>'variant_id','quantity',(e->>'quantity')::integer)
    order by e->>'variant_id')::text from jsonb_array_elements(p_items)e)||v_address::text,'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text||':'||p_idempotency_key::text,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('marketplace-checkout-buyer:'||v_user::text,0));
  select * into v_prior from public.marketplace_checkout_sessions where buyer_id=v_user and idempotency_key=p_idempotency_key;
  if found then
    if v_prior.request_fingerprint<>v_fingerprint then raise exception using errcode='23505',message='marketplace_idempotency_conflict'; end if;
    return public.marketplace_checkout_response(v_prior.id);
  end if;
  perform public.expire_marketplace_checkout_reservations(100);
  if exists(select 1 from public.marketplace_checkout_sessions where buyer_id=v_user and status='pending_payment') then
    raise exception using errcode='23505',message='marketplace_active_checkout_exists'; end if;
  perform 1 from public.marketplace_inventory_levels l join public.marketplace_product_variants v on v.id=l.variant_id
    join jsonb_array_elements(p_items)e on v.id=(e->>'variant_id')::uuid order by v.id for update of v,l;
  for x in select (e->>'variant_id')::uuid variant_id,(e->>'quantity')::integer quantity
    from jsonb_array_elements(p_items)e order by (e->>'variant_id')::uuid loop
    select * into v_variant from public.marketplace_product_variants where id=x.variant_id;
    if not found or v_variant.status<>'active' or v_variant.archived_at is not null then raise exception using message='marketplace_variant_unavailable'; end if;
    select * into v_product from public.products where id=v_variant.product_id;
    if not found or v_product.status<>'active' or v_product.published_at is null or v_product.deleted_at is not null
      or v_product.moderation_status<>'approved' or v_product.currency<>'BDAG'
      or not exists(select 1 from public.marketplace_stores s where s.id=v_variant.store_id and s.status='active')
      or not public.marketplace_seller_is_approved(v_variant.seller_id) then raise exception using message='marketplace_product_unavailable'; end if;
    if v_variant.seller_id=v_user then raise exception using message='marketplace_own_product_forbidden'; end if;
    select * into v_inventory from public.marketplace_inventory_levels where variant_id=x.variant_id;
    if v_inventory.on_hand-v_inventory.reserved<x.quantity then
      raise exception using message='marketplace_insufficient_inventory',detail=jsonb_build_object('variant_id',x.variant_id,
        'requested',x.quantity,'available',greatest(v_inventory.on_hand-v_inventory.reserved,0))::text; end if;
    v_subtotal:=v_subtotal+round(v_variant.price*x.quantity,8);
  end loop;
  insert into public.marketplace_checkout_sessions(id,reference,buyer_id,subtotal,total,idempotency_key,request_fingerprint,expires_at)
    values(v_checkout,'CHK-'||upper(substr(replace(v_checkout::text,'-',''),1,16)),v_user,v_subtotal,v_subtotal,p_idempotency_key,v_fingerprint,v_expires);
  insert into public.marketplace_checkout_shipping_addresses(checkout_id,recipient_name,line1,line2,city,region,postal_code,country,phone)
    values(v_checkout,v_address->>'recipient_name',v_address->>'line1',v_address->>'line2',v_address->>'city',v_address->>'region',v_address->>'postal_code',v_address->>'country',v_address->>'phone');
  for x in select (e->>'variant_id')::uuid variant_id,(e->>'quantity')::integer quantity from jsonb_array_elements(p_items)e order by (e->>'variant_id')::uuid loop
    select * into v_variant from public.marketplace_product_variants where id=x.variant_id;
    select * into v_product from public.products where id=v_variant.product_id;
    select id into v_order from public.marketplace_orders where checkout_id=v_checkout and store_id=v_variant.store_id;
    if v_order is null then v_order:=gen_random_uuid(); insert into public.marketplace_orders(id,order_number,checkout_id,buyer_id,seller_id,store_id,subtotal,total,reservation_expires_at)
      values(v_order,'ORD-'||upper(substr(replace(v_order::text,'-',''),1,16)),v_checkout,v_user,v_variant.seller_id,v_variant.store_id,v_variant.price*x.quantity,v_variant.price*x.quantity,v_expires);
    else update public.marketplace_orders set subtotal=subtotal+v_variant.price*x.quantity,total=total+v_variant.price*x.quantity where id=v_order; end if;
    select coalesce(jsonb_agg(jsonb_build_object('option_id',o.id,'option_name',o.name,'value_id',ov.id,'value',ov.value) order by o.position),'[]'::jsonb)
      into v_options from public.marketplace_variant_option_values vv join public.marketplace_product_option_values ov on ov.id=vv.option_value_id
      join public.marketplace_product_options o on o.id=ov.option_id where vv.variant_id=x.variant_id;
    select a.public_url into v_image from public.media_assets a where a.id=v_variant.image_asset_id and a.status='ready';
    v_line:=round(v_variant.price*x.quantity,8); v_item:=gen_random_uuid();
    insert into public.marketplace_order_items(id,order_id,checkout_id,product_id,variant_id,seller_id,store_id,product_title,variant_title,sku,option_snapshot,image_url,unit_price,quantity,line_total)
      values(v_item,v_order,v_checkout,v_product.id,v_variant.id,v_variant.seller_id,v_variant.store_id,v_product.title,v_variant.title,v_variant.sku,v_options,v_image,v_variant.price,x.quantity,v_line);
    select * into v_inventory from public.marketplace_inventory_levels where variant_id=x.variant_id;
    update public.marketplace_inventory_levels set reserved=reserved+x.quantity,version=version+1 where variant_id=x.variant_id;
    insert into public.marketplace_inventory_reservations(checkout_id,order_id,order_item_id,buyer_id,variant_id,quantity,expires_at)
      values(v_checkout,v_order,v_item,v_user,x.variant_id,x.quantity,v_expires) returning id into v_item;
    insert into public.marketplace_inventory_reservation_events(reservation_id,checkout_id,variant_id,event_type,quantity_delta,previous_reserved,resulting_reserved,reason,actor_id)
      values(v_item,v_checkout,x.variant_id,'reserve',x.quantity,v_inventory.reserved,v_inventory.reserved+x.quantity,'checkout_created',v_user);
  end loop;
  for x in select distinct v.product_id from public.marketplace_product_variants v join jsonb_array_elements(p_items)e on v.id=(e->>'variant_id')::uuid loop
    perform public.refresh_marketplace_product_projection(x.product_id); end loop;
  return public.marketplace_checkout_response(v_checkout);
end; $$;

revoke all on function public.create_marketplace_checkout_reservation(jsonb,jsonb,uuid) from public,anon;
grant execute on function public.create_marketplace_checkout_reservation(jsonb,jsonb,uuid) to authenticated,service_role;

commit;
