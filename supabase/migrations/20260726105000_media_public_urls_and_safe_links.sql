begin;

alter table public.media_assets
  add column if not exists public_url text;

update public.media_assets
set public_url =
  'https://pub-d146e3d06d274db4871f5b6020fd850f.r2.dev/' ||
  replace(object_key, ' ', '%20'),
  updated_at = now()
where provider = 'r2'
  and visibility = 'public'
  and status = 'ready'
  and public_url is null;

alter table public.media_assets
  drop constraint if exists media_assets_ready_public_url_check;
alter table public.media_assets
  add constraint media_assets_ready_public_url_check
  check (
    provider <> 'r2'
    or visibility <> 'public'
    or status <> 'ready'
    or (public_url is not null and public_url ~ '^https://')
  );

create or replace function public.media_asset_has_valid_links(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.media_asset_links l
    join public.media_assets a on a.id = l.asset_id
    where l.asset_id = p_asset_id
      and (
        (
          l.entity_type = 'user_profile'
          and exists (
            select 1 from public.user_profiles u
            where u.id = l.entity_id
              and u.avatar_url = a.public_url
          )
        )
        or (
          l.entity_type = 'video_post'
          and exists (select 1 from public.videos v where v.id = l.entity_id)
        )
        or (
          l.entity_type = 'story'
          and exists (
            select 1 from public.stories s
            where s.id = l.entity_id and s.expires_at > now()
          )
        )
        or (
          l.entity_type = 'shop_product'
          and exists (
            select 1 from public.products p
            where p.id = l.entity_id and p.status <> 'deleted'
          )
        )
      )
  );
$$;

create or replace function public.finalize_media_asset_deletion(
  p_asset_id uuid,
  p_owner_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.media_assets
    where id = p_asset_id and owner_id = p_owner_id
  ) then
    return false;
  end if;

  delete from public.media_asset_links where asset_id = p_asset_id;
  update public.media_assets
  set status = 'deleted',
      deleted_at = coalesce(deleted_at, now()),
      error_code = null,
      cleanup_attempts = cleanup_attempts + 1,
      last_cleanup_attempt_at = now(),
      next_cleanup_attempt_at = null,
      updated_at = now()
  where id = p_asset_id
    and owner_id = p_owner_id;
  return found;
end;
$$;

create or replace function public.schedule_media_asset_deletion(
  p_asset_id uuid,
  p_owner_id uuid
) returns text
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
  if not found then return 'not_found'; end if;
  if v_status='deleted' then return 'deleted'; end if;
  if public.media_asset_has_valid_links(p_asset_id) then return 'asset_in_use'; end if;

  update public.media_assets
  set status='delete_pending',error_code=null,
      next_cleanup_attempt_at=now(),updated_at=now()
  where id=p_asset_id and owner_id=p_owner_id;
  return 'scheduled';
end;
$$;

revoke all on function public.media_asset_has_valid_links(uuid)
  from public, anon, authenticated;
grant execute on function public.media_asset_has_valid_links(uuid)
  to service_role;
