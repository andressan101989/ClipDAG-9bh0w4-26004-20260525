begin;
create or replace function public.fetch_marketplace_product_media(p_product_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(jsonb_build_object('kind',case when a.purpose='product_video'then'video'else'image'end,'url',a.public_url,'duration_ms',a.duration_ms,'mime_type',a.mime_type,'position',l.position,'is_cover',l.is_cover) order by case when a.purpose='product_image'then 0 else 1 end,l.position),'[]'::jsonb)
 from public.products p join public.marketplace_stores s on s.id=p.store_id join public.marketplace_categories c on c.id=p.category_id
 join public.media_asset_links l on l.entity_type='shop_product'and l.entity_id=p.id
 join public.media_assets a on a.id=l.asset_id
 where p.id=p_product_id and p.status='active'and p.moderation_status='approved'and p.deleted_at is null
 and public.marketplace_seller_is_approved(p.seller_id)and s.status='active'and c.status='active'
 and a.status='ready'and a.visibility='public'and a.purpose in('product_image','product_video')and a.public_url is not null
$$;
revoke all on function public.fetch_marketplace_product_media(uuid)from public;
grant execute on function public.fetch_marketplace_product_media(uuid)to anon,authenticated,service_role;
commit;
