begin;

-- F5 governs the existing F4 textual detector authority. It deliberately does
-- not seed policy terms, create another scanner, or grant enforcement powers.
do $$
begin
  if to_regclass('private.content_safety_rules') is null
     or to_regclass('private.content_safety_scans') is null
     or to_regclass('private.content_safety_alerts') is null then
    raise exception 'content_safety_f4_authority_required';
  end if;
  if exists(select 1 from private.content_safety_rules) then
    raise exception 'content_safety_existing_rules_require_provenance_review';
  end if;
end;
$$;

alter table private.content_safety_rules
  add column policy_source text,
  add column policy_reference text,
  add column policy_version text null,
  add column locale text,
  add column rationale text null,
  add column approval_state text,
  add column approved_by uuid null references auth.users(id) on update restrict on delete restrict,
  add column approved_at timestamptz null,
  add column retired_at timestamptz null;

alter table private.content_safety_rules
  alter column policy_source set not null,
  alter column policy_reference set not null,
  alter column locale set not null,
  alter column approval_state set not null,
  add constraint content_safety_rules_policy_source_check
    check(policy_source in('community_guidelines','terms','owner_manual')),
  add constraint content_safety_rules_policy_reference_check
    check(
      policy_reference=btrim(policy_reference)
      and char_length(policy_reference) between 3 and 160
      and policy_reference!~'[[:cntrl:]]'
      and (
        (policy_source='community_guidelines' and policy_reference~'^community-guidelines#[a-z0-9][a-z0-9-]{1,127}$')
        or (policy_source='terms' and policy_reference~'^terms#[a-z0-9][a-z0-9-]{1,127}$')
        or (policy_source='owner_manual' and policy_reference~'^owner-policy-[0-9]{4}-[0-9]{2}(-[a-z0-9][a-z0-9-]{0,63})?$')
      )
    ),
  add constraint content_safety_rules_policy_version_check
    check(policy_version is null or (policy_version=btrim(policy_version) and char_length(policy_version) between 1 and 80)),
  add constraint content_safety_rules_locale_check check(locale in('und','en','es')),
  add constraint content_safety_rules_rationale_check
    check(
      (rationale is null or (rationale=btrim(rationale) and char_length(rationale) between 2 and 1000))
      and (policy_source<>'owner_manual' or rationale is not null)
    ),
  add constraint content_safety_rules_approval_state_check check(approval_state in('draft','approved','retired')),
  add constraint content_safety_rules_governance_state_check check(
    (approval_state='draft' and not enabled and approved_by is null and approved_at is null and retired_at is null)
    or (approval_state='approved' and approved_by is not null and approved_at is not null and retired_at is null)
    or (approval_state='retired' and not enabled and retired_at is not null)
  );

drop index if exists private.content_safety_rules_enabled_scopes_idx;
create index content_safety_rules_enabled_scopes_idx
  on private.content_safety_rules using gin(scopes)
  where enabled and approval_state='approved';

create function private.guard_content_safety_rule_governance()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  new.code:=lower(btrim(new.code));
  new.label:=btrim(new.label);
  new.pattern:=btrim(new.pattern);
  new.policy_reference:=btrim(new.policy_reference);
  new.policy_version:=nullif(btrim(coalesce(new.policy_version,'')),'');
  new.rationale:=nullif(btrim(coalesce(new.rationale,'')),'');
  new.scopes:=array(select distinct btrim(value) from unnest(new.scopes) value order by 1);
  if tg_op='UPDATE' then
    if old.code<>new.code then raise exception using errcode='55000',message='content_safety_rule_code_immutable';end if;
    if old.approval_state='retired' and new is distinct from old then
      raise exception using errcode='55000',message='content_safety_rule_retired_immutable';
    end if;
    if exists(select 1 from private.content_safety_alerts a where a.rule_id=old.id)
       and (old.pattern<>new.pattern or old.detector_type<>new.detector_type or old.locale<>new.locale) then
      raise exception using errcode='55000',message='content_safety_rule_pattern_requires_new_rule';
    end if;
    new.updated_at:=clock_timestamp();
  end if;
  return new;
end;
$$;

create trigger content_safety_rules_governance_guard
before insert or update on private.content_safety_rules
for each row execute function private.guard_content_safety_rule_governance();

