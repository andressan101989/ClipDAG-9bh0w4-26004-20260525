begin;

-- ADMIN-SUPERUSER-UX-P1 is projection-only. It makes media kind explicit and
-- adds a server-side presentation conversion without mutating canonical media
-- or financial authorities.
create or replace function public.get_admin_content_detail(
  p_target_type text,
  p_target_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform public.admin_require_capability('content.items.read');

  if p_target_type = 'video' then
    with base as (
      select
        v.id,
        v.user_id,
        v.caption,
        v.created_at,
        v.likes_count,
        v.comments_count,
        v.views_count,
        v.video_url,
        v.thumbnail_url,
        p.username,
        p.display_name,
        p.avatar_url,
        coalesce(ms.visibility, 'visible') as moderation_visibility
      from public.videos v
      left join public.public_user_profiles p on p.id = v.user_id
      left join private.admin_content_moderation_state ms
        on ms.target_type = 'video' and ms.target_id = v.id
      where v.id = p_target_id
    ),
    canonical_stream as (
      select
        l.entity_id,
        a.id as video_asset_id,
        a.hls_url,
        a.thumbnail_url
      from public.video_asset_links l
      join public.video_assets a on a.id = l.asset_id
      where l.entity_type = 'video_post'
        and l.entity_id = p_target_id
        and l.slot = 'video'
        and l.position = 0
        and a.provider = 'cloudflare_stream'
        and a.status = 'ready'
        and a.visibility = 'public'
        and a.deleted_at is null
        and a.hls_url ~* '^https://'
      order by l.created_at, l.id
      limit 1
    ),
    canonical_r2 as (
      select
        l.entity_id,
        a.id as media_asset_id,
        case
          when a.media_kind = 'image' and a.mime_type ~* '^image/' then 'image'
          when a.media_kind = 'video' and a.mime_type ~* '^video/' then 'video'
          else null
        end as media_kind,
        a.public_url
      from public.media_asset_links l
      join public.media_assets a on a.id = l.asset_id
      where l.entity_type = 'video_post'
        and l.entity_id = p_target_id
        and l.slot = 'media'
        and l.position = 0
        and a.provider = 'r2'
        and a.status = 'ready'
        and a.visibility = 'public'
        and a.deleted_at is null
        and a.public_url ~* '^https://'
        and (
          (a.media_kind = 'image' and a.mime_type ~* '^image/')
          or (a.media_kind = 'video' and a.mime_type ~* '^video/')
        )
      order by l.created_at, l.id
      limit 1
    ),
    classified as (
      select
        b.*,
        s.video_asset_id,
        r.media_asset_id,
        case
          when s.video_asset_id is not null then 'video'
          when r.media_asset_id is not null then r.media_kind
          when b.video_url ~* '^https://' and lower(split_part(b.video_url, '?', 1)) ~ '\.(jpe?g|png|webp|gif)$' then 'image'
          when b.video_url ~* '^https://' and (
            lower(split_part(b.video_url, '?', 1)) ~ '\.(m3u8|mp4|webm|mov)$'
            or (b.video_url ~* '(cloudflarestream\.com|videodelivery\.net)' and b.video_url ~* '\.m3u8($|\?)')
          ) then 'video'
          when coalesce(b.video_url, '') = '' and b.thumbnail_url ~* '^https://'
            and lower(split_part(b.thumbnail_url, '?', 1)) ~ '\.(jpe?g|png|webp|gif)$' then 'image'
          else null
        end as resolved_kind,
        case
          when s.video_asset_id is not null then 'cloudflare_stream'
          when r.media_asset_id is not null then 'r2'
          when b.video_url ~* '^https://' and lower(split_part(b.video_url, '?', 1)) ~ '\.(jpe?g|png|webp|gif)$' then 'legacy_video_url'
          when b.video_url ~* '^https://' and (
            lower(split_part(b.video_url, '?', 1)) ~ '\.(m3u8|mp4|webm|mov)$'
            or (b.video_url ~* '(cloudflarestream\.com|videodelivery\.net)' and b.video_url ~* '\.m3u8($|\?)')
          ) then 'legacy_video_url'
          when coalesce(b.video_url, '') = '' and b.thumbnail_url ~* '^https://'
            and lower(split_part(b.thumbnail_url, '?', 1)) ~ '\.(jpe?g|png|webp|gif)$' then 'legacy_thumbnail'
          else null
        end as media_origin,
        case
          when s.video_asset_id is not null then s.hls_url
          when r.media_asset_id is not null then r.public_url
          when b.video_url ~* '^https://' and lower(split_part(b.video_url, '?', 1)) ~ '\.(jpe?g|png|webp|gif|m3u8|mp4|webm|mov)$' then b.video_url
          when b.video_url ~* '^https://' and b.video_url ~* '(cloudflarestream\.com|videodelivery\.net)' and b.video_url ~* '\.m3u8($|\?)' then b.video_url
          when coalesce(b.video_url, '') = '' and b.thumbnail_url ~* '^https://'
            and lower(split_part(b.thumbnail_url, '?', 1)) ~ '\.(jpe?g|png|webp|gif)$' then b.thumbnail_url
          else null
        end as media_url,
        case
          when s.video_asset_id is not null then s.hls_url
          when r.media_asset_id is not null and r.media_kind = 'video' then r.public_url
          when b.video_url ~* '^https://' and (
            lower(split_part(b.video_url, '?', 1)) ~ '\.(m3u8|mp4|webm|mov)$'
            or (b.video_url ~* '(cloudflarestream\.com|videodelivery\.net)' and b.video_url ~* '\.m3u8($|\?)')
          ) then b.video_url
          else null
        end as playback_url,
        case
          when s.video_asset_id is not null and s.thumbnail_url ~* '^https://' then s.thumbnail_url
          when r.media_asset_id is not null and r.media_kind = 'image' then r.public_url
          when b.thumbnail_url ~* '^https://' and lower(split_part(b.thumbnail_url, '?', 1)) ~ '\.(jpe?g|png|webp|gif)$' then b.thumbnail_url
          else null
        end as poster_url
      from base b
      left join canonical_stream s on s.entity_id = b.id
      left join canonical_r2 r on r.entity_id = b.id
    )
    select jsonb_build_object(
      'type', 'video',
      'id', c.id,
      'owner', jsonb_build_object(
        'id', c.user_id,
        'username', c.username,
        'display_name', c.display_name,
        'avatar_url', c.avatar_url
      ),
      'caption', left(coalesce(c.caption, ''), 2000),
      'media_kind', c.resolved_kind,
      'media_url', c.media_url,
      'preview_url', c.poster_url,
      'playback_url', c.playback_url,
      'poster_url', c.poster_url,
      'media_origin', c.media_origin,
      'media_asset_id', c.media_asset_id,
      'video_asset_id', c.video_asset_id,
      'created_at', c.created_at,
      'visibility', c.moderation_visibility,
      'public_counters', jsonb_build_object(
        'likes_count', coalesce(c.likes_count, 0),
        'comments_count', coalesce(c.comments_count, 0),
        'views_count', coalesce(c.views_count, 0)
      )
    ) into v_result
    from classified c;
  elsif p_target_type = 'comment' then
    select jsonb_build_object(
      'type', 'comment',
      'id', c.id,
      'video_id', c.video_id,
      'owner', jsonb_build_object(
        'id', c.user_id,
        'username', p.username,
        'display_name', p.display_name,
        'avatar_url', p.avatar_url
      ),
      'text', left(coalesce(c.text, ''), 2000),
      'created_at', c.created_at,
      'visibility', coalesce(ms.visibility, 'visible'),
      'public_counters', jsonb_build_object('likes_count', coalesce(c.likes_count, 0))
    ) into v_result
    from public.comments c
    left join public.public_user_profiles p on p.id = c.user_id
    left join private.admin_content_moderation_state ms
      on ms.target_type = 'comment' and ms.target_id = c.id
    where c.id = p_target_id;
  else
    raise exception using errcode = '22023', message = 'admin_content_type_invalid';
  end if;

  if v_result is null then
    raise exception using errcode = 'P0002', message = 'admin_content_target_not_found';
  end if;
  return v_result;
end;
$$;

revoke all on function public.get_admin_content_detail(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_admin_content_detail(text, uuid) to authenticated;

comment on function public.get_admin_content_detail(text, uuid) is
  'Capability-gated content detail with explicit canonical Stream/R2 media resolution and bounded legacy fallback.';

-- Keep the F3 implementation as the single canonical revenue projection core,
-- then expose the same public RPC with a server-calculated BDAG/USD summary.
alter function public.get_admin_platform_revenue(text) set schema private;
alter function private.get_admin_platform_revenue(text)
  rename to get_admin_platform_revenue_projection_v1;

revoke all on function private.get_admin_platform_revenue_projection_v1(text)
  from public, anon, authenticated, service_role;

create function public.get_admin_platform_revenue(
  p_period text default 'ytd'
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_projection jsonb;
  v_bdag_balance numeric;
begin
  perform public.admin_require_capability('finance.ledger.read');

  v_projection := private.get_admin_platform_revenue_projection_v1(p_period);

  select coalesce(sum(a.balance), 0)::numeric
  into v_bdag_balance
  from public.ledger_accounts a
  where a.owner_id is null
    and a.account_type in ('platform', 'marketplace_ads_revenue')
    and a.currency = 'BDAG';

  return v_projection || jsonb_build_object(
    'platform_balance_summary', jsonb_build_object(
      'currency', 'BDAG',
      'bdag_balance', v_bdag_balance,
      'usd_equivalent', v_bdag_balance * 0.01::numeric,
      'usd_per_bdag', 0.01::numeric
    )
  );
end;
$$;

revoke all on function public.get_admin_platform_revenue(text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_admin_platform_revenue(text) to authenticated;

comment on function private.get_admin_platform_revenue_projection_v1(text) is
  'Internal read-only F3 canonical revenue projection core. Not directly client-executable.';
comment on function public.get_admin_platform_revenue(text) is
  'Capability-gated read-only platform revenue plus server-calculated fixed canonical BDAG/USD balance summary.';

notify pgrst, 'reload schema';
commit;
