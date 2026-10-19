begin;

-- P3 succeeds the active Creator Premium general policy without mutating
-- historical P1/P2 evaluations. Only the two exact revision tuples are valid.
alter table private.creator_premium_content_safety_context_evaluations
  drop constraint creator_premium_context_policy_check,
  drop constraint creator_premium_context_schema_check,
  drop constraint creator_premium_context_prompt_check;

alter table private.creator_premium_content_safety_context_evaluations
  alter column policy_id set default 'nelyon.creator_premium.general.p1.v2',
  alter column schema_version set default 'creator-premium-context-p3-v1',
  alter column prompt_version set default 'creator-premium-context-p3-v1',
  add constraint creator_premium_context_revision_check check (
    (policy_id='nelyon.creator_premium.general.p1.v1'
      and schema_version='creator-premium-context-p2-v1'
      and prompt_version='creator-premium-context-p2-v1')
    or
    (policy_id='nelyon.creator_premium.general.p1.v2'
      and schema_version='creator-premium-context-p3-v1'
      and prompt_version='creator-premium-context-p3-v1')
  );

create function private.creator_premium_content_safety_context_result_valid_p3_v1(
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
  v_weapon_state text;
  v_law_enforcement_state text;
  v_violence_state text;
  v_allow constant text[] := array[
    'courses','tutorials','education','entertainment','dance','humor','sport',
    'fashion','kissing_and_affection','swimwear','non_explicit_sensual_clothing',
    'non_sexual_artistic_content','non_graphic_law_enforcement_operation',
    'non_threatening_weapon_presence'
  ]::text[];
  v_review constant text[] := array[
    'contextual_artistic_or_medical_nudity',
    'incidental_blood_or_informational_context','documentary_violence',
    'age_uncertain','consent_uncertain','contradictory_signals',
    'low_confidence','incomplete_multimodal_coverage',
    'ambiguous_weapon_or_law_enforcement_context'
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
    'no_speech','non_graphic_law_enforcement_context',
    'non_threatening_weapon_context'
  ]::text[];
  v_allow_rationale constant text[] := array[
    'benign_context','educational_context','quoted_or_negated_context',
    'swimwear_or_non_explicit_context','no_speech',
    'non_graphic_law_enforcement_context','non_threatening_weapon_context'
  ]::text[];
  v_review_rationale constant text[] := array[
    'ambiguous_context','age_requires_review','consent_requires_review',
    'violent_threat_context','contradictory_signals','visual_review_signal'
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
    'coverage','decision','law_enforcement_state','policy_id','rationale_codes',
    'schema_version','uncertainty','violence_state','weapon_state'
  ]::text[] then return false; end if;
  if p_result->>'schema_version' is distinct from
       'creator-premium-context-p3-v1'
     or p_result->>'policy_id' is distinct from
       'nelyon.creator_premium.general.p1.v2'
     or p_result->>'certainty_basis' is distinct from 'discrete_contract'
     or p_result->>'decision' is null
     or p_result->>'decision' not in ('allow','review','block')
     or p_result->>'uncertainty' is null
     or p_result->>'uncertainty' not in ('unambiguous','ambiguous')
     or p_result->>'age_uncertainty' is null
     or p_result->>'age_uncertainty' not in ('not_relevant','present')
     or p_result->>'consent_uncertainty' is null
     or p_result->>'consent_uncertainty' not in ('not_relevant','present')
     or p_result->>'weapon_state' is null
     or p_result->>'weapon_state' not in (
       'not_observed','visible_non_threatening',
       'pointed_brandished_fired_or_threatening','uncertain'
     )
     or p_result->>'law_enforcement_state' is null
     or p_result->>'law_enforcement_state' not in (
       'not_observed','routine_peaceful','force_or_confrontation','uncertain'
     )
     or p_result->>'violence_state' is null
     or p_result->>'violence_state' not in (
       'none_observed','real_non_graphic_or_incidental_injury',
       'graphic_or_severe','uncertain'
     ) then
    return false;
  end if;
  if pg_catalog.jsonb_typeof(p_result->'coverage') is distinct from 'object' then
    return false;
  end if;
  select pg_catalog.array_agg(key order by key) into v_coverage_keys
  from pg_catalog.jsonb_object_keys(p_result->'coverage') key;
  if v_coverage_keys is distinct from array['text','transcript','visual']::text[]
     or p_result#>>'{coverage,text}' is distinct from 'complete'
     or p_result#>>'{coverage,transcript}' is distinct from
       p_transcript_coverage
     or p_result#>>'{coverage,visual}' is distinct from 'complete' then
    return false;
  end if;
  if pg_catalog.jsonb_typeof(p_result->'categories') is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_result->'categories') not between 1 and 8
     or exists(
       select 1 from pg_catalog.jsonb_array_elements(p_result->'categories') item
       where pg_catalog.jsonb_typeof(item) <> 'string'
     ) then return false; end if;
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
     ) then return false; end if;
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
  v_weapon_state := p_result->>'weapon_state';
  v_law_enforcement_state := p_result->>'law_enforcement_state';
  v_violence_state := p_result->>'violence_state';
  if v_decision='allow' and (
       not v_categories <@ v_allow
       or not v_rationale_codes <@ v_allow_rationale
       or v_uncertainty<>'unambiguous'
       or v_age_uncertainty<>'not_relevant'
       or v_consent_uncertainty<>'not_relevant'
       or v_weapon_state not in ('not_observed','visible_non_threatening')
       or v_law_enforcement_state not in ('not_observed','routine_peaceful')
       or v_violence_state<>'none_observed'
     ) then return false; end if;
  if v_decision='review' and (
       v_categories && v_block
       or 'severe_explicit_context'=any(v_rationale_codes)
       or not v_rationale_codes && v_review_rationale
       or v_violence_state='graphic_or_severe'
       or (not v_categories && v_review
         and v_uncertainty<>'ambiguous'
         and v_age_uncertainty<>'present'
         and v_consent_uncertainty<>'present')
     ) then return false; end if;
  if v_decision='block' and (
       v_uncertainty<>'unambiguous' or not v_categories <@ v_block
       or not ('severe_explicit_context'=any(v_rationale_codes))
     ) then return false; end if;
  if v_violence_state='graphic_or_severe' and v_decision<>'block'
     then return false; end if;
  if v_age_uncertainty='present'
     and not v_categories && array['age_uncertain','child_sexual_exploitation']::text[]
     then return false; end if;
  if 'age_uncertain'=any(v_categories) and v_age_uncertainty<>'present'
     then return false; end if;
  if v_consent_uncertainty='present'
     and not v_categories && array[
       'consent_uncertain','non_consensual_intimate_content','sexual_violence'
     ]::text[] then return false; end if;
  if 'consent_uncertain'=any(v_categories)
     and v_consent_uncertainty<>'present' then return false; end if;
  if 'child_sexual_exploitation'=any(v_categories)
     and v_age_uncertainty<>'present' then return false; end if;
  if v_categories && array[
       'non_consensual_intimate_content','sexual_violence'
     ]::text[] and v_consent_uncertainty<>'present' then return false; end if;
  if ('non_graphic_law_enforcement_operation'=any(v_categories))
       is distinct from
       ('non_graphic_law_enforcement_context'=any(v_rationale_codes)) then
    return false;
  end if;
  if ('non_threatening_weapon_presence'=any(v_categories))
       is distinct from
       ('non_threatening_weapon_context'=any(v_rationale_codes)) then
    return false;
  end if;
  if ('non_graphic_law_enforcement_operation'=any(v_categories))
       is distinct from (v_law_enforcement_state='routine_peaceful') then
    return false;
  end if;
  if ('non_threatening_weapon_presence'=any(v_categories))
       is distinct from (v_weapon_state='visible_non_threatening') then
    return false;
  end if;
  return true;
