begin;

-- C1 binds approval/activation to a canonical preview and turns the existing
-- F5 backfill into a cursor-driven continuation on the existing F4 queue.
alter table private.content_safety_rules
  add column rescan_state text not null default 'idle',
  add column rescan_rule_version bigint null,
  add column rescan_cursor_target_type text null,
  add column rescan_cursor_target_id uuid null,
  add column rescan_eligible_count bigint not null default 0,
  add column rescan_queued_count bigint not null default 0,
  add column rescan_started_at timestamptz null,
  add column rescan_completed_at timestamptz null,
  add constraint content_safety_rules_rescan_state_check
    check(rescan_state in('idle','pending','running','complete','cancelled')),
  add constraint content_safety_rules_rescan_cursor_check
    check((rescan_cursor_target_type is null)=(rescan_cursor_target_id is null)),
  add constraint content_safety_rules_rescan_counts_check
    check(rescan_eligible_count>=0 and rescan_queued_count>=0),
  add constraint content_safety_rules_rescan_version_check
    check(rescan_rule_version is null or rescan_rule_version>0);

create index content_safety_rules_rescan_dispatch_idx
  on private.content_safety_rules(rescan_started_at,id)
  where rescan_state in('pending','running');

create function private.content_safety_rule_definition_fingerprint(
  p_rule_id uuid,p_rule_version bigint,p_detector_type text,p_pattern text,p_scopes text[],p_locale text
) returns text language sql immutable set search_path=''
as $$
  select private.content_safety_sha256(jsonb_build_object(
    'rule_id',p_rule_id,
    'rule_version',p_rule_version,
    'detector_type',p_detector_type,
    'normalized_pattern',private.normalize_content_safety_text(p_pattern),
    'scopes',array(select distinct btrim(value) from unnest(coalesce(p_scopes,'{}'::text[])) value order by 1),
    'locale',p_locale
  )::text)
$$;

create function private.preview_content_safety_rule_definition(
  p_rule_id uuid,p_rule_version bigint,p_detector_type text,p_pattern text,
  p_scopes text[],p_locale text,p_limit integer
) returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_scopes text[];v_result jsonb;v_definition_fingerprint text;
begin
  v_scopes:=array(select distinct btrim(value) from unnest(coalesce(p_scopes,'{}'::text[])) value order by 1);
  if p_detector_type not in('keyword','phrase') or nullif(btrim(coalesce(p_pattern,'')),'') is null
     or char_length(btrim(p_pattern))>200 or cardinality(v_scopes)=0
     or not(v_scopes<@array['video_caption','comment','story_text','live_chat','reported_message','transcript']::text[])
     or p_locale not in('und','en','es') or p_limit<1 or p_limit>20
     or (p_detector_type='keyword' and private.normalize_content_safety_text(p_pattern)~'[[:space:]]') then
    raise exception using errcode='22023',message='invalid_content_safety_rule_preview';
  end if;
  v_definition_fingerprint:=private.content_safety_rule_definition_fingerprint(
    p_rule_id,p_rule_version,p_detector_type,p_pattern,v_scopes,p_locale
  );
  with candidates as materialized (
    select 'video'::text target_type,v.id target_id,v.user_id owner_user_id,'video_caption'::text scope,
      coalesce(v.caption,'') text_value,coalesce(ms.visibility,'visible') current_visibility
    from public.videos v left join private.admin_content_moderation_state ms on ms.target_type='video' and ms.target_id=v.id
    where 'video_caption'=any(v_scopes)
    union all
    select 'comment',c.id,c.user_id,'comment',coalesce(c.text,''),coalesce(ms.visibility,'visible')
    from public.comments c left join private.admin_content_moderation_state ms on ms.target_type='comment' and ms.target_id=c.id
    where 'comment'=any(v_scopes)
    union all
    select 'story',s.id,s.user_id,'story_text',coalesce((
      select string_agg(nullif(btrim(e->>'text'),''),' ' order by ordinality)
      from jsonb_array_elements(coalesce(s.story_composition->'elements','[]'::jsonb)) with ordinality x(e,ordinality)
      where e->>'type'='text'
    ),''),coalesce(ms.visibility,'visible')
    from public.stories s left join private.admin_content_moderation_state ms on ms.target_type='story' and ms.target_id=s.id
    where 'story_text'=any(v_scopes)
    union all
    select 'live_message',m.id,m.user_id,'live_chat',coalesce(m.message,''),'visible'
    from public.live_messages m where 'live_chat'=any(v_scopes)
    union all
    select 'message',m.id,m.sender_id,'reported_message',coalesce(m.text,''),'reported_only'
    from public.messages m where 'reported_message'=any(v_scopes) and exists(
      select 1 from public.reports r where r.reported_content_type='message' and r.reported_content_id=m.id
    )
  ), matches as materialized (
    select * from candidates c
    where private.content_safety_text_matches(c.text_value,p_pattern,p_detector_type)
  ), samples as (
    select m.*,p.username,p.display_name
    from matches m left join public.user_profiles p on p.id=m.owner_user_id
    order by m.target_type,m.target_id limit p_limit
  )
  select jsonb_build_object(
    'rule_id',p_rule_id,'rule_version',p_rule_version,'definition_fingerprint',v_definition_fingerprint,
    'detector_type',p_detector_type,'normalized_pattern',private.normalize_content_safety_text(p_pattern),
    'locale',p_locale,'scopes',v_scopes,'total_matching_content',(select count(*) from matches),
    'counts',jsonb_build_object(
      'videos',(select count(*) from matches where target_type='video'),
      'stories',(select count(*) from matches where target_type='story'),
      'comments',(select count(*) from matches where target_type='comment'),
      'live_chat',(select count(*) from matches where target_type='live_message'),
      'reported_messages',(select count(*) from matches where target_type='message')
    ),
    'samples',coalesce((select jsonb_agg(jsonb_build_object(
      'target_type',target_type,'target_id',target_id,'scope',scope,
      'author',jsonb_build_object('id',owner_user_id,'username',username,'display_name',display_name),
      'excerpt',left(private.normalize_content_safety_text(text_value),240),
      'current_visibility',current_visibility
    ) order by target_type,target_id) from samples),'[]'::jsonb),
    'sample_limit',p_limit,'excerpt_limit',240,'creates_alerts',false,'creates_scans',false,
    'modifies_content',false,'ordinary_private_messages_included',false
  ) into v_result;
  return v_result;
