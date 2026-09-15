begin;

-- F7 extends the canonical Content Safety scan queue. Applying this migration
-- is deliberately inert: visual provider work starts only through the
-- service-only refresh RPC after the Edge worker and provider probe pass.

alter table private.content_safety_scans
  add column visual_provider text null,
  add column visual_model text null,
  add column visual_prompt_version text null,
  add column visual_source_kind text null,
  add column visual_video_asset_id uuid null references public.video_assets(id) on update restrict on delete set null,
  add column visual_media_asset_id uuid null references public.media_assets(id) on update restrict on delete set null,
  add column visual_attempt_count integer not null default 0,
  add column visual_available_at timestamptz not null default clock_timestamp(),
  add column visual_started_at timestamptz null,
  add column visual_completed_at timestamptz null,
  add column visual_last_error_code text null,
  add column visual_provider_call_count integer not null default 0,
  add column visual_frame_cursor integer not null default 0,
  add column visual_partial_result jsonb null;

alter table private.content_safety_scans
  add constraint content_safety_scans_visual_provider_check check(visual_provider is null or visual_provider='cloudflare_workers_ai'),
  add constraint content_safety_scans_visual_model_check check(visual_model is null or visual_model='@cf/google/gemma-4-26b-a4b-it'),
  add constraint content_safety_scans_visual_prompt_check check(visual_prompt_version is null or visual_prompt_version='visual-safety-v1'),
  add constraint content_safety_scans_visual_kind_check check(visual_source_kind is null or visual_source_kind in('eligible_image','eligible_stream_video','shared_image','shared_stream_video')),
  add constraint content_safety_scans_visual_asset_check check(not(visual_video_asset_id is not null and visual_media_asset_id is not null)),
  add constraint content_safety_scans_visual_attempt_check check(visual_attempt_count between 0 and 5),
  add constraint content_safety_scans_visual_calls_check check(visual_provider_call_count between 0 and 5),
  add constraint content_safety_scans_visual_cursor_check check(visual_frame_cursor between 0 and 5),
  add constraint content_safety_scans_visual_error_check check(visual_last_error_code is null or (visual_last_error_code=btrim(visual_last_error_code) and char_length(visual_last_error_code) between 2 and 100)),
  add constraint content_safety_scans_visual_partial_check check(visual_partial_result is null or (jsonb_typeof(visual_partial_result)='object' and pg_column_size(visual_partial_result)<=32768)),
  add constraint content_safety_scans_visual_timestamps_check check((visual_started_at is null or visual_started_at>=created_at) and (visual_completed_at is null or visual_completed_at>=created_at));

create table private.content_safety_visual_analyses (
  id uuid primary key default gen_random_uuid(),
  source_scan_id uuid not null references private.content_safety_scans(id) on update restrict on delete restrict,
  video_asset_id uuid null references public.video_assets(id) on update restrict on delete restrict,
  media_asset_id uuid null references public.media_assets(id) on update restrict on delete restrict,
  source_content_fingerprint text not null,
  provider text not null,
  model text not null,
  prompt_version text not null,
  sample_strategy text not null,
  frame_count integer not null,
  frame_timestamps_ms integer[] not null default '{}',
  analysis_result jsonb not null,
  analysis_fingerprint text not null,
  provider_call_count integer not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint content_safety_visual_analyses_asset_check check((video_asset_id is not null)::integer+(media_asset_id is not null)::integer=1),
  constraint content_safety_visual_analyses_source_fingerprint_check check(source_content_fingerprint~'^[0-9a-f]{64}$'),
  constraint content_safety_visual_analyses_provider_check check(provider='cloudflare_workers_ai'),
  constraint content_safety_visual_analyses_model_check check(model='@cf/google/gemma-4-26b-a4b-it'),
  constraint content_safety_visual_analyses_prompt_check check(prompt_version='visual-safety-v1'),
  constraint content_safety_visual_analyses_strategy_check check(sample_strategy in('single_image_v1','percentile_5_v1')),
  constraint content_safety_visual_analyses_frame_count_check check((media_asset_id is not null and frame_count=1 and cardinality(frame_timestamps_ms)=0) or (video_asset_id is not null and frame_count between 1 and 5 and cardinality(frame_timestamps_ms)=frame_count)),
  constraint content_safety_visual_analyses_timestamps_check check(0<=all(frame_timestamps_ms)),
  constraint content_safety_visual_analyses_result_check check(jsonb_typeof(analysis_result)='object' and pg_column_size(analysis_result)<=32768),
  constraint content_safety_visual_analyses_fingerprint_check check(analysis_fingerprint~'^[0-9a-f]{64}$'),
  constraint content_safety_visual_analyses_provider_calls_check check(provider_call_count between 1 and 5),
  constraint content_safety_visual_analyses_updated_check check(updated_at>=created_at),
  unique(source_scan_id,source_content_fingerprint,provider,model,prompt_version,sample_strategy)
);

create index content_safety_scans_visual_queue_idx on private.content_safety_scans(visual_available_at,created_at,id)
  where target_type='video' and visual_status='pending';
