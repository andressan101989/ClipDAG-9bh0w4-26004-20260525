begin;

create or replace function public.finalize_media_asset_deletion(
  p_asset_id uuid,
  p_owner_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status
  from public.media_assets
  where id=p_asset_id and owner_id=p_owner_id
  for update;

  if not found or v_status <> 'delete_pending' then return false; end if;
  if public.media_asset_has_valid_links(p_asset_id) then return false; end if;

  delete from public.media_asset_links where asset_id=p_asset_id;
  update public.media_assets
  set status='deleted',
      deleted_at=coalesce(deleted_at,now()),
      error_code=null,
      cleanup_attempts=cleanup_attempts+1,
      last_cleanup_attempt_at=now(),
      next_cleanup_attempt_at=null,
      updated_at=now()
  where id=p_asset_id and owner_id=p_owner_id and status='delete_pending';
  return found;
end;
$$;

create or replace function public.link_media_asset(
  p_asset_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_slot text,
  p_position integer default 0
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_authorized boolean := false;
  v_asset_valid boolean := false;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_entity_type not in ('user_profile','video_post','story','shop_product') then
    raise exception 'invalid_entity_type';
  end if;
  if p_position < 0 then raise exception 'invalid_position'; end if;

  perform id from public.media_assets where id=p_asset_id for update;
  select exists(
    select 1 from public.media_assets
    where id=p_asset_id
      and owner_id=auth.uid()
      and status='ready'
      and visibility='public'
      and public_url is not null
      and (
        (p_entity_type='user_profile' and purpose='avatar')
        or (p_entity_type='video_post' and purpose in ('post_image','carousel_image'))
        or (p_entity_type='story' and purpose='post_image')
        or (p_entity_type='shop_product' and purpose='product_image')
      )
  ) into v_asset_valid;
  if not v_asset_valid then raise exception 'asset_not_ready_or_owned'; end if;

  case p_entity_type
    when 'user_profile' then
      v_authorized := p_entity_id=auth.uid();
    when 'video_post' then
      select exists(select 1 from public.videos where id=p_entity_id and user_id=auth.uid())
      into v_authorized;
    when 'story' then
      select exists(select 1 from public.stories where id=p_entity_id and user_id=auth.uid())
      into v_authorized;
    when 'shop_product' then
      select exists(select 1 from public.products where id=p_entity_id and seller_id=auth.uid())
      into v_authorized;
  end case;
  if not v_authorized then raise exception 'entity_not_owned'; end if;

  insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
  values(p_asset_id,p_entity_type,p_entity_id,p_slot,p_position)
  on conflict(asset_id,entity_type,entity_id,slot,position)
  do update set slot=excluded.slot
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.create_carousel_post(
  p_caption text,
  p_music text,
  p_asset_ids uuid[]
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_post_id uuid;
  v_count integer := coalesce(array_length(p_asset_ids,1),0);
  v_urls text[];
begin
  if v_user_id is null then raise exception using errcode='42501',message='not_authenticated'; end if;
  if v_count not between 2 and 10 then
    raise exception using errcode='22023',message='invalid_media_count';
  end if;
  if (select count(distinct id) from unnest(p_asset_ids) id)<>v_count then
    raise exception using errcode='22023',message='duplicate_asset';
  end if;

  perform a.id
  from public.media_assets a
  where a.id=any(p_asset_ids)
  order by a.id
  for update;

  select array_agg(a.public_url order by ids.ordinality)
  into v_urls
  from unnest(p_asset_ids) with ordinality ids(id,ordinality)
  join public.media_assets a on a.id=ids.id
  where a.owner_id=v_user_id and a.status='ready' and a.visibility='public'
    and a.purpose='carousel_image' and a.public_url is not null;
  if coalesce(array_length(v_urls,1),0)<>v_count then
    raise exception using errcode='42501',message='asset_not_ready_or_owned';
  end if;

  insert into public.videos(user_id,video_url,thumbnail_url,caption,music,media_urls)
  values(v_user_id,v_urls[1],v_urls[1],coalesce(p_caption,''),
         coalesce(nullif(btrim(p_music),''),'Sin musica'),v_urls)
  returning id into v_post_id;
  insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
  select p_asset_ids[i],'video_post',v_post_id,'media',i-1
  from generate_subscripts(p_asset_ids,1) i;
  return v_post_id;
end;
$$;

create or replace function public.create_photo_post_with_media(
  p_caption text,
  p_music text,
  p_asset_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_post_id uuid;
  v_url text;
begin
  if v_user_id is null then raise exception using errcode='42501',message='not_authenticated'; end if;
  perform id from public.media_assets where id=p_asset_id for update;
  select public_url into v_url
  from public.media_assets
  where id=p_asset_id and owner_id=v_user_id and status='ready'
    and visibility='public' and purpose='post_image' and public_url is not null;
  if v_url is null then raise exception using errcode='42501',message='asset_not_ready_or_owned'; end if;

  insert into public.videos(user_id,video_url,thumbnail_url,caption,music)
  values(v_user_id,v_url,v_url,coalesce(p_caption,''),
         coalesce(nullif(btrim(p_music),''),'Sin musica'))
  returning id into v_post_id;
  insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
  values(p_asset_id,'video_post',v_post_id,'media',0);
  return v_post_id;
end;
$$;

create or replace function public.create_photo_story_with_media(p_asset_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_story_id uuid;
  v_url text;
begin
  if v_user_id is null then raise exception using errcode='42501',message='not_authenticated'; end if;
  perform id from public.media_assets where id=p_asset_id for update;
  select public_url into v_url
  from public.media_assets
  where id=p_asset_id and owner_id=v_user_id and status='ready'
    and visibility='public' and purpose='post_image' and public_url is not null;
  if v_url is null then raise exception using errcode='42501',message='asset_not_ready_or_owned'; end if;

  insert into public.stories(user_id,media_url,media_type)
  values(v_user_id,v_url,'photo')
  returning id into v_story_id;
  insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
  values(p_asset_id,'story',v_story_id,'media',0);
  return v_story_id;
end;
$$;

create or replace function public.create_product_with_media(
  p_title text,
  p_description text,
  p_price numeric,
  p_category text,
  p_asset_ids uuid[],
  p_stock integer,
  p_tags text[]
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_product_id uuid;
  v_count integer := coalesce(array_length(p_asset_ids,1),0);
  v_urls text[] := '{}'::text[];
begin
  if v_user_id is null then raise exception using errcode='42501',message='not_authenticated'; end if;
  if v_count>4 then raise exception using errcode='22023',message='invalid_media_count'; end if;
  if (select count(distinct id) from unnest(p_asset_ids) id)<>v_count then
    raise exception using errcode='22023',message='duplicate_asset';
  end if;

  if v_count>0 then
    perform a.id
    from public.media_assets a
    where a.id=any(p_asset_ids)
    order by a.id
    for update;

    select array_agg(a.public_url order by ids.ordinality)
    into v_urls
    from unnest(p_asset_ids) with ordinality ids(id,ordinality)
    join public.media_assets a on a.id=ids.id
    where a.owner_id=v_user_id and a.status='ready' and a.visibility='public'
      and a.purpose='product_image' and a.public_url is not null;
    if coalesce(array_length(v_urls,1),0)<>v_count then
      raise exception using errcode='42501',message='asset_not_ready_or_owned';
    end if;
  end if;

  insert into public.products(
    seller_id,title,description,price,currency,category,images,stock,tags
  ) values(
    v_user_id,p_title,coalesce(p_description,''),p_price,'BDAG',p_category,
    v_urls,p_stock,coalesce(p_tags,'{}'::text[])
  ) returning id into v_product_id;
  insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
  select p_asset_ids[i],'shop_product',v_product_id,'image',i-1
  from generate_subscripts(p_asset_ids,1) i;
  return v_product_id;
end;
$$;

create or replace function public.set_profile_avatar_with_media(p_asset_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_url text;
  v_old_asset_ids uuid[];
begin
  if v_user_id is null then raise exception using errcode='42501',message='not_authenticated'; end if;
  perform id from public.media_assets where id=p_asset_id for update;
  select public_url into v_url
  from public.media_assets
  where id=p_asset_id and owner_id=v_user_id and status='ready'
    and visibility='public' and purpose='avatar' and public_url is not null;
  if v_url is null then raise exception using errcode='42501',message='asset_not_ready_or_owned'; end if;

  perform 1 from public.user_profiles where id=v_user_id for update;
  if not found then raise exception using errcode='23503',message='profile_not_found'; end if;
  select coalesce(array_agg(asset_id),'{}'::uuid[]) into v_old_asset_ids
  from public.media_asset_links
  where entity_type='user_profile' and entity_id=v_user_id
    and slot='avatar' and asset_id<>p_asset_id;

  update public.user_profiles set avatar_url=v_url where id=v_user_id;
  delete from public.media_asset_links
  where entity_type='user_profile' and entity_id=v_user_id and slot='avatar';
  insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
  values(p_asset_id,'user_profile',v_user_id,'avatar',0);
  update public.media_assets a
  set status='delete_pending',error_code='avatar_replaced',
      next_cleanup_attempt_at=coalesce(next_cleanup_attempt_at,now()),updated_at=now()
  where a.id=any(v_old_asset_ids) and a.status='ready'
    and not exists(select 1 from public.media_asset_links l where l.asset_id=a.id);
  return v_url;
end;
$$;

revoke all on function public.finalize_media_asset_deletion(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.finalize_media_asset_deletion(uuid,uuid)
  to service_role;
revoke all on function public.link_media_asset(uuid,text,uuid,text,integer)
  from public,anon;
grant execute on function public.link_media_asset(uuid,text,uuid,text,integer)
  to authenticated,service_role;

notify pgrst,'reload schema';
commit;
