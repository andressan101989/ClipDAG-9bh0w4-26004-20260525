begin;

-- F4 is detection and triage only. These private records do not grant authority
-- to hide content, warn users, suspend accounts, delete media, or move money.
do $$
begin
  if to_regclass('private.content_safety_rules') is not null
     or to_regclass('private.content_safety_scans') is not null
     or to_regclass('private.content_safety_alerts') is not null then
    raise exception 'content_safety_authority_already_exists';
  end if;
end;
$$;

create table private.content_safety_rules (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  category text not null,
  detector_type text not null,
  pattern text not null,
  severity text not null,
  scopes text[] not null,
  enabled boolean not null default false,
  version bigint not null default 1,
  created_by uuid not null references auth.users(id) on update restrict on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references auth.users(id) on update restrict on delete restrict,
  updated_at timestamptz not null default clock_timestamp(),
  constraint content_safety_rules_code_check check(code=btrim(code) and code~'^[a-z][a-z0-9_]{2,63}$'),
  constraint content_safety_rules_label_check check(label=btrim(label) and char_length(label) between 2 and 100),
  constraint content_safety_rules_category_check check(category in('violence','threat','harassment','hate','sexual','self_harm','drugs','weapons','fraud','spam','child_safety','other')),
  constraint content_safety_rules_detector_check check(detector_type in('keyword','phrase')),
  constraint content_safety_rules_pattern_check check(pattern=btrim(pattern) and char_length(pattern) between 1 and 200 and (detector_type<>'keyword' or pattern!~'\\s')),
  constraint content_safety_rules_severity_check check(severity in('low','medium','high','critical')),
  constraint content_safety_rules_scopes_check check(cardinality(scopes)>0 and array_position(scopes,null) is null and scopes<@array['video_caption','comment','story_text','live_chat','reported_message','transcript']::text[]),
  constraint content_safety_rules_version_check check(version>0),
  constraint content_safety_rules_updated_check check(updated_at>=created_at)
);

create table private.content_safety_scans (
  id uuid primary key default gen_random_uuid(),
  target_type text not null,
  target_id uuid not null,
  owner_user_id uuid null references auth.users(id) on update restrict on delete set null,
  content_fingerprint text not null,
  media_source_scan_id uuid null references private.content_safety_scans(id) on update restrict on delete set null,
  status text not null default 'queued',
  requested_reason text not null,
  detector_version text not null default 'text-rules-v1',
  text_status text not null default 'pending',
  audio_status text not null,
  visual_status text not null,
  reports_status text not null default 'pending',
  attempt_count integer not null default 0,
  available_at timestamptz not null default clock_timestamp(),
  started_at timestamptz null,
  completed_at timestamptz null,
  last_error_code text null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint content_safety_scans_target_check check(target_type in('video','comment','story','live_message','message')),
  constraint content_safety_scans_fingerprint_check check(content_fingerprint~'^[0-9a-f]{64}$'),
  constraint content_safety_scans_status_check check(status in('queued','processing','completed','failed')),
  constraint content_safety_scans_reason_check check(requested_reason in('content_created','content_updated','report_signal','shared_source','backfill','retry')),
  constraint content_safety_scans_detector_check check(detector_version=btrim(detector_version) and char_length(detector_version) between 2 and 100),
  constraint content_safety_scans_text_coverage_check check(text_status in('pending','analyzed','not_applicable','not_configured','failed')),
  constraint content_safety_scans_audio_coverage_check check(audio_status in('pending','analyzed','not_applicable','not_configured','failed')),
  constraint content_safety_scans_visual_coverage_check check(visual_status in('pending','analyzed','not_applicable','not_configured','failed')),
  constraint content_safety_scans_reports_coverage_check check(reports_status in('pending','analyzed','not_applicable','not_configured','failed')),
  constraint content_safety_scans_attempt_check check(attempt_count between 0 and 5),
  constraint content_safety_scans_error_check check(last_error_code is null or (last_error_code=btrim(last_error_code) and char_length(last_error_code) between 2 and 100)),
  constraint content_safety_scans_timestamps_check check((started_at is null or started_at>=created_at) and (completed_at is null or completed_at>=created_at) and updated_at>=created_at),
  unique(target_type,target_id,content_fingerprint)
);

create table private.content_safety_alerts (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references private.content_safety_scans(id) on update restrict on delete restrict,
  target_type text not null,
  target_id uuid not null,
  owner_user_id uuid null references auth.users(id) on update restrict on delete set null,
  source_type text not null,
  rule_id uuid null references private.content_safety_rules(id) on update restrict on delete restrict,
  category text not null,
  severity text not null,
  confidence numeric null,
  priority_score integer not null,
  alert_fingerprint text not null unique,
  reach bigint not null default 0,
  related_report_count integer not null default 0,
  pending_report_count integer not null default 0,
  reports_last_15m integer not null default 0,
  latest_report_at timestamptz null,
  active_warning_count integer not null default 0,
  status text not null default 'open',
  evidence jsonb not null default '{}'::jsonb,
  assigned_to uuid null references auth.users(id) on update restrict on delete set null,
  reviewed_by uuid null references auth.users(id) on update restrict on delete set null,
  reviewed_at timestamptz null,
  resolution text null,
  resolution_note text null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint content_safety_alerts_target_check check(target_type in('video','comment','story','live_message','message')),
  constraint content_safety_alerts_source_check check(source_type in('text_rule','user_reports','audio_classifier','visual_classifier')),
  constraint content_safety_alerts_rule_source_check check((source_type='text_rule' and rule_id is not null) or (source_type<>'text_rule' and rule_id is null)),
  constraint content_safety_alerts_category_check check(category in('violence','threat','harassment','hate','sexual','self_harm','drugs','weapons','fraud','spam','child_safety','other')),
  constraint content_safety_alerts_severity_check check(severity in('low','medium','high','critical')),
  constraint content_safety_alerts_confidence_check check(confidence is null or confidence between 0 and 1),
  constraint content_safety_alerts_priority_check check(priority_score between 0 and 100),
  constraint content_safety_alerts_fingerprint_check check(alert_fingerprint~'^[0-9a-f]{64}$'),
  constraint content_safety_alerts_signal_counts_check check(reach>=0 and related_report_count>=0 and pending_report_count>=0 and reports_last_15m>=0 and active_warning_count between 0 and 3),
  constraint content_safety_alerts_status_check check(status in('open','in_review','dismissed','resolved')),
  constraint content_safety_alerts_resolution_check check(resolution is null or resolution in('no_violation','reviewed','content_action_taken','user_action_taken')),
  constraint content_safety_alerts_state_check check(
    (status='open' and assigned_to is null and reviewed_by is null and reviewed_at is null and resolution is null and resolution_note is null)
    or (status='in_review' and assigned_to is not null and reviewed_by is null and reviewed_at is null and resolution is null and resolution_note is null)
    or (status in('dismissed','resolved') and reviewed_by is not null and reviewed_at is not null and resolution is not null)
  ),
  constraint content_safety_alerts_evidence_check check(jsonb_typeof(evidence)='object' and pg_column_size(evidence)<=8192),
  constraint content_safety_alerts_note_check check(resolution_note is null or (resolution_note=btrim(resolution_note) and char_length(resolution_note) between 2 and 1000)),
  constraint content_safety_alerts_updated_check check(updated_at>=created_at)
);