create index content_safety_scans_visual_video_asset_idx on private.content_safety_scans(visual_video_asset_id) where visual_video_asset_id is not null;
create index content_safety_scans_visual_media_asset_idx on private.content_safety_scans(visual_media_asset_id) where visual_media_asset_id is not null;
create index content_safety_visual_analyses_source_scan_idx on private.content_safety_visual_analyses(source_scan_id,created_at desc,id desc);
create index content_safety_visual_analyses_video_asset_idx on private.content_safety_visual_analyses(video_asset_id) where video_asset_id is not null;
create index content_safety_visual_analyses_media_asset_idx on private.content_safety_visual_analyses(media_asset_id) where media_asset_id is not null;

alter table private.content_safety_visual_analyses enable row level security;
revoke all privileges on table private.content_safety_visual_analyses from public,anon,authenticated,service_role;

create function private.content_safety_visual_source(p_target_type text,p_target_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_video public.video_assets;v_media public.media_assets;v_shared uuid;v_source jsonb;v_has_link boolean:=false;
begin
  if p_target_type='video' then
    select a.* into v_video from public.video_asset_links l join public.video_assets a on a.id=l.asset_id
      where l.entity_type='video_post' and l.entity_id=p_target_id and l.slot='video' and l.position=0
      order by l.created_at,l.id limit 1;
    if found then
      v_has_link:=true;
      if v_video.provider='cloudflare_stream' and v_video.status='ready' and v_video.deleted_at is null and v_video.visibility='public'
         and nullif(btrim(v_video.cloudflare_uid),'') is not null and v_video.mime_type like 'video/%'
         and v_video.duration_seconds>0 and v_video.duration_seconds<=60 then
        return jsonb_build_object('kind','eligible_stream_video','video_asset_id',v_video.id,'cloudflare_uid',v_video.cloudflare_uid,
          'duration_seconds',v_video.duration_seconds,'mime_type',v_video.mime_type);
      end if;
    end if;
    select a.* into v_media from public.media_asset_links l join public.media_assets a on a.id=l.asset_id
      where l.entity_type='video_post' and l.entity_id=p_target_id and l.slot='media' and l.position=0
      order by l.created_at,l.id limit 1;
    if found then
      v_has_link:=true;
      if v_media.provider='r2' and v_media.status='ready' and v_media.deleted_at is null and v_media.visibility='public'
         and v_media.media_kind='image' and v_media.mime_type in('image/jpeg','image/png','image/webp')
         and nullif(btrim(v_media.bucket_name),'') is not null and nullif(btrim(v_media.object_key),'') is not null
         and v_media.size_bytes>0 and v_media.size_bytes<=10485760 then
        return jsonb_build_object('kind','eligible_image','media_asset_id',v_media.id,'bucket_name',v_media.bucket_name,
          'object_key',v_media.object_key,'mime_type',v_media.mime_type,'size_bytes',v_media.size_bytes);
      end if;
      if v_media.media_kind='image' then return jsonb_build_object('kind','not_configured','reason','unsupported_visual_media');end if;
    end if;
    return jsonb_build_object('kind','not_configured','reason',case when v_has_link then 'canonical_visual_source_unavailable' else 'canonical_visual_source_unavailable' end);
  elsif p_target_type='story' then
    select s.shared_video_id into v_shared from public.stories s where s.id=p_target_id;
    if not found then return jsonb_build_object('kind','not_configured','reason','canonical_visual_source_unavailable');end if;
    if v_shared is not null then
      v_source:=private.content_safety_visual_source('video',v_shared);
      return v_source||jsonb_build_object('kind',case v_source->>'kind' when 'eligible_image' then 'shared_image' when 'eligible_stream_video' then 'shared_stream_video' else v_source->>'kind' end,'shared_video_id',v_shared);
    end if;
    return jsonb_build_object('kind','not_configured','reason','canonical_visual_source_unavailable');
  end if;
  return jsonb_build_object('kind','not_applicable','reason','text_only_or_private_target');
end;
$$;

create function public.refresh_content_safety_visual_eligibility(p_limit integer default 100,p_target_id uuid default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_scan private.content_safety_scans;v_source jsonb;v_source_scan private.content_safety_scans;v_analysis private.content_safety_visual_analyses;
  v_count integer:=0;v_pending integer:=0;v_reused integer:=0;v_not_applicable integer:=0;v_not_configured integer:=0;
begin
  if p_limit<1 or p_limit>500 then raise exception using errcode='22023',message='invalid_visual_eligibility_limit';end if;
  for v_scan in select * from private.content_safety_scans s
    where s.target_type in('video','story') and (p_target_id is null or s.target_id=p_target_id)
    order by case when s.target_type='video' then 0 else 1 end,s.created_at,s.id limit p_limit
  loop
    v_source:=private.content_safety_visual_source(v_scan.target_type,v_scan.target_id);
    if v_scan.target_type='video' and v_source->>'kind' in('eligible_image','eligible_stream_video') then
      select * into v_analysis from private.content_safety_visual_analyses a
        where a.source_scan_id=v_scan.id and a.source_content_fingerprint=v_scan.content_fingerprint
          and a.provider='cloudflare_workers_ai' and a.model='@cf/google/gemma-4-26b-a4b-it' and a.prompt_version='visual-safety-v1'
          and a.sample_strategy=case when v_source->>'kind'='eligible_image' then 'single_image_v1' else 'percentile_5_v1' end limit 1;
      update private.content_safety_scans set visual_provider='cloudflare_workers_ai',visual_model='@cf/google/gemma-4-26b-a4b-it',visual_prompt_version='visual-safety-v1',
        visual_source_kind=v_source->>'kind',visual_video_asset_id=case when v_source->>'video_asset_id' is null then null else (v_source->>'video_asset_id')::uuid end,
        visual_media_asset_id=case when v_source->>'media_asset_id' is null then null else (v_source->>'media_asset_id')::uuid end,
        visual_status=case when v_analysis.id is null then 'pending' else 'analyzed' end,
        visual_available_at=case when v_analysis.id is null then clock_timestamp() else visual_available_at end,
        visual_started_at=null,visual_completed_at=case when v_analysis.id is null then null else v_analysis.created_at end,
        visual_last_error_code=null,visual_frame_cursor=case when v_analysis.id is null then 0 else v_analysis.frame_count end,
        visual_partial_result=null,updated_at=clock_timestamp() where id=v_scan.id;
      if v_analysis.id is null then v_pending:=v_pending+1;end if;
    elsif v_scan.target_type='story' and v_source->>'kind' in('shared_image','shared_stream_video') then
      select * into v_source_scan from private.content_safety_scans s where s.target_type='video' and s.target_id=(v_source->>'shared_video_id')::uuid
        order by s.created_at desc,s.id desc limit 1;
      if found then
        update private.content_safety_scans set media_source_scan_id=v_source_scan.id,visual_provider=v_source_scan.visual_provider,visual_model=v_source_scan.visual_model,
          visual_prompt_version=v_source_scan.visual_prompt_version,visual_source_kind=v_source->>'kind',visual_video_asset_id=v_source_scan.visual_video_asset_id,
          visual_media_asset_id=v_source_scan.visual_media_asset_id,visual_status=v_source_scan.visual_status,visual_last_error_code=v_source_scan.visual_last_error_code,
          visual_completed_at=v_source_scan.visual_completed_at,updated_at=clock_timestamp() where id=v_scan.id;
        v_reused:=v_reused+1;
      else
        update private.content_safety_scans set visual_status='not_configured',visual_last_error_code='canonical_visual_source_unavailable',updated_at=clock_timestamp() where id=v_scan.id;
        v_not_configured:=v_not_configured+1;
      end if;
    elsif v_source->>'kind'='not_applicable' then
      update private.content_safety_scans set visual_status='not_applicable',visual_video_asset_id=null,visual_media_asset_id=null,visual_last_error_code=null,
        visual_started_at=null,visual_completed_at=null,visual_partial_result=null,updated_at=clock_timestamp() where id=v_scan.id;
      v_not_applicable:=v_not_applicable+1;
    else
      update private.content_safety_scans set visual_status='not_configured',visual_video_asset_id=null,visual_media_asset_id=null,
        visual_last_error_code=coalesce(v_source->>'reason','canonical_visual_source_unavailable'),visual_started_at=null,visual_completed_at=null,
        visual_partial_result=null,updated_at=clock_timestamp() where id=v_scan.id;
      v_not_configured:=v_not_configured+1;
    end if;
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('refreshed',v_count,'pending_provider_sources',v_pending,'shared_reuses',v_reused,
    'not_applicable',v_not_applicable,'not_configured',v_not_configured,'private_messages',0,'live_video',0,'marketplace',0);
end;
$$;

create function private.initialize_content_safety_visual_for_new_scan()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  -- The first production analysis is the durable activation marker.
  if exists(select 1 from private.content_safety_visual_analyses) and new.target_type in('video','story') then
    perform public.refresh_content_safety_visual_eligibility(1,new.target_id);
  end if;
  return new;
end;
$$;

create trigger content_safety_visual_initialize_new_scan after insert on private.content_safety_scans
for each row execute function private.initialize_content_safety_visual_for_new_scan();

create function public.claim_content_safety_visual_scans(p_limit integer default 1)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_row record;v_result jsonb:='[]'::jsonb;
begin
  if p_limit<1 or p_limit>1 then raise exception using errcode='22023',message='invalid_visual_claim_limit';end if;
  for v_row in select s.id,s.target_id,s.content_fingerprint,s.visual_source_kind,s.visual_video_asset_id,s.visual_media_asset_id,
      s.visual_attempt_count,s.visual_provider_call_count,s.visual_frame_cursor,s.visual_partial_result,
      va.cloudflare_uid,va.duration_seconds,ma.bucket_name,ma.object_key,ma.mime_type,ma.size_bytes
    from private.content_safety_scans s
    left join public.video_assets va on va.id=s.visual_video_asset_id
    left join public.media_assets ma on ma.id=s.visual_media_asset_id
    where s.target_type='video' and s.visual_status='pending' and s.visual_attempt_count<5 and s.visual_provider_call_count<5
      and s.visual_available_at<=clock_timestamp() and (s.visual_started_at is null or s.visual_started_at<clock_timestamp()-interval '10 minutes')
      and ((s.visual_source_kind='eligible_stream_video' and va.provider='cloudflare_stream' and va.status='ready' and va.deleted_at is null and va.visibility='public'
        and va.mime_type like 'video/%' and va.duration_seconds>0 and va.duration_seconds<=60 and nullif(btrim(va.cloudflare_uid),'') is not null)
       or (s.visual_source_kind='eligible_image' and ma.provider='r2' and ma.status='ready' and ma.deleted_at is null and ma.visibility='public'
        and ma.media_kind='image' and ma.mime_type in('image/jpeg','image/png','image/webp') and ma.size_bytes>0 and ma.size_bytes<=10485760
        and nullif(btrim(ma.bucket_name),'') is not null and nullif(btrim(ma.object_key),'') is not null))
    order by s.visual_available_at,s.created_at,s.id for update of s skip locked limit p_limit
  loop
    update private.content_safety_scans set visual_attempt_count=visual_attempt_count+1,visual_started_at=clock_timestamp(),
      visual_last_error_code=null,updated_at=clock_timestamp() where id=v_row.id;
    v_result:=v_result||jsonb_build_array(jsonb_build_object('scan_id',v_row.id,'target_id',v_row.target_id,'content_fingerprint',v_row.content_fingerprint,
      'source_kind',v_row.visual_source_kind,'video_asset_id',v_row.visual_video_asset_id,'media_asset_id',v_row.visual_media_asset_id,
      'cloudflare_uid',v_row.cloudflare_uid,'duration_seconds',v_row.duration_seconds,'bucket_name',v_row.bucket_name,'object_key',v_row.object_key,
      'mime_type',v_row.mime_type,'size_bytes',v_row.size_bytes,'frame_cursor',v_row.visual_frame_cursor,'partial_result',v_row.visual_partial_result,
      'attempt_count',v_row.visual_attempt_count+1,'provider_call_count',v_row.visual_provider_call_count));
  end loop;
  return v_result;
end;
$$;

create function public.advance_content_safety_visual_scan(p_scan_id uuid,p_expected_cursor integer,p_frame_timestamp_ms integer,p_frame_result jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_scan private.content_safety_scans;v_frames jsonb;
begin
  select * into v_scan from private.content_safety_scans where id=p_scan_id for update;
  if not found then raise exception using errcode='P0002',message='content_safety_visual_scan_not_found';end if;
  if v_scan.target_type<>'video' or v_scan.visual_status<>'pending' or v_scan.visual_source_kind<>'eligible_stream_video'
     or v_scan.visual_frame_cursor<>p_expected_cursor or p_expected_cursor not between 0 and 3 or p_frame_timestamp_ms<0
     or jsonb_typeof(p_frame_result)<>'object' or pg_column_size(p_frame_result)>8192 or v_scan.visual_provider_call_count>=5 then
    raise exception using errcode='22023',message='invalid_content_safety_visual_advance';end if;
  v_frames:=coalesce(v_scan.visual_partial_result->'frames','[]'::jsonb)||jsonb_build_array(jsonb_build_object('frame_index',p_expected_cursor,'timestamp_ms',p_frame_timestamp_ms,'result',p_frame_result));
  if pg_column_size(jsonb_build_object('frames',v_frames))>32768 then raise exception using errcode='22023',message='content_safety_visual_partial_too_large';end if;
  update private.content_safety_scans set visual_frame_cursor=visual_frame_cursor+1,visual_partial_result=jsonb_build_object('frames',v_frames),
    visual_provider_call_count=visual_provider_call_count+1,visual_attempt_count=0,visual_started_at=null,visual_available_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=v_scan.id;
  return jsonb_build_object('scan_id',v_scan.id,'visual_status','pending','frame_cursor',v_scan.visual_frame_cursor+1,'provider_call_count',v_scan.visual_provider_call_count+1);
end;
$$;

create function public.complete_content_safety_visual_analysis(p_scan_id uuid,p_content_fingerprint text,p_analysis_result jsonb,
  p_analysis_fingerprint text,p_frame_timestamps_ms integer[])
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_scan private.content_safety_scans;v_analysis private.content_safety_visual_analyses;v_finding jsonb;v_category text;v_severity text;v_description text;
  v_frame_indexes integer[];v_frame_times integer[];v_snapshot jsonb;v_total integer;v_pending integer;v_recent integer;v_latest timestamptz;
  v_warnings integer;v_reach bigint;v_priority integer;v_alert_count integer:=0;v_provider_calls integer;v_frame_count integer;v_strategy text;
begin
  select * into v_scan from private.content_safety_scans where id=p_scan_id for update;
  if not found then raise exception using errcode='P0002',message='content_safety_visual_scan_not_found';end if;
  v_provider_calls:=v_scan.visual_provider_call_count+1;
  v_strategy:=case when v_scan.visual_source_kind='eligible_image' then 'single_image_v1' else 'percentile_5_v1' end;
  v_frame_count:=case when v_scan.visual_source_kind='eligible_image' then 1 else cardinality(p_frame_timestamps_ms) end;
  if v_scan.target_type<>'video' or v_scan.visual_status<>'pending' or v_scan.content_fingerprint<>p_content_fingerprint
     or v_scan.visual_source_kind not in('eligible_image','eligible_stream_video') or v_provider_calls not between 1 and 5
     or p_analysis_fingerprint!~'^[0-9a-f]{64}$' or jsonb_typeof(p_analysis_result)<>'object' or pg_column_size(p_analysis_result)>32768
     or p_analysis_result->>'schema_version'<>'visual-safety-v1' or jsonb_typeof(p_analysis_result->'review_required')<>'boolean'
     or jsonb_typeof(p_analysis_result->'findings')<>'array' or jsonb_array_length(p_analysis_result->'findings')>10
     or jsonb_typeof(p_analysis_result->'summary')<>'string' or char_length(p_analysis_result->>'summary')>500
     or (v_scan.visual_source_kind='eligible_image' and cardinality(p_frame_timestamps_ms)<>0)
     or (v_scan.visual_source_kind='eligible_stream_video' and (v_frame_count<1 or v_frame_count>5 or v_scan.visual_frame_cursor<>v_frame_count-1))
     or ((p_analysis_result->>'review_required')::boolean and jsonb_array_length(p_analysis_result->'findings')=0)
     or (not (p_analysis_result->>'review_required')::boolean and jsonb_array_length(p_analysis_result->'findings')<>0) then
    raise exception using errcode='22023',message='invalid_content_safety_visual_completion';end if;
  if exists(select 1 from unnest(p_frame_timestamps_ms) with ordinality a(value,pos) join unnest(p_frame_timestamps_ms) with ordinality b(value,pos) on b.pos=a.pos+1 where b.value<=a.value)
     or exists(select 1 from unnest(p_frame_timestamps_ms) x where x<0) then raise exception using errcode='22023',message='invalid_visual_frame_timestamps';end if;
  for v_finding in select value from jsonb_array_elements(p_analysis_result->'findings') loop
    if jsonb_typeof(v_finding)<>'object' or (select count(*) from jsonb_object_keys(v_finding))<>4
       or not(v_finding?'category' and v_finding?'triage_level' and v_finding?'description' and v_finding?'frame_index')
       or v_finding->>'category' not in('violence','threat','sexual','self_harm','drugs','weapons','fraud','spam','other')
       or v_finding->>'triage_level' not in('low','medium','high','critical') or char_length(v_finding->>'description')>240
       or (v_scan.visual_source_kind='eligible_image' and jsonb_typeof(v_finding->'frame_index')<>'null')
       or (v_scan.visual_source_kind='eligible_stream_video' and (jsonb_typeof(v_finding->'frame_index')<>'number' or (v_finding->>'frame_index')::integer<0 or (v_finding->>'frame_index')::integer>=v_frame_count)) then
      raise exception using errcode='22023',message='invalid_content_safety_visual_finding';end if;
  end loop;
  insert into private.content_safety_visual_analyses(source_scan_id,video_asset_id,media_asset_id,source_content_fingerprint,provider,model,prompt_version,
    sample_strategy,frame_count,frame_timestamps_ms,analysis_result,analysis_fingerprint,provider_call_count)
  values(v_scan.id,v_scan.visual_video_asset_id,v_scan.visual_media_asset_id,v_scan.content_fingerprint,'cloudflare_workers_ai','@cf/google/gemma-4-26b-a4b-it',
    'visual-safety-v1',v_strategy,v_frame_count,p_frame_timestamps_ms,p_analysis_result,p_analysis_fingerprint,v_provider_calls)
  on conflict(source_scan_id,source_content_fingerprint,provider,model,prompt_version,sample_strategy) do update set updated_at=clock_timestamp()
  returning * into v_analysis;
  v_snapshot:=private.content_safety_target_snapshot(v_scan.target_type,v_scan.target_id);
  select count(*)::integer,count(*) filter(where r.status='pending')::integer,count(*) filter(where r.status='pending' and r.created_at>=clock_timestamp()-interval '15 minutes')::integer,max(r.created_at)
    into v_total,v_pending,v_recent,v_latest from public.reports r where r.reported_content_type=v_scan.target_type and r.reported_content_id=v_scan.target_id;
  select count(*)::integer into v_warnings from private.admin_user_warnings w where w.target_user_id=v_scan.owner_user_id and w.status='active'
    and w.issued_at>coalesce((select max(a.completed_at) from private.admin_user_moderation_actions a where a.target_user_id=v_scan.owner_user_id and a.action='restore' and a.status='succeeded'),'-infinity'::timestamptz);
  v_warnings:=least(coalesce(v_warnings,0),3);v_reach:=greatest(coalesce((v_snapshot->>'reach')::bigint,0),0);
  for v_category in select distinct value->>'category' from jsonb_array_elements(p_analysis_result->'findings') loop
    select f->>'triage_level',left(string_agg(f->>'description',' · ' order by idx),240),array_agg(distinct (f->>'frame_index')::integer order by (f->>'frame_index')::integer)
      into v_severity,v_description,v_frame_indexes
      from jsonb_array_elements(p_analysis_result->'findings') with ordinality e(f,idx)
      where f->>'category'=v_category
      group by f->>'triage_level' order by max(case f->>'triage_level' when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end) desc limit 1;
    if v_scan.visual_source_kind='eligible_stream_video' then select array_agg(p_frame_timestamps_ms[i+1] order by i) into v_frame_times from unnest(v_frame_indexes) i;else v_frame_times:='{}'::integer[];end if;
    v_priority:=private.content_safety_priority(v_severity,v_pending,v_recent,v_warnings,v_reach);
    insert into private.content_safety_alerts(scan_id,target_type,target_id,owner_user_id,source_type,rule_id,category,severity,confidence,priority_score,
      alert_fingerprint,reach,related_report_count,pending_report_count,reports_last_15m,latest_report_at,active_warning_count,evidence)
    values(v_scan.id,v_scan.target_type,v_scan.target_id,v_scan.owner_user_id,'visual_classifier',null,v_category,v_severity,null,v_priority,
      private.content_safety_sha256(v_analysis.id::text||'|visual_classifier|'||v_category||'|visual-safety-v1'),v_reach,v_total,v_pending,v_recent,v_latest,v_warnings,
      jsonb_build_object('visual_analysis_id',v_analysis.id,'provider',v_analysis.provider,'model',v_analysis.model,'prompt_version',v_analysis.prompt_version,
        'sample_strategy',v_analysis.sample_strategy,'category',v_category,'model_triage_level',v_severity,'description',v_description,
        'frame_indexes',coalesce(to_jsonb(v_frame_indexes),'[]'::jsonb),'frame_timestamps_ms',coalesce(to_jsonb(v_frame_times),'[]'::jsonb),'analysis_fingerprint',v_analysis.analysis_fingerprint))
    on conflict(alert_fingerprint) do update set priority_score=excluded.priority_score,reach=excluded.reach,related_report_count=excluded.related_report_count,
      pending_report_count=excluded.pending_report_count,reports_last_15m=excluded.reports_last_15m,latest_report_at=excluded.latest_report_at,
      active_warning_count=excluded.active_warning_count,evidence=excluded.evidence,updated_at=clock_timestamp();
    v_alert_count:=v_alert_count+1;
  end loop;
  update private.content_safety_scans set visual_status='analyzed',visual_completed_at=clock_timestamp(),visual_started_at=null,visual_last_error_code=null,
    visual_provider_call_count=v_provider_calls,visual_attempt_count=0,visual_frame_cursor=v_frame_count,visual_partial_result=null,updated_at=clock_timestamp() where id=v_scan.id;
  update private.content_safety_scans set visual_status='analyzed',visual_provider='cloudflare_workers_ai',visual_model='@cf/google/gemma-4-26b-a4b-it',
    visual_prompt_version='visual-safety-v1',visual_completed_at=clock_timestamp(),visual_last_error_code=null,updated_at=clock_timestamp()
    where media_source_scan_id=v_scan.id and target_type='story';
  return jsonb_build_object('scan_id',v_scan.id,'analysis_id',v_analysis.id,'visual_status','analyzed','alerts_processed',v_alert_count,
    'provider_call_count',v_provider_calls,'frame_count',v_frame_count);
end;
$$;

create function public.fail_content_safety_visual_scan(p_scan_id uuid,p_error_code text,p_retryable boolean default true,p_provider_called boolean default false)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_scan private.content_safety_scans;v_calls integer;v_retry boolean;v_error text;v_frames_remaining integer;
begin
  select * into v_scan from private.content_safety_scans where id=p_scan_id for update;
  if not found then raise exception using errcode='P0002',message='content_safety_visual_scan_not_found';end if;
  v_calls:=v_scan.visual_provider_call_count+case when coalesce(p_provider_called,false) then 1 else 0 end;
  v_frames_remaining:=case when v_scan.visual_source_kind='eligible_stream_video' then 5-v_scan.visual_frame_cursor else 1 end;
  v_retry:=coalesce(p_retryable,false) and v_scan.visual_attempt_count<5 and v_calls<5
    and (v_scan.visual_source_kind='eligible_image' or v_calls+v_frames_remaining<=5);
  v_error:=left(lower(regexp_replace(coalesce(nullif(btrim(p_error_code),''),'visual_processing_error'),'[^a-z0-9_]+','_','g')),100);
  update private.content_safety_scans set visual_status=case when v_retry then 'pending' else 'failed' end,
    visual_provider_call_count=v_calls,visual_available_at=case when v_retry then clock_timestamp()+least(30,power(2,greatest(v_scan.visual_attempt_count,1)))::integer*interval '1 minute' else visual_available_at end,
    visual_started_at=null,visual_completed_at=case when v_retry then null else clock_timestamp() end,visual_last_error_code=v_error,updated_at=clock_timestamp() where id=v_scan.id;
  update private.content_safety_scans set visual_status=case when v_retry then 'pending' else 'failed' end,visual_last_error_code=v_error,updated_at=clock_timestamp()
    where media_source_scan_id=v_scan.id and target_type='story';
  return jsonb_build_object('scan_id',v_scan.id,'visual_status',case when v_retry then 'pending' else 'failed' end,'retryable',v_retry,'provider_call_count',v_calls);
end;
$$;

create function public.search_admin_content_safety_visual()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
  perform public.admin_require_capability('content.items.read');
  return (with latest as(select distinct on(s.target_type,s.target_id) s.* from private.content_safety_scans s where s.target_type in('video','story') order by s.target_type,s.target_id,s.created_at desc,s.id desc),rows as(
    select s.*,coalesce(s.media_source_scan_id,s.id) effective_scan_id,a.id analysis_id,a.frame_count,a.frame_timestamps_ms,a.analysis_result,a.analysis_fingerprint,a.provider_call_count analysis_provider_calls,
      snap.value snapshot,up.username,up.display_name,up.avatar_url,src.target_id source_target_id
    from latest s left join private.content_safety_scans src on src.id=s.media_source_scan_id
    left join private.content_safety_visual_analyses a on a.source_scan_id=coalesce(s.media_source_scan_id,s.id) and a.source_content_fingerprint=coalesce(src.content_fingerprint,s.content_fingerprint)
    left join public.user_profiles up on up.id=s.owner_user_id left join lateral(select private.content_safety_target_snapshot(s.target_type,s.target_id) value) snap on true)
  select jsonb_build_object('provider',jsonb_build_object('configured',true,'name','Cloudflare Workers AI','model','@cf/google/gemma-4-26b-a4b-it','prompt_version','visual-safety-v1',
      'status',case when exists(select 1 from private.content_safety_visual_analyses) then 'healthy' when exists(select 1 from private.content_safety_scans where visual_last_error_code in('visual_workers_ai_unauthorized','visual_workers_ai_forbidden','visual_workers_ai_model_unavailable')) then 'error' else 'awaiting_smoke' end,
      'last_success_at',(select max(created_at) from private.content_safety_visual_analyses),'last_error_code',(select visual_last_error_code from private.content_safety_scans where visual_last_error_code is not null order by updated_at desc limit 1)),
    'stats',jsonb_build_object('eligible',(select count(*) from rows where visual_status in('pending','analyzed','failed')),'pending',(select count(*) from rows where visual_status='pending'),
      'analyzed',(select count(*) from rows where visual_status='analyzed'),'failed',(select count(*) from rows where visual_status='failed'),'not_applicable',(select count(*) from rows where visual_status='not_applicable'),
      'not_configured',(select count(*) from rows where visual_status='not_configured'),'image_analyses',(select count(*) from private.content_safety_visual_analyses where media_asset_id is not null),
      'video_analyses',(select count(*) from private.content_safety_visual_analyses where video_asset_id is not null),'frames',(select coalesce(sum(frame_count),0) from private.content_safety_visual_analyses),
      'provider_calls',(select coalesce(sum(provider_call_count),0) from private.content_safety_visual_analyses),'visual_alerts',(select count(*) from private.content_safety_alerts where source_type='visual_classifier')),
    'items',coalesce((select jsonb_agg(jsonb_build_object('scan_id',r.id,'target_type',r.target_type,'target_id',r.target_id,'content_path',r.snapshot->>'path','summary',r.snapshot->>'summary',
      'author',jsonb_build_object('id',r.owner_user_id,'username',r.username,'display_name',r.display_name,'avatar_url',r.avatar_url),'visual_status',r.visual_status,
      'source_kind',r.visual_source_kind,'provider',r.visual_provider,'model',r.visual_model,'frame_count',r.frame_count,
      'findings_count',coalesce(jsonb_array_length(r.analysis_result->'findings'),0),'alert_count',(select count(*) from private.content_safety_alerts al where al.scan_id=r.effective_scan_id and al.source_type='visual_classifier'),
      'source_reused',r.media_source_scan_id is not null,'source_scan_id',r.media_source_scan_id,'source_target_id',r.source_target_id,
      'processed_at',r.visual_completed_at,'last_error_code',r.visual_last_error_code) order by r.created_at desc,r.id desc) from rows r),'[]'::jsonb)));
end;
$$;

create function public.get_admin_content_safety_visual_detail(p_scan_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_result jsonb;
begin
  perform public.admin_require_capability('content.items.read');
  select jsonb_build_object('scan_id',s.id,'target_type',s.target_type,'target_id',s.target_id,'content',jsonb_build_object('path',snap.value->>'path','summary',snap.value->>'summary'),
    'author',jsonb_build_object('id',s.owner_user_id,'username',up.username,'display_name',up.display_name,'avatar_url',up.avatar_url),
    'visual_status',s.visual_status,'provider',coalesce(src.visual_provider,s.visual_provider),'model',coalesce(src.visual_model,s.visual_model),
    'prompt_version',coalesce(src.visual_prompt_version,s.visual_prompt_version),'source_kind',s.visual_source_kind,'source_reused',s.media_source_scan_id is not null,
    'source_scan_id',s.media_source_scan_id,'source_target_id',src.target_id,'video_asset_id',coalesce(src.visual_video_asset_id,s.visual_video_asset_id),
    'media_asset_id',coalesce(src.visual_media_asset_id,s.visual_media_asset_id),'attempts',coalesce(src.visual_attempt_count,s.visual_attempt_count),
    'last_error_code',coalesce(src.visual_last_error_code,s.visual_last_error_code),'completed_at',coalesce(src.visual_completed_at,s.visual_completed_at),
    'analysis',case when a.id is null then null else jsonb_build_object('id',a.id,'sample_strategy',a.sample_strategy,'frame_count',a.frame_count,
      'frame_timestamps_ms',a.frame_timestamps_ms,'summary',a.analysis_result->>'summary','review_required',(a.analysis_result->>'review_required')::boolean,
      'findings',a.analysis_result->'findings','fingerprint',a.analysis_fingerprint,'provider_calls',a.provider_call_count,'created_at',a.created_at) end,
    'alerts',(select coalesce(jsonb_agg(jsonb_build_object('id',al.id,'category',al.category,'severity',al.severity,'status',al.status) order by al.created_at,al.id),'[]'::jsonb)
      from private.content_safety_alerts al where al.scan_id=coalesce(s.media_source_scan_id,s.id) and al.source_type='visual_classifier'),
    'shared_references',(select coalesce(jsonb_agg(jsonb_build_object('id',st.id,'path','/stories/'||st.id::text) order by st.created_at,st.id),'[]'::jsonb)
      from public.stories st where st.shared_video_id=coalesce(src.target_id,s.target_id))) into v_result
  from private.content_safety_scans s left join private.content_safety_scans src on src.id=s.media_source_scan_id
  left join private.content_safety_visual_analyses a on a.source_scan_id=coalesce(s.media_source_scan_id,s.id) and a.source_content_fingerprint=coalesce(src.content_fingerprint,s.content_fingerprint)
  left join public.user_profiles up on up.id=s.owner_user_id left join lateral(select private.content_safety_target_snapshot(s.target_type,s.target_id) value) snap on true
  where s.id=p_scan_id;
  if v_result is null then raise exception using errcode='P0002',message='content_safety_visual_not_found';end if;return v_result;
end;
$$;

create function public.admin_retry_content_safety_visual(p_scan_id uuid,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_actor uuid;v_scan private.content_safety_scans;v_source_id uuid;v_scope text;v_fingerprint text;v_existing private.admin_action_audit;
begin
  v_actor:=public.admin_require_capability('content.items.moderate');v_scope:='v1|human|'||v_actor::text||'|content.items.moderate|content_safety.visual.retry';
  v_fingerprint:=private.content_safety_sha256(jsonb_build_object('scan_id',p_scan_id)::text);
  select * into v_existing from private.admin_action_audit where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then if v_existing.request_fingerprint<>v_fingerprint then raise exception using errcode='23505',message='admin_idempotency_conflict';end if;return v_existing.metadata||jsonb_build_object('idempotent',true);end if;
  select * into v_scan from private.content_safety_scans where id=p_scan_id for update;if not found then raise exception using errcode='P0002',message='content_safety_visual_not_found';end if;
  v_source_id:=coalesce(v_scan.media_source_scan_id,v_scan.id);select * into v_scan from private.content_safety_scans where id=v_source_id for update;
  if v_scan.visual_status<>'failed' then raise exception using errcode='55000',message='content_safety_visual_not_failed';end if;
  update private.content_safety_scans set visual_status='pending',visual_attempt_count=0,visual_provider_call_count=0,visual_frame_cursor=0,
    visual_partial_result=null,visual_available_at=clock_timestamp(),visual_started_at=null,visual_completed_at=null,visual_last_error_code=null,updated_at=clock_timestamp() where id=v_source_id;
  insert into private.admin_action_audit(actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,target_id,target_ref,outcome,reason,financial_effect,contains_pii,idempotency_scope,idempotency_key,request_fingerprint,metadata)
  values(v_actor,'human_admin',private.admin_active_role_codes(v_actor),'content.items.moderate','content_safety','content_safety.visual.retry','content_safety_scan',v_source_id,v_source_id::text,
    'succeeded',null,false,false,v_scope,p_idempotency_key,v_fingerprint,jsonb_build_object('scan_id',v_source_id,'visual_status','pending'));
  return jsonb_build_object('scan_id',v_source_id,'visual_status','pending','idempotent',false);
end;
$$;

revoke all on function private.content_safety_visual_source(text,uuid) from public,anon,authenticated,service_role;
revoke all on function private.initialize_content_safety_visual_for_new_scan() from public,anon,authenticated,service_role;
revoke all on function public.refresh_content_safety_visual_eligibility(integer,uuid) from public,anon,authenticated,service_role;
revoke all on function public.claim_content_safety_visual_scans(integer) from public,anon,authenticated,service_role;
revoke all on function public.advance_content_safety_visual_scan(uuid,integer,integer,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.complete_content_safety_visual_analysis(uuid,text,jsonb,text,integer[]) from public,anon,authenticated,service_role;
revoke all on function public.fail_content_safety_visual_scan(uuid,text,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function public.refresh_content_safety_visual_eligibility(integer,uuid) to service_role;
grant execute on function public.claim_content_safety_visual_scans(integer) to service_role;
grant execute on function public.advance_content_safety_visual_scan(uuid,integer,integer,jsonb) to service_role;
grant execute on function public.complete_content_safety_visual_analysis(uuid,text,jsonb,text,integer[]) to service_role;
grant execute on function public.fail_content_safety_visual_scan(uuid,text,boolean,boolean) to service_role;

revoke all on function public.search_admin_content_safety_visual() from public,anon,authenticated,service_role;
revoke all on function public.get_admin_content_safety_visual_detail(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_retry_content_safety_visual(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.search_admin_content_safety_visual() to authenticated;
grant execute on function public.get_admin_content_safety_visual_detail(uuid) to authenticated;
grant execute on function public.admin_retry_content_safety_visual(uuid,uuid) to authenticated;

comment on table private.content_safety_visual_analyses is 'Private bounded Cloudflare Workers AI visual triage evidence. Never stores pixels and never authorizes enforcement.';
comment on function public.refresh_content_safety_visual_eligibility(integer,uuid) is 'Service-only canonical public feed/Story visual resolution. Deployment is inert; DMs, private media, LIVE, calls, avatars, and Marketplace are excluded.';
comment on function public.complete_content_safety_visual_analysis(uuid,text,jsonb,text,integer[]) is 'Creates visual_classifier alerts with null confidence for human review only; never warns, hides, suspends, deletes, restores, or moves funds.';

commit;
