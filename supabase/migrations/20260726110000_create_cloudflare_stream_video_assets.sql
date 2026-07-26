begin;

create table public.video_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'cloudflare_stream',
  purpose text not null,
  visibility text not null default 'public',
  status text not null default 'pending',
  cloudflare_uid text unique,
  mime_type text not null,
  size_bytes bigint not null,
  original_filename text,
  max_duration_seconds integer not null default 60,
  duration_seconds numeric,
  width integer,
  height integer,
  hls_url text,
  dash_url text,
  thumbnail_url text,
  upload_expires_at timestamptz,
  provider_status text,
  provider_progress numeric,
  provider_metadata jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  last_provider_check_at timestamptz,
  ready_at timestamptz,
  delete_attempts integer not null default 0,
  next_cleanup_attempt_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint video_assets_provider_check
    check (provider = 'cloudflare_stream'),
  constraint video_assets_purpose_check
    check (purpose = 'feed_video'),
  constraint video_assets_visibility_check
    check (visibility in ('public', 'private')),
  constraint video_assets_status_check
    check (status in ('pending','uploading','processing','ready','failed','delete_pending','deleted')),
  constraint video_assets_size_check
    check (size_bytes > 0 and size_bytes <= 200000000),
  constraint video_assets_duration_limit_check
    check (max_duration_seconds > 0 and max_duration_seconds <= 60),
  constraint video_assets_dimensions_check
    check ((width is null or width > 0) and (height is null or height > 0)),
  constraint video_assets_urls_check
    check (
      (status = 'ready' or (hls_url is null and dash_url is null and thumbnail_url is null))
      and (hls_url is null or hls_url ~ '^https://')
      and (dash_url is null or dash_url ~ '^https://')
      and (thumbnail_url is null or thumbnail_url ~ '^https://')
    ),
  constraint video_assets_deleted_at_check
    check (status = 'deleted' or deleted_at is null)
);

create index video_assets_owner_created_idx
  on public.video_assets(owner_id, created_at desc);
create index video_assets_status_updated_idx
  on public.video_assets(status, updated_at);
create index video_assets_cloudflare_uid_idx
  on public.video_assets(cloudflare_uid);
create index video_assets_cleanup_idx
  on public.video_assets(status, next_cleanup_attempt_at);
create index video_assets_owner_status_idx
  on public.video_assets(owner_id, status);

create table public.video_asset_links (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.video_assets(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  slot text not null default 'video',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  constraint video_asset_links_entity_type_check
    check (entity_type in ('video_post','story','exclusive_content','ai_avatar')),
  constraint video_asset_links_position_check
    check (position >= 0),
  constraint video_asset_links_unique_entity_slot_position
    unique(entity_type, entity_id, slot, position),
  constraint video_asset_links_unique_asset_entity_slot_position
    unique(asset_id, entity_type, entity_id, slot, position)
);

create index video_asset_links_asset_idx
  on public.video_asset_links(asset_id);
create index video_asset_links_entity_idx
  on public.video_asset_links(entity_type, entity_id);
create index video_asset_links_owner_idx
  on public.video_asset_links(owner_id);

create or replace function public.set_video_asset_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger video_assets_set_updated_at
before update on public.video_assets
for each row execute function public.set_video_asset_updated_at();

alter table public.video_assets enable row level security;
alter table public.video_asset_links enable row level security;

create policy video_assets_select_own
on public.video_assets
for select
to authenticated
using (owner_id = auth.uid());

create policy video_asset_links_select_own
on public.video_asset_links
for select
to authenticated
using (owner_id = auth.uid());

revoke all on public.video_assets from public, anon, authenticated;
revoke all on public.video_asset_links from public, anon, authenticated;
grant select on public.video_assets to authenticated;
grant select on public.video_asset_links to authenticated;
grant all on public.video_assets to service_role;
grant all on public.video_asset_links to service_role;

comment on table public.video_assets is
  'Authoritative Cloudflare Stream VOD lifecycle records. Temporary upload URLs are never persisted.';
comment on table public.video_asset_links is
  'Server-managed links between Stream assets and ClipDAG entities.';

notify pgrst, 'reload schema';
commit;