end;
$$;

-- A contextual ALLOW cannot hide an incompatible visual finding under a
-- benign text category. Only the two owner-approved bounded exceptions may
-- coexist with visual review signals; every other signal remains fail-closed.
create or replace function private.creator_premium_content_safety_visual_allow_compatible_p3_v1(
  p_context_result jsonb,
  p_analysis_result jsonb
) returns boolean
language sql immutable
set search_path = ''
as $$
  select coalesce(
    p_context_result->>'decision'='allow'
    and p_context_result->>'violence_state'='none_observed'
    and p_context_result->>'law_enforcement_state' in (
      'not_observed','routine_peaceful'
    )
    and p_context_result->>'weapon_state' in (
      'not_observed','visible_non_threatening'
    )
    and pg_catalog.jsonb_typeof(p_analysis_result->'findings')='array'
    and (
      (p_context_result->'categories' ?
        'non_graphic_law_enforcement_operation')
      =
      (p_context_result->'rationale_codes' ?
        'non_graphic_law_enforcement_context')
    )
    and (
      (p_context_result->'categories' ?
        'non_graphic_law_enforcement_operation')
      =
      (p_context_result->>'law_enforcement_state'='routine_peaceful')
    )
    and (
      (p_context_result->'categories' ?
        'non_threatening_weapon_presence')
      =
      (p_context_result->'rationale_codes' ?
        'non_threatening_weapon_context')
    )
    and (
      (p_context_result->'categories' ?
        'non_threatening_weapon_presence')
      =
      (p_context_result->>'weapon_state'='visible_non_threatening')
    )
    and (
      (p_context_result->'categories' ? 'non_threatening_weapon_presence')
      is not distinct from exists(
        select 1
        from pg_catalog.jsonb_array_elements(
          p_analysis_result->'findings'
        ) finding
        where finding->>'category'='weapons'
      )
    )
    and not exists(
      select 1
      from pg_catalog.jsonb_array_elements(
        p_analysis_result->'findings'
      ) finding
      where (
        finding->>'triage_level' in ('low','medium')
        and (
          (
            finding->>'category'='weapons'
            and p_context_result->>'weapon_state'=
              'visible_non_threatening'
            and (
              p_context_result->'categories' ?
                'non_graphic_law_enforcement_operation'
              or p_context_result->'categories' ?
                'non_threatening_weapon_presence'
            )
          )
          or (
            finding->>'category'='sexual'
            and p_context_result->'categories' ?| array[
              'kissing_and_affection','swimwear',
              'non_explicit_sensual_clothing'
            ]::text[]
          )
          or (
            finding->>'category'='other'
            and finding->>'triage_level'='low'
            and p_context_result->'categories' ?| array[
              'non_graphic_law_enforcement_operation',
              'non_threatening_weapon_presence'
            ]::text[]
          )
        )
      ) is not true
    ),
    false
  );
$$;

-- Published P2 decisions are historical evidence, not implicit P3 decisions.
-- Preserve them only when the exact current scan/fingerprint still has a
-- complete, strictly valid P2 ALLOW bound to the same visual/transcript proof.
create function private.creator_premium_content_safety_historical_p2_allow_valid_p3_v1(
  p_scan_id uuid
) returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_scan private.content_safety_scans;
  v_content private.creator_premium_contents;
  v_evaluation private.creator_premium_content_safety_context_evaluations;
  v_analysis private.content_safety_visual_analyses;
  v_snapshot jsonb;
begin
  select * into v_scan
  from private.content_safety_scans
  where id=p_scan_id;
  if not found
     or v_scan.target_type<>'creator_premium'
     or v_scan.status<>'completed'
     or v_scan.text_status<>'analyzed'
     or v_scan.reports_status<>'analyzed'
     or v_scan.visual_status<>'analyzed' then
    return false;
  end if;

  select * into v_content
  from private.creator_premium_contents
  where id=v_scan.target_id;
  if not found
     or v_content.lifecycle_status<>'published'
     or v_content.verification_status<>'passed'
     or v_content.creator_id is distinct from v_scan.owner_user_id
     or v_content.verification_scan_id is distinct from v_scan.id
     or v_content.verification_fingerprint is distinct from
       v_scan.content_fingerprint then
    return false;
  end if;

  v_snapshot:=private.content_safety_target_snapshot(
    'creator_premium',v_content.id
  );
  if v_snapshot is null
     or v_scan.content_fingerprint<>private.content_safety_sha256(
       'creator_premium|'||v_content.id::text||'|'||
       coalesce(v_snapshot->>'content_version','')
     ) then
    return false;
  end if;

  select * into v_evaluation
  from private.creator_premium_content_safety_context_evaluations evaluation
  where evaluation.source_scan_id=v_scan.id
    and evaluation.target_id=v_content.id
    and evaluation.owner_user_id=v_content.creator_id
    and evaluation.source_content_fingerprint=v_scan.content_fingerprint
    and evaluation.policy_id='nelyon.creator_premium.general.p1.v1'
    and evaluation.schema_version='creator-premium-context-p2-v1'
    and evaluation.prompt_version='creator-premium-context-p2-v1'
    and evaluation.provider='cloudflare_workers_ai'
    and evaluation.model='@cf/google/gemma-4-26b-a4b-it'
    and evaluation.status='completed'
  order by evaluation.created_at desc,evaluation.id desc
  limit 1;
  if not found
     or v_evaluation.visual_analysis_id is distinct from
       v_scan.visual_analysis_id
     or v_evaluation.completed_at is null
     or v_evaluation.last_error_code is not null
     or v_evaluation.attempt_count not between 1 and 5
     or v_evaluation.provider_call_count not between 1 and 5
     or v_evaluation.context_result->>'schema_version' is distinct from
       'creator-premium-context-p2-v1'
     or v_evaluation.context_result->>'policy_id' is distinct from
       'nelyon.creator_premium.general.p1.v1'
     or v_evaluation.context_result->>'decision' is distinct from 'allow'
     or v_evaluation.context_result->>'certainty_basis' is distinct from
       'discrete_contract'
     or v_evaluation.context_result->>'uncertainty' is distinct from
       'unambiguous'
     or v_evaluation.context_result->>'age_uncertainty' is distinct from
       'not_relevant'
     or v_evaluation.context_result->>'consent_uncertainty' is distinct from
       'not_relevant'
     or v_evaluation.context_result#>>'{coverage,text}' is distinct from
       'complete'
     or v_evaluation.context_result#>>'{coverage,transcript}' is distinct from
       v_evaluation.transcript_coverage
     or v_evaluation.context_result#>>'{coverage,visual}' is distinct from
       'complete'
     or not private.creator_premium_content_safety_context_result_valid_p2_v1(
       v_evaluation.context_result,v_evaluation.transcript_coverage
     )
     or v_evaluation.evaluation_fingerprint is distinct from
       private.content_safety_sha256(
         v_evaluation.source_scan_id::text||'|'||
         v_evaluation.source_content_fingerprint||'|'||
         v_evaluation.policy_id||'|'||v_evaluation.provider||'|'||
         v_evaluation.model||'|'||v_evaluation.prompt_version||'|'||
         v_evaluation.transcript_coverage||'|'||
         coalesce(v_evaluation.transcript_id::text,'')||'|'||
         coalesce(v_evaluation.transcript_fingerprint,'')||'|'||
         v_evaluation.visual_analysis_id::text||'|'||
         v_evaluation.visual_analysis_fingerprint||'|'||
         v_evaluation.context_result::text
     ) then
    return false;
  end if;

  select * into v_analysis
  from private.content_safety_visual_analyses analysis
  where analysis.id=v_evaluation.visual_analysis_id
    and analysis.analysis_fingerprint=
      v_evaluation.visual_analysis_fingerprint
    and analysis.provider='cloudflare_workers_ai'
    and analysis.model='@cf/google/gemma-4-26b-a4b-it'
    and analysis.prompt_version='visual-safety-v1'
    and ((v_content.content_kind='image'
        and analysis.media_asset_id=v_scan.visual_media_asset_id)
      or (v_content.content_kind='video'
        and analysis.video_asset_id=v_scan.visual_video_asset_id));
  if not found then
    return false;
  end if;

  if v_content.content_kind='image' then
    return v_evaluation.transcript_coverage='not_applicable'
      and v_evaluation.transcript_id is null
      and v_evaluation.transcript_fingerprint is null
      and v_scan.audio_status='not_applicable';
  end if;
  if v_content.content_kind<>'video'
     or v_scan.audio_status<>'analyzed'
     or v_evaluation.transcript_coverage not in ('complete','no_speech') then
    return false;
  end if;
  return exists(
    select 1
    from private.content_safety_audio_transcripts transcript
    where transcript.id=v_evaluation.transcript_id
      and transcript.source_scan_id=v_scan.id
      and transcript.source_content_fingerprint=v_scan.content_fingerprint
      and transcript.transcript_fingerprint=v_evaluation.transcript_fingerprint
      and transcript.rule_eval_status='completed'
      and ((v_evaluation.transcript_coverage='no_speech'
          and transcript.no_speech)
        or (v_evaluation.transcript_coverage='complete'
          and not transcript.no_speech
          and pg_catalog.char_length(
            pg_catalog.btrim(transcript.transcript_text)
          )>0))
  );
