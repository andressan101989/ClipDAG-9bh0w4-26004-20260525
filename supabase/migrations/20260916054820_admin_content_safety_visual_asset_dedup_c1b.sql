begin;

-- C1B makes the immutable canonical asset (C1A), rather than the scan that
-- first referenced it, the durable Visual AI analysis identity. Applying this
-- migration never calls a provider and never creates an analysis.

alter table private.content_safety_scans
  add column visual_analysis_id uuid null
    references private.content_safety_visual_analyses(id)
    on update restrict on delete set null;

create index content_safety_scans_visual_analysis_idx
  on private.content_safety_scans(visual_analysis_id)
  where visual_analysis_id is not null;

do $$
begin
  if exists(
    select 1
    from private.content_safety_visual_analyses
    where media_asset_id is not null
    group by media_asset_id,provider,model,prompt_version,sample_strategy
    having count(*)>1
  ) then
    raise exception using errcode='23505',message='duplicate_visual_image_asset_analyses';
  end if;
  if exists(
    select 1
    from private.content_safety_visual_analyses
    where video_asset_id is not null
    group by video_asset_id,provider,model,prompt_version,sample_strategy
    having count(*)>1
  ) then
    raise exception using errcode='23505',message='duplicate_visual_video_asset_analyses';
  end if;
end;
$$;

create unique index content_safety_visual_analyses_media_asset_unique
  on private.content_safety_visual_analyses(media_asset_id,provider,model,prompt_version,sample_strategy)
  where media_asset_id is not null;

create unique index content_safety_visual_analyses_video_asset_unique
  on private.content_safety_visual_analyses(video_asset_id,provider,model,prompt_version,sample_strategy)
  where video_asset_id is not null;

-- Existing source scans are connected to their already-persisted analysis.
update private.content_safety_scans s
set visual_analysis_id=a.id,
    visual_status='analyzed',
    visual_completed_at=coalesce(s.visual_completed_at,a.created_at),
    visual_last_error_code=null,
    updated_at=clock_timestamp()
from private.content_safety_visual_analyses a
where s.target_type='video'
  and s.visual_analysis_id is null
  and a.provider='cloudflare_workers_ai'
  and a.model='@cf/google/gemma-4-26b-a4b-it'
  and a.prompt_version='visual-safety-v1'
  and (
    (a.media_asset_id is not null and s.visual_media_asset_id=a.media_asset_id and a.sample_strategy='single_image_v1')
    or
    (a.video_asset_id is not null and s.visual_video_asset_id=a.video_asset_id and a.sample_strategy='percentile_5_v1')
  );

-- Shared Stories keep media_source_scan_id semantics and receive an explicit
-- pointer to the effective asset-level analysis. No Story analysis is created.
update private.content_safety_scans st
set visual_analysis_id=src.visual_analysis_id,
    visual_provider=src.visual_provider,
    visual_model=src.visual_model,
    visual_prompt_version=src.visual_prompt_version,
    visual_source_kind=case src.visual_source_kind
      when 'eligible_image' then 'shared_image'
      when 'eligible_stream_video' then 'shared_stream_video'
      else st.visual_source_kind
    end,
    visual_video_asset_id=src.visual_video_asset_id,
    visual_media_asset_id=src.visual_media_asset_id,
    visual_status=case when src.visual_analysis_id is not null then 'analyzed' else src.visual_status end,
    visual_completed_at=case when src.visual_analysis_id is not null then src.visual_completed_at else st.visual_completed_at end,
    visual_last_error_code=case when src.visual_analysis_id is not null then null else src.visual_last_error_code end,
    updated_at=clock_timestamp()
from private.content_safety_scans src
where st.target_type='story'
  and st.media_source_scan_id=src.id
  and src.visual_analysis_id is not null;

create or replace function private.content_safety_visual_analysis_id_for_asset(
  p_video_asset_id uuid,
  p_media_asset_id uuid
)
returns uuid
language sql
stable
security definer
set search_path=''
as $$
  select a.id
  from private.content_safety_visual_analyses a
  where a.provider='cloudflare_workers_ai'
    and a.model='@cf/google/gemma-4-26b-a4b-it'
    and a.prompt_version='visual-safety-v1'
    and (
      (p_media_asset_id is not null and a.media_asset_id=p_media_asset_id and a.sample_strategy='single_image_v1')
      or
      (p_video_asset_id is not null and a.video_asset_id=p_video_asset_id and a.sample_strategy='percentile_5_v1')
    )
  order by a.created_at,a.id
  limit 1;
$$;

create or replace function private.content_safety_visual_producer_scan_id(
  p_video_asset_id uuid,
  p_media_asset_id uuid
)
returns uuid
language sql
stable
security definer
set search_path=''
as $$
  select s.id
  from private.content_safety_scans s
  where s.target_type='video'
    and s.visual_provider='cloudflare_workers_ai'
    and s.visual_model='@cf/google/gemma-4-26b-a4b-it'
    and s.visual_prompt_version='visual-safety-v1'
    and (
      (p_media_asset_id is not null and s.visual_media_asset_id=p_media_asset_id and s.visual_source_kind='eligible_image')
      or
      (p_video_asset_id is not null and s.visual_video_asset_id=p_video_asset_id and s.visual_source_kind='eligible_stream_video')
    )
  order by s.created_at,s.id
  limit 1;
$$;

create or replace function private.content_safety_create_visual_alerts_for_scan(
  p_scan_id uuid,
  p_analysis_id uuid
)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_scan private.content_safety_scans;
  v_analysis private.content_safety_visual_analyses;
  v_category text;
  v_severity text;
  v_description text;
  v_frame_indexes integer[];
  v_frame_times integer[];
  v_snapshot jsonb;
  v_total integer;
  v_pending integer;
  v_recent integer;
  v_latest timestamptz;
  v_warnings integer;
  v_reach bigint;
  v_priority integer;
  v_count integer:=0;
