begin;

create or replace function public.reserve_stream_upload_asset(
  p_asset_id uuid,
  p_owner_id uuid,
  p_mime_type text,
  p_size_bytes bigint,
  p_original_filename text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_recent_count integer;
  v_active_count integer;
begin
  if p_asset_id is null or p_owner_id is null then
    raise exception 'invalid_stream_reservation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 0));

  select count(*)
    into v_recent_count
    from public.video_assets
   where owner_id = p_owner_id
     and created_at >= now() - interval '60 seconds';

  if v_recent_count >= 5 then
    return 'rate_limited';
  end if;

  select count(*)
    into v_active_count
    from public.video_assets
   where owner_id = p_owner_id
     and status in ('pending', 'uploading', 'processing');

  if v_active_count >= 3 then
    return 'active_limit_reached';
  end if;

  insert into public.video_assets (
    id, owner_id, provider, purpose, visibility, status, mime_type,
    size_bytes, original_filename, max_duration_seconds
  ) values (
    p_asset_id, p_owner_id, 'cloudflare_stream', 'feed_video', 'public',
    'pending', p_mime_type, p_size_bytes, p_original_filename, 60
  );

  return 'created';
end;
$$;

comment on function public.reserve_stream_upload_asset(uuid,uuid,text,bigint,text) is
  'Atomically enforces per-owner Stream upload limits and reserves one pending feed video asset.';

revoke all on function public.reserve_stream_upload_asset(uuid,uuid,text,bigint,text)
  from public, anon, authenticated;
grant execute on function public.reserve_stream_upload_asset(uuid,uuid,text,bigint,text)
  to service_role;

notify pgrst, 'reload schema';
commit;
