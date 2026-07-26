begin;

alter table public.video_assets
  drop constraint if exists video_assets_urls_check,
  drop constraint if exists video_assets_deleted_at_check;

alter table public.video_assets
  add constraint video_assets_mime_type_check
    check (mime_type in ('video/mp4','video/quicktime','video/webm')),
  add constraint video_assets_ready_invariants_check
    check (
      (
        status = 'ready'
        and cloudflare_uid is not null
        and btrim(cloudflare_uid) <> ''
        and hls_url is not null
        and hls_url ~ '^https://'
        and (dash_url is null or dash_url ~ '^https://')
        and (thumbnail_url is null or thumbnail_url ~ '^https://')
        and ready_at is not null
        and duration_seconds is not null
        and duration_seconds > 0
        and duration_seconds <= max_duration_seconds
      )
      or
      (
        status <> 'ready'
        and hls_url is null
        and dash_url is null
        and thumbnail_url is null
      )
    ),
  add constraint video_assets_deleted_invariants_check
    check (
      status <> 'deleted'
      or (
        deleted_at is not null
        and hls_url is null
        and dash_url is null
        and thumbnail_url is null
      )
    );

comment on constraint video_assets_ready_invariants_check on public.video_assets is
  'Ready Stream assets require a provider UID, HTTPS HLS playback, ready timestamp, and valid bounded duration.';

notify pgrst, 'reload schema';
commit;
