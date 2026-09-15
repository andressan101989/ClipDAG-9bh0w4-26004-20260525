begin;

-- F6 extends the existing Content Safety worker and scan queue. It does not
-- enqueue provider work during deployment and it never grants enforcement.

alter table private.content_safety_scans
  add column audio_provider text null,
  add column audio_model text null,
  add column audio_source_asset_id uuid null references public.video_assets(id) on update restrict on delete set null,
  add column audio_attempt_count integer not null default 0,
  add column audio_available_at timestamptz not null default clock_timestamp(),
  add column audio_started_at timestamptz null,
  add column audio_completed_at timestamptz null,
  add column audio_last_error_code text null,
  add column audio_cleanup_pending boolean not null default false,
  add column audio_cleanup_attempt_count integer not null default 0,
  add column audio_cleanup_available_at timestamptz null,
  add column audio_provider_call_count integer not null default 0;

alter table private.content_safety_scans
  add constraint content_safety_scans_audio_attempt_check check(audio_attempt_count between 0 and 5),
  add constraint content_safety_scans_audio_cleanup_attempt_check check(audio_cleanup_attempt_count between 0 and 5),
  add constraint content_safety_scans_audio_provider_calls_check check(audio_provider_call_count>=0),
  add constraint content_safety_scans_audio_error_check check(audio_last_error_code is null or (audio_last_error_code=btrim(audio_last_error_code) and char_length(audio_last_error_code) between 2 and 100)),
  add constraint content_safety_scans_audio_timestamps_check check((audio_started_at is null or audio_started_at>=created_at) and (audio_completed_at is null or audio_completed_at>=created_at));

create table private.content_safety_audio_transcripts (
  id uuid primary key default gen_random_uuid(),
  source_scan_id uuid not null references private.content_safety_scans(id) on update restrict on delete restrict,
  source_asset_id uuid not null references public.video_assets(id) on update restrict on delete restrict,
  source_content_fingerprint text not null,
  provider text not null,
  model text not null,
  detected_language text null,
  transcript_text text not null,
  word_count integer not null,
  segments jsonb not null default '[]'::jsonb,
  no_speech boolean not null,
  transcript_fingerprint text not null,
  rule_eval_status text not null default 'pending',
  rule_eval_attempt_count integer not null default 0,
  rule_eval_ruleset_fingerprint text null,
  rule_eval_available_at timestamptz not null default clock_timestamp(),
  rule_eval_started_at timestamptz null,
  rule_eval_completed_at timestamptz null,
  rule_eval_last_error_code text null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint content_safety_audio_transcripts_source_fingerprint_check check(source_content_fingerprint~'^[0-9a-f]{64}$'),
  constraint content_safety_audio_transcripts_provider_check check(provider='cloudflare_workers_ai'),
  constraint content_safety_audio_transcripts_model_check check(model='@cf/openai/whisper-large-v3-turbo'),
  constraint content_safety_audio_transcripts_language_check check(detected_language is null or (detected_language=btrim(detected_language) and char_length(detected_language) between 2 and 32)),
  constraint content_safety_audio_transcripts_text_check check(char_length(transcript_text)<=100000),
  constraint content_safety_audio_transcripts_word_count_check check(word_count>=0),
  constraint content_safety_audio_transcripts_segments_check check(jsonb_typeof(segments)='array' and pg_column_size(segments)<=65536),
  constraint content_safety_audio_transcripts_fingerprint_check check(transcript_fingerprint~'^[0-9a-f]{64}$'),
  constraint content_safety_audio_transcripts_eval_status_check check(rule_eval_status in('pending','processing','completed','failed')),
  constraint content_safety_audio_transcripts_eval_attempt_check check(rule_eval_attempt_count between 0 and 5),
  constraint content_safety_audio_transcripts_eval_fingerprint_check check(rule_eval_ruleset_fingerprint is null or rule_eval_ruleset_fingerprint~'^[0-9a-f]{64}$'),
  constraint content_safety_audio_transcripts_eval_error_check check(rule_eval_last_error_code is null or (rule_eval_last_error_code=btrim(rule_eval_last_error_code) and char_length(rule_eval_last_error_code) between 2 and 100)),
  constraint content_safety_audio_transcripts_updated_check check(updated_at>=created_at),
  unique(source_scan_id,source_content_fingerprint,provider,model)
);

create index content_safety_scans_audio_queue_idx
  on private.content_safety_scans(audio_available_at,created_at,id)
  where target_type='video' and audio_status='pending';
create index content_safety_scans_audio_cleanup_idx
  on private.content_safety_scans(audio_cleanup_available_at,id)
  where audio_cleanup_pending;
create index content_safety_audio_transcripts_source_asset_idx
  on private.content_safety_audio_transcripts(source_asset_id,created_at desc,id desc);
create index content_safety_audio_transcripts_eval_queue_idx
  on private.content_safety_audio_transcripts(rule_eval_available_at,created_at,id)
  where rule_eval_status in('pending','processing');

alter table private.content_safety_audio_transcripts enable row level security;
revoke all privileges on table private.content_safety_audio_transcripts from public,anon,authenticated,service_role;

alter table private.content_safety_alerts drop constraint content_safety_alerts_source_check;
alter table private.content_safety_alerts add constraint content_safety_alerts_source_check
  check(source_type in('text_rule','user_reports','audio_transcript_rule','audio_classifier','visual_classifier'));
alter table private.content_safety_alerts drop constraint content_safety_alerts_rule_source_check;
alter table private.content_safety_alerts add constraint content_safety_alerts_rule_source_check
  check((source_type in('text_rule','audio_transcript_rule') and rule_id is not null) or (source_type not in('text_rule','audio_transcript_rule') and rule_id is null));

