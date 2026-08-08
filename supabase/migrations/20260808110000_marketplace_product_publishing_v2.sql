begin;

alter table public.products
  add column if not exists editor_session_key uuid,
  add column if not exists editor_saved_at timestamptz;

create unique index if not exists products_seller_editor_session_key_uidx
  on public.products(seller_id,editor_session_key)
  where editor_session_key is not null and deleted_at is null;

alter table public.media_asset_links
  add column if not exists is_cover boolean not null default false;

create unique index if not exists marketplace_product_one_cover_uidx
  on public.media_asset_links(entity_id)
  where entity_type='shop_product' and slot='image' and is_cover;

create or replace function public.create_or_resume_marketplace_product_draft(
  p_store_id uuid,p_category_id uuid,p_editor_session_key uuid
) returns uuid language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();result uuid;slug text;variant_id uuid;draft_sku text;
begin
 if actor is null then raise exception using errcode='42501',message='marketplace_authentication_required';end if;
 if p_editor_session_key is null then raise exception using errcode='22023',message='marketplace_draft_key_invalid';end if;
 select id into result from public.products where seller_id=actor and editor_session_key=p_editor_session_key and deleted_at is null;
 if result is not null then return result;end if;
 if not public.marketplace_seller_is_approved(actor)then raise exception using errcode='42501',message='marketplace_seller_not_approved';end if;
 perform 1 from public.marketplace_stores where id=p_store_id and seller_id=actor and status='active' for update;
 if not found then raise exception using errcode='42501',message='marketplace_store_inactive';end if;
 select c.slug into slug from public.marketplace_categories c where c.id=p_category_id and c.status='active';
 if slug is null then raise exception using errcode='22023',message='marketplace_category_inactive';end if;
 insert into public.products(seller_id,store_id,title,description,price,currency,category,category_id,images,stock,status,
  tags,product_type,moderation_status,editor_session_key,editor_saved_at)
 values(actor,p_store_id,'Producto sin titulo','',1,'BDAG',slug,p_category_id,'{}',0,'paused','{}','physical','approved',
  p_editor_session_key,now()) returning id into result;
 draft_sku:='DRAFT-'||upper(substr(replace(result::text,'-',''),1,12));
 insert into public.marketplace_product_variants(product_id,store_id,seller_id,sku,sku_normalized,title,price,status,is_default,combination_key)
 values(result,p_store_id,actor,draft_sku,draft_sku,'Predeterminada',1,'active',true,'')returning id into variant_id;
 insert into public.marketplace_inventory_levels(variant_id,on_hand,reserved,low_stock_threshold)values(variant_id,0,0,0);
 return result;
exception when unique_violation then
 select id into result from public.products where seller_id=actor and editor_session_key=p_editor_session_key and deleted_at is null;
 if result is null then raise;end if;return result;
end$$;

create or replace function public.save_my_marketplace_product_draft(
 p_product_id uuid,p_category_id uuid,p_title text,p_description text,p_price numeric,p_brand text,
 p_compare_at_price numeric,p_stock integer,p_tags text[],p_shipping_profile_id uuid,p_product_type text
)returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();slug text;normalized_price numeric(20,8);normalized_compare_price numeric(20,8);row_status text;
begin
 if actor is null then raise exception using errcode='42501',message='marketplace_authentication_required';end if;
 perform 1 from public.products p join public.marketplace_stores s on s.id=p.store_id
  where p.id=p_product_id and p.seller_id=actor and p.deleted_at is null and s.seller_id=actor and s.status='active' for update of p;
 if not found then raise exception using errcode='42501',message='marketplace_product_not_editable';end if;
 select c.slug into slug from public.marketplace_categories c where c.id=p_category_id and c.status='active';
 if slug is null then raise exception using errcode='22023',message='marketplace_category_inactive';end if;
 if char_length(btrim(coalesce(p_title,'')))not between 1 and 80 or char_length(coalesce(p_description,''))>2000
  or p_stock is null or p_stock<0 or p_product_type not in('physical','digital')then
  raise exception using errcode='22023',message='marketplace_product_fields_invalid';end if;
 normalized_price:=public.marketplace_normalize_price(p_price);
 if p_compare_at_price is not null then normalized_compare_price:=public.marketplace_normalize_price(p_compare_at_price);
  if normalized_compare_price<normalized_price then raise exception using errcode='22023',message='marketplace_compare_price_invalid';end if;end if;
 if p_product_type='physical'and p_shipping_profile_id is not null and not exists(
  select 1 from public.marketplace_shipping_profiles sp join public.products p on p.store_id=sp.store_id
  where p.id=p_product_id and sp.id=p_shipping_profile_id and sp.seller_id=actor)then
  raise exception using errcode='42501',message='marketplace_shipping_profile_not_owned';end if;
 update public.products set category_id=p_category_id,category=slug,title=btrim(p_title),description=coalesce(p_description,''),
  price=normalized_price,brand=nullif(btrim(p_brand),''),compare_at_price=normalized_compare_price,stock=p_stock,tags=coalesce(p_tags,'{}'),
  shipping_profile_id=case when p_product_type='physical'then p_shipping_profile_id else null end,
  product_type=p_product_type,editor_saved_at=now(),updated_at=now() where id=p_product_id returning status into row_status;
 return jsonb_build_object('id',p_product_id,'status',row_status,'saved_at',now());
end$$;

