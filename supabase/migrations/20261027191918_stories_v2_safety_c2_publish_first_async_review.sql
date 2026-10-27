begin;

-- C1 remains an immutable historical technical attestation. C2 approves the
-- publication operating model only; evidence never becomes an automatic verdict.
do $preconditions$
begin
  if pg_catalog.to_regprocedure('private.story_content_safety_control_c1_v1()') is null then
    raise exception 'stories_safety_c2_requires_c1';
  end if;
end;
$preconditions$;

alter table private.story_safety_state
  add column publication_status text not null default 'unpublished'
    check(publication_status in('unpublished','published','restricted','removed')),
  add column moderation_status text not null default 'unreviewed'
    check(moderation_status in('unreviewed','alerted','reviewed_keep','reviewed_restrict','reviewed_remove')),
  add column published_at timestamptz,
  add column publication_policy_id text,
  add column moderation_actor_id uuid references auth.users(id) on delete restrict,
  add column moderation_reason text,
  add column moderated_at timestamptz;
alter table private.story_safety_state enable row level security;
alter table private.story_safety_state force row level security;
revoke all on private.story_safety_state from public,anon,authenticated,service_role;

create function private.story_content_safety_control_c2_v1()
returns jsonb language sql immutable security definer set search_path='' as $$
  select $control${
    "policy_id": "nelyon.stories.general.safety.publish_first.v1",
    "policy_artifact_sha256": "cda5960571c33b88e3b22a7d442aeb6b5cee9250b2d0a298b8907a72ba083fcf",
    "mode": "PUBLISH_FIRST_ASYNC_REVIEW",
    "activation": true,
    "owner_approved_operating_model": true,
    "owner_approved_policy": false,
    "automatic_allow_authorized": false,
    "automatic_block_authorized": false,
    "numeric_thresholds": null,
    "historical_backfill": false
  }$control$::jsonb;
$$;

-- Only inserts occurring under C2 are eligible for the new publication fence.
-- No existing row, technical decision, or scan is rewritten by this migration.
create or replace function private.story_initialize_safety()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is not null then perform private.story_consume_velocity(auth.uid(),'create'); end if;
  insert into private.story_safety_state(story_id,publication_policy_id)
    values(new.id,'nelyon.stories.general.safety.publish_first.v1');
  return new;
end;
$$;

