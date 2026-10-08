begin;

-- CREATOR-PREMIUM-B3
-- Extend the canonical Cloudflare Stream authority for private Premium video.
-- Feed and Business remain public, and Premium video never stores playback URLs.

alter table public.video_assets
  drop constraint video_assets_purpose_check,
  drop constraint video_assets_ready_invariants_check;

alter table public.video_assets
  add constraint video_assets_purpose_check check (
    purpose in ('feed_video','business_library','creator_premium_video')
  ),
  add constraint video_assets_creator_premium_contract_check check (
    purpose <> 'creator_premium_video'
    or (
      provider = 'cloudflare_stream'
      and visibility = 'private'
      and mime_type in ('video/mp4','video/quicktime','video/webm')
      and size_bytes between 1 and 200000000
      and max_duration_seconds between 1 and 60
    )
  ),
  add constraint video_assets_ready_invariants_check check (
    (
      status = 'ready'
      and cloudflare_uid is not null
      and pg_catalog.btrim(cloudflare_uid) <> ''
      and ready_at is not null
      and duration_seconds is not null
      and duration_seconds > 0
      and duration_seconds <= max_duration_seconds
      and (
        (
          purpose = 'creator_premium_video'
          and visibility = 'private'
          and hls_url is null
          and dash_url is null
          and thumbnail_url is null
          and (provider_metadata -> 'require_signed_urls' = 'true'::jsonb) is true
        )
        or (
          purpose <> 'creator_premium_video'
          and hls_url is not null
          and hls_url ~ '^https://'
          and (dash_url is null or dash_url ~ '^https://')
          and (thumbnail_url is null or thumbnail_url ~ '^https://')
        )
      )
    )
    or (
      status <> 'ready'
      and hls_url is null
      and dash_url is null
      and thumbnail_url is null
    )
  );

comment on constraint video_assets_creator_premium_contract_check on public.video_assets is
  'Premium Stream video is private, bounded to canonical MIME/size/duration limits, and uses the existing Cloudflare provider.';
comment on constraint video_assets_ready_invariants_check on public.video_assets is
  'Public ready Stream assets retain HTTPS playback URLs; Premium ready assets require signed-provider proof and persist no provider playback URL.';

alter table public.video_asset_links
  drop constraint video_asset_links_entity_type_check;

alter table public.video_asset_links
  add constraint video_asset_links_entity_type_check check (
    entity_type in (
      'video_post',
      'story',
      'exclusive_content',
      'ai_avatar',
      'creator_premium_content'
    )
  ),
  add constraint video_asset_links_creator_premium_shape_check check (
    entity_type <> 'creator_premium_content'
    or (slot = 'original' and "position" = 0)
  );

create unique index creator_premium_video_content_uidx
  on public.video_asset_links(entity_id)
  where entity_type = 'creator_premium_content'
    and slot = 'original'
    and "position" = 0;

create unique index creator_premium_video_asset_uidx
  on public.video_asset_links(asset_id)
  where entity_type = 'creator_premium_content';

create or replace function public.reserve_stream_upload_asset(
  p_asset_id uuid,
  p_owner_id uuid,
  p_mime_type text,
  p_size_bytes bigint,
  p_original_filename text,
  p_purpose text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recent_count integer;
  v_active_count integer;
begin
  if p_asset_id is null
     or p_owner_id is null
     or p_purpose not in ('feed_video','business_library','creator_premium_video') then
    raise exception using errcode = '22023', message = 'invalid_stream_reservation';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_owner_id::text, 0)
  );

  select count(*) into v_recent_count
  from public.video_assets asset
  where asset.owner_id = p_owner_id
    and asset.created_at >= pg_catalog.now() - interval '60 seconds';
  if v_recent_count >= 5 then
    return 'rate_limited';
  end if;

  select count(*) into v_active_count
  from public.video_assets asset
  where asset.owner_id = p_owner_id
    and asset.status in ('pending','uploading','processing');
  if v_active_count >= 3 then
    return 'active_limit_reached';
  end if;

  insert into public.video_assets(
    id, owner_id, provider, purpose, visibility, status, mime_type,
    size_bytes, original_filename, max_duration_seconds
  ) values (
    p_asset_id,
    p_owner_id,
    'cloudflare_stream',
    p_purpose,
    case when p_purpose = 'creator_premium_video' then 'private' else 'public' end,
    'pending',
    p_mime_type,
    p_size_bytes,
    p_original_filename,
    60
  );

  return 'created';
