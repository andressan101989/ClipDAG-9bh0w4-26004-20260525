begin;

create or replace function private.guard_ready_media_asset_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- ready_at is intentionally used instead of the current status so the
  -- physical identity remains locked throughout delete_pending/deleted states.
  if old.ready_at is not null and (
    new.owner_id is distinct from old.owner_id
    or new.provider is distinct from old.provider
    or new.media_kind is distinct from old.media_kind
    or new.purpose is distinct from old.purpose
    or new.visibility is distinct from old.visibility
    or new.bucket_name is distinct from old.bucket_name
    or new.object_key is distinct from old.object_key
    or new.mime_type is distinct from old.mime_type
    or new.size_bytes is distinct from old.size_bytes
    or new.etag is distinct from old.etag
  ) then
    raise exception using
      errcode = '55000',
      message = 'media_asset_ready_identity_immutable';
  end if;
  return new;
end;
$$;

create or replace function private.guard_ready_video_asset_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.ready_at is not null and (
    new.owner_id is distinct from old.owner_id
    or new.provider is distinct from old.provider
    or new.purpose is distinct from old.purpose
    or new.visibility is distinct from old.visibility
    or new.cloudflare_uid is distinct from old.cloudflare_uid
    or new.mime_type is distinct from old.mime_type
    or new.size_bytes is distinct from old.size_bytes
    or new.max_duration_seconds is distinct from old.max_duration_seconds
  ) then
    raise exception using
      errcode = '55000',
      message = 'video_asset_ready_identity_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists media_assets_guard_ready_identity on public.media_assets;
create trigger media_assets_guard_ready_identity
before update on public.media_assets
for each row
execute function private.guard_ready_media_asset_identity();

drop trigger if exists video_assets_guard_ready_identity on public.video_assets;
create trigger video_assets_guard_ready_identity
before update on public.video_assets
for each row
execute function private.guard_ready_video_asset_identity();

revoke all on function private.guard_ready_media_asset_identity() from public, anon, authenticated;
revoke all on function private.guard_ready_video_asset_identity() from public, anon, authenticated;
grant execute on function private.guard_ready_media_asset_identity() to service_role;
grant execute on function private.guard_ready_video_asset_identity() to service_role;

comment on function private.guard_ready_media_asset_identity() is
  'Locks canonical R2 identity and authorization-class fields permanently after ready_at is set while allowing lifecycle cleanup metadata updates.';
comment on function private.guard_ready_video_asset_identity() is
  'Locks canonical Stream UID and immutable upload identity fields permanently after ready_at is set while allowing provider reconciliation and lifecycle metadata updates.';

commit;