create index content_safety_rules_enabled_scopes_idx on private.content_safety_rules using gin(scopes) where enabled;
create index content_safety_scans_queue_idx on private.content_safety_scans(status,available_at,created_at,id) where status in('queued','processing');
create index content_safety_scans_target_idx on private.content_safety_scans(target_type,target_id,created_at desc,id desc);
create index content_safety_alerts_queue_idx on private.content_safety_alerts(status,priority_score desc,created_at,id) where status in('open','in_review');
create index content_safety_alerts_target_idx on private.content_safety_alerts(target_type,target_id,created_at desc,id desc);

alter table private.content_safety_rules enable row level security;
alter table private.content_safety_scans enable row level security;
alter table private.content_safety_alerts enable row level security;
revoke all privileges on table private.content_safety_rules from public,anon,authenticated,service_role;
revoke all privileges on table private.content_safety_scans from public,anon,authenticated,service_role;
revoke all privileges on table private.content_safety_alerts from public,anon,authenticated,service_role;

create function private.content_safety_sha256(p_value text)
returns text language sql immutable set search_path=''
as $$select encode(extensions.digest(convert_to(coalesce(p_value,''),'UTF8'),'sha256'),'hex')$$;

create function private.content_safety_target_snapshot(p_target_type text,p_target_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_result jsonb;
begin
  if p_target_type='video' then
    select jsonb_build_object(
      'owner_user_id',v.user_id,'scope','video_caption','text_value',v.caption,
      'reach',greatest(v.views_count,0),'path','/content/video/'||v.id::text,
      'summary',left(nullif(btrim(v.caption),''),300),
      'content_version',jsonb_build_object('caption',v.caption,'video_url',v.video_url,'media_urls',v.media_urls,'edited_at',v.edited_at,'created_at',v.created_at)::text,
      'shared_video_id',null
    ) into v_result from public.videos v where v.id=p_target_id;
  elsif p_target_type='comment' then
    select jsonb_build_object(
      'owner_user_id',c.user_id,'scope','comment','text_value',c.text,'reach',0,
      'path','/content/comment/'||c.id::text,'summary',left(c.text,300),
      'content_version',jsonb_build_object('text',c.text,'created_at',c.created_at)::text,
      'shared_video_id',null
    ) into v_result from public.comments c where c.id=p_target_id;
  elsif p_target_type='story' then
    select jsonb_build_object(
      'owner_user_id',s.user_id,'scope','story_text',
      'text_value',coalesce((select string_agg(nullif(btrim(e->>'text'),''),' ' order by ordinality)
        from jsonb_array_elements(coalesce(s.story_composition->'elements','[]'::jsonb)) with ordinality as x(e,ordinality)
        where e->>'type'='text'),''),
      'reach',(select count(*) from public.story_views sv where sv.story_id=s.id),
      'path','/stories/'||s.id::text,
      'summary',left(coalesce((select string_agg(nullif(btrim(e->>'text'),''),' ' order by ordinality)
        from jsonb_array_elements(coalesce(s.story_composition->'elements','[]'::jsonb)) with ordinality as x(e,ordinality)
        where e->>'type'='text'),''),300),
      'content_version',jsonb_build_object('composition',s.story_composition,'media_url',s.media_url,'media_type',s.media_type,'story_kind',s.story_kind,'shared_video_id',s.shared_video_id,'created_at',s.created_at)::text,
      'shared_video_id',s.shared_video_id
    ) into v_result from public.stories s where s.id=p_target_id;
  elsif p_target_type='live_message' then
    select jsonb_build_object(
      'owner_user_id',m.user_id,'scope','live_chat','text_value',m.message,'reach',0,
      'path','/live/'||m.session_id::text,'summary',left(m.message,300),
      'content_version',jsonb_build_object('message',m.message,'created_at',m.created_at)::text,
      'shared_video_id',null
    ) into v_result from public.live_messages m where m.id=p_target_id;
  elsif p_target_type='message' then
    select jsonb_build_object(
      'owner_user_id',m.sender_id,'scope','reported_message','text_value',m.text,'reach',0,
      'path','/reports','summary',left(m.text,160),
      'content_version',jsonb_build_object('text',m.text,'message_type',m.message_type,'deleted_at',m.deleted_at,'created_at',m.created_at)::text,
      'shared_video_id',null
    ) into v_result
    from public.messages m
    where m.id=p_target_id and exists(
      select 1 from public.reports r where r.reported_content_type='message' and r.reported_content_id=m.id
    );
  end if;
  return v_result;
end;
$$;

create function private.content_safety_fingerprint(p_target_type text,p_target_id uuid)
returns text language plpgsql stable security definer set search_path=''
as $$
declare v_snapshot jsonb;
begin
  v_snapshot:=private.content_safety_target_snapshot(p_target_type,p_target_id);
  if v_snapshot is null then return null; end if;
  return private.content_safety_sha256(p_target_type||'|'||p_target_id::text||'|'||coalesce(v_snapshot->>'content_version',''));
end;
$$;

create function private.content_safety_priority(
  p_severity text,p_pending_reports integer,p_reports_last_15m integer,
  p_active_warnings integer,p_reach bigint
) returns integer language sql immutable set search_path=''
as $$
  select least(100,greatest(0,
    case p_severity when 'critical' then 90 when 'high' then 70 when 'medium' then 45 else 20 end
    +least(greatest(coalesce(p_pending_reports,0),0)*2,10)
    +case when coalesce(p_reports_last_15m,0)>=10 then 10 when coalesce(p_reports_last_15m,0)>=3 then 6 else 0 end
    +case coalesce(p_active_warnings,0) when 1 then 3 when 2 then 6 when 3 then 9 else 0 end
    +case when coalesce(p_reach,0)>=100000 then 8 when coalesce(p_reach,0)>=10000 then 5 when coalesce(p_reach,0)>=1000 then 3 else 0 end
  ))::integer
$$;

create function private.enqueue_content_safety_scan(
  p_target_type text,p_target_id uuid,p_requested_reason text
) returns uuid language plpgsql security definer set search_path=''
as $$
declare
  v_snapshot jsonb;v_fingerprint text;v_id uuid;v_source_scan uuid;
  v_audio text;v_visual text;
begin
  if p_target_type not in('video','comment','story','live_message','message')
     or p_requested_reason not in('content_created','content_updated','report_signal','shared_source','backfill','retry') then
    return null;
  end if;
  v_snapshot:=private.content_safety_target_snapshot(p_target_type,p_target_id);
  if v_snapshot is null then return null; end if;
  v_fingerprint:=private.content_safety_sha256(p_target_type||'|'||p_target_id::text||'|'||coalesce(v_snapshot->>'content_version',''));
  if p_target_type='story' and nullif(v_snapshot->>'shared_video_id','') is not null then
    v_source_scan:=private.enqueue_content_safety_scan('video',(v_snapshot->>'shared_video_id')::uuid,'shared_source');
  end if;
  v_audio:=case when p_target_type in('video','story') or (p_target_type='message' and coalesce(v_snapshot->>'scope','')='reported_message') then 'not_configured' else 'not_applicable' end;
  v_visual:=case when p_target_type in('video','story') then 'not_configured' else 'not_applicable' end;
  insert into private.content_safety_scans(
    target_type,target_id,owner_user_id,content_fingerprint,media_source_scan_id,status,
    requested_reason,text_status,audio_status,visual_status,reports_status,available_at
  ) values(
    p_target_type,p_target_id,(v_snapshot->>'owner_user_id')::uuid,v_fingerprint,v_source_scan,'queued',
    p_requested_reason,'pending',v_audio,v_visual,'pending',clock_timestamp()
  )
  on conflict(target_type,target_id,content_fingerprint) do update set
    status=case when private.content_safety_scans.status='processing' then 'processing' else 'queued' end,
    requested_reason=excluded.requested_reason,
    media_source_scan_id=coalesce(excluded.media_source_scan_id,private.content_safety_scans.media_source_scan_id),
    text_status=case when private.content_safety_scans.status='processing' then private.content_safety_scans.text_status else 'pending' end,
    reports_status=case when private.content_safety_scans.status='processing' then private.content_safety_scans.reports_status else 'pending' end,
    available_at=case when private.content_safety_scans.status='processing' then private.content_safety_scans.available_at else clock_timestamp() end,
    completed_at=case when private.content_safety_scans.status='processing' then private.content_safety_scans.completed_at else null end,
    last_error_code=case when private.content_safety_scans.status='processing' then private.content_safety_scans.last_error_code else null end,
    updated_at=clock_timestamp()
  returning id into v_id;
  return v_id;
end;
$$;

create function private.content_safety_content_trigger()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  perform private.enqueue_content_safety_scan(tg_argv[0],new.id,
    case when tg_op='INSERT' then 'content_created' else 'content_updated' end);
  return new;
end;
$$;

create function private.content_safety_report_trigger()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.reported_content_type in('video','comment','story','message') then
    perform private.enqueue_content_safety_scan(new.reported_content_type,new.reported_content_id,'report_signal');
  end if;
  return new;
end;
$$;

create trigger videos_enqueue_content_safety after insert or update of caption,video_url,media_urls,edited_at on public.videos
for each row execute function private.content_safety_content_trigger('video');
create trigger comments_enqueue_content_safety after insert or update of text on public.comments
for each row execute function private.content_safety_content_trigger('comment');
create trigger stories_enqueue_content_safety after insert or update of media_url,media_type,story_kind,shared_video_id,shared_content_type,story_composition on public.stories
for each row execute function private.content_safety_content_trigger('story');
create trigger live_messages_enqueue_content_safety after insert on public.live_messages
for each row execute function private.content_safety_content_trigger('live_message');
create trigger reports_enqueue_content_safety after insert or update of status on public.reports
for each row execute function private.content_safety_report_trigger();

create function public.get_content_safety_worker_rules()
returns jsonb language sql stable security definer set search_path=''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'code',r.code,'category',r.category,'detector_type',r.detector_type,
    'pattern',r.pattern,'severity',r.severity,'scopes',r.scopes,'version',r.version
  ) order by r.code),'[]'::jsonb)
  from private.content_safety_rules r where r.enabled