end;
$$;

drop function public.preview_admin_content_safety_rule(text,text,text[],text,integer);

create function public.preview_admin_content_safety_rule_draft(
  p_detector_type text,p_pattern text,p_scopes text[],p_locale text default 'und',p_limit integer default 20
) returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
  perform public.admin_require_capability('content.items.moderate');
  return private.preview_content_safety_rule_definition(
    null,null,p_detector_type,p_pattern,p_scopes,p_locale,p_limit
  );
end;
$$;

create function public.preview_admin_content_safety_rule(p_rule_id uuid,p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_actor uuid;v_rule private.content_safety_rules;v_result jsonb;v_fingerprint text;v_audit_key uuid:=gen_random_uuid();
begin
  v_actor:=public.admin_require_capability('content.items.moderate');
  select * into v_rule from private.content_safety_rules where id=p_rule_id;
  if not found then raise exception using errcode='P0002',message='content_safety_rule_not_found';end if;
  v_result:=private.preview_content_safety_rule_definition(
    v_rule.id,v_rule.version,v_rule.detector_type,v_rule.pattern,v_rule.scopes,v_rule.locale,p_limit
  );
  v_fingerprint:=v_result->>'definition_fingerprint';
  insert into private.admin_action_audit(
    actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,target_id,target_ref,
    outcome,reason,financial_effect,contains_pii,idempotency_scope,idempotency_key,request_fingerprint,metadata
  ) values(
    v_actor,'human_admin',private.admin_active_role_codes(v_actor),'content.items.moderate','content_safety',
    'content_safety.rule.preview','content_safety_rule',v_rule.id,v_rule.code,'succeeded',null,false,false,
    'v1|human|'||v_actor::text||'|content.items.moderate|content_safety.rule.preview',v_audit_key,v_fingerprint,
    jsonb_build_object('rule_id',v_rule.id,'rule_version',v_rule.version,'definition_fingerprint',v_fingerprint)
  );
  return v_result;
end;
$$;

create function private.require_content_safety_rule_preview(
  p_actor_id uuid,p_rule private.content_safety_rules,p_definition_fingerprint text
) returns void language plpgsql stable security definer set search_path=''
as $$
declare v_expected text;
begin
  v_expected:=private.content_safety_rule_definition_fingerprint(
    p_rule.id,p_rule.version,p_rule.detector_type,p_rule.pattern,p_rule.scopes,p_rule.locale
  );
  if nullif(p_definition_fingerprint,'') is null or p_definition_fingerprint<>v_expected then
    raise exception using errcode='55000',message='content_safety_rule_preview_stale';
  end if;
  if not exists(
    select 1 from private.admin_action_audit a
    where a.actor_id=p_actor_id and a.actor_kind='human_admin'
      and a.action='content_safety.rule.preview' and a.target_type='content_safety_rule'
      and a.target_id=p_rule.id and a.outcome='succeeded'
      and a.metadata->>'rule_version'=p_rule.version::text
      and a.metadata->>'definition_fingerprint'=v_expected
  ) then
    raise exception using errcode='55000',message='content_safety_rule_preview_required';
  end if;
end;
$$;

create function private.content_safety_rule_targets(p_scopes text[])
returns table(target_type text,target_id uuid) language sql stable security definer set search_path=''
as $$
  select eligible.target_type,eligible.target_id from (
    select 'video'::text target_type,v.id target_id from public.videos v where 'video_caption'=any(p_scopes)
    union all select 'comment',c.id from public.comments c where 'comment'=any(p_scopes)
    union all select 'story',s.id from public.stories s where 'story_text'=any(p_scopes)
    union all select 'live_message',m.id from public.live_messages m where 'live_chat'=any(p_scopes)
    union all select 'message',m.id from public.messages m
      where 'reported_message'=any(p_scopes) and exists(
        select 1 from public.reports r where r.reported_content_type='message' and r.reported_content_id=m.id
      )
  ) eligible
$$;

drop function private.content_safety_rule_rescan(uuid,integer);

create function private.process_content_safety_rule_rescan_batch(
  p_rule_id uuid,p_rule_version bigint,p_batch_size integer default 500
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_rule private.content_safety_rules;v_target record;v_scan_id uuid;v_batch_queued bigint:=0;
  v_last_type text;v_last_id uuid;v_has_more boolean:=false;
begin
  if p_batch_size<1 or p_batch_size>500 then raise exception using errcode='22023',message='invalid_content_safety_rescan_batch';end if;
  select * into v_rule from private.content_safety_rules where id=p_rule_id for update;
  if not found then return jsonb_build_object('rule_id',p_rule_id,'status','missing','queued_count',0,'has_more',false);end if;
  if v_rule.approval_state<>'approved' or not v_rule.enabled
     or v_rule.version<>p_rule_version or v_rule.rescan_rule_version<>p_rule_version then
    if v_rule.rescan_state in('pending','running') then
      update private.content_safety_rules set rescan_state='cancelled',rescan_completed_at=clock_timestamp()
      where id=v_rule.id;
    end if;
    return jsonb_build_object('rule_id',v_rule.id,'rule_version',p_rule_version,'status','cancelled','queued_count',0,'has_more',false);
  end if;
  if v_rule.rescan_state not in('pending','running') then
    return jsonb_build_object('rule_id',v_rule.id,'rule_version',p_rule_version,'status',v_rule.rescan_state,'queued_count',0,'has_more',false);
  end if;
  update private.content_safety_rules set rescan_state='running' where id=v_rule.id;
  v_last_type:=v_rule.rescan_cursor_target_type;v_last_id:=v_rule.rescan_cursor_target_id;
  for v_target in
    select t.target_type,t.target_id from private.content_safety_rule_targets(v_rule.scopes) t
    where v_last_type is null or t.target_type>v_last_type or (t.target_type=v_last_type and t.target_id>v_last_id)
    order by t.target_type,t.target_id limit p_batch_size
  loop
    v_scan_id:=private.enqueue_content_safety_scan(v_target.target_type,v_target.target_id,'backfill');
    if v_scan_id is not null then v_batch_queued:=v_batch_queued+1;end if;
    v_last_type:=v_target.target_type;v_last_id:=v_target.target_id;
  end loop;
  if v_last_type is not null then
    select exists(
      select 1 from private.content_safety_rule_targets(v_rule.scopes) t
      where t.target_type>v_last_type or (t.target_type=v_last_type and t.target_id>v_last_id)
    ) into v_has_more;
  end if;
  update private.content_safety_rules set
    rescan_cursor_target_type=v_last_type,rescan_cursor_target_id=v_last_id,
    rescan_queued_count=rescan_queued_count+v_batch_queued,
    rescan_state=case when v_has_more then 'running' else 'complete' end,
    rescan_completed_at=case when v_has_more then null else clock_timestamp() end
  where id=v_rule.id returning * into v_rule;
  return jsonb_build_object(
    'rule_id',v_rule.id,'rule_version',v_rule.rescan_rule_version,'status',v_rule.rescan_state,
    'batch_queued_count',v_batch_queued,'queued_count',v_rule.rescan_queued_count,
    'eligible_count',v_rule.rescan_eligible_count,'cursor_target_type',v_rule.rescan_cursor_target_type,
    'cursor_target_id',v_rule.rescan_cursor_target_id,'batch_size',p_batch_size,'has_more',v_has_more
  );
end;
$$;

create function private.initialize_content_safety_rule_rescan(
  p_rule_id uuid,p_rule_version bigint,p_batch_size integer default 500
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_rule private.content_safety_rules;v_eligible bigint;
begin
  select * into v_rule from private.content_safety_rules where id=p_rule_id for update;
  if not found or v_rule.approval_state<>'approved' or not v_rule.enabled or v_rule.version<>p_rule_version then
    raise exception using errcode='55000',message='content_safety_rule_not_active';
  end if;
  select count(*) into v_eligible from private.content_safety_rule_targets(v_rule.scopes);
  update private.content_safety_rules set
    rescan_state='pending',rescan_rule_version=v_rule.version,
    rescan_cursor_target_type=null,rescan_cursor_target_id=null,
    rescan_eligible_count=v_eligible,rescan_queued_count=0,
    rescan_started_at=clock_timestamp(),rescan_completed_at=null
  where id=v_rule.id;
  return private.process_content_safety_rule_rescan_batch(v_rule.id,v_rule.version,p_batch_size);
end;
$$;

create function private.continue_content_safety_rule_rescans(
  p_rule_limit integer default 1,p_batch_size integer default 500
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_item record;v_results jsonb:='[]'::jsonb;v_processed integer:=0;
begin
  if p_rule_limit<1 or p_rule_limit>10 or p_batch_size<1 or p_batch_size>500 then
    raise exception using errcode='22023',message='invalid_content_safety_rescan_dispatch';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('content_safety_rule_rescan_dispatch',0)) then
    return jsonb_build_object('locked',true,'processed_rules',0,'batches','[]'::jsonb);
  end if;
  for v_item in
    select r.id,r.rescan_rule_version from private.content_safety_rules r
    where r.rescan_state in('pending','running')
    order by r.rescan_started_at,r.id limit p_rule_limit
  loop
    v_results:=v_results||jsonb_build_array(
      private.process_content_safety_rule_rescan_batch(v_item.id,v_item.rescan_rule_version,p_batch_size)
    );
    v_processed:=v_processed+1;
  end loop;
  return jsonb_build_object('locked',false,'processed_rules',v_processed,'batches',v_results);
end;
$$;

create or replace function public.search_admin_content_safety_rules()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
  perform public.admin_require_capability('content.items.read');
  return jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',r.id,'code',r.code,'label',r.label,'category',r.category,
      'detector_type',r.detector_type,'pattern',r.pattern,'severity',r.severity,
      'scopes',r.scopes,'locale',r.locale,'policy_source',r.policy_source,
      'policy_reference',r.policy_reference,'policy_version',r.policy_version,
      'rationale',r.rationale,'approval_state',r.approval_state,'enabled',r.enabled,
      'version',r.version,'created_at',r.created_at,'updated_at',r.updated_at,
      'approved_at',r.approved_at,'retired_at',r.retired_at,
      'definition_fingerprint',private.content_safety_rule_definition_fingerprint(
        r.id,r.version,r.detector_type,r.pattern,r.scopes,r.locale
      ),
      'rescan',jsonb_build_object(
        'state',r.rescan_state,'rule_version',r.rescan_rule_version,
        'cursor_target_type',r.rescan_cursor_target_type,'cursor_target_id',r.rescan_cursor_target_id,
        'eligible_count',r.rescan_eligible_count,'queued_count',r.rescan_queued_count,
        'started_at',r.rescan_started_at,'completed_at',r.rescan_completed_at
      ),
      'approved_by',case when r.approved_by is null then null else jsonb_build_object(
        'id',r.approved_by,'username',ap.username,'display_name',ap.display_name,'avatar_url',ap.avatar_url
      ) end
    ) order by case r.approval_state when 'draft' then 1 when 'approved' then 2 else 3 end,
      r.enabled desc,r.updated_at desc,r.code) from private.content_safety_rules r
      left join public.user_profiles ap on ap.id=r.approved_by),'[]'::jsonb),
    'stats',jsonb_build_object(
      'total',(select count(*) from private.content_safety_rules),
      'draft',(select count(*) from private.content_safety_rules where approval_state='draft'),
      'approved',(select count(*) from private.content_safety_rules where approval_state='approved'),
      'enabled',(select count(*) from private.content_safety_rules where approval_state='approved' and enabled),
      'retired',(select count(*) from private.content_safety_rules where approval_state='retired')
    )
  );
