-- SUPERUSER-A5: reversible content/Story moderation and case-bounded Chat abuse.
-- No roles, capabilities, root assignments, media lifecycle, or financial objects are changed.

do $a5_precheck$
begin
  if (select count(*) from private.admin_roles)<>6
     or (select count(*) from private.admin_capabilities)<>47
     or (select count(*) from private.admin_role_capabilities)<>142
     or (select count(*) from private.admin_role_grant_rules)<>7 then
    raise exception 'a5_canonical_catalog_precondition_failed';
  end if;
  if (select count(*) from private.admin_user_roles
      where role_code='SUPER_ADMIN' and revoked_at is null)<>0 then
    raise exception 'a5_super_admin_precondition_failed';
  end if;
  if to_regclass('private.admin_content_moderation_actions') is not null
     or to_regclass('private.admin_content_moderation_state') is not null then
    raise exception 'a5_moderation_authority_already_exists';
  end if;
  if (select count(*) from private.admin_capabilities where capability_code in(
    'content.items.read','content.items.hide','content.items.restore',
    'stories.items.read','stories.items.moderate',
    'chat.abuse_reports.read','chat.abuse_reports.moderate',
    'reports.cases.read'
  ))<>8 then
    raise exception 'a5_required_capability_missing';
  end if;
end
$a5_precheck$;

create table private.admin_content_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on update restrict on delete restrict,
  actor_role_snapshot text[] not null,
  actor_capability text not null references private.admin_capabilities(capability_code)
    on update restrict on delete restrict,
  target_type text not null check(target_type in('video','comment','story','chat_message')),
  target_id uuid not null,
  action text not null check(action in('hide','restore')),
  reason text not null check(reason=btrim(reason) and char_length(reason) between 2 and 500),
  idempotency_scope text not null check(
    idempotency_scope=btrim(idempotency_scope) and char_length(idempotency_scope) between 8 and 300
  ),
  idempotency_key uuid not null,
  request_fingerprint text not null check(request_fingerprint~'^[0-9a-f]{64}$'),
  visibility_before text not null check(visibility_before in('visible','hidden')),
  visibility_after text not null check(visibility_after in('visible','hidden')),
  result text not null check(result in('succeeded','no_op')),
  created_at timestamptz not null default clock_timestamp(),
  constraint admin_content_chat_action_check check(target_type<>'chat_message' or action='hide'),
  constraint admin_content_action_capability_check check(
    (target_type in('video','comment') and action='hide' and actor_capability='content.items.hide')
    or (target_type in('video','comment') and action='restore' and actor_capability='content.items.restore')
    or (target_type='story' and actor_capability='stories.items.moderate')
    or (target_type='chat_message' and action='hide' and actor_capability='chat.abuse_reports.moderate')
  ),
  unique(idempotency_scope,idempotency_key)
);

create index admin_content_moderation_actions_target_idx
  on private.admin_content_moderation_actions(target_type,target_id,created_at desc,id desc);

create table private.admin_content_moderation_state (
  target_type text not null check(target_type in('video','comment','story')),
  target_id uuid not null,
  visibility text not null check(visibility in('visible','hidden')),
  version bigint not null default 1 check(version>0),
  last_action_id uuid not null references private.admin_content_moderation_actions(id)
    on update restrict on delete restrict,
  updated_at timestamptz not null default clock_timestamp(),
  primary key(target_type,target_id)
);

alter table private.admin_content_moderation_actions enable row level security;
alter table private.admin_content_moderation_state enable row level security;
revoke all privileges on table private.admin_content_moderation_actions
  from public,anon,authenticated,service_role;
revoke all privileges on table private.admin_content_moderation_state
  from public,anon,authenticated,service_role;

create function private.admin_reject_content_action_mutation()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','private','public'
as $$
begin
  raise exception using errcode='42501',message='admin_content_moderation_action_immutable';
end;
$$;

create trigger admin_content_moderation_actions_immutable
before update or delete on private.admin_content_moderation_actions
for each row execute function private.admin_reject_content_action_mutation();

