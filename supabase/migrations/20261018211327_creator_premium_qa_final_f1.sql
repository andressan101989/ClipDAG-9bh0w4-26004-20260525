begin;

-- CREATOR-PREMIUM-QA-FINAL-F1
-- Premium video gets a purpose-scoped 180 second limit. Feed and Business keep
-- their existing 60 second ceiling and every purpose keeps the 200 MB cap.
alter table public.video_assets
  drop constraint video_assets_duration_limit_check,
  drop constraint video_assets_creator_premium_contract_check;

alter table public.video_assets
  add constraint video_assets_duration_limit_check check (
    (
      purpose = 'creator_premium_video'
      and max_duration_seconds between 1 and 180
    )
    or (
      purpose <> 'creator_premium_video'
      and max_duration_seconds between 1 and 60
    )
  ),
  add constraint video_assets_creator_premium_contract_check check (
    purpose <> 'creator_premium_video'
    or (
      provider = 'cloudflare_stream'
      and visibility = 'private'
      and mime_type in ('video/mp4','video/quicktime','video/webm')
      and size_bytes between 1 and 200000000
      and max_duration_seconds between 1 and 180
    )
  );

comment on constraint video_assets_duration_limit_check on public.video_assets is
  'Feed and Business remain bounded to 60 seconds; private Creator Premium video is bounded to 180 seconds.';
comment on constraint video_assets_creator_premium_contract_check on public.video_assets is
  'Creator Premium Stream video remains private, <=200 MB, and is bounded to 180 seconds.';

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
    case when p_purpose = 'creator_premium_video' then 180 else 60 end
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