end;
$$;

create or replace function private.finalize_creator_premium_safety_scan_v1(
  p_scan_id uuid
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_scan private.content_safety_scans;
  v_content private.creator_premium_contents;
  v_snapshot jsonb;
  v_current_fingerprint text;
  v_blocker text;
  v_transcript private.content_safety_audio_transcripts;
  v_now timestamptz;
  v_policy_decision jsonb;
begin
  select * into v_scan from private.content_safety_scans
  where id=p_scan_id for update;
  if not found or v_scan.target_type<>'creator_premium' then
    return pg_catalog.jsonb_build_object(
      'scan_id',p_scan_id,'outcome','not_creator_premium'
    );
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'creator-premium-content:'||v_scan.target_id::text,0
    )
  );
  select * into v_content from private.creator_premium_contents
  where id=v_scan.target_id for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'scan_id',v_scan.id,'outcome','content_missing'
    );
  end if;
  v_now:=pg_catalog.clock_timestamp();

  if v_content.lifecycle_status='published' then
    if v_content.verification_scan_id is distinct from v_scan.id
       or v_content.verification_fingerprint is distinct from
         v_scan.content_fingerprint then
      return pg_catalog.jsonb_build_object(
        'content_id',v_content.id,'outcome','stale_scan'
      );
    end if;
    v_snapshot:=private.content_safety_target_snapshot(
      'creator_premium',v_content.id
    );
    if v_snapshot is null then
      return pg_catalog.jsonb_build_object(
        'content_id',v_content.id,'outcome','snapshot_unavailable'
      );
    end if;
    v_current_fingerprint:=private.content_safety_sha256(
      'creator_premium|'||v_content.id::text||'|'||
      coalesce(v_snapshot->>'content_version','')
    );
    if v_current_fingerprint<>v_scan.content_fingerprint then
      return pg_catalog.jsonb_build_object(
        'content_id',v_content.id,'outcome','stale_scan'
      );
    end if;
    if exists(
      select 1 from private.content_safety_alerts alert
      where alert.scan_id=v_scan.id
        and not (
          alert.status='dismissed' and alert.resolution='no_violation'
        )
    ) then
      if not exists(
        select 1 from private.content_safety_alerts alert
        where alert.scan_id=v_scan.id
          and alert.source_type not in (
            'text_rule','audio_transcript_rule','visual_classifier'
          )
          and not (
            alert.status='dismissed' and alert.resolution='no_violation'
          )
      ) then
        if not exists(
          select 1
          from private.creator_premium_content_safety_context_evaluations
            evaluation
          where evaluation.source_scan_id=v_scan.id
            and evaluation.source_content_fingerprint=v_scan.content_fingerprint
            and evaluation.policy_id=
              'nelyon.creator_premium.general.p1.v2'
            and evaluation.schema_version='creator-premium-context-p3-v1'
            and evaluation.prompt_version='creator-premium-context-p3-v1'
            and evaluation.status='completed'
        ) and private.creator_premium_content_safety_historical_p2_allow_valid_p3_v1(
          v_scan.id
        ) then
          return pg_catalog.jsonb_build_object(
            'content_id',v_content.id,
            'outcome','published_unchanged_historical_policy',
            'contextual_visual_alerts_preserved',true
          );
        end if;
        v_policy_decision:=
          private.creator_premium_content_safety_decision_p1_v1(v_scan.id);
        if v_policy_decision->>'policy_id'=
             'nelyon.creator_premium.general.p1.v2'
           and v_policy_decision->>'decision'='allow'
           and v_policy_decision->'activation_effect'='true'::jsonb then
          return pg_catalog.jsonb_build_object(
            'content_id',v_content.id,
            'outcome','published_unchanged',
            'policy_id','nelyon.creator_premium.general.p1.v2',
            'contextual_visual_alerts_preserved',true
          );
        end if;
      end if;
      update private.creator_premium_contents content set
        lifecycle_status='quarantined',quarantined_at=v_now,
        reviewed_at=null,reviewed_by=null,
        review_reason='creator_premium_safety_signal',
        removal_reason='creator_premium_safety_signal',
        verification_scan_id=v_scan.id,
        verification_fingerprint=v_scan.content_fingerprint,
        verification_status='restricted',
        verification_error_code='creator_premium_safety_signal',
        verification_requested_at=coalesce(
          content.verification_requested_at,v_scan.created_at
        ),
        verification_completed_at=v_now,updated_at=v_now
      where content.id=v_content.id
        and content.lifecycle_status='published'
        and content.verification_scan_id=v_scan.id
        and content.verification_fingerprint=v_scan.content_fingerprint;
      return pg_catalog.jsonb_build_object(
        'content_id',v_content.id,'outcome','restricted','published',false
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'content_id',v_content.id,'outcome','published_unchanged'
    );
  end if;

  if v_content.lifecycle_status<>'pending_review' then
    return pg_catalog.jsonb_build_object(
      'content_id',v_content.id,'outcome','state_changed',
      'lifecycle_status',v_content.lifecycle_status
    );
  end if;
  if v_content.verification_scan_id is distinct from v_scan.id
     or v_content.verification_fingerprint is distinct from
       v_scan.content_fingerprint then
    return pg_catalog.jsonb_build_object(
      'content_id',v_content.id,'outcome','stale_scan'
    );
  end if;
  v_snapshot:=private.content_safety_target_snapshot(
    'creator_premium',v_content.id
  );
  if v_snapshot is null then
    update private.creator_premium_contents set
      verification_status='failed',
      verification_error_code='creator_premium_snapshot_unavailable',
      verification_completed_at=v_now,updated_at=v_now
    where id=v_content.id;
    return pg_catalog.jsonb_build_object(
      'content_id',v_content.id,'outcome','failed',
      'error','creator_premium_snapshot_unavailable'
    );
  end if;
  v_current_fingerprint:=private.content_safety_sha256(
    'creator_premium|'||v_content.id::text||'|'||
    coalesce(v_snapshot->>'content_version','')
  );
  if v_current_fingerprint<>v_scan.content_fingerprint then
    update private.creator_premium_contents set
      verification_status='failed',
      verification_error_code='creator_premium_stale_content_version',
      verification_completed_at=v_now,updated_at=v_now
    where id=v_content.id;
    return pg_catalog.jsonb_build_object(
      'content_id',v_content.id,'outcome','failed',
      'error','creator_premium_stale_content_version'
    );
  end if;
  if not private.creator_premium_actor_is_age_eligible_v1(v_content.creator_id)
     or not private.creator_premium_actor_is_operational_v1(
       v_content.creator_id
     ) then
    update private.creator_premium_contents set
      lifecycle_status='quarantined',quarantined_at=v_now,
      review_reason='creator_premium_creator_restricted',
      removal_reason='creator_premium_creator_restricted',
      verification_status='restricted',
      verification_error_code='creator_premium_creator_restricted',
      verification_completed_at=v_now,updated_at=v_now
    where id=v_content.id;
    return pg_catalog.jsonb_build_object(
      'content_id',v_content.id,'outcome','restricted',
      'error','creator_premium_creator_restricted'
    );
  end if;
  if v_scan.status='failed'
     or v_scan.text_status in ('failed','not_configured')
     or v_scan.visual_status in ('failed','not_configured')
     or (v_content.content_kind='video'
       and v_scan.audio_status in ('failed','not_configured')) then
    update private.creator_premium_contents set
      verification_status='failed',
      verification_error_code='creator_premium_safety_provider_failed',
      verification_completed_at=v_now,updated_at=v_now
    where id=v_content.id;
    return pg_catalog.jsonb_build_object(
      'content_id',v_content.id,'outcome','failed',
      'error','creator_premium_safety_provider_failed'
    );
  end if;
  if v_scan.status<>'completed'
     or v_scan.text_status<>'analyzed'
     or v_scan.reports_status<>'analyzed'
     or v_scan.visual_status<>'analyzed'
     or (v_content.content_kind='image'
       and v_scan.audio_status<>'not_applicable')
     or (v_content.content_kind='video'
       and v_scan.audio_status<>'analyzed') then
    return pg_catalog.jsonb_build_object(
      'content_id',v_content.id,'outcome','pending'
    );
  end if;
  if v_content.content_kind='video' then
    select transcript.* into v_transcript
    from private.content_safety_audio_transcripts transcript
    where transcript.source_scan_id=v_scan.id
      and transcript.source_content_fingerprint=v_scan.content_fingerprint
      and transcript.rule_eval_status='completed'
    order by transcript.created_at desc,transcript.id desc limit 1;
    if not found then
      update private.creator_premium_contents set
        verification_status='failed',
        verification_error_code='creator_premium_audio_proof_invalid',
        verification_completed_at=v_now,updated_at=v_now
      where id=v_content.id;
      return pg_catalog.jsonb_build_object(
        'content_id',v_content.id,'outcome','failed',
        'error','creator_premium_audio_proof_invalid'
      );
    end if;
  end if;
  if not exists(
    select 1 from private.content_safety_visual_analyses analysis
    where analysis.id=v_scan.visual_analysis_id
      and ((v_content.content_kind='image'
          and analysis.media_asset_id=v_scan.visual_media_asset_id)
        or (v_content.content_kind='video'
          and analysis.video_asset_id=v_scan.visual_video_asset_id))
  ) then
    update private.creator_premium_contents set
      verification_status='failed',
      verification_error_code='creator_premium_visual_proof_invalid',
      verification_completed_at=v_now,updated_at=v_now
    where id=v_content.id;
    return pg_catalog.jsonb_build_object(
      'content_id',v_content.id,'outcome','failed',
      'error','creator_premium_visual_proof_invalid'
    );
  end if;

  v_policy_decision:=
    private.creator_premium_content_safety_decision_p1_v1(v_scan.id);
  if v_policy_decision->>'decision'='awaiting_policy' then
    update private.creator_premium_contents set
      verification_status='failed',
      verification_error_code='content_safety_policy_not_configured',
      verification_completed_at=v_now,updated_at=v_now
    where id=v_content.id;
    return pg_catalog.jsonb_build_object(
      'content_id',v_content.id,'outcome','failed',
      'error','content_safety_policy_not_configured',
      'policy_id',v_policy_decision->>'policy_id'
    );
  end if;
  if v_policy_decision->>'decision'='technical_failure' then
    update private.creator_premium_contents set
      verification_status='failed',
      verification_error_code='creator_premium_safety_decision_failed',
      verification_completed_at=v_now,updated_at=v_now
    where id=v_content.id;
    return pg_catalog.jsonb_build_object(
      'content_id',v_content.id,'outcome','failed',
      'error','creator_premium_safety_decision_failed'
    );
  end if;
  if v_policy_decision->>'decision'='review' then
    update private.creator_premium_contents set
      lifecycle_status='quarantined',published_at=null,
      quarantined_at=v_now,removed_at=null,reviewed_at=null,reviewed_by=null,
      review_reason='creator_premium_safety_review_required',
      removal_reason='creator_premium_safety_review_required',
      verification_status='restricted',
      verification_error_code='creator_premium_safety_review_required',
      verification_completed_at=v_now,updated_at=v_now
    where id=v_content.id;
    return pg_catalog.jsonb_build_object(
      'content_id',v_content.id,'outcome','review',
      'error','creator_premium_safety_review_required','published',false
    );
  end if;
  if v_policy_decision->>'decision'='block' then
    update private.creator_premium_contents set
      lifecycle_status='rejected',published_at=null,quarantined_at=null,
      removed_at=null,reviewed_at=null,reviewed_by=null,
      review_reason='creator_premium_safety_blocked',
      removal_reason='creator_premium_safety_blocked',
      verification_status='blocked',
      verification_error_code='creator_premium_safety_blocked',
      verification_completed_at=v_now,updated_at=v_now
    where id=v_content.id;
    return pg_catalog.jsonb_build_object(
      'content_id',v_content.id,'outcome','blocked',
      'error','creator_premium_safety_blocked','published',false
    );
  end if;
  if v_policy_decision->>'decision' is distinct from 'allow' then
    update private.creator_premium_contents set
      verification_status='failed',
      verification_error_code='creator_premium_safety_decision_invalid',
      verification_completed_at=v_now,updated_at=v_now
    where id=v_content.id;
    return pg_catalog.jsonb_build_object(
      'content_id',v_content.id,'outcome','failed',
      'error','creator_premium_safety_decision_invalid'
    );
  end if;
  v_blocker:=private.creator_premium_publication_blocker_v1(v_content.id);
  if v_blocker is not null then
    if v_blocker='creator_premium_active_plan_required' then
      update private.creator_premium_contents set
        verification_status='commercial_pending',
        verification_error_code=v_blocker,
        verification_completed_at=v_now,updated_at=v_now
      where id=v_content.id;
      return pg_catalog.jsonb_build_object(
        'content_id',v_content.id,'outcome','commercial_pending',
        'error',v_blocker
      );
    end if;
    update private.creator_premium_contents set
      verification_status='failed',verification_error_code=v_blocker,
      verification_completed_at=v_now,updated_at=v_now
    where id=v_content.id;
    return pg_catalog.jsonb_build_object(
      'content_id',v_content.id,'outcome','failed','error',v_blocker
    );
  end if;
  update private.creator_premium_contents content set
    lifecycle_status='published',published_at=v_now,quarantined_at=null,
    removed_at=null,reviewed_at=null,reviewed_by=null,review_reason=null,
    removal_reason=null,verification_status='passed',
    verification_error_code=null,verification_completed_at=v_now,
    updated_at=v_now
  where content.id=v_content.id
    and content.lifecycle_status='pending_review'
    and content.verification_scan_id=v_scan.id
    and content.verification_fingerprint=v_scan.content_fingerprint;
  if not found then
    return pg_catalog.jsonb_build_object(
      'content_id',v_content.id,'outcome','state_changed'
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'content_id',v_content.id,'outcome','published','published',true,
    'policy_id','nelyon.creator_premium.general.p1.v2'
  );