create function private.admin_content_is_visible(p_target_type text,p_target_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog','private','public'
as $$
  select case
    when p_target_type not in('video','comment','story') or p_target_id is null then false
    else not exists(
      select 1 from private.admin_content_moderation_state s
      where s.target_type=p_target_type and s.target_id=p_target_id and s.visibility='hidden'
    )
  end;
$$;

create function private.admin_cleanup_content_moderation_state()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','private','public'
as $$
begin
  delete from private.admin_content_moderation_state
  where target_type=tg_argv[0] and target_id=old.id;
  return old;
end;
$$;

revoke all on function private.admin_reject_content_action_mutation()
  from public,anon,authenticated,service_role;
revoke all on function private.admin_content_is_visible(text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.admin_cleanup_content_moderation_state()
  from public,anon,authenticated,service_role;
grant usage on schema private to anon,authenticated;
grant execute on function private.admin_content_is_visible(text,uuid) to anon,authenticated;

create trigger videos_cleanup_admin_moderation_state
after delete on public.videos for each row
execute function private.admin_cleanup_content_moderation_state('video');
create trigger comments_cleanup_admin_moderation_state
after delete on public.comments for each row
execute function private.admin_cleanup_content_moderation_state('comment');
create trigger stories_cleanup_admin_moderation_state
after delete on public.stories for each row
execute function private.admin_cleanup_content_moderation_state('story');

drop policy if exists videos_select_all on public.videos;
create policy videos_select_all on public.videos for select
using(private.admin_content_is_visible('video',id));

drop policy if exists comments_select_all on public.comments;
create policy comments_select_all on public.comments for select
using(private.admin_content_is_visible('comment',id));

drop policy if exists stories_read_visible on public.stories;
create policy stories_read_visible on public.stories for select to authenticated
using(
  private.admin_content_is_visible('story',id)
  and (user_id=auth.uid() or(expires_at>now() and private.story_can_view_owner(user_id)))
);

drop policy if exists media_asset_links_story_visible_read on public.media_asset_links;
create policy media_asset_links_story_visible_read on public.media_asset_links
for select to authenticated
using(
  entity_type='story' and slot='media' and position=0 and exists(
    select 1 from public.stories s
    where s.id=entity_id and s.expires_at>now()
      and private.admin_content_is_visible('story',s.id)
      and (s.user_id=auth.uid() or private.story_can_view_owner(s.user_id))
  )
);

create function private.admin_execute_content_moderation(
  p_actor uuid,p_actor_capability text,p_target_type text,p_target_id uuid,
  p_action text,p_reason text,p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare
  v_reason text:=nullif(btrim(p_reason),'');v_scope text;v_fingerprint text;
  v_existing private.admin_content_moderation_actions;v_before text;v_after text;
  v_result text;v_action private.admin_content_moderation_actions;v_receipt jsonb;
begin
  if p_actor is null or p_target_id is null or p_idempotency_key is null or v_reason is null
     or char_length(v_reason) not between 2 and 500 then
    raise exception using errcode='22023',message='admin_content_moderation_invalid';
  end if;
  if p_target_type not in('video','comment','story') or p_action not in('hide','restore') then
    raise exception using errcode='22023',message='admin_content_moderation_invalid';
  end if;
  v_scope:='v1|human|'||p_actor::text||'|'||p_actor_capability||'|'
    ||p_target_type||'.'||p_action;
  v_fingerprint:=private.admin_request_fingerprint(jsonb_build_object(
    'contract_version',1,'actor_kind','human_admin','actor_id',p_actor,
    'capability',p_actor_capability,'action',p_target_type||'.'||p_action,
    'target_type',p_target_type,'target_id',p_target_id,'reason',v_reason));
  perform pg_advisory_xact_lock(hashtextextended(v_scope||':'||p_idempotency_key::text,0));
  select * into v_existing from private.admin_content_moderation_actions
  where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='admin_idempotency_conflict';
    end if;
    return jsonb_build_object('action_id',v_existing.id,'target_type',v_existing.target_type,
      'target_id',v_existing.target_id,'action',v_existing.action,
      'visibility',v_existing.visibility_after,'result',v_existing.result);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('admin-content-target:'||p_target_type||':'||p_target_id::text,0));
  if p_target_type='video' and not exists(select 1 from public.videos where id=p_target_id) then
    raise exception using errcode='P0002',message='admin_content_target_not_found';
  elsif p_target_type='comment' and not exists(select 1 from public.comments where id=p_target_id) then
    raise exception using errcode='P0002',message='admin_content_target_not_found';
  elsif p_target_type='story' and not exists(select 1 from public.stories where id=p_target_id) then
    raise exception using errcode='P0002',message='admin_content_target_not_found';
  end if;
  select coalesce((select visibility from private.admin_content_moderation_state
    where target_type=p_target_type and target_id=p_target_id for update),'visible') into v_before;
  v_after:=case when p_action='hide' then 'hidden' else 'visible' end;
  v_result:=case when v_before=v_after then 'no_op' else 'succeeded' end;
  insert into private.admin_content_moderation_actions(
    actor_id,actor_role_snapshot,actor_capability,target_type,target_id,action,reason,
    idempotency_scope,idempotency_key,request_fingerprint,visibility_before,visibility_after,result
  ) values(
    p_actor,private.admin_active_role_codes(p_actor),p_actor_capability,p_target_type,p_target_id,
    p_action,v_reason,v_scope,p_idempotency_key,v_fingerprint,v_before,v_after,v_result
  ) returning * into v_action;
  insert into private.admin_content_moderation_state(
    target_type,target_id,visibility,version,last_action_id,updated_at
  ) values(p_target_type,p_target_id,v_after,1,v_action.id,clock_timestamp())
  on conflict(target_type,target_id) do update set
    visibility=excluded.visibility,
    version=private.admin_content_moderation_state.version+1,
    last_action_id=excluded.last_action_id,
    updated_at=excluded.updated_at;
  v_receipt:=jsonb_build_object('action_id',v_action.id,'target_type',p_target_type,
    'target_id',p_target_id,'action',p_action,'visibility',v_after,'result',v_result);
  insert into private.admin_action_audit(
    actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,
    target_id,target_ref,reason,outcome,financial_effect,contains_pii,metadata,
    idempotency_scope,idempotency_key,request_fingerprint
  ) values(
    p_actor,'human_admin',private.admin_active_role_codes(p_actor),p_actor_capability,
    case when p_target_type='story' then 'stories' else 'content' end,
    p_target_type||'.'||p_action,p_target_type,p_target_id,v_action.id::text,v_reason,
    v_result,false,false,jsonb_build_object('receipt',v_receipt,'moderation_action_id',v_action.id),
    v_scope,p_idempotency_key,v_fingerprint
  );
  return v_receipt;
end;
$$;

revoke all on function private.admin_execute_content_moderation(uuid,text,text,uuid,text,text,uuid)
  from public,anon,authenticated,service_role;

create function public.admin_moderate_content(
  p_target_type text,p_target_id uuid,p_action text,p_reason text,p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_capability text;v_actor uuid;
begin
  if p_target_type not in('video','comment') or p_action not in('hide','restore') then
    raise exception using errcode='22023',message='admin_content_moderation_invalid';
  end if;
  v_capability:=case when p_action='hide' then 'content.items.hide' else 'content.items.restore' end;
  v_actor:=public.admin_require_capability(v_capability);
  return private.admin_execute_content_moderation(v_actor,v_capability,p_target_type,
    p_target_id,p_action,p_reason,p_idempotency_key);
end;
$$;

create function public.admin_moderate_story(
  p_story_id uuid,p_action text,p_reason text,p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_actor uuid;
begin
  if p_action not in('hide','restore') then
    raise exception using errcode='22023',message='admin_story_moderation_invalid';
  end if;
  v_actor:=public.admin_require_capability('stories.items.moderate');
  return private.admin_execute_content_moderation(v_actor,'stories.items.moderate','story',
    p_story_id,p_action,p_reason,p_idempotency_key);
end;
$$;

create function public.search_admin_content(
  p_type text default null,p_query text default null,p_visibility text default null,
  p_owner_id uuid default null,p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,p_limit integer default 50
) returns jsonb
language plpgsql stable security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_query text:=nullif(btrim(p_query),'');v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
begin
  perform public.admin_require_capability('content.items.read');
  if p_type is not null and p_type not in('video','comment') then
    raise exception using errcode='22023',message='admin_content_type_invalid';end if;
  if p_visibility is not null and p_visibility not in('visible','hidden') then
    raise exception using errcode='22023',message='admin_content_visibility_invalid';end if;
  if v_query is not null and char_length(v_query)>120 then
    raise exception using errcode='22023',message='admin_content_query_invalid';end if;
  if (p_cursor_created_at is null)<>(p_cursor_id is null) then
    raise exception using errcode='22023',message='admin_content_cursor_invalid';end if;
  return coalesce((with candidates as(
    select 'video'::text type,v.id,v.user_id owner_id,left(coalesce(v.caption,''),240) preview,
      case when v.thumbnail_url~*'^https://' then v.thumbnail_url else null end preview_url,
      v.created_at,coalesce(ms.visibility,'visible') visibility,p.username,p.display_name,p.avatar_url
    from public.videos v left join private.admin_content_moderation_state ms
      on ms.target_type='video' and ms.target_id=v.id
    left join public.public_user_profiles p on p.id=v.user_id
    where (p_type is null or p_type='video') and (p_owner_id is null or v.user_id=p_owner_id)
      and (v_query is null or v.id::text=v_query or v.caption ilike '%'||v_query||'%'
        or p.username ilike '%'||v_query||'%' or p.display_name ilike '%'||v_query||'%')
    union all
    select 'comment',c.id,c.user_id,left(coalesce(c.text,''),240),null,c.created_at,
      coalesce(ms.visibility,'visible'),p.username,p.display_name,p.avatar_url
    from public.comments c left join private.admin_content_moderation_state ms
      on ms.target_type='comment' and ms.target_id=c.id
    left join public.public_user_profiles p on p.id=c.user_id
    where (p_type is null or p_type='comment') and (p_owner_id is null or c.user_id=p_owner_id)
      and (v_query is null or c.id::text=v_query or c.text ilike '%'||v_query||'%'
        or p.username ilike '%'||v_query||'%' or p.display_name ilike '%'||v_query||'%')
  ),page as(select * from candidates where (p_visibility is null or visibility=p_visibility)
      and (p_cursor_created_at is null or (created_at,id)<(p_cursor_created_at,p_cursor_id))
    order by created_at desc,id desc limit v_limit)
  select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object(
    'type',type,'id',id,'owner',jsonb_build_object('id',owner_id,'username',username,
      'display_name',display_name,'avatar_url',avatar_url),'preview',preview,
    'preview_url',preview_url,'created_at',created_at,'visibility',visibility)
    order by created_at desc,id desc),'[]'::jsonb),'next_cursor',case when count(*)=v_limit then
      (select jsonb_build_object('created_at',created_at,'id',id) from page order by created_at,id limit 1)
      else null end) from page),jsonb_build_object('items','[]'::jsonb,'next_cursor',null));
end;
$$;

create function public.get_admin_content_detail(p_target_type text,p_target_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_result jsonb;
begin
  perform public.admin_require_capability('content.items.read');
  if p_target_type='video' then
    select jsonb_build_object('type','video','id',v.id,'owner',jsonb_build_object(
      'id',v.user_id,'username',p.username,'display_name',p.display_name,'avatar_url',p.avatar_url),
      'caption',left(coalesce(v.caption,''),2000),'preview_url',case when v.thumbnail_url~*'^https://' then v.thumbnail_url else null end,
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

create function public.search_admin_stories(
  p_query text default null,p_visibility text default null,p_owner_id uuid default null,
  p_cursor_created_at timestamptz default null,p_cursor_id uuid default null,p_limit integer default 50
) returns jsonb
language plpgsql stable security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_query text:=nullif(btrim(p_query),'');v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
begin
  perform public.admin_require_capability('stories.items.read');
  if p_visibility is not null and p_visibility not in('visible','hidden') then
    raise exception using errcode='22023',message='admin_story_visibility_invalid';end if;
  if v_query is not null and char_length(v_query)>120 then
    raise exception using errcode='22023',message='admin_story_query_invalid';end if;
  if (p_cursor_created_at is null)<>(p_cursor_id is null) then
    raise exception using errcode='22023',message='admin_story_cursor_invalid';end if;
  return coalesce((with page as(
    select s.id,s.user_id,s.story_kind,s.media_type,s.created_at,s.expires_at,
      s.shared_video_id,s.shared_content_type,coalesce(ms.visibility,'visible') visibility,
      p.username,p.display_name,p.avatar_url,
      (select case when a.public_url~*'^https://' then a.public_url else null end
       from public.media_asset_links l join public.media_assets a on a.id=l.asset_id
       where l.entity_type='story' and l.entity_id=s.id and l.slot='media' and l.position=0
         and a.visibility='public' and a.status='ready' limit 1) preview_url
    from public.stories s
    left join private.admin_content_moderation_state ms on ms.target_type='story' and ms.target_id=s.id
    left join public.public_user_profiles p on p.id=s.user_id
    where (p_visibility is null or coalesce(ms.visibility,'visible')=p_visibility)
      and (p_owner_id is null or s.user_id=p_owner_id)
      and (v_query is null or s.id::text=v_query or p.username ilike '%'||v_query||'%'
        or p.display_name ilike '%'||v_query||'%')
      and (p_cursor_created_at is null or (s.created_at,s.id)<(p_cursor_created_at,p_cursor_id))
    order by s.created_at desc,s.id desc limit v_limit
  ) select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'owner',jsonb_build_object('id',user_id,'username',username,
        'display_name',display_name,'avatar_url',avatar_url),'story_kind',story_kind,
      'media_type',media_type,'created_at',created_at,'expires_at',expires_at,
      'shared_video_id',shared_video_id,'shared_content_type',shared_content_type,
      'visibility',visibility,'preview_url',preview_url) order by created_at desc,id desc),'[]'::jsonb),
    'next_cursor',case when count(*)=v_limit then(select jsonb_build_object('created_at',created_at,'id',id)
      from page order by created_at,id limit 1) else null end) from page),
    jsonb_build_object('items','[]'::jsonb,'next_cursor',null));
