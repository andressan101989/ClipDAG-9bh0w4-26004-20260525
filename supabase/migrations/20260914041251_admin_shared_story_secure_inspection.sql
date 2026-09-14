begin;

-- Admin Stories resolve media only through the canonical server-managed asset
-- links. A bare URL stored on stories/videos is never promoted to trusted media.
create or replace function public.search_admin_stories(
  p_query text default null,
  p_visibility text default null,
  p_owner_id uuid default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare
  v_query text := nullif(btrim(p_query),'');
  v_limit integer := least(greatest(coalesce(p_limit,50),1),100);
begin
  perform public.admin_require_capability('stories.items.read');
  if p_visibility is not null and p_visibility not in ('visible','hidden') then
    raise exception using errcode='22023',message='admin_story_visibility_invalid';
  end if;
  if v_query is not null and char_length(v_query)>120 then
    raise exception using errcode='22023',message='admin_story_query_invalid';
  end if;
  if (p_cursor_created_at is null)<>(p_cursor_id is null) then
    raise exception using errcode='22023',message='admin_story_cursor_invalid';
  end if;

  return coalesce((with page as (
    select
      s.id,
      s.user_id,
      s.story_kind,
      s.media_type,
      s.created_at,
      s.expires_at,
      s.shared_video_id,
      s.shared_content_type,
      coalesce(ms.visibility,'visible') as visibility,
      p.username,
      p.display_name,
      p.avatar_url,
      case
        when s.story_kind='shared' and v.id is null then 'missing'
        when s.story_kind='shared' and (stream_media.asset_id is not null or r2_media.asset_id is not null) then 'available'
        when s.story_kind='media' and direct_media.asset_id is not null
          and direct_media.status='ready'
          and (direct_media.visibility='private' or direct_media.public_url is not null) then 'available'
        else 'unavailable'
      end as source_status,
      case
        when s.story_kind='shared' and stream_media.asset_id is not null then 'shared_stream_asset'
        when s.story_kind='shared' and r2_media.asset_id is not null then 'shared_r2_asset'
        when s.story_kind='media' and direct_media.asset_id is not null
          and direct_media.status='ready'
          and (direct_media.visibility='private' or direct_media.public_url is not null) then 'story_asset'
        else null
      end as media_origin,
      case
        when s.story_kind='shared' and stream_media.asset_id is not null then 'video'
        when s.story_kind='shared' and r2_media.asset_id is not null then r2_media.media_kind
        when s.story_kind='media' then direct_media.media_kind
        else null
      end as resolved_media_kind,
      case
        when s.story_kind='shared' and stream_media.asset_id is not null then stream_media.thumbnail_url
        when s.story_kind='shared' and r2_media.asset_id is not null then r2_media.public_url
        when s.story_kind='media' then direct_media.public_url
        else null
      end as preview_url,
      reports.report_count
    from public.stories s
    left join private.admin_content_moderation_state ms
      on ms.target_type='story' and ms.target_id=s.id
    left join public.public_user_profiles p on p.id=s.user_id
    left join public.videos v on v.id=s.shared_video_id
    left join lateral (
      select l.asset_id,a.media_kind,a.visibility,a.status,
        case when a.status='ready' and a.visibility='public'
          and a.public_url~*'^https://pub-d146e3d06d274db4871f5b6020fd850f\.r2\.dev(?:/|$)'
          then a.public_url end as public_url
      from public.media_asset_links l
      join public.media_assets a on a.id=l.asset_id
      where s.story_kind='media' and l.entity_type='story' and l.entity_id=s.id
        and l.slot='media' and l.position=0 and a.provider='r2'
        and ((a.media_kind='image' and a.purpose in ('story_image','post_image'))
          or (a.media_kind='video' and a.purpose='story_video'))
      order by l.id
      limit 1
    ) direct_media on true
    left join lateral (
      select l.asset_id,va.hls_url,va.thumbnail_url
      from public.video_asset_links l
      join public.video_assets va on va.id=l.asset_id
      where s.story_kind='shared' and v.id is not null
        and l.entity_type='video_post' and l.entity_id=v.id and l.slot='video' and l.position=0
        and va.provider='cloudflare_stream' and va.purpose='feed_video'
        and va.visibility='public' and va.status='ready' and va.deleted_at is null
        and va.hls_url~*'^https://[a-z0-9-]+\.(cloudflarestream\.com|videodelivery\.net)(?:/|$)'
        and (va.thumbnail_url is null or va.thumbnail_url~*'^https://[a-z0-9-]+\.(cloudflarestream\.com|videodelivery\.net)(?:/|$)')
      order by l.id
      limit 1
    ) stream_media on true
    left join lateral (
      select l.asset_id,a.media_kind,a.public_url
      from public.media_asset_links l
      join public.media_assets a on a.id=l.asset_id
      where s.story_kind='shared' and v.id is not null
        and l.entity_type='video_post' and l.entity_id=v.id and l.slot='media' and l.position=0
        and a.provider='r2' and a.visibility='public' and a.status='ready'
        and a.media_kind in ('image','video')
        and a.public_url~*'^https://pub-d146e3d06d274db4871f5b6020fd850f\.r2\.dev(?:/|$)'
      order by l.id
      limit 1
    ) r2_media on true
    left join lateral (
      select count(*)::integer as report_count
      from public.reports r
      where r.reported_content_type='story' and r.reported_content_id=s.id
    ) reports on true
    where (p_visibility is null or coalesce(ms.visibility,'visible')=p_visibility)
      and (p_owner_id is null or s.user_id=p_owner_id)
      and (v_query is null or s.id::text=v_query or p.username ilike '%'||v_query||'%'
        or p.display_name ilike '%'||v_query||'%')
      and (p_cursor_created_at is null or (s.created_at,s.id)<(p_cursor_created_at,p_cursor_id))
    order by s.created_at desc,s.id desc
    limit v_limit
  ) select jsonb_build_object(
    'items',coalesce(jsonb_agg(jsonb_build_object(
      'id',id,
      'owner',jsonb_build_object('id',user_id,'username',username,'display_name',display_name,'avatar_url',avatar_url),
      'story_kind',story_kind,
      'media_type',media_type,
      'resolved_media_kind',resolved_media_kind,
      'created_at',created_at,
      'expires_at',expires_at,
      'shared_video_id',shared_video_id,
      'shared_content_type',shared_content_type,
      'visibility',visibility,
      'source_status',source_status,
      'media_origin',media_origin,
      'preview_url',preview_url,
      'report_count',report_count
    ) order by created_at desc,id desc),'[]'::jsonb),
    'next_cursor',case when count(*)=v_limit then (
      select jsonb_build_object('created_at',created_at,'id',id)
      from page order by created_at,id limit 1
    ) else null end
  ) from page),jsonb_build_object('items','[]'::jsonb,'next_cursor',null));
end;
$$;

create or replace function public.get_admin_story_detail(p_story_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare
  v_result jsonb;
begin
  perform public.admin_require_capability('stories.items.read');

  select jsonb_build_object(
    'id',s.id,
    'owner',jsonb_build_object('id',s.user_id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url),
    'story_kind',s.story_kind,
    'media_type',s.media_type,
    'resolved_media_kind',case
      when s.story_kind='shared' and stream_media.asset_id is not null then 'video'
      when s.story_kind='shared' and r2_media.asset_id is not null then r2_media.media_kind
      when s.story_kind='media' then direct_media.media_kind
      else null
    end,
    'created_at',s.created_at,
    'expires_at',s.expires_at,
    'expired',s.expires_at<=clock_timestamp(),
    'shared_video_id',s.shared_video_id,
    'shared_content_type',s.shared_content_type,
    'composition',s.story_composition,
    'visibility',coalesce(ms.visibility,'visible'),
    'source_status',case
      when s.story_kind='shared' and v.id is null then 'missing'
      when s.story_kind='shared' and (stream_media.asset_id is not null or r2_media.asset_id is not null) then 'available'
      when s.story_kind='media' and direct_media.asset_id is not null
        and direct_media.status='ready'
        and (direct_media.visibility='private' or direct_media.public_url is not null) then 'available'
      else 'unavailable'
    end,
    'media_origin',case
      when s.story_kind='shared' and stream_media.asset_id is not null then 'shared_stream_asset'
      when s.story_kind='shared' and r2_media.asset_id is not null then 'shared_r2_asset'
      when s.story_kind='media' and direct_media.asset_id is not null
        and direct_media.status='ready'
        and (direct_media.visibility='private' or direct_media.public_url is not null) then 'story_asset'
      else null
    end,
    'linked_media_asset_id',direct_media.asset_id,
    'media_asset_id',case
      when s.story_kind='media' and direct_media.asset_id is not null
        and direct_media.status='ready'
        and (direct_media.visibility='private' or direct_media.public_url is not null)
      then direct_media.asset_id else null end,
    'media_url',case
      when s.story_kind='shared' and stream_media.asset_id is not null then stream_media.hls_url
      when s.story_kind='shared' and r2_media.asset_id is not null then r2_media.public_url
      when s.story_kind='media' then direct_media.public_url
      else null
    end,
    'preview_url',case
      when s.story_kind='shared' and stream_media.asset_id is not null then stream_media.thumbnail_url
      when s.story_kind='shared' and r2_media.asset_id is not null then r2_media.public_url
      when s.story_kind='media' then direct_media.public_url
      else null
    end,
    'poster_url',case when s.story_kind='shared' and stream_media.asset_id is not null
      then stream_media.thumbnail_url else null end,
    'source',case when s.story_kind='shared' and v.id is not null then jsonb_build_object(
      'id',v.id,
      'content_type',s.shared_content_type,
      'owner',jsonb_build_object('id',v.user_id,'username',source_profile.username,
        'display_name',source_profile.display_name,'avatar_url',source_profile.avatar_url),
      'caption',left(coalesce(v.caption,''),500),
      'created_at',v.created_at,
      'visibility',coalesce(source_ms.visibility,'visible'),
      'views_count',v.views_count,
      'likes_count',v.likes_count,
      'comments_count',v.comments_count,
      'shares_count',v.shares_count
    ) else null end,
    'reports',jsonb_build_object(
      'total',reports.report_count,
      'pending',reports.pending_count,
      'last_reported_at',reports.last_reported_at
    )
  ) into v_result
  from public.stories s
  left join public.public_user_profiles p on p.id=s.user_id
  left join private.admin_content_moderation_state ms
    on ms.target_type='story' and ms.target_id=s.id
  left join public.videos v on v.id=s.shared_video_id
  left join public.public_user_profiles source_profile on source_profile.id=v.user_id
  left join private.admin_content_moderation_state source_ms
    on source_ms.target_type='video' and source_ms.target_id=v.id
  left join lateral (
    select l.asset_id,a.media_kind,a.visibility,a.status,
      case when a.status='ready' and a.visibility='public'
        and a.public_url~*'^https://pub-d146e3d06d274db4871f5b6020fd850f\.r2\.dev(?:/|$)'
        then a.public_url end as public_url
    from public.media_asset_links l
    join public.media_assets a on a.id=l.asset_id
    where s.story_kind='media' and l.entity_type='story' and l.entity_id=s.id
      and l.slot='media' and l.position=0 and a.provider='r2'
      and ((a.media_kind='image' and a.purpose in ('story_image','post_image'))
        or (a.media_kind='video' and a.purpose='story_video'))
    order by l.id
    limit 1
  ) direct_media on true
  left join lateral (
    select l.asset_id,va.hls_url,va.thumbnail_url
    from public.video_asset_links l
    join public.video_assets va on va.id=l.asset_id
    where s.story_kind='shared' and v.id is not null
      and l.entity_type='video_post' and l.entity_id=v.id and l.slot='video' and l.position=0
      and va.provider='cloudflare_stream' and va.purpose='feed_video'
      and va.visibility='public' and va.status='ready' and va.deleted_at is null
      and va.hls_url~*'^https://[a-z0-9-]+\.(cloudflarestream\.com|videodelivery\.net)(?:/|$)'
      and (va.thumbnail_url is null or va.thumbnail_url~*'^https://[a-z0-9-]+\.(cloudflarestream\.com|videodelivery\.net)(?:/|$)')
    order by l.id
    limit 1
  ) stream_media on true
  left join lateral (
    select l.asset_id,a.media_kind,a.public_url
    from public.media_asset_links l
    join public.media_assets a on a.id=l.asset_id
    where s.story_kind='shared' and v.id is not null
      and l.entity_type='video_post' and l.entity_id=v.id and l.slot='media' and l.position=0
      and a.provider='r2' and a.visibility='public' and a.status='ready'
      and a.media_kind in ('image','video')
      and a.public_url~*'^https://pub-d146e3d06d274db4871f5b6020fd850f\.r2\.dev(?:/|$)'
    order by l.id
    limit 1
  ) r2_media on true
  left join lateral (
    select count(*)::integer as report_count,
      count(*) filter(where r.status='pending')::integer as pending_count,
      max(r.created_at) as last_reported_at
    from public.reports r
    where r.reported_content_type='story' and r.reported_content_id=s.id
  ) reports on true
  where s.id=p_story_id;

  if v_result is null then
    raise exception using errcode='P0002',message='admin_story_not_found';
  end if;
  return v_result;
end;
$$;

revoke all on function public.search_admin_stories(text,text,uuid,timestamptz,uuid,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.get_admin_story_detail(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.search_admin_stories(text,text,uuid,timestamptz,uuid,integer)
  to authenticated;
grant execute on function public.get_admin_story_detail(uuid)
  to authenticated;

comment on function public.search_admin_stories(text,text,uuid,timestamptz,uuid,integer) is
  'Capability-gated Story inspection list with canonical linked-media availability and bounded report counts.';
comment on function public.get_admin_story_detail(uuid) is
  'Capability-gated Story inspection detail resolving direct R2 assets and shared canonical video assets without trusting bare URLs.';

notify pgrst,'reload schema';

commit;
