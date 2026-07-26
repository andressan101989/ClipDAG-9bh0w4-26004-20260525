-- STREAM-B: atomically publish and unlink Cloudflare Stream feed videos.

create unique index video_asset_links_one_feed_post_per_asset_idx
  on public.video_asset_links(asset_id)
  where entity_type = 'video_post' and slot = 'video';

create or replace function public.publish_stream_video_post(
  p_asset_id uuid,
  p_caption text,
  p_music text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_asset public.video_assets%rowtype;
  v_existing_link public.video_asset_links%rowtype;
  v_video_id uuid;
  v_caption text := btrim(coalesce(p_caption, ''));
  v_music text := coalesce(nullif(btrim(p_music), ''), 'Sin musica');
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_asset_id is null then
    raise exception 'invalid_asset_id' using errcode = '22023';
  end if;
  if v_caption = '' or char_length(v_caption) > 300 then
    raise exception 'invalid_caption' using errcode = '22023';
  end if;
  if char_length(v_music) > 300 then
    raise exception 'invalid_music' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_asset_id::text, 0));

  select *
    into v_asset
    from public.video_assets
   where id = p_asset_id
   for update;

  if not found
     or v_asset.owner_id <> v_user_id
     or v_asset.provider <> 'cloudflare_stream'
     or v_asset.purpose <> 'feed_video'
     or v_asset.visibility <> 'public'
     or v_asset.status <> 'ready'
     or v_asset.deleted_at is not null
     or nullif(btrim(v_asset.cloudflare_uid), '') is null
     or v_asset.hls_url is null
     or v_asset.hls_url !~ '^https://'
     or (v_asset.thumbnail_url is not null and v_asset.thumbnail_url !~ '^https://')
     or v_asset.duration_seconds is null
     or v_asset.duration_seconds <= 0
     or v_asset.duration_seconds > v_asset.max_duration_seconds then
    raise exception 'stream_asset_not_ready_or_owned' using errcode = '42501';
  end if;

  select *
    into v_existing_link
    from public.video_asset_links
   where asset_id = p_asset_id
     and entity_type = 'video_post'
     and slot = 'video'
   limit 1;

  if found then
    select id
      into v_video_id
      from public.videos
     where id = v_existing_link.entity_id
       and user_id = v_user_id;
    if v_video_id is null or v_existing_link.owner_id <> v_user_id then
      raise exception 'stream_asset_link_conflict' using errcode = '23505';
    end if;
    return v_video_id;
  end if;

  if exists (
    select 1 from public.video_asset_links
     where asset_id = p_asset_id
  ) then
    raise exception 'stream_asset_link_conflict' using errcode = '23505';
  end if;

  insert into public.videos(user_id, video_url, thumbnail_url, caption, music)
  values(v_user_id, v_asset.hls_url, coalesce(v_asset.thumbnail_url, ''), v_caption, v_music)
  returning id into v_video_id;

  insert into public.video_asset_links(
    asset_id, owner_id, entity_type, entity_id, slot, position
  ) values(
    p_asset_id, v_user_id, 'video_post', v_video_id, 'video', 0
  );

  return v_video_id;
end;
$$;

create or replace function public.delete_stream_video_post(
  p_video_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_asset_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_video_id is null then
    raise exception 'invalid_video_id' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_video_id::text, 0));

  if not exists (
    select 1 from public.videos
     where id = p_video_id and user_id = v_user_id
     for update
  ) then
    raise exception 'video_not_found_or_owned' using errcode = '42501';
  end if;

  select asset_id
    into v_asset_id
    from public.video_asset_links
   where entity_type = 'video_post'
     and entity_id = p_video_id
     and slot = 'video'
     and owner_id = v_user_id
   limit 1;

  if v_asset_id is null then
    return null;
  end if;

  perform 1 from public.video_assets where id = v_asset_id for update;

  delete from public.videos
   where id = p_video_id and user_id = v_user_id;

  delete from public.video_asset_links
   where asset_id = v_asset_id
     and entity_type = 'video_post'
     and entity_id = p_video_id
     and slot = 'video'
     and owner_id = v_user_id;

  update public.video_assets
     set status = case when status = 'deleted' then status else 'delete_pending' end,
         hls_url = null,
         dash_url = null,
         thumbnail_url = null,
         next_cleanup_attempt_at = case when status = 'deleted' then null else now() end,
         error_code = null,
         error_message = null
   where id = v_asset_id
     and owner_id = v_user_id;

  return v_asset_id;
end;
$$;

revoke all on function public.publish_stream_video_post(uuid,text,text)
  from public, anon;
grant execute on function public.publish_stream_video_post(uuid,text,text)
  to authenticated, service_role;

revoke all on function public.delete_stream_video_post(uuid)
  from public, anon;
grant execute on function public.delete_stream_video_post(uuid)
  to authenticated, service_role;

comment on function public.publish_stream_video_post(uuid,text,text) is
  'Atomically publishes one ready Cloudflare Stream feed asset and its authoritative link.';
comment on function public.delete_stream_video_post(uuid) is
  'Atomically removes a Stream-backed feed post and schedules its asset for provider deletion.';
