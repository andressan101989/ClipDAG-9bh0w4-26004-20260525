begin;

create or replace function private.content_safety_target_snapshot(p_target_type text,p_target_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_result jsonb;
begin
  if p_target_type='video' then
    select jsonb_build_object(
      'owner_user_id',v.user_id,'scope','video_caption','text_value',coalesce(v.caption,''),
      'reach',greatest(v.views_count,0),'path','/content/video/'||v.id::text,
      'summary',left(nullif(btrim(v.caption),''),300),
      'content_version',jsonb_build_object('caption',v.caption,'video_url',v.video_url,'media_urls',v.media_urls,'edited_at',v.edited_at,'created_at',v.created_at)::text,
      'shared_video_id',null
    ) into v_result from public.videos v where v.id=p_target_id;
  elsif p_target_type='comment' then
    select jsonb_build_object(
      'owner_user_id',c.user_id,'scope','comment','text_value',coalesce(c.text,''),'reach',0,
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
      'owner_user_id',m.user_id,'scope','live_chat','text_value',coalesce(m.message,''),'reach',0,
      'path','/live/'||m.session_id::text,'summary',left(m.message,300),
      'content_version',jsonb_build_object('message',m.message,'created_at',m.created_at)::text,
      'shared_video_id',null
    ) into v_result from public.live_messages m where m.id=p_target_id;
  elsif p_target_type='message' then
    select jsonb_build_object(
      'owner_user_id',m.sender_id,'scope','reported_message','text_value',coalesce(m.text,''),'reach',0,
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

create or replace function private.enqueue_content_safety_scan(
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
    attempt_count=case when private.content_safety_scans.status='processing' then private.content_safety_scans.attempt_count else 0 end,
    available_at=case when private.content_safety_scans.status='processing' then private.content_safety_scans.available_at else clock_timestamp() end,
    started_at=case when private.content_safety_scans.status='processing' then private.content_safety_scans.started_at else null end,
    completed_at=case when private.content_safety_scans.status='processing' then private.content_safety_scans.completed_at else null end,
    last_error_code=case when private.content_safety_scans.status='processing' then private.content_safety_scans.last_error_code else null end,
    updated_at=clock_timestamp()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.complete_content_safety_scan(p_scan_id uuid,p_matches jsonb default '[]'::jsonb)
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

  if v_total_reports>0 then
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

revoke all on function private.content_safety_target_snapshot(text,uuid) from public,anon,authenticated,service_role;
revoke all on function private.enqueue_content_safety_scan(text,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.complete_content_safety_scan(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.complete_content_safety_scan(uuid,jsonb) to service_role;

comment on function public.complete_content_safety_scan(uuid,jsonb) is 'Service-only scanner completion. Refreshes report signals and creates alerts but never enforces content or account actions.';

commit;
