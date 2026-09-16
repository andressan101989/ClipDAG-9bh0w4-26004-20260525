-- BUSINESS-WEB-BW-E
-- Business Media is a capability-scoped projection over canonical R2 and Stream assets.

alter table public.video_assets
  drop constraint video_assets_purpose_check;
alter table public.video_assets
  add constraint video_assets_purpose_check
  check (purpose in ('feed_video', 'business_library'));

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
  if p_asset_id is null or p_owner_id is null
    or p_purpose not in ('feed_video', 'business_library') then
    raise exception using errcode = '22023', message = 'invalid_stream_reservation';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner_id::text, 0));

  select count(*) into v_recent_count
  from public.video_assets
  where owner_id = p_owner_id
    and created_at >= now() - interval '60 seconds';
  if v_recent_count >= 5 then return 'rate_limited'; end if;

  select count(*) into v_active_count
  from public.video_assets
  where owner_id = p_owner_id
    and status in ('pending', 'uploading', 'processing');
  if v_active_count >= 3 then return 'active_limit_reached'; end if;

  insert into public.video_assets (
    id, owner_id, provider, purpose, visibility, status, mime_type,
    size_bytes, original_filename, max_duration_seconds
  ) values (
    p_asset_id, p_owner_id, 'cloudflare_stream', p_purpose, 'public',
    'pending', p_mime_type, p_size_bytes, p_original_filename, 60
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

revoke all on function public.reserve_stream_upload_asset(uuid, uuid, text, bigint, text, text) from public, anon, authenticated;
revoke all on function public.reserve_stream_upload_asset(uuid, uuid, text, bigint, text) from public, anon, authenticated;
grant execute on function public.reserve_stream_upload_asset(uuid, uuid, text, bigint, text, text) to service_role;
grant execute on function public.reserve_stream_upload_asset(uuid, uuid, text, bigint, text) to service_role;

create or replace function public.search_my_business_media(
  p_business_owner_id uuid,
  p_kind text default null,
  p_provider text default null,
  p_status text default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_source text default null,
  p_cursor_id uuid default null,
  p_asset_ids uuid[] default null,
  p_limit integer default 24
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 24), 1), 50);
  v_cursor_source_order integer;
  v_items jsonb;
  v_next_cursor jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if not (
    private.business_actor_has_capability(p_business_owner_id, 'business.media.read')
    or private.business_actor_has_capability(p_business_owner_id, 'business.media.manage')
  ) then
    raise exception using errcode = '42501', message = 'business_media_read_required';
  end if;
  if p_kind is not null and p_kind not in ('image', 'video') then
    raise exception using errcode = '22023', message = 'invalid_media_kind';
  end if;
  if p_provider is not null and p_provider not in ('r2', 'cloudflare_stream') then
    raise exception using errcode = '22023', message = 'invalid_media_provider';
  end if;
  if p_status is not null and p_status not in (
    'pending', 'uploading', 'processing', 'ready', 'failed', 'delete_pending', 'deleted'
  ) then
    raise exception using errcode = '22023', message = 'invalid_media_status';
  end if;
  if (p_cursor_created_at is null) <> (p_cursor_source is null)
    or (p_cursor_created_at is null) <> (p_cursor_id is null) then
    raise exception using errcode = '22023', message = 'invalid_media_cursor';
  end if;
  if p_cursor_source is not null and p_cursor_source not in ('media_asset', 'video_asset') then
    raise exception using errcode = '22023', message = 'invalid_media_cursor';
  end if;
  v_cursor_source_order := case p_cursor_source when 'video_asset' then 2 when 'media_asset' then 1 end;

  with unified as (
    select
      a.id as asset_id,
      'media_asset'::text as asset_source,
      1 as source_order,
      a.provider,
      a.media_kind,
      a.mime_type,
      a.status,
      a.purpose,
      a.visibility,
      a.size_bytes,
      a.created_at,
      a.ready_at,
      case when a.status = 'ready' then a.public_url else null end as preview_url,
      case when a.status = 'ready' and a.media_kind = 'video' then a.public_url else null end as playback_url,
      null::text as thumbnail_url,
      array_remove(array[
        case when a.purpose = 'business_library' then 'library' end,
        case when exists (
          select 1 from public.media_asset_links l
          join public.marketplace_stores s on s.id = l.entity_id
          where l.asset_id = a.id and l.entity_type = 'marketplace_store'
            and s.seller_id = p_business_owner_id
        ) then 'store' end,
        case when exists (
          select 1 from public.media_asset_links l
          join public.products p on p.id = l.entity_id
          where l.asset_id = a.id and l.entity_type = 'shop_product'
            and p.seller_id = p_business_owner_id
        ) then 'product' end
      ], null)::text[] as usage,
      (case when a.purpose = 'business_library' then 1 else 0 end)
      + (select count(*)::integer from public.media_asset_links l
         join public.marketplace_stores s on s.id = l.entity_id
         where l.asset_id = a.id and l.entity_type = 'marketplace_store'
           and s.seller_id = p_business_owner_id)
      + (select count(*)::integer from public.media_asset_links l
         join public.products p on p.id = l.entity_id
         where l.asset_id = a.id and l.entity_type = 'shop_product'
           and p.seller_id = p_business_owner_id) as usage_count,
      null::numeric as progress,
      a.error_code
    from public.media_assets a
    where a.owner_id = p_business_owner_id
      and a.provider = 'r2'
      and a.visibility = 'public'
      and (
        a.purpose = 'business_library'
        or exists (
          select 1 from public.media_asset_links l
          join public.marketplace_stores s on s.id = l.entity_id
          where l.asset_id = a.id and l.entity_type = 'marketplace_store'
            and s.seller_id = p_business_owner_id
        )
        or exists (
          select 1 from public.media_asset_links l
          join public.products p on p.id = l.entity_id
          where l.asset_id = a.id and l.entity_type = 'shop_product'
            and p.seller_id = p_business_owner_id
        )
      )

    union all

    select
      v.id,
      'video_asset'::text,
      2,
      v.provider,
      'video'::text,
      v.mime_type,
      v.status,
      v.purpose,
      v.visibility,
      v.size_bytes,
      v.created_at,
      v.ready_at,
      case when v.status = 'ready' then v.thumbnail_url else null end,
      case when v.status = 'ready' then v.hls_url else null end,
      case when v.status = 'ready' then v.thumbnail_url else null end,
      array['library']::text[],
      1,
      v.provider_progress,
      v.error_code
    from public.video_assets v
    where v.owner_id = p_business_owner_id
      and v.provider = 'cloudflare_stream'
      and v.purpose = 'business_library'
      and v.visibility = 'public'
  ), filtered as (
    select *
    from unified u
    where (p_kind is null or u.media_kind = p_kind)
      and (p_provider is null or u.provider = p_provider)
      and (p_status is null or u.status = p_status)
      and (p_asset_ids is null or u.asset_id = any(p_asset_ids))
      and (
        p_cursor_created_at is null
        or (u.created_at, u.source_order, u.asset_id)
          < (p_cursor_created_at, v_cursor_source_order, p_cursor_id)
      )
    order by u.created_at desc, u.source_order desc, u.asset_id desc
    limit v_limit + 1
  ), numbered as (
    select f.*, row_number() over (
      order by f.created_at desc, f.source_order desc, f.asset_id desc
    ) as row_number
    from filtered f
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'asset_id', n.asset_id,
        'asset_source', n.asset_source,
        'provider', n.provider,
        'media_kind', n.media_kind,
        'mime_type', n.mime_type,
        'status', n.status,
        'purpose', n.purpose,
        'visibility', n.visibility,
        'size_bytes', n.size_bytes,
        'created_at', n.created_at,
        'ready_at', n.ready_at,
        'preview_url', n.preview_url,
        'playback_url', n.playback_url,
        'thumbnail_url', n.thumbnail_url,
        'usage', to_jsonb(n.usage),
        'usage_count', n.usage_count,
        'progress', n.progress,
        'error_code', n.error_code
      ) order by n.created_at desc, n.source_order desc, n.asset_id desc
    ) filter (where n.row_number <= v_limit), '[]'::jsonb),
    case when count(*) > v_limit then (
      select jsonb_build_object(
        'created_at', c.created_at,
        'source', c.asset_source,
        'asset_id', c.asset_id
      )
      from numbered c where c.row_number = v_limit
    ) else null end
  into v_items, v_next_cursor
  from numbered n;

  return jsonb_build_object('items', v_items, 'next_cursor', v_next_cursor);