create function private.content_safety_audio_source(p_target_type text,p_target_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_asset public.video_assets;v_media public.media_assets;v_shared uuid;v_source jsonb;
begin
  if p_target_type='video' then
    select a.* into v_asset from public.video_asset_links l join public.video_assets a on a.id=l.asset_id
    where l.entity_type='video_post' and l.entity_id=p_target_id and l.slot='video' and l.position=0
    order by l.created_at,l.id limit 1;
    if found and v_asset.provider='cloudflare_stream' and v_asset.status='ready' and v_asset.deleted_at is null
       and nullif(btrim(v_asset.cloudflare_uid),'') is not null and v_asset.mime_type like 'video/%'
       and v_asset.duration_seconds>0 and v_asset.duration_seconds<=60 and v_asset.visibility='public' then
      return jsonb_build_object('kind','eligible','source_asset_id',v_asset.id,'cloudflare_uid',v_asset.cloudflare_uid,
        'duration_seconds',v_asset.duration_seconds,'provider',v_asset.provider,'model','@cf/openai/whisper-large-v3-turbo');
    end if;
    select a.* into v_media from public.media_asset_links l join public.media_assets a on a.id=l.asset_id
    where l.entity_type='video_post' and l.entity_id=p_target_id and l.slot='media' and l.position=0
    order by l.created_at,l.id limit 1;
    if found and v_media.status='ready' and v_media.deleted_at is null and v_media.media_kind='image' and v_media.mime_type like 'image/%' then
      return jsonb_build_object('kind','not_applicable','reason','canonical_image');
    end if;
    return jsonb_build_object('kind','not_configured','reason','canonical_audio_source_unavailable');
  elsif p_target_type='story' then
    select s.shared_video_id into v_shared from public.stories s where s.id=p_target_id;
    if not found then return jsonb_build_object('kind','not_configured','reason','canonical_audio_source_unavailable');end if;
    if v_shared is not null then
      v_source:=private.content_safety_audio_source('video',v_shared);
      return v_source||jsonb_build_object('kind',case v_source->>'kind' when 'eligible' then 'shared_video' when 'not_applicable' then 'not_applicable' else 'not_configured' end,'shared_video_id',v_shared);
    end if;
    select a.* into v_media from public.media_asset_links l join public.media_assets a on a.id=l.asset_id
    where l.entity_type='story' and l.entity_id=p_target_id and l.slot='media' and l.position=0
    order by l.created_at,l.id limit 1;
    if found and v_media.status='ready' and v_media.deleted_at is null and v_media.media_kind='image' and v_media.mime_type like 'image/%' then
      return jsonb_build_object('kind','not_applicable','reason','canonical_image');
    end if;
    return jsonb_build_object('kind','not_configured','reason','canonical_audio_source_unavailable');
  end if;
  return jsonb_build_object('kind','not_applicable','reason','text_only_target');
end;
$$;

create function public.refresh_content_safety_audio_eligibility(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_scan private.content_safety_scans;v_source jsonb;v_source_scan private.content_safety_scans;v_count integer:=0;v_pending integer:=0;v_reused integer:=0;
begin
  if p_limit<1 or p_limit>500 then raise exception using errcode='22023',message='invalid_audio_eligibility_limit';end if;
  for v_scan in select * from private.content_safety_scans s where s.target_type in('video','story') order by case when s.target_type='video' then 0 else 1 end,s.created_at,s.id limit p_limit
  loop
    v_source:=private.content_safety_audio_source(v_scan.target_type,v_scan.target_id);
    if v_scan.target_type='video' and v_source->>'kind'='eligible' then
      update private.content_safety_scans set audio_provider='cloudflare_workers_ai',audio_model='@cf/openai/whisper-large-v3-turbo',
        audio_source_asset_id=(v_source->>'source_asset_id')::uuid,
        audio_status=case when exists(select 1 from private.content_safety_audio_transcripts t where t.source_scan_id=v_scan.id and t.source_content_fingerprint=v_scan.content_fingerprint and t.provider='cloudflare_workers_ai' and t.model='@cf/openai/whisper-large-v3-turbo') then 'analyzed' else 'pending' end,
        audio_available_at=case when audio_status='not_configured' then clock_timestamp() else audio_available_at end,
        audio_last_error_code=null,updated_at=clock_timestamp() where id=v_scan.id;
      if not exists(select 1 from private.content_safety_audio_transcripts t where t.source_scan_id=v_scan.id and t.source_content_fingerprint=v_scan.content_fingerprint and t.provider='cloudflare_workers_ai' and t.model='@cf/openai/whisper-large-v3-turbo') then v_pending:=v_pending+1;end if;
    elsif v_scan.target_type='story' and v_source->>'kind'='shared_video' then
      select * into v_source_scan from private.content_safety_scans s where s.target_type='video' and s.target_id=(v_source->>'shared_video_id')::uuid order by s.created_at desc,s.id desc limit 1;
      if found then
        update private.content_safety_scans set media_source_scan_id=v_source_scan.id,audio_provider=v_source_scan.audio_provider,audio_model=v_source_scan.audio_model,
          audio_status=v_source_scan.audio_status,audio_last_error_code=v_source_scan.audio_last_error_code,
          audio_completed_at=v_source_scan.audio_completed_at,updated_at=clock_timestamp() where id=v_scan.id;
        v_reused:=v_reused+1;
      else
        update private.content_safety_scans set audio_status='not_configured',audio_last_error_code='canonical_audio_source_unavailable',updated_at=clock_timestamp() where id=v_scan.id;
      end if;
    elsif v_source->>'kind'='not_applicable' then
      update private.content_safety_scans set audio_status='not_applicable',audio_source_asset_id=null,audio_last_error_code=null,audio_started_at=null,audio_completed_at=null,updated_at=clock_timestamp() where id=v_scan.id;
    else
      update private.content_safety_scans set audio_status='not_configured',audio_source_asset_id=null,audio_last_error_code='canonical_audio_source_unavailable',audio_started_at=null,audio_completed_at=null,updated_at=clock_timestamp() where id=v_scan.id;
    end if;
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('refreshed',v_count,'pending_provider_sources',v_pending,'shared_reuses',v_reused,'ordinary_private_messages',0);
end;
$$;

create function private.initialize_content_safety_audio_for_new_scan()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_source jsonb;v_source_scan private.content_safety_scans;
begin
  -- The first production transcript is the durable activation marker. Until the
  -- explicit provider probe and controlled smoke succeed, deployment is inert.
  if not exists(select 1 from private.content_safety_audio_transcripts) or new.target_type not in('video','story') then return new;end if;
  v_source:=private.content_safety_audio_source(new.target_type,new.target_id);
  if new.target_type='video' and v_source->>'kind'='eligible' then
    update private.content_safety_scans set audio_status='pending',audio_provider='cloudflare_workers_ai',audio_model='@cf/openai/whisper-large-v3-turbo',
      audio_source_asset_id=(v_source->>'source_asset_id')::uuid,audio_available_at=clock_timestamp(),audio_last_error_code=null where id=new.id;
  elsif new.target_type='story' and v_source->>'kind'='shared_video' then
    select * into v_source_scan from private.content_safety_scans where target_type='video' and target_id=(v_source->>'shared_video_id')::uuid order by created_at desc,id desc limit 1;
    if found then update private.content_safety_scans set media_source_scan_id=v_source_scan.id,audio_status=v_source_scan.audio_status,
      audio_provider=v_source_scan.audio_provider,audio_model=v_source_scan.audio_model,audio_last_error_code=v_source_scan.audio_last_error_code where id=new.id;end if;
  elsif v_source->>'kind'='not_applicable' then
    update private.content_safety_scans set audio_status='not_applicable',audio_last_error_code=null where id=new.id;
  else
    update private.content_safety_scans set audio_status='not_configured',audio_last_error_code='canonical_audio_source_unavailable' where id=new.id;
  end if;
  return new;
end;
$$;

create trigger content_safety_audio_initialize_new_scan
after insert on private.content_safety_scans
for each row execute function private.initialize_content_safety_audio_for_new_scan();

create function public.claim_content_safety_audio_scans(p_limit integer default 1)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_row record;v_result jsonb:='[]'::jsonb;
begin
  if p_limit<1 or p_limit>1 then raise exception using errcode='22023',message='invalid_audio_claim_limit';end if;
  for v_row in select s.id,s.target_id,s.content_fingerprint,s.audio_source_asset_id,s.audio_attempt_count,a.cloudflare_uid,a.duration_seconds
    from private.content_safety_scans s join public.video_assets a on a.id=s.audio_source_asset_id
    where s.target_type='video' and s.audio_status='pending' and s.audio_attempt_count<5 and s.audio_available_at<=clock_timestamp()
      and (s.audio_started_at is null or s.audio_started_at<clock_timestamp()-interval '10 minutes')
      and a.provider='cloudflare_stream' and a.status='ready' and a.deleted_at is null and a.visibility='public'
      and a.mime_type like 'video/%' and a.duration_seconds>0 and a.duration_seconds<=60 and nullif(btrim(a.cloudflare_uid),'') is not null
    order by s.audio_available_at,s.created_at,s.id for update of s skip locked limit p_limit
  loop
    update private.content_safety_scans set audio_attempt_count=audio_attempt_count+1,audio_started_at=clock_timestamp(),audio_last_error_code=null,updated_at=clock_timestamp() where id=v_row.id;
    v_result:=v_result||jsonb_build_array(jsonb_build_object('scan_id',v_row.id,'target_id',v_row.target_id,
      'content_fingerprint',v_row.content_fingerprint,'source_asset_id',v_row.audio_source_asset_id,
      'cloudflare_uid',v_row.cloudflare_uid,'duration_seconds',v_row.duration_seconds,'attempt_count',v_row.audio_attempt_count+1));
  end loop;
  return v_result;
end;
$$;

create function public.complete_content_safety_audio_transcription(
  p_scan_id uuid,p_source_asset_id uuid,p_content_fingerprint text,p_detected_language text,p_transcript_text text,
  p_word_count integer,p_segments jsonb,p_no_speech boolean,p_transcript_fingerprint text,p_cleanup_pending boolean
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_scan private.content_safety_scans;v_transcript private.content_safety_audio_transcripts;
begin
  select * into v_scan from private.content_safety_scans where id=p_scan_id for update;
  if not found then raise exception using errcode='P0002',message='content_safety_audio_scan_not_found';end if;
  if v_scan.target_type<>'video' or v_scan.audio_status<>'pending' or v_scan.audio_source_asset_id is distinct from p_source_asset_id
     or v_scan.content_fingerprint<>p_content_fingerprint or p_transcript_fingerprint!~'^[0-9a-f]{64}$'
     or p_word_count<0 or jsonb_typeof(p_segments)<>'array' or pg_column_size(p_segments)>65536 or char_length(coalesce(p_transcript_text,''))>100000 then
    raise exception using errcode='22023',message='invalid_content_safety_audio_completion';
  end if;
  insert into private.content_safety_audio_transcripts(source_scan_id,source_asset_id,source_content_fingerprint,provider,model,
    detected_language,transcript_text,word_count,segments,no_speech,transcript_fingerprint,rule_eval_status,rule_eval_available_at)
  values(v_scan.id,p_source_asset_id,p_content_fingerprint,'cloudflare_workers_ai','@cf/openai/whisper-large-v3-turbo',
    nullif(btrim(coalesce(p_detected_language,'')),''),coalesce(p_transcript_text,''),p_word_count,p_segments,coalesce(p_no_speech,false),p_transcript_fingerprint,'pending',clock_timestamp())
  on conflict(source_scan_id,source_content_fingerprint,provider,model) do update set updated_at=clock_timestamp()
  returning * into v_transcript;
  update private.content_safety_scans set audio_status='analyzed',audio_provider='cloudflare_workers_ai',audio_model='@cf/openai/whisper-large-v3-turbo',
    audio_completed_at=clock_timestamp(),audio_started_at=null,audio_last_error_code=null,audio_cleanup_pending=coalesce(p_cleanup_pending,false),
    audio_cleanup_attempt_count=case when coalesce(p_cleanup_pending,false) then 0 else audio_cleanup_attempt_count end,
    audio_cleanup_available_at=case when coalesce(p_cleanup_pending,false) then clock_timestamp()+interval '1 minute' else null end,
    audio_provider_call_count=audio_provider_call_count+1,updated_at=clock_timestamp() where id=v_scan.id;
  update private.content_safety_scans set audio_status='analyzed',audio_provider='cloudflare_workers_ai',audio_model='@cf/openai/whisper-large-v3-turbo',
    audio_completed_at=clock_timestamp(),audio_last_error_code=null,updated_at=clock_timestamp() where media_source_scan_id=v_scan.id and target_type='story';
  return jsonb_build_object('scan_id',v_scan.id,'transcript_id',v_transcript.id,'audio_status','analyzed','cleanup_pending',coalesce(p_cleanup_pending,false));
end;
$$;

create function public.fail_content_safety_audio_scan(p_scan_id uuid,p_error_code text,p_retryable boolean default true,p_provider_called boolean default false)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_scan private.content_safety_scans;v_retry boolean;v_error text;
begin
  v_error:=left(lower(regexp_replace(coalesce(nullif(btrim(p_error_code),''),'audio_worker_error'),'[^a-z0-9_]+','_','g')),100);
  select * into v_scan from private.content_safety_scans where id=p_scan_id for update;
  if not found then raise exception using errcode='P0002',message='content_safety_audio_scan_not_found';end if;
  if v_scan.audio_status='analyzed' then return jsonb_build_object('scan_id',v_scan.id,'audio_status','analyzed','idempotent',true);end if;
  v_retry:=coalesce(p_retryable,false) and v_scan.audio_attempt_count<5;
  update private.content_safety_scans set audio_status=case when v_retry then 'pending' else 'failed' end,
    audio_available_at=case when v_retry then clock_timestamp()+least(30,power(2,greatest(v_scan.audio_attempt_count,1)))::integer*interval '1 minute' else audio_available_at end,
    audio_started_at=null,audio_completed_at=case when v_retry then null else clock_timestamp() end,audio_last_error_code=v_error,
    audio_provider_call_count=audio_provider_call_count+case when coalesce(p_provider_called,false) then 1 else 0 end,updated_at=clock_timestamp() where id=v_scan.id;
  update private.content_safety_scans set audio_status=case when v_retry then 'pending' else 'failed' end,audio_last_error_code=v_error,updated_at=clock_timestamp()
    where media_source_scan_id=v_scan.id and target_type='story';
  return jsonb_build_object('scan_id',v_scan.id,'audio_status',case when v_retry then 'pending' else 'failed' end,'retryable',v_retry);
end;
$$;

create function public.claim_content_safety_audio_cleanup(p_limit integer default 1)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_row record;v_result jsonb:='[]'::jsonb;
begin
  if p_limit<1 or p_limit>1 then raise exception using errcode='22023',message='invalid_audio_cleanup_limit';end if;
  for v_row in select s.id,s.audio_cleanup_attempt_count,a.cloudflare_uid from private.content_safety_scans s join public.video_assets a on a.id=s.audio_source_asset_id
    where s.audio_cleanup_pending and s.audio_cleanup_attempt_count<5 and s.audio_cleanup_available_at<=clock_timestamp()
    order by s.audio_cleanup_available_at,s.id for update of s skip locked limit p_limit
  loop
    update private.content_safety_scans set audio_cleanup_attempt_count=audio_cleanup_attempt_count+1,
      audio_cleanup_available_at=clock_timestamp()+least(30,power(2,greatest(audio_cleanup_attempt_count+1,1)))::integer*interval '1 minute',updated_at=clock_timestamp() where id=v_row.id;
    v_result:=v_result||jsonb_build_array(jsonb_build_object('scan_id',v_row.id,'cloudflare_uid',v_row.cloudflare_uid,'attempt_count',v_row.audio_cleanup_attempt_count+1));
  end loop;
  return v_result;
end;
$$;

create function public.complete_content_safety_audio_cleanup(p_scan_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
begin
  update private.content_safety_scans set audio_cleanup_pending=false,audio_cleanup_available_at=null,updated_at=clock_timestamp()
  where id=p_scan_id and audio_status='analyzed';
  if not found then raise exception using errcode='P0002',message='content_safety_audio_cleanup_not_found';end if;
  return jsonb_build_object('scan_id',p_scan_id,'cleanup_pending',false);
end;
$$;

create function private.content_safety_transcript_ruleset_fingerprint()
returns text language sql stable security definer set search_path=''
as $$
  select private.content_safety_sha256(coalesce(string_agg(r.id::text||'|v'||r.version::text||'|'||r.detector_type||'|'||r.pattern, E'\n' order by r.id),'empty'))
  from private.content_safety_rules r where r.approval_state='approved' and r.enabled and 'transcript'=any(r.scopes)
$$;

create function private.mark_content_safety_transcripts_for_reevaluation()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_fingerprint text;
begin
  v_fingerprint:=private.content_safety_transcript_ruleset_fingerprint();
  update private.content_safety_audio_transcripts set rule_eval_status='pending',rule_eval_attempt_count=0,
    rule_eval_available_at=clock_timestamp(),rule_eval_started_at=null,rule_eval_completed_at=null,rule_eval_last_error_code=null,updated_at=clock_timestamp()
  where rule_eval_ruleset_fingerprint is distinct from v_fingerprint;
  return null;
end;
$$;

create trigger content_safety_transcript_ruleset_changed
after insert or update of enabled,approval_state,scopes,version on private.content_safety_rules
for each statement execute function private.mark_content_safety_transcripts_for_reevaluation();

create function public.claim_content_safety_transcript_evaluations(p_limit integer default 10)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_row private.content_safety_audio_transcripts;v_result jsonb:='[]'::jsonb;v_fingerprint text;
begin
  if p_limit<1 or p_limit>25 then raise exception using errcode='22023',message='invalid_transcript_evaluation_limit';end if;
  v_fingerprint:=private.content_safety_transcript_ruleset_fingerprint();
  for v_row in select * from private.content_safety_audio_transcripts t
    where t.rule_eval_attempt_count<5 and t.rule_eval_available_at<=clock_timestamp()
      and (t.rule_eval_status in('pending','failed') or t.rule_eval_ruleset_fingerprint is distinct from v_fingerprint
        or (t.rule_eval_status='processing' and t.rule_eval_started_at<clock_timestamp()-interval '10 minutes'))
    order by t.rule_eval_available_at,t.created_at,t.id for update skip locked limit p_limit
  loop
    update private.content_safety_audio_transcripts set rule_eval_status='processing',rule_eval_attempt_count=rule_eval_attempt_count+1,
      rule_eval_started_at=clock_timestamp(),rule_eval_completed_at=null,rule_eval_last_error_code=null,updated_at=clock_timestamp() where id=v_row.id;
    v_result:=v_result||jsonb_build_array(jsonb_build_object('transcript_id',v_row.id,'source_scan_id',v_row.source_scan_id,
      'text',v_row.transcript_text,'segments',v_row.segments,'transcript_fingerprint',v_row.transcript_fingerprint,
      'provider',v_row.provider,'model',v_row.model,'detected_language',v_row.detected_language,'ruleset_fingerprint',v_fingerprint));
  end loop;
  return v_result;
end;
$$;

create function public.complete_content_safety_transcript_evaluation(p_transcript_id uuid,p_ruleset_fingerprint text,p_matches jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_t private.content_safety_audio_transcripts;v_scan private.content_safety_scans;v_snapshot jsonb;v_match jsonb;v_rule private.content_safety_rules;
  v_total integer;v_pending integer;v_recent integer;v_latest timestamptz;v_warnings integer;v_reach bigint;v_priority integer;v_count integer:=0;v_terms jsonb;v_fingerprint text;
begin
  if p_ruleset_fingerprint<>private.content_safety_transcript_ruleset_fingerprint() or jsonb_typeof(p_matches)<>'array' or jsonb_array_length(p_matches)>100 then
    raise exception using errcode='22023',message='invalid_transcript_evaluation';end if;
  select * into v_t from private.content_safety_audio_transcripts where id=p_transcript_id for update;
  if not found then raise exception using errcode='P0002',message='content_safety_transcript_not_found';end if;
  if v_t.rule_eval_status='completed' and v_t.rule_eval_ruleset_fingerprint=p_ruleset_fingerprint then return jsonb_build_object('transcript_id',v_t.id,'idempotent',true,'alerts_processed',0);end if;
  if v_t.rule_eval_status<>'processing' then raise exception using errcode='55000',message='content_safety_transcript_not_claimed';end if;
  select * into v_scan from private.content_safety_scans where id=v_t.source_scan_id;
  v_snapshot:=private.content_safety_target_snapshot(v_scan.target_type,v_scan.target_id);
  if v_snapshot is null then raise exception using errcode='P0002',message='content_safety_target_not_available';end if;
  select count(*)::integer,count(*) filter(where r.status='pending')::integer,count(*) filter(where r.status='pending' and r.created_at>=clock_timestamp()-interval '15 minutes')::integer,max(r.created_at)
    into v_total,v_pending,v_recent,v_latest from public.reports r where r.reported_content_type=v_scan.target_type and r.reported_content_id=v_scan.target_id;
  select count(*)::integer into v_warnings from private.admin_user_warnings w where w.target_user_id=v_scan.owner_user_id and w.status='active'
    and w.issued_at>coalesce((select max(a.completed_at) from private.admin_user_moderation_actions a where a.target_user_id=v_scan.owner_user_id and a.action='restore' and a.status='succeeded'),'-infinity'::timestamptz);
  v_warnings:=least(coalesce(v_warnings,0),3);v_reach:=greatest(coalesce((v_snapshot->>'reach')::bigint,0),0);
  for v_match in select value from jsonb_array_elements(p_matches) loop
    begin select * into strict v_rule from private.content_safety_rules r where r.id=(v_match->>'rule_id')::uuid and r.approval_state='approved' and r.enabled and 'transcript'=any(r.scopes);exception when others then raise exception using errcode='22023',message='invalid_transcript_rule_match';end;
    v_terms:=coalesce(v_match->'matched_terms','[]'::jsonb);if jsonb_typeof(v_terms)<>'array' or pg_column_size(v_terms)>2048 then raise exception using errcode='22023',message='invalid_transcript_evidence';end if;
    v_priority:=private.content_safety_priority(v_rule.severity,v_pending,v_recent,v_warnings,v_reach);
    v_fingerprint:=private.content_safety_sha256(v_t.id::text||'|audio_transcript_rule|'||v_rule.id::text||'|v'||v_rule.version::text);
    insert into private.content_safety_alerts(scan_id,target_type,target_id,owner_user_id,source_type,rule_id,category,severity,confidence,priority_score,alert_fingerprint,reach,related_report_count,pending_report_count,reports_last_15m,latest_report_at,active_warning_count,evidence)
    values(v_scan.id,v_scan.target_type,v_scan.target_id,v_scan.owner_user_id,'audio_transcript_rule',v_rule.id,v_rule.category,v_rule.severity,null,v_priority,v_fingerprint,v_reach,v_total,v_pending,v_recent,v_latest,v_warnings,
      jsonb_build_object('transcript_id',v_t.id,'transcript_fingerprint',v_t.transcript_fingerprint,'provider',v_t.provider,'model',v_t.model,'detected_language',v_t.detected_language,
        'matched_text_excerpt',left(coalesce(v_match->>'excerpt',''),240),'matched_transcript_excerpt',left(coalesce(v_match->>'excerpt',''),240),'matched_terms',v_terms,
        'timecode_start',v_match->'timecode_start','timecode_end',v_match->'timecode_end','rule_version',v_rule.version))
    on conflict(alert_fingerprint) do update set priority_score=excluded.priority_score,reach=excluded.reach,related_report_count=excluded.related_report_count,
      pending_report_count=excluded.pending_report_count,reports_last_15m=excluded.reports_last_15m,latest_report_at=excluded.latest_report_at,
      active_warning_count=excluded.active_warning_count,evidence=excluded.evidence,updated_at=clock_timestamp();
    v_count:=v_count+1;
  end loop;
  update private.content_safety_audio_transcripts set rule_eval_status='completed',rule_eval_ruleset_fingerprint=p_ruleset_fingerprint,
    rule_eval_completed_at=clock_timestamp(),rule_eval_started_at=null,rule_eval_last_error_code=null,updated_at=clock_timestamp() where id=v_t.id;
  return jsonb_build_object('transcript_id',v_t.id,'alerts_processed',v_count,'ruleset_fingerprint',p_ruleset_fingerprint);
end;
$$;

create function public.fail_content_safety_transcript_evaluation(p_transcript_id uuid,p_error_code text,p_retryable boolean default true)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_t private.content_safety_audio_transcripts;v_retry boolean;v_error text;
begin
  select * into v_t from private.content_safety_audio_transcripts where id=p_transcript_id for update;
  if not found then raise exception using errcode='P0002',message='content_safety_transcript_not_found';end if;
  v_retry:=coalesce(p_retryable,false) and v_t.rule_eval_attempt_count<5;v_error:=left(lower(regexp_replace(coalesce(nullif(btrim(p_error_code),''),'transcript_eval_error'),'[^a-z0-9_]+','_','g')),100);
  update private.content_safety_audio_transcripts set rule_eval_status=case when v_retry then 'pending' else 'failed' end,
    rule_eval_available_at=case when v_retry then clock_timestamp()+least(30,power(2,greatest(v_t.rule_eval_attempt_count,1)))::integer*interval '1 minute' else rule_eval_available_at end,
    rule_eval_started_at=null,rule_eval_completed_at=case when v_retry then null else clock_timestamp() end,rule_eval_last_error_code=v_error,updated_at=clock_timestamp() where id=v_t.id;
  return jsonb_build_object('transcript_id',v_t.id,'status',case when v_retry then 'pending' else 'failed' end,'retryable',v_retry);
end;
$$;

create or replace function private.guard_content_safety_alert_rule_provenance()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_rule private.content_safety_rules;v_transcript_id text;
begin
  if new.source_type in('text_rule','audio_transcript_rule') then
    select * into strict v_rule from private.content_safety_rules where id=new.rule_id;
    if not v_rule.enabled or v_rule.approval_state<>'approved' then raise exception using errcode='55000',message='content_safety_rule_not_active';end if;
    v_transcript_id:=coalesce(new.evidence->>'transcript_id','');
    new.alert_fingerprint:=private.content_safety_sha256(new.scan_id::text||'|'||new.source_type||'|'||v_transcript_id||'|'||v_rule.id::text||'|v'||v_rule.version::text);
    new.evidence:=coalesce(new.evidence,'{}'::jsonb)||jsonb_build_object('rule_code',v_rule.code,'rule_version',v_rule.version,
      'policy_source',v_rule.policy_source,'policy_reference',v_rule.policy_reference,'policy_version',v_rule.policy_version,'locale',v_rule.locale);
  end if;
  return new;
end;
$$;

create function public.search_admin_content_safety_audio()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
  perform public.admin_require_capability('content.items.read');
  return (with latest as(select distinct on(s.target_type,s.target_id) s.* from private.content_safety_scans s where s.target_type in('video','story') order by s.target_type,s.target_id,s.created_at desc,s.id desc), rows as(
    select s.*,coalesce(s.media_source_scan_id,s.id) effective_scan_id,t.id transcript_id,t.detected_language,t.word_count,t.no_speech,t.rule_eval_status,t.transcript_fingerprint,
      snap.value snapshot,up.username,up.display_name,up.avatar_url,source_scan.target_id source_target_id,va.duration_seconds,
      (select count(*) from private.content_safety_alerts a where a.scan_id=coalesce(s.media_source_scan_id,s.id) and a.source_type='audio_transcript_rule') rule_matches
    from latest s left join private.content_safety_scans source_scan on source_scan.id=s.media_source_scan_id
    left join private.content_safety_audio_transcripts t on t.source_scan_id=coalesce(s.media_source_scan_id,s.id) and t.source_content_fingerprint=coalesce(source_scan.content_fingerprint,s.content_fingerprint)
    left join public.video_assets va on va.id=coalesce(source_scan.audio_source_asset_id,s.audio_source_asset_id)
    left join public.user_profiles up on up.id=s.owner_user_id left join lateral(select private.content_safety_target_snapshot(s.target_type,s.target_id) value) snap on true)
    select jsonb_build_object('provider',jsonb_build_object('configured',true,'name','Cloudflare Workers AI','model','@cf/openai/whisper-large-v3-turbo',
      'status',case when exists(select 1 from private.content_safety_audio_transcripts) then 'healthy' when exists(select 1 from private.content_safety_scans where audio_last_error_code in('workers_ai_unauthorized','workers_ai_forbidden','workers_ai_model_unavailable')) then 'error' else 'awaiting_probe' end,
      'last_success_at',(select max(created_at) from private.content_safety_audio_transcripts),'last_error_code',(select audio_last_error_code from private.content_safety_scans where audio_last_error_code is not null order by updated_at desc limit 1)),
      'stats',jsonb_build_object('eligible',(select count(*) from rows where audio_status in('pending','analyzed','failed')),'pending',(select count(*) from rows where audio_status='pending'),
        'analyzed',(select count(*) from rows where audio_status='analyzed'),'failed',(select count(*) from rows where audio_status='failed'),'not_applicable',(select count(*) from rows where audio_status='not_applicable'),
        'not_configured',(select count(*) from rows where audio_status='not_configured'),'transcripts',(select count(*) from private.content_safety_audio_transcripts),
        'provider_calls',(select coalesce(sum(audio_provider_call_count),0) from private.content_safety_scans where target_type='video')),
      'items',coalesce((select jsonb_agg(jsonb_build_object('scan_id',r.id,'target_type',r.target_type,'target_id',r.target_id,'content_path',r.snapshot->>'path','summary',r.snapshot->>'summary',
        'author',jsonb_build_object('id',r.owner_user_id,'username',r.username,'display_name',r.display_name,'avatar_url',r.avatar_url),'audio_status',r.audio_status,'provider',r.audio_provider,'model',r.audio_model,
        'duration_seconds',r.duration_seconds,'detected_language',r.detected_language,'transcript_status',r.rule_eval_status,'word_count',r.word_count,'no_speech',r.no_speech,
        'rule_matches',r.rule_matches,'source_reused',r.media_source_scan_id is not null,'source_scan_id',r.media_source_scan_id,'source_target_id',r.source_target_id,
        'attempts',r.audio_attempt_count,'last_error_code',r.audio_last_error_code,'cleanup_pending',r.audio_cleanup_pending,'processed_at',r.audio_completed_at) order by r.created_at desc,r.id desc) from rows r),'[]'::jsonb)));
end;
$$;

create function public.get_admin_content_safety_audio_detail(p_scan_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_result jsonb;
begin
  perform public.admin_require_capability('content.items.read');
  select jsonb_build_object('scan_id',s.id,'target_type',s.target_type,'target_id',s.target_id,'content',jsonb_build_object('path',snap.value->>'path','summary',snap.value->>'summary'),
    'author',jsonb_build_object('id',s.owner_user_id,'username',up.username,'display_name',up.display_name,'avatar_url',up.avatar_url),
    'audio_status',s.audio_status,'provider',coalesce(src.audio_provider,s.audio_provider),'model',coalesce(src.audio_model,s.audio_model),'source_reused',s.media_source_scan_id is not null,
    'source_scan_id',s.media_source_scan_id,'source_target_id',src.target_id,'source_asset_id',coalesce(src.audio_source_asset_id,s.audio_source_asset_id),'duration_seconds',va.duration_seconds,
    'attempts',coalesce(src.audio_attempt_count,s.audio_attempt_count),'last_error_code',coalesce(src.audio_last_error_code,s.audio_last_error_code),
    'cleanup_pending',coalesce(src.audio_cleanup_pending,s.audio_cleanup_pending),'completed_at',coalesce(src.audio_completed_at,s.audio_completed_at),
    'transcript',case when t.id is null then null else jsonb_build_object('id',t.id,'text',t.transcript_text,'word_count',t.word_count,'segments',t.segments,'detected_language',t.detected_language,
      'no_speech',t.no_speech,'fingerprint',t.transcript_fingerprint,'rule_eval_status',t.rule_eval_status,'created_at',t.created_at,'updated_at',t.updated_at) end,
    'shared_references',(select coalesce(jsonb_agg(jsonb_build_object('id',st.id,'path','/stories/'||st.id::text) order by st.created_at,st.id),'[]'::jsonb) from public.stories st where st.shared_video_id=coalesce(src.target_id,s.target_id))) into v_result
  from private.content_safety_scans s left join private.content_safety_scans src on src.id=s.media_source_scan_id
  left join private.content_safety_audio_transcripts t on t.source_scan_id=coalesce(s.media_source_scan_id,s.id) and t.source_content_fingerprint=coalesce(src.content_fingerprint,s.content_fingerprint)
  left join public.video_assets va on va.id=coalesce(src.audio_source_asset_id,s.audio_source_asset_id)
  left join public.user_profiles up on up.id=s.owner_user_id left join lateral(select private.content_safety_target_snapshot(s.target_type,s.target_id) value) snap on true
  where s.id=p_scan_id;
  if v_result is null then raise exception using errcode='P0002',message='content_safety_audio_not_found';end if;return v_result;
end;
$$;

create function public.admin_retry_content_safety_audio(p_scan_id uuid,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_actor uuid;v_scan private.content_safety_scans;v_source_id uuid;v_scope text;v_fingerprint text;v_existing private.admin_action_audit;
begin
  v_actor:=public.admin_require_capability('content.items.moderate');v_scope:='v1|human|'||v_actor::text||'|content.items.moderate|content_safety.audio.retry';
  v_fingerprint:=private.content_safety_sha256(jsonb_build_object('scan_id',p_scan_id)::text);
  select * into v_existing from private.admin_action_audit where idempotency_scope=v_scope and idempotency_key=p_idempotency_key;
  if found then if v_existing.request_fingerprint<>v_fingerprint then raise exception using errcode='23505',message='admin_idempotency_conflict';end if;return v_existing.metadata||jsonb_build_object('idempotent',true);end if;
  select * into v_scan from private.content_safety_scans where id=p_scan_id for update;if not found then raise exception using errcode='P0002',message='content_safety_audio_not_found';end if;
  v_source_id:=coalesce(v_scan.media_source_scan_id,v_scan.id);select * into v_scan from private.content_safety_scans where id=v_source_id for update;
  if v_scan.audio_status<>'failed' then raise exception using errcode='55000',message='content_safety_audio_not_failed';end if;
  update private.content_safety_scans set audio_status='pending',audio_attempt_count=0,audio_available_at=clock_timestamp(),audio_started_at=null,audio_completed_at=null,audio_last_error_code=null,updated_at=clock_timestamp() where id=v_source_id;
  insert into private.admin_action_audit(actor_id,actor_kind,actor_role_snapshot,actor_capability,domain,action,target_type,target_id,target_ref,outcome,reason,financial_effect,contains_pii,idempotency_scope,idempotency_key,request_fingerprint,metadata)
  values(v_actor,'human_admin',private.admin_active_role_codes(v_actor),'content.items.moderate','content_safety','content_safety.audio.retry','content_safety_scan',v_source_id,v_source_id::text,'succeeded',null,false,false,v_scope,p_idempotency_key,v_fingerprint,jsonb_build_object('scan_id',v_source_id,'audio_status','pending'));
  return jsonb_build_object('scan_id',v_source_id,'audio_status','pending','idempotent',false);
end;
$$;

revoke all on function private.content_safety_audio_source(text,uuid) from public,anon,authenticated,service_role;
revoke all on function private.initialize_content_safety_audio_for_new_scan() from public,anon,authenticated,service_role;
revoke all on function private.content_safety_transcript_ruleset_fingerprint() from public,anon,authenticated,service_role;
revoke all on function private.mark_content_safety_transcripts_for_reevaluation() from public,anon,authenticated,service_role;
revoke all on function public.refresh_content_safety_audio_eligibility(integer) from public,anon,authenticated,service_role;
revoke all on function public.claim_content_safety_audio_scans(integer) from public,anon,authenticated,service_role;
revoke all on function public.complete_content_safety_audio_transcription(uuid,uuid,text,text,text,integer,jsonb,boolean,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.fail_content_safety_audio_scan(uuid,text,boolean,boolean) from public,anon,authenticated,service_role;
revoke all on function public.claim_content_safety_audio_cleanup(integer) from public,anon,authenticated,service_role;
revoke all on function public.complete_content_safety_audio_cleanup(uuid) from public,anon,authenticated,service_role;
revoke all on function public.claim_content_safety_transcript_evaluations(integer) from public,anon,authenticated,service_role;
revoke all on function public.complete_content_safety_transcript_evaluation(uuid,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.fail_content_safety_transcript_evaluation(uuid,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.refresh_content_safety_audio_eligibility(integer) to service_role;
grant execute on function public.claim_content_safety_audio_scans(integer) to service_role;
grant execute on function public.complete_content_safety_audio_transcription(uuid,uuid,text,text,text,integer,jsonb,boolean,text,boolean) to service_role;
grant execute on function public.fail_content_safety_audio_scan(uuid,text,boolean,boolean) to service_role;
grant execute on function public.claim_content_safety_audio_cleanup(integer) to service_role;
grant execute on function public.complete_content_safety_audio_cleanup(uuid) to service_role;
grant execute on function public.claim_content_safety_transcript_evaluations(integer) to service_role;
grant execute on function public.complete_content_safety_transcript_evaluation(uuid,text,jsonb) to service_role;
grant execute on function public.fail_content_safety_transcript_evaluation(uuid,text,boolean) to service_role;

revoke all on function public.search_admin_content_safety_audio() from public,anon,authenticated,service_role;
revoke all on function public.get_admin_content_safety_audio_detail(uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_retry_content_safety_audio(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.search_admin_content_safety_audio() to authenticated;
grant execute on function public.get_admin_content_safety_audio_detail(uuid) to authenticated;
grant execute on function public.admin_retry_content_safety_audio(uuid,uuid) to authenticated;

comment on table private.content_safety_audio_transcripts is 'Private Cloudflare Workers AI speech transcripts. Evidence only; never an enforcement authority and never stores audio/provider payloads.';
comment on function public.refresh_content_safety_audio_eligibility(integer) is 'Service-only canonical Stream audio resolution. Deployment does not invoke it; ordinary private messages and LIVE audio are excluded.';
comment on function public.complete_content_safety_transcript_evaluation(uuid,text,jsonb) is 'Creates audio_transcript_rule alerts with null confidence for human review; never warns, hides, suspends, deletes, or moves funds.';

commit;