-- Keep the public-feed 60 second contract unchanged while allowing the
-- Creator Premium safety pipeline to consume the full private 180 second
-- asset. These are replacements of the canonical authorities, not a second
-- scanner or queue.
create or replace function private.content_safety_audio_source(
  p_target_type text,
  p_target_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_asset public.video_assets;
  v_media public.media_assets;
  v_shared uuid;
  v_source jsonb;
  v_content private.creator_premium_contents;
begin
  if p_target_type = 'creator_premium' then
    select * into v_content
    from private.creator_premium_contents
    where id = p_target_id;
    if not found then
      return pg_catalog.jsonb_build_object(
        'kind','not_configured','reason','creator_premium_content_not_found'
      );
    end if;
    if v_content.content_kind = 'image' then
      return pg_catalog.jsonb_build_object('kind','not_applicable','reason','canonical_image');
    end if;
    select asset.* into v_asset
    from public.video_asset_links link
    join public.video_assets asset on asset.id = link.asset_id
    where link.entity_type = 'creator_premium_content'
      and link.entity_id = v_content.id
      and link.slot = 'original'
      and link."position" = 0
      and link.owner_id = v_content.creator_id
      and asset.owner_id = v_content.creator_id
      and asset.purpose = 'creator_premium_video'
    order by link.created_at, link.id
    limit 1;
    if found
       and v_asset.provider = 'cloudflare_stream'
       and v_asset.status = 'ready'
       and v_asset.deleted_at is null
       and v_asset.visibility = 'private'
       and nullif(pg_catalog.btrim(v_asset.cloudflare_uid),'') is not null
       and v_asset.mime_type in ('video/mp4','video/quicktime','video/webm')
       and v_asset.duration_seconds > 0
       and v_asset.duration_seconds <= 180
       and v_asset.provider_metadata -> 'require_signed_urls' = 'true'::jsonb
       and v_asset.hls_url is null
       and v_asset.dash_url is null
       and v_asset.thumbnail_url is null then
      return pg_catalog.jsonb_build_object(
        'kind','eligible','source_asset_id',v_asset.id,
        'cloudflare_uid',v_asset.cloudflare_uid,
        'duration_seconds',v_asset.duration_seconds,
        'provider',v_asset.provider,
        'model','@cf/openai/whisper-large-v3-turbo'
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'kind','not_configured','reason','creator_premium_private_audio_source_unavailable'
    );
  elsif p_target_type = 'video' then
    select asset.* into v_asset
    from public.video_asset_links link
    join public.video_assets asset on asset.id = link.asset_id
    where link.entity_type = 'video_post'
      and link.entity_id = p_target_id
      and link.slot = 'video'
      and link."position" = 0
    order by link.created_at, link.id
    limit 1;
    if found
       and v_asset.provider = 'cloudflare_stream'
       and v_asset.status = 'ready'
       and v_asset.deleted_at is null
       and nullif(pg_catalog.btrim(v_asset.cloudflare_uid),'') is not null
       and v_asset.mime_type like 'video/%'
       and v_asset.duration_seconds > 0
       and v_asset.duration_seconds <= 60
       and v_asset.visibility = 'public' then
      return pg_catalog.jsonb_build_object(
        'kind','eligible','source_asset_id',v_asset.id,
        'cloudflare_uid',v_asset.cloudflare_uid,
        'duration_seconds',v_asset.duration_seconds,
        'provider',v_asset.provider,
        'model','@cf/openai/whisper-large-v3-turbo'
      );
    end if;
    select asset.* into v_media
    from public.media_asset_links link
    join public.media_assets asset on asset.id = link.asset_id
    where link.entity_type = 'video_post'
      and link.entity_id = p_target_id
      and link.slot = 'media'
      and link."position" = 0
    order by link.created_at, link.id
    limit 1;
    if found
       and v_media.status = 'ready'
       and v_media.deleted_at is null
       and v_media.media_kind = 'image'
       and v_media.mime_type like 'image/%' then
      return pg_catalog.jsonb_build_object('kind','not_applicable','reason','canonical_image');
    end if;
    return pg_catalog.jsonb_build_object(
      'kind','not_configured','reason','canonical_audio_source_unavailable'
    );
  elsif p_target_type = 'story' then
    select story.shared_video_id into v_shared
    from public.stories story
    where story.id = p_target_id;
    if not found then
      return pg_catalog.jsonb_build_object(
        'kind','not_configured','reason','canonical_audio_source_unavailable'
      );
    end if;
    if v_shared is not null then
      v_source := private.content_safety_audio_source('video',v_shared);
      return v_source || pg_catalog.jsonb_build_object(
        'kind',case v_source ->> 'kind'
          when 'eligible' then 'shared_video'
          when 'not_applicable' then 'not_applicable'
          else 'not_configured'
        end,
        'shared_video_id',v_shared
      );
    end if;
    select asset.* into v_media
    from public.media_asset_links link
    join public.media_assets asset on asset.id = link.asset_id
    where link.entity_type = 'story'
      and link.entity_id = p_target_id
      and link.slot = 'media'
      and link."position" = 0
    order by link.created_at, link.id
    limit 1;
    if found
       and v_media.status = 'ready'
       and v_media.deleted_at is null
       and v_media.media_kind = 'image'
       and v_media.mime_type like 'image/%' then
      return pg_catalog.jsonb_build_object('kind','not_applicable','reason','canonical_image');
    end if;
    return pg_catalog.jsonb_build_object(
      'kind','not_configured','reason','canonical_audio_source_unavailable'
    );
  end if;
  return pg_catalog.jsonb_build_object('kind','not_applicable','reason','text_only_target');
end;
$$;

create or replace function private.content_safety_visual_source(
  p_target_type text,
  p_target_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_video public.video_assets;
  v_media public.media_assets;
  v_shared uuid;
  v_source jsonb;
  v_has_link boolean := false;
  v_content private.creator_premium_contents;
begin
  if p_target_type = 'creator_premium' then
    select * into v_content
    from private.creator_premium_contents
    where id = p_target_id;
    if not found then
      return pg_catalog.jsonb_build_object(
        'kind','not_configured','reason','creator_premium_content_not_found'
      );
    end if;
    if v_content.content_kind = 'image' then
      select asset.* into v_media
      from public.media_asset_links link
      join public.media_assets asset on asset.id = link.asset_id
      where link.entity_type = 'creator_premium_content'
        and link.entity_id = v_content.id
        and link.slot = 'original'
        and link."position" = 0
        and asset.owner_id = v_content.creator_id
        and asset.purpose = 'creator_premium_original_image'
      order by link.created_at, link.id
      limit 1;
      if found
         and v_media.provider = 'r2'
         and v_media.status = 'ready'
         and v_media.deleted_at is null
         and v_media.visibility = 'private'
         and v_media.public_url is null
         and v_media.media_kind = 'image'
         and v_media.mime_type in ('image/jpeg','image/png','image/webp')
         and nullif(pg_catalog.btrim(v_media.bucket_name),'') is not null
         and nullif(pg_catalog.btrim(v_media.object_key),'') is not null
         and v_media.size_bytes > 0
         and v_media.size_bytes <= 25000000 then
        return pg_catalog.jsonb_build_object(
          'kind','eligible_image','media_asset_id',v_media.id,
          'bucket_name',v_media.bucket_name,'object_key',v_media.object_key,
          'mime_type',v_media.mime_type,'size_bytes',v_media.size_bytes
        );
      end if;
    elsif v_content.content_kind = 'video' then
      select asset.* into v_video
      from public.video_asset_links link
      join public.video_assets asset on asset.id = link.asset_id
      where link.entity_type = 'creator_premium_content'
        and link.entity_id = v_content.id
        and link.slot = 'original'
        and link."position" = 0
        and link.owner_id = v_content.creator_id
        and asset.owner_id = v_content.creator_id
        and asset.purpose = 'creator_premium_video'
      order by link.created_at, link.id
      limit 1;
      if found
         and v_video.provider = 'cloudflare_stream'
         and v_video.status = 'ready'
         and v_video.deleted_at is null
         and v_video.visibility = 'private'
         and v_video.provider_metadata -> 'require_signed_urls' = 'true'::jsonb
         and nullif(pg_catalog.btrim(v_video.cloudflare_uid),'') is not null
         and v_video.mime_type in ('video/mp4','video/quicktime','video/webm')
         and v_video.duration_seconds > 0
         and v_video.duration_seconds <= 180
         and v_video.hls_url is null
         and v_video.dash_url is null
         and v_video.thumbnail_url is null then
        return pg_catalog.jsonb_build_object(
          'kind','eligible_stream_video','video_asset_id',v_video.id,
          'cloudflare_uid',v_video.cloudflare_uid,
          'duration_seconds',v_video.duration_seconds,'mime_type',v_video.mime_type
        );
      end if;
    end if;
    return pg_catalog.jsonb_build_object(
      'kind','not_configured','reason','creator_premium_private_visual_source_unavailable'
    );
  elsif p_target_type = 'video' then
    select asset.* into v_video
    from public.video_asset_links link
    join public.video_assets asset on asset.id = link.asset_id
    where link.entity_type = 'video_post'
      and link.entity_id = p_target_id
      and link.slot = 'video'
      and link."position" = 0
    order by link.created_at, link.id
    limit 1;
    if found then
      v_has_link := true;
      if v_video.provider = 'cloudflare_stream'
         and v_video.status = 'ready'
         and v_video.deleted_at is null
         and v_video.visibility = 'public'
         and nullif(pg_catalog.btrim(v_video.cloudflare_uid),'') is not null
         and v_video.mime_type like 'video/%'
         and v_video.duration_seconds > 0
         and v_video.duration_seconds <= 60 then
        return pg_catalog.jsonb_build_object(
          'kind','eligible_stream_video','video_asset_id',v_video.id,
          'cloudflare_uid',v_video.cloudflare_uid,
          'duration_seconds',v_video.duration_seconds,'mime_type',v_video.mime_type
        );
      end if;
    end if;
    select asset.* into v_media
    from public.media_asset_links link
    join public.media_assets asset on asset.id = link.asset_id
    where link.entity_type = 'video_post'
      and link.entity_id = p_target_id
      and link.slot = 'media'
      and link."position" = 0
    order by link.created_at, link.id
    limit 1;
    if found then
      v_has_link := true;
      if v_media.provider = 'r2'
         and v_media.status = 'ready'
         and v_media.deleted_at is null
         and v_media.visibility = 'public'
         and v_media.media_kind = 'image'
         and v_media.mime_type in ('image/jpeg','image/png','image/webp')
         and nullif(pg_catalog.btrim(v_media.bucket_name),'') is not null
         and nullif(pg_catalog.btrim(v_media.object_key),'') is not null
         and v_media.size_bytes > 0
         and v_media.size_bytes <= 10485760 then
        return pg_catalog.jsonb_build_object(
          'kind','eligible_image','media_asset_id',v_media.id,
          'bucket_name',v_media.bucket_name,'object_key',v_media.object_key,
          'mime_type',v_media.mime_type,'size_bytes',v_media.size_bytes
        );
      end if;
    end if;
    return pg_catalog.jsonb_build_object(
      'kind','not_configured','reason','canonical_visual_source_unavailable'
    );
  elsif p_target_type = 'story' then
    select story.shared_video_id into v_shared
    from public.stories story
    where story.id = p_target_id;
    if not found then
      return pg_catalog.jsonb_build_object(
        'kind','not_configured','reason','canonical_visual_source_unavailable'
      );
    end if;
    if v_shared is not null then
      v_source := private.content_safety_visual_source('video',v_shared);
      return v_source || pg_catalog.jsonb_build_object(
        'kind',case v_source ->> 'kind'
          when 'eligible_image' then 'shared_image'
          when 'eligible_stream_video' then 'shared_stream_video'
          else v_source ->> 'kind'
        end,
        'shared_video_id',v_shared
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'kind','not_configured','reason','canonical_visual_source_unavailable'
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'kind','not_applicable','reason','text_only_or_private_target'
  );
end;
$$;

create or replace function public.claim_content_safety_audio_scans(
  p_limit integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_result jsonb := '[]'::jsonb;
begin
  if p_limit < 1 or p_limit > 1 then
    raise exception using errcode = '22023', message = 'invalid_audio_claim_limit';
  end if;
  for v_row in
    select
      scan.id,scan.target_type,scan.target_id,scan.content_fingerprint,
      scan.audio_source_asset_id,scan.audio_attempt_count,
      asset.cloudflare_uid,asset.duration_seconds
    from private.content_safety_scans scan
    join public.video_assets asset on asset.id = scan.audio_source_asset_id
    where scan.target_type in ('video','creator_premium')
      and scan.audio_status = 'pending'
      and scan.audio_attempt_count < 5
      and scan.audio_available_at <= pg_catalog.clock_timestamp()
      and (
        scan.audio_started_at is null
        or scan.audio_started_at < pg_catalog.clock_timestamp() - interval '10 minutes'
      )
      and asset.provider = 'cloudflare_stream'
      and asset.status = 'ready'
      and asset.deleted_at is null
      and asset.mime_type like 'video/%'
      and asset.duration_seconds > 0
      and asset.duration_seconds <= case
        when scan.target_type = 'creator_premium' then 180
        else 60
      end
      and nullif(pg_catalog.btrim(asset.cloudflare_uid),'') is not null
      and (
        (scan.target_type = 'video' and asset.visibility = 'public')
        or (
          scan.target_type = 'creator_premium'
          and asset.visibility = 'private'
          and asset.purpose = 'creator_premium_video'
          and asset.provider_metadata -> 'require_signed_urls' = 'true'::jsonb
          and asset.hls_url is null
          and asset.dash_url is null
          and asset.thumbnail_url is null
        )
      )
    order by scan.audio_available_at,scan.created_at,scan.id
    for update of scan skip locked
    limit p_limit
  loop
    update private.content_safety_scans
    set audio_attempt_count = audio_attempt_count + 1,
        audio_started_at = pg_catalog.clock_timestamp(),
        audio_last_error_code = null,
        updated_at = pg_catalog.clock_timestamp()
    where id = v_row.id;
    v_result := v_result || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'scan_id',v_row.id,'target_type',v_row.target_type,
        'target_id',v_row.target_id,'content_fingerprint',v_row.content_fingerprint,
        'source_asset_id',v_row.audio_source_asset_id,
        'cloudflare_uid',v_row.cloudflare_uid,
        'duration_seconds',v_row.duration_seconds,
        'attempt_count',v_row.audio_attempt_count + 1
      )
    );
  end loop;
  return v_result;
end;
$$;

create or replace function public.claim_content_safety_visual_scans(
  p_limit integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_result jsonb := '[]'::jsonb;
begin
  if p_limit < 1 or p_limit > 1 then
    raise exception using errcode = '22023', message = 'invalid_visual_claim_limit';
  end if;
  for v_row in
    select
      scan.id,scan.target_type,scan.target_id,scan.content_fingerprint,
      scan.visual_source_kind,scan.visual_video_asset_id,scan.visual_media_asset_id,
      scan.visual_attempt_count,scan.visual_provider_call_count,
      scan.visual_frame_cursor,scan.visual_partial_result,
      video.cloudflare_uid,video.duration_seconds,
      media.bucket_name,media.object_key,media.mime_type,media.size_bytes
    from private.content_safety_scans scan
    left join public.video_assets video on video.id = scan.visual_video_asset_id
    left join public.media_assets media on media.id = scan.visual_media_asset_id
    where scan.target_type in ('video','creator_premium')
      and scan.visual_status = 'pending'
      and scan.visual_analysis_id is null
      and scan.visual_attempt_count < 5
      and scan.visual_provider_call_count < 5
      and scan.visual_available_at <= pg_catalog.clock_timestamp()
      and (
        scan.visual_started_at is null
        or scan.visual_started_at < pg_catalog.clock_timestamp() - interval '10 minutes'
      )
      and scan.id = private.content_safety_visual_producer_scan_id(
        scan.visual_video_asset_id,scan.visual_media_asset_id
      )
      and private.content_safety_visual_analysis_id_for_asset(
        scan.visual_video_asset_id,scan.visual_media_asset_id
      ) is null
      and (
        (
          scan.visual_source_kind = 'eligible_stream_video'
          and video.provider = 'cloudflare_stream'
          and video.status = 'ready'
          and video.deleted_at is null
          and video.mime_type like 'video/%'
          and video.duration_seconds > 0
          and video.duration_seconds <= case
            when scan.target_type = 'creator_premium' then 180
            else 60
          end
          and nullif(pg_catalog.btrim(video.cloudflare_uid),'') is not null
          and (
            (scan.target_type = 'video' and video.visibility = 'public')
            or (
              scan.target_type = 'creator_premium'
              and video.visibility = 'private'
              and video.purpose = 'creator_premium_video'
              and video.provider_metadata -> 'require_signed_urls' = 'true'::jsonb
              and video.hls_url is null
              and video.dash_url is null
              and video.thumbnail_url is null
            )
          )
        )
        or (
          scan.visual_source_kind = 'eligible_image'
          and media.provider = 'r2'
          and media.status = 'ready'
          and media.deleted_at is null
          and media.media_kind = 'image'
          and media.mime_type in ('image/jpeg','image/png','image/webp')
          and media.size_bytes > 0
          and media.size_bytes <= case
            when scan.target_type = 'creator_premium' then 25000000
            else 10485760
          end
          and nullif(pg_catalog.btrim(media.bucket_name),'') is not null
          and nullif(pg_catalog.btrim(media.object_key),'') is not null
          and (
            (scan.target_type = 'video' and media.visibility = 'public')
            or (
              scan.target_type = 'creator_premium'
              and media.visibility = 'private'
              and media.purpose = 'creator_premium_original_image'
              and media.public_url is null
            )
          )
        )
      )
    order by scan.visual_available_at,scan.created_at,scan.id
    for update of scan skip locked
    limit p_limit
  loop
    update private.content_safety_scans
    set visual_attempt_count = visual_attempt_count + 1,
        visual_started_at = pg_catalog.clock_timestamp(),
        visual_last_error_code = null,
        updated_at = pg_catalog.clock_timestamp()
    where id = v_row.id;
    v_result := v_result || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'scan_id',v_row.id,'target_type',v_row.target_type,
        'target_id',v_row.target_id,'content_fingerprint',v_row.content_fingerprint,
        'source_kind',v_row.visual_source_kind,
        'video_asset_id',v_row.visual_video_asset_id,
        'media_asset_id',v_row.visual_media_asset_id,
        'cloudflare_uid',v_row.cloudflare_uid,
        'duration_seconds',v_row.duration_seconds,
        'bucket_name',v_row.bucket_name,'object_key',v_row.object_key,
        'mime_type',v_row.mime_type,'size_bytes',v_row.size_bytes,
        'frame_cursor',v_row.visual_frame_cursor,
        'partial_result',v_row.visual_partial_result,
        'attempt_count',v_row.visual_attempt_count + 1,
        'provider_call_count',v_row.visual_provider_call_count
      )
    );
  end loop;
  return v_result;