end;
$$;

create or replace function private.creator_premium_content_safety_candidate_p3_v1(
  p_scan_id uuid
) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_scan private.content_safety_scans;
  v_content private.creator_premium_contents;
  v_evaluation private.creator_premium_content_safety_context_evaluations;
  v_analysis private.content_safety_visual_analyses;
  v_snapshot jsonb;
  v_decision text;
begin
  select * into v_scan from private.content_safety_scans where id=p_scan_id;
  if not found or v_scan.target_type<>'creator_premium' then
    return pg_catalog.jsonb_build_object(
      'scan_id',p_scan_id,'policy_id','nelyon.creator_premium.general.p1.v2',
      'decision','technical_failure','reason','creator_premium_scan_missing'
    );
  end if;
  select * into v_content from private.creator_premium_contents
  where id=v_scan.target_id;
  if not found
     or not (
       v_content.lifecycle_status='pending_review'
       or (v_content.lifecycle_status='published'
         and v_content.verification_status='passed')
     )
     or v_content.creator_id is distinct from v_scan.owner_user_id
     or v_content.verification_scan_id is distinct from v_scan.id
     or v_content.verification_fingerprint is distinct from
       v_scan.content_fingerprint then
    return pg_catalog.jsonb_build_object(
      'scan_id',v_scan.id,'policy_id','nelyon.creator_premium.general.p1.v2',
      'decision','technical_failure',
      'reason','creator_premium_scan_binding_invalid'
    );
  end if;
  v_snapshot:=private.content_safety_target_snapshot('creator_premium',v_content.id);
  if v_snapshot is null
     or v_scan.content_fingerprint<>private.content_safety_sha256(
       'creator_premium|'||v_content.id::text||'|'||
       coalesce(v_snapshot->>'content_version','')
     ) then
    return pg_catalog.jsonb_build_object(
      'scan_id',v_scan.id,'content_id',v_content.id,
      'policy_id','nelyon.creator_premium.general.p1.v2',
      'decision','technical_failure',
      'reason','creator_premium_context_stale_content_version'
    );
  end if;
  select * into v_evaluation
  from private.creator_premium_content_safety_context_evaluations
  where source_scan_id=v_scan.id
    and source_content_fingerprint=v_scan.content_fingerprint
    and policy_id='nelyon.creator_premium.general.p1.v2'
    and schema_version='creator-premium-context-p3-v1'
    and provider='cloudflare_workers_ai'
    and model='@cf/google/gemma-4-26b-a4b-it'
    and prompt_version='creator-premium-context-p3-v1'
    and status='completed'
  order by created_at desc,id desc limit 1;
  if not found
     or v_evaluation.visual_analysis_id is distinct from v_scan.visual_analysis_id
     or not private.creator_premium_content_safety_context_result_valid_p3_v1(
       v_evaluation.context_result,v_evaluation.transcript_coverage
     ) then
    return pg_catalog.jsonb_build_object(
      'scan_id',v_scan.id,'content_id',v_content.id,
      'policy_id','nelyon.creator_premium.general.p1.v2',
      'decision','technical_failure',
      'reason','creator_premium_contextual_evidence_incomplete'
    );
  end if;
  select * into v_analysis
  from private.content_safety_visual_analyses analysis
  where analysis.id=v_evaluation.visual_analysis_id
    and analysis.analysis_fingerprint=v_evaluation.visual_analysis_fingerprint
    and analysis.provider='cloudflare_workers_ai'
    and analysis.model='@cf/google/gemma-4-26b-a4b-it'
    and analysis.prompt_version='visual-safety-v1'
    and ((v_content.content_kind='image'
        and analysis.media_asset_id=v_scan.visual_media_asset_id)
      or (v_content.content_kind='video'
        and analysis.video_asset_id=v_scan.visual_video_asset_id));
  if not found
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
           and transcript.transcript_fingerprint=v_evaluation.transcript_fingerprint
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
      'policy_id','nelyon.creator_premium.general.p1.v2',
      'decision','technical_failure',
      'reason','creator_premium_contextual_evidence_incomplete'
    );
  end if;
  if v_evaluation.context_result->>'decision'='allow'
     and not private.creator_premium_content_safety_visual_allow_compatible_p3_v1(
       v_evaluation.context_result,v_analysis.analysis_result
     ) then
    return pg_catalog.jsonb_build_object(
      'scan_id',v_scan.id,'content_id',v_content.id,
      'policy_id','nelyon.creator_premium.general.p1.v2',
      'decision','technical_failure',
      'reason','creator_premium_contextual_evidence_invalid'
    );
  end if;
  v_decision:=v_evaluation.context_result->>'decision';
  if v_decision='allow' and exists(
    select 1 from private.content_safety_alerts alert
    where alert.scan_id=v_scan.id
      and alert.source_type not in (
        'text_rule','audio_transcript_rule','visual_classifier'
      )
      and not (alert.status='dismissed' and alert.resolution='no_violation')
  ) then
    v_decision:='review';
  end if;
  return pg_catalog.jsonb_build_object(
    'scan_id',v_scan.id,'content_id',v_content.id,
    'policy_id','nelyon.creator_premium.general.p1.v2',
    'decision',v_decision,
    'reason',case v_decision
      when 'allow' then 'creator_premium_context_allow_candidate'
      when 'review' then 'creator_premium_context_review_candidate'
      else 'creator_premium_context_block_candidate' end,
    'categories',v_evaluation.context_result->'categories',
    'evaluation_id',v_evaluation.id,
    'evaluation_fingerprint',v_evaluation.evaluation_fingerprint,
    'activation_effect',false
  );
