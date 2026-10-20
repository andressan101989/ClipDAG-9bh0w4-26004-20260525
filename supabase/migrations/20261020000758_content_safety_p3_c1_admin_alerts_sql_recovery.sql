begin;

-- PostgreSQL implements COALESCE as special SQL syntax, so it cannot be
-- schema-qualified. B7 qualified it in these two stored PL/pgSQL bodies;
-- the statements therefore compiled lazily and failed with SQLSTATE 42883
-- when an authorized administrator first executed them.
create or replace function private.preview_content_safety_rule_definition(
  p_rule_id uuid,p_rule_version bigint,p_detector_type text,p_pattern text,
  p_scopes text[],p_locale text,p_limit integer
) returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_scopes text[];v_result jsonb;v_definition_fingerprint text;
begin
  v_scopes:=array(select distinct pg_catalog.btrim(value)
    from pg_catalog.unnest(coalesce(p_scopes,'{}'::text[])) value order by 1);
  if p_detector_type not in('keyword','phrase')
     or nullif(pg_catalog.btrim(coalesce(p_pattern,'')),'') is null
     or pg_catalog.char_length(pg_catalog.btrim(p_pattern))>200 or pg_catalog.cardinality(v_scopes)=0
     or not(v_scopes<@array[
       'video_caption','comment','story_text','live_chat','reported_message','transcript','creator_premium_text'
     ]::text[])
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
    from public.videos v left join private.admin_content_moderation_state ms
      on ms.target_type='video' and ms.target_id=v.id
    where 'video_caption'=any(v_scopes)
    union all
    select 'comment',c.id,c.user_id,'comment',coalesce(c.text,''),coalesce(ms.visibility,'visible')
    from public.comments c left join private.admin_content_moderation_state ms
      on ms.target_type='comment' and ms.target_id=c.id
    where 'comment'=any(v_scopes)
    union all
    select 'story',s.id,s.user_id,'story_text',coalesce((
      select pg_catalog.string_agg(nullif(pg_catalog.btrim(e->>'text'),''),' ' order by ordinality)
      from pg_catalog.jsonb_array_elements(coalesce(s.story_composition->'elements','[]'::jsonb))
        with ordinality x(e,ordinality)
      where e->>'type'='text'
    ),''),coalesce(ms.visibility,'visible')
    from public.stories s left join private.admin_content_moderation_state ms
      on ms.target_type='story' and ms.target_id=s.id
    where 'story_text'=any(v_scopes)
    union all
    select 'live_message',m.id,m.user_id,'live_chat',coalesce(m.message,''),'visible'
    from public.live_messages m where 'live_chat'=any(v_scopes)
    union all
    select 'message',m.id,m.sender_id,'reported_message',coalesce(m.text,''),'reported_only'
    from public.messages m where 'reported_message'=any(v_scopes) and exists(
      select 1 from public.reports r where r.reported_content_type='message' and r.reported_content_id=m.id
    )
    union all
    select 'creator_premium',content.id,content.creator_id,'creator_premium_text',
      pg_catalog.concat_ws(' ',content.title,content.description),content.lifecycle_status
    from private.creator_premium_contents content
    where 'creator_premium_text'=any(v_scopes) and content.lifecycle_status<>'deleted'
  ), matches as materialized (
    select * from candidates c
    where private.content_safety_text_matches(c.text_value,p_pattern,p_detector_type)
  ), samples as (
    select m.*,p.username,p.display_name
    from matches m left join public.user_profiles p on p.id=m.owner_user_id
    order by m.target_type,m.target_id limit p_limit
  )
  select pg_catalog.jsonb_build_object(
    'rule_id',p_rule_id,'rule_version',p_rule_version,'definition_fingerprint',v_definition_fingerprint,
    'detector_type',p_detector_type,'normalized_pattern',private.normalize_content_safety_text(p_pattern),
    'locale',p_locale,'scopes',v_scopes,'total_matching_content',(select pg_catalog.count(*) from matches),
    'counts',pg_catalog.jsonb_build_object(
      'videos',(select pg_catalog.count(*) from matches where target_type='video'),
      'stories',(select pg_catalog.count(*) from matches where target_type='story'),
      'comments',(select pg_catalog.count(*) from matches where target_type='comment'),
      'live_chat',(select pg_catalog.count(*) from matches where target_type='live_message'),
      'reported_messages',(select pg_catalog.count(*) from matches where target_type='message'),
      'creator_premium',(select pg_catalog.count(*) from matches where target_type='creator_premium')
    ),
    'samples',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'target_type',target_type,'target_id',target_id,'scope',scope,
      'author',pg_catalog.jsonb_build_object('id',owner_user_id,'username',username,'display_name',display_name),
      'excerpt',pg_catalog.left(private.normalize_content_safety_text(text_value),240),
      'current_visibility',current_visibility
    ) order by target_type,target_id) from samples),'[]'::jsonb),
    'sample_limit',p_limit,'excerpt_limit',240,'creates_alerts',false,'creates_scans',false,
    'modifies_content',false,'ordinary_private_messages_included',false,
    'private_premium_originals_included',false
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.search_admin_content_safety_alerts(
  p_severity text default null,p_status text default null,p_category text default null,
  p_target_type text default null,p_source_type text default null,p_coverage text default null,
  p_cursor_priority integer default null,p_cursor_created_at timestamptz default null,p_cursor_id uuid default null,
  p_limit integer default 50
) returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
  perform public.admin_require_capability('content.items.read');
  if p_limit<1 or p_limit>100
     or (p_severity is not null and p_severity not in('low','medium','high','critical'))
     or (p_status is not null and p_status not in('open','in_review','dismissed','resolved'))
     or (p_target_type is not null and p_target_type not in(
       'video','comment','story','live_message','message','creator_premium'))
     or (p_source_type is not null and p_source_type not in(
       'text_rule','user_reports','audio_classifier','audio_transcript_rule','visual_classifier'))
     or (p_coverage is not null and p_coverage not in('complete','incomplete','failed','pending')) then
    raise exception using errcode='22023',message='invalid_content_safety_filter';
  end if;
  return (
    with filtered as (
      select alert.*,scan.text_status,scan.audio_status,scan.visual_status,scan.reports_status,
        scan.status scan_status,rule.code rule_code,rule.label rule_label,
        case when alert.priority_score>=85 then 'critical' when alert.priority_score>=65 then 'high'
             when alert.priority_score>=40 then 'medium' else 'low' end priority_bucket
      from private.content_safety_alerts alert
      join private.content_safety_scans scan on scan.id=alert.scan_id
      left join private.content_safety_rules rule on rule.id=alert.rule_id
      where (p_severity is null or alert.severity=p_severity)
        and (p_status is null or alert.status=p_status)
        and (p_category is null or alert.category=p_category)
        and (p_target_type is null or alert.target_type=p_target_type)
        and (p_source_type is null or alert.source_type=p_source_type)
        and (p_coverage is null
          or (p_coverage='complete' and scan.text_status='analyzed' and scan.reports_status='analyzed'
            and scan.audio_status in('analyzed','not_applicable')
            and scan.visual_status in('analyzed','not_applicable'))
          or (p_coverage='incomplete' and (scan.audio_status='not_configured' or scan.visual_status='not_configured'))
          or (p_coverage='failed' and (scan.text_status='failed' or scan.audio_status='failed'
            or scan.visual_status='failed' or scan.reports_status='failed'))
          or (p_coverage='pending' and (scan.text_status='pending' or scan.audio_status='pending'
            or scan.visual_status='pending' or scan.reports_status='pending')))
        and (p_cursor_priority is null or alert.priority_score<p_cursor_priority
          or (alert.priority_score=p_cursor_priority and alert.created_at>p_cursor_created_at)
          or (alert.priority_score=p_cursor_priority and alert.created_at=p_cursor_created_at and alert.id>p_cursor_id))
      order by alert.priority_score desc,alert.created_at,alert.id limit p_limit
    ), stats as (
      select pg_catalog.count(*) filter(where status='open') open_count,
        pg_catalog.count(*) filter(where status='in_review') in_review_count,
        pg_catalog.count(*) filter(where status='resolved') resolved_count,
        pg_catalog.count(*) filter(where status='dismissed') dismissed_count,
        pg_catalog.count(*) filter(where priority_score>=85 and status in('open','in_review')) critical_count,
        pg_catalog.count(*) filter(where priority_score between 65 and 84 and status in('open','in_review')) high_count,
        pg_catalog.count(*) filter(where priority_score between 40 and 64 and status in('open','in_review')) medium_count,
        pg_catalog.count(*) filter(where priority_score<40 and status in('open','in_review')) low_count
      from private.content_safety_alerts
    )
    select pg_catalog.jsonb_build_object(
      'stats',(select pg_catalog.to_jsonb(stats) from stats),
      'active_rule_count',(select pg_catalog.count(*) from private.content_safety_rules where enabled),
      'items',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',row.id,'target_type',row.target_type,'target_id',row.target_id,'owner_user_id',row.owner_user_id,
        'author',pg_catalog.jsonb_build_object('id',profile.id,'username',profile.username,
          'display_name',profile.display_name,'avatar_url',profile.avatar_url),
        'source_type',row.source_type,'category',row.category,'severity',row.severity,
        'priority_score',row.priority_score,'priority_bucket',row.priority_bucket,
        'status',row.status,'rule_code',row.rule_code,'rule_label',row.rule_label,
        'evidence_excerpt',coalesce(row.evidence->>'matched_text_excerpt',row.evidence->>'description'),
        'reach',row.reach,'related_report_count',row.related_report_count,
        'pending_report_count',row.pending_report_count,'reports_last_15m',row.reports_last_15m,
        'active_warning_count',row.active_warning_count,
        'coverage',pg_catalog.jsonb_build_object('text',row.text_status,'audio',row.audio_status,
          'visual',row.visual_status,'reports',row.reports_status),
        'scan_status',row.scan_status,'created_at',row.created_at
      ) order by row.priority_score desc,row.created_at,row.id)
        from filtered row left join public.user_profiles profile on profile.id=row.owner_user_id),'[]'::jsonb),
      'next_cursor',(select pg_catalog.jsonb_build_object(
        'priority_score',row.priority_score,'created_at',row.created_at,'id',row.id)
        from filtered row order by row.priority_score,row.created_at desc,row.id desc limit 1)
    )
  );
end;
$$;

alter function private.preview_content_safety_rule_definition(uuid,bigint,text,text,text[],text,integer)
  owner to postgres;
alter function public.search_admin_content_safety_alerts(text,text,text,text,text,text,integer,timestamptz,uuid,integer)
  owner to postgres;

revoke all on function private.preview_content_safety_rule_definition(uuid,bigint,text,text,text[],text,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.search_admin_content_safety_alerts(text,text,text,text,text,text,integer,timestamptz,uuid,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.search_admin_content_safety_alerts(text,text,text,text,text,text,integer,timestamptz,uuid,integer)
  to authenticated;

comment on function private.preview_content_safety_rule_definition(uuid,bigint,text,text,text[],text,integer)
  is 'Read-only bounded Content Safety rule preview; P3-C1 restores SQL special-expression compatibility without changing policy authority.';
comment on function public.search_admin_content_safety_alerts(text,text,text,text,text,text,integer,timestamptz,uuid,integer)
  is 'Capability-gated Content Safety alert search; P3-C1 restores SQL special-expression compatibility without changing review authority.';

commit;