end;
$$;

-- These predicates centralize the conservative lifecycle guard. Owner removal
-- never revokes or rewrites a financial record. A content item with any paid
-- history, or a plan draft with any dependency, requires a later product
-- decision instead of destructive automation.
create function private.creator_premium_content_has_financial_history(
  p_content_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from private.creator_premium_purchase_receipts receipt
    where receipt.content_id = p_content_id
  ) or exists (
    select 1
    from private.creator_premium_plan_contents mapping
    join private.creator_premium_subscriptions subscription
      on subscription.plan_id = mapping.plan_id
     and subscription.creator_id = mapping.creator_id
    where mapping.content_id = p_content_id
  ) or exists (
    select 1
    from private.creator_premium_plan_contents mapping
    join private.creator_premium_subscription_periods period
      on period.plan_id = mapping.plan_id
     and period.creator_id = mapping.creator_id
    where mapping.content_id = p_content_id
  );
$$;

create function private.creator_premium_plan_has_dependencies(
  p_plan_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from private.creator_premium_plan_contents mapping
    where mapping.plan_id = p_plan_id
  ) or exists (
    select 1
    from private.creator_premium_subscriptions subscription
    where subscription.plan_id = p_plan_id
  ) or exists (
    select 1
    from private.creator_premium_subscription_periods period
    where period.plan_id = p_plan_id
  );