end;
$$;

create function private.creator_premium_content_safety_policy_p1_v2()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select $policy$
  {
    "schema_version":"nelyon.creator_premium_content_safety_policy.v2",
    "policy_id":"nelyon.creator_premium.general.p1.v2",
    "predecessor_policy_id":"nelyon.creator_premium.general.p1.v1",
    "title":"Creator Premium General Content Safety P3",
    "artifact_sha256":"98607897d8e82f5f3df7e632fa214c557f86b0a7e8ff068a03a5794c6b256911",
    "normative_approval":{"status":"approved","source":"owner_prompt","authorized_phase":"CONTENT-SAFETY-P3","authorized_at":"2026-10-19","owner_bound":true},
    "scope":{"creator_premium_general":true,"public_feed_policy_changed":false,"explicit_adult_premium":false,"mobile_explicit_adult":false,"finance_effect":false},
    "decision_matrix":{
      "allow":["courses","tutorials","education","entertainment","dance","humor","sport","fashion","kissing_and_affection","swimwear","non_explicit_sensual_clothing","non_sexual_artistic_content","non_graphic_law_enforcement_operation","non_threatening_weapon_presence"],
      "review":["contextual_artistic_or_medical_nudity","incidental_blood_or_informational_context","documentary_violence","age_uncertain","consent_uncertain","contradictory_signals","low_confidence","incomplete_multimodal_coverage","ambiguous_weapon_or_law_enforcement_context"],
      "block":["explicit_sexual_activity","pornography","sexualized_explicit_genital_exposure","child_sexual_exploitation","non_consensual_intimate_content","sexual_violence","torture","mutilation","graphic_murder","graphic_serious_assault","explicit_promotion_of_severe_harm"]
    },
    "context_contract":{"classify_content_and_context_together":true,"keywords_are_context_only":true,"isolated_police_or_weapon_presence_decides_outcome":false,"peaceful_non_graphic_police_operation":"allow","visible_carried_or_holstered_weapon_without_threat":"allow","non_threatening_weapon_presence_requires_visual_binding":true,"structured_signals":{"weapon_state":["not_observed","visible_non_threatening","pointed_brandished_fired_or_threatening","uncertain"],"law_enforcement_state":["not_observed","routine_peaceful","force_or_confrontation","uncertain"],"violence_state":["none_observed","real_non_graphic_or_incidental_injury","graphic_or_severe","uncertain"],"allow_requires_non_threatening_weapon_state":true,"allow_requires_routine_or_absent_law_enforcement_state":true,"allow_requires_no_observed_violence":true},"pointed_brandished_or_fired_weapon":"review","credible_threat_confrontation_or_force":"review","non_graphic_real_violence_or_injury":"review","incidental_blood_or_documentary_violence":"review","ambiguous_or_incomplete":"review","graphic_severe_harm":"block","missing_required_modality":"review","uncertain_age_or_consent":"review"},
    "activation":{"status":"active","enabled":true,"auto_publish_enabled":true,"blockers":[],"authorized_phase":"CONTENT-SAFETY-P3","authorized_at":"2026-10-19","owner_bound":true,"p2_evidence_preserved":true,"disable_strategy":"forward_only_policy_revision"},
    "publication":{"auto_publish_requires_all_modalities":true,"requires_current_generation":true,"requires_current_owner_and_permissions":true,"requires_provider_validity":true,"requires_active_approved_policy":true,"requires_unambiguous_allow":true,"historical_decisions_are_not_reclassified_automatically":true,"technical_failure":"fail_closed","ambiguous_or_incomplete":"human_review","http_200_is_evidence":false},
    "administrative_review":{"private_by_default":true,"authorized_reviewers_only":true,"audit_required":true,"existing_alerts_are_not_auto_dismissed":true,"historical_restricted_content_is_not_auto_restored":true,"child_exploitation_block_cannot_be_overridden_by_ordinary_review":true},
    "finance":{"purchase_enabled":false,"subscription_enabled":false,"refunds_enabled":false,"platform_fee_bps":0}
  }
  $policy$::jsonb;
