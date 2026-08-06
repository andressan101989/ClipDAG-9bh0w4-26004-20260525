begin;

create or replace function public.fetch_seller_product_inventory(p_product_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;actor uuid:=auth.uid();p public.products;
begin
 if actor is null then raise exception using errcode='42501',message='marketplace_authentication_required';end if;
 select x.* into p from public.products x join public.marketplace_stores s on s.id=x.store_id and s.seller_id=actor
 where x.id=p_product_id and x.seller_id=actor and x.deleted_at is null;
 if p.id is null then raise exception using errcode='42501',message='marketplace_product_not_owned';end if;
 select jsonb_build_object(
  'product',jsonb_build_object('id',p.id,'seller_id',p.seller_id,'store_id',p.store_id,'category_id',p.category_id,'title',p.title,
   'description',p.description,'price',p.price,'currency',p.currency,'category',p.category,'images',p.images,'stock',p.stock,
   'status',p.status,'tags',p.tags,'total_sales',p.total_sales,'brand',p.brand,'compare_at_price',p.compare_at_price,
   'product_type',p.product_type,'moderation_status',p.moderation_status,'published_at',p.published_at,'deleted_at',p.deleted_at,
   'created_at',p.created_at,'updated_at',p.updated_at,'variant_price_max',p.variant_price_max,
   'active_variant_count',p.active_variant_count,'shipping_profile_id',p.shipping_profile_id),
  'detail',public.fetch_marketplace_product_detail(p_product_id),
  'inventory',coalesce((select jsonb_agg(jsonb_build_object('variant_id',v.id,'on_hand',l.on_hand,'reserved',l.reserved,
   'available_quantity',l.on_hand-l.reserved,'low_stock_threshold',l.low_stock_threshold,'version',l.version) order by v.is_default desc,v.created_at)
   from public.marketplace_product_variants v join public.marketplace_inventory_levels l on l.variant_id=v.id where v.product_id=p.id and v.status<>'archived'),'[]'::jsonb),
  'movements',coalesce((select jsonb_agg(row_data order by created_at desc) from(select jsonb_build_object('id',m.id,'variant_id',m.variant_id,
   'movement_type',m.movement_type,'delta',m.delta,'resulting_on_hand',m.resulting_on_hand,'reason',m.reason,'created_at',m.created_at)row_data,m.created_at
   from public.marketplace_inventory_movements m join public.marketplace_product_variants v on v.id=m.variant_id where v.product_id=p.id and m.seller_id=actor order by m.created_at desc limit 50)history),'[]'::jsonb),
  'media_assets',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'url',a.public_url) order by l.position) from public.media_asset_links l
   join public.media_assets a on a.id=l.asset_id where l.entity_type='shop_product' and l.entity_id=p.id and l.slot='image' and a.owner_id=actor and a.status='ready'),'[]'::jsonb)
 ) into result;
 return result;
end$$;

revoke all on function public.fetch_seller_product_inventory(uuid) from public,anon;
grant execute on function public.fetch_seller_product_inventory(uuid) to authenticated,service_role;

commit;