$$;

revoke all on function private.creator_premium_content_has_financial_history(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.creator_premium_plan_has_dependencies(uuid)
  from public, anon, authenticated, service_role;

-- Select active plan versions in the app. This single transactional RPC clones
-- only plan families whose immutable membership changes, submits the content
-- through the existing safety authority, then activates/retire versions using
-- the canonical plan functions. Any error rolls the whole orchestration back.
create function public.submit_my_creator_premium_content_with_plans_v1(
  p_content_id uuid,
  p_plan_ids uuid[],
  p_client_request_id uuid
)
returns table (
  content_id uuid,
  lifecycle_status text,
  submission_ready boolean,
  active_plan_ids uuid[],
  versioned_plan_ids uuid[],
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_content private.creator_premium_contents;
  v_command public.idempotency_keys;
  v_selected_plan_ids uuid[];
  v_actual_active_plan_ids uuid[] := '{}'::uuid[];
  v_versioned_plan_ids uuid[] := '{}'::uuid[];
  v_activate_plan_ids uuid[] := '{}'::uuid[];
  v_retire_plan_ids uuid[] := '{}'::uuid[];
  v_next_content_ids uuid[];
  v_plan record;
  v_clone record;
  v_submission record;
  v_plan_id uuid;
  v_clone_request_id uuid;
  v_selected boolean;
  v_mapped boolean;
  v_count bigint;
  v_fingerprint text;
  v_response jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;
  if p_content_id is null or p_client_request_id is null
     or coalesce(pg_catalog.cardinality(p_plan_ids), 0) > 100 then
    raise exception using errcode = '22023', message = 'creator_premium_plan_selection_invalid';
  end if;

  select coalesce(pg_catalog.array_agg(distinct item order by item), '{}'::uuid[])
  into v_selected_plan_ids
  from pg_catalog.unnest(coalesce(p_plan_ids, '{}'::uuid[])) item;
  if exists (
    select 1 from pg_catalog.unnest(v_selected_plan_ids) item where item is null
  ) then
    raise exception using errcode = '22023', message = 'creator_premium_plan_selection_invalid';
  end if;

  v_fingerprint := pg_catalog.encode(extensions.digest(
    pg_catalog.jsonb_build_object(
      'operation', 'creator_premium_submission_with_plans',
      'actor_id', v_actor,
      'content_id', p_content_id,
      'plan_ids', v_selected_plan_ids
    )::text,
    'sha256'
  ), 'hex');

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'creator-premium-submission-request:' || v_actor::text || ':' || p_client_request_id::text,
      0
    )
  );

  select command.* into v_command
  from public.idempotency_keys command
  where command.idempotency_key = p_client_request_id::text
    and command.operation_type = 'creator_premium_submission_with_plans'
    and command.user_id = v_actor
  for update;

  if found then
    if v_command.request_hash is distinct from v_fingerprint
       or v_command.status <> 'completed'
       or v_command.response_body is null then
      raise exception using errcode = '23505', message = 'creator_premium_submission_idempotency_conflict';
    end if;
    return query select
      (v_command.response_body ->> 'content_id')::uuid,
      v_command.response_body ->> 'lifecycle_status',
      (v_command.response_body ->> 'submission_ready')::boolean,
      array(
        select value::uuid
        from pg_catalog.jsonb_array_elements_text(
          v_command.response_body -> 'active_plan_ids'
        ) item(value)
      ),
      array(
        select value::uuid
        from pg_catalog.jsonb_array_elements_text(
          v_command.response_body -> 'versioned_plan_ids'
        ) item(value)
      ),
      true;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-premium-content:' || p_content_id::text, 0)
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
  if v_content.access_mode in ('subscription','purchase_or_subscription')
     and pg_catalog.cardinality(v_selected_plan_ids) = 0 then
    raise exception using errcode = '55000', message = 'creator_premium_active_plan_required';
  end if;
  if v_content.access_mode = 'purchase'
     and pg_catalog.cardinality(v_selected_plan_ids) <> 0 then
    raise exception using errcode = '22023', message = 'creator_premium_plan_selection_not_allowed';
  end if;

  select count(*) into v_count
  from private.creator_premium_plans plan
  where plan.id = any(v_selected_plan_ids)
    and plan.creator_id = v_actor
    and plan.status = 'active';
  if v_count <> pg_catalog.cardinality(v_selected_plan_ids) then
    raise exception using errcode = '55000', message = 'creator_premium_active_plan_required';
  end if;

  perform plan.id
  from private.creator_premium_plans plan
  where plan.creator_id = v_actor
    and plan.status = 'active'
    and (
      plan.id = any(v_selected_plan_ids)
      or exists (
        select 1
        from private.creator_premium_plan_contents mapping
        where mapping.plan_id = plan.id
          and mapping.creator_id = v_actor
          and mapping.content_id = p_content_id
      )
    )
  order by plan.id
  for update;

  for v_plan in
    select
      plan.id,
      coalesce(
        pg_catalog.array_agg(mapping.content_id order by mapping.content_id)
          filter (where mapping.content_id is not null),
        '{}'::uuid[]
      ) as mapped_content_ids
    from private.creator_premium_plans plan
    left join private.creator_premium_plan_contents mapping
      on mapping.plan_id = plan.id
     and mapping.creator_id = plan.creator_id
    where plan.creator_id = v_actor
      and plan.status = 'active'
      and (
        plan.id = any(v_selected_plan_ids)
        or exists (
          select 1
          from private.creator_premium_plan_contents target_mapping
          where target_mapping.plan_id = plan.id
            and target_mapping.creator_id = v_actor
            and target_mapping.content_id = p_content_id
        )
      )
    group by plan.id
    order by plan.id
  loop
    v_selected := v_plan.id = any(v_selected_plan_ids);
    v_mapped := p_content_id = any(v_plan.mapped_content_ids);
    if v_selected = v_mapped then
      continue;
    end if;

    if v_selected then
      select pg_catalog.array_agg(distinct item order by item)
      into v_next_content_ids
      from pg_catalog.unnest(pg_catalog.array_append(v_plan.mapped_content_ids, p_content_id)) item;
    else
      select coalesce(pg_catalog.array_agg(item order by item), '{}'::uuid[])
      into v_next_content_ids
      from pg_catalog.unnest(v_plan.mapped_content_ids) item
      where item <> p_content_id;
    end if;

    if pg_catalog.cardinality(v_next_content_ids) = 0 then
      v_retire_plan_ids := pg_catalog.array_append(v_retire_plan_ids, v_plan.id);
      continue;
    end if;

    v_clone_request_id := pg_catalog.md5(
      p_client_request_id::text || ':' || v_plan.id::text
        || case when v_selected then ':add' else ':remove' end
    )::uuid;
    select clone.* into v_clone
    from public.clone_my_creator_premium_plan_version_v1(
      v_plan.id,
      v_clone_request_id
    ) clone;
    perform 1
    from public.set_my_creator_premium_plan_contents_v1(
      v_clone.id,
      v_next_content_ids
    );
    v_activate_plan_ids := pg_catalog.array_append(v_activate_plan_ids, v_clone.id);
    v_versioned_plan_ids := pg_catalog.array_append(v_versioned_plan_ids, v_clone.id);
  end loop;

  select submission.* into v_submission
  from public.submit_my_creator_premium_content_for_review_v1(p_content_id) submission;

  foreach v_plan_id in array v_activate_plan_ids loop
    perform 1 from public.activate_my_creator_premium_plan_v1(v_plan_id);
  end loop;
  foreach v_plan_id in array v_retire_plan_ids loop
    perform 1 from public.retire_my_creator_premium_plan_v1(v_plan_id);
  end loop;

  select coalesce(pg_catalog.array_agg(plan.id order by plan.id), '{}'::uuid[])
  into v_actual_active_plan_ids
  from private.creator_premium_plan_contents mapping
  join private.creator_premium_plans plan
    on plan.id = mapping.plan_id
   and plan.creator_id = mapping.creator_id
  where mapping.content_id = p_content_id
    and mapping.creator_id = v_actor
    and plan.status = 'active';

  if v_content.access_mode in ('subscription','purchase_or_subscription')
     and pg_catalog.cardinality(v_actual_active_plan_ids) = 0 then
    raise exception using errcode = '55000', message = 'creator_premium_active_plan_required';
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'content_id', v_submission.content_id,
    'lifecycle_status', v_submission.lifecycle_status,
    'submission_ready', v_submission.submission_ready,
    'active_plan_ids', v_actual_active_plan_ids,
    'versioned_plan_ids', v_versioned_plan_ids
  );
  insert into public.idempotency_keys(
    idempotency_key, operation_type, user_id, request_hash, status, response_body
  ) values (
    p_client_request_id::text,
    'creator_premium_submission_with_plans',
    v_actor,
    v_fingerprint,
    'completed',
    v_response
  );

  return query select
    v_submission.content_id,
    v_submission.lifecycle_status,
    v_submission.submission_ready,
    v_actual_active_plan_ids,
    v_versioned_plan_ids,
    false;