end;
$$;

create function public.get_admin_story_detail(p_story_id uuid)
returns jsonb
language plpgsql stable security definer
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

-- Extend the single canonical reports table. Legacy direct inserts remain limited to
-- video/comment/user; Story and Chat reports require validated RPCs below.
alter table public.reports drop constraint reports_reported_content_type_check;
alter table public.reports add constraint reports_reported_content_type_check
  check(reported_content_type in('video','comment','user','story','message'));
drop policy if exists reports_insert_own on public.reports;
create policy reports_insert_own on public.reports for insert to authenticated
with check(
  reporter_user_id=auth.uid()
  and reported_content_type in('video','comment','user')
);

create function public.report_story(
  p_story_id uuid,p_reason text,p_details text default null
) returns uuid
language plpgsql security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_actor uuid:=auth.uid();v_reason text:=nullif(btrim(p_reason),'');
  v_details text:=nullif(btrim(p_details),'');v_story public.stories;v_id uuid;
begin
  if v_actor is null then raise exception using errcode='28000',message='authentication_required';end if;
  if p_story_id is null or v_reason is null or char_length(v_reason) not between 2 and 120
     or (v_details is not null and char_length(v_details)>1000) then
    raise exception using errcode='22023',message='story_report_invalid';end if;
  select * into v_story from public.stories where id=p_story_id;
  if not found or v_story.expires_at<=now()
     or not private.admin_content_is_visible('story',v_story.id)
     or not private.story_can_view_owner(v_story.user_id) then
    raise exception using errcode='42501',message='story_not_visible';end if;
  if v_story.user_id=v_actor then
    raise exception using errcode='42501',message='story_self_report_forbidden';end if;
  insert into public.reports(reporter_user_id,reported_content_id,reported_content_type,reason,details)
  values(v_actor,v_story.id,'story',v_reason,v_details) returning id into v_id;
  return v_id;