end;
$$;

create or replace function public.reserve_stream_upload_asset(
  p_asset_id uuid,
  p_owner_id uuid,
  p_mime_type text,
  p_size_bytes bigint,
  p_original_filename text
)
returns text
language sql
security definer
set search_path = ''
as $$
  select public.reserve_stream_upload_asset(
    p_asset_id,
    p_owner_id,
    p_mime_type,
    p_size_bytes,
    p_original_filename,
    'feed_video'
  );
$$;

revoke all on function public.reserve_stream_upload_asset(uuid,uuid,text,bigint,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.reserve_stream_upload_asset(uuid,uuid,text,bigint,text)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_stream_upload_asset(uuid,uuid,text,bigint,text,text)
  to service_role;
grant execute on function public.reserve_stream_upload_asset(uuid,uuid,text,bigint,text)
  to service_role;

create function private.guard_creator_premium_video_link_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.video_assets;
  v_content private.creator_premium_contents;
begin
  select asset.* into v_asset
  from public.video_assets asset
  where asset.id = new.asset_id;

  if not found then
    if new.entity_type = 'creator_premium_content' then
      raise exception using errcode = '23503', message = 'creator_premium_video_asset_not_found';
    end if;
    return new;
  end if;

  if v_asset.purpose = 'creator_premium_video'
     and new.entity_type <> 'creator_premium_content' then
    raise exception using errcode = '23514', message = 'creator_premium_video_entity_required';
  end if;

  if new.entity_type <> 'creator_premium_content' then
    return new;
  end if;

  if new.slot <> 'original' or new."position" <> 0 then
    raise exception using errcode = '23514', message = 'creator_premium_video_link_shape_invalid';
  end if;

  select content.* into v_content
  from private.creator_premium_contents content
  where content.id = new.entity_id;

  if not found then
    raise exception using errcode = '23503', message = 'creator_premium_content_not_found';
  end if;
  if new.owner_id is distinct from v_asset.owner_id
     or v_content.creator_id is distinct from v_asset.owner_id then
    raise exception using errcode = '42501', message = 'creator_premium_video_cross_creator';
  end if;
  if v_content.content_kind <> 'video' then
    raise exception using errcode = '23514', message = 'creator_premium_video_content_required';
  end if;
  if v_content.lifecycle_status <> 'draft' then
    raise exception using errcode = '55000', message = 'creator_premium_draft_only';
  end if;
  if v_asset.provider <> 'cloudflare_stream'
     or v_asset.purpose <> 'creator_premium_video'
     or v_asset.visibility <> 'private'
     or v_asset.status <> 'ready'
     or nullif(pg_catalog.btrim(v_asset.cloudflare_uid), '') is null
     or v_asset.hls_url is not null
     or v_asset.dash_url is not null
     or v_asset.thumbnail_url is not null
     or v_asset.ready_at is null
     or v_asset.duration_seconds is null
     or v_asset.duration_seconds <= 0
     or v_asset.duration_seconds > v_asset.max_duration_seconds
     or v_asset.provider_metadata -> 'require_signed_urls' is distinct from 'true'::jsonb then
    raise exception using errcode = '23514', message = 'creator_premium_video_asset_invalid';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_creator_premium_video_link_v1()
  from public, anon, authenticated, service_role;

create trigger video_asset_links_guard_creator_premium
before insert or update on public.video_asset_links
for each row execute function private.guard_creator_premium_video_link_v1();

create or replace function private.guard_creator_premium_media_link_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.media_assets;
  v_content private.creator_premium_contents;
begin
  select asset.* into v_asset
  from public.media_assets asset
  where asset.id = new.asset_id;

  if not found then
    if new.entity_type = 'creator_premium_content' then
      raise exception using errcode = '23503', message = 'creator_premium_media_asset_not_found';
    end if;
    return new;
  end if;

  if v_asset.purpose in ('creator_premium_teaser_image','creator_premium_original_image')
     and new.entity_type <> 'creator_premium_content' then
    raise exception using errcode = '23514', message = 'creator_premium_media_entity_required';
  end if;

  if new.entity_type <> 'creator_premium_content' then
    return new;
  end if;

  if new.slot not in ('teaser','original') or new."position" <> 0 then
    raise exception using errcode = '23514', message = 'creator_premium_media_link_shape_invalid';
  end if;

  select content.* into v_content
  from private.creator_premium_contents content
  where content.id = new.entity_id;

  if not found then
    raise exception using errcode = '23503', message = 'creator_premium_content_not_found';
  end if;
  if v_content.creator_id is distinct from v_asset.owner_id then
    raise exception using errcode = '42501', message = 'creator_premium_media_cross_creator';
  end if;
  if v_content.lifecycle_status <> 'draft' then
    raise exception using errcode = '55000', message = 'creator_premium_draft_only';
  end if;
  if v_asset.status <> 'ready'
     or v_asset.provider <> 'r2'
     or v_asset.media_kind <> 'image' then
    raise exception using errcode = '23514', message = 'creator_premium_media_asset_invalid';
  end if;

  if new.slot = 'teaser' then
    if v_content.content_kind not in ('image','video') then
      raise exception using errcode = '23514', message = 'creator_premium_media_content_kind_invalid';
    end if;
    if v_asset.purpose <> 'creator_premium_teaser_image'
       or v_asset.visibility <> 'public'
       or v_asset.public_url is null
       or v_asset.public_url !~* '^https://' then
      raise exception using errcode = '23514', message = 'creator_premium_teaser_invalid';
    end if;
  end if;

  if new.slot = 'original' then
    if v_content.content_kind <> 'image' then
      raise exception using errcode = '23514', message = 'creator_premium_image_content_required';
    end if;
    if v_asset.purpose <> 'creator_premium_original_image'
       or v_asset.visibility <> 'private'
       or v_asset.public_url is not null then
      raise exception using errcode = '23514', message = 'creator_premium_original_invalid';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.guard_creator_premium_media_link_v1()
  from public, anon, authenticated, service_role;

create or replace function public.authorize_my_creator_premium_image_upload_v1(
  p_content_id uuid,
  p_purpose text
) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_content private.creator_premium_contents;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if p_content_id is null
     or p_purpose not in ('creator_premium_teaser_image','creator_premium_original_image') then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_purpose';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;

  select content.* into v_content
  from private.creator_premium_contents content
  where content.id = p_content_id
    and content.creator_id = v_actor;

  if not found then
    raise exception using errcode = 'P0002', message = 'creator_premium_content_not_found';
  end if;
  if v_content.lifecycle_status <> 'draft' then
    raise exception using errcode = '55000', message = 'creator_premium_draft_only';
  end if;
  if p_purpose = 'creator_premium_teaser_image'
     and v_content.content_kind not in ('image','video') then
    raise exception using errcode = '22023', message = 'creator_premium_media_content_kind_invalid';
  end if;
  if p_purpose = 'creator_premium_original_image'
     and v_content.content_kind <> 'image' then
    raise exception using errcode = '22023', message = 'creator_premium_image_content_required';
  end if;
  return true;
end;
$$;

revoke all on function public.authorize_my_creator_premium_image_upload_v1(uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.authorize_my_creator_premium_image_upload_v1(uuid,text)
  to authenticated;

create function public.authorize_my_creator_premium_video_upload_v1(
  p_content_id uuid
) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_content private.creator_premium_contents;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if p_content_id is null then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_content';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;

  select content.* into v_content
  from private.creator_premium_contents content
  where content.id = p_content_id
    and content.creator_id = v_actor;

  if not found then
    raise exception using errcode = 'P0002', message = 'creator_premium_content_not_found';
  end if;
  if v_content.lifecycle_status <> 'draft' then
    raise exception using errcode = '55000', message = 'creator_premium_draft_only';
  end if;
  if v_content.content_kind <> 'video' then
    raise exception using errcode = '22023', message = 'creator_premium_video_content_required';
  end if;
  return true;
end;
$$;

revoke all on function public.authorize_my_creator_premium_video_upload_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.authorize_my_creator_premium_video_upload_v1(uuid)
  to authenticated;

create function public.set_my_creator_premium_video_media_v1(
  p_content_id uuid,
  p_teaser_asset_id uuid,
  p_video_asset_id uuid
) returns table (
  content_id uuid,
  teaser_url text,
  teaser_attached boolean,
  video_attached boolean,
  media_ready boolean,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_content private.creator_premium_contents;
  v_teaser public.media_assets;
  v_video public.video_assets;
  v_old_teaser uuid;
  v_old_video uuid;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if p_content_id is null
     or p_teaser_asset_id is null
     or p_video_asset_id is null then
    raise exception using errcode = '22023', message = 'creator_premium_video_media_required';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-premium-video-media:' || p_content_id::text, 0)
  );

  select content.* into v_content
  from private.creator_premium_contents content
  where content.id = p_content_id
    and content.creator_id = v_actor
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'creator_premium_content_not_found';
  end if;
  if v_content.lifecycle_status <> 'draft' then
    raise exception using errcode = '55000', message = 'creator_premium_draft_only';
  end if;
  if v_content.content_kind <> 'video' then
    raise exception using errcode = '22023', message = 'creator_premium_video_content_required';
  end if;

  perform asset.id
  from public.media_assets asset
  where asset.id = p_teaser_asset_id
  for update;

  perform asset.id
  from public.video_assets asset
  where asset.id = p_video_asset_id
  for update;

  select asset.* into v_teaser
  from public.media_assets asset
  where asset.id = p_teaser_asset_id;

  if not found
     or v_teaser.owner_id <> v_actor
     or v_teaser.status <> 'ready'
     or v_teaser.provider <> 'r2'
     or v_teaser.media_kind <> 'image'
     or v_teaser.purpose <> 'creator_premium_teaser_image'
     or v_teaser.visibility <> 'public'
     or v_teaser.public_url is null
     or v_teaser.public_url !~* '^https://' then
    raise exception using errcode = '42501', message = 'creator_premium_teaser_invalid';
  end if;

  select asset.* into v_video
  from public.video_assets asset
  where asset.id = p_video_asset_id;

  if not found
     or v_video.owner_id <> v_actor
     or v_video.provider <> 'cloudflare_stream'
     or v_video.purpose <> 'creator_premium_video'
     or v_video.visibility <> 'private'
     or v_video.status <> 'ready'
     or nullif(pg_catalog.btrim(v_video.cloudflare_uid), '') is null
     or v_video.hls_url is not null
     or v_video.dash_url is not null
     or v_video.thumbnail_url is not null
     or v_video.ready_at is null
     or v_video.duration_seconds is null
     or v_video.duration_seconds <= 0
     or v_video.duration_seconds > v_video.max_duration_seconds
     or v_video.provider_metadata -> 'require_signed_urls' is distinct from 'true'::jsonb then
    raise exception using errcode = '42501', message = 'creator_premium_video_invalid';
  end if;

  if exists (
    select 1
    from public.media_asset_links link
    where link.asset_id = p_teaser_asset_id
      and not (
        link.entity_type = 'creator_premium_content'
        and link.entity_id = p_content_id
        and link.slot = 'teaser'
        and link."position" = 0
      )
  ) then
    raise exception using errcode = '23505', message = 'creator_premium_teaser_asset_in_use';
  end if;

  if exists (
    select 1
    from public.video_asset_links link
    where link.asset_id = p_video_asset_id
      and not (
        link.entity_type = 'creator_premium_content'
        and link.entity_id = p_content_id
        and link.slot = 'original'
        and link."position" = 0
      )
  ) then
    raise exception using errcode = '23505', message = 'creator_premium_video_asset_in_use';
  end if;

  select link.asset_id into v_old_teaser
  from public.media_asset_links link
  where link.entity_type = 'creator_premium_content'
    and link.entity_id = p_content_id
    and link.slot = 'teaser'
    and link."position" = 0;

  select link.asset_id into v_old_video
  from public.video_asset_links link
  where link.entity_type = 'creator_premium_content'
    and link.entity_id = p_content_id
    and link.slot = 'original'
    and link."position" = 0;

  if v_old_teaser = p_teaser_asset_id
     and v_old_video = p_video_asset_id then
    return query
      select p_content_id, v_teaser.public_url, true, true, true, true;
    return;
  end if;

  if v_old_teaser is not null or v_old_video is not null then
    raise exception using errcode = '55000', message = 'creator_premium_video_media_already_bound';
  end if;

  insert into public.media_asset_links(
    asset_id, entity_type, entity_id, slot, "position", is_cover
  ) values (
    p_teaser_asset_id, 'creator_premium_content', p_content_id, 'teaser', 0, false
  );

  insert into public.video_asset_links(
    asset_id, owner_id, entity_type, entity_id, slot, "position"
  ) values (
    p_video_asset_id, v_actor, 'creator_premium_content', p_content_id, 'original', 0
  );

  return query
    select p_content_id, v_teaser.public_url, true, true, true, false;
end;
$$;

revoke all on function public.set_my_creator_premium_video_media_v1(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.set_my_creator_premium_video_media_v1(uuid,uuid,uuid)
  to authenticated;

create function public.get_my_creator_premium_video_media_v1(p_content_id uuid)
returns table (
  content_id uuid,
  content_kind text,
  lifecycle_status text,
  teaser_url text,
  teaser_attached boolean,
  video_attached boolean,
  video_ready boolean,
  media_ready boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_content private.creator_premium_contents;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if p_content_id is null then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_content';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;

  select content.* into v_content
  from private.creator_premium_contents content
  where content.id = p_content_id
    and content.creator_id = v_actor;

  if not found then
    raise exception using errcode = 'P0002', message = 'creator_premium_content_not_found';
  end if;
  if v_content.content_kind <> 'video' then
    raise exception using errcode = '22023', message = 'creator_premium_video_content_required';
  end if;

  return query
  select
    v_content.id,
    v_content.content_kind,
    v_content.lifecycle_status,
    teaser.teaser_url,
    teaser.teaser_attached,
    video.video_attached,
    video.video_ready,
    teaser.teaser_attached and video.video_ready
  from (
    select
      max(asset.public_url) filter (
        where link.slot = 'teaser'
          and asset.purpose = 'creator_premium_teaser_image'
          and asset.provider = 'r2'
          and asset.media_kind = 'image'
          and asset.visibility = 'public'
          and asset.status = 'ready'
          and asset.public_url ~* '^https://'
      ) as teaser_url,
      coalesce(bool_or(
        link.slot = 'teaser'
        and asset.purpose = 'creator_premium_teaser_image'
        and asset.provider = 'r2'
        and asset.media_kind = 'image'
        and asset.visibility = 'public'
        and asset.status = 'ready'
        and asset.public_url ~* '^https://'
      ), false) as teaser_attached
    from public.media_asset_links link
    join public.media_assets asset on asset.id = link.asset_id
    where link.entity_type = 'creator_premium_content'
      and link.entity_id = v_content.id
  ) teaser
  cross join lateral (
    select
      coalesce(bool_or(
        link.slot = 'original'
        and link."position" = 0
        and asset.purpose = 'creator_premium_video'
        and asset.provider = 'cloudflare_stream'
        and asset.visibility = 'private'
      ), false) as video_attached,
      coalesce(bool_or(
        link.slot = 'original'
        and link."position" = 0
        and asset.purpose = 'creator_premium_video'
        and asset.provider = 'cloudflare_stream'
        and asset.visibility = 'private'
        and asset.status = 'ready'
        and nullif(pg_catalog.btrim(asset.cloudflare_uid), '') is not null
        and asset.hls_url is null
        and asset.dash_url is null
        and asset.thumbnail_url is null
        and asset.ready_at is not null
        and asset.duration_seconds > 0
        and asset.duration_seconds <= asset.max_duration_seconds
        and asset.provider_metadata -> 'require_signed_urls' = 'true'::jsonb
      ), false) as video_ready
    from public.video_asset_links link
    join public.video_assets asset on asset.id = link.asset_id
    where link.entity_type = 'creator_premium_content'
      and link.entity_id = v_content.id
  ) video;
end;
$$;

revoke all on function public.get_my_creator_premium_video_media_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_creator_premium_video_media_v1(uuid)
  to authenticated;

create or replace function public.media_asset_has_valid_links(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.media_asset_links link
    join public.media_assets asset on asset.id = link.asset_id
    where link.asset_id = p_asset_id
      and (
        (link.entity_type = 'user_profile' and exists (
          select 1 from public.user_profiles profile
          where profile.id = link.entity_id and profile.avatar_url = asset.public_url
        ))
        or (link.entity_type = 'video_post' and exists (
          select 1 from public.videos video where video.id = link.entity_id
        ))
        or (link.entity_type = 'story' and exists (
          select 1 from public.stories story
          where story.id = link.entity_id and story.expires_at > pg_catalog.now()
        ))
        or (link.entity_type = 'shop_product' and exists (
          select 1 from public.products product
          where product.id = link.entity_id and product.status <> 'deleted'
        ))
        or (link.entity_type = 'marketplace_store' and exists (
          select 1 from public.marketplace_stores store
          where store.id = link.entity_id
            and ((link.slot = 'logo' and store.logo_asset_id = link.asset_id)
              or (link.slot = 'banner' and store.banner_asset_id = link.asset_id))
        ))
        or (link.entity_type = 'marketplace_dispute'
          and link.slot in ('buyer_evidence','seller_evidence')
          and exists (
            select 1 from public.marketplace_order_disputes dispute
            where dispute.id = link.entity_id
          ))
        or (link.entity_type = 'marketplace_return_shipment'
          and link.slot = 'return_label'
          and exists (
            select 1 from public.marketplace_return_shipments shipment
            where shipment.id = link.entity_id
              and shipment.return_label_asset_id = link.asset_id
          ))
        or (link.entity_type = 'chat_message'
          and link.slot = 'content'
          and exists (
            select 1 from public.messages message
            where message.id = link.entity_id
              and message.media_asset_id = link.asset_id
              and (
                message.deleted_at is null
                or exists (
                  select 1 from private.admin_content_moderation_actions action
                  where action.target_type = 'chat_message'
                    and action.target_id = message.id
                    and action.action = 'hide'
                )
              )
          ))
        or (link.entity_type = 'creator_premium_content'
          and link.slot in ('teaser','original')
          and link."position" = 0
          and exists (
            select 1
            from private.creator_premium_contents content
            where content.id = link.entity_id
              and content.creator_id = asset.owner_id
              and (
                (link.slot = 'teaser'
                  and content.content_kind in ('image','video')
                  and asset.purpose = 'creator_premium_teaser_image'
                  and asset.provider = 'r2'
                  and asset.media_kind = 'image'
                  and asset.visibility = 'public'
                  and asset.status = 'ready'
                  and asset.public_url ~* '^https://')
                or (link.slot = 'original'
                  and content.content_kind = 'image'
                  and asset.purpose = 'creator_premium_original_image'
                  and asset.provider = 'r2'
                  and asset.media_kind = 'image'
                  and asset.visibility = 'private'
                  and asset.status = 'ready'
                  and asset.public_url is null)
              )
          ))
      )
  );
$$;

revoke all on function public.media_asset_has_valid_links(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.media_asset_has_valid_links(uuid)
  to service_role;

drop function public.get_creator_premium_catalog_v1(uuid,integer,timestamptz,uuid);

create function public.get_creator_premium_catalog_v1(
  p_creator_id uuid,
  p_limit integer default 24,
  p_cursor_published_at timestamptz default null,
  p_cursor_id uuid default null
) returns table (
  id uuid,
  creator_id uuid,
  title text,
  description text,
  content_kind text,
  access_mode text,
  published_at timestamptz,
  created_at timestamptz,
  teaser_url text,
  entitled boolean,
  entitlement_source text,
  entitlement_expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if p_creator_id is null then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_creator';
  end if;
  if p_limit is null or not (p_limit between 1 and 100) then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_limit';
  end if;
  if (p_cursor_published_at is null) <> (p_cursor_id is null) then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_cursor';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor)
     or not private.creator_premium_actor_is_operational_v1(p_creator_id) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;
  if not private.creator_premium_pair_is_unblocked_v1(v_actor, p_creator_id) then
    raise exception using errcode = '42501', message = 'creator_premium_blocked_relationship';
  end if;

  return query
  select
    content.id,
    content.creator_id,
    content.title,
    content.description,
    content.content_kind,
    content.access_mode,
    content.published_at,
    content.created_at,
    teaser.teaser_url,
    entitlement.allowed,
    entitlement.source,
    entitlement.expires_at
  from private.creator_premium_contents content
  left join lateral (
    select asset.public_url as teaser_url
    from public.media_asset_links link
    join public.media_assets asset on asset.id = link.asset_id
    where link.entity_type = 'creator_premium_content'
      and link.entity_id = content.id
      and link.slot = 'teaser'
      and link."position" = 0
      and asset.owner_id = content.creator_id
      and asset.provider = 'r2'
      and asset.media_kind = 'image'
      and asset.purpose = 'creator_premium_teaser_image'
      and asset.visibility = 'public'
      and asset.status = 'ready'
      and asset.public_url ~* '^https://'
    limit 1
  ) teaser on true
  left join lateral (
    select true as video_ready
    from public.video_asset_links link
    join public.video_assets asset on asset.id = link.asset_id
    where link.entity_type = 'creator_premium_content'
      and link.entity_id = content.id
      and link.slot = 'original'
      and link."position" = 0
      and link.owner_id = content.creator_id
      and asset.owner_id = content.creator_id
      and asset.provider = 'cloudflare_stream'
      and asset.purpose = 'creator_premium_video'
      and asset.visibility = 'private'
      and asset.status = 'ready'
      and nullif(pg_catalog.btrim(asset.cloudflare_uid), '') is not null
      and asset.hls_url is null
      and asset.dash_url is null
      and asset.thumbnail_url is null
      and asset.ready_at is not null
      and asset.duration_seconds > 0
      and asset.duration_seconds <= asset.max_duration_seconds
      and asset.provider_metadata -> 'require_signed_urls' = 'true'::jsonb
    limit 1
  ) video on true
  cross join lateral private.resolve_creator_premium_entitlement_v1(content.id) entitlement
  where content.creator_id = p_creator_id
    and content.lifecycle_status = 'published'
    and content.published_at is not null
    and teaser.teaser_url is not null
    and (
      content.content_kind = 'image'
      or (content.content_kind = 'video' and video.video_ready)
    )
    and (
      p_cursor_published_at is null
      or (content.published_at, content.id) < (p_cursor_published_at, p_cursor_id)
    )
  order by content.published_at desc, content.id desc
  limit p_limit;
end;
$$;

revoke all on function public.get_creator_premium_catalog_v1(uuid,integer,timestamptz,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_creator_premium_catalog_v1(uuid,integer,timestamptz,uuid)
  to authenticated;

drop function public.get_my_creator_premium_contents_v1(integer,timestamptz,uuid);

create function public.get_my_creator_premium_contents_v1(
  p_limit integer default 24,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
) returns table (
  id uuid,
  title text,
  description text,
  content_kind text,
  access_mode text,
  lifecycle_status text,
  published_at timestamptz,
  quarantined_at timestamptz,
  removed_at timestamptz,
  deleted_at timestamptz,
  removal_reason text,
  created_at timestamptz,
  updated_at timestamptz,
  teaser_url text,
  teaser_attached boolean,
  original_attached boolean,
  image_media_ready boolean,
  video_attached boolean,
  video_media_ready boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if p_limit is null or not (p_limit between 1 and 100) then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_limit';
  end if;
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_cursor';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;

  return query
  select
    content.id,
    content.title,
    content.description,
    content.content_kind,
    content.access_mode,
    content.lifecycle_status,
    content.published_at,
    content.quarantined_at,
    content.removed_at,
    content.deleted_at,
    content.removal_reason,
    content.created_at,
    content.updated_at,
    media.teaser_url,
    media.teaser_attached,
    media.original_attached,
    content.content_kind = 'image'
      and media.teaser_attached
      and media.original_attached,
    video.video_attached,
    content.content_kind = 'video'
      and media.teaser_attached
      and video.video_ready
  from private.creator_premium_contents content
  left join lateral (
    select
      max(asset.public_url) filter (
        where link.slot = 'teaser'
          and asset.purpose = 'creator_premium_teaser_image'
          and asset.visibility = 'public'
          and asset.status = 'ready'
          and asset.public_url ~* '^https://'
      ) as teaser_url,
      coalesce(bool_or(
        link.slot = 'teaser'
        and asset.purpose = 'creator_premium_teaser_image'
        and asset.visibility = 'public'
        and asset.status = 'ready'
        and asset.public_url ~* '^https://'
      ), false) as teaser_attached,
      coalesce(bool_or(
        link.slot = 'original'
        and asset.purpose = 'creator_premium_original_image'
        and asset.visibility = 'private'
        and asset.status = 'ready'
        and asset.public_url is null
      ), false) as original_attached
    from public.media_asset_links link
    join public.media_assets asset on asset.id = link.asset_id
    where link.entity_type = 'creator_premium_content'
      and link.entity_id = content.id
  ) media on true
  left join lateral (
    select
      coalesce(bool_or(
        link.slot = 'original'
        and link."position" = 0
        and asset.purpose = 'creator_premium_video'
        and asset.visibility = 'private'
      ), false) as video_attached,
      coalesce(bool_or(
        link.slot = 'original'
        and link."position" = 0
        and asset.provider = 'cloudflare_stream'
        and asset.purpose = 'creator_premium_video'
        and asset.visibility = 'private'
        and asset.status = 'ready'
        and nullif(pg_catalog.btrim(asset.cloudflare_uid), '') is not null
        and asset.hls_url is null
        and asset.dash_url is null
        and asset.thumbnail_url is null
        and asset.ready_at is not null
        and asset.duration_seconds > 0
        and asset.duration_seconds <= asset.max_duration_seconds
        and asset.provider_metadata -> 'require_signed_urls' = 'true'::jsonb
      ), false) as video_ready
    from public.video_asset_links link
    join public.video_assets asset on asset.id = link.asset_id
    where link.entity_type = 'creator_premium_content'
      and link.entity_id = content.id
  ) video on true
  where content.creator_id = v_actor
    and (
      p_cursor_created_at is null
      or (content.created_at, content.id) < (p_cursor_created_at, p_cursor_id)
    )
  order by content.created_at desc, content.id desc
  limit p_limit;
end;
$$;

revoke all on function public.get_my_creator_premium_contents_v1(integer,timestamptz,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_creator_premium_contents_v1(integer,timestamptz,uuid)
  to authenticated;

drop policy video_assets_select_own on public.video_assets;
create policy video_assets_select_own on public.video_assets
for select to authenticated
using (
  owner_id = (select auth.uid())
  and purpose <> 'creator_premium_video'
);

drop policy video_asset_links_select_own on public.video_asset_links;
create policy video_asset_links_select_own on public.video_asset_links
for select to authenticated
using (
  owner_id = (select auth.uid())
  and entity_type <> 'creator_premium_content'
);

comment on function public.authorize_my_creator_premium_video_upload_v1(uuid) is
  'B3 authenticated upload authorization for an owned 18+ operational VIDEO draft.';
comment on function public.set_my_creator_premium_video_media_v1(uuid,uuid,uuid) is
  'B3 atomic first-bind and same-pair replay for one public teaser and one protected private Stream original; replacement is denied.';
comment on function public.get_my_creator_premium_video_media_v1(uuid) is
  'B3 safe owner video media state without Stream asset or provider identifiers.';

commit;
