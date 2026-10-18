begin;

-- P2 checkpoint one adds bound contextual evidence to the existing scanner.
-- It deliberately does not activate P1 or change the canonical finalizer.
create table private.creator_premium_content_safety_context_evaluations (
  id uuid primary key default gen_random_uuid(),
  source_scan_id uuid not null references private.content_safety_scans(id)
    on update restrict on delete restrict,
  target_id uuid not null references private.creator_premium_contents(id)
    on update restrict on delete restrict,
  owner_user_id uuid not null references public.user_profiles(id)
    on update restrict on delete restrict,
  source_content_fingerprint text not null,
  policy_id text not null default 'nelyon.creator_premium.general.p1.v1',
  schema_version text not null default 'creator-premium-context-p2-v1',
  provider text not null default 'cloudflare_workers_ai',
  model text not null default '@cf/google/gemma-4-26b-a4b-it',
  prompt_version text not null default 'creator-premium-context-p2-v1',
  transcript_coverage text not null,
  transcript_id uuid null references private.content_safety_audio_transcripts(id)
    on update restrict on delete restrict,
  transcript_fingerprint text null,
  visual_analysis_id uuid not null references private.content_safety_visual_analyses(id)
    on update restrict on delete restrict,
  visual_analysis_fingerprint text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  provider_call_count integer not null default 0,
  available_at timestamptz not null default pg_catalog.clock_timestamp(),
  started_at timestamptz null,
  completed_at timestamptz null,
  last_error_code text null,
  context_result jsonb null,
  evaluation_fingerprint text null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint creator_premium_context_source_fingerprint_check
    check (source_content_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint creator_premium_context_policy_check
    check (policy_id = 'nelyon.creator_premium.general.p1.v1'),
  constraint creator_premium_context_schema_check
    check (schema_version = 'creator-premium-context-p2-v1'),
  constraint creator_premium_context_provider_check
    check (provider = 'cloudflare_workers_ai'),
  constraint creator_premium_context_model_check
    check (model = '@cf/google/gemma-4-26b-a4b-it'),
  constraint creator_premium_context_prompt_check
    check (prompt_version = 'creator-premium-context-p2-v1'),
  constraint creator_premium_context_transcript_coverage_check
    check (transcript_coverage in ('complete','no_speech','not_applicable')),
  constraint creator_premium_context_transcript_binding_check check (
    (transcript_coverage = 'not_applicable'
      and transcript_id is null and transcript_fingerprint is null)
    or (transcript_coverage in ('complete','no_speech')
      and transcript_id is not null
      and transcript_fingerprint ~ '^[0-9a-f]{64}$')
  ),
  constraint creator_premium_context_visual_fingerprint_check
    check (visual_analysis_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint creator_premium_context_status_check
    check (status in ('pending','processing','completed','failed')),
  constraint creator_premium_context_attempt_check
    check (attempt_count between 0 and 5),
  constraint creator_premium_context_provider_call_check
    check (provider_call_count between 0 and 5),
  constraint creator_premium_context_error_check check (
    last_error_code is null
    or (last_error_code = pg_catalog.btrim(last_error_code)
      and pg_catalog.char_length(last_error_code) between 2 and 100)
  ),
  constraint creator_premium_context_result_check check (
    context_result is null
    or (pg_catalog.jsonb_typeof(context_result) = 'object'
      and pg_catalog.pg_column_size(context_result) <= 16384)
  ),
  constraint creator_premium_context_evaluation_fingerprint_check check (
    evaluation_fingerprint is null
    or evaluation_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  constraint creator_premium_context_state_check check (
    (status in ('pending','processing')
      and completed_at is null
      and context_result is null
      and evaluation_fingerprint is null)
    or (status = 'failed'
      and completed_at is not null
      and context_result is null
      and evaluation_fingerprint is null)
    or (status = 'completed'
      and completed_at is not null
      and context_result is not null
      and evaluation_fingerprint is not null
      and last_error_code is null)
  ),
  constraint creator_premium_context_timestamps_check check (
    (started_at is null or started_at >= created_at)
    and (completed_at is null or completed_at >= created_at)
    and updated_at >= created_at
  ),
  unique (source_scan_id,source_content_fingerprint,policy_id,prompt_version)
);

create index creator_premium_context_queue_idx
  on private.creator_premium_content_safety_context_evaluations(
    available_at,created_at,id
  ) where status in ('pending','processing');
create index creator_premium_context_target_idx
  on private.creator_premium_content_safety_context_evaluations(
    target_id,created_at desc,id desc
  );

alter table private.creator_premium_content_safety_context_evaluations
  enable row level security;
alter table private.creator_premium_content_safety_context_evaluations
  force row level security;
revoke all privileges on table
  private.creator_premium_content_safety_context_evaluations
  from public, anon, authenticated, service_role;

create function private.creator_premium_content_safety_context_result_valid_p2_v1(
  p_result jsonb,
  p_transcript_coverage text
) returns boolean
language plpgsql immutable
set search_path = ''
as $$
declare
  v_keys text[];
  v_coverage_keys text[];
  v_categories text[];
  v_rationale_codes text[];
  v_decision text;
  v_uncertainty text;
  v_age_uncertainty text;
  v_consent_uncertainty text;
  v_allow constant text[] := array[
    'courses','tutorials','education','entertainment','dance','humor','sport',
    'fashion','kissing_and_affection','swimwear','non_explicit_sensual_clothing',
    'non_sexual_artistic_content'
  ]::text[];
  v_review constant text[] := array[
    'contextual_artistic_or_medical_nudity',
    'incidental_blood_or_informational_context','documentary_violence',
    'age_uncertain','consent_uncertain','contradictory_signals',
    'low_confidence','incomplete_multimodal_coverage'
  ]::text[];
  v_block constant text[] := array[
    'explicit_sexual_activity','pornography',
    'sexualized_explicit_genital_exposure','child_sexual_exploitation',
    'non_consensual_intimate_content','sexual_violence','torture','mutilation',
    'graphic_murder','graphic_serious_assault',
    'explicit_promotion_of_severe_harm'
  ]::text[];
  v_rationale constant text[] := array[
    'benign_context','educational_context','quoted_or_negated_context',
    'swimwear_or_non_explicit_context','ambiguous_context',
    'age_requires_review','consent_requires_review','severe_explicit_context',
    'violent_threat_context','contradictory_signals','visual_review_signal',
    'no_speech'
  ]::text[];
begin
  if pg_catalog.jsonb_typeof(p_result) is distinct from 'object'
     or pg_catalog.pg_column_size(p_result) > 16384
     or p_transcript_coverage not in ('complete','no_speech','not_applicable') then
    return false;
  end if;
  select pg_catalog.array_agg(key order by key) into v_keys
  from pg_catalog.jsonb_object_keys(p_result) key;
  if v_keys is distinct from array[
    'age_uncertainty','categories','certainty_basis','consent_uncertainty',
    'coverage','decision','policy_id','rationale_codes','schema_version',
    'uncertainty'
  ]::text[] then return false;end if;
  if p_result->>'schema_version' <> 'creator-premium-context-p2-v1'
     or p_result->>'policy_id' <> 'nelyon.creator_premium.general.p1.v1'
     or p_result->>'certainty_basis' <> 'discrete_contract'
     or p_result->>'decision' not in ('allow','review','block')
     or p_result->>'uncertainty' not in ('unambiguous','ambiguous')
     or p_result->>'age_uncertainty' not in ('not_relevant','present')
     or p_result->>'consent_uncertainty' not in ('not_relevant','present') then
    return false;
  end if;
  if pg_catalog.jsonb_typeof(p_result->'coverage') is distinct from 'object' then
    return false;
  end if;
  select pg_catalog.array_agg(key order by key) into v_coverage_keys
  from pg_catalog.jsonb_object_keys(p_result->'coverage') key;
  if v_coverage_keys is distinct from array['text','transcript','visual']::text[]
     or p_result#>>'{coverage,text}' <> 'complete'
     or p_result#>>'{coverage,transcript}' <> p_transcript_coverage
     or p_result#>>'{coverage,visual}' <> 'complete' then
    return false;
  end if;
  if pg_catalog.jsonb_typeof(p_result->'categories') is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_result->'categories') not between 1 and 8
     or exists(
       select 1 from pg_catalog.jsonb_array_elements(p_result->'categories') item
       where pg_catalog.jsonb_typeof(item) <> 'string'
     ) then return false;end if;
  select pg_catalog.array_agg(value order by value) into v_categories
  from pg_catalog.jsonb_array_elements_text(p_result->'categories') value;
  if pg_catalog.cardinality(v_categories)
       <> pg_catalog.cardinality(array(select distinct value from unnest(v_categories) value))
     or not v_categories <@ (v_allow||v_review||v_block) then
    return false;
  end if;
  if pg_catalog.jsonb_typeof(p_result->'rationale_codes') is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_result->'rationale_codes') not between 1 and 8
     or exists(
       select 1 from pg_catalog.jsonb_array_elements(p_result->'rationale_codes') item
       where pg_catalog.jsonb_typeof(item) <> 'string'
     ) then return false;end if;
  select pg_catalog.array_agg(value order by value) into v_rationale_codes
  from pg_catalog.jsonb_array_elements_text(p_result->'rationale_codes') value;
  if pg_catalog.cardinality(v_rationale_codes)
       <> pg_catalog.cardinality(array(select distinct value from unnest(v_rationale_codes) value))
     or not v_rationale_codes <@ v_rationale then
    return false;
  end if;
  v_decision := p_result->>'decision';
  v_uncertainty := p_result->>'uncertainty';
  v_age_uncertainty := p_result->>'age_uncertainty';
  v_consent_uncertainty := p_result->>'consent_uncertainty';
  if v_decision='allow' and (
       not v_categories <@ v_allow
       or v_uncertainty<>'unambiguous'
       or v_age_uncertainty<>'not_relevant'
       or v_consent_uncertainty<>'not_relevant'
     ) then return false;end if;
  if v_decision='review' and (
       v_categories && v_block
       or (not v_categories && v_review
         and v_uncertainty<>'ambiguous'
         and v_age_uncertainty<>'present'
         and v_consent_uncertainty<>'present')
     ) then return false;end if;
  if v_decision='block' and (
       v_uncertainty<>'unambiguous' or not v_categories <@ v_block
     ) then return false;end if;
  if v_age_uncertainty='present'
     and not v_categories && array['age_uncertain','child_sexual_exploitation']::text[]
     then return false;end if;
  if 'age_uncertain'=any(v_categories) and v_age_uncertainty<>'present'
     then return false;end if;
  if v_consent_uncertainty='present'
     and not v_categories && array[
       'consent_uncertain','non_consensual_intimate_content','sexual_violence'
     ]::text[] then return false;end if;
  if 'consent_uncertain'=any(v_categories)
     and v_consent_uncertainty<>'present' then return false;end if;
  if 'child_sexual_exploitation'=any(v_categories)
     and v_age_uncertainty<>'present' then return false;end if;
  if v_categories && array[
       'non_consensual_intimate_content','sexual_violence'
     ]::text[] and v_consent_uncertainty<>'present' then return false;end if;
  return true;
end;
$$;

create function public.claim_creator_premium_content_safety_context_v1(
  p_limit integer default 1
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row record;
  v_result jsonb := '[]'::jsonb;
begin
  if p_limit < 1 or p_limit > 1 then
    raise exception using errcode='22023',
      message='invalid_creator_premium_context_claim_limit';
  end if;

  insert into private.creator_premium_content_safety_context_evaluations(
    source_scan_id,target_id,owner_user_id,source_content_fingerprint,
    transcript_coverage,transcript_id,transcript_fingerprint,
    visual_analysis_id,visual_analysis_fingerprint
  )
  select
    scan.id,content.id,content.creator_id,scan.content_fingerprint,
    case when content.content_kind='image' then 'not_applicable'
      when transcript.no_speech then 'no_speech' else 'complete' end,
    transcript.id,transcript.transcript_fingerprint,
    analysis.id,analysis.analysis_fingerprint
  from private.content_safety_scans scan
  join private.creator_premium_contents content
    on content.id=scan.target_id
  join private.content_safety_visual_analyses analysis
    on analysis.id=scan.visual_analysis_id
  left join lateral (
    select candidate.*
    from private.content_safety_audio_transcripts candidate
    where content.content_kind='video'
      and candidate.source_scan_id=scan.id
      and candidate.source_content_fingerprint=scan.content_fingerprint
      and candidate.provider='cloudflare_workers_ai'
      and candidate.model='@cf/openai/whisper-large-v3-turbo'
      and candidate.rule_eval_status='completed'
      and (candidate.no_speech
        or pg_catalog.char_length(pg_catalog.btrim(candidate.transcript_text))>0)
    order by candidate.created_at desc,candidate.id desc
    limit 1
  ) transcript on true
  cross join lateral (
    select private.content_safety_target_snapshot(
      'creator_premium',content.id
    ) value
  ) snapshot
  where scan.target_type='creator_premium'
    and scan.status='completed'
    and scan.text_status='analyzed'
    and scan.reports_status='analyzed'
    and scan.visual_status='analyzed'
    and scan.owner_user_id=content.creator_id
    and content.lifecycle_status='pending_review'
    and content.verification_scan_id=scan.id
    and content.verification_fingerprint=scan.content_fingerprint
    and snapshot.value is not null
    and scan.content_fingerprint=private.content_safety_sha256(
      'creator_premium|'||content.id::text||'|'||
      coalesce(snapshot.value->>'content_version','')
    )
    and analysis.provider='cloudflare_workers_ai'
    and analysis.model='@cf/google/gemma-4-26b-a4b-it'
    and analysis.prompt_version='visual-safety-v1'
    and ((content.content_kind='image'
        and scan.audio_status='not_applicable'
        and transcript.id is null
        and analysis.media_asset_id=scan.visual_media_asset_id)
      or (content.content_kind='video'
        and scan.audio_status='analyzed'
        and transcript.id is not null
        and analysis.video_asset_id=scan.visual_video_asset_id))
  on conflict(source_scan_id,source_content_fingerprint,policy_id,prompt_version)
    do nothing;

  for v_row in
    select
      evaluation.id evaluation_id,evaluation.source_scan_id,
      evaluation.source_content_fingerprint,evaluation.attempt_count,
      evaluation.transcript_coverage,
      snapshot.value->>'text_value' text,
      case when evaluation.transcript_coverage='complete'
        then transcript.transcript_text else '' end transcript_text,
      analysis.analysis_result visual_result
    from private.creator_premium_content_safety_context_evaluations evaluation
    join private.content_safety_scans scan
      on scan.id=evaluation.source_scan_id
    join private.creator_premium_contents content
      on content.id=evaluation.target_id
    join private.content_safety_visual_analyses analysis
      on analysis.id=evaluation.visual_analysis_id
      and analysis.analysis_fingerprint=evaluation.visual_analysis_fingerprint
    left join private.content_safety_audio_transcripts transcript
      on transcript.id=evaluation.transcript_id
      and transcript.transcript_fingerprint=evaluation.transcript_fingerprint
    cross join lateral (
      select private.content_safety_target_snapshot(
        'creator_premium',content.id
      ) value
    ) snapshot
    where evaluation.status in ('pending','processing')
      and evaluation.attempt_count<5
      and evaluation.provider_call_count<5
      and evaluation.available_at<=pg_catalog.clock_timestamp()
      and (evaluation.started_at is null
        or evaluation.started_at<pg_catalog.clock_timestamp()-interval '10 minutes')
      and scan.target_type='creator_premium'
      and scan.status='completed'
      and scan.text_status='analyzed'
      and scan.reports_status='analyzed'
      and scan.visual_status='analyzed'
      and scan.content_fingerprint=evaluation.source_content_fingerprint
      and scan.visual_analysis_id=evaluation.visual_analysis_id
      and content.creator_id=evaluation.owner_user_id
      and content.lifecycle_status='pending_review'
      and content.verification_scan_id=scan.id
      and content.verification_fingerprint=scan.content_fingerprint
      and snapshot.value is not null
      and scan.content_fingerprint=private.content_safety_sha256(
        'creator_premium|'||content.id::text||'|'||
        coalesce(snapshot.value->>'content_version','')
      )
      and ((content.content_kind='image'
          and evaluation.transcript_coverage='not_applicable'
          and transcript.id is null)
        or (content.content_kind='video'
          and evaluation.transcript_coverage in ('complete','no_speech')
          and transcript.id is not null
          and transcript.rule_eval_status='completed'))
    order by evaluation.available_at,evaluation.created_at,evaluation.id
    for update of evaluation skip locked limit p_limit
  loop
    update private.creator_premium_content_safety_context_evaluations set
      status='processing',attempt_count=attempt_count+1,
      started_at=pg_catalog.clock_timestamp(),completed_at=null,
      last_error_code=null,updated_at=pg_catalog.clock_timestamp()
    where id=v_row.evaluation_id;
    v_result:=v_result||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'scan_id',v_row.source_scan_id,
        'content_fingerprint',v_row.source_content_fingerprint,
        'text',coalesce(v_row.text,''),
        'transcript_coverage',v_row.transcript_coverage,
        'transcript_text',coalesce(v_row.transcript_text,''),
        'visual_result',v_row.visual_result,
        'attempt_count',v_row.attempt_count+1
      )
    );
  end loop;
  return v_result;