end;
$$;

create function public.report_chat_message(
  p_message_id uuid,p_reason text,p_details text default null
) returns uuid
language plpgsql security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_actor uuid:=auth.uid();v_reason text:=nullif(btrim(p_reason),'');
  v_details text:=nullif(btrim(p_details),'');v_message public.messages;v_id uuid;
begin
  if v_actor is null then raise exception using errcode='28000',message='authentication_required';end if;
  if p_message_id is null or v_reason is null or char_length(v_reason) not between 2 and 120
     or (v_details is not null and char_length(v_details)>1000) then
    raise exception using errcode='22023',message='chat_message_report_invalid';end if;
  select * into v_message from public.messages where id=p_message_id and deleted_at is null;
  if not found or v_message.conversation_id is null
     or not public.chat_can_read_message(v_message.conversation_id,v_message.created_at) then
    raise exception using errcode='42501',message='chat_message_not_visible';end if;
  if v_message.sender_id=v_actor then
    raise exception using errcode='42501',message='chat_message_self_report_forbidden';end if;
  insert into public.reports(reporter_user_id,reported_content_id,reported_content_type,reason,details)
  values(v_actor,v_message.id,'message',v_reason,v_details) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.search_admin_reports(
  p_query text default null,p_status text default null,p_content_type text default null,
  p_cursor_created_at timestamptz default null,p_cursor_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql stable security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_query text:=nullif(btrim(p_query),'');v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
begin
  perform public.admin_require_capability('reports.cases.read');
  if p_status is not null and p_status not in('pending','reviewed','dismissed') then
    raise exception using errcode='22023',message='admin_report_status_invalid';end if;
  if p_content_type is not null and p_content_type not in('video','comment','user','story','message') then
    raise exception using errcode='22023',message='admin_report_content_type_invalid';end if;
  if v_query is not null and char_length(v_query)>120 then
    raise exception using errcode='22023',message='admin_report_query_invalid';end if;
  if (p_cursor_created_at is null)<>(p_cursor_id is null) then
    raise exception using errcode='22023',message='admin_report_cursor_invalid';end if;
  return coalesce((with page as(
    select r.*,p.username,p.display_name,p.avatar_url from public.reports r
    left join public.public_user_profiles p on p.id=r.reporter_user_id
    where (p_status is null or r.status=p_status)
      and (p_content_type is null or r.reported_content_type=p_content_type)
      and (v_query is null or r.id::text=v_query or r.reported_content_id::text=v_query
        or p.username ilike '%'||v_query||'%' or p.display_name ilike '%'||v_query||'%')
      and (p_cursor_created_at is null or (r.created_at,r.id)<(p_cursor_created_at,p_cursor_id))
    order by r.created_at desc,r.id desc limit v_limit
  ) select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'reporter',jsonb_build_object('id',reporter_user_id,'username',username,
        'display_name',display_name,'avatar_url',avatar_url),'reported_content_id',reported_content_id,
      'reported_content_type',reported_content_type,'reason',reason,'status',status,'created_at',created_at)
      order by created_at desc,id desc),'[]'::jsonb),'next_cursor',case when count(*)=v_limit then
      (select jsonb_build_object('created_at',created_at,'id',id) from page order by created_at,id limit 1)
      else null end) from page),jsonb_build_object('items','[]'::jsonb,'next_cursor',null));
