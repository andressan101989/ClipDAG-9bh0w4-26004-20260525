begin;

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('r2','cloudflare_stream','supabase_legacy')),
  media_kind text not null check (media_kind in ('image','audio','document','video')),
  purpose text not null,
  visibility text not null check (visibility in ('public','private')),
  bucket_name text not null,
  object_key text not null,
  mime_type text not null,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  original_filename text,
  etag text,
  width integer,
  height integer,
  duration_ms bigint,
  status text not null default 'pending' check (status in ('pending','uploading','ready','failed','deleted')),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ready_at timestamptz,
  deleted_at timestamptz,
  unique(bucket_name, object_key)
);

create table if not exists public.media_asset_links (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.media_assets(id) on delete cascade,
  entity_type text not null check (entity_type in ('user_profile','video_post','story','chat_message','shop_product','exclusive_content')),
  entity_id uuid not null,
  slot text not null,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  unique(asset_id, entity_type, entity_id, slot, position)
);

create index if not exists media_assets_owner_created_idx on public.media_assets(owner_id, created_at desc);
create index if not exists media_assets_stale_idx on public.media_assets(status, created_at);
create index if not exists media_asset_links_entity_idx on public.media_asset_links(entity_type, entity_id);

alter table public.media_assets enable row level security;
alter table public.media_asset_links enable row level security;

create policy media_assets_owner_read on public.media_assets for select to authenticated
  using (owner_id = auth.uid());
create policy media_assets_public_read on public.media_assets for select to anon, authenticated
  using (visibility = 'public' and status = 'ready');
create policy media_asset_links_owner_read on public.media_asset_links for select to authenticated
  using (exists(select 1 from public.media_assets a where a.id=asset_id and a.owner_id=auth.uid()));
create policy media_asset_links_public_read on public.media_asset_links for select to anon, authenticated
  using (exists(select 1 from public.media_assets a where a.id=asset_id and a.visibility='public' and a.status='ready'));

-- Mutations intentionally have no client policy. Only service_role Edge Functions
-- may choose keys/buckets or perform lifecycle transitions.

create or replace function public.link_media_asset(
  p_asset_id uuid,p_entity_type text,p_entity_id uuid,p_slot text,p_position integer default 0
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if p_entity_type not in ('user_profile','video_post','story','chat_message','shop_product','exclusive_content') then raise exception 'invalid_entity_type'; end if;
  if p_position<0 then raise exception 'invalid_position'; end if;
  perform 1 from public.media_assets where id=p_asset_id and owner_id=auth.uid() and status='ready';
  if not found then raise exception 'asset_not_ready_or_owned'; end if;
  insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
  values(p_asset_id,p_entity_type,p_entity_id,p_slot,p_position)
  on conflict(asset_id,entity_type,entity_id,slot,position) do update set slot=excluded.slot
  returning id into v_id;
  return v_id;
end; $$;
revoke all on function public.link_media_asset(uuid,text,uuid,text,integer) from public,anon;
grant execute on function public.link_media_asset(uuid,text,uuid,text,integer) to authenticated;

create or replace function public.cleanup_stale_media_upload_records()
returns table(id uuid, bucket_name text, object_key text)
language sql security definer set search_path=public as $$
  update public.media_assets
  set status='failed', error_code='upload_expired', updated_at=now()
  where status in ('pending','uploading') and created_at < now() - interval '1 hour'
  returning id,bucket_name,object_key;
$$;
revoke all on function public.cleanup_stale_media_upload_records() from public,anon,authenticated;
grant execute on function public.cleanup_stale_media_upload_records() to service_role;

create or replace function public.wake_stale_media_cleanup()
returns bigint language plpgsql security definer set search_path=public,vault,net as $$
declare v_url text; v_key text; v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name='call_dispatch_project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name='call_dispatch_publishable_key';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='call_dispatch_secret';
  if v_url is null or v_key is null or v_secret is null then raise exception 'media cleanup internal configuration missing'; end if;
  return net.http_post(
    url:=rtrim(v_url,'/')||'/functions/v1/cleanup-stale-media-uploads',
    headers:=jsonb_build_object('Content-Type','application/json','apikey',v_key,'X-Cleanup-Secret',v_secret),
    body:='{}'::jsonb,timeout_milliseconds:=50000
  );
end; $$;
revoke all on function public.wake_stale_media_cleanup() from public,anon,authenticated;
grant execute on function public.wake_stale_media_cleanup() to service_role;

do $$
begin
  if not exists(select 1 from cron.job where jobname='cleanup-stale-media-uploads') then
    perform cron.schedule('cleanup-stale-media-uploads','*/15 * * * *','select public.wake_stale_media_cleanup()');
  end if;
end; $$;

commit;