end;
$$;

create function public.complete_creator_premium_content_safety_context_v1(
  p_scan_id uuid,
  p_content_fingerprint text,
  p_attempt_count integer,
  p_context_result jsonb
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_evaluation private.creator_premium_content_safety_context_evaluations;
  v_scan private.content_safety_scans;
  v_content private.creator_premium_contents;
  v_analysis private.content_safety_visual_analyses;
  v_transcript private.content_safety_audio_transcripts;
  v_snapshot jsonb;
  v_fingerprint text;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-premium-context:'||p_scan_id::text,0)
  );
  select * into v_evaluation
  from private.creator_premium_content_safety_context_evaluations
  where source_scan_id=p_scan_id
    and source_content_fingerprint=p_content_fingerprint
    and policy_id='nelyon.creator_premium.general.p1.v1'
    and prompt_version='creator-premium-context-p2-v1'
  for update;
  if not found then
    raise exception using errcode='P0002',
      message='creator_premium_context_evaluation_not_found';
  end if;
  if p_attempt_count is null
     or p_attempt_count<>v_evaluation.attempt_count then
    raise exception using errcode='55000',
      message='creator_premium_context_attempt_stale';
  end if;
  if v_evaluation.status='completed' then
    if v_evaluation.context_result is not distinct from p_context_result then
      return pg_catalog.jsonb_build_object(
        'scan_id',v_evaluation.source_scan_id,'context_status','completed',
        'decision',v_evaluation.context_result->>'decision',
        'evaluation_fingerprint',v_evaluation.evaluation_fingerprint,
        'replayed',true
      );
    end if;
    raise exception using errcode='23505',
      message='creator_premium_context_completion_conflict';
  end if;
  if v_evaluation.status<>'processing'
     or p_content_fingerprint!~'^[0-9a-f]{64}$'
     or not private.creator_premium_content_safety_context_result_valid_p2_v1(
       p_context_result,v_evaluation.transcript_coverage
     ) then
    raise exception using errcode='22023',
      message='creator_premium_context_schema_invalid';
  end if;
  select * into v_scan from private.content_safety_scans
  where id=v_evaluation.source_scan_id for share;
  select * into v_content from private.creator_premium_contents
  where id=v_evaluation.target_id for share;
  select * into v_analysis from private.content_safety_visual_analyses
  where id=v_evaluation.visual_analysis_id;
  if not found then
    raise exception using errcode='55000',
      message='creator_premium_context_binding_invalid';
  end if;
  v_snapshot:=private.content_safety_target_snapshot(
    'creator_premium',v_evaluation.target_id
  );
  if v_scan.id is null or v_content.id is null or v_snapshot is null
     or v_scan.target_type<>'creator_premium'
     or v_scan.status<>'completed'
     or v_scan.text_status<>'analyzed'
     or v_scan.reports_status<>'analyzed'
     or v_scan.visual_status<>'analyzed'
     or v_scan.owner_user_id is distinct from v_evaluation.owner_user_id
     or v_scan.content_fingerprint<>v_evaluation.source_content_fingerprint
     or v_content.creator_id<>v_evaluation.owner_user_id
     or v_content.lifecycle_status<>'pending_review'
     or v_content.verification_scan_id is distinct from v_scan.id
     or v_content.verification_fingerprint is distinct from v_scan.content_fingerprint
     or v_scan.content_fingerprint<>private.content_safety_sha256(
       'creator_premium|'||v_content.id::text||'|'||
       coalesce(v_snapshot->>'content_version','')
     )
     or v_scan.visual_analysis_id is distinct from v_analysis.id
     or v_analysis.analysis_fingerprint<>
       v_evaluation.visual_analysis_fingerprint
     or v_analysis.provider<>'cloudflare_workers_ai'
     or v_analysis.model<>'@cf/google/gemma-4-26b-a4b-it'
     or v_analysis.prompt_version<>'visual-safety-v1'
     or (v_content.content_kind='image'
       and v_analysis.media_asset_id is distinct from v_scan.visual_media_asset_id)
     or (v_content.content_kind='video'
       and v_analysis.video_asset_id is distinct from v_scan.visual_video_asset_id)
     then
    raise exception using errcode='55000',
      message='creator_premium_context_binding_invalid';
  end if;
  if v_evaluation.transcript_coverage<>'not_applicable' then
    select * into v_transcript from private.content_safety_audio_transcripts
    where id=v_evaluation.transcript_id;
    if not found
       or v_content.content_kind<>'video'
       or v_scan.audio_status<>'analyzed'
       or v_transcript.source_scan_id<>v_scan.id
       or v_transcript.source_content_fingerprint<>v_scan.content_fingerprint
       or v_transcript.transcript_fingerprint<>
         v_evaluation.transcript_fingerprint
       or v_transcript.rule_eval_status<>'completed'
       or (v_evaluation.transcript_coverage='no_speech'
         and not v_transcript.no_speech)
       or (v_evaluation.transcript_coverage='complete'
         and (v_transcript.no_speech
           or pg_catalog.char_length(
             pg_catalog.btrim(v_transcript.transcript_text)
           )=0)) then
      raise exception using errcode='55000',
        message='creator_premium_context_transcript_binding_invalid';
    end if;
  elsif v_content.content_kind<>'image'
        or v_scan.audio_status<>'not_applicable'
        or v_evaluation.transcript_id is not null then
    raise exception using errcode='55000',
      message='creator_premium_context_transcript_binding_invalid';
  end if;
  if v_evaluation.provider_call_count>=5 then
    raise exception using errcode='55000',
      message='creator_premium_context_provider_limit_reached';
  end if;
  v_fingerprint:=private.content_safety_sha256(
    v_evaluation.source_scan_id::text||'|'||
    v_evaluation.source_content_fingerprint||'|'||
    v_evaluation.policy_id||'|'||v_evaluation.provider||'|'||
    v_evaluation.model||'|'||v_evaluation.prompt_version||'|'||
    v_evaluation.transcript_coverage||'|'||
    coalesce(v_evaluation.transcript_id::text,'')||'|'||
    coalesce(v_evaluation.transcript_fingerprint,'')||'|'||
    v_evaluation.visual_analysis_id::text||'|'||
    v_evaluation.visual_analysis_fingerprint||'|'||
    p_context_result::text
  );
  update private.creator_premium_content_safety_context_evaluations set
    status='completed',provider_call_count=provider_call_count+1,
    completed_at=pg_catalog.clock_timestamp(),started_at=null,
    last_error_code=null,context_result=p_context_result,
    evaluation_fingerprint=v_fingerprint,
    updated_at=pg_catalog.clock_timestamp()
  where id=v_evaluation.id;
  return pg_catalog.jsonb_build_object(
    'scan_id',v_evaluation.source_scan_id,'context_status','completed',
    'decision',p_context_result->>'decision',
    'evaluation_fingerprint',v_fingerprint,'replayed',false
  );