end;
$$;

create or replace function public.get_admin_report_detail(p_report_id uuid)
returns jsonb
language plpgsql stable security definer
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
      'preview_url',(select case when a.public_url~*'^https://' then a.public_url else null end
        from public.media_asset_links l join public.media_assets a on a.id=l.asset_id
        where l.entity_type='story' and l.entity_id=s.id and l.slot='media' and l.position=0
          and a.visibility='public' and a.status='ready' limit 1))
    into v_subject from public.stories s left join private.admin_content_moderation_state ms
      on ms.target_type='story' and ms.target_id=s.id where s.id=v_report.reported_content_id;
  elsif v_report.reported_content_type='message' then
    perform public.admin_require_capability('chat.abuse_reports.read');
    select jsonb_build_object('type','message','id',m.id,
      'sender',jsonb_build_object('id',m.sender_id,'username',p.username,
        'display_name',p.display_name,'avatar_url',p.avatar_url),
      'message_type',m.message_type,
      'text_excerpt',case when m.message_type='text' and m.consumption_policy='standard'
        then left(coalesce(m.text,''),500) else null end,
      'has_media',(m.media_asset_id is not null or m.media_url is not null),
      'audio_duration_ms',case when m.message_type='voice' then m.audio_duration_ms else null end,
      'created_at',m.created_at,'hidden',m.deleted_at is not null)
    into v_subject from public.messages m left join public.public_user_profiles p on p.id=m.sender_id
    where m.id=v_report.reported_content_id;
    select c.conversation_type into v_conversation_type from public.messages m
      join public.chat_conversations c on c.id=m.conversation_id
      where m.id=v_report.reported_content_id;
    select coalesce(jsonb_agg(item order by created_at,id),'[]'::jsonb) into v_before from(
      select m.created_at,m.id,jsonb_build_object('id',m.id,
        'sender',jsonb_build_object('id',m.sender_id,'username',p.username,
          'display_name',p.display_name,'avatar_url',p.avatar_url),'message_type',m.message_type,
        'text_excerpt',case when m.message_type='text' and m.consumption_policy='standard'
          then left(coalesce(m.text,''),500) else null end,
        'has_media',(m.media_asset_id is not null or m.media_url is not null),
        'audio_duration_ms',case when m.message_type='voice' then m.audio_duration_ms else null end,
        'created_at',m.created_at,'hidden',m.deleted_at is not null) item
      from public.messages m
      join public.messages target on target.id=v_report.reported_content_id and target.conversation_id=m.conversation_id
      left join public.public_user_profiles p on p.id=m.sender_id
      where m.deleted_at is null and (m.created_at,m.id)<(target.created_at,target.id)
      order by m.created_at desc,m.id desc limit 3
    ) q;
    select coalesce(jsonb_agg(item order by created_at,id),'[]'::jsonb) into v_after from(
      select m.created_at,m.id,jsonb_build_object('id',m.id,
        'sender',jsonb_build_object('id',m.sender_id,'username',p.username,
          'display_name',p.display_name,'avatar_url',p.avatar_url),'message_type',m.message_type,
        'text_excerpt',case when m.message_type='text' and m.consumption_policy='standard'
          then left(coalesce(m.text,''),500) else null end,
        'has_media',(m.media_asset_id is not null or m.media_url is not null),
        'audio_duration_ms',case when m.message_type='voice' then m.audio_duration_ms else null end,
        'created_at',m.created_at,'hidden',m.deleted_at is not null) item
      from public.messages m
      join public.messages target on target.id=v_report.reported_content_id and target.conversation_id=m.conversation_id
      left join public.public_user_profiles p on p.id=m.sender_id
      where m.deleted_at is null and (m.created_at,m.id)>(target.created_at,target.id)
      order by m.created_at,m.id limit 3
    ) q;
  else raise exception using errcode='22023',message='admin_report_content_type_invalid';end if;
  return jsonb_build_object('id',v_report.id,'reporter',v_reporter,
    'reported_content_id',v_report.reported_content_id,'reported_content_type',v_report.reported_content_type,
    'reason',v_report.reason,'details',v_report.details,'status',v_report.status,
    'created_at',v_report.created_at,'subject',v_subject,
    'chat_context',case when v_report.reported_content_type='message' then jsonb_build_object(
      'conversation_type',v_conversation_type,'before',v_before,'after',v_after) else null end);
end;
$$;

