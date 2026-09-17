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
  v_owner_id uuid;
  image_count int:=coalesce(pg_catalog.array_length(p_image_asset_ids,1),0);
  urls text[]:='{}';
  old_ids uuid[];
begin
  if actor is null then raise exception using errcode='42501',message='marketplace_authentication_required';end if;
  select p.seller_id into v_owner_id from public.products p where p.id=p_product_id and p.deleted_at is null for update;
  if v_owner_id is null then raise exception using errcode='42501',message='marketplace_product_not_editable';end if;
  perform private.business_require_capability(v_owner_id,'business.catalog.manage');
  if not(private.business_actor_has_capability(v_owner_id,'business.media.read')
    or private.business_actor_has_capability(v_owner_id,'business.media.manage')) then
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
    where a.owner_id=v_owner_id and a.status='ready' and a.visibility='public'
      and a.media_kind='image' and a.purpose in('product_image','business_library') and a.public_url is not null;
    if coalesce(pg_catalog.array_length(urls,1),0)<>image_count then
      raise exception using errcode='42501',message='marketplace_product_media_not_ready';
    end if;
  end if;
  if p_video_asset_id is not null and not exists(
    select 1 from public.media_assets a where a.id=p_video_asset_id and a.owner_id=v_owner_id
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
    and a.id is distinct from p_video_asset_id and a.owner_id=v_owner_id and a.status='ready'
    and a.purpose<>'business_library'
    and not exists(select 1 from public.media_asset_links l where l.asset_id=a.id);
  return pg_catalog.jsonb_build_object('image_count',image_count,'cover_asset_id',p_cover_asset_id,'video_asset_id',p_video_asset_id);
end;
$function$;
