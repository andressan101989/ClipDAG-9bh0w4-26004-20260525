begin;

create or replace function public.fetch_my_marketplace_products()
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare actor uuid:=auth.uid();result jsonb;
begin
 if actor is null then raise exception using errcode='42501',message='marketplace_authentication_required';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',p.id,'seller_id',p.seller_id,'store_id',p.store_id,'category_id',p.category_id,
  'title',p.title,'description',p.description,'price',p.price,'currency',p.currency,
  'category',p.category,'images',p.images,'stock',p.stock,'status',p.status,'tags',p.tags,
  'total_sales',p.total_sales,'brand',p.brand,'compare_at_price',p.compare_at_price,
  'product_type',p.product_type,'moderation_status',p.moderation_status,
  'published_at',p.published_at,'deleted_at',p.deleted_at,'created_at',p.created_at,
  'updated_at',p.updated_at,'variant_price_max',p.variant_price_max,
  'active_variant_count',p.active_variant_count,'shipping_profile_id',p.shipping_profile_id,
  'available_quantity',coalesce(inv.available_quantity,0),
  'publication_readiness_reason',public.marketplace_product_publication_reason(p.id,actor),
  'seller',jsonb_build_object('username',u.username,'avatar_url',u.avatar_url,'display_name',u.display_name)
 )order by p.updated_at desc),'[]'::jsonb)into result
 from public.products p join public.marketplace_stores s on s.id=p.store_id and s.seller_id=actor
 left join public.user_profiles u on u.id=p.seller_id
 left join lateral(select sum(greatest(i.on_hand-i.reserved,0))::int available_quantity
  from public.marketplace_product_variants v join public.marketplace_inventory_levels i on i.variant_id=v.id
  where v.product_id=p.id and v.status='active')inv on true
 where p.seller_id=actor and p.deleted_at is null and p.status<>'deleted';
 return result;
end$$;

revoke all on function public.fetch_my_marketplace_products()from public,anon;
grant execute on function public.fetch_my_marketplace_products()to authenticated,service_role;
comment on function public.fetch_my_marketplace_products()is 'Batched seller-owned product projection including authoritative publication readiness; avoids client N+1 readiness reads.';
notify pgrst,'reload schema';
commit;