$$;

create function public.claim_content_safety_scans(p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_scan private.content_safety_scans;v_snapshot jsonb;v_payload jsonb:='[]'::jsonb;v_current_fingerprint text;
begin
  if p_limit<1 or p_limit>50 then raise exception using errcode='22023',message='invalid_content_safety_batch_limit';end if;
  for v_scan in
    select * from private.content_safety_scans s
    where s.attempt_count<5 and s.available_at<=clock_timestamp()
      and (s.status='queued' or (s.status='processing' and s.started_at<clock_timestamp()-interval '10 minutes'))
    order by s.available_at,s.created_at,s.id for update skip locked limit p_limit
  loop
    v_snapshot:=private.content_safety_target_snapshot(v_scan.target_type,v_scan.target_id);
    if v_snapshot is null then
      update private.content_safety_scans set status='failed',text_status='failed',reports_status='failed',
        last_error_code='target_not_available',completed_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=v_scan.id;
      continue;
    end if;
    v_current_fingerprint:=private.content_safety_sha256(v_scan.target_type||'|'||v_scan.target_id::text||'|'||coalesce(v_snapshot->>'content_version',''));
    if v_current_fingerprint<>v_scan.content_fingerprint then
      update private.content_safety_scans set status='failed',text_status='failed',reports_status='failed',
        last_error_code='stale_content_version',completed_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=v_scan.id;
      continue;
    end if;
    update private.content_safety_scans set status='processing',attempt_count=attempt_count+1,
      started_at=clock_timestamp(),completed_at=null,last_error_code=null,updated_at=clock_timestamp()
    where id=v_scan.id;
    v_payload:=v_payload||jsonb_build_array(jsonb_build_object(
      'id',v_scan.id,'target_type',v_scan.target_type,'target_id',v_scan.target_id,
      'content_fingerprint',v_scan.content_fingerprint,'attempt_count',v_scan.attempt_count+1,
      'scope',v_snapshot->>'scope','text',v_snapshot->>'text_value'
    ));
  end loop;
  return v_payload;
end;
$$;

create function public.complete_content_safety_scan(p_scan_id uuid,p_matches jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_scan private.content_safety_scans;v_snapshot jsonb;v_match jsonb;v_rule private.content_safety_rules;
  v_total_reports integer;v_pending_reports integer;v_reports_15m integer;v_latest_report timestamptz;
  v_warning_count integer;v_reach bigint;v_priority integer;v_created integer:=0;v_report_ids jsonb;
  v_fingerprint text;v_excerpt text;v_terms jsonb;
begin
  if jsonb_typeof(p_matches)<>'array' or jsonb_array_length(p_matches)>100 then
    raise exception using errcode='22023',message='invalid_content_safety_matches';
  end if;
  select * into v_scan from private.content_safety_scans where id=p_scan_id for update;
  if not found then raise exception using errcode='P0002',message='content_safety_scan_not_found';end if;
  if v_scan.status='completed' then
    return jsonb_build_object('scan_id',v_scan.id,'status','completed','idempotent',true);
  end if;
  if v_scan.status<>'processing' then raise exception using errcode='55000',message='content_safety_scan_not_claimed';end if;
  v_snapshot:=private.content_safety_target_snapshot(v_scan.target_type,v_scan.target_id);
  if v_snapshot is null then raise exception using errcode='P0002',message='content_safety_target_not_available';end if;
  if private.content_safety_sha256(v_scan.target_type||'|'||v_scan.target_id::text||'|'||coalesce(v_snapshot->>'content_version',''))<>v_scan.content_fingerprint then
    raise exception using errcode='55000',message='content_safety_content_version_changed';
  end if;
  select count(*)::integer,count(*) filter(where r.status='pending')::integer,
    count(*) filter(where r.status='pending' and r.created_at>=clock_timestamp()-interval '15 minutes')::integer,
    max(r.created_at)
  into v_total_reports,v_pending_reports,v_reports_15m,v_latest_report
  from public.reports r where r.reported_content_type=v_scan.target_type and r.reported_content_id=v_scan.target_id;
  select count(*)::integer into v_warning_count from private.admin_user_warnings w
  where w.target_user_id=v_scan.owner_user_id and w.status='active'
    and w.issued_at>coalesce((select max(a.completed_at) from private.admin_user_moderation_actions a
      where a.target_user_id=v_scan.owner_user_id and a.action='restore' and a.status='succeeded'),'-infinity'::timestamptz);
  v_warning_count:=least(coalesce(v_warning_count,0),3);
  v_reach:=greatest(coalesce((v_snapshot->>'reach')::bigint,0),0);

  for v_match in select value from jsonb_array_elements(p_matches)
  loop
    begin
      select * into strict v_rule from private.content_safety_rules r
      where r.id=(v_match->>'rule_id')::uuid and r.enabled and (v_snapshot->>'scope')=any(r.scopes);
    exception when others then
      raise exception using errcode='22023',message='invalid_content_safety_rule_match';
    end;
    v_excerpt:=left(coalesce(v_match->>'excerpt',''),240);
    v_terms:=coalesce(v_match->'matched_terms','[]'::jsonb);
    if jsonb_typeof(v_terms)<>'array' or pg_column_size(v_terms)>2048 then
      raise exception using errcode='22023',message='invalid_content_safety_match_evidence';
    end if;
    v_priority:=private.content_safety_priority(v_rule.severity,v_pending_reports,v_reports_15m,v_warning_count,v_reach);
    v_fingerprint:=private.content_safety_sha256(v_scan.id::text||'|text_rule|'||v_rule.id::text);
    insert into private.content_safety_alerts(
      scan_id,target_type,target_id,owner_user_id,source_type,rule_id,category,severity,confidence,
      priority_score,alert_fingerprint,reach,related_report_count,pending_report_count,reports_last_15m,
      latest_report_at,active_warning_count,evidence
    ) values(
      v_scan.id,v_scan.target_type,v_scan.target_id,v_scan.owner_user_id,'text_rule',v_rule.id,
      v_rule.category,v_rule.severity,1,v_priority,v_fingerprint,v_reach,v_total_reports,v_pending_reports,
      v_reports_15m,v_latest_report,v_warning_count,jsonb_build_object(
        'matched_rule_codes',jsonb_build_array(v_rule.code),'matched_text_excerpt',v_excerpt,
        'matched_terms',v_terms,'detector_version',v_scan.detector_version,'rule_version',v_rule.version
      )
    ) on conflict(alert_fingerprint) do update set
      priority_score=excluded.priority_score,reach=excluded.reach,related_report_count=excluded.related_report_count,
      pending_report_count=excluded.pending_report_count,reports_last_15m=excluded.reports_last_15m,
      latest_report_at=excluded.latest_report_at,active_warning_count=excluded.active_warning_count,
      evidence=excluded.evidence,updated_at=clock_timestamp();
    v_created:=v_created+1;
  end loop;

  if v_pending_reports>0 then
    select coalesce(jsonb_agg(id order by created_at desc,id desc),'[]'::jsonb) into v_report_ids
    from (select r.id,r.created_at from public.reports r where r.reported_content_type=v_scan.target_type
      and r.reported_content_id=v_scan.target_id and r.status='pending' order by r.created_at desc,r.id desc limit 20) q;
    v_priority:=private.content_safety_priority('medium',v_pending_reports,v_reports_15m,v_warning_count,v_reach);
    v_fingerprint:=private.content_safety_sha256(v_scan.id::text||'|user_reports');
    insert into private.content_safety_alerts(
      scan_id,target_type,target_id,owner_user_id,source_type,rule_id,category,severity,confidence,
      priority_score,alert_fingerprint,reach,related_report_count,pending_report_count,reports_last_15m,
      latest_report_at,active_warning_count,evidence
    ) values(
      v_scan.id,v_scan.target_type,v_scan.target_id,v_scan.owner_user_id,'user_reports',null,'other','medium',null,
      v_priority,v_fingerprint,v_reach,v_total_reports,v_pending_reports,v_reports_15m,v_latest_report,
      v_warning_count,jsonb_build_object('report_ids',v_report_ids,'report_count',v_total_reports,
        'pending_report_count',v_pending_reports,'detector_version',v_scan.detector_version)
    ) on conflict(alert_fingerprint) do update set
      priority_score=excluded.priority_score,reach=excluded.reach,related_report_count=excluded.related_report_count,
      pending_report_count=excluded.pending_report_count,reports_last_15m=excluded.reports_last_15m,
      latest_report_at=excluded.latest_report_at,active_warning_count=excluded.active_warning_count,
      evidence=excluded.evidence,updated_at=clock_timestamp();
    v_created:=v_created+1;
  end if;

  update private.content_safety_scans set status='completed',text_status='analyzed',reports_status='analyzed',
    completed_at=clock_timestamp(),last_error_code=null,updated_at=clock_timestamp() where id=v_scan.id;
  return jsonb_build_object('scan_id',v_scan.id,'status','completed','alerts_processed',v_created,
    'text_status','analyzed','audio_status',v_scan.audio_status,'visual_status',v_scan.visual_status,
    'reports_status','analyzed');
end;
$$;

create function public.fail_content_safety_scan(p_scan_id uuid,p_error_code text,p_retryable boolean default true)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_scan private.content_safety_scans;v_retry boolean;v_error text;
begin
  v_error:=left(lower(regexp_replace(coalesce(nullif(btrim(p_error_code),''),'worker_error'),'[^a-z0-9_]+','_','g')),100);
  select * into v_scan from private.content_safety_scans where id=p_scan_id for update;
  if not found then raise exception using errcode='P0002',message='content_safety_scan_not_found';end if;
  if v_scan.status='completed' then return jsonb_build_object('scan_id',v_scan.id,'status','completed','idempotent',true);end if;
  v_retry:=p_retryable and v_scan.attempt_count<5;
  update private.content_safety_scans set status=case when v_retry then 'queued' else 'failed' end,
    text_status=case when v_retry then 'pending' else 'failed' end,
    reports_status=case when v_retry then 'pending' else 'failed' end,
    available_at=case when v_retry then clock_timestamp()+least(30,power(2,greatest(v_scan.attempt_count,1)))::integer*interval '1 minute' else available_at end,
    completed_at=case when v_retry then null else clock_timestamp() end,last_error_code=v_error,updated_at=clock_timestamp()
  where id=v_scan.id;
  return jsonb_build_object('scan_id',v_scan.id,'status',case when v_retry then 'queued' else 'failed' end,'retryable',v_retry);
end;
$$;

create function public.enqueue_content_safety_backfill(p_limit integer default 500)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_row record;v_videos integer:=0;v_comments integer:=0;v_stories integer:=0;v_live integer:=0;
begin
  if p_limit<1 or p_limit>1000 then raise exception using errcode='22023',message='invalid_content_safety_backfill_limit';end if;
  for v_row in select id from public.videos order by created_at,id limit p_limit loop
    perform private.enqueue_content_safety_scan('video',v_row.id,'backfill');v_videos:=v_videos+1;
  end loop;
  for v_row in select id from public.comments order by created_at,id limit p_limit loop
    perform private.enqueue_content_safety_scan('comment',v_row.id,'backfill');v_comments:=v_comments+1;
  end loop;
  for v_row in select id from public.stories order by created_at,id limit p_limit loop
    perform private.enqueue_content_safety_scan('story',v_row.id,'backfill');v_stories:=v_stories+1;
  end loop;
  for v_row in select id from public.live_messages order by created_at,id limit p_limit loop
    perform private.enqueue_content_safety_scan('live_message',v_row.id,'backfill');v_live:=v_live+1;
  end loop;
  return jsonb_build_object('videos',v_videos,'comments',v_comments,'stories',v_stories,'live_messages',v_live,
    'private_messages',0,'private_message_policy','reported_only');
end;
$$;

create function public.search_admin_content_safety_alerts(
  p_severity text default null,p_status text default null,p_category text default null,
  p_target_type text default null,p_source_type text default null,p_coverage text default null,
  p_cursor_priority integer default null,p_cursor_created_at timestamptz default null,p_cursor_id uuid default null,
  p_limit integer default 50
) returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
  perform public.admin_require_capability('content.items.read');
  if p_limit<1 or p_limit>100 or (p_severity is not null and p_severity not in('low','medium','high','critical'))
     or (p_status is not null and p_status not in('open','in_review','dismissed','resolved'))
     or (p_target_type is not null and p_target_type not in('video','comment','story','live_message','message'))
     or (p_source_type is not null and p_source_type not in('text_rule','user_reports','audio_classifier','visual_classifier'))
     or (p_coverage is not null and p_coverage not in('complete','incomplete','failed','pending')) then
    raise exception using errcode='22023',message='invalid_content_safety_filter';
  end if;
  return (
    with filtered as (
      select a.*,s.text_status,s.audio_status,s.visual_status,s.reports_status,s.status scan_status,
        r.code rule_code,r.label rule_label,
        case when a.priority_score>=85 then 'critical' when a.priority_score>=65 then 'high'
             when a.priority_score>=40 then 'medium' else 'low' end priority_bucket
      from private.content_safety_alerts a join private.content_safety_scans s on s.id=a.scan_id
      left join private.content_safety_rules r on r.id=a.rule_id
      where (p_severity is null or a.severity=p_severity) and (p_status is null or a.status=p_status)
        and (p_category is null or a.category=p_category) and (p_target_type is null or a.target_type=p_target_type)
        and (p_source_type is null or a.source_type=p_source_type)
        and (p_coverage is null or (p_coverage='complete' and s.text_status='analyzed' and s.reports_status='analyzed' and s.audio_status in('analyzed','not_applicable') and s.visual_status in('analyzed','not_applicable'))
          or (p_coverage='incomplete' and (s.audio_status='not_configured' or s.visual_status='not_configured'))
          or (p_coverage='failed' and (s.text_status='failed' or s.audio_status='failed' or s.visual_status='failed' or s.reports_status='failed'))
          or (p_coverage='pending' and (s.text_status='pending' or s.audio_status='pending' or s.visual_status='pending' or s.reports_status='pending')))
        and (p_cursor_priority is null or a.priority_score<p_cursor_priority
          or (a.priority_score=p_cursor_priority and a.created_at>p_cursor_created_at)
          or (a.priority_score=p_cursor_priority and a.created_at=p_cursor_created_at and a.id>p_cursor_id))
      order by a.priority_score desc,a.created_at,a.id limit p_limit
    ), stats as (
      select count(*) filter(where status='open') open_count,count(*) filter(where status='in_review') in_review_count,
        count(*) filter(where status='resolved') resolved_count,count(*) filter(where status='dismissed') dismissed_count,
        count(*) filter(where priority_score>=85 and status in('open','in_review')) critical_count,
        count(*) filter(where priority_score between 65 and 84 and status in('open','in_review')) high_count,
        count(*) filter(where priority_score between 40 and 64 and status in('open','in_review')) medium_count,
        count(*) filter(where priority_score<40 and status in('open','in_review')) low_count
      from private.content_safety_alerts
    )
    select jsonb_build_object(
      'stats',(select to_jsonb(stats) from stats),
      'active_rule_count',(select count(*) from private.content_safety_rules where enabled),
      'items',coalesce((select jsonb_agg(jsonb_build_object(
        'id',f.id,'target_type',f.target_type,'target_id',f.target_id,'owner_user_id',f.owner_user_id,
        'author',jsonb_build_object('id',u.id,'username',u.username,'display_name',u.display_name,'avatar_url',u.avatar_url),
        'source_type',f.source_type,'category',f.category,'severity',f.severity,'priority_score',f.priority_score,
        'priority_bucket',f.priority_bucket,'status',f.status,'rule_code',f.rule_code,'rule_label',f.rule_label,
        'evidence_excerpt',f.evidence->>'matched_text_excerpt','reach',f.reach,
        'related_report_count',f.related_report_count,'pending_report_count',f.pending_report_count,
        'reports_last_15m',f.reports_last_15m,'active_warning_count',f.active_warning_count,
        'coverage',jsonb_build_object('text',f.text_status,'audio',f.audio_status,'visual',f.visual_status,'reports',f.reports_status),
        'scan_status',f.scan_status,'created_at',f.created_at
      ) order by f.priority_score desc,f.created_at,f.id) from filtered f left join public.user_profiles u on u.id=f.owner_user_id),'[]'::jsonb),
      'next_cursor',(select jsonb_build_object('priority_score',f.priority_score,'created_at',f.created_at,'id',f.id) from filtered f order by f.priority_score,f.created_at desc,f.id desc limit 1)
    )
  );
end;
$$;

create function public.get_admin_content_safety_alert(p_alert_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_result jsonb;
begin
  perform public.admin_require_capability('content.items.read');
  select jsonb_build_object(
    'id',a.id,'target_type',a.target_type,'target_id',a.target_id,'source_type',a.source_type,
    'category',a.category,'severity',a.severity,'confidence',a.confidence,'priority_score',a.priority_score,
    'priority_bucket',case when a.priority_score>=85 then 'critical' when a.priority_score>=65 then 'high' when a.priority_score>=40 then 'medium' else 'low' end,
    'status',a.status,'reach',a.reach,'related_report_count',a.related_report_count,
    'pending_report_count',a.pending_report_count,'reports_last_15m',a.reports_last_15m,
    'latest_report_at',a.latest_report_at,'active_warning_count',a.active_warning_count,
    'evidence',a.evidence,'assigned_to',a.assigned_to,'reviewed_by',a.reviewed_by,
    'reviewed_at',a.reviewed_at,'resolution',a.resolution,'resolution_note',a.resolution_note,
    'created_at',a.created_at,'updated_at',a.updated_at,
    'author',jsonb_build_object('id',u.id,'username',u.username,'display_name',u.display_name,'avatar_url',u.avatar_url),
    'rule',case when r.id is null then null else jsonb_build_object('id',r.id,'code',r.code,'label',r.label,'category',r.category,'detector_type',r.detector_type,'severity',r.severity,'scopes',r.scopes,'version',r.version,'enabled',r.enabled) end,
    'scan',jsonb_build_object('id',s.id,'status',s.status,'requested_reason',s.requested_reason,'detector_version',s.detector_version,
      'content_fingerprint',s.content_fingerprint,'attempt_count',s.attempt_count,'last_error_code',s.last_error_code,
      'coverage',jsonb_build_object('text',s.text_status,'audio',s.audio_status,'visual',s.visual_status,'reports',s.reports_status),
      'media_source_scan_id',s.media_source_scan_id,'started_at',s.started_at,'completed_at',s.completed_at),
    'content',jsonb_build_object('path',snap->>'path','summary',case when a.target_type='message' then a.evidence->>'matched_text_excerpt' else snap->>'summary' end,
      'shared_video_id',snap->>'shared_video_id'),
    'related_reports',(select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'reason',q.reason,'status',q.status,'created_at',q.created_at) order by q.created_at desc,q.id desc),'[]'::jsonb)
      from (select rr.id,rr.reason,rr.status,rr.created_at from public.reports rr where rr.reported_content_type=a.target_type and rr.reported_content_id=a.target_id order by rr.created_at desc,rr.id desc limit 20) q),
    'active_rule_count',(select count(*) from private.content_safety_rules where enabled),
    'policy_rules_not_configured',not exists(select 1 from private.content_safety_rules where enabled)
  ) into v_result
  from private.content_safety_alerts a join private.content_safety_scans s on s.id=a.scan_id
  left join private.content_safety_rules r on r.id=a.rule_id
  left join public.user_profiles u on u.id=a.owner_user_id
  left join lateral (select private.content_safety_target_snapshot(a.target_type,a.target_id) value) x on true
  left join lateral (select x.value snap) y on true
  where a.id=p_alert_id;
  if v_result is null then raise exception using errcode='P0002',message='content_safety_alert_not_found';end if;
  return v_result;
