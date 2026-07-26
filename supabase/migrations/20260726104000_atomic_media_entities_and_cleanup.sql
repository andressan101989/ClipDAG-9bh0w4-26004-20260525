begin;

-- Expired stories and links whose authoritative entity disappeared must enter
-- the same retryable R2 deletion lifecycle as all other media.
create or replace function public.cleanup_stale_media_upload_records(p_limit integer default 50)
returns table(id uuid, bucket_name text, object_key text, cleanup_attempts integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.media_assets a
  set status = 'delete_pending',
      error_code = 'story_expired',
      next_cleanup_attempt_at = coalesce(a.next_cleanup_attempt_at, now()),
      updated_at = now()
  where a.status = 'ready'
    and exists (
      select 1
      from public.media_asset_links l
      join public.stories s on s.id = l.entity_id
      where l.asset_id = a.id
        and l.entity_type = 'story'
        and s.expires_at <= now()
    );

  delete from public.media_asset_links l
  using public.stories s
  where l.entity_type = 'story'
    and l.entity_id = s.id
    and s.expires_at <= now();

  delete from public.stories where expires_at <= now();

  update public.media_assets a
  set status = 'delete_pending',
      error_code = 'linked_entity_missing',
      next_cleanup_attempt_at = coalesce(a.next_cleanup_attempt_at, now()),
      updated_at = now()
  where a.status = 'ready'
    and exists (
      select 1
      from public.media_asset_links l
      where l.asset_id = a.id
        and (
          (l.entity_type = 'video_post'
            and not exists (select 1 from public.videos v where v.id = l.entity_id))
          or (l.entity_type = 'story'
            and not exists (select 1 from public.stories s where s.id = l.entity_id))
          or (l.entity_type = 'shop_product'
            and not exists (
              select 1 from public.products p
              where p.id = l.entity_id and p.status <> 'deleted'
            ))
        )
    );

  delete from public.media_asset_links l
  where (l.entity_type = 'video_post'
      and not exists (select 1 from public.videos v where v.id = l.entity_id))
     or (l.entity_type = 'story'
      and not exists (select 1 from public.stories s where s.id = l.entity_id))
     or (l.entity_type = 'shop_product'
      and not exists (
        select 1 from public.products p
        where p.id = l.entity_id and p.status <> 'deleted'
      ));

  update public.media_assets a
  set status = 'delete_pending',
      error_code = 'upload_expired',
      next_cleanup_attempt_at = coalesce(a.next_cleanup_attempt_at, now()),
      updated_at = now()
  where a.status in ('pending', 'uploading')
    and a.created_at < now() - interval '1 hour';

  update public.media_assets a
  set status = 'delete_pending',
      error_code = 'orphan_ready',
      next_cleanup_attempt_at = coalesce(a.next_cleanup_attempt_at, now()),
      updated_at = now()
  where a.status = 'ready'
    and a.created_at < now() - interval '24 hours'
    and not exists (
      select 1 from public.media_asset_links l where l.asset_id = a.id
    );

  return query
  with claimed as (
    select a.id
    from public.media_assets a
    where a.status = 'delete_pending'
      and coalesce(a.next_cleanup_attempt_at, now()) <= now()
    order by coalesce(a.next_cleanup_attempt_at, a.created_at), a.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  )
  update public.media_assets a
  set cleanup_attempts = a.cleanup_attempts + 1,
      last_cleanup_attempt_at = now(),
      next_cleanup_attempt_at = now() + make_interval(
        secs => least(21600, 30 * power(2, least(a.cleanup_attempts, 9))::integer)
      ),
      updated_at = now()
  from claimed c
  where a.id = c.id
  returning a.id, a.bucket_name, a.object_key, a.cleanup_attempts;
end;
$$;

revoke all on function public.cleanup_stale_media_upload_records(integer)
  from public, anon, authenticated;
grant execute on function public.cleanup_stale_media_upload_records(integer)
  to service_role;

-- The previous five-argument carousel RPC cannot guarantee media links.
revoke execute on function public.create_carousel_post(text,text,text,text,text[])
  from public, anon, authenticated;

create or replace function public.create_carousel_post(
  p_video_url text,
  p_thumbnail_url text,
  p_caption text,
  p_music text,
  p_media_urls text[],
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
begin
  if v_user_id is null then raise exception using errcode='42501', message='not_authenticated'; end if;
  if v_count not between 2 and 10
     or v_count <> coalesce(array_length(p_media_urls, 1), 0) then
    raise exception using errcode='22023', message='invalid_media_count';
  end if;
  if (select count(distinct id) from unnest(p_asset_ids) id) <> v_count then
    raise exception using errcode='22023', message='duplicate_asset';
  end if;
  if exists (select 1 from unnest(p_media_urls) url where url is null or btrim(url) !~* '^https://') then
    raise exception using errcode='22023', message='invalid_media_url';
  end if;
  if p_video_url is distinct from p_media_urls[1]
     or p_thumbnail_url is distinct from p_media_urls[1] then
    raise exception using errcode='22023', message='cover_must_match_first_media';
  end if;
  if (select count(*) from public.media_assets a
      where a.id = any(p_asset_ids)
        and a.owner_id = v_user_id
        and a.status = 'ready'
        and a.visibility = 'public'
        and a.purpose = 'carousel_image') <> v_count then
    raise exception using errcode='42501', message='asset_not_ready_or_owned';
  end if;

  insert into public.videos(user_id,video_url,thumbnail_url,caption,music,media_urls)
  values(v_user_id,p_video_url,p_thumbnail_url,coalesce(p_caption,''),
         coalesce(nullif(btrim(p_music),''),'Sin musica'),p_media_urls)
  returning id into v_post_id;

  insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
  select p_asset_ids[i], 'video_post', v_post_id, 'media', i - 1
  from generate_subscripts(p_asset_ids, 1) i;

  return v_post_id;
end;
$$;

create or replace function public.create_photo_story_with_media(
  p_media_urls text[],
  p_asset_ids uuid[]
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_story_id uuid;
begin
  if v_user_id is null then raise exception using errcode='42501', message='not_authenticated'; end if;
  if coalesce(array_length(p_asset_ids,1),0) <> 1
     or coalesce(array_length(p_media_urls,1),0) <> 1 then
    raise exception using errcode='22023', message='invalid_media_count';
  end if;
  if p_media_urls[1] is null or btrim(p_media_urls[1]) !~* '^https://' then
    raise exception using errcode='22023', message='invalid_media_url';
  end if;
  perform 1 from public.media_assets
  where id=p_asset_ids[1] and owner_id=v_user_id and status='ready'
    and visibility='public' and purpose='post_image';
  if not found then raise exception using errcode='42501', message='asset_not_ready_or_owned'; end if;

  insert into public.stories(user_id,media_url,media_type)
  values(v_user_id,p_media_urls[1],'photo')
  returning id into v_story_id;

  insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
  values(p_asset_ids[1],'story',v_story_id,'media',0);
  return v_story_id;
end;
$$;

create or replace function public.create_product_with_media(
  p_title text,
  p_description text,
  p_price numeric,
  p_category text,
  p_media_urls text[],
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
begin
  if v_user_id is null then raise exception using errcode='42501', message='not_authenticated'; end if;
  if v_count > 4 or v_count <> coalesce(array_length(p_media_urls,1),0) then
    raise exception using errcode='22023', message='invalid_media_count';
  end if;
  if (select count(distinct id) from unnest(p_asset_ids) id) <> v_count then
    raise exception using errcode='22023', message='duplicate_asset';
  end if;
  if exists (select 1 from unnest(p_media_urls) url where url is null or btrim(url) !~* '^https://') then
    raise exception using errcode='22023', message='invalid_media_url';
  end if;
  if (select count(*) from public.media_assets a
      where a.id = any(p_asset_ids)
        and a.owner_id = v_user_id
        and a.status = 'ready'
        and a.visibility = 'public'
        and a.purpose = 'product_image') <> v_count then
    raise exception using errcode='42501', message='asset_not_ready_or_owned';
  end if;

  insert into public.products(
    seller_id,title,description,price,currency,category,images,stock,tags
  ) values(
    v_user_id,p_title,coalesce(p_description,''),p_price,'BDAG',p_category,
    coalesce(p_media_urls,'{}'::text[]),p_stock,coalesce(p_tags,'{}'::text[])
  ) returning id into v_product_id;

  insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
  select p_asset_ids[i], 'shop_product', v_product_id, 'image', i - 1
  from generate_subscripts(p_asset_ids, 1) i;
  return v_product_id;
end;
$$;

-- Compensation for a just-created exclusive listing. It can only remove the
-- caller's recent, unpurchased row and is not a general content-delete API.
create or replace function public.cancel_unpublished_exclusive_content(p_content_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_count integer;
begin
  if auth.uid() is null then raise exception using errcode='42501', message='not_authenticated'; end if;
  delete from public.exclusive_content e
  where e.id = p_content_id
    and e.creator_id = auth.uid()
    and e.created_at > now() - interval '15 minutes'
    and not exists (
      select 1 from public.content_purchases p where p.content_id = e.id
    );
  get diagnostics v_deleted_count = row_count;
  return v_deleted_count > 0;
end;
$$;

revoke all on function public.create_carousel_post(text,text,text,text,text[],uuid[])
  from public, anon;
grant execute on function public.create_carousel_post(text,text,text,text,text[],uuid[])
  to authenticated, service_role;
revoke all on function public.create_photo_story_with_media(text[],uuid[])
  from public, anon;
grant execute on function public.create_photo_story_with_media(text[],uuid[])
  to authenticated, service_role;
revoke all on function public.create_product_with_media(text,text,numeric,text,text[],uuid[],integer,text[])
  from public, anon;
grant execute on function public.create_product_with_media(text,text,numeric,text,text[],uuid[],integer,text[])
  to authenticated, service_role;
revoke all on function public.cancel_unpublished_exclusive_content(uuid)
  from public, anon;
grant execute on function public.cancel_unpublished_exclusive_content(uuid)
  to authenticated, service_role;

comment on function public.create_carousel_post(text,text,text,text,text[],uuid[])
  is 'Atomically creates an authenticated carousel and its ordered R2 links.';
comment on function public.create_photo_story_with_media(text[],uuid[])
  is 'Atomically creates one authenticated photo story and its R2 link.';
comment on function public.create_product_with_media(text,text,numeric,text,text[],uuid[],integer,text[])
  is 'Atomically creates a BDAG catalog product and ordered R2 image links.';

notify pgrst, 'reload schema';
commit;