create function private.normalize_content_safety_text(p_value text)
returns text language sql immutable set search_path=''
as $$
  select btrim(lower(regexp_replace(normalize(coalesce(p_value,''),NFKC),'[[:space:]]+',' ','g')))
$$;

create function private.content_safety_text_matches(p_text text,p_pattern text,p_detector_type text)
returns boolean language plpgsql immutable set search_path=''
as $$
declare
  v_text text:=private.normalize_content_safety_text(p_text);
  v_pattern text:=private.normalize_content_safety_text(p_pattern);
  v_offset integer:=1;
  v_relative integer;
  v_start integer;
  v_before text;
  v_after text;
begin
  if v_text='' or v_pattern='' or p_detector_type not in('keyword','phrase') then return false;end if;
  if p_detector_type='keyword' and v_pattern~'[[:space:]]' then return false;end if;
  loop
    v_relative:=strpos(substr(v_text,v_offset),v_pattern);
    if v_relative=0 then return false;end if;
    v_start:=v_offset+v_relative-1;
    v_before:=case when v_start=1 then '' else substr(v_text,v_start-1,1) end;
    v_after:=substr(v_text,v_start+char_length(v_pattern),1);
    if (v_before='' or v_before!~'^[[:alnum:]_]$')
       and (v_after='' or v_after!~'^[[:alnum:]_]$') then return true;end if;
    v_offset:=v_start+1;
    if v_offset>char_length(v_text) then return false;end if;
  end loop;
end;
$$;

create function private.content_safety_rule_rescan(
  p_rule_id uuid,p_limit integer default 500
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_rule private.content_safety_rules;
  v_target record;
  v_queued integer:=0;
  v_total integer:=0;
begin
  if p_limit<1 or p_limit>500 then raise exception using errcode='22023',message='invalid_content_safety_rescan_limit';end if;
  select * into v_rule from private.content_safety_rules where id=p_rule_id;
  if not found or v_rule.approval_state<>'approved' or not v_rule.enabled then
    raise exception using errcode='55000',message='content_safety_rule_not_active';
  end if;

  select count(*)::integer into v_total from (
    select 'video' target_type,v.id target_id from public.videos v where 'video_caption'=any(v_rule.scopes)
    union all select 'comment',c.id from public.comments c where 'comment'=any(v_rule.scopes)
    union all select 'story',s.id from public.stories s where 'story_text'=any(v_rule.scopes)
    union all select 'live_message',m.id from public.live_messages m where 'live_chat'=any(v_rule.scopes)
    union all select 'message',m.id from public.messages m
      where 'reported_message'=any(v_rule.scopes) and exists(
        select 1 from public.reports r where r.reported_content_type='message' and r.reported_content_id=m.id
      )
  ) eligible;

  for v_target in
    select target_type,target_id from (
      select 'video' target_type,v.id target_id from public.videos v where 'video_caption'=any(v_rule.scopes)
      union all select 'comment',c.id from public.comments c where 'comment'=any(v_rule.scopes)
      union all select 'story',s.id from public.stories s where 'story_text'=any(v_rule.scopes)
      union all select 'live_message',m.id from public.live_messages m where 'live_chat'=any(v_rule.scopes)
      union all select 'message',m.id from public.messages m
        where 'reported_message'=any(v_rule.scopes) and exists(
          select 1 from public.reports r where r.reported_content_type='message' and r.reported_content_id=m.id
        )
    ) eligible order by target_type,target_id limit p_limit
  loop
    perform private.enqueue_content_safety_scan(v_target.target_type,v_target.target_id,'backfill');
    v_queued:=v_queued+1;
  end loop;
  return jsonb_build_object(
    'rule_id',v_rule.id,'affected_scopes',v_rule.scopes,'eligible_count',v_total,
    'queued_count',v_queued,'batch_limit',p_limit,'has_more',v_total>v_queued,
    'private_dm_bulk_queued',0,'reported_messages_only','reported_message'=any(v_rule.scopes)
  );
end;
$$;

create function private.guard_content_safety_alert_rule_provenance()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_rule private.content_safety_rules;
begin
  if new.source_type='text_rule' then
    select * into strict v_rule from private.content_safety_rules where id=new.rule_id;
    if not v_rule.enabled or v_rule.approval_state<>'approved' then
      raise exception using errcode='55000',message='content_safety_rule_not_active';
    end if;
    new.alert_fingerprint:=private.content_safety_sha256(
      new.scan_id::text||'|text_rule|'||v_rule.id::text||'|v'||v_rule.version::text
    );
    new.evidence:=coalesce(new.evidence,'{}'::jsonb)||jsonb_build_object(
      'rule_code',v_rule.code,'rule_version',v_rule.version,'policy_source',v_rule.policy_source,
      'policy_reference',v_rule.policy_reference,'policy_version',v_rule.policy_version,'locale',v_rule.locale
    );
  end if;
  return new;
end;
$$;

create trigger content_safety_alert_rule_provenance_guard
before insert or update of rule_id,evidence on private.content_safety_alerts
for each row execute function private.guard_content_safety_alert_rule_provenance();

create or replace function public.get_content_safety_worker_rules()
returns jsonb language sql stable security definer set search_path=''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'code',r.code,'category',r.category,'detector_type',r.detector_type,
    'pattern',r.pattern,'severity',r.severity,'scopes',r.scopes,'version',r.version,
    'locale',r.locale,'policy_source',r.policy_source,'policy_reference',r.policy_reference,
    'policy_version',r.policy_version
  ) order by r.code),'[]'::jsonb)
  from private.content_safety_rules r
  where r.enabled and r.approval_state='approved'
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

