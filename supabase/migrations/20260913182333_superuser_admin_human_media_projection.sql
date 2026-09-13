begin;

-- Presentation-only extensions to existing bounded administrative projections.
create or replace function public.get_admin_content_detail(p_target_type text,p_target_id uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_result jsonb;
begin
  perform public.admin_require_capability('content.items.read');
  if p_target_type='video' then
    select jsonb_build_object('type','video','id',v.id,'owner',jsonb_build_object(
      'id',v.user_id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url),
      'caption',left(coalesce(v.caption,''),2000),
      'preview_url',case when v.thumbnail_url~*'^https://' then v.thumbnail_url else null end,
      'playback_url',case when v.video_url~*'^https://' then v.video_url else null end,
      'created_at',v.created_at,'visibility',coalesce(ms.visibility,'visible'),'public_counters',jsonb_build_object(
        'likes_count',coalesce(v.likes_count,0),'comments_count',coalesce(v.comments_count,0),
        'views_count',coalesce(v.views_count,0))) into v_result
    from public.videos v left join public.public_user_profiles p on p.id=v.user_id
    left join private.admin_content_moderation_state ms on ms.target_type='video' and ms.target_id=v.id
    where v.id=p_target_id;
  elsif p_target_type='comment' then
    select jsonb_build_object('type','comment','id',c.id,'video_id',c.video_id,
      'owner',jsonb_build_object('id',c.user_id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url),
      'text',left(coalesce(c.text,''),2000),'created_at',c.created_at,
      'visibility',coalesce(ms.visibility,'visible'),'public_counters',jsonb_build_object('likes_count',coalesce(c.likes_count,0)))
      into v_result from public.comments c left join public.public_user_profiles p on p.id=c.user_id
      left join private.admin_content_moderation_state ms on ms.target_type='comment' and ms.target_id=c.id
      where c.id=p_target_id;
  else raise exception using errcode='22023',message='admin_content_type_invalid';end if;
  if v_result is null then raise exception using errcode='P0002',message='admin_content_target_not_found';end if;
  return v_result;
end;
$$;

create or replace function public.get_admin_story_detail(p_story_id uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_result jsonb;
begin
  perform public.admin_require_capability('stories.items.read');
  select jsonb_build_object('id',s.id,'owner',jsonb_build_object('id',s.user_id,
      'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url),
    'story_kind',s.story_kind,'media_type',s.media_type,'created_at',s.created_at,
    'expires_at',s.expires_at,'shared_video_id',s.shared_video_id,
    'shared_content_type',s.shared_content_type,'composition',s.story_composition,
    'visibility',coalesce(ms.visibility,'visible'),
    'media_asset_id',(select l.asset_id from public.media_asset_links l
      where l.entity_type='story' and l.entity_id=s.id and l.slot='media' and l.position=0 limit 1),
    'preview_url',(select case when a.public_url~*'^https://' then a.public_url else null end
      from public.media_asset_links l join public.media_assets a on a.id=l.asset_id
      where l.entity_type='story' and l.entity_id=s.id and l.slot='media' and l.position=0
        and a.visibility='public' and a.status='ready' limit 1))
  into v_result from public.stories s
  left join public.public_user_profiles p on p.id=s.user_id
  left join private.admin_content_moderation_state ms on ms.target_type='story' and ms.target_id=s.id
  where s.id=p_story_id;
  if v_result is null then raise exception using errcode='P0002',message='admin_story_not_found';end if;
  return v_result;
end;
$$;

-- Preserve the A5 report contract and add only the reviewed subject asset identifier.
create or replace function public.get_admin_report_detail(p_report_id uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_report public.reports;v_reporter jsonb;v_subject jsonb;
  v_before jsonb:='[]'::jsonb;v_after jsonb:='[]'::jsonb;v_conversation_type text;
begin
  perform public.admin_require_capability('reports.cases.read');
  select * into v_report from public.reports where id=p_report_id;
  if not found then raise exception using errcode='P0002',message='admin_report_not_found';end if;
  select jsonb_build_object('id',id,'username',username,'display_name',display_name,'avatar_url',avatar_url)
  into v_reporter from public.public_user_profiles where id=v_report.reporter_user_id;
  if v_report.reported_content_type in('video','comment') then
    perform public.admin_require_capability('content.items.read');
    if v_report.reported_content_type='video' then
      select jsonb_build_object('type','video','id',v.id,'caption',left(coalesce(v.caption,''),500),
        'thumbnail_url',case when v.thumbnail_url~*'^https://' then v.thumbnail_url else null end,
        'playback_url',case when v.video_url~*'^https://' then v.video_url else null end,
        'created_at',v.created_at,'owner_id',v.user_id,'visibility',coalesce(ms.visibility,'visible'))
      into v_subject from public.videos v left join private.admin_content_moderation_state ms
        on ms.target_type='video' and ms.target_id=v.id where v.id=v_report.reported_content_id;
    else
      select jsonb_build_object('type','comment','id',c.id,'text',left(coalesce(c.text,''),500),
        'created_at',c.created_at,'owner_id',c.user_id,'video_id',c.video_id,
        'visibility',coalesce(ms.visibility,'visible')) into v_subject
      from public.comments c left join private.admin_content_moderation_state ms
        on ms.target_type='comment' and ms.target_id=c.id where c.id=v_report.reported_content_id;
    end if;
  elsif v_report.reported_content_type='user' then
    perform public.admin_require_capability('users.accounts.read');
    select jsonb_build_object('type','user','id',p.id,'username',p.username,
      'display_name',p.display_name,'avatar_url',p.avatar_url) into v_subject
    from public.public_user_profiles p where p.id=v_report.reported_content_id;
  elsif v_report.reported_content_type='story' then
    perform public.admin_require_capability('stories.items.read');
    select jsonb_build_object('type','story','id',s.id,'owner_id',s.user_id,
      'story_kind',s.story_kind,'media_type',s.media_type,'created_at',s.created_at,
      'expires_at',s.expires_at,'shared_video_id',s.shared_video_id,
      'shared_content_type',s.shared_content_type,'visibility',coalesce(ms.visibility,'visible'),
      'media_asset_id',(select l.asset_id from public.media_asset_links l where l.entity_type='story' and l.entity_id=s.id and l.slot='media' and l.position=0 limit 1),
      'preview_url',(select case when a.public_url~*'^https://' then a.public_url else null end
        from public.media_asset_links l join public.media_assets a on a.id=l.asset_id
        where l.entity_type='story' and l.entity_id=s.id and l.slot='media' and l.position=0
          and a.visibility='public' and a.status='ready' limit 1))
    into v_subject from public.stories s left join private.admin_content_moderation_state ms
      on ms.target_type='story' and ms.target_id=s.id where s.id=v_report.reported_content_id;
  elsif v_report.reported_content_type='message' then
    perform public.admin_require_capability('chat.abuse_reports.read');
    select jsonb_build_object('type','message','id',m.id,
      'sender',jsonb_build_object('id',m.sender_id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url),
      'message_type',m.message_type,'text_excerpt',case when m.message_type='text' and m.consumption_policy='standard' then left(coalesce(m.text,''),500) else null end,
      'has_media',(m.media_asset_id is not null or m.media_url is not null),'media_asset_id',m.media_asset_id,
      'audio_duration_ms',case when m.message_type='voice' then m.audio_duration_ms else null end,
      'created_at',m.created_at,'hidden',m.deleted_at is not null)
    into v_subject from public.messages m left join public.public_user_profiles p on p.id=m.sender_id where m.id=v_report.reported_content_id;
    select c.conversation_type into v_conversation_type from public.messages m join public.chat_conversations c on c.id=m.conversation_id where m.id=v_report.reported_content_id;
    select coalesce(jsonb_agg(item order by created_at,id),'[]'::jsonb) into v_before from(
      select m.created_at,m.id,jsonb_build_object('id',m.id,'sender',jsonb_build_object('id',m.sender_id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url),'message_type',m.message_type,
        'text_excerpt',case when m.message_type='text' and m.consumption_policy='standard' then left(coalesce(m.text,''),500) else null end,'has_media',(m.media_asset_id is not null or m.media_url is not null),
        'audio_duration_ms',case when m.message_type='voice' then m.audio_duration_ms else null end,'created_at',m.created_at,'hidden',m.deleted_at is not null) item
      from public.messages m join public.messages target on target.id=v_report.reported_content_id and target.conversation_id=m.conversation_id
      left join public.public_user_profiles p on p.id=m.sender_id where m.deleted_at is null and (m.created_at,m.id)<(target.created_at,target.id)
      order by m.created_at desc,m.id desc limit 3) q;
    select coalesce(jsonb_agg(item order by created_at,id),'[]'::jsonb) into v_after from(
      select m.created_at,m.id,jsonb_build_object('id',m.id,'sender',jsonb_build_object('id',m.sender_id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url),'message_type',m.message_type,
        'text_excerpt',case when m.message_type='text' and m.consumption_policy='standard' then left(coalesce(m.text,''),500) else null end,'has_media',(m.media_asset_id is not null or m.media_url is not null),
        'audio_duration_ms',case when m.message_type='voice' then m.audio_duration_ms else null end,'created_at',m.created_at,'hidden',m.deleted_at is not null) item
      from public.messages m join public.messages target on target.id=v_report.reported_content_id and target.conversation_id=m.conversation_id
      left join public.public_user_profiles p on p.id=m.sender_id where m.deleted_at is null and (m.created_at,m.id)>(target.created_at,target.id)
      order by m.created_at,m.id limit 3) q;
  else raise exception using errcode='22023',message='admin_report_content_type_invalid';end if;
  return jsonb_build_object('id',v_report.id,'reporter',v_reporter,
    'reported_content_id',v_report.reported_content_id,'reported_content_type',v_report.reported_content_type,
    'reason',v_report.reason,'details',v_report.details,'status',v_report.status,
    'created_at',v_report.created_at,'subject',v_subject,
    'chat_context',case when v_report.reported_content_type='message' then jsonb_build_object('conversation_type',v_conversation_type,'before',v_before,'after',v_after) else null end);
end;
$$;

revoke all on function public.get_admin_content_detail(text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_admin_story_detail(uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_admin_report_detail(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_admin_content_detail(text,uuid) to authenticated;
grant execute on function public.get_admin_story_detail(uuid) to authenticated;
grant execute on function public.get_admin_report_detail(uuid) to authenticated;

commit;