end;
$$;

create function public.search_admin_content_safety_rules()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
  perform public.admin_require_capability('content.items.read');
  return jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
    'id',r.id,'code',r.code,'label',r.label,'category',r.category,'detector_type',r.detector_type,
    'pattern',r.pattern,'severity',r.severity,'scopes',r.scopes,'enabled',r.enabled,'version',r.version,
    'created_at',r.created_at,'updated_at',r.updated_at
  ) order by r.enabled desc,r.updated_at desc,r.code) from private.content_safety_rules r),'[]'::jsonb));
end;
$$;

create function public.admin_create_content_safety_rule(
  p_label text,p_category text,p_detector_type text,p_pattern text,p_severity text,p_scopes text[],
  p_enabled boolean,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_actor uuid;v_scope text;v_fingerprint text;v_existing private.admin_action_audit;v_rule private.content_safety_rules;v_code text;v_scopes text[];
begin
  v_actor:=public.admin_require_capability('content.items.moderate');
  v_scope:='v1|human|'||v_actor::text||'|content.items.moderate|content_safety.rule.create';
  v_scopes:=array(select distinct btrim(x) from unnest(coalesce(p_scopes,'{}'::text[])) x order by 1);
  v_fingerprint:=private.content_safety_sha256(jsonb_build_object('label',p_label,'category',p_category,'detector_type',p_detector_type,'pattern',p_pattern,'severity',p_severity,'scopes',v_scopes,'enabled',p_enabled)::text);
  select * into v_existing from private.admin_action_audit where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then raise exception using errcode='23505',message='admin_idempotency_conflict';end if;
    return v_existing.metadata||jsonb_build_object('idempotent',true);
  end if;
  if p_label is null or p_category not in('violence','threat','harassment','hate','sexual','self_harm','drugs','weapons','fraud','spam','child_safety','other')
     or p_detector_type not in('keyword','phrase') or p_pattern is null or p_severity not in('low','medium','high','critical') then
    raise exception using errcode='22023',message='invalid_content_safety_rule';
  end if;
  v_code:='rule_'||left(replace(gen_random_uuid()::text,'-',''),12);
  insert into private.content_safety_rules(code,label,category,detector_type,pattern,severity,scopes,enabled,created_by,updated_by)
  values(v_code,btrim(p_label),p_category,p_detector_type,btrim(p_pattern),p_severity,v_scopes,coalesce(p_enabled,false),v_actor,v_actor)
  returning * into v_rule;
  insert into private.admin_action_audit(actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,target_id,target_ref,outcome,reason,financial_effect,contains_pii,idempotency_scope,idempotency_key,request_fingerprint,metadata)
  values(v_actor,'human_admin',private.admin_active_role_codes(v_actor),'content.items.moderate','content_safety','content_safety.rule.create','content_safety_rule',v_rule.id,v_rule.code,'succeeded',null,false,false,v_scope,p_idempotency_key,v_fingerprint,
    jsonb_build_object('rule_id',v_rule.id,'code',v_rule.code,'version',v_rule.version,'enabled',v_rule.enabled));
  return jsonb_build_object('rule_id',v_rule.id,'code',v_rule.code,'version',v_rule.version,'enabled',v_rule.enabled,'idempotent',false);
end;
$$;

create function public.admin_update_content_safety_rule(
  p_rule_id uuid,p_severity text,p_scopes text[],p_enabled boolean,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_actor uuid;v_scope text;v_fingerprint text;v_existing private.admin_action_audit;v_rule private.content_safety_rules;v_scopes text[];
begin
  v_actor:=public.admin_require_capability('content.items.moderate');
  v_scope:='v1|human|'||v_actor::text||'|content.items.moderate|content_safety.rule.update';
  v_scopes:=array(select distinct btrim(x) from unnest(coalesce(p_scopes,'{}'::text[])) x order by 1);
  v_fingerprint:=private.content_safety_sha256(jsonb_build_object('rule_id',p_rule_id,'severity',p_severity,'scopes',v_scopes,'enabled',p_enabled)::text);
  select * into v_existing from private.admin_action_audit where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then raise exception using errcode='23505',message='admin_idempotency_conflict';end if;
    return v_existing.metadata||jsonb_build_object('idempotent',true);
  end if;
  select * into v_rule from private.content_safety_rules where id=p_rule_id for update;
  if not found then raise exception using errcode='P0002',message='content_safety_rule_not_found';end if;
  if p_severity not in('low','medium','high','critical') then raise exception using errcode='22023',message='invalid_content_safety_rule';end if;
  update private.content_safety_rules set severity=p_severity,scopes=v_scopes,enabled=coalesce(p_enabled,false),
    version=version+1,updated_by=v_actor,updated_at=clock_timestamp() where id=p_rule_id returning * into v_rule;
  insert into private.admin_action_audit(actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,target_id,target_ref,outcome,reason,financial_effect,contains_pii,idempotency_scope,idempotency_key,request_fingerprint,metadata)
  values(v_actor,'human_admin',private.admin_active_role_codes(v_actor),'content.items.moderate','content_safety','content_safety.rule.update','content_safety_rule',v_rule.id,v_rule.code,'succeeded',null,false,false,v_scope,p_idempotency_key,v_fingerprint,
    jsonb_build_object('rule_id',v_rule.id,'code',v_rule.code,'version',v_rule.version,'enabled',v_rule.enabled));
  return jsonb_build_object('rule_id',v_rule.id,'code',v_rule.code,'version',v_rule.version,'enabled',v_rule.enabled,'idempotent',false);
end;
$$;

create function public.admin_review_content_safety_alert(
  p_alert_id uuid,p_action text,p_resolution text,p_note text,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_actor uuid;v_scope text;v_fingerprint text;v_existing private.admin_action_audit;v_alert private.content_safety_alerts;v_audit_action text;v_status text;v_resolution text;v_note text;
begin
  v_actor:=public.admin_require_capability('content.items.moderate');
  if p_action not in('take_review','dismiss','resolve') then raise exception using errcode='22023',message='invalid_content_safety_alert_action';end if;
  v_note:=nullif(btrim(coalesce(p_note,'')),'');
  if p_action in('dismiss','resolve') and (v_note is null or char_length(v_note)<2) then raise exception using errcode='22023',message='content_safety_resolution_note_required';end if;
  v_resolution:=case when p_action='dismiss' then 'no_violation' when p_action='resolve' and p_resolution in('reviewed','content_action_taken','user_action_taken') then p_resolution else null end;
  if p_action='resolve' and v_resolution is null then raise exception using errcode='22023',message='invalid_content_safety_resolution';end if;
  v_scope:='v1|human|'||v_actor::text||'|content.items.moderate|content_safety.alert.'||p_action;
  v_fingerprint:=private.content_safety_sha256(jsonb_build_object('alert_id',p_alert_id,'action',p_action,'resolution',v_resolution,'note',v_note)::text);
  select * into v_existing from private.admin_action_audit where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then raise exception using errcode='23505',message='admin_idempotency_conflict';end if;
    return v_existing.metadata||jsonb_build_object('idempotent',true);
  end if;
  select * into v_alert from private.content_safety_alerts where id=p_alert_id for update;
  if not found then raise exception using errcode='P0002',message='content_safety_alert_not_found';end if;
  if p_action='take_review' then
    if v_alert.status not in('open','in_review') then raise exception using errcode='55000',message='content_safety_alert_already_closed';end if;
    update private.content_safety_alerts set status='in_review',assigned_to=v_actor,updated_at=clock_timestamp() where id=p_alert_id returning * into v_alert;
    v_audit_action:='content_safety.alert.review';v_status:='in_review';
  elsif p_action='dismiss' then
    update private.content_safety_alerts set status='dismissed',assigned_to=coalesce(assigned_to,v_actor),reviewed_by=v_actor,reviewed_at=clock_timestamp(),resolution='no_violation',resolution_note=v_note,updated_at=clock_timestamp() where id=p_alert_id returning * into v_alert;
    v_audit_action:='content_safety.alert.dismiss';v_status:='dismissed';
  else
    update private.content_safety_alerts set status='resolved',assigned_to=coalesce(assigned_to,v_actor),reviewed_by=v_actor,reviewed_at=clock_timestamp(),resolution=v_resolution,resolution_note=v_note,updated_at=clock_timestamp() where id=p_alert_id returning * into v_alert;
    v_audit_action:='content_safety.alert.resolve';v_status:='resolved';
  end if;
  insert into private.admin_action_audit(actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,target_id,target_ref,outcome,reason,financial_effect,contains_pii,idempotency_scope,idempotency_key,request_fingerprint,metadata)
  values(v_actor,'human_admin',private.admin_active_role_codes(v_actor),'content.items.moderate','content_safety',v_audit_action,'content_safety_alert',v_alert.id,v_alert.target_type||':'||v_alert.target_id::text,'succeeded',v_note,false,true,v_scope,p_idempotency_key,v_fingerprint,
    jsonb_build_object('alert_id',v_alert.id,'status',v_status,'resolution',v_alert.resolution));
  return jsonb_build_object('alert_id',v_alert.id,'status',v_status,'resolution',v_alert.resolution,'idempotent',false);
end;
$$;

create function public.admin_retry_content_safety_scan(p_scan_id uuid,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_actor uuid;v_scope text;v_fingerprint text;v_existing private.admin_action_audit;v_scan private.content_safety_scans;
begin
  v_actor:=public.admin_require_capability('content.items.moderate');
  v_scope:='v1|human|'||v_actor::text||'|content.items.moderate|content_safety.scan.retry';
  v_fingerprint:=private.content_safety_sha256(jsonb_build_object('scan_id',p_scan_id)::text);
  select * into v_existing from private.admin_action_audit where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then raise exception using errcode='23505',message='admin_idempotency_conflict';end if;
    return v_existing.metadata||jsonb_build_object('idempotent',true);
  end if;
  select * into v_scan from private.content_safety_scans where id=p_scan_id for update;
  if not found then raise exception using errcode='P0002',message='content_safety_scan_not_found';end if;
  if v_scan.status<>'failed' then raise exception using errcode='55000',message='content_safety_scan_not_failed';end if;
  update private.content_safety_scans set status='queued',requested_reason='retry',attempt_count=0,text_status='pending',reports_status='pending',available_at=clock_timestamp(),started_at=null,completed_at=null,last_error_code=null,updated_at=clock_timestamp() where id=p_scan_id returning * into v_scan;
  insert into private.admin_action_audit(actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,target_id,target_ref,outcome,reason,financial_effect,contains_pii,idempotency_scope,idempotency_key,request_fingerprint,metadata)
  values(v_actor,'human_admin',private.admin_active_role_codes(v_actor),'content.items.moderate','content_safety','content_safety.scan.retry','content_safety_scan',v_scan.id,v_scan.target_type||':'||v_scan.target_id::text,'succeeded',null,false,false,v_scope,p_idempotency_key,v_fingerprint,jsonb_build_object('scan_id',v_scan.id,'status','queued'));
  return jsonb_build_object('scan_id',v_scan.id,'status','queued','idempotent',false);
end;
$$;

create function public.wake_content_safety_scanner()
returns bigint language plpgsql security definer set search_path=''
as $$
declare v_url text;v_key text;v_secret text;v_request_id bigint;
begin
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

revoke all on function private.content_safety_sha256(text) from public,anon,authenticated,service_role;
revoke all on function private.content_safety_target_snapshot(text,uuid) from public,anon,authenticated,service_role;
revoke all on function private.content_safety_fingerprint(text,uuid) from public,anon,authenticated,service_role;
revoke all on function private.content_safety_priority(text,integer,integer,integer,bigint) from public,anon,authenticated,service_role;
revoke all on function private.enqueue_content_safety_scan(text,uuid,text) from public,anon,authenticated,service_role;
revoke all on function private.content_safety_content_trigger() from public,anon,authenticated,service_role;
revoke all on function private.content_safety_report_trigger() from public,anon,authenticated,service_role;

revoke all on function public.get_content_safety_worker_rules() from public,anon,authenticated,service_role;
revoke all on function public.claim_content_safety_scans(integer) from public,anon,authenticated,service_role;
revoke all on function public.complete_content_safety_scan(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.fail_content_safety_scan(uuid,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.enqueue_content_safety_backfill(integer) from public,anon,authenticated,service_role;
grant execute on function public.get_content_safety_worker_rules() to service_role;
grant execute on function public.claim_content_safety_scans(integer) to service_role;
grant execute on function public.complete_content_safety_scan(uuid,jsonb) to service_role;
grant execute on function public.fail_content_safety_scan(uuid,text,boolean) to service_role;
grant execute on function public.enqueue_content_safety_backfill(integer) to service_role;

revoke all on function public.search_admin_content_safety_alerts(text,text,text,text,text,text,integer,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.get_admin_content_safety_alert(uuid) from public,anon,authenticated,service_role;
revoke all on function public.search_admin_content_safety_rules() from public,anon,authenticated,service_role;
revoke all on function public.admin_create_content_safety_rule(text,text,text,text,text,text[],boolean,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_update_content_safety_rule(uuid,text,text[],boolean,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_review_content_safety_alert(uuid,text,text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_retry_content_safety_scan(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.search_admin_content_safety_alerts(text,text,text,text,text,text,integer,timestamptz,uuid,integer) to authenticated;
grant execute on function public.get_admin_content_safety_alert(uuid) to authenticated;
grant execute on function public.search_admin_content_safety_rules() to authenticated;
grant execute on function public.admin_create_content_safety_rule(text,text,text,text,text,text[],boolean,uuid) to authenticated;
grant execute on function public.admin_update_content_safety_rule(uuid,text,text[],boolean,uuid) to authenticated;
grant execute on function public.admin_review_content_safety_alert(uuid,text,text,text,uuid) to authenticated;
grant execute on function public.admin_retry_content_safety_scan(uuid,uuid) to authenticated;

revoke all on function public.wake_content_safety_scanner() from public,anon,authenticated,service_role;
grant execute on function public.wake_content_safety_scanner() to service_role;

comment on table private.content_safety_rules is 'Human-configured keyword/phrase detectors. F4 deploys no invented policy rules.';
comment on table private.content_safety_scans is 'Asynchronous analysis lifecycle and honest coverage; no enforcement authority.';
comment on table private.content_safety_alerts is 'Prioritized detection evidence for human review; alerts are neither reports nor sanctions.';
comment on function public.complete_content_safety_scan(uuid,jsonb) is 'Service-only scanner completion. Creates alerts but never hides, warns, suspends, deletes, or moves funds.';

commit;