create function private.story_publish_c2_v1(p_story_id uuid,p_scan_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_state private.story_safety_state;v_story public.stories;v_fingerprint text;
begin
  select * into v_story from public.stories where id=p_story_id for share;
  select * into v_state from private.story_safety_state where story_id=p_story_id for update;
  v_fingerprint:=private.story_current_fingerprint(p_story_id);
  if v_story.id is null or v_story.user_id is distinct from auth.uid() or p_scan_id is null
    or v_story.expires_at<=pg_catalog.now() or v_state.scan_id is distinct from p_scan_id
    or v_state.evidence_fingerprint is distinct from v_fingerprint
    or not exists(select 1 from private.content_safety_scans scan
      where scan.id=p_scan_id and scan.target_type='story' and scan.target_id=p_story_id
        and scan.content_fingerprint=private.content_safety_sha256('story|'||p_story_id::text||'|'||v_fingerprint)) then
    raise exception using errcode='55000',message='story_safety_publication_fence_failed';
  end if;
  -- Retries cannot reinstate a restricted/removed Story or publish a historical row.
  update private.story_safety_state set publication_status='published',published_at=pg_catalog.clock_timestamp()
    where story_id=p_story_id and publication_status='unpublished' and published_at is null
      and publication_policy_id='nelyon.stories.general.safety.publish_first.v1';
end;
$$;

create or replace function private.story_can_access(p_story_id uuid,p_allow_expired boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from public.stories s
    join private.story_safety_state safety on safety.story_id=s.id
    where s.id=p_story_id and private.admin_content_is_visible('story',s.id)
      and (p_allow_expired or s.expires_at>pg_catalog.now())
      and safety.publication_status not in('restricted','removed')
      and (s.user_id=auth.uid() or (private.story_can_view_owner(s.user_id)
        and safety.publication_status='published')));
$$;

create function private.story_runtime_status_c2_v1(p_story_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce((select pg_catalog.jsonb_build_object(
    'publication_status',state.publication_status,'moderation_status',case
      when state.moderation_status in('unreviewed','alerted','reviewed_keep') and scan.id is not null
        and exists(select 1 from private.content_safety_alerts alert where alert.scan_id=scan.id
          and alert.target_type='story' and alert.target_id=state.story_id and alert.status in('open','in_review')) then 'alerted'
      when state.moderation_status='alerted' then 'unreviewed' else state.moderation_status end,
    'scan_status',case
      when scan.id is null then null
      when scan.status='failed' or scan.text_status='failed' or scan.visual_status in('failed','not_configured')
        or scan.audio_status in('failed','not_configured') then 'failed'
      when state.visual_complete and state.audio_complete and state.text_complete
        and state.evidence_generation=state.generation then 'completed'
      when scan.status='processing' or scan.text_status='processing' or scan.visual_status='processing'
        or scan.audio_status='processing' then 'processing' else 'queued' end)
  from private.story_safety_state state
  left join private.content_safety_scans scan on scan.id=state.scan_id and scan.target_type='story'
    and scan.target_id=state.story_id and state.evidence_fingerprint=private.story_current_fingerprint(state.story_id)
    and scan.content_fingerprint=private.content_safety_sha256(
      'story|'||state.story_id::text||'|'||state.evidence_fingerprint)
  where state.story_id=p_story_id),pg_catalog.jsonb_build_object(
    'publication_status','unpublished','moderation_status','unreviewed','scan_status',null));
$$;

create function private.story_alert_moderation_c2_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.target_type='story' and new.status in('open','in_review') then
    update private.story_safety_state state set moderation_status='alerted'
    from public.stories story,private.content_safety_scans scan
    where state.story_id=new.target_id and story.id=state.story_id and story.expires_at>pg_catalog.now()
      and state.moderation_status='unreviewed' and state.publication_status='published'
      and state.scan_id=new.scan_id and scan.id=new.scan_id and scan.target_type='story'
      and scan.target_id=state.story_id and state.evidence_fingerprint=private.story_current_fingerprint(state.story_id)
      and scan.content_fingerprint=private.content_safety_sha256('story|'||state.story_id::text||'|'||state.evidence_fingerprint);
  end if;
  return new;
end;
$$;
create trigger content_safety_story_alert_moderation_c2
after insert or update on private.content_safety_alerts for each row
execute function private.story_alert_moderation_c2_v1();

-- Existing action records remain immutable. Only Story actions gain decisions;
-- all other target/action and capability constraints remain equally narrow.
alter table private.admin_content_moderation_actions
  drop constraint admin_content_moderation_actions_action_check;
alter table private.admin_content_moderation_actions add constraint admin_content_moderation_actions_action_check
  check(action in('hide','restore') or (target_type='story' and action in('keep','restrict','remove')));

create or replace function public.admin_moderate_story(
  p_story_id uuid,p_action text,p_reason text,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid;v_reason text:=nullif(pg_catalog.btrim(p_reason),'');v_scope text;v_fingerprint text;
  v_existing private.admin_content_moderation_actions;v_action private.admin_content_moderation_actions;
  v_state private.story_safety_state;v_publication text;v_moderation text;v_visibility text;v_result text;v_receipt jsonb;
begin
  v_actor:=public.admin_require_capability('stories.items.moderate');
  if p_action is null or p_action not in('hide','restore','keep','restrict','remove') or p_story_id is null
    or p_idempotency_key is null or v_reason is null or pg_catalog.char_length(v_reason) not between 2 and 500 then
    raise exception using errcode='22023',message='admin_story_moderation_invalid';end if;
  if p_action in('hide','restore') then
    return private.admin_execute_content_moderation(v_actor,'stories.items.moderate','story',
      p_story_id,p_action,v_reason,p_idempotency_key);
  end if;
  v_scope:='v1|human|'||v_actor::text||'|stories.items.moderate|story.'||p_action;
  v_fingerprint:=private.admin_request_fingerprint(pg_catalog.jsonb_build_object(
    'contract_version',1,'actor_kind','human_admin','actor_id',v_actor,'capability','stories.items.moderate',
    'action','story.'||p_action,'target_type','story','target_id',p_story_id,'reason',v_reason));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_scope||':'||p_idempotency_key::text,0));
  select * into v_existing from private.admin_content_moderation_actions
    where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='admin_idempotency_conflict';end if;
    select audit.metadata->'receipt' into v_receipt from private.admin_action_audit audit
      where audit.idempotency_scope=v_scope and audit.idempotency_key=p_idempotency_key;
    return v_receipt;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin-content-target:story:'||p_story_id::text,0));
  perform 1 from public.stories where id=p_story_id for share;
  if not found then raise exception using errcode='P0002',message='admin_content_target_not_found';end if;
  select * into v_state from private.story_safety_state where story_id=p_story_id for update;
  if not found then raise exception using errcode='P0002',message='admin_story_safety_not_found';end if;
  v_visibility:=case when private.admin_content_is_visible('story',p_story_id) then 'visible' else 'hidden' end;
  v_moderation:=case p_action when 'keep' then 'reviewed_keep' when 'restrict' then 'reviewed_restrict' else 'reviewed_remove' end;
  v_publication:=case p_action when 'restrict' then 'restricted' when 'remove' then 'removed' else v_state.publication_status end;
  if p_action='keep' and v_state.published_at is not null and exists(
    select 1 from public.stories story join private.content_safety_scans scan on scan.id=v_state.scan_id
    where story.id=p_story_id and story.expires_at>pg_catalog.now() and scan.target_type='story' and scan.target_id=p_story_id
      and v_state.evidence_fingerprint=private.story_current_fingerprint(p_story_id)
      and scan.content_fingerprint=private.content_safety_sha256('story|'||p_story_id::text||'|'||v_state.evidence_fingerprint)) then
    v_publication:='published';
  end if;
  v_result:=case when v_state.publication_status=v_publication and v_state.moderation_status=v_moderation then 'no_op' else 'succeeded' end;
  insert into private.admin_content_moderation_actions(actor_id,actor_role_snapshot,actor_capability,
    target_type,target_id,action,reason,idempotency_scope,idempotency_key,request_fingerprint,
    visibility_before,visibility_after,result)
  values(v_actor,private.admin_active_role_codes(v_actor),'stories.items.moderate','story',p_story_id,p_action,v_reason,
    v_scope,p_idempotency_key,v_fingerprint,
    case when v_state.publication_status in('restricted','removed') then 'hidden' else v_visibility end,
    case when v_publication='published' then v_visibility else 'hidden' end,v_result) returning * into v_action;
  update private.story_safety_state set publication_status=v_publication,moderation_status=v_moderation,
    moderation_actor_id=v_actor,moderation_reason=v_reason,moderated_at=pg_catalog.clock_timestamp()
    where story_id=p_story_id;
  v_receipt:=pg_catalog.jsonb_build_object('action_id',v_action.id,'target_type','story','target_id',p_story_id,
    'action',p_action,'visibility',v_action.visibility_after,'result',v_result,
    'publication_status',v_publication,'moderation_status',v_moderation);
  insert into private.admin_action_audit(actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,
    target_type,target_id,target_ref,reason,outcome,financial_effect,contains_pii,metadata,
    idempotency_scope,idempotency_key,request_fingerprint)
  values(v_actor,'human_admin',private.admin_active_role_codes(v_actor),'stories.items.moderate','stories','story.'||p_action,
    'story',p_story_id,v_action.id::text,v_reason,v_result,false,false,
    pg_catalog.jsonb_build_object('receipt',v_receipt,'moderation_action_id',v_action.id),v_scope,p_idempotency_key,v_fingerprint);
  return v_receipt;
end;
$$;

create function private.story_content_safety_policy_c2_v1()
returns jsonb language sql immutable security definer set search_path='' as $$
select $policy${
  "schema_version": "nelyon.stories_content_safety_policy.v1",
  "policy_id": "nelyon.stories.general.safety.publish_first.v1",
  "mode": "PUBLISH_FIRST_ASYNC_REVIEW",
  "approval": {
    "status": "owner_approved_operating_model_only",
    "source": "docs/superpowers/specs/2026-10-27-stories-v2-safety-c2-design.md",
    "authorized_phase": "STORIES-V2-SAFETY-C2",
    "numeric_thresholds_approved": false,
    "automatic_allow_authorized": false,
    "automatic_block_authorized": false
  },
  "publication": {
    "canonical_authority": "public.stories",
    "requires_existing_technical_contracts": true,
    "requires_atomic_current_durable_scan": true,
    "requires_safety_pass": false,
    "historical_backfill": false,
    "scan_failure_unpublishes": false
  },
  "review": {
    "scanner": "content-safety-scan",
    "existing_deduplicated_alerts": true,
    "sanction_authority": "stories.items.moderate",
    "human_decisions": [
      "keep",
      "restrict",
      "remove"
    ],
    "audited_idempotent_decisions": true,
    "scanner_overwrites_human_decision": false,
    "private_question_responses_remain_private": true
  },
  "automatic_allow_authorized": false,
  "automatic_block_authorized": false,
  "numeric_thresholds": null,
  "artifact_sha256": "cda5960571c33b88e3b22a7d442aeb6b5cee9250b2d0a298b8907a72ba083fcf"
}$policy$::jsonb;
$$;

create or replace function public.create_story_with_media(
  p_asset_id uuid,p_composition jsonb,p_client_story_id uuid,p_interactive_definitions jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_story uuid;v_scan uuid;
begin
  if auth.uid() is null or p_client_story_id is null then
    raise exception using errcode='22023',message='invalid_story_identity';end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('story-create:'||auth.uid()::text||':'||p_client_story_id::text,0)
  );
  v_story:=private.create_story_with_media_core(p_asset_id,p_composition,p_client_story_id);
  perform private.story_install_definitions(v_story,p_interactive_definitions);
  v_scan:=private.story_enqueue_media_safety_v1(v_story);
  perform private.story_publish_c2_v1(v_story,v_scan);
  return v_story;
end;
$$;

create or replace function public.create_story_with_media(
  p_asset_id uuid,p_composition jsonb,p_client_story_id uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_story uuid;v_scan uuid;
begin
  v_story:=private.create_story_with_media_core(p_asset_id,p_composition,p_client_story_id);
  v_scan:=private.story_enqueue_media_safety_v1(v_story);
  perform private.story_publish_c2_v1(v_story,v_scan);
  return v_story;
end;
$$;

create or replace function public.create_story_with_media(p_asset_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_story uuid;v_scan uuid;
begin
  v_story:=private.create_story_with_media_core(
    p_asset_id,'{"version":1,"elements":[]}'::jsonb,null
  );
  v_scan:=private.story_enqueue_media_safety_v1(v_story);
  perform private.story_publish_c2_v1(v_story,v_scan);
  return v_story;
end;
$$;

create or replace function public.create_story_from_content(
  p_video_id uuid,p_composition jsonb,p_client_story_id uuid,p_interactive_definitions jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_story uuid;v_scan uuid;
begin
  if auth.uid() is null or p_client_story_id is null then
    raise exception using errcode='22023',message='invalid_story_identity';end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('story-create:'||auth.uid()::text||':'||p_client_story_id::text,0)
  );
  v_story:=private.create_story_from_content_core_c2_v1(p_video_id,p_composition,p_client_story_id);
  perform private.story_install_definitions(v_story,p_interactive_definitions);
  v_scan:=private.story_enqueue_media_safety_v1(v_story);
  perform private.story_publish_c2_v1(v_story,v_scan);
  return v_story;
end;
$$;


create function private.create_story_from_content_core_c2_v1(
  p_video_id uuid,
  p_composition jsonb,
  p_client_story_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_story_id uuid;
  v_scan uuid;
  v_content_type text;
  v_composition jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if p_video_id is null or p_client_story_id is null then
    raise exception using errcode = '22023', message = 'invalid_story_source';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('story-create:'||v_actor::text||':'||p_client_story_id::text,0));
  v_composition := private.story_validate_composition(p_composition);

  select s.id into v_story_id
  from public.stories s
  where s.user_id = v_actor and s.client_story_id = p_client_story_id
    and s.story_kind = 'shared' and s.shared_video_id = p_video_id
    and s.story_composition = v_composition;
  if v_story_id is not null then
    return v_story_id;
  end if;
  if exists (
    select 1 from public.stories s
    where s.user_id = v_actor and s.client_story_id = p_client_story_id
  ) then
    raise exception using errcode = '23505', message = 'story_idempotency_conflict';
  end if;

  perform v.id from public.videos v where v.id = p_video_id for key share;
  if not found or not public.marketplace_creator_content_visible(p_video_id, v_actor) then
    raise exception using errcode = '42501', message = 'story_source_not_visible';
  end if;
  v_content_type := public.marketplace_video_content_type(p_video_id);
  if v_content_type not in ('feed','reel') then
    raise exception using errcode = '22023', message = 'story_source_type_invalid';
  end if;

  insert into public.stories(
    user_id, media_url, media_type, story_kind, shared_video_id,
    shared_content_type, story_composition, client_story_id
  ) values (
    v_actor, null, 'photo', 'shared', p_video_id,
    v_content_type, v_composition, p_client_story_id
  ) returning id into v_story_id;
  return v_story_id;
end;
$$;
create or replace function public.create_story_from_content(p_video_id uuid,p_composition jsonb,p_client_story_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_story uuid;v_scan uuid;
begin
  v_story:=private.create_story_from_content_core_c2_v1(p_video_id,p_composition,p_client_story_id);
  v_scan:=private.story_enqueue_media_safety_v1(v_story);
  perform private.story_publish_c2_v1(v_story,v_scan);
  return v_story;
end;
$$;

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
set search_path=''
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
      case when c2.publication_status in('restricted','removed') then 'hidden' else coalesce(ms.visibility,'visible') end as visibility,
      p.username,
      p.display_name,
      p.avatar_url,
      case
        when s.story_kind='shared' and v.id is null then 'missing'
        when s.story_kind='shared' and (stream_media.asset_id is not null or r2_media.asset_id is not null) then 'available'
        when s.story_kind='media' and direct_stream.asset_id is not null then 'available'
        when s.story_kind='media' and direct_media.asset_id is not null
          and direct_media.status='ready'
          and (direct_media.visibility='private' or direct_media.public_url is not null) then 'available'
        else 'unavailable'
      end as source_status,
      case
        when s.story_kind='shared' and stream_media.asset_id is not null then 'shared_stream_asset'
        when s.story_kind='shared' and r2_media.asset_id is not null then 'shared_r2_asset'
        when s.story_kind='media' and direct_stream.asset_id is not null then 'story_stream_asset'
        when s.story_kind='media' and direct_media.asset_id is not null
          and direct_media.status='ready'
          and (direct_media.visibility='private' or direct_media.public_url is not null) then 'story_asset'
        else null
      end as media_origin,
      case
        when s.story_kind='shared' and stream_media.asset_id is not null then 'video'
        when s.story_kind='shared' and r2_media.asset_id is not null then r2_media.media_kind
        when s.story_kind='media' and direct_stream.asset_id is not null then 'video'
        when s.story_kind='media' then direct_media.media_kind
        else null
      end as resolved_media_kind,
      case
        when s.story_kind='shared' and stream_media.asset_id is not null then stream_media.thumbnail_url
        when s.story_kind='shared' and r2_media.asset_id is not null then r2_media.public_url
        when s.story_kind='media' then direct_media.public_url
        else null
      end as preview_url,
      direct_stream.asset_id as linked_video_asset_id,
      direct_stream.asset_id as video_asset_id,
      reports.report_count
    from public.stories s
    left join private.story_safety_state c2 on c2.story_id=s.id
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
      select l.asset_id
      from public.video_asset_links l join public.video_assets va on va.id=l.asset_id
      where s.story_kind='media' and s.media_type='video' and l.entity_type='story'
        and l.entity_id=s.id and l.slot='media' and l.position=0
        and l.owner_id=s.user_id and va.owner_id=s.user_id
        and va.provider='cloudflare_stream' and va.purpose='story_video'
        and va.visibility='private' and va.status='ready' and va.deleted_at is null
        and va.provider_metadata->'require_signed_urls'='true'::jsonb
        and nullif(pg_catalog.btrim(va.cloudflare_uid),'') is not null and va.ready_at is not null
        and va.duration_seconds>0 and va.duration_seconds<=15 and va.max_duration_seconds=15
        and va.hls_url is null and va.dash_url is null and va.thumbnail_url is null
      order by l.id limit 1
    ) direct_stream on true
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
    where (p_visibility is null or case when c2.publication_status in('restricted','removed') then 'hidden' else coalesce(ms.visibility,'visible') end=p_visibility)
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
      'linked_video_asset_id',linked_video_asset_id,
      'video_asset_id',video_asset_id,
      'report_count',report_count
    ) || private.story_runtime_status_c2_v1(id) order by created_at desc,id desc),'[]'::jsonb),
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
set search_path=''
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
      when s.story_kind='media' and direct_stream.asset_id is not null then 'video'
      when s.story_kind='media' then direct_media.media_kind
      else null
    end,
    'created_at',s.created_at,
    'expires_at',s.expires_at,
    'expired',s.expires_at<=clock_timestamp(),
    'shared_video_id',s.shared_video_id,
    'shared_content_type',s.shared_content_type,
    'composition',s.story_composition,
    'visibility',case when c2.publication_status in('restricted','removed') then 'hidden' else coalesce(ms.visibility,'visible') end,
    'source_status',case
      when s.story_kind='shared' and v.id is null then 'missing'
      when s.story_kind='shared' and (stream_media.asset_id is not null or r2_media.asset_id is not null) then 'available'
      when s.story_kind='media' and direct_stream.asset_id is not null then 'available'
      when s.story_kind='media' and direct_media.asset_id is not null
        and direct_media.status='ready'
        and (direct_media.visibility='private' or direct_media.public_url is not null) then 'available'
      else 'unavailable'
    end,
    'media_origin',case
      when s.story_kind='shared' and stream_media.asset_id is not null then 'shared_stream_asset'
      when s.story_kind='shared' and r2_media.asset_id is not null then 'shared_r2_asset'
      when s.story_kind='media' and direct_stream.asset_id is not null then 'story_stream_asset'
      when s.story_kind='media' and direct_media.asset_id is not null
        and direct_media.status='ready'
        and (direct_media.visibility='private' or direct_media.public_url is not null) then 'story_asset'
      else null
    end,
    'linked_media_asset_id',direct_media.asset_id,
    'linked_video_asset_id',direct_stream.asset_id,
    'video_asset_id',direct_stream.asset_id,
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
    left join private.story_safety_state c2 on c2.story_id=s.id
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
    select l.asset_id
    from public.video_asset_links l join public.video_assets va on va.id=l.asset_id
    where s.story_kind='media' and s.media_type='video' and l.entity_type='story'
      and l.entity_id=s.id and l.slot='media' and l.position=0
      and l.owner_id=s.user_id and va.owner_id=s.user_id
      and va.provider='cloudflare_stream' and va.purpose='story_video'
      and va.visibility='private' and va.status='ready' and va.deleted_at is null
      and va.provider_metadata->'require_signed_urls'='true'::jsonb
      and nullif(pg_catalog.btrim(va.cloudflare_uid),'') is not null and va.ready_at is not null
      and va.duration_seconds>0 and va.duration_seconds<=15 and va.max_duration_seconds=15
      and va.hls_url is null and va.dash_url is null and va.thumbnail_url is null
    order by l.id limit 1
  ) direct_stream on true
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
  return v_result || private.story_runtime_status_c2_v1(p_story_id);