end;
$$;

create function public.retire_my_creator_premium_content_v1(
  p_content_id uuid
)
returns table (
  content_id uuid,
  lifecycle_status text,
  removed_at timestamptz,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_content private.creator_premium_contents;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;
  if p_content_id is null then
    raise exception using errcode = '22023', message = 'creator_premium_invalid_content';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-premium-content:' || p_content_id::text, 0)
  );
  select content.* into v_content
  from private.creator_premium_contents content
  where content.id = p_content_id
    and content.creator_id = v_actor
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'creator_premium_content_not_found';
  end if;
  if v_content.lifecycle_status = 'removed'
     and v_content.removal_reason = 'creator_withdrawn' then
    return query select v_content.id, v_content.lifecycle_status,
      v_content.removed_at, true;
    return;
  end if;
  if v_content.lifecycle_status <> 'published' then
    raise exception using errcode = '55000', message = 'creator_premium_content_published_only';
  end if;

  -- A new subscription takes a foreign-key key-share lock on its plan. Locking
  -- every currently mapped plan therefore closes the race between the
  -- financial-history check and a concurrent entitlement purchase.
  perform plan.id
  from private.creator_premium_plan_contents mapping
  join private.creator_premium_plans plan
    on plan.id = mapping.plan_id
   and plan.creator_id = mapping.creator_id
  where mapping.content_id = v_content.id
    and mapping.creator_id = v_actor
  order by plan.id
  for update of plan;

  if private.creator_premium_content_has_financial_history(v_content.id) then
    raise exception using errcode = '55000', message = 'creator_premium_content_has_financial_history';
  end if;

  update private.creator_premium_offer_versions offer
  set status = 'retired',
      retired_at = coalesce(offer.retired_at, v_now),
      updated_at = v_now
  where offer.content_id = v_content.id
    and offer.creator_id = v_actor
    and offer.status = 'active';

  update private.creator_premium_contents content
  set lifecycle_status = 'removed',
      removed_at = v_now,
      reviewed_at = v_now,
      reviewed_by = v_actor,
      review_reason = 'Retirado por el creador',
      removal_reason = 'creator_withdrawn',
      updated_at = v_now
  where content.id = v_content.id
  returning content.* into v_content;

  return query select v_content.id, v_content.lifecycle_status,
    v_content.removed_at, false;