create function public.admin_moderate_reported_chat_message(
  p_report_id uuid,p_reason text,p_idempotency_key uuid
) returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_actor uuid;v_reason text:=nullif(btrim(p_reason),'');v_scope text;v_fingerprint text;
  v_existing private.admin_content_moderation_actions;v_report public.reports;v_message public.messages;
  v_result text;v_action private.admin_content_moderation_actions;v_receipt jsonb;
begin
  v_actor:=public.admin_require_capability('chat.abuse_reports.moderate');
  if p_report_id is null or p_idempotency_key is null or v_reason is null
     or char_length(v_reason) not between 2 and 500 then
    raise exception using errcode='22023',message='admin_chat_moderation_invalid';end if;
  v_scope:='v1|human|'||v_actor::text||'|chat.abuse_reports.moderate|chat_message.hide';
  v_fingerprint:=private.admin_request_fingerprint(jsonb_build_object(
    'contract_version',1,'actor_kind','human_admin','actor_id',v_actor,
    'capability','chat.abuse_reports.moderate','action','chat_message.hide',
    'target_type','report','target_id',p_report_id,'reason',v_reason));
  perform pg_advisory_xact_lock(hashtextextended(v_scope||':'||p_idempotency_key::text,0));
  select * into v_existing from private.admin_content_moderation_actions
    where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='admin_idempotency_conflict';end if;
    return jsonb_build_object('action_id',v_existing.id,'report_id',p_report_id,
      'message_id',v_existing.target_id,'result',v_existing.result,'hidden',true);
  end if;
  select * into v_report from public.reports where id=p_report_id for update;
  if not found or v_report.reported_content_type<>'message' then
    raise exception using errcode='P0002',message='admin_chat_report_not_found';end if;
  select * into v_message from public.messages where id=v_report.reported_content_id for update;
  if not found then raise exception using errcode='P0002',message='admin_chat_message_not_found';end if;
  v_result:=case when v_message.deleted_at is null then 'succeeded' else 'no_op' end;
  if v_message.deleted_at is null then
    update public.messages set deleted_at=clock_timestamp() where id=v_message.id;
  end if;
  insert into private.admin_content_moderation_actions(
    actor_id,actor_role_snapshot,actor_capability,target_type,target_id,action,reason,
    idempotency_scope,idempotency_key,request_fingerprint,visibility_before,visibility_after,result
  ) values(v_actor,private.admin_active_role_codes(v_actor),'chat.abuse_reports.moderate',
    'chat_message',v_message.id,'hide',v_reason,v_scope,p_idempotency_key,v_fingerprint,
    case when v_result='succeeded' then 'visible' else 'hidden' end,'hidden',v_result)
  returning * into v_action;
  v_receipt:=jsonb_build_object('action_id',v_action.id,'report_id',v_report.id,
    'message_id',v_message.id,'result',v_result,'hidden',true);
  insert into private.admin_action_audit(
    actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,target_id,
    target_ref,reason,outcome,financial_effect,contains_pii,metadata,idempotency_scope,
    idempotency_key,request_fingerprint
  ) values(v_actor,'human_admin',private.admin_active_role_codes(v_actor),'chat.abuse_reports.moderate',
    'chat','chat_message.hide','chat_message',v_message.id,v_report.id::text,v_reason,v_result,
    false,true,jsonb_build_object('receipt',v_receipt,'moderation_action_id',v_action.id,
      'report_id',v_report.id),v_scope,p_idempotency_key,v_fingerprint);
  return v_receipt;
end;
$$;

-- Normal Story SECURITY DEFINER paths must honor the same visibility overlay as RLS.
create or replace function public.mark_story_viewed(p_story_id uuid)
returns table(status text,viewed_at timestamptz)
language plpgsql security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_actor uuid:=auth.uid();v_owner uuid;v_viewed_at timestamptz;
begin
  if v_actor is null then raise exception using errcode='42501',message='not_authenticated';end if;
  if p_story_id is null then raise exception using errcode='22023',message='invalid_story_id';end if;
  select s.user_id into v_owner from public.stories s where s.id=p_story_id
    and s.expires_at>now() and private.admin_content_is_visible('story',s.id)
    and (s.user_id=v_actor or private.story_can_view_owner(s.user_id));
  if v_owner is null then raise exception using errcode='42501',message='story_not_visible_or_expired';end if;
  if v_owner=v_actor then return query select 'owner'::text,null::timestamptz;return;end if;
  insert into public.story_views as sv(story_id,viewer_id) values(p_story_id,v_actor)
    on conflict(story_id,viewer_id) do nothing returning sv.viewed_at into v_viewed_at;
  if v_viewed_at is not null then return query select 'recorded'::text,v_viewed_at;return;end if;
  select sv.viewed_at into v_viewed_at from public.story_views sv
    where sv.story_id=p_story_id and sv.viewer_id=v_actor;
  return query select 'already_recorded'::text,v_viewed_at;
end;
$$;

create or replace function public.set_story_reaction(p_story_id uuid,p_reaction text)
returns table(status text,reaction text,updated_at timestamptz)
language plpgsql security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_actor uuid:=auth.uid();v_owner uuid;v_expires_at timestamptz;v_prior text;
  v_updated_at timestamptz;v_deleted boolean;
