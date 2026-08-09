begin;

-- An enabled promotion can become incompatible after its authoritative variant
-- price changes. In that case pricing fails open to the normal catalog price;
-- it never clamps or makes the product unreadable/unpurchasable.
create or replace function public.marketplace_effective_price(p_product_id uuid,p_variant_id uuid,p_at_time timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v public.marketplace_product_variants; promo public.marketplace_product_promotions; effective numeric(20,8);
begin
  select * into v from public.marketplace_product_variants where id=p_variant_id and product_id=p_product_id and status='active' and archived_at is null;
  if not found then raise exception using errcode='22023',message='marketplace_variant_unavailable'; end if;
  select * into promo from public.marketplace_product_promotions p where p.product_id=p_product_id and p.status='enabled'
    and p.starts_at<=p_at_time and p.ends_at>p_at_time and (p.variant_id=p_variant_id or p.variant_id is null)
    order by (p.variant_id is not null) desc,p.created_at desc limit 1;
  if not found then return jsonb_build_object('base_price',v.price,'effective_price',v.price,'promotion_id',null,'promotion_type',null,'discount_amount',0,'discount_percentage',null,'promotion_ends_at',null); end if;
  effective:=case promo.promotion_type
    when 'percentage' then round(v.price*(1-promo.percentage_off/100),8)
    when 'fixed_amount' then round(v.price-promo.fixed_amount_bdag,8)
    else promo.promotional_price_bdag end;
  if effective<=0 or effective>=v.price then
    return jsonb_build_object('base_price',v.price,'effective_price',v.price,'promotion_id',null,'promotion_type',null,'discount_amount',0,'discount_percentage',null,'promotion_ends_at',null);
  end if;
  return jsonb_build_object('base_price',v.price,'effective_price',effective,'promotion_id',promo.id,'promotion_type',promo.promotion_type,
    'discount_amount',round(v.price-effective,8),'discount_percentage',round((v.price-effective)*100/v.price,2),'promotion_ends_at',promo.ends_at);
end;$$;

-- Active promotion ending is retry-safe. Scheduled cancellation remains
-- intentionally unsupported in V1. Foreign and unknown ids remain denied.
create or replace function public.end_marketplace_product_promotion(p_promotion_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid(); owned public.marketplace_product_promotions; changed public.marketplace_product_promotions;
begin
  select * into owned from public.marketplace_product_promotions where id=p_promotion_id and seller_id=actor;
  if not found then raise exception using errcode='42501',message='marketplace_promotion_not_endable'; end if;
  if owned.status='ended' then return to_jsonb(owned); end if;
  if owned.status<>'enabled' or owned.starts_at>now() then raise exception using errcode='22023',message='marketplace_promotion_not_endable'; end if;
  update public.marketplace_product_promotions set status='ended',ends_at=least(ends_at,now()) where id=owned.id and status='enabled' returning * into changed;
  if found then return to_jsonb(changed); end if;
  select * into owned from public.marketplace_product_promotions where id=p_promotion_id and seller_id=actor;
  if owned.status='ended' then return to_jsonb(owned); end if;
  raise exception using errcode='22023',message='marketplace_promotion_not_endable';
end;$$;

-- Forward-only surgical correction of the deployed reservation authority.
-- The known B5 function is asserted before replacement. Each requested variant
-- is resolved once, accumulated in v_price_snapshot, and reused by checkout,
-- orders and immutable order-item snapshots.
do $migration$
declare definition text; corrected text;
begin
  select pg_get_functiondef('public.create_marketplace_checkout_reservation(jsonb,jsonb,uuid)'::regprocedure) into definition;
  if regexp_count(definition,'marketplace_effective_price\(v_product\.id,v_variant\.id,now\(\)\)')<>2 then
    raise exception 'marketplace_checkout_promotion_resolver_shape_changed';
  end if;
  corrected:=replace(definition,'v_promotion uuid;v_base numeric(20,8);','v_promotion uuid;v_base numeric(20,8);v_price_snapshot jsonb:=''{}''::jsonb;');
  corrected:=replace(corrected,
    'v_price:=public.marketplace_effective_price(v_product.id,v_variant.id,now());v_subtotal:=v_subtotal+round((v_price->>''effective_price'')::numeric*x.quantity,8);end loop;',
    'v_price:=public.marketplace_effective_price(v_product.id,v_variant.id,now());v_price_snapshot:=v_price_snapshot||jsonb_build_object(v_variant.id::text,v_price||jsonb_build_object(''quantity'',x.quantity));v_subtotal:=v_subtotal+round((v_price->>''effective_price'')::numeric*x.quantity,8);end loop;');
  corrected:=replace(corrected,
    'v_price:=public.marketplace_effective_price(v_product.id,v_variant.id,now());v_unit:=(v_price->>''effective_price'')::numeric;',
    'v_price:=v_price_snapshot->v_variant.id::text;if v_price is null or (v_price->>''quantity'')::integer<>x.quantity then raise exception using errcode=''23514'',message=''marketplace_checkout_price_snapshot_invalid'';end if;v_unit:=(v_price->>''effective_price'')::numeric;');
  if corrected=definition or regexp_count(corrected,'marketplace_effective_price\(v_product\.id,v_variant\.id,now\(\)\)')<>1
    or position('v_price:=v_price_snapshot->v_variant.id::text' in corrected)=0 then
    raise exception 'marketplace_checkout_promotion_snapshot_rewrite_failed';
  end if;
  execute corrected;
end;$migration$;

notify pgrst,'reload schema';
commit;
