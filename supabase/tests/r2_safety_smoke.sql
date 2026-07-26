begin;

do $smoke$
declare
  v_user uuid;
  v_photo uuid := gen_random_uuid();
  v_carousel uuid[] := array[gen_random_uuid(),gen_random_uuid()];
  v_story uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_avatar uuid := gen_random_uuid();
  v_entity uuid;
  v_url text;
begin
  select id into v_user from public.user_profiles order by created_at limit 1;
  if v_user is null then raise exception 'smoke_user_missing'; end if;
  perform set_config('request.jwt.claim.sub',v_user::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);

  insert into public.media_assets(
    id,owner_id,provider,media_kind,purpose,visibility,bucket_name,object_key,
    mime_type,size_bytes,status,ready_at,public_url
  ) values
    (v_photo,v_user,'r2','image','post_image','public','clipdag-public-media','diagnostics/'||v_photo||'.jpg','image/jpeg',1,'ready',now(),'https://diagnostics.invalid/'||v_photo),
    (v_carousel[1],v_user,'r2','image','carousel_image','public','clipdag-public-media','diagnostics/'||v_carousel[1]||'.jpg','image/jpeg',1,'ready',now(),'https://diagnostics.invalid/'||v_carousel[1]),
    (v_carousel[2],v_user,'r2','image','carousel_image','public','clipdag-public-media','diagnostics/'||v_carousel[2]||'.jpg','image/jpeg',1,'ready',now(),'https://diagnostics.invalid/'||v_carousel[2]),
    (v_story,v_user,'r2','image','post_image','public','clipdag-public-media','diagnostics/'||v_story||'.jpg','image/jpeg',1,'ready',now(),'https://diagnostics.invalid/'||v_story),
    (v_product,v_user,'r2','image','product_image','public','clipdag-public-media','diagnostics/'||v_product||'.jpg','image/jpeg',1,'ready',now(),'https://diagnostics.invalid/'||v_product),
    (v_avatar,v_user,'r2','image','avatar','public','clipdag-public-media','diagnostics/'||v_avatar||'.jpg','image/jpeg',1,'ready',now(),'https://diagnostics.invalid/'||v_avatar);

  v_entity := public.create_photo_post_with_media('diagnostic','Sin musica',v_photo);
  if not exists(select 1 from public.media_asset_links where asset_id=v_photo and entity_id=v_entity) then
    raise exception 'photo_link_missing';
  end if;
  if public.schedule_media_asset_deletion(v_photo,v_user) <> 'asset_in_use' then
    raise exception 'linked_photo_not_protected';
  end if;

  v_entity := public.create_carousel_post('diagnostic','Sin musica',v_carousel);
  if (select count(*) from public.media_asset_links where entity_id=v_entity) <> 2 then
    raise exception 'carousel_links_missing';
  end if;

  v_entity := public.create_photo_story_with_media(v_story);
  if not exists(select 1 from public.media_asset_links where asset_id=v_story and entity_id=v_entity) then
    raise exception 'story_link_missing';
  end if;

  v_entity := public.create_product_with_media(
    'Diagnostic','Rollback-only',1,'other',array[v_product],1,'{}'::text[]
  );
  if not exists(select 1 from public.media_asset_links where asset_id=v_product and entity_id=v_entity) then
    raise exception 'product_link_missing';
  end if;

  v_url := public.set_profile_avatar_with_media(v_avatar);
  if v_url <> 'https://diagnostics.invalid/'||v_avatar then
    raise exception 'avatar_url_mismatch';
  end if;
end
$smoke$;

rollback;