end;
$$;

create function public.fail_creator_premium_content_safety_context_v1(
  p_scan_id uuid,
  p_content_fingerprint text,
  p_attempt_count integer,
  p_error_code text,
  p_retryable boolean,
  p_provider_called boolean
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_evaluation private.creator_premium_content_safety_context_evaluations;
  v_provider_calls integer;
  v_retry boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-premium-context:'||p_scan_id::text,0)
  );
  select * into v_evaluation
  from private.creator_premium_content_safety_context_evaluations
  where source_scan_id=p_scan_id
    and source_content_fingerprint=p_content_fingerprint
    and policy_id='nelyon.creator_premium.general.p1.v1'
    and prompt_version='creator-premium-context-p2-v1'
  for update;
  if not found then
    raise exception using errcode='P0002',
      message='creator_premium_context_evaluation_not_found';
  end if;
  if p_attempt_count is null
     or p_attempt_count<>v_evaluation.attempt_count then
    raise exception using errcode='55000',
      message='creator_premium_context_attempt_stale';
  end if;
  if v_evaluation.status='completed' then
    return pg_catalog.jsonb_build_object(
      'scan_id',v_evaluation.source_scan_id,'context_status','completed',
      'attempt_count',v_evaluation.attempt_count,
      'provider_call_count',v_evaluation.provider_call_count
    );
  end if;
  if v_evaluation.status<>'processing'
     or p_error_code is null
     or p_error_code<>pg_catalog.btrim(p_error_code)
     or pg_catalog.char_length(p_error_code) not between 2 and 100 then
    raise exception using errcode='22023',
      message='invalid_creator_premium_context_failure';
  end if;
  v_provider_calls:=v_evaluation.provider_call_count+
    case when coalesce(p_provider_called,false) then 1 else 0 end;
  if v_provider_calls>5 then
    raise exception using errcode='55000',
      message='creator_premium_context_provider_limit_reached';
  end if;
  v_retry:=coalesce(p_retryable,false)
    and v_evaluation.attempt_count<5 and v_provider_calls<5;
  update private.creator_premium_content_safety_context_evaluations set
    status=case when v_retry then 'pending' else 'failed' end,
    provider_call_count=v_provider_calls,
    available_at=case when v_retry then pg_catalog.clock_timestamp()+
      pg_catalog.make_interval(secs=>least(
        900,(30*pg_catalog.power(2,
          greatest(v_evaluation.attempt_count-1,0)))::integer
      )) else available_at end,
    started_at=null,
    completed_at=case when v_retry then null else pg_catalog.clock_timestamp() end,
    last_error_code=p_error_code,
    updated_at=pg_catalog.clock_timestamp()
  where id=v_evaluation.id;
  return pg_catalog.jsonb_build_object(
    'scan_id',v_evaluation.source_scan_id,
    'context_status',case when v_retry then 'pending' else 'failed' end,
    'attempt_count',v_evaluation.attempt_count,
    'provider_call_count',v_provider_calls
  );