begin
  if v_actor is null then raise exception using errcode='42501',message='authentication_required';end if;
  if p_story_id is null or (p_reaction is not null and p_reaction not in('heart','laugh','wow','sad','fire','clap')) then
    raise exception using errcode='22023',message='invalid_story_reaction';end if;
  select s.user_id,s.expires_at into v_owner,v_expires_at from public.stories s
    where s.id=p_story_id and private.admin_content_is_visible('story',s.id) for share;
  if v_owner is null or v_expires_at<=now() then raise exception using errcode='42501',message='story_not_available';end if;
  if v_owner=v_actor then raise exception using errcode='42501',message='story_owner_cannot_react';end if;
  if not private.story_can_view_owner(v_owner) then raise exception using errcode='42501',message='story_not_visible';end if;
  if p_reaction is null then
    delete from public.story_reactions r where r.story_id=p_story_id and r.reactor_id=v_actor
      returning r.updated_at into v_updated_at;
    v_deleted:=found;
    return query select case when v_deleted then 'removed' else 'unchanged' end::text,
      null::text,v_updated_at;return;
  end if;
  select r.reaction into v_prior from public.story_reactions r
    where r.story_id=p_story_id and r.reactor_id=v_actor;
  insert into public.story_reactions as r(story_id,reactor_id,reaction)
  values(p_story_id,v_actor,p_reaction)
  on conflict(story_id,reactor_id) do update set reaction=excluded.reaction,updated_at=clock_timestamp()
  returning r.updated_at into v_updated_at;
  return query select case when v_prior=p_reaction then 'unchanged' else 'set' end::text,
    p_reaction,v_updated_at;
end;
$$;

create or replace function public.reply_to_story(p_story_id uuid,p_client_message_id uuid,p_text text)
returns public.messages
language plpgsql security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_actor uuid:=auth.uid();v_owner uuid;v_expires_at timestamptz;
  v_body text:=btrim(coalesce(p_text,''));v_conversation public.chat_conversations;v_message public.messages;
begin
  if v_actor is null then raise exception using errcode='42501',message='authentication_required';end if;
  if p_story_id is null or p_client_message_id is null then
    raise exception using errcode='22023',message='invalid_story_reply';end if;
  if v_body='' or char_length(v_body)>4975 then
    raise exception using errcode='22023',message='invalid_story_reply';end if;
  select s.user_id,s.expires_at into v_owner,v_expires_at from public.stories s
    where s.id=p_story_id and private.admin_content_is_visible('story',s.id) for share;
  if v_owner is null or v_expires_at<=now() then raise exception using errcode='42501',message='story_not_available';end if;
  if v_owner=v_actor then raise exception using errcode='42501',message='story_owner_cannot_reply';end if;
  if not private.story_can_view_owner(v_owner) then raise exception using errcode='42501',message='story_not_visible';end if;
  select * into v_conversation from public.chat_get_or_create_direct(v_owner);
  select * into v_message from public.chat_send_message(v_conversation.id,p_client_message_id,
    'Respondió a tu historia'||E'\n'||v_body,'text',null,null,null,null,null);
  return v_message;
end;
$$;

create or replace function public.get_story_reactions(
  p_story_id uuid,p_limit integer default 50,p_before_updated_at timestamptz default null,
  p_before_reactor_id uuid default null
) returns table(reactor_id uuid,username text,avatar_url text,reaction text,reacted_at timestamptz,total_count bigint)
language plpgsql security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_actor uuid:=auth.uid();v_owner uuid;v_limit integer:=greatest(1,least(coalesce(p_limit,50),100));
begin
  if v_actor is null then raise exception using errcode='42501',message='authentication_required';end if;
  if p_story_id is null or (p_before_updated_at is null)<>(p_before_reactor_id is null) then
    raise exception using errcode='22023',message='invalid_reaction_cursor';end if;
  select s.user_id into v_owner from public.stories s
    where s.id=p_story_id and private.admin_content_is_visible('story',s.id);
  if v_owner is null or v_owner<>v_actor then
    raise exception using errcode='42501',message='story_not_found_or_not_owned';end if;
  return query with total as(select count(*)::bigint n from public.story_reactions r where r.story_id=p_story_id),
  page as(select r.reactor_id,r.reaction,r.updated_at from public.story_reactions r
    where r.story_id=p_story_id and (p_before_updated_at is null
      or(r.updated_at,r.reactor_id)<(p_before_updated_at,p_before_reactor_id))
    order by r.updated_at desc,r.reactor_id desc limit v_limit)
  select page.reactor_id,coalesce(p.username,'user')::text,p.avatar_url,page.reaction,
    page.updated_at,total.n from page join public.public_user_profiles p on p.id=page.reactor_id
    cross join total order by page.updated_at desc,page.reactor_id desc;
end;
$$;

create or replace function public.get_story_viewers(
  p_story_id uuid,p_limit integer default 50,p_before_viewed_at timestamptz default null,
  p_before_viewer_id uuid default null
) returns table(viewer_id uuid,username text,avatar_url text,viewed_at timestamptz,total_count bigint)
language plpgsql security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_actor uuid:=auth.uid();v_owner uuid;v_limit integer:=greatest(1,least(coalesce(p_limit,50),100));
begin
  if v_actor is null then raise exception using errcode='42501',message='not_authenticated';end if;
  if p_story_id is null or (p_before_viewed_at is null)<>(p_before_viewer_id is null) then
    raise exception using errcode='22023',message='invalid_viewer_cursor';end if;
  select s.user_id into v_owner from public.stories s
    where s.id=p_story_id and private.admin_content_is_visible('story',s.id);
  if v_owner is null then raise exception using errcode='42501',message='story_not_found';end if;
  if v_owner<>v_actor then raise exception using errcode='42501',message='story_viewers_owner_only';end if;
  return query with total as(select count(*)::bigint n from public.story_views sv
    where sv.story_id=p_story_id and sv.viewer_id<>v_owner),
  page as(select sv.viewer_id,p.username,p.avatar_url,sv.viewed_at from public.story_views sv
    join public.public_user_profiles p on p.id=sv.viewer_id
    where sv.story_id=p_story_id and sv.viewer_id<>v_owner and (p_before_viewed_at is null
      or(sv.viewed_at,sv.viewer_id)<(p_before_viewed_at,p_before_viewer_id))
    order by sv.viewed_at desc,sv.viewer_id desc limit v_limit)
  select page.viewer_id,page.username,page.avatar_url,page.viewed_at,total.n
    from page cross join total order by page.viewed_at desc,page.viewer_id desc;