revoke all on function public.finalize_media_asset_deletion(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_media_asset_deletion(uuid,uuid)
  to service_role;
revoke all on function public.schedule_media_asset_deletion(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.schedule_media_asset_deletion(uuid,uuid)
  to service_role;

-- Revoke every client-visible overload that accepted media URLs.
revoke execute on function public.create_carousel_post(text,text,text,text,text[])
  from public, anon, authenticated;
revoke execute on function public.create_carousel_post(text,text,text,text,text[],uuid[])
  from public, anon, authenticated;
revoke execute on function public.create_photo_story_with_media(text[],uuid[])
  from public, anon, authenticated;
revoke execute on function public.create_product_with_media(text,text,numeric,text,text[],uuid[],integer,text[])
  from public, anon, authenticated;

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
  v_count integer := coalesce(array_length(p_asset_ids, 1), 0);
  v_urls text[];
begin
  if v_user_id is null then raise exception using errcode='42501', message='not_authenticated'; end if;
  if v_count not between 2 and 10 then
    raise exception using errcode='22023', message='invalid_media_count';
  end if;
  if (select count(distinct id) from unnest(p_asset_ids) id) <> v_count then
    raise exception using errcode='22023', message='duplicate_asset';
  end if;

  select array_agg(a.public_url order by ids.ordinality)
  into v_urls
  from unnest(p_asset_ids) with ordinality ids(id, ordinality)
  join public.media_assets a on a.id = ids.id
  where a.owner_id = v_user_id
    and a.status = 'ready'
    and a.visibility = 'public'
    and a.purpose = 'carousel_image'
    and a.public_url is not null;
  if coalesce(array_length(v_urls,1),0) <> v_count then
    raise exception using errcode='42501', message='asset_not_ready_or_owned';
  end if;

  insert into public.videos(user_id,video_url,thumbnail_url,caption,music,media_urls)
  values(
    v_user_id,v_urls[1],v_urls[1],coalesce(p_caption,''),
    coalesce(nullif(btrim(p_music),''),'Sin musica'),v_urls
  )
  returning id into v_post_id;

  insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
  select p_asset_ids[i], 'video_post', v_post_id, 'media', i - 1
  from generate_subscripts(p_asset_ids, 1) i;
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
  if v_user_id is null then raise exception using errcode='42501', message='not_authenticated'; end if;
  select public_url into v_url
  from public.media_assets
  where id=p_asset_id and owner_id=v_user_id and status='ready'
    and visibility='public' and purpose='post_image' and public_url is not null;
  if v_url is null then raise exception using errcode='42501', message='asset_not_ready_or_owned'; end if;

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
  if v_user_id is null then raise exception using errcode='42501', message='not_authenticated'; end if;
  select public_url into v_url
  from public.media_assets
  where id=p_asset_id and owner_id=v_user_id and status='ready'
    and visibility='public' and purpose='post_image' and public_url is not null;
  if v_url is null then raise exception using errcode='42501', message='asset_not_ready_or_owned'; end if;

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
  if v_user_id is null then raise exception using errcode='42501', message='not_authenticated'; end if;
  if v_count > 4 then raise exception using errcode='22023', message='invalid_media_count'; end if;
  if (select count(distinct id) from unnest(p_asset_ids) id) <> v_count then
    raise exception using errcode='22023', message='duplicate_asset';
  end if;
  if v_count > 0 then
    select array_agg(a.public_url order by ids.ordinality)
    into v_urls
    from unnest(p_asset_ids) with ordinality ids(id, ordinality)
    join public.media_assets a on a.id = ids.id
    where a.owner_id=v_user_id and a.status='ready' and a.visibility='public'
      and a.purpose='product_image' and a.public_url is not null;
    if coalesce(array_length(v_urls,1),0) <> v_count then
      raise exception using errcode='42501', message='asset_not_ready_or_owned';
    end if;
  end if;

  insert into public.products(
    seller_id,title,description,price,currency,category,images,stock,tags
  ) values(
    v_user_id,p_title,coalesce(p_description,''),p_price,'BDAG',p_category,
    v_urls,p_stock,coalesce(p_tags,'{}'::text[])
  ) returning id into v_product_id;
  insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
  select p_asset_ids[i], 'shop_product', v_product_id, 'image', i - 1
  from generate_subscripts(p_asset_ids, 1) i;
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
  if v_user_id is null then raise exception using errcode='42501', message='not_authenticated'; end if;
  select public_url into v_url
  from public.media_assets
  where id=p_asset_id and owner_id=v_user_id and status='ready'
    and visibility='public' and purpose='avatar' and public_url is not null;
  if v_url is null then raise exception using errcode='42501', message='asset_not_ready_or_owned'; end if;

  perform 1 from public.user_profiles where id=v_user_id for update;
  if not found then raise exception using errcode='23503', message='profile_not_found'; end if;

  select coalesce(array_agg(asset_id), '{}'::uuid[]) into v_old_asset_ids
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

create or replace function public.cleanup_stale_media_upload_records(p_limit integer default 50)
returns table(id uuid, bucket_name text, object_key text, cleanup_attempts integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Remove expired story links first; a shared asset is queued only if no valid
  -- relationship remains.
  with removed as (
    delete from public.media_asset_links l
    using public.stories s
    where l.entity_type='story' and l.entity_id=s.id and s.expires_at<=now()
    returning l.asset_id
  )
  update public.media_assets a
  set status='delete_pending',error_code='story_expired',
      next_cleanup_attempt_at=coalesce(a.next_cleanup_attempt_at,now()),updated_at=now()
  where a.status='ready' and a.id in (select asset_id from removed)
    and not public.media_asset_has_valid_links(a.id);

  delete from public.stories where expires_at<=now();

  with removed as (
    delete from public.media_asset_links l
    using public.media_assets a
    where l.asset_id=a.id
      and (
        (l.entity_type='user_profile' and not exists(
          select 1 from public.user_profiles u
          where u.id=l.entity_id and u.avatar_url=a.public_url
        ))
        or (l.entity_type='video_post' and not exists(
          select 1 from public.videos v where v.id=l.entity_id
        ))
        or (l.entity_type='story' and not exists(
          select 1 from public.stories s where s.id=l.entity_id and s.expires_at>now()
        ))
        or (l.entity_type='shop_product' and not exists(
          select 1 from public.products p where p.id=l.entity_id and p.status<>'deleted'
        ))
        or a.status='deleted'
      )
    returning l.asset_id
  )
  update public.media_assets a
  set status='delete_pending',error_code='linked_entity_missing',
      next_cleanup_attempt_at=coalesce(a.next_cleanup_attempt_at,now()),updated_at=now()
  where a.status='ready' and a.id in (select asset_id from removed)
    and not public.media_asset_has_valid_links(a.id);

  update public.media_assets a
  set status='delete_pending',error_code='upload_expired',
      next_cleanup_attempt_at=coalesce(a.next_cleanup_attempt_at,now()),updated_at=now()
  where a.status in ('pending','uploading')
    and a.created_at<now()-interval '1 hour';

  update public.media_assets a
  set status='delete_pending',error_code='orphan_ready',
      next_cleanup_attempt_at=coalesce(a.next_cleanup_attempt_at,now()),updated_at=now()
  where a.status='ready' and a.created_at<now()-interval '24 hours'
    and not public.media_asset_has_valid_links(a.id);

  return query
  with claimed as (
    select a.id from public.media_assets a
    where a.status='delete_pending'
      and coalesce(a.next_cleanup_attempt_at,now())<=now()
      and not public.media_asset_has_valid_links(a.id)
    order by coalesce(a.next_cleanup_attempt_at,a.created_at),a.created_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,50),100))
  )
  update public.media_assets a
  set cleanup_attempts=a.cleanup_attempts+1,last_cleanup_attempt_at=now(),
      next_cleanup_attempt_at=now()+make_interval(
        secs=>least(21600,30*power(2,least(a.cleanup_attempts,9))::integer)
      ),updated_at=now()
  from claimed c where a.id=c.id
  returning a.id,a.bucket_name,a.object_key,a.cleanup_attempts;
end;
$$;

revoke all on function public.create_carousel_post(text,text,uuid[])
  from public, anon;
grant execute on function public.create_carousel_post(text,text,uuid[])
  to authenticated, service_role;
revoke all on function public.create_photo_post_with_media(text,text,uuid)
  from public, anon;
grant execute on function public.create_photo_post_with_media(text,text,uuid)
  to authenticated, service_role;
revoke all on function public.create_photo_story_with_media(uuid)
  from public, anon;
grant execute on function public.create_photo_story_with_media(uuid)
  to authenticated, service_role;
revoke all on function public.create_product_with_media(text,text,numeric,text,uuid[],integer,text[])
  from public, anon;
grant execute on function public.create_product_with_media(text,text,numeric,text,uuid[],integer,text[])
  to authenticated, service_role;
revoke all on function public.set_profile_avatar_with_media(uuid)
  from public, anon;
grant execute on function public.set_profile_avatar_with_media(uuid)
  to authenticated, service_role;
revoke all on function public.cleanup_stale_media_upload_records(integer)
  from public, anon, authenticated;
grant execute on function public.cleanup_stale_media_upload_records(integer)
  to service_role;

notify pgrst, 'reload schema';
commit;