begin
  select * into v_scan from private.content_safety_scans where id=p_scan_id;
  select * into v_analysis from private.content_safety_visual_analyses where id=p_analysis_id;
  if v_scan.id is null or v_analysis.id is null or v_scan.target_type<>'video' then
    return 0;
  end if;
  if not coalesce((v_analysis.analysis_result->>'review_required')::boolean,false) then
    return 0;
  end if;

  v_snapshot:=private.content_safety_target_snapshot(v_scan.target_type,v_scan.target_id);
  select count(*)::integer,
         count(*) filter(where r.status='pending')::integer,
         count(*) filter(where r.status='pending' and r.created_at>=clock_timestamp()-interval '15 minutes')::integer,
         max(r.created_at)
  into v_total,v_pending,v_recent,v_latest
  from public.reports r
  where r.reported_content_type=v_scan.target_type and r.reported_content_id=v_scan.target_id;

  select count(*)::integer into v_warnings
  from private.admin_user_warnings w
  where w.target_user_id=v_scan.owner_user_id and w.status='active'
    and w.issued_at>coalesce((
      select max(a.completed_at)
      from private.admin_user_moderation_actions a
      where a.target_user_id=v_scan.owner_user_id and a.action='restore' and a.status='succeeded'
    ),'-infinity'::timestamptz);
  v_warnings:=least(coalesce(v_warnings,0),3);
  v_reach:=greatest(coalesce((v_snapshot->>'reach')::bigint,0),0);

  for v_category in
    select distinct f.value->>'category'
    from jsonb_array_elements(v_analysis.analysis_result->'findings') f(value)
  loop
    select f.value->>'triage_level'
    into v_severity
    from jsonb_array_elements(v_analysis.analysis_result->'findings') f(value)
    where f.value->>'category'=v_category
    order by case f.value->>'triage_level'
      when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end desc
    limit 1;

    select left(string_agg(f.value->>'description',' · ' order by f.ordinality),240),
           coalesce(array_agg(distinct (f.value->>'frame_index')::integer order by (f.value->>'frame_index')::integer)
             filter(where jsonb_typeof(f.value->'frame_index')='number'),'{}'::integer[])
    into v_description,v_frame_indexes
    from jsonb_array_elements(v_analysis.analysis_result->'findings') with ordinality f(value,ordinality)
    where f.value->>'category'=v_category;

    if v_analysis.video_asset_id is not null then
      select coalesce(array_agg(v_analysis.frame_timestamps_ms[i+1] order by i),'{}'::integer[])
      into v_frame_times
      from unnest(v_frame_indexes) i
      where i>=0 and i<cardinality(v_analysis.frame_timestamps_ms);
    else
      v_frame_times:='{}'::integer[];
    end if;

    v_priority:=private.content_safety_priority(v_severity,v_pending,v_recent,v_warnings,v_reach);
    insert into private.content_safety_alerts(
      scan_id,target_type,target_id,owner_user_id,source_type,rule_id,category,severity,confidence,priority_score,
      alert_fingerprint,reach,related_report_count,pending_report_count,reports_last_15m,latest_report_at,active_warning_count,evidence
    ) values(
      v_scan.id,v_scan.target_type,v_scan.target_id,v_scan.owner_user_id,'visual_classifier',null,v_category,v_severity,null,v_priority,
      private.content_safety_sha256(v_scan.id::text||'|'||v_analysis.id::text||'|visual_classifier|'||v_category||'|'||v_analysis.prompt_version),
      v_reach,v_total,v_pending,v_recent,v_latest,v_warnings,
      jsonb_build_object(
        'visual_analysis_id',v_analysis.id,'provider',v_analysis.provider,'model',v_analysis.model,
        'prompt_version',v_analysis.prompt_version,'sample_strategy',v_analysis.sample_strategy,
        'category',v_category,'model_triage_level',v_severity,'description',v_description,
        'frame_indexes',to_jsonb(v_frame_indexes),'frame_timestamps_ms',to_jsonb(v_frame_times),
        'analysis_fingerprint',v_analysis.analysis_fingerprint
      )
    )
    on conflict(alert_fingerprint) do update set
      priority_score=excluded.priority_score,
      reach=excluded.reach,
      related_report_count=excluded.related_report_count,
      pending_report_count=excluded.pending_report_count,
      reports_last_15m=excluded.reports_last_15m,
      latest_report_at=excluded.latest_report_at,
      active_warning_count=excluded.active_warning_count,
      evidence=excluded.evidence,
      updated_at=clock_timestamp();
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