$$;

-- The historical callable remains readable as metadata but cannot be mistaken
-- for a second active authority after P3 takes effect.
create or replace function private.creator_premium_content_safety_policy_p1_v1()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select $policy$
  {
    "schema_version":"nelyon.creator_premium_content_safety_policy.v1",
    "policy_id":"nelyon.creator_premium.general.p1.v1",
    "successor_policy_id":"nelyon.creator_premium.general.p1.v2",
    "title":"Creator Premium General Content Safety P1",
    "artifact_sha256":"43da0f9039abb930aa34e09d513220713264e46b0f4187f91a769c1f9a3af52b",
    "normative_approval":{"status":"approved","source":"owner_prompt","authorized_phase":"CREATOR-PREMIUM-CONTENT-SAFETY-P1","authorized_at":"2026-10-18","owner_bound":true},
    "scope":{"creator_premium_general":true,"public_feed_surfaces":["preview","teaser","thumbnail","notification","discovery"],"explicit_adult_premium":false,"mobile_explicit_adult":false,"finance_effect":false},
    "decision_matrix":{
      "allow":["courses","tutorials","education","entertainment","dance","humor","sport","fashion","kissing_and_affection","swimwear","non_explicit_sensual_clothing","non_sexual_artistic_content"],
      "review":["contextual_artistic_or_medical_nudity","incidental_blood_or_informational_context","documentary_violence","age_uncertain","consent_uncertain","contradictory_signals","low_confidence","incomplete_multimodal_coverage"],
      "block":["explicit_sexual_activity","pornography","sexualized_explicit_genital_exposure","child_sexual_exploitation","non_consensual_intimate_content","sexual_violence","torture","mutilation","graphic_murder","graphic_serious_assault","explicit_promotion_of_severe_harm"]
    },
    "context_contract":{"classify_content_and_context_together":true,"keywords_are_context_only":true,"educational_or_medical_text_is_not_blocked_by_words_alone":true,"skin_or_swimwear_is_not_automatic_rejection":true,"missing_required_modality":"review","uncertain_age_or_consent":"review"},
    "activation":{
      "status":"superseded",
      "enabled":false,
      "auto_publish_enabled":false,
      "blockers":[],
      "authorized_phase":"CREATOR-PREMIUM-CONTENT-SAFETY-P2",
      "authorized_at":"2026-10-18",
      "owner_bound":true,
      "activation_evidence_sha256":"9837d584c15864d4ed34963bf050cbf2d018f601e91f49142bb4910d1c8c1f7a",
      "gates":{"contextual_text_classification":"verified","contextual_transcript_classification":"verified","age_uncertainty_signal":"verified","consent_uncertainty_signal":"verified","model_confidence_contract":"verified","account_quota_headroom":"verified","private_media_policy_e2e":"verified"},
      "disable_strategy":"forward_only_policy_revision"
    },
    "publication":{"auto_publish_requires_all_modalities":true,"requires_current_generation":true,"requires_current_owner_and_permissions":true,"requires_provider_validity":true,"requires_active_approved_policy":true,"requires_unambiguous_allow":true,"technical_failure":"fail_closed","ambiguous_or_incomplete":"human_review","http_200_is_evidence":false},
    "administrative_review":{"private_by_default":true,"authorized_reviewers_only":true,"audit_required":true,"manual_decision_is_not_fabricated":true,"child_exploitation_block_cannot_be_overridden_by_ordinary_review":true},
    "finance":{"purchase_enabled":false,"subscription_enabled":false,"refunds_enabled":false,"platform_fee_bps":0}
  }
  $policy$::jsonb;
$$;