create or replace function public.set_my_marketplace_product_media_v2(
 p_product_id uuid,p_image_asset_ids uuid[],p_cover_asset_id uuid,p_video_asset_id uuid default null
)returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid();image_count int:=coalesce(array_length(p_image_asset_ids,1),0);urls text[]:='{}';old_ids uuid[];
begin
 if actor is null then raise exception using errcode='42501',message='marketplace_authentication_required';end if;
 perform 1 from public.products where id=p_product_id and seller_id=actor and deleted_at is null for update;
 if not found then raise exception using errcode='42501',message='marketplace_product_not_editable';end if;
 if image_count>5 or(select count(distinct x)from unnest(coalesce(p_image_asset_ids,'{}'))x)<>image_count then
  raise exception using errcode='22023',message='marketplace_product_image_limit';end if;
 if(image_count=0 and p_cover_asset_id is not null)or(image_count>0 and not(p_cover_asset_id=any(p_image_asset_ids)))then
  raise exception using errcode='22023',message='marketplace_product_cover_invalid';end if;
 perform id from public.media_assets where id=any(coalesce(p_image_asset_ids,'{}'))or id=p_video_asset_id order by id for update;
 if image_count>0 then
  select array_agg(a.public_url order by ids.ordinality)into urls from unnest(p_image_asset_ids)with ordinality ids(id,ordinality)
   join public.media_assets a on a.id=ids.id where a.owner_id=actor and a.status='ready'and a.visibility='public'
   and a.media_kind='image'and a.purpose='product_image'and a.public_url is not null;
  if coalesce(array_length(urls,1),0)<>image_count then raise exception using errcode='42501',message='marketplace_product_media_not_ready';end if;
 end if;
 if p_video_asset_id is not null and not exists(select 1 from public.media_assets a where a.id=p_video_asset_id and a.owner_id=actor
  and a.status='ready'and a.visibility='public'and a.media_kind='video'and a.purpose='product_video'
  and a.mime_type in('video/mp4','video/quicktime')and a.duration_ms between 1 and 60000 and a.public_url is not null)then
  raise exception using errcode='22023',message='marketplace_product_video_invalid';end if;
 select coalesce(array_agg(asset_id),'{}')into old_ids from public.media_asset_links where entity_type='shop_product'and entity_id=p_product_id and slot in('image','video');
 delete from public.media_asset_links where entity_type='shop_product'and entity_id=p_product_id and slot in('image','video');
 insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position,is_cover)
 select p_image_asset_ids[i],'shop_product',p_product_id,'image',i-1,p_image_asset_ids[i]=p_cover_asset_id from generate_subscripts(p_image_asset_ids,1)i;
 if p_video_asset_id is not null then insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position,is_cover)
  values(p_video_asset_id,'shop_product',p_product_id,'video',0,false);end if;
 update public.products set images=urls,editor_saved_at=now(),updated_at=now()where id=p_product_id;
 update public.media_assets a set status='delete_pending',error_code='product_media_unlinked',next_cleanup_attempt_at=coalesce(next_cleanup_attempt_at,now()),updated_at=now()
  where a.id=any(old_ids)and not(a.id=any(coalesce(p_image_asset_ids,'{}')))and a.id is distinct from p_video_asset_id
  and a.owner_id=actor and a.status='ready'and not exists(select 1 from public.media_asset_links l where l.asset_id=a.id);
 return jsonb_build_object('image_count',image_count,'cover_asset_id',p_cover_asset_id,'video_asset_id',p_video_asset_id);
end$$;

create or replace function public.fetch_my_marketplace_product_draft(p_product_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('product',to_jsonb(p)-'seller_id','media',coalesce((select jsonb_agg(jsonb_build_object(
  'asset_id',a.id,'url',a.public_url,'media_kind',a.media_kind,'purpose',a.purpose,'duration_ms',a.duration_ms,
  'slot',l.slot,'position',l.position,'is_cover',l.is_cover)order by l.slot,l.position)
  from public.media_asset_links l join public.media_assets a on a.id=l.asset_id where l.entity_type='shop_product'and l.entity_id=p.id),'[]'))
 from public.products p where p.id=p_product_id and p.seller_id=auth.uid()and p.deleted_at is null
$$;

revoke all on function public.create_or_resume_marketplace_product_draft(uuid,uuid,uuid),
 public.save_my_marketplace_product_draft(uuid,uuid,text,text,numeric,text,numeric,integer,text[],uuid,text),
 public.set_my_marketplace_product_media_v2(uuid,uuid[],uuid,uuid),public.fetch_my_marketplace_product_draft(uuid)from public,anon;
grant execute on function public.create_or_resume_marketplace_product_draft(uuid,uuid,uuid),
 public.save_my_marketplace_product_draft(uuid,uuid,text,text,numeric,text,numeric,integer,text[],uuid,text),
 public.set_my_marketplace_product_media_v2(uuid,uuid[],uuid,uuid),public.fetch_my_marketplace_product_draft(uuid)to authenticated,service_role;

comment on function public.create_or_resume_marketplace_product_draft(uuid,uuid,uuid)is 'Idempotently creates a private seller-owned paused product draft.';
comment on function public.set_my_marketplace_product_media_v2(uuid,uuid[],uuid,uuid)is 'Persists at most five ordered images, one explicit cover, and one validated <=60 second video.';
notify pgrst,'reload schema';
commit;