create or replace function private.content_safety_attach_visual_analysis(p_analysis_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_analysis private.content_safety_visual_analyses;
  v_scan_id uuid;
  v_scan_count integer:=0;
  v_story_count integer:=0;
  v_alert_count integer:=0;
begin
  select * into v_analysis
  from private.content_safety_visual_analyses
  where id=p_analysis_id;
  if not found then
    raise exception using errcode='P0002',message='content_safety_visual_analysis_not_found';
  end if;

  update private.content_safety_scans s
  set visual_analysis_id=v_analysis.id,
      visual_status='analyzed',
      visual_provider=v_analysis.provider,
      visual_model=v_analysis.model,
      visual_prompt_version=v_analysis.prompt_version,
      visual_completed_at=coalesce(s.visual_completed_at,v_analysis.created_at),
      visual_started_at=null,
      visual_last_error_code=null,
      visual_attempt_count=0,
      visual_partial_result=null,
      updated_at=clock_timestamp()
  where s.target_type='video'
    and (
      (v_analysis.media_asset_id is not null and s.visual_media_asset_id=v_analysis.media_asset_id and s.visual_source_kind='eligible_image')
      or
      (v_analysis.video_asset_id is not null and s.visual_video_asset_id=v_analysis.video_asset_id and s.visual_source_kind='eligible_stream_video')
    );
  get diagnostics v_scan_count=row_count;

  update private.content_safety_scans st
  set visual_analysis_id=v_analysis.id,
      visual_provider=v_analysis.provider,
      visual_model=v_analysis.model,
      visual_prompt_version=v_analysis.prompt_version,
      visual_source_kind=case when v_analysis.media_asset_id is not null then 'shared_image' else 'shared_stream_video' end,
      visual_video_asset_id=v_analysis.video_asset_id,
      visual_media_asset_id=v_analysis.media_asset_id,
      visual_status='analyzed',
      visual_completed_at=coalesce(st.visual_completed_at,v_analysis.created_at),
      visual_started_at=null,
      visual_last_error_code=null,
      visual_attempt_count=0,
      visual_partial_result=null,
      updated_at=clock_timestamp()
  where st.target_type='story'
    and exists(
      select 1
      from private.content_safety_scans src
      where src.id=st.media_source_scan_id
        and (
          (v_analysis.media_asset_id is not null and src.visual_media_asset_id=v_analysis.media_asset_id)
          or
          (v_analysis.video_asset_id is not null and src.visual_video_asset_id=v_analysis.video_asset_id)
        )
    );
  get diagnostics v_story_count=row_count;

  for v_scan_id in
    select s.id
    from private.content_safety_scans s
    where s.target_type='video' and s.visual_analysis_id=v_analysis.id
  loop
    v_alert_count:=v_alert_count+private.content_safety_create_visual_alerts_for_scan(v_scan_id,v_analysis.id);
  end loop;

  return jsonb_build_object(
    'analysis_id',v_analysis.id,
    'scans_attached',v_scan_count,
    'stories_attached',v_story_count,
    'alerts_processed',v_alert_count
  );
end;
$$;

create or replace function public.refresh_content_safety_visual_eligibility(p_limit integer default 100,p_target_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_scan private.content_safety_scans;
  v_source jsonb;
  v_source_scan private.content_safety_scans;
  v_analysis_id uuid;
  v_count integer:=0;
  v_pending integer:=0;
  v_reused integer:=0;
  v_not_applicable integer:=0;
  v_not_configured integer:=0;
begin
  if p_limit<1 or p_limit>500 then
    raise exception using errcode='22023',message='invalid_visual_eligibility_limit';
  end if;
  for v_scan in
    select *
    from private.content_safety_scans s
    where s.target_type in('video','story') and (p_target_id is null or s.target_id=p_target_id)
    order by case when s.target_type='video' then 0 else 1 end,s.created_at,s.id
    limit p_limit
  loop
    v_source:=private.content_safety_visual_source(v_scan.target_type,v_scan.target_id);
    v_analysis_id:=null;
    if v_scan.target_type='video' and v_source->>'kind' in('eligible_image','eligible_stream_video') then
      v_analysis_id:=private.content_safety_visual_analysis_id_for_asset(
        case when v_source->>'video_asset_id' is null then null else (v_source->>'video_asset_id')::uuid end,
        case when v_source->>'media_asset_id' is null then null else (v_source->>'media_asset_id')::uuid end
      );
      update private.content_safety_scans
      set visual_analysis_id=v_analysis_id,
          visual_provider='cloudflare_workers_ai',
          visual_model='@cf/google/gemma-4-26b-a4b-it',
          visual_prompt_version='visual-safety-v1',
          visual_source_kind=v_source->>'kind',
          visual_video_asset_id=case when v_source->>'video_asset_id' is null then null else (v_source->>'video_asset_id')::uuid end,
          visual_media_asset_id=case when v_source->>'media_asset_id' is null then null else (v_source->>'media_asset_id')::uuid end,
          visual_status=case when v_analysis_id is null then 'pending' else 'analyzed' end,
          visual_available_at=case when v_analysis_id is null then clock_timestamp() else visual_available_at end,
          visual_started_at=null,
          visual_completed_at=case when v_analysis_id is null then null else coalesce(visual_completed_at,clock_timestamp()) end,
          visual_last_error_code=null,
          visual_frame_cursor=case when v_analysis_id is null then 0 else visual_frame_cursor end,
          visual_partial_result=null,
          updated_at=clock_timestamp()
      where id=v_scan.id;
      if v_analysis_id is null then
        v_pending:=v_pending+1;
      else
        perform private.content_safety_attach_visual_analysis(v_analysis_id);
        v_reused:=v_reused+1;
      end if;
    elsif v_scan.target_type='story' and v_source->>'kind' in('shared_image','shared_stream_video') then
      select * into v_source_scan
      from private.content_safety_scans s
      where s.target_type='video' and s.target_id=(v_source->>'shared_video_id')::uuid
      order by s.created_at desc,s.id desc
      limit 1;
      if found then
        v_analysis_id:=coalesce(
          v_source_scan.visual_analysis_id,
          private.content_safety_visual_analysis_id_for_asset(v_source_scan.visual_video_asset_id,v_source_scan.visual_media_asset_id)
        );
        if v_analysis_id is not null then
          perform private.content_safety_attach_visual_analysis(v_analysis_id);
          select * into v_source_scan from private.content_safety_scans where id=v_source_scan.id;
        end if;
        update private.content_safety_scans
        set media_source_scan_id=v_source_scan.id,
            visual_analysis_id=v_analysis_id,
            visual_provider=v_source_scan.visual_provider,
            visual_model=v_source_scan.visual_model,
            visual_prompt_version=v_source_scan.visual_prompt_version,
            visual_source_kind=v_source->>'kind',
            visual_video_asset_id=v_source_scan.visual_video_asset_id,
            visual_media_asset_id=v_source_scan.visual_media_asset_id,
            visual_status=case when v_analysis_id is not null then 'analyzed' else v_source_scan.visual_status end,
            visual_last_error_code=case when v_analysis_id is not null then null else v_source_scan.visual_last_error_code end,
            visual_completed_at=case when v_analysis_id is not null then v_source_scan.visual_completed_at else visual_completed_at end,
            updated_at=clock_timestamp()
        where id=v_scan.id;
        v_reused:=v_reused+1;
      else
        update private.content_safety_scans
        set visual_analysis_id=null,visual_status='not_configured',visual_last_error_code='canonical_visual_source_unavailable',updated_at=clock_timestamp()
        where id=v_scan.id;
        v_not_configured:=v_not_configured+1;
      end if;
    elsif v_source->>'kind'='not_applicable' then
      update private.content_safety_scans
      set visual_analysis_id=null,visual_status='not_applicable',visual_video_asset_id=null,visual_media_asset_id=null,
          visual_last_error_code=null,visual_started_at=null,visual_completed_at=null,visual_partial_result=null,updated_at=clock_timestamp()
      where id=v_scan.id;
      v_not_applicable:=v_not_applicable+1;
    else
      update private.content_safety_scans
      set visual_analysis_id=null,visual_status='not_configured',visual_video_asset_id=null,visual_media_asset_id=null,
          visual_last_error_code=coalesce(v_source->>'reason','canonical_visual_source_unavailable'),visual_started_at=null,
          visual_completed_at=null,visual_partial_result=null,updated_at=clock_timestamp()
      where id=v_scan.id;
      v_not_configured:=v_not_configured+1;
    end if;
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object(
    'refreshed',v_count,'pending_provider_sources',v_pending,'shared_reuses',v_reused,
    'not_applicable',v_not_applicable,'not_configured',v_not_configured,
    'private_messages',0,'live_video',0,'marketplace',0
  );
end;
$$;

create or replace function public.claim_content_safety_visual_scans(p_limit integer default 1)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_row record;
  v_result jsonb:='[]'::jsonb;
begin
  if p_limit<1 or p_limit>1 then
    raise exception using errcode='22023',message='invalid_visual_claim_limit';
  end if;
  for v_row in
    select s.id,s.target_id,s.content_fingerprint,s.visual_source_kind,s.visual_video_asset_id,s.visual_media_asset_id,
           s.visual_attempt_count,s.visual_provider_call_count,s.visual_frame_cursor,s.visual_partial_result,
           va.cloudflare_uid,va.duration_seconds,ma.bucket_name,ma.object_key,ma.mime_type,ma.size_bytes
    from private.content_safety_scans s
    left join public.video_assets va on va.id=s.visual_video_asset_id
    left join public.media_assets ma on ma.id=s.visual_media_asset_id
    where s.target_type='video'
      and s.visual_status='pending'
      and s.visual_analysis_id is null
      and s.visual_attempt_count<5
      and s.visual_provider_call_count<5
      and s.visual_available_at<=clock_timestamp()
      and (s.visual_started_at is null or s.visual_started_at<clock_timestamp()-interval '10 minutes')
      and s.id=private.content_safety_visual_producer_scan_id(s.visual_video_asset_id,s.visual_media_asset_id)
      and private.content_safety_visual_analysis_id_for_asset(s.visual_video_asset_id,s.visual_media_asset_id) is null
      and (
        (s.visual_source_kind='eligible_stream_video' and va.provider='cloudflare_stream' and va.status='ready'
          and va.deleted_at is null and va.visibility='public' and va.mime_type like 'video/%'
          and va.duration_seconds>0 and va.duration_seconds<=60 and nullif(btrim(va.cloudflare_uid),'') is not null)
        or
        (s.visual_source_kind='eligible_image' and ma.provider='r2' and ma.status='ready'
          and ma.deleted_at is null and ma.visibility='public' and ma.media_kind='image'
          and ma.mime_type in('image/jpeg','image/png','image/webp') and ma.size_bytes>0 and ma.size_bytes<=10485760
          and nullif(btrim(ma.bucket_name),'') is not null and nullif(btrim(ma.object_key),'') is not null)
      )
    order by s.visual_available_at,s.created_at,s.id
    for update of s skip locked
    limit p_limit
  loop
    update private.content_safety_scans
    set visual_attempt_count=visual_attempt_count+1,
        visual_started_at=clock_timestamp(),
        visual_last_error_code=null,
        updated_at=clock_timestamp()
    where id=v_row.id;
    v_result:=v_result||jsonb_build_array(jsonb_build_object(
      'scan_id',v_row.id,'target_id',v_row.target_id,'content_fingerprint',v_row.content_fingerprint,
      'source_kind',v_row.visual_source_kind,'video_asset_id',v_row.visual_video_asset_id,'media_asset_id',v_row.visual_media_asset_id,
      'cloudflare_uid',v_row.cloudflare_uid,'duration_seconds',v_row.duration_seconds,'bucket_name',v_row.bucket_name,
      'object_key',v_row.object_key,'mime_type',v_row.mime_type,'size_bytes',v_row.size_bytes,
      'frame_cursor',v_row.visual_frame_cursor,'partial_result',v_row.visual_partial_result,
      'attempt_count',v_row.visual_attempt_count+1,'provider_call_count',v_row.visual_provider_call_count
    ));
  end loop;
  return v_result;
end;
$$;

create or replace function public.complete_content_safety_visual_analysis(
  p_scan_id uuid,
  p_content_fingerprint text,
  p_analysis_result jsonb,
  p_analysis_fingerprint text,
  p_frame_timestamps_ms integer[]
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_scan private.content_safety_scans;
  v_analysis private.content_safety_visual_analyses;
  v_finding jsonb;
  v_provider_calls integer;
  v_frame_count integer;
  v_strategy text;
  v_existing_id uuid;
  v_producer_id uuid;
  v_attach jsonb;
  v_inserted boolean:=false;
begin
  select * into v_scan from private.content_safety_scans where id=p_scan_id for update;
  if not found then
    raise exception using errcode='P0002',message='content_safety_visual_scan_not_found';
  end if;
  v_strategy:=case when v_scan.visual_source_kind='eligible_image' then 'single_image_v1' else 'percentile_5_v1' end;
  v_existing_id:=private.content_safety_visual_analysis_id_for_asset(v_scan.visual_video_asset_id,v_scan.visual_media_asset_id);
  v_provider_calls:=v_scan.visual_provider_call_count+1;

  if v_existing_id is not null then
    update private.content_safety_scans
    set visual_provider_call_count=v_provider_calls,visual_started_at=null,updated_at=clock_timestamp()
    where id=v_scan.id;
    v_attach:=private.content_safety_attach_visual_analysis(v_existing_id);
    return jsonb_build_object(
      'scan_id',v_scan.id,'analysis_id',v_existing_id,'visual_status','analyzed',
      'alerts_processed',coalesce((v_attach->>'alerts_processed')::integer,0),
      'provider_call_count',v_provider_calls,'race_reused',true
    );
  end if;

  v_producer_id:=private.content_safety_visual_producer_scan_id(v_scan.visual_video_asset_id,v_scan.visual_media_asset_id);
  v_frame_count:=case when v_scan.visual_source_kind='eligible_image' then 1 else cardinality(p_frame_timestamps_ms) end;
  if v_scan.target_type<>'video' or v_scan.id is distinct from v_producer_id or v_scan.visual_status<>'pending'
     or v_scan.content_fingerprint<>p_content_fingerprint
     or v_scan.visual_source_kind not in('eligible_image','eligible_stream_video') or v_provider_calls not between 1 and 5
     or p_analysis_fingerprint!~'^[0-9a-f]{64}$' or jsonb_typeof(p_analysis_result)<>'object' or pg_column_size(p_analysis_result)>32768
     or p_analysis_result->>'schema_version'<>'visual-safety-v1' or jsonb_typeof(p_analysis_result->'review_required')<>'boolean'
     or jsonb_typeof(p_analysis_result->'findings')<>'array' or jsonb_array_length(p_analysis_result->'findings')>10
     or jsonb_typeof(p_analysis_result->'summary')<>'string' or char_length(p_analysis_result->>'summary')>500
     or (v_scan.visual_source_kind='eligible_image' and cardinality(p_frame_timestamps_ms)<>0)
     or (v_scan.visual_source_kind='eligible_stream_video' and (v_frame_count<1 or v_frame_count>5 or v_scan.visual_frame_cursor<>v_frame_count-1))
     or ((p_analysis_result->>'review_required')::boolean and jsonb_array_length(p_analysis_result->'findings')=0)
     or (not (p_analysis_result->>'review_required')::boolean and jsonb_array_length(p_analysis_result->'findings')<>0) then
    raise exception using errcode='22023',message='invalid_content_safety_visual_completion';
  end if;
  if exists(
       select 1 from unnest(p_frame_timestamps_ms) with ordinality a(value,pos)
       join unnest(p_frame_timestamps_ms) with ordinality b(value,pos) on b.pos=a.pos+1
       where b.value<=a.value
     ) or exists(select 1 from unnest(p_frame_timestamps_ms) x where x<0) then
    raise exception using errcode='22023',message='invalid_visual_frame_timestamps';
  end if;
  for v_finding in select value from jsonb_array_elements(p_analysis_result->'findings') loop
    if jsonb_typeof(v_finding)<>'object' or (select count(*) from jsonb_object_keys(v_finding))<>4
       or not(v_finding?'category' and v_finding?'triage_level' and v_finding?'description' and v_finding?'frame_index')
       or v_finding->>'category' not in('violence','threat','sexual','self_harm','drugs','weapons','fraud','spam','other')
       or v_finding->>'triage_level' not in('low','medium','high','critical') or char_length(v_finding->>'description')>240
       or (v_scan.visual_source_kind='eligible_image' and jsonb_typeof(v_finding->'frame_index')<>'null')
       or (v_scan.visual_source_kind='eligible_stream_video' and (
         jsonb_typeof(v_finding->'frame_index')<>'number' or (v_finding->>'frame_index')::integer<0 or (v_finding->>'frame_index')::integer>=v_frame_count
       )) then
      raise exception using errcode='22023',message='invalid_content_safety_visual_finding';
    end if;
  end loop;

  insert into private.content_safety_visual_analyses(
    source_scan_id,video_asset_id,media_asset_id,source_content_fingerprint,provider,model,prompt_version,
    sample_strategy,frame_count,frame_timestamps_ms,analysis_result,analysis_fingerprint,provider_call_count
  ) values(
    v_scan.id,v_scan.visual_video_asset_id,v_scan.visual_media_asset_id,v_scan.content_fingerprint,
    'cloudflare_workers_ai','@cf/google/gemma-4-26b-a4b-it','visual-safety-v1',v_strategy,
    v_frame_count,p_frame_timestamps_ms,p_analysis_result,p_analysis_fingerprint,v_provider_calls
  )
  on conflict do nothing
  returning * into v_analysis;

  if v_analysis.id is null then
    v_existing_id:=private.content_safety_visual_analysis_id_for_asset(v_scan.visual_video_asset_id,v_scan.visual_media_asset_id);
    if v_existing_id is null then
      raise exception using errcode='23505',message='content_safety_visual_analysis_race_unresolved';
    end if;
    select * into v_analysis from private.content_safety_visual_analyses where id=v_existing_id;
  else
    v_inserted:=true;
  end if;

  update private.content_safety_scans
  set visual_provider_call_count=v_provider_calls,
      visual_frame_cursor=v_frame_count,
      visual_started_at=null,
      updated_at=clock_timestamp()
  where id=v_scan.id;
  v_attach:=private.content_safety_attach_visual_analysis(v_analysis.id);
  return jsonb_build_object(
    'scan_id',v_scan.id,'analysis_id',v_analysis.id,'visual_status','analyzed',
    'alerts_processed',coalesce((v_attach->>'alerts_processed')::integer,0),
    'provider_call_count',v_provider_calls,'frame_count',v_frame_count,'race_reused',not v_inserted
  );
end;
$$;

create or replace function public.fail_content_safety_visual_scan(
  p_scan_id uuid,
  p_error_code text,
  p_retryable boolean default true,
  p_provider_called boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_scan private.content_safety_scans;
  v_producer_id uuid;
  v_calls integer;
  v_retry boolean;
  v_error text;
  v_frames_remaining integer;
  v_next timestamptz;
begin
  select * into v_scan from private.content_safety_scans where id=p_scan_id for update;
  if not found then
    raise exception using errcode='P0002',message='content_safety_visual_scan_not_found';
  end if;
  if v_scan.visual_analysis_id is not null then
    perform private.content_safety_attach_visual_analysis(v_scan.visual_analysis_id);
    return jsonb_build_object('scan_id',v_scan.id,'visual_status','analyzed','reused',true,'provider_call_count',v_scan.visual_provider_call_count);
  end if;
  v_producer_id:=private.content_safety_visual_producer_scan_id(v_scan.visual_video_asset_id,v_scan.visual_media_asset_id);
  if v_scan.id is distinct from v_producer_id then
    raise exception using errcode='55000',message='content_safety_visual_not_canonical_producer';
  end if;
  v_calls:=v_scan.visual_provider_call_count+case when coalesce(p_provider_called,false) then 1 else 0 end;
  v_frames_remaining:=case when v_scan.visual_source_kind='eligible_stream_video' then 5-v_scan.visual_frame_cursor else 1 end;
  v_retry:=coalesce(p_retryable,false) and v_scan.visual_attempt_count<5 and v_calls<5
    and (v_scan.visual_source_kind='eligible_image' or v_calls+v_frames_remaining<=5);
  v_error:=left(lower(regexp_replace(coalesce(nullif(btrim(p_error_code),''),'visual_processing_error'),'[^a-z0-9_]+','_','g')),100);
  v_next:=case when v_retry then clock_timestamp()+least(30,power(2,greatest(v_scan.visual_attempt_count,1)))::integer*interval '1 minute' else v_scan.visual_available_at end;

  update private.content_safety_scans s
  set visual_status=case when v_retry then 'pending' else 'failed' end,
      visual_provider_call_count=case when s.id=v_scan.id then v_calls else s.visual_provider_call_count end,
      visual_available_at=v_next,
      visual_started_at=null,
      visual_completed_at=case when v_retry then null else clock_timestamp() end,
      visual_last_error_code=v_error,
      updated_at=clock_timestamp()
  where s.target_type='video'
    and (
      (v_scan.visual_media_asset_id is not null and s.visual_media_asset_id=v_scan.visual_media_asset_id and s.visual_source_kind='eligible_image')
      or
      (v_scan.visual_video_asset_id is not null and s.visual_video_asset_id=v_scan.visual_video_asset_id and s.visual_source_kind='eligible_stream_video')
    );

  update private.content_safety_scans st
  set visual_status=case when v_retry then 'pending' else 'failed' end,
      visual_started_at=null,
      visual_completed_at=case when v_retry then null else clock_timestamp() end,
      visual_last_error_code=v_error,
      updated_at=clock_timestamp()
  where st.target_type='story'
    and exists(
      select 1 from private.content_safety_scans src
      where src.id=st.media_source_scan_id
        and (
          (v_scan.visual_media_asset_id is not null and src.visual_media_asset_id=v_scan.visual_media_asset_id)
          or
          (v_scan.visual_video_asset_id is not null and src.visual_video_asset_id=v_scan.visual_video_asset_id)
        )
    );

  return jsonb_build_object(
    'scan_id',v_scan.id,'visual_status',case when v_retry then 'pending' else 'failed' end,
    'retryable',v_retry,'provider_call_count',v_calls,'canonical_producer',true
  );
end;
$$;

create or replace function public.search_admin_content_safety_visual()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  perform public.admin_require_capability('content.items.read');
  return (
    with latest as(
      select distinct on(s.target_type,s.target_id) s.*
      from private.content_safety_scans s
      where s.target_type in('video','story')
      order by s.target_type,s.target_id,s.created_at desc,s.id desc
    ), rows as(
      select s.*,
             case when s.target_type='story' then coalesce(s.media_source_scan_id,s.id) else s.id end alert_scan_id,
             a.id analysis_id,a.source_scan_id analysis_source_scan_id,a.frame_count,a.frame_timestamps_ms,a.analysis_result,
             a.analysis_fingerprint,a.provider_call_count analysis_provider_calls,snap.value snapshot,
             up.username,up.display_name,up.avatar_url,analysis_src.target_id source_target_id
      from latest s
      left join private.content_safety_visual_analyses a on a.id=s.visual_analysis_id
      left join private.content_safety_scans analysis_src on analysis_src.id=a.source_scan_id
      left join public.user_profiles up on up.id=s.owner_user_id
      left join lateral(select private.content_safety_target_snapshot(s.target_type,s.target_id) value) snap on true
    )
    select jsonb_build_object(
      'provider',jsonb_build_object(
        'configured',true,'name','Cloudflare Workers AI','model','@cf/google/gemma-4-26b-a4b-it','prompt_version','visual-safety-v1',
        'status',case
          when exists(select 1 from private.content_safety_visual_analyses) then 'healthy'
          when exists(select 1 from private.content_safety_scans where visual_last_error_code in('visual_workers_ai_unauthorized','visual_workers_ai_forbidden','visual_workers_ai_model_unavailable')) then 'error'
          else 'awaiting_smoke' end,
        'last_success_at',(select max(created_at) from private.content_safety_visual_analyses),
        'last_error_code',(select visual_last_error_code from private.content_safety_scans where visual_last_error_code is not null order by updated_at desc limit 1)
      ),
      'stats',jsonb_build_object(
        'eligible',(select count(*) from rows where visual_status in('pending','analyzed','failed')),
        'pending',(select count(*) from rows where visual_status='pending'),
        'analyzed',(select count(*) from rows where visual_status='analyzed'),
        'failed',(select count(*) from rows where visual_status='failed'),
        'not_applicable',(select count(*) from rows where visual_status='not_applicable'),
        'not_configured',(select count(*) from rows where visual_status='not_configured'),
        'image_analyses',(select count(*) from private.content_safety_visual_analyses where media_asset_id is not null),
        'video_analyses',(select count(*) from private.content_safety_visual_analyses where video_asset_id is not null),
        'frames',(select coalesce(sum(frame_count),0) from private.content_safety_visual_analyses),
        'provider_calls',(select coalesce(sum(provider_call_count),0) from private.content_safety_visual_analyses),
        'visual_alerts',(select count(*) from private.content_safety_alerts where source_type='visual_classifier')
      ),
      'items',coalesce((
        select jsonb_agg(jsonb_build_object(
          'scan_id',r.id,'target_type',r.target_type,'target_id',r.target_id,
          'content_path',r.snapshot->>'path','summary',r.snapshot->>'summary',
          'author',jsonb_build_object('id',r.owner_user_id,'username',r.username,'display_name',r.display_name,'avatar_url',r.avatar_url),
          'visual_status',r.visual_status,'source_kind',r.visual_source_kind,'provider',r.visual_provider,'model',r.visual_model,
          'frame_count',r.frame_count,'findings_count',coalesce(jsonb_array_length(r.analysis_result->'findings'),0),
          'alert_count',(select count(*) from private.content_safety_alerts al where al.scan_id=r.alert_scan_id and al.source_type='visual_classifier'),
          'source_reused',(r.media_source_scan_id is not null or (r.analysis_source_scan_id is not null and r.analysis_source_scan_id<>r.id)),
          'source_scan_id',coalesce(r.media_source_scan_id,r.analysis_source_scan_id),
          'source_target_id',r.source_target_id,'visual_analysis_id',r.analysis_id,
          'processed_at',r.visual_completed_at,'last_error_code',r.visual_last_error_code
        ) order by r.created_at desc,r.id desc)
        from rows r
      ),'[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.get_admin_content_safety_visual_detail(p_scan_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_result jsonb;
begin
  perform public.admin_require_capability('content.items.read');
  select jsonb_build_object(
    'scan_id',s.id,'target_type',s.target_type,'target_id',s.target_id,
    'content',jsonb_build_object('path',snap.value->>'path','summary',snap.value->>'summary'),
    'author',jsonb_build_object('id',s.owner_user_id,'username',up.username,'display_name',up.display_name,'avatar_url',up.avatar_url),
    'visual_status',s.visual_status,'provider',s.visual_provider,'model',s.visual_model,
    'prompt_version',s.visual_prompt_version,'source_kind',s.visual_source_kind,
    'source_reused',(s.media_source_scan_id is not null or (a.source_scan_id is not null and a.source_scan_id<>s.id)),
    'source_scan_id',coalesce(s.media_source_scan_id,a.source_scan_id),'source_target_id',analysis_src.target_id,
    'visual_analysis_id',s.visual_analysis_id,'video_asset_id',s.visual_video_asset_id,'media_asset_id',s.visual_media_asset_id,
    'attempts',s.visual_attempt_count,'last_error_code',s.visual_last_error_code,'completed_at',s.visual_completed_at,
    'analysis',case when a.id is null then null else jsonb_build_object(
      'id',a.id,'sample_strategy',a.sample_strategy,'frame_count',a.frame_count,
      'frame_timestamps_ms',a.frame_timestamps_ms,'summary',a.analysis_result->>'summary',
      'review_required',(a.analysis_result->>'review_required')::boolean,'findings',a.analysis_result->'findings',
      'fingerprint',a.analysis_fingerprint,'provider_calls',a.provider_call_count,'created_at',a.created_at
    ) end,
    'alerts',(
      select coalesce(jsonb_agg(jsonb_build_object('id',al.id,'category',al.category,'severity',al.severity,'status',al.status) order by al.created_at,al.id),'[]'::jsonb)
      from private.content_safety_alerts al
      where al.scan_id=case when s.target_type='story' then coalesce(s.media_source_scan_id,s.id) else s.id end
        and al.source_type='visual_classifier'
    ),
    'shared_references',(
      select coalesce(jsonb_agg(jsonb_build_object('id',st.id,'path','/stories/'||st.id::text) order by st.created_at,st.id),'[]'::jsonb)
      from public.stories st
      where st.shared_video_id=coalesce(analysis_src.target_id,s.target_id)
    )
  ) into v_result
  from private.content_safety_scans s
  left join private.content_safety_visual_analyses a on a.id=s.visual_analysis_id
  left join private.content_safety_scans analysis_src on analysis_src.id=a.source_scan_id
  left join public.user_profiles up on up.id=s.owner_user_id
  left join lateral(select private.content_safety_target_snapshot(s.target_type,s.target_id) value) snap on true
  where s.id=p_scan_id;
  if v_result is null then
    raise exception using errcode='P0002',message='content_safety_visual_not_found';
  end if;
  return v_result;
end;
$$;

create or replace function public.admin_retry_content_safety_visual(p_scan_id uuid,p_idempotency_key uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid;
  v_requested private.content_safety_scans;
  v_scan private.content_safety_scans;
  v_producer_id uuid;
  v_analysis_id uuid;
  v_scope text;
  v_fingerprint text;
  v_existing private.admin_action_audit;
  v_metadata jsonb;
begin
  v_actor:=public.admin_require_capability('content.items.moderate');
  v_scope:='v1|human|'||v_actor::text||'|content.items.moderate|content_safety.visual.retry';
  v_fingerprint:=private.content_safety_sha256(jsonb_build_object('scan_id',p_scan_id)::text);
  select * into v_existing
  from private.admin_action_audit
  where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='admin_idempotency_conflict';
    end if;
    return v_existing.metadata||jsonb_build_object('idempotent',true);
  end if;

  select * into v_requested from private.content_safety_scans where id=p_scan_id for update;
  if not found then
    raise exception using errcode='P0002',message='content_safety_visual_not_found';
  end if;
  if v_requested.target_type='story' and v_requested.media_source_scan_id is not null then
    select * into v_scan from private.content_safety_scans where id=v_requested.media_source_scan_id for update;
  else
    v_scan:=v_requested;
  end if;

  v_analysis_id:=coalesce(
    v_scan.visual_analysis_id,
    private.content_safety_visual_analysis_id_for_asset(v_scan.visual_video_asset_id,v_scan.visual_media_asset_id)
  );
  if v_analysis_id is not null then
    perform private.content_safety_attach_visual_analysis(v_analysis_id);
    v_metadata:=jsonb_build_object('scan_id',p_scan_id,'visual_status','analyzed','visual_analysis_id',v_analysis_id,'reused',true,'provider_calls',0);
  else
    v_producer_id:=private.content_safety_visual_producer_scan_id(v_scan.visual_video_asset_id,v_scan.visual_media_asset_id);
    if v_producer_id is null then
      raise exception using errcode='55000',message='content_safety_visual_canonical_producer_missing';
    end if;
    select * into v_scan from private.content_safety_scans where id=v_producer_id for update;
    if v_scan.visual_status<>'failed' then
      raise exception using errcode='55000',message='content_safety_visual_not_failed';
    end if;

    update private.content_safety_scans s
    set visual_status='pending',
        visual_attempt_count=case when s.id=v_producer_id then 0 else s.visual_attempt_count end,
        visual_provider_call_count=case when s.id=v_producer_id then 0 else s.visual_provider_call_count end,
        visual_frame_cursor=case when s.id=v_producer_id then 0 else s.visual_frame_cursor end,
        visual_partial_result=null,
        visual_available_at=clock_timestamp(),
        visual_started_at=null,
        visual_completed_at=null,
        visual_last_error_code=null,
        updated_at=clock_timestamp()
    where s.target_type='video'
      and (
        (v_scan.visual_media_asset_id is not null and s.visual_media_asset_id=v_scan.visual_media_asset_id and s.visual_source_kind='eligible_image')
        or
        (v_scan.visual_video_asset_id is not null and s.visual_video_asset_id=v_scan.visual_video_asset_id and s.visual_source_kind='eligible_stream_video')
      );
    update private.content_safety_scans st
    set visual_status='pending',visual_started_at=null,visual_completed_at=null,visual_last_error_code=null,updated_at=clock_timestamp()
    where st.target_type='story'
      and exists(
        select 1 from private.content_safety_scans src
        where src.id=st.media_source_scan_id
          and (
            (v_scan.visual_media_asset_id is not null and src.visual_media_asset_id=v_scan.visual_media_asset_id)
            or
            (v_scan.visual_video_asset_id is not null and src.visual_video_asset_id=v_scan.visual_video_asset_id)
          )
      );
    v_metadata:=jsonb_build_object('scan_id',v_producer_id,'visual_status','pending','reused',false,'provider_calls',0);
  end if;

  insert into private.admin_action_audit(
    actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,target_id,target_ref,
    outcome,reason,financial_effect,contains_pii,idempotency_scope,idempotency_key,request_fingerprint,metadata
  ) values(
    v_actor,'human_admin',private.admin_active_role_codes(v_actor),'content.items.moderate','content_safety',
    'content_safety.visual.retry','content_safety_scan',p_scan_id,p_scan_id::text,
    'succeeded',null,false,false,v_scope,p_idempotency_key,v_fingerprint,v_metadata
  );
  return v_metadata||jsonb_build_object('idempotent',false);
end;
$$;

revoke all on function private.content_safety_visual_analysis_id_for_asset(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.content_safety_visual_producer_scan_id(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.content_safety_create_visual_alerts_for_scan(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.content_safety_attach_visual_analysis(uuid) from public,anon,authenticated,service_role;

revoke all on function public.refresh_content_safety_visual_eligibility(integer,uuid) from public,anon,authenticated,service_role;
revoke all on function public.claim_content_safety_visual_scans(integer) from public,anon,authenticated,service_role;
revoke all on function public.complete_content_safety_visual_analysis(uuid,text,jsonb,text,integer[]) from public,anon,authenticated,service_role;
revoke all on function public.fail_content_safety_visual_scan(uuid,text,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function public.refresh_content_safety_visual_eligibility(integer,uuid) to service_role;
grant execute on function public.claim_content_safety_visual_scans(integer) to service_role;
grant execute on function public.complete_content_safety_visual_analysis(uuid,text,jsonb,text,integer[]) to service_role;
grant execute on function public.fail_content_safety_visual_scan(uuid,text,boolean,boolean) to service_role;

revoke all on function public.search_admin_content_safety_visual() from public,anon,authenticated,service_role;
revoke all on function public.get_admin_content_safety_visual_detail(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_retry_content_safety_visual(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.search_admin_content_safety_visual() to authenticated;
grant execute on function public.get_admin_content_safety_visual_detail(uuid) to authenticated;
grant execute on function public.admin_retry_content_safety_visual(uuid,uuid) to authenticated;

comment on column private.content_safety_scans.visual_analysis_id is
  'Explicit effective asset-level Visual AI analysis. Shared references reuse this ID and never imply a provider call.';
comment on function private.content_safety_visual_producer_scan_id(uuid,uuid) is
  'Deterministically selects one provider producer scan per immutable canonical asset.';
comment on function public.complete_content_safety_visual_analysis(uuid,text,jsonb,text,integer[]) is
  'Persists at most one analysis per canonical asset/model/prompt/strategy, propagates reuse, and creates target-specific review signals only.';

commit;