create or replace function private.creator_premium_content_safety_decision_p1_v1(
  p_scan_id uuid
) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_policy jsonb := private.creator_premium_content_safety_policy_p1_v2();
  v_policy_enabled boolean;
  v_candidate jsonb;
begin
  v_policy_enabled := coalesce(
    v_policy->>'schema_version'='nelyon.creator_premium_content_safety_policy.v2'
    and v_policy->>'policy_id'='nelyon.creator_premium.general.p1.v2'
    and v_policy->>'predecessor_policy_id'='nelyon.creator_premium.general.p1.v1'
    and v_policy->>'artifact_sha256'='98607897d8e82f5f3df7e632fa214c557f86b0a7e8ff068a03a5794c6b256911'
    and v_policy#>>'{normative_approval,status}'='approved'
    and v_policy#>>'{normative_approval,source}'='owner_prompt'
    and v_policy#>>'{normative_approval,authorized_phase}'='CONTENT-SAFETY-P3'
    and v_policy#>'{normative_approval,owner_bound}'='true'::jsonb
    and v_policy#>'{scope,creator_premium_general}'='true'::jsonb
    and v_policy#>'{scope,public_feed_policy_changed}'='false'::jsonb
    and v_policy#>'{scope,explicit_adult_premium}'='false'::jsonb
    and v_policy#>'{scope,mobile_explicit_adult}'='false'::jsonb
    and v_policy#>'{scope,finance_effect}'='false'::jsonb
    and v_policy#>>'{activation,status}'='active'
    and v_policy#>'{activation,enabled}'='true'::jsonb
    and v_policy#>'{activation,auto_publish_enabled}'='true'::jsonb
    and v_policy#>>'{activation,authorized_phase}'='CONTENT-SAFETY-P3'
    and v_policy#>'{activation,owner_bound}'='true'::jsonb
    and v_policy#>'{activation,p2_evidence_preserved}'='true'::jsonb
    and pg_catalog.jsonb_typeof(v_policy#>'{activation,blockers}')='array'
    and pg_catalog.jsonb_array_length(v_policy#>'{activation,blockers}')=0
    and v_policy#>'{publication,auto_publish_requires_all_modalities}'='true'::jsonb
    and v_policy#>'{publication,requires_current_generation}'='true'::jsonb
    and v_policy#>'{publication,requires_current_owner_and_permissions}'='true'::jsonb
    and v_policy#>'{publication,requires_provider_validity}'='true'::jsonb
    and v_policy#>'{publication,requires_active_approved_policy}'='true'::jsonb
    and v_policy#>'{publication,requires_unambiguous_allow}'='true'::jsonb
    and v_policy#>'{publication,historical_decisions_are_not_reclassified_automatically}'='true'::jsonb
    and v_policy#>>'{publication,technical_failure}'='fail_closed'
    and v_policy#>>'{publication,ambiguous_or_incomplete}'='human_review'
    and v_policy#>'{publication,http_200_is_evidence}'='false'::jsonb
    and v_policy#>'{finance,purchase_enabled}'='false'::jsonb
    and v_policy#>'{finance,subscription_enabled}'='false'::jsonb
    and v_policy#>'{finance,refunds_enabled}'='false'::jsonb
    and v_policy#>>'{finance,platform_fee_bps}'='0',
    false
  );
  if not v_policy_enabled then
    return pg_catalog.jsonb_build_object(
      'scan_id',p_scan_id,'policy_id',v_policy->>'policy_id',
      'decision','awaiting_policy',
      'reason','content_safety_policy_activation_invalid',
      'activation_effect',false
    );
  end if;
  v_candidate:=private.creator_premium_content_safety_candidate_p3_v1(p_scan_id);
  if v_candidate->>'policy_id' is distinct from
       'nelyon.creator_premium.general.p1.v2'
     or v_candidate->>'decision' not in ('allow','review','block') then
    return pg_catalog.jsonb_build_object(
      'scan_id',p_scan_id,'content_id',v_candidate->'content_id',
      'policy_id','nelyon.creator_premium.general.p1.v2',
      'decision','technical_failure',
      'reason','creator_premium_contextual_evidence_invalid',
      'activation_effect',false
    );
  end if;
  return v_candidate || pg_catalog.jsonb_build_object(
    'activation_effect',true,
    'policy_artifact_sha256','98607897d8e82f5f3df7e632fa214c557f86b0a7e8ff068a03a5794c6b256911'
  );
end;
$$;

create or replace function public.complete_creator_premium_content_safety_context_v1(
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
    and policy_id='nelyon.creator_premium.general.p1.v2'
    and schema_version='creator-premium-context-p3-v1'
    and prompt_version='creator-premium-context-p3-v1'
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
     or not private.creator_premium_content_safety_context_result_valid_p3_v1(
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
  if p_context_result->>'decision'='allow'
     and not private.creator_premium_content_safety_visual_allow_compatible_p3_v1(
       p_context_result,v_analysis.analysis_result
     ) then
    raise exception using errcode='22023',
      message='creator_premium_context_schema_invalid';
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
    v_evaluation.policy_id||'|'||v_evaluation.schema_version||'|'||
    v_evaluation.provider||'|'||v_evaluation.model||'|'||
    v_evaluation.prompt_version||'|'||v_evaluation.transcript_coverage||'|'||
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

create or replace function public.fail_creator_premium_content_safety_context_v1(
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
    and policy_id='nelyon.creator_premium.general.p1.v2'
    and schema_version='creator-premium-context-p3-v1'
    and prompt_version='creator-premium-context-p3-v1'
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

create or replace function public.claim_creator_premium_content_safety_context_v1(
  p_limit integer default 1
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row record;
  v_result jsonb := '[]'::jsonb;
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',message='creator_premium_service_role_required';
  end if;
  if p_limit < 1 or p_limit > 1 then
    raise exception using errcode='22023',
      message='invalid_creator_premium_context_claim_limit';
  end if;

  insert into private.creator_premium_content_safety_context_evaluations(
    source_scan_id,target_id,owner_user_id,source_content_fingerprint,
    policy_id,schema_version,prompt_version,
    transcript_coverage,transcript_id,transcript_fingerprint,
    visual_analysis_id,visual_analysis_fingerprint
  )
  select
    scan.id,content.id,content.creator_id,scan.content_fingerprint,
    'nelyon.creator_premium.general.p1.v2','creator-premium-context-p3-v1',
    'creator-premium-context-p3-v1',
    case when content.content_kind='image' then 'not_applicable'
      when transcript.no_speech then 'no_speech' else 'complete' end,
    transcript.id,transcript.transcript_fingerprint,
    analysis.id,analysis.analysis_fingerprint
  from private.content_safety_scans scan
  join private.creator_premium_contents content on content.id=scan.target_id
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
    order by candidate.created_at desc,candidate.id desc limit 1
  ) transcript on true
  cross join lateral (
    select private.content_safety_target_snapshot('creator_premium',content.id) value
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
      evaluation.policy_id,evaluation.schema_version,evaluation.prompt_version,
      evaluation.transcript_coverage,snapshot.value->>'text_value' text,
      case when evaluation.transcript_coverage='complete'
        then transcript.transcript_text else '' end transcript_text,
      analysis.analysis_result visual_result
    from private.creator_premium_content_safety_context_evaluations evaluation
    join private.content_safety_scans scan on scan.id=evaluation.source_scan_id
    join private.creator_premium_contents content on content.id=evaluation.target_id
    join private.content_safety_visual_analyses analysis
      on analysis.id=evaluation.visual_analysis_id
      and analysis.analysis_fingerprint=evaluation.visual_analysis_fingerprint
    left join private.content_safety_audio_transcripts transcript
      on transcript.id=evaluation.transcript_id
      and transcript.transcript_fingerprint=evaluation.transcript_fingerprint
    cross join lateral (
      select private.content_safety_target_snapshot('creator_premium',content.id) value
    ) snapshot
    where evaluation.policy_id='nelyon.creator_premium.general.p1.v2'
      and evaluation.schema_version='creator-premium-context-p3-v1'
      and evaluation.prompt_version='creator-premium-context-p3-v1'
      and evaluation.status in ('pending','processing')
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
        'policy_id',v_row.policy_id,
        'schema_version',v_row.schema_version,
        'prompt_version',v_row.prompt_version,
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

create or replace function public.reconcile_creator_premium_publications_v1(
  p_limit integer default 25
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_scan_id uuid;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_count integer := 0;
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',
      message='creator_premium_service_role_required';
  end if;
  if p_limit<1 or p_limit>50 then
    raise exception using errcode='22023',
      message='creator_premium_reconcile_limit_invalid';
  end if;
  for v_scan_id in
    select scan.id
    from private.content_safety_scans scan
    join private.creator_premium_contents content on content.id=scan.target_id
    where scan.target_type='creator_premium' and (
      (
        content.lifecycle_status='pending_review'
        and content.verification_scan_id=scan.id
        and content.verification_fingerprint=scan.content_fingerprint
        and (
          content.verification_status='pending'
          or (
            content.verification_status='commercial_pending'
            and exists(
              select 1
              from private.creator_premium_plan_contents mapping
              join private.creator_premium_plans plan
                on plan.id=mapping.plan_id
               and plan.creator_id=mapping.creator_id
              where mapping.content_id=content.id
                and mapping.creator_id=content.creator_id
                and plan.status='active'
            )
          )
          or (
            content.verification_status='failed'
            and content.verification_error_code=
              'content_safety_policy_not_configured'
            and exists(
              select 1
              from private.creator_premium_content_safety_context_evaluations
                evaluation
              where evaluation.source_scan_id=scan.id
                and evaluation.source_content_fingerprint=
                  scan.content_fingerprint
                and evaluation.policy_id=
                  'nelyon.creator_premium.general.p1.v2'
                and evaluation.schema_version=
                  'creator-premium-context-p3-v1'
                and evaluation.prompt_version=
                  'creator-premium-context-p3-v1'
                and evaluation.status='completed'
            )
          )
        )
      )
      or (
        content.lifecycle_status='published'
        and content.verification_status='passed'
        and content.verification_scan_id=scan.id
        and content.verification_fingerprint=scan.content_fingerprint
        and (
          exists(
            select 1 from private.content_safety_alerts alert
            where alert.scan_id=scan.id
              and alert.source_type not in (
                'text_rule','audio_transcript_rule','visual_classifier'
              )
              and not (
                alert.status='dismissed'
                and alert.resolution='no_violation'
              )
          )
          or (
            exists(
              select 1 from private.content_safety_alerts alert
              where alert.scan_id=scan.id
                and not (
                  alert.status='dismissed'
                  and alert.resolution='no_violation'
                )
            )
            and (
              (
                exists(
                  select 1
                  from private.creator_premium_content_safety_context_evaluations
                    evaluation
                  where evaluation.source_scan_id=scan.id
                    and evaluation.source_content_fingerprint=
                      scan.content_fingerprint
                    and evaluation.policy_id=
                      'nelyon.creator_premium.general.p1.v2'
                    and evaluation.schema_version=
                      'creator-premium-context-p3-v1'
                    and evaluation.prompt_version=
                      'creator-premium-context-p3-v1'
                    and evaluation.status='completed'
                )
                and not (
                  private.creator_premium_content_safety_decision_p1_v1(scan.id)
                    @> '{"policy_id":"nelyon.creator_premium.general.p1.v2","decision":"allow","activation_effect":true}'::jsonb
                )
              )
              or (
                not exists(
                  select 1
                  from private.creator_premium_content_safety_context_evaluations
                    evaluation
                  where evaluation.source_scan_id=scan.id
                    and evaluation.source_content_fingerprint=
                      scan.content_fingerprint
                    and evaluation.policy_id=
                      'nelyon.creator_premium.general.p1.v2'
                    and evaluation.schema_version=
                      'creator-premium-context-p3-v1'
                    and evaluation.prompt_version=
                      'creator-premium-context-p3-v1'
                    and evaluation.status='completed'
                )
                and not private.creator_premium_content_safety_historical_p2_allow_valid_p3_v1(
                  scan.id
                )
              )
            )
          )
        )
      )
    )
    order by scan.updated_at,scan.id
    limit p_limit
    for update of scan skip locked
  loop
    v_result:=private.finalize_creator_premium_safety_scan_v1(v_scan_id);
    v_results:=v_results||pg_catalog.jsonb_build_array(v_result);
    v_count:=v_count+1;
  end loop;
  return pg_catalog.jsonb_build_object(
    'processed',v_count,'results',v_results
  );
end;
$$;

revoke all on function
  private.creator_premium_content_safety_context_result_valid_p3_v1(jsonb,text)
  from public, anon, authenticated, service_role;
revoke all on function
  private.creator_premium_content_safety_visual_allow_compatible_p3_v1(jsonb,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function
  private.creator_premium_content_safety_historical_p2_allow_valid_p3_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function
  private.creator_premium_content_safety_candidate_p3_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function
  private.creator_premium_content_safety_policy_p1_v2()
  from public, anon, authenticated, service_role;
revoke all on function
  private.creator_premium_content_safety_policy_p1_v1()
  from public, anon, authenticated, service_role;
revoke all on function
  private.creator_premium_content_safety_decision_p1_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function
  private.finalize_creator_premium_safety_scan_v1(uuid)
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
revoke all on function
  public.reconcile_creator_premium_publications_v1(integer)
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
grant execute on function
  public.reconcile_creator_premium_publications_v1(integer)
  to service_role;

comment on function private.creator_premium_content_safety_policy_p1_v1() is
  'Historical P1 policy metadata. Superseded and disabled by owner-approved P3 policy v2.';
comment on function private.creator_premium_content_safety_policy_p1_v2() is
  'Unique active owner-approved P3 Creator Premium general policy; explicit adult Premium remains excluded.';
comment on function private.creator_premium_content_safety_decision_p1_v1(uuid)
  is 'Stable canonical decision ABI bound exclusively to current P3 v2 evidence.';
comment on function private.creator_premium_content_safety_candidate_p3_v1(uuid)
  is 'Strict P3 candidate bound to current scan, fingerprint, multimodal evidence and v2 policy identity.';
comment on function private.creator_premium_content_safety_visual_allow_compatible_p3_v1(jsonb,jsonb)
  is 'Fail-closed P3 visual/context compatibility guard for every contextual ALLOW.';
comment on function private.creator_premium_content_safety_historical_p2_allow_valid_p3_v1(uuid)
  is 'Read-only exact-evidence guard that preserves only previously valid P2 ALLOW publications; it cannot publish or reclassify content.';
comment on function public.reconcile_creator_premium_publications_v1(integer)
  is 'Service-role-only Premium reconciler; exact P3 visual-only allows remain published without dismissing evidence alerts.';

commit;