end;
$$;

create function public.delete_my_creator_premium_plan_draft_v1(
  p_plan_id uuid,
  p_client_request_id uuid
)
returns table (
  id uuid,
  status text,
  deleted boolean,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_plan private.creator_premium_plans;
  v_command public.idempotency_keys;
  v_fingerprint text;
  v_response jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'creator_premium_auth_required';
  end if;
  if not private.current_user_is_creator_exclusive_age_eligible() then
    raise exception using errcode = '42501', message = 'creator_premium_age_eligibility_required';
  end if;
  if not private.creator_premium_actor_is_operational_v1(v_actor) then
    raise exception using errcode = '42501', message = 'creator_premium_account_restricted';
  end if;
  if p_plan_id is null or p_client_request_id is null then
    raise exception using errcode = '22023', message = 'creator_premium_plan_delete_invalid';
  end if;

  v_fingerprint := pg_catalog.encode(extensions.digest(
    pg_catalog.concat_ws('|', 'creator_premium_plan_delete', v_actor::text, p_plan_id::text),
    'sha256'
  ), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'creator-premium-plan-delete-request:' || v_actor::text || ':' || p_client_request_id::text,
      0
    )
  );
  select command.* into v_command
  from public.idempotency_keys command
  where command.idempotency_key = p_client_request_id::text
    and command.operation_type = 'creator_premium_plan_delete'
    and command.user_id = v_actor
  for update;
  if found then
    if v_command.request_hash is distinct from v_fingerprint
       or v_command.status <> 'completed'
       or v_command.response_body is null then
      raise exception using errcode = '23505', message = 'creator_premium_plan_delete_idempotency_conflict';
    end if;
    return query select
      (v_command.response_body ->> 'id')::uuid,
      v_command.response_body ->> 'status',
      true,
      true;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-premium-plan:' || p_plan_id::text, 0)
  );
  select plan.* into v_plan
  from private.creator_premium_plans plan
  where plan.id = p_plan_id
    and plan.creator_id = v_actor
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'creator_premium_plan_not_found';
  end if;
  if v_plan.status <> 'draft' then
    raise exception using errcode = '55000', message = 'creator_premium_plan_draft_only';
  end if;
  if private.creator_premium_plan_has_dependencies(v_plan.id) then
    raise exception using errcode = '55000', message = 'creator_premium_plan_has_dependencies';
  end if;

  delete from private.creator_premium_plans plan
  where plan.id = v_plan.id
    and plan.creator_id = v_actor;

  v_response := pg_catalog.jsonb_build_object(
    'id', v_plan.id,
    'status', 'deleted',
    'deleted', true
  );
  insert into public.idempotency_keys(
    idempotency_key, operation_type, user_id, request_hash, status, response_body
  ) values (
    p_client_request_id::text,
    'creator_premium_plan_delete',
    v_actor,
    v_fingerprint,
    'completed',
    v_response
  );

  return query select v_plan.id, 'deleted'::text, true, false;