end;
$$;

revoke all on function public.search_my_business_media(uuid, text, text, text, timestamptz, text, uuid, uuid[], integer) from public, anon;
grant execute on function public.search_my_business_media(uuid, text, text, text, timestamptz, text, uuid, uuid[], integer) to authenticated;

create or replace function public.set_marketplace_store_media(
  p_store_id uuid,
  p_logo_asset_id uuid default null,
  p_banner_asset_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_owner_id uuid;
  v_store_status text;
  v_previous_logo uuid;
  v_previous_banner uuid;
begin
  select s.seller_id, s.status, s.logo_asset_id, s.banner_asset_id
  into v_business_owner_id, v_store_status, v_previous_logo, v_previous_banner
  from public.marketplace_stores s
  where s.id = p_store_id
  for update;

  if v_business_owner_id is null or v_store_status = 'suspended' then
    raise exception using errcode = '42501', message = 'store_not_editable';
  end if;
  perform private.business_require_capability(v_business_owner_id, 'business.store.manage');
  if not (
    private.business_actor_has_capability(v_business_owner_id, 'business.media.read')
    or private.business_actor_has_capability(v_business_owner_id, 'business.media.manage')
  ) then
    raise exception using errcode = '42501', message = 'business_media_read_required';
  end if;

  if p_logo_asset_id is not null and not exists (
    select 1
    from public.media_assets a
    where a.id = p_logo_asset_id
      and a.owner_id = v_business_owner_id
      and a.provider = 'r2'
      and a.status = 'ready'
      and a.visibility = 'public'
      and a.media_kind = 'image'
      and (
        a.purpose in ('store_logo', 'business_library')
        or (a.purpose = 'product_image' and exists (
          select 1 from public.media_asset_links l
          join public.products p on p.id = l.entity_id
          where l.asset_id = a.id and l.entity_type = 'shop_product'
            and p.seller_id = v_business_owner_id
        ))
      )
  ) then
    raise exception using errcode = '42501', message = 'store_logo_not_ready_or_owned';
  end if;

  if p_banner_asset_id is not null and not exists (
    select 1
    from public.media_assets a
    where a.id = p_banner_asset_id
      and a.owner_id = v_business_owner_id
      and a.provider = 'r2'
      and a.status = 'ready'
      and a.visibility = 'public'
      and a.media_kind = 'image'
      and (
        a.purpose in ('store_banner', 'business_library')
        or (a.purpose = 'product_image' and exists (
          select 1 from public.media_asset_links l
          join public.products p on p.id = l.entity_id
          where l.asset_id = a.id and l.entity_type = 'shop_product'
            and p.seller_id = v_business_owner_id
        ))
      )
  ) then
    raise exception using errcode = '42501', message = 'store_banner_not_ready_or_owned';
  end if;

  delete from public.media_asset_links
  where entity_type = 'marketplace_store'
    and entity_id = p_store_id
    and slot in ('logo', 'banner');

  if p_logo_asset_id is not null then
    insert into public.media_asset_links(asset_id, entity_type, entity_id, slot, position)
    values(p_logo_asset_id, 'marketplace_store', p_store_id, 'logo', 0);
  end if;
  if p_banner_asset_id is not null then
    insert into public.media_asset_links(asset_id, entity_type, entity_id, slot, position)
    values(p_banner_asset_id, 'marketplace_store', p_store_id, 'banner', 0);
  end if;

  update public.marketplace_stores
  set logo_asset_id = p_logo_asset_id, banner_asset_id = p_banner_asset_id
  where id = p_store_id;

  update public.media_assets a
  set status = 'delete_pending',
      error_code = 'store_media_replaced',
      next_cleanup_attempt_at = coalesce(a.next_cleanup_attempt_at, now()),
      updated_at = now()
  where a.owner_id = v_business_owner_id
    and a.id in (v_previous_logo, v_previous_banner)
    and a.id is distinct from p_logo_asset_id
    and a.id is distinct from p_banner_asset_id
    and a.purpose in ('store_logo', 'store_banner')
    and not public.media_asset_has_valid_links(a.id);
end;
$$;

revoke all on function public.set_marketplace_store_media(uuid, uuid, uuid) from public, anon;
grant execute on function public.set_marketplace_store_media(uuid, uuid, uuid) to authenticated;

comment on function public.search_my_business_media(uuid, text, text, text, timestamptz, text, uuid, uuid[], integer) is
  'Capability-scoped bounded projection of canonical business R2 and Stream assets.';
