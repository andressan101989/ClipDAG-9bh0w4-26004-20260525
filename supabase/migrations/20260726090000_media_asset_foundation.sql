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
  status text not null default 'pending' check (status in ('pending','uploading','ready','failed','delete_pending','deleted')),
  error_code text,
  cleanup_attempts integer not null default 0 check (cleanup_attempts >= 0),
  last_cleanup_attempt_at timestamptz,
  next_cleanup_attempt_at timestamptz,
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
create index if not exists media_assets_cleanup_idx on public.media_assets(status, next_cleanup_attempt_at)
  where status = 'delete_pending';
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
declare v_id uuid; v_authorized boolean := false;
begin
  if p_entity_type not in ('user_profile','video_post','story','shop_product','exclusive_content') then raise exception 'invalid_entity_type'; end if;
  if p_position<0 then raise exception 'invalid_position'; end if;
  perform 1 from public.media_assets where id=p_asset_id and owner_id=auth.uid() and status='ready';
  if not found then raise exception 'asset_not_ready_or_owned'; end if;
  case p_entity_type
    when 'user_profile' then v_authorized := p_entity_id = auth.uid();
    when 'video_post' then
      select exists(select 1 from public.videos where id=p_entity_id and user_id=auth.uid()) into v_authorized;
    when 'story' then
      select exists(select 1 from public.stories where id=p_entity_id and user_id=auth.uid()) into v_authorized;
    when 'shop_product' then
      select exists(select 1 from public.products where id=p_entity_id and seller_id=auth.uid()) into v_authorized;
    when 'exclusive_content' then
      select exists(select 1 from public.exclusive_content where id=p_entity_id and creator_id=auth.uid()) into v_authorized;
    else v_authorized := false;
  end case;
  if not v_authorized then raise exception 'entity_not_owned'; end if;
  insert into public.media_asset_links(asset_id,entity_type,entity_id,slot,position)
  values(p_asset_id,p_entity_type,p_entity_id,p_slot,p_position)
  on conflict(asset_id,entity_type,entity_id,slot,position) do update set slot=excluded.slot
  returning id into v_id;
  return v_id;
end; $$;
revoke all on function public.link_media_asset(uuid,text,uuid,text,integer) from public,anon;
grant execute on function public.link_media_asset(uuid,text,uuid,text,integer) to authenticated;

create or replace function public.cleanup_stale_media_upload_records(p_limit integer default 50)
returns table(id uuid, bucket_name text, object_key text, cleanup_attempts integer)
language plpgsql security definer set search_path=public as $$
begin
  update public.media_assets a
  set status='delete_pending', error_code='upload_expired',
      next_cleanup_attempt_at=coalesce(a.next_cleanup_attempt_at,now()), updated_at=now()
  where a.status in ('pending','uploading') and a.created_at < now() - interval '1 hour';

  update public.media_assets a
  set status='delete_pending', error_code='orphan_ready',
      next_cleanup_attempt_at=coalesce(a.next_cleanup_attempt_at,now()), updated_at=now()
  where a.status='ready' and a.created_at < now() - interval '24 hours'
    and not exists(select 1 from public.media_asset_links l where l.asset_id=a.id);

  return query
  with claimed as (
    select a.id
    from public.media_assets a
    where a.status='delete_pending'
      and coalesce(a.next_cleanup_attempt_at,now()) <= now()
    order by coalesce(a.next_cleanup_attempt_at,a.created_at),a.created_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,50),100))
  )
  update public.media_assets a
  set cleanup_attempts=a.cleanup_attempts+1,
      last_cleanup_attempt_at=now(),
      next_cleanup_attempt_at=now()+make_interval(
        secs => least(21600, 30 * power(2,least(a.cleanup_attempts,9))::integer)
      ),
      updated_at=now()
  from claimed c where a.id=c.id
  returning a.id,a.bucket_name,a.object_key,a.cleanup_attempts;
end;
$$;
revoke all on function public.cleanup_stale_media_upload_records(integer) from public,anon,authenticated;
grant execute on function public.cleanup_stale_media_upload_records(integer) to service_role;

create or replace function public.wake_stale_media_cleanup()
returns bigint language plpgsql security definer set search_path=public,vault,net as $$
declare v_url text; v_key text; v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name='media_cleanup_project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name='media_cleanup_publishable_key';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='media_cleanup_secret';
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