end;
$$;

alter function private.story_content_safety_policy_c2_v1() owner to postgres;
revoke all on function private.story_content_safety_policy_c2_v1() from public,anon,authenticated,service_role;

alter function private.story_content_safety_control_c2_v1() owner to postgres;
revoke all on function private.story_content_safety_control_c2_v1() from public,anon,authenticated,service_role;

alter function private.story_initialize_safety() owner to postgres;
revoke all on function private.story_initialize_safety() from public,anon,authenticated,service_role;

alter function private.story_publish_c2_v1(uuid,uuid) owner to postgres;
revoke all on function private.story_publish_c2_v1(uuid,uuid) from public,anon,authenticated,service_role;

alter function private.story_runtime_status_c2_v1(uuid) owner to postgres;
revoke all on function private.story_runtime_status_c2_v1(uuid) from public,anon,authenticated,service_role;

alter function private.story_alert_moderation_c2_v1() owner to postgres;
revoke all on function private.story_alert_moderation_c2_v1() from public,anon,authenticated,service_role;

alter function private.story_can_access(uuid,boolean) owner to postgres;
revoke all on function private.story_can_access(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function private.story_can_access(uuid,boolean) to authenticated;

alter function public.create_story_with_media(uuid) owner to postgres;
revoke all on function public.create_story_with_media(uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_story_with_media(uuid) to authenticated;

alter function public.create_story_with_media(uuid,jsonb,uuid) owner to postgres;
revoke all on function public.create_story_with_media(uuid,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_story_with_media(uuid,jsonb,uuid) to authenticated;

alter function public.create_story_with_media(uuid,jsonb,uuid,jsonb) owner to postgres;
revoke all on function public.create_story_with_media(uuid,jsonb,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_story_with_media(uuid,jsonb,uuid,jsonb) to authenticated;

alter function public.create_story_from_content(uuid,jsonb,uuid) owner to postgres;
revoke all on function public.create_story_from_content(uuid,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_story_from_content(uuid,jsonb,uuid) to authenticated;

alter function public.create_story_from_content(uuid,jsonb,uuid,jsonb) owner to postgres;
revoke all on function public.create_story_from_content(uuid,jsonb,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_story_from_content(uuid,jsonb,uuid,jsonb) to authenticated;

alter function public.admin_moderate_story(uuid,text,text,uuid) owner to postgres;
revoke all on function public.admin_moderate_story(uuid,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_moderate_story(uuid,text,text,uuid) to authenticated;

alter function public.search_admin_stories(text,text,uuid,timestamptz,uuid,integer) owner to postgres;
revoke all on function public.search_admin_stories(text,text,uuid,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.search_admin_stories(text,text,uuid,timestamptz,uuid,integer) to authenticated;

alter function public.get_admin_story_detail(uuid) owner to postgres;
revoke all on function public.get_admin_story_detail(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_admin_story_detail(uuid) to authenticated;

alter function private.create_story_from_content_core_c2_v1(uuid,jsonb,uuid) owner to postgres;
revoke all on function private.create_story_from_content_core_c2_v1(uuid,jsonb,uuid) from public,anon,authenticated,service_role;

commit;