end;
$$;

create or replace function public.marketplace_creator_content_visible(
  p_video_id uuid,p_viewer_id uuid default auth.uid()
) returns boolean
language sql stable security definer
set search_path to 'pg_catalog','private','public'
as $$
  select exists(select 1 from public.videos v join public.user_profiles u on u.id=v.user_id
    where v.id=p_video_id and private.admin_content_is_visible('video',v.id)
      and not exists(select 1 from public.blocked_users b where
        (b.blocker_id=p_viewer_id and b.blocked_id=v.user_id)
        or(b.blocker_id=v.user_id and b.blocked_id=p_viewer_id))
      and(not u.is_private or p_viewer_id=v.user_id or exists(select 1 from public.follows f
        where f.follower_id=p_viewer_id and f.following_id=v.user_id)));
$$;

create or replace function public.get_story_shared_content(p_story_id uuid)
returns table(status text,source_video_id uuid,content_type text,owner_id uuid,username text,
  avatar_url text,caption text,preview_url text)
language plpgsql stable security definer
set search_path to 'pg_catalog','private','public'
as $$
declare v_actor uuid:=auth.uid();v_story public.stories;
begin
  if v_actor is null then raise exception using errcode='42501',message='not_authenticated';end if;
  if p_story_id is null then raise exception using errcode='22023',message='invalid_story_id';end if;
  select s.* into v_story from public.stories s where s.id=p_story_id and s.story_kind='shared'
    and s.expires_at>now() and private.admin_content_is_visible('story',s.id)
    and(s.user_id=v_actor or private.story_can_view_owner(s.user_id));
  if not found then raise exception using errcode='42501',message='story_not_visible';end if;
  if v_story.shared_video_id is null
     or not private.admin_content_is_visible('video',v_story.shared_video_id)
     or not public.marketplace_creator_content_visible(v_story.shared_video_id,v_actor) then
    return query select 'unavailable'::text,null::uuid,null::text,null::uuid,
      null::text,null::text,null::text,null::text;return;
  end if;
  return query select 'available'::text,v.id,v_story.shared_content_type,v.user_id,
    p.username,p.avatar_url,left(v.caption,160),case
      when v_story.shared_content_type='reel' then case when v.thumbnail_url~*'^https://' then v.thumbnail_url end
      when coalesce(cardinality(v.media_urls),0)>0 then case when v.media_urls[1]~*'^https://' then v.media_urls[1] end
      else case when v.video_url~*'^https://' then v.video_url end end
  from public.videos v join public.public_user_profiles p on p.id=v.user_id
  where v.id=v_story.shared_video_id;
end;
$$;

-- Explicit Data API grants: user-report RPCs are authenticated; admin RPCs remain
-- authenticated human surfaces whose authority is revalidated server-side.
revoke all on function public.admin_moderate_content(text,uuid,text,text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.admin_moderate_story(uuid,text,text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.search_admin_content(text,text,text,uuid,timestamptz,uuid,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.get_admin_content_detail(text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.search_admin_stories(text,text,uuid,timestamptz,uuid,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.get_admin_story_detail(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.report_story(uuid,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.report_chat_message(uuid,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.admin_moderate_reported_chat_message(uuid,text,uuid)
  from public,anon,authenticated,service_role;

grant execute on function public.admin_moderate_content(text,uuid,text,text,uuid) to authenticated;
grant execute on function public.admin_moderate_story(uuid,text,text,uuid) to authenticated;
grant execute on function public.search_admin_content(text,text,text,uuid,timestamptz,uuid,integer) to authenticated;
grant execute on function public.get_admin_content_detail(text,uuid) to authenticated;
grant execute on function public.search_admin_stories(text,text,uuid,timestamptz,uuid,integer) to authenticated;
grant execute on function public.get_admin_story_detail(uuid) to authenticated;
grant execute on function public.report_story(uuid,text,text) to authenticated;
grant execute on function public.report_chat_message(uuid,text,text) to authenticated;
grant execute on function public.admin_moderate_reported_chat_message(uuid,text,uuid) to authenticated;

-- Existing A4 report RPCs retain authenticated-only grants after replacement.
revoke all on function public.search_admin_reports(text,text,text,timestamptz,uuid,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.get_admin_report_detail(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.search_admin_reports(text,text,text,timestamptz,uuid,integer) to authenticated;
grant execute on function public.get_admin_report_detail(uuid) to authenticated;

do $a5_postcheck$
begin
  if (select count(*) from private.admin_roles)<>6
     or (select count(*) from private.admin_capabilities)<>47
     or (select count(*) from private.admin_role_capabilities)<>142
     or (select count(*) from private.admin_role_grant_rules)<>7 then
    raise exception 'a5_catalog_changed';
  end if;
  if exists(select 1 from private.admin_user_roles where role_code='SUPER_ADMIN' and revoked_at is null) then
    raise exception 'a5_super_super_admin_created';
  end if;
  if exists(select 1 from private.admin_content_moderation_actions)
     or exists(select 1 from private.admin_content_moderation_state) then
    raise exception 'a5_migration_must_not_moderate_content';
  end if;
end
$a5_postcheck$;
