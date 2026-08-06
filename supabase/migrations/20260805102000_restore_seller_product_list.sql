begin;

create or replace function public.fetch_my_marketplace_products()
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  actor uuid:=auth.uid();
  result jsonb;
begin
  if actor is null then
    raise exception using errcode='42501',message='marketplace_authentication_required';
  end if;

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
    'seller',jsonb_build_object('username',u.username,'avatar_url',u.avatar_url,'display_name',u.display_name)
  ) order by p.updated_at desc),'[]'::jsonb) into result
  from public.products p
  join public.marketplace_stores s on s.id=p.store_id and s.seller_id=actor
  left join public.user_profiles u on u.id=p.seller_id
  left join lateral(
    select sum(greatest(i.on_hand-i.reserved,0))::int available_quantity
    from public.marketplace_product_variants v
    join public.marketplace_inventory_levels i on i.variant_id=v.id
    where v.product_id=p.id and v.status='active'
  )inv on true
  where p.seller_id=actor and p.deleted_at is null and p.status<>'deleted';
  return result;
end$$;

create or replace function public.fetch_public_marketplace_products(
  p_category text default null,
  p_seller_id uuid default null,
  p_search text default null,
  p_limit integer default 30,
  p_product_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare result jsonb;
begin
  select coalesce(jsonb_agg(row_data order by created_at desc),'[]'::jsonb) into result
  from(
    select jsonb_build_object(
      'id',p.id,'seller_id',p.seller_id,'store_id',p.store_id,'category_id',p.category_id,
      'title',p.title,'description',p.description,'price',p.price,'currency',p.currency,
      'category',p.category,'images',p.images,'stock',p.stock,'status',p.status,'tags',p.tags,
      'total_sales',p.total_sales,'brand',p.brand,'compare_at_price',p.compare_at_price,
      'product_type',p.product_type,'moderation_status',p.moderation_status,
      'published_at',p.published_at,'deleted_at',p.deleted_at,'created_at',p.created_at,
      'updated_at',p.updated_at,'variant_price_max',p.variant_price_max,
      'active_variant_count',p.active_variant_count,
      'seller',jsonb_build_object('username',u.username,'avatar_url',u.avatar_url,'display_name',u.display_name)
    )row_data,p.created_at
    from public.products p
    left join public.user_profiles u on u.id=p.seller_id
    join lateral public.marketplace_evaluate_live_product_readiness(p.id,p.seller_id) ready on ready.reason_code='ready'
    where p.status='active' and p.deleted_at is null and p.currency='BDAG'
      and not fixture_ops.is_fixture('product',p.id)
      and (p_product_id is null or p.id=p_product_id)
      and (p_category is null or p.category=p_category)
      and (p_seller_id is null or p.seller_id=p_seller_id)
      and (p_search is null or p.title ilike '%'||p_search||'%')
    order by p.created_at desc
    limit greatest(1,least(coalesce(p_limit,30),100))
  )visible;
  return result;
end$$;

revoke all on function public.fetch_my_marketplace_products() from public,anon;
grant execute on function public.fetch_my_marketplace_products() to authenticated,service_role;
revoke all on function public.fetch_public_marketplace_products(text,uuid,text,integer,uuid) from public;
grant execute on function public.fetch_public_marketplace_products(text,uuid,text,integer,uuid) to anon,authenticated,service_role;

commit;