end;
$$;

create function private.creator_premium_content_safety_candidate_p2_v1(
  p_scan_id uuid
) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_scan private.content_safety_scans;
  v_content private.creator_premium_contents;
  v_evaluation private.creator_premium_content_safety_context_evaluations;
  v_snapshot jsonb;
  v_decision text;
begin
  select * into v_scan from private.content_safety_scans
  where id=p_scan_id;
  if not found or v_scan.target_type<>'creator_premium' then
    return pg_catalog.jsonb_build_object(
      'scan_id',p_scan_id,'policy_id','nelyon.creator_premium.general.p1.v1',
      'decision','technical_failure','reason','creator_premium_scan_missing'
    );
  end if;
  select * into v_content from private.creator_premium_contents
  where id=v_scan.target_id;
  if not found or v_content.lifecycle_status<>'pending_review'
     or v_content.creator_id is distinct from v_scan.owner_user_id
     or v_content.verification_scan_id is distinct from v_scan.id
     or v_content.verification_fingerprint is distinct from
       v_scan.content_fingerprint then
    return pg_catalog.jsonb_build_object(
      'scan_id',v_scan.id,'policy_id','nelyon.creator_premium.general.p1.v1',
      'decision','technical_failure',
      'reason','creator_premium_scan_binding_invalid'
    );
  end if;
  v_snapshot:=private.content_safety_target_snapshot(
    'creator_premium',v_content.id
  );
  if v_snapshot is null
     or v_scan.content_fingerprint<>private.content_safety_sha256(
       'creator_premium|'||v_content.id::text||'|'||
       coalesce(v_snapshot->>'content_version','')
     ) then
    return pg_catalog.jsonb_build_object(
      'scan_id',v_scan.id,'content_id',v_content.id,
      'policy_id','nelyon.creator_premium.general.p1.v1',
      'decision','technical_failure',
      'reason','creator_premium_context_stale_content_version'
    );
  end if;
  select * into v_evaluation
  from private.creator_premium_content_safety_context_evaluations
  where source_scan_id=v_scan.id
    and source_content_fingerprint=v_scan.content_fingerprint
    and policy_id='nelyon.creator_premium.general.p1.v1'
    and schema_version='creator-premium-context-p2-v1'
    and provider='cloudflare_workers_ai'
    and model='@cf/google/gemma-4-26b-a4b-it'
    and prompt_version='creator-premium-context-p2-v1'
    and status='completed'
  order by created_at desc,id desc limit 1;
  if not found
     or v_evaluation.visual_analysis_id is distinct from
       v_scan.visual_analysis_id
     or not private.creator_premium_content_safety_context_result_valid_p2_v1(
       v_evaluation.context_result,v_evaluation.transcript_coverage
     )
     or not exists(
       select 1 from private.content_safety_visual_analyses analysis
       where analysis.id=v_evaluation.visual_analysis_id
         and analysis.analysis_fingerprint=
           v_evaluation.visual_analysis_fingerprint
         and analysis.provider='cloudflare_workers_ai'
         and analysis.model='@cf/google/gemma-4-26b-a4b-it'
         and analysis.prompt_version='visual-safety-v1'
         and ((v_content.content_kind='image'
             and analysis.media_asset_id=v_scan.visual_media_asset_id)
           or (v_content.content_kind='video'
             and analysis.video_asset_id=v_scan.visual_video_asset_id))
     )
     or (v_content.content_kind='image' and (
       v_evaluation.transcript_coverage<>'not_applicable'
       or v_evaluation.transcript_id is not null
       or v_scan.audio_status<>'not_applicable'
     ))
     or (v_content.content_kind='video' and (
       v_scan.audio_status<>'analyzed'
       or v_evaluation.transcript_coverage not in ('complete','no_speech')
       or not exists(
         select 1 from private.content_safety_audio_transcripts transcript
         where transcript.id=v_evaluation.transcript_id
           and transcript.source_scan_id=v_scan.id
           and transcript.source_content_fingerprint=v_scan.content_fingerprint
           and transcript.transcript_fingerprint=
             v_evaluation.transcript_fingerprint
           and transcript.rule_eval_status='completed'
           and ((v_evaluation.transcript_coverage='no_speech'
               and transcript.no_speech)
             or (v_evaluation.transcript_coverage='complete'
               and not transcript.no_speech
               and pg_catalog.char_length(
                 pg_catalog.btrim(transcript.transcript_text)
               )>0))
       )
     )) then
    return pg_catalog.jsonb_build_object(
      'scan_id',v_scan.id,'content_id',v_content.id,
      'policy_id','nelyon.creator_premium.general.p1.v1',
      'decision','technical_failure',
      'reason','creator_premium_contextual_evidence_incomplete'
    );
  end if;
  v_decision:=v_evaluation.context_result->>'decision';
  if v_decision='allow' and exists(
    select 1 from private.content_safety_alerts alert
    where alert.scan_id=v_scan.id
      and alert.source_type not in(
        'text_rule','audio_transcript_rule','visual_classifier'
      )
      and not (alert.status='dismissed' and alert.resolution='no_violation')
  ) then
    v_decision:='review';
  end if;
  return pg_catalog.jsonb_build_object(
    'scan_id',v_scan.id,'content_id',v_content.id,
    'policy_id','nelyon.creator_premium.general.p1.v1',
    'decision',v_decision,
    'reason',case v_decision
      when 'allow' then 'creator_premium_context_allow_candidate'
      when 'review' then 'creator_premium_context_review_candidate'
      else 'creator_premium_context_block_candidate' end,
    'evaluation_id',v_evaluation.id,
    'evaluation_fingerprint',v_evaluation.evaluation_fingerprint,
    'activation_effect',false
  );