drop function public.admin_create_content_safety_rule(text,text,text,text,text,text[],boolean,uuid);
drop function public.admin_update_content_safety_rule(uuid,text,text[],boolean,uuid);

create function public.admin_create_content_safety_rule(
  p_code text,p_label text,p_category text,p_detector_type text,p_pattern text,p_severity text,
  p_scopes text[],p_locale text,p_policy_source text,p_policy_reference text,
  p_policy_version text,p_rationale text,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_actor uuid;v_scope text;v_fingerprint text;v_existing private.admin_action_audit;
  v_rule private.content_safety_rules;v_scopes text[];
begin
  v_actor:=public.admin_require_capability('content.items.moderate');
  v_scope:='v1|human|'||v_actor::text||'|content.items.moderate|content_safety.rule.create';
  v_scopes:=array(select distinct btrim(value) from unnest(coalesce(p_scopes,'{}'::text[])) value order by 1);
  v_fingerprint:=private.content_safety_sha256(jsonb_build_object(
    'code',p_code,'label',p_label,'category',p_category,'detector_type',p_detector_type,
    'pattern',p_pattern,'severity',p_severity,'scopes',v_scopes,'locale',p_locale,
    'policy_source',p_policy_source,'policy_reference',p_policy_reference,
    'policy_version',p_policy_version,'rationale',p_rationale
  )::text);
  select * into v_existing from private.admin_action_audit
    where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then raise exception using errcode='23505',message='admin_idempotency_conflict';end if;
    return v_existing.metadata||jsonb_build_object('idempotent',true);
  end if;
  if p_code is null or p_label is null or p_category not in('violence','threat','harassment','hate','sexual','self_harm','drugs','weapons','fraud','spam','child_safety','other')
     or p_detector_type not in('keyword','phrase') or p_pattern is null
     or p_severity not in('low','medium','high','critical') or cardinality(v_scopes)=0
     or p_locale not in('und','en','es') or p_policy_source not in('community_guidelines','terms','owner_manual')
     or p_policy_reference is null or (p_policy_source='owner_manual' and nullif(btrim(coalesce(p_rationale,'')),'') is null) then
    raise exception using errcode='22023',message='invalid_content_safety_rule_governance';
  end if;
  insert into private.content_safety_rules(
    code,label,category,detector_type,pattern,severity,scopes,enabled,version,
    policy_source,policy_reference,policy_version,locale,rationale,approval_state,
    created_by,updated_by
  ) values(
    lower(btrim(p_code)),btrim(p_label),p_category,p_detector_type,btrim(p_pattern),p_severity,v_scopes,false,1,
    p_policy_source,btrim(p_policy_reference),nullif(btrim(coalesce(p_policy_version,'')),''),p_locale,
    nullif(btrim(coalesce(p_rationale,'')),''),'draft',v_actor,v_actor
  ) returning * into v_rule;
  insert into private.admin_action_audit(
    actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,target_id,target_ref,
    outcome,reason,financial_effect,contains_pii,idempotency_scope,idempotency_key,request_fingerprint,metadata
  ) values(
    v_actor,'human_admin',private.admin_active_role_codes(v_actor),'content.items.moderate','content_safety',
    'content_safety.rule.create','content_safety_rule',v_rule.id,v_rule.code,'succeeded',v_rule.rationale,
    false,false,v_scope,p_idempotency_key,v_fingerprint,jsonb_build_object(
      'rule_id',v_rule.id,'code',v_rule.code,'version',v_rule.version,'approval_state','draft','enabled',false,
      'policy_source',v_rule.policy_source,'policy_reference',v_rule.policy_reference,'locale',v_rule.locale
    )
  );
  return jsonb_build_object('rule_id',v_rule.id,'code',v_rule.code,'version',v_rule.version,
    'approval_state',v_rule.approval_state,'enabled',v_rule.enabled,'idempotent',false);
end;
$$;

create function public.admin_update_content_safety_rule(
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
    version=version+1,updated_by=v_actor
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

create function public.admin_approve_content_safety_rule(p_rule_id uuid,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_actor uuid;v_scope text;v_fingerprint text;v_existing private.admin_action_audit;
  v_rule private.content_safety_rules;
begin
  v_actor:=public.admin_require_capability('content.items.moderate');
  v_scope:='v1|human|'||v_actor::text||'|content.items.moderate|content_safety.rule.approve';
  v_fingerprint:=private.content_safety_sha256(jsonb_build_object('rule_id',p_rule_id)::text);
  select * into v_existing from private.admin_action_audit where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then raise exception using errcode='23505',message='admin_idempotency_conflict';end if;
    return v_existing.metadata||jsonb_build_object('idempotent',true);
  end if;
  select * into v_rule from private.content_safety_rules where id=p_rule_id for update;
  if not found then raise exception using errcode='P0002',message='content_safety_rule_not_found';end if;
  if v_rule.approval_state<>'draft' then raise exception using errcode='55000',message='content_safety_rule_not_draft';end if;
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
      'rule_id',v_rule.id,'code',v_rule.code,'version',v_rule.version,'approval_state','approved','enabled',false
    )
  );
  return jsonb_build_object('rule_id',v_rule.id,'code',v_rule.code,'version',v_rule.version,
    'approval_state',v_rule.approval_state,'enabled',v_rule.enabled,'idempotent',false);
end;
$$;

create function public.admin_set_content_safety_rule_enabled(
  p_rule_id uuid,p_enabled boolean,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_actor uuid;v_scope text;v_fingerprint text;v_existing private.admin_action_audit;
  v_rule private.content_safety_rules;v_rescan jsonb:=null;v_action text;
begin
  v_actor:=public.admin_require_capability('content.items.moderate');
  v_action:=case when coalesce(p_enabled,false) then 'enable' else 'disable' end;
  v_scope:='v1|human|'||v_actor::text||'|content.items.moderate|content_safety.rule.'||v_action;
  v_fingerprint:=private.content_safety_sha256(jsonb_build_object('rule_id',p_rule_id,'enabled',coalesce(p_enabled,false))::text);
  select * into v_existing from private.admin_action_audit where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then raise exception using errcode='23505',message='admin_idempotency_conflict';end if;
    return v_existing.metadata||jsonb_build_object('idempotent',true);
  end if;
  select * into v_rule from private.content_safety_rules where id=p_rule_id for update;
  if not found then raise exception using errcode='P0002',message='content_safety_rule_not_found';end if;
  if v_rule.approval_state<>'approved' then raise exception using errcode='55000',message='content_safety_rule_not_approved';end if;
  if v_rule.enabled=coalesce(p_enabled,false) then raise exception using errcode='55000',message='content_safety_rule_state_unchanged';end if;
  update private.content_safety_rules set enabled=coalesce(p_enabled,false),version=version+1,updated_by=v_actor
    where id=p_rule_id returning * into v_rule;
  if v_rule.enabled then v_rescan:=private.content_safety_rule_rescan(v_rule.id,500);end if;
  insert into private.admin_action_audit(
    actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,target_id,target_ref,
    outcome,reason,financial_effect,contains_pii,idempotency_scope,idempotency_key,request_fingerprint,metadata
  ) values(
    v_actor,'human_admin',private.admin_active_role_codes(v_actor),'content.items.moderate','content_safety',
    'content_safety.rule.'||v_action,'content_safety_rule',v_rule.id,v_rule.code,'succeeded',null,
    false,false,v_scope,p_idempotency_key,v_fingerprint,jsonb_build_object(
      'rule_id',v_rule.id,'code',v_rule.code,'version',v_rule.version,'approval_state',v_rule.approval_state,
      'enabled',v_rule.enabled,'rescan',v_rescan
    )
  );
  return jsonb_build_object('rule_id',v_rule.id,'code',v_rule.code,'version',v_rule.version,
    'approval_state',v_rule.approval_state,'enabled',v_rule.enabled,'rescan',v_rescan,'idempotent',false);
end;
$$;

create function public.admin_retire_content_safety_rule(p_rule_id uuid,p_idempotency_key uuid)
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
    version=version+1,updated_by=v_actor where id=p_rule_id returning * into v_rule;
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

create function public.preview_admin_content_safety_rule(
  p_detector_type text,p_pattern text,p_scopes text[],p_locale text default 'und',p_limit integer default 20
) returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_scopes text[];v_result jsonb;
begin
  perform public.admin_require_capability('content.items.moderate');
  v_scopes:=array(select distinct btrim(value) from unnest(coalesce(p_scopes,'{}'::text[])) value order by 1);
  if p_detector_type not in('keyword','phrase') or nullif(btrim(coalesce(p_pattern,'')),'') is null
     or char_length(btrim(p_pattern))>200 or cardinality(v_scopes)=0
     or not(v_scopes<@array['video_caption','comment','story_text','live_chat','reported_message','transcript']::text[])
     or p_locale not in('und','en','es') or p_limit<1 or p_limit>20
     or (p_detector_type='keyword' and private.normalize_content_safety_text(p_pattern)~'[[:space:]]') then
    raise exception using errcode='22023',message='invalid_content_safety_rule_preview';
  end if;
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

revoke all on function private.guard_content_safety_rule_governance() from public,anon,authenticated,service_role;
revoke all on function private.normalize_content_safety_text(text) from public,anon,authenticated,service_role;
revoke all on function private.content_safety_text_matches(text,text,text) from public,anon,authenticated,service_role;
revoke all on function private.content_safety_rule_rescan(uuid,integer) from public,anon,authenticated,service_role;
revoke all on function private.guard_content_safety_alert_rule_provenance() from public,anon,authenticated,service_role;

revoke all on function public.get_content_safety_worker_rules() from public,anon,authenticated,service_role;
grant execute on function public.get_content_safety_worker_rules() to service_role;
revoke all on function public.search_admin_content_safety_rules() from public,anon,authenticated,service_role;
grant execute on function public.search_admin_content_safety_rules() to authenticated;

revoke all on function public.admin_create_content_safety_rule(text,text,text,text,text,text,text[],text,text,text,text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_update_content_safety_rule(uuid,text,text,text,text[],text,text,text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_approve_content_safety_rule(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_set_content_safety_rule_enabled(uuid,boolean,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_retire_content_safety_rule(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.preview_admin_content_safety_rule(text,text,text[],text,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_create_content_safety_rule(text,text,text,text,text,text,text[],text,text,text,text,text,uuid) to authenticated;
grant execute on function public.admin_update_content_safety_rule(uuid,text,text,text,text[],text,text,text,text,uuid) to authenticated;
grant execute on function public.admin_approve_content_safety_rule(uuid,uuid) to authenticated;
grant execute on function public.admin_set_content_safety_rule_enabled(uuid,boolean,uuid) to authenticated;
grant execute on function public.admin_retire_content_safety_rule(uuid,uuid) to authenticated;
grant execute on function public.preview_admin_content_safety_rule(text,text,text[],text,integer) to authenticated;

comment on table private.content_safety_rules is 'Canonical governed keyword/phrase detectors. Every rule has policy provenance, human approval state, locale, and immutable history.';
comment on function public.preview_admin_content_safety_rule(text,text,text[],text,integer) is 'Read-only, bounded impact preview using the F4 deterministic matching semantics. Never scans ordinary private DMs and never creates alerts or sanctions.';
comment on function public.admin_set_content_safety_rule_enabled(uuid,boolean,uuid) is 'Human-governed activation. Approved rules only; queues a bounded scope-specific rescan and never enforces content or accounts.';

commit;