end;
$$;

create or replace function public.admin_update_content_safety_rule(
  p_rule_id uuid,p_label text,p_category text,p_severity text,p_scopes text[],
  p_policy_source text,p_policy_reference text,p_policy_version text,p_rationale text,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_actor uuid;v_scope text;v_fingerprint text;v_existing private.admin_action_audit;
  v_rule private.content_safety_rules;v_scopes text[];
begin
  v_actor:=public.admin_require_capability('content.items.moderate');
  v_scope:='v1|human|'||v_actor::text||'|content.items.moderate|content_safety.rule.update';
  v_scopes:=array(select distinct btrim(value) from unnest(coalesce(p_scopes,'{}'::text[])) value order by 1);
  v_fingerprint:=private.content_safety_sha256(jsonb_build_object(
    'rule_id',p_rule_id,'label',p_label,'category',p_category,'severity',p_severity,'scopes',v_scopes,
    'policy_source',p_policy_source,'policy_reference',p_policy_reference,'policy_version',p_policy_version,
    'rationale',p_rationale
  )::text);
  select * into v_existing from private.admin_action_audit
    where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then raise exception using errcode='23505',message='admin_idempotency_conflict';end if;
    return v_existing.metadata||jsonb_build_object('idempotent',true);
  end if;
  select * into v_rule from private.content_safety_rules where id=p_rule_id for update;
  if not found then raise exception using errcode='P0002',message='content_safety_rule_not_found';end if;
  if v_rule.approval_state='retired' then raise exception using errcode='55000',message='content_safety_rule_retired';end if;
  if p_label is null or p_category not in('violence','threat','harassment','hate','sexual','self_harm','drugs','weapons','fraud','spam','child_safety','other')
     or p_severity not in('low','medium','high','critical') or cardinality(v_scopes)=0
     or p_policy_source not in('community_guidelines','terms','owner_manual') or p_policy_reference is null
     or (p_policy_source='owner_manual' and nullif(btrim(coalesce(p_rationale,'')),'') is null) then
    raise exception using errcode='22023',message='invalid_content_safety_rule_governance';
  end if;
  update private.content_safety_rules set
    label=btrim(p_label),category=p_category,severity=p_severity,scopes=v_scopes,
    policy_source=p_policy_source,policy_reference=btrim(p_policy_reference),
    policy_version=nullif(btrim(coalesce(p_policy_version,'')),''),rationale=nullif(btrim(coalesce(p_rationale,'')),''),
    approval_state='draft',enabled=false,approved_by=null,approved_at=null,retired_at=null,
    version=version+1,updated_by=v_actor,
    rescan_state=case when rescan_state in('pending','running') then 'cancelled' else rescan_state end,
    rescan_completed_at=case when rescan_state in('pending','running') then clock_timestamp() else rescan_completed_at end
  where id=p_rule_id returning * into v_rule;
  insert into private.admin_action_audit(
    actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,target_id,target_ref,
    outcome,reason,financial_effect,contains_pii,idempotency_scope,idempotency_key,request_fingerprint,metadata
  ) values(
    v_actor,'human_admin',private.admin_active_role_codes(v_actor),'content.items.moderate','content_safety',
    'content_safety.rule.update','content_safety_rule',v_rule.id,v_rule.code,'succeeded',v_rule.rationale,
    false,false,v_scope,p_idempotency_key,v_fingerprint,jsonb_build_object(
      'rule_id',v_rule.id,'code',v_rule.code,'version',v_rule.version,'approval_state','draft','enabled',false
    )
  );
  return jsonb_build_object('rule_id',v_rule.id,'code',v_rule.code,'version',v_rule.version,
    'approval_state',v_rule.approval_state,'enabled',v_rule.enabled,'idempotent',false);
end;
$$;

drop function public.admin_approve_content_safety_rule(uuid,uuid);
create function public.admin_approve_content_safety_rule(
  p_rule_id uuid,p_definition_fingerprint text,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_actor uuid;v_scope text;v_fingerprint text;v_existing private.admin_action_audit;
  v_rule private.content_safety_rules;
begin
  v_actor:=public.admin_require_capability('content.items.moderate');
  v_scope:='v1|human|'||v_actor::text||'|content.items.moderate|content_safety.rule.approve';
  v_fingerprint:=private.content_safety_sha256(jsonb_build_object(
    'rule_id',p_rule_id,'definition_fingerprint',p_definition_fingerprint
  )::text);
  select * into v_existing from private.admin_action_audit where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then raise exception using errcode='23505',message='admin_idempotency_conflict';end if;
    return v_existing.metadata||jsonb_build_object('idempotent',true);
  end if;
  select * into v_rule from private.content_safety_rules where id=p_rule_id for update;
  if not found then raise exception using errcode='P0002',message='content_safety_rule_not_found';end if;
  if v_rule.approval_state<>'draft' then raise exception using errcode='55000',message='content_safety_rule_not_draft';end if;
  perform private.require_content_safety_rule_preview(v_actor,v_rule,p_definition_fingerprint);
  update private.content_safety_rules set approval_state='approved',approved_by=v_actor,
    approved_at=clock_timestamp(),version=version+1,updated_by=v_actor
  where id=p_rule_id returning * into v_rule;
  insert into private.admin_action_audit(
    actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,target_id,target_ref,
    outcome,reason,financial_effect,contains_pii,idempotency_scope,idempotency_key,request_fingerprint,metadata
  ) values(
    v_actor,'human_admin',private.admin_active_role_codes(v_actor),'content.items.moderate','content_safety',
    'content_safety.rule.approve','content_safety_rule',v_rule.id,v_rule.code,'succeeded',v_rule.rationale,
    false,false,v_scope,p_idempotency_key,v_fingerprint,jsonb_build_object(
      'rule_id',v_rule.id,'code',v_rule.code,'version',v_rule.version,'approval_state','approved','enabled',false,
      'definition_fingerprint',p_definition_fingerprint
    )
  );
  return jsonb_build_object('rule_id',v_rule.id,'code',v_rule.code,'version',v_rule.version,
    'approval_state',v_rule.approval_state,'enabled',v_rule.enabled,'idempotent',false);
end;
$$;

drop function public.admin_set_content_safety_rule_enabled(uuid,boolean,uuid);
create function public.admin_set_content_safety_rule_enabled(
  p_rule_id uuid,p_enabled boolean,p_definition_fingerprint text,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_actor uuid;v_scope text;v_fingerprint text;v_existing private.admin_action_audit;
  v_rule private.content_safety_rules;v_rescan jsonb:=null;v_action text;
begin
  v_actor:=public.admin_require_capability('content.items.moderate');
  v_action:=case when coalesce(p_enabled,false) then 'enable' else 'disable' end;
  v_scope:='v1|human|'||v_actor::text||'|content.items.moderate|content_safety.rule.'||v_action;
  v_fingerprint:=private.content_safety_sha256(jsonb_build_object(
    'rule_id',p_rule_id,'enabled',coalesce(p_enabled,false),
    'definition_fingerprint',case when coalesce(p_enabled,false) then p_definition_fingerprint else null end
  )::text);
  select * into v_existing from private.admin_action_audit where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then raise exception using errcode='23505',message='admin_idempotency_conflict';end if;
    return v_existing.metadata||jsonb_build_object('idempotent',true);
  end if;
  select * into v_rule from private.content_safety_rules where id=p_rule_id for update;
  if not found then raise exception using errcode='P0002',message='content_safety_rule_not_found';end if;
  if v_rule.approval_state<>'approved' then raise exception using errcode='55000',message='content_safety_rule_not_approved';end if;
  if v_rule.enabled=coalesce(p_enabled,false) then raise exception using errcode='55000',message='content_safety_rule_state_unchanged';end if;
  if coalesce(p_enabled,false) then
    perform private.require_content_safety_rule_preview(v_actor,v_rule,p_definition_fingerprint);
  end if;
  update private.content_safety_rules set
    enabled=coalesce(p_enabled,false),version=version+1,updated_by=v_actor,
    rescan_state=case
      when coalesce(p_enabled,false) then 'idle'
      when rescan_state in('pending','running') then 'cancelled'
      else rescan_state end,
    rescan_completed_at=case
      when not coalesce(p_enabled,false) and rescan_state in('pending','running') then clock_timestamp()
      else rescan_completed_at end
  where id=p_rule_id returning * into v_rule;
  if v_rule.enabled then
    v_rescan:=private.initialize_content_safety_rule_rescan(v_rule.id,v_rule.version,500);
  end if;
  insert into private.admin_action_audit(
    actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,target_id,target_ref,
    outcome,reason,financial_effect,contains_pii,idempotency_scope,idempotency_key,request_fingerprint,metadata
  ) values(
    v_actor,'human_admin',private.admin_active_role_codes(v_actor),'content.items.moderate','content_safety',
    'content_safety.rule.'||v_action,'content_safety_rule',v_rule.id,v_rule.code,'succeeded',null,
    false,false,v_scope,p_idempotency_key,v_fingerprint,jsonb_build_object(
      'rule_id',v_rule.id,'code',v_rule.code,'version',v_rule.version,'approval_state',v_rule.approval_state,
      'enabled',v_rule.enabled,'definition_fingerprint',p_definition_fingerprint,'rescan',v_rescan
    )
  );
  return jsonb_build_object('rule_id',v_rule.id,'code',v_rule.code,'version',v_rule.version,
    'approval_state',v_rule.approval_state,'enabled',v_rule.enabled,'rescan',v_rescan,'idempotent',false);
end;
$$;

create or replace function public.admin_retire_content_safety_rule(p_rule_id uuid,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_actor uuid;v_scope text;v_fingerprint text;v_existing private.admin_action_audit;
  v_rule private.content_safety_rules;
begin
  v_actor:=public.admin_require_capability('content.items.moderate');
  v_scope:='v1|human|'||v_actor::text||'|content.items.moderate|content_safety.rule.retire';
  v_fingerprint:=private.content_safety_sha256(jsonb_build_object('rule_id',p_rule_id)::text);
  select * into v_existing from private.admin_action_audit where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then raise exception using errcode='23505',message='admin_idempotency_conflict';end if;
    return v_existing.metadata||jsonb_build_object('idempotent',true);
  end if;
  select * into v_rule from private.content_safety_rules where id=p_rule_id for update;
  if not found then raise exception using errcode='P0002',message='content_safety_rule_not_found';end if;
  if v_rule.approval_state='retired' then raise exception using errcode='55000',message='content_safety_rule_already_retired';end if;
  update private.content_safety_rules set approval_state='retired',enabled=false,retired_at=clock_timestamp(),
    version=version+1,updated_by=v_actor,
    rescan_state=case when rescan_state in('pending','running') then 'cancelled' else rescan_state end,
    rescan_completed_at=case when rescan_state in('pending','running') then clock_timestamp() else rescan_completed_at end
  where id=p_rule_id returning * into v_rule;
  insert into private.admin_action_audit(
    actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,target_id,target_ref,
    outcome,reason,financial_effect,contains_pii,idempotency_scope,idempotency_key,request_fingerprint,metadata
  ) values(
    v_actor,'human_admin',private.admin_active_role_codes(v_actor),'content.items.moderate','content_safety',
    'content_safety.rule.retire','content_safety_rule',v_rule.id,v_rule.code,'succeeded',null,
    false,false,v_scope,p_idempotency_key,v_fingerprint,jsonb_build_object(
      'rule_id',v_rule.id,'code',v_rule.code,'version',v_rule.version,'approval_state','retired','enabled',false
    )
  );
  return jsonb_build_object('rule_id',v_rule.id,'code',v_rule.code,'version',v_rule.version,
    'approval_state',v_rule.approval_state,'enabled',v_rule.enabled,'idempotent',false);
end;
$$;

create or replace function public.wake_content_safety_scanner()
returns bigint language plpgsql security definer set search_path=''
as $$
declare v_url text;v_key text;v_secret text;v_request_id bigint;
begin
  begin
    perform private.continue_content_safety_rule_rescans(1,500);
  exception when others then
    raise warning 'content_safety_rescan_continuation_failed: %',sqlstate;
  end;
  select decrypted_secret into v_url from vault.decrypted_secrets where name='call_dispatch_project_url' limit 1;
  select decrypted_secret into v_key from vault.decrypted_secrets where name='call_dispatch_publishable_key' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='call_dispatch_secret' limit 1;
  if nullif(btrim(v_url),'') is null or nullif(btrim(v_key),'') is null or nullif(v_secret,'') is null then return null;end if;
  select net.http_post(
    url:=rtrim(v_url,'/')||'/functions/v1/content-safety-scan',
    headers:=jsonb_build_object('Content-Type','application/json','apikey',v_key,'Authorization','Bearer '||v_key,'x-content-safety-secret',v_secret),
    body:=jsonb_build_object('source','cron','requested_at',clock_timestamp()),timeout_milliseconds:=10000
  ) into v_request_id;
  return v_request_id;
end;
$$;

revoke all on function private.content_safety_rule_definition_fingerprint(uuid,bigint,text,text,text[],text) from public,anon,authenticated,service_role;
revoke all on function private.preview_content_safety_rule_definition(uuid,bigint,text,text,text[],text,integer) from public,anon,authenticated,service_role;
revoke all on function private.require_content_safety_rule_preview(uuid,private.content_safety_rules,text) from public,anon,authenticated,service_role;
revoke all on function private.content_safety_rule_targets(text[]) from public,anon,authenticated,service_role;
revoke all on function private.process_content_safety_rule_rescan_batch(uuid,bigint,integer) from public,anon,authenticated,service_role;
revoke all on function private.initialize_content_safety_rule_rescan(uuid,bigint,integer) from public,anon,authenticated,service_role;
revoke all on function private.continue_content_safety_rule_rescans(integer,integer) from public,anon,authenticated,service_role;

revoke all on function public.preview_admin_content_safety_rule_draft(text,text,text[],text,integer) from public,anon,authenticated,service_role;
revoke all on function public.preview_admin_content_safety_rule(uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.admin_approve_content_safety_rule(uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_set_content_safety_rule_enabled(uuid,boolean,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.preview_admin_content_safety_rule_draft(text,text,text[],text,integer) to authenticated;
grant execute on function public.preview_admin_content_safety_rule(uuid,integer) to authenticated;
grant execute on function public.admin_approve_content_safety_rule(uuid,text,uuid) to authenticated;
grant execute on function public.admin_set_content_safety_rule_enabled(uuid,boolean,text,uuid) to authenticated;

comment on function public.preview_admin_content_safety_rule(uuid,integer) is 'Canonical rule preview bound to id, version and a server definition fingerprint; records only a human preview audit receipt.';
comment on function private.continue_content_safety_rule_rescans(integer,integer) is 'Cursor-driven bounded continuation over the existing F4 scan queue. Never scans ordinary private messages or enforces content/accounts.';
comment on function public.wake_content_safety_scanner() is 'Continues one bounded governed-rule rescan batch, then wakes the existing authenticated Content Safety worker.';

commit;