end;
$$;

revoke all on function
  private.creator_premium_content_safety_context_result_valid_p2_v1(jsonb,text)
  from public, anon, authenticated, service_role;
revoke all on function
  private.creator_premium_content_safety_candidate_p2_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function
  public.claim_creator_premium_content_safety_context_v1(integer)
  from public, anon, authenticated, service_role;
revoke all on function
  public.complete_creator_premium_content_safety_context_v1(uuid,text,integer,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function
  public.fail_creator_premium_content_safety_context_v1(uuid,text,integer,text,boolean,boolean)
  from public, anon, authenticated, service_role;
grant execute on function
  public.claim_creator_premium_content_safety_context_v1(integer)
  to service_role;
grant execute on function
  public.complete_creator_premium_content_safety_context_v1(uuid,text,integer,jsonb)
  to service_role;
grant execute on function
  public.fail_creator_premium_content_safety_context_v1(uuid,text,integer,text,boolean,boolean)
  to service_role;

comment on table private.creator_premium_content_safety_context_evaluations is
  'P2 private, immutable-by-contract contextual evidence bound to one Premium scan, policy, visual analysis, and transcript. It has no publication authority.';
comment on function public.claim_creator_premium_content_safety_context_v1(integer) is
  'Service-only, one-at-a-time P2 claim. Returns bounded text/transcript/visual evidence and never media URLs or user identity.';
comment on function private.creator_premium_content_safety_candidate_p2_v1(uuid) is
  'Private P2 candidate decision for evidence verification. It cannot activate P1 or publish content.';

commit;