end;
$$;

revoke all on function public.submit_my_creator_premium_content_with_plans_v1(uuid,uuid[],uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_my_creator_premium_content_with_plans_v1(uuid,uuid[],uuid)
  to authenticated;

revoke all on function public.retire_my_creator_premium_content_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.retire_my_creator_premium_content_v1(uuid)
  to authenticated;

revoke all on function public.delete_my_creator_premium_plan_draft_v1(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_my_creator_premium_plan_draft_v1(uuid,uuid)
  to authenticated;

-- The owner is explicit so production and disposable installs produce the
-- same audited function identity. Internal grants are confined to postgres;
-- no client/service role gains direct table access.
grant execute on function private.current_user_is_creator_exclusive_age_eligible()
  to postgres;
grant execute on function private.creator_premium_actor_is_operational_v1(uuid)
  to postgres;
grant execute on function private.creator_premium_content_has_financial_history(uuid)
  to postgres;
grant execute on function private.creator_premium_plan_has_dependencies(uuid)
  to postgres;
grant execute on function public.clone_my_creator_premium_plan_version_v1(uuid,uuid)
  to postgres;
grant execute on function public.set_my_creator_premium_plan_contents_v1(uuid,uuid[])
  to postgres;
grant execute on function public.submit_my_creator_premium_content_for_review_v1(uuid)
  to postgres;
grant execute on function public.activate_my_creator_premium_plan_v1(uuid)
  to postgres;
grant execute on function public.retire_my_creator_premium_plan_v1(uuid)
  to postgres;

grant select, insert, update, delete on table public.idempotency_keys to postgres;
grant select, update on table private.creator_premium_contents to postgres;
grant select, update, delete on table private.creator_premium_plans to postgres;
grant select on table private.creator_premium_plan_contents to postgres;
grant select, update on table private.creator_premium_offer_versions to postgres;
grant select on table private.creator_premium_purchase_receipts to postgres;
grant select on table private.creator_premium_subscriptions to postgres;
grant select on table private.creator_premium_subscription_periods to postgres;

alter function private.creator_premium_content_has_financial_history(uuid)
  owner to postgres;
alter function private.creator_premium_plan_has_dependencies(uuid)
  owner to postgres;
alter function public.submit_my_creator_premium_content_with_plans_v1(uuid,uuid[],uuid)
  owner to postgres;
alter function public.retire_my_creator_premium_content_v1(uuid)
  owner to postgres;
alter function public.delete_my_creator_premium_plan_draft_v1(uuid,uuid)
  owner to postgres;

comment on function public.submit_my_creator_premium_content_with_plans_v1(uuid,uuid[],uuid) is
  'Atomically versions active plan membership, submits through the canonical safety authority, and activates the resulting immutable versions.';
comment on function public.retire_my_creator_premium_content_v1(uuid) is
  'Owner withdrawal for published content with no financial history; media and historical records are preserved.';
comment on function public.delete_my_creator_premium_plan_draft_v1(uuid,uuid) is
  'Idempotently deletes only an owner draft plan with no mappings, subscriptions, or periods.';

notify pgrst, 'reload schema';

commit;
