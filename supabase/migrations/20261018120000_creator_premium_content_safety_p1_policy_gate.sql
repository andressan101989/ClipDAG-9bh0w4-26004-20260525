begin;

-- P1 records the owner's normative policy without pretending that the current
-- phrase detectors and visual triage schema provide the contextual, age,
-- consent, confidence, and multimodal evidence required for auto-publication.
-- Activation remains fail-closed until a later forward-only migration proves
-- and enables every blocker named by this immutable contract.
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
    "artifact_sha256":"43da0f9039abb930aa34e09d513220713264e46b0f4187f91a769c1f9a3af52b",
    "normative_approval":{"status":"approved","source":"owner_prompt","owner_bound":true},
    "scope":{"creator_premium_general":true,"explicit_adult_premium":false,"mobile_explicit_adult":false,"finance_effect":false},
    "decision_matrix":{
      "allow":["courses","tutorials","education","entertainment","dance","humor","sport","fashion","kissing_and_affection","swimwear","non_explicit_sensual_clothing","non_sexual_artistic_content"],
      "review":["contextual_artistic_or_medical_nudity","incidental_blood_or_informational_context","documentary_violence","age_uncertain","consent_uncertain","contradictory_signals","low_confidence","incomplete_multimodal_coverage"],
      "block":["explicit_sexual_activity","pornography","sexualized_explicit_genital_exposure","child_sexual_exploitation","non_consensual_intimate_content","sexual_violence","torture","mutilation","graphic_murder","graphic_serious_assault","explicit_promotion_of_severe_harm"]
    },
    "context_contract":{"keywords_are_context_only":true,"educational_or_medical_text_is_not_blocked_by_words_alone":true,"missing_required_modality":"review"},
    "activation":{
      "status":"approved_activation_pending",
      "enabled":false,
      "auto_publish_enabled":false,
      "blockers":["contextual_text_classification_unverified","contextual_transcript_classification_unverified","age_uncertainty_signal_unavailable","consent_uncertainty_signal_unavailable","model_confidence_signal_unavailable","account_quota_headroom_unverified","private_media_policy_e2e_unverified"]
    },
    "publication":{"auto_publish_requires_all_modalities":true,"technical_failure":"fail_closed","ambiguous_or_incomplete":"human_review","http_200_is_evidence":false}
  }
  $policy$::jsonb;
$$;

create or replace function private.creator_premium_content_safety_decision_p1_v1(p_scan_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scan private.content_safety_scans;
  v_content private.creator_premium_contents;
  v_policy jsonb := private.creator_premium_content_safety_policy_p1_v1();
  v_policy_id text;
  v_policy_enabled boolean;
  v_normalized_block boolean := false;
  v_normalized_review boolean := false;
  v_has_unresolved_signal boolean := false;
begin
  v_policy_id := v_policy->>'policy_id';
  v_policy_enabled := coalesce((v_policy#>>'{activation,enabled}')::boolean, false)
    and coalesce((v_policy#>>'{activation,auto_publish_enabled}')::boolean, false);

  select scan.* into v_scan
  from private.content_safety_scans scan
  where scan.id = p_scan_id;
  if not found then
    return pg_catalog.jsonb_build_object(
      'scan_id', p_scan_id, 'policy_id', v_policy_id,
      'decision', 'technical_failure', 'reason', 'creator_premium_scan_missing'
    );
  end if;
  if v_scan.target_type <> 'creator_premium' then
    return pg_catalog.jsonb_build_object(
      'scan_id', v_scan.id, 'policy_id', v_policy_id,
      'decision', 'technical_failure', 'reason', 'creator_premium_target_invalid'
    );
  end if;
  select content.* into v_content
  from private.creator_premium_contents content
  where content.id = v_scan.target_id;
  if not found then
    return pg_catalog.jsonb_build_object(
      'scan_id', v_scan.id, 'policy_id', v_policy_id,
      'decision', 'technical_failure', 'reason', 'creator_premium_content_missing'
    );
  end if;

  if not v_policy_enabled then
    return pg_catalog.jsonb_build_object(
      'scan_id', v_scan.id, 'content_id', v_content.id,
      'policy_id', v_policy_id, 'decision', 'awaiting_policy',
      'reason', 'content_safety_policy_activation_pending'
    );
  end if;

  -- Phrase matches remain context signals. They can request human review but
  -- can never become a context-free block or a publication PASS.
  if exists (
    select 1
    from private.content_safety_alerts alert
    where alert.scan_id = v_scan.id
      and alert.source_type = 'text_rule'
      and not (alert.status = 'dismissed' and alert.resolution = 'no_violation')
  ) then
    return pg_catalog.jsonb_build_object(
      'scan_id', v_scan.id, 'content_id', v_content.id,
      'policy_id', v_policy_id, 'decision', 'review',
      'reason', 'contextual_text_review_required'
    );
  end if;
  if exists (
    select 1
    from private.content_safety_alerts alert
    where alert.scan_id = v_scan.id
      and alert.source_type = 'audio_transcript_rule'
      and not (alert.status = 'dismissed' and alert.resolution = 'no_violation')
  ) then
    return pg_catalog.jsonb_build_object(
      'scan_id', v_scan.id, 'content_id', v_content.id,
      'policy_id', v_policy_id, 'decision', 'review',
      'reason', 'contextual_transcript_review_required'
    );
  end if;

  -- A block is accepted only from a future canonical contextual classifier
  -- that binds the exact P1 policy and proves complete coverage, sufficient
  -- confidence, and resolved age/consent signals. Current C4/C5 triage output
  -- has none of these fields and therefore cannot enter this branch.
  select exists (
    select 1
    from private.content_safety_alerts alert
    where alert.scan_id = v_scan.id
      and not (alert.status = 'dismissed' and alert.resolution = 'no_violation')
      and alert.evidence->>'policy_id' = v_policy_id
      and alert.evidence->>'policy_decision' = 'block'
      and alert.evidence->>'coverage_complete' = 'true'
      and alert.evidence->>'confidence_sufficient' = 'true'
      and alert.evidence->>'age_assessment' = 'resolved'
      and alert.evidence->>'consent_assessment' = 'resolved'
      and alert.evidence->>'policy_category' = any (
        array[
          'explicit_sexual_activity','pornography','sexualized_explicit_genital_exposure',
          'child_sexual_exploitation','non_consensual_intimate_content','sexual_violence',
          'torture','mutilation','graphic_murder','graphic_serious_assault',
          'explicit_promotion_of_severe_harm'
        ]::text[]
      )
  ) into v_normalized_block;
  if v_normalized_block then
    return pg_catalog.jsonb_build_object(
      'scan_id', v_scan.id, 'content_id', v_content.id,
      'policy_id', v_policy_id, 'decision', 'block',
      'reason', 'creator_premium_policy_block'
    );
  end if;

  select exists (
    select 1
    from private.content_safety_alerts alert
    where alert.scan_id = v_scan.id
      and not (alert.status = 'dismissed' and alert.resolution = 'no_violation')
      and alert.evidence->>'policy_id' = v_policy_id
      and alert.evidence->>'policy_decision' = 'review'
  ) into v_normalized_review;
  select exists (
    select 1
    from private.content_safety_alerts alert
    where alert.scan_id = v_scan.id
      and not (alert.status = 'dismissed' and alert.resolution = 'no_violation')
  ) into v_has_unresolved_signal;
  if v_normalized_review or v_has_unresolved_signal then
    return pg_catalog.jsonb_build_object(
      'scan_id', v_scan.id, 'content_id', v_content.id,
      'policy_id', v_policy_id, 'decision', 'review',
      'reason', case when v_normalized_review then 'creator_premium_policy_review'
        else 'creator_premium_unclassified_signal' end
    );
  end if;

  -- No current producer emits the contextual evaluation required for allow.
  -- This explicit review remains safe even if somebody edits only the policy
  -- enabled flag; activation needs a forward-only producer/decision revision.
  return pg_catalog.jsonb_build_object(
    'scan_id', v_scan.id, 'content_id', v_content.id,
    'policy_id', v_policy_id, 'decision', 'review',
    'reason', 'creator_premium_contextual_evidence_incomplete'
  );
end;
$$;

create or replace function private.finalize_creator_premium_safety_scan_v1(p_scan_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_scan private.content_safety_scans;v_content private.creator_premium_contents;
  v_snapshot jsonb;v_current_fingerprint text;v_blocker text;
  v_transcript private.content_safety_audio_transcripts;v_now timestamptz;
  v_policy_decision jsonb;
begin
  select * into v_scan from private.content_safety_scans where id=p_scan_id for update;
  if not found or v_scan.target_type<>'creator_premium' then
    return pg_catalog.jsonb_build_object('scan_id',p_scan_id,'outcome','not_creator_premium');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('creator-premium-content:'||v_scan.target_id::text,0)
  );
  select * into v_content from private.creator_premium_contents
  where id=v_scan.target_id for update;
  if not found then return pg_catalog.jsonb_build_object('scan_id',v_scan.id,'outcome','content_missing');end if;
  v_now:=pg_catalog.clock_timestamp();

  -- Preserve B7's one-way restriction authority for already-published content.
  -- A report can never manufacture a new PASS or publication proof.
  if v_content.lifecycle_status='published' then
    v_snapshot:=private.content_safety_target_snapshot('creator_premium',v_content.id);
    if v_snapshot is null then
      return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','snapshot_unavailable');
    end if;
    v_current_fingerprint:=private.content_safety_sha256(
      'creator_premium|'||v_content.id::text||'|'||coalesce(v_snapshot->>'content_version','')
    );
    if v_current_fingerprint<>v_scan.content_fingerprint then
      return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','stale_scan');
    end if;
    if exists(
      select 1 from private.content_safety_alerts alert
      where alert.scan_id=v_scan.id
        and not (alert.status='dismissed' and alert.resolution='no_violation')
    ) then
      update private.creator_premium_contents content set
        lifecycle_status='quarantined',quarantined_at=v_now,
        reviewed_at=null,reviewed_by=null,review_reason='creator_premium_safety_signal',
        removal_reason='creator_premium_safety_signal',verification_scan_id=v_scan.id,
        verification_fingerprint=v_scan.content_fingerprint,verification_status='restricted',
        verification_error_code='creator_premium_safety_signal',verification_requested_at=coalesce(content.verification_requested_at,v_scan.created_at),
        verification_completed_at=v_now,updated_at=v_now
      where content.id=v_content.id and content.lifecycle_status='published';
      return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','restricted','published',false);
    end if;
    return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','published_unchanged');
  end if;

  if v_content.lifecycle_status<>'pending_review' then
    return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','state_changed','lifecycle_status',v_content.lifecycle_status);
  end if;
  if v_content.verification_scan_id is distinct from v_scan.id
     or v_content.verification_fingerprint is distinct from v_scan.content_fingerprint then
    return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','stale_scan');
  end if;
  v_snapshot:=private.content_safety_target_snapshot('creator_premium',v_content.id);
  if v_snapshot is null then
    update private.creator_premium_contents set verification_status='failed',
      verification_error_code='creator_premium_snapshot_unavailable',verification_completed_at=v_now,
      updated_at=v_now where id=v_content.id;
    return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','failed','error','creator_premium_snapshot_unavailable');
  end if;
  v_current_fingerprint:=private.content_safety_sha256(
    'creator_premium|'||v_content.id::text||'|'||coalesce(v_snapshot->>'content_version','')
  );
  if v_current_fingerprint<>v_scan.content_fingerprint then
    update private.creator_premium_contents set verification_status='failed',
      verification_error_code='creator_premium_stale_content_version',verification_completed_at=v_now,
      updated_at=v_now where id=v_content.id;
    return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','failed','error','creator_premium_stale_content_version');
  end if;
  if not private.creator_premium_actor_is_age_eligible_v1(v_content.creator_id)
     or not private.creator_premium_actor_is_operational_v1(v_content.creator_id) then
    update private.creator_premium_contents set lifecycle_status='quarantined',
      quarantined_at=v_now,review_reason='creator_premium_creator_restricted',
      removal_reason='creator_premium_creator_restricted',verification_status='restricted',
      verification_error_code='creator_premium_creator_restricted',verification_completed_at=v_now,
      updated_at=v_now where id=v_content.id;
    return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','restricted','error','creator_premium_creator_restricted');
  end if;

  if v_scan.status='failed' or v_scan.text_status in('failed','not_configured')
     or v_scan.visual_status in('failed','not_configured')
     or (v_content.content_kind='video' and v_scan.audio_status in('failed','not_configured')) then
    update private.creator_premium_contents set verification_status='failed',
      verification_error_code='creator_premium_safety_provider_failed',verification_completed_at=v_now,
      updated_at=v_now where id=v_content.id;
    return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','failed','error','creator_premium_safety_provider_failed');
  end if;
  if v_scan.status<>'completed' or v_scan.text_status<>'analyzed'
     or v_scan.reports_status<>'analyzed' or v_scan.visual_status<>'analyzed'
     or (v_content.content_kind='image' and v_scan.audio_status<>'not_applicable')
     or (v_content.content_kind='video' and v_scan.audio_status<>'analyzed') then
    return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','pending');
  end if;
  if v_content.content_kind='video' then
    select transcript.* into v_transcript from private.content_safety_audio_transcripts transcript
    where transcript.source_scan_id=v_scan.id
      and transcript.source_content_fingerprint=v_scan.content_fingerprint
      and transcript.rule_eval_status='completed'
    order by transcript.created_at desc,transcript.id desc limit 1;
    if not found then
      update private.creator_premium_contents set verification_status='failed',
        verification_error_code='creator_premium_audio_proof_invalid',verification_completed_at=v_now,
        updated_at=v_now where id=v_content.id;
      return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','failed','error','creator_premium_audio_proof_invalid');
    end if;
  end if;
  if not exists(
    select 1 from private.content_safety_visual_analyses analysis
    where analysis.id=v_scan.visual_analysis_id
      and ((v_content.content_kind='image' and analysis.media_asset_id=v_scan.visual_media_asset_id)
        or (v_content.content_kind='video' and analysis.video_asset_id=v_scan.visual_video_asset_id))
  ) then
    update private.creator_premium_contents set verification_status='failed',
      verification_error_code='creator_premium_visual_proof_invalid',verification_completed_at=v_now,
      updated_at=v_now where id=v_content.id;
    return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','failed','error','creator_premium_visual_proof_invalid');
  end if;

  v_policy_decision:=private.creator_premium_content_safety_decision_p1_v1(v_scan.id);
  if v_policy_decision->>'decision'='awaiting_policy' then
    update private.creator_premium_contents set verification_status='failed',
      verification_error_code='content_safety_policy_not_configured',verification_completed_at=v_now,
      updated_at=v_now where id=v_content.id;
    return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','failed',
      'error','content_safety_policy_not_configured','policy_id',v_policy_decision->>'policy_id');
  end if;
  if v_policy_decision->>'decision'='technical_failure' then
    update private.creator_premium_contents set verification_status='failed',
      verification_error_code='creator_premium_safety_decision_failed',verification_completed_at=v_now,
      updated_at=v_now where id=v_content.id;
    return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','failed',
      'error','creator_premium_safety_decision_failed');
  end if;
  if v_policy_decision->>'decision'='review' then
    update private.creator_premium_contents set lifecycle_status='quarantined',published_at=null,
      quarantined_at=v_now,removed_at=null,reviewed_at=null,reviewed_by=null,
      review_reason='creator_premium_safety_review_required',
      removal_reason='creator_premium_safety_review_required',verification_status='restricted',
      verification_error_code='creator_premium_safety_review_required',
      verification_completed_at=v_now,updated_at=v_now where id=v_content.id;
    return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','review',
      'error','creator_premium_safety_review_required','published',false);
  end if;
  if v_policy_decision->>'decision'='block' then
    update private.creator_premium_contents set lifecycle_status='rejected',published_at=null,
      quarantined_at=null,removed_at=null,reviewed_at=null,reviewed_by=null,
      review_reason='creator_premium_safety_blocked',
      removal_reason='creator_premium_safety_blocked',verification_status='blocked',
      verification_error_code='creator_premium_safety_blocked',
      verification_completed_at=v_now,updated_at=v_now where id=v_content.id;
    return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','blocked',
      'error','creator_premium_safety_blocked','published',false);
  end if;
  if v_policy_decision->>'decision'<>'allow' then
    update private.creator_premium_contents set verification_status='failed',
      verification_error_code='creator_premium_safety_decision_invalid',verification_completed_at=v_now,
      updated_at=v_now where id=v_content.id;
    return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','failed',
      'error','creator_premium_safety_decision_invalid');
  end if;

  v_blocker:=private.creator_premium_publication_blocker_v1(v_content.id);
  if v_blocker is not null then
    if v_blocker='creator_premium_active_plan_required' then
      update private.creator_premium_contents set verification_status='commercial_pending',
        verification_error_code=v_blocker,verification_completed_at=v_now,updated_at=v_now
      where id=v_content.id;
      return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','commercial_pending','error',v_blocker);
    end if;
    update private.creator_premium_contents set verification_status='failed',
      verification_error_code=v_blocker,verification_completed_at=v_now,updated_at=v_now
    where id=v_content.id;
    return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','failed','error',v_blocker);
  end if;
  update private.creator_premium_contents content set lifecycle_status='published',
    published_at=v_now,quarantined_at=null,removed_at=null,reviewed_at=null,reviewed_by=null,
    review_reason=null,removal_reason=null,verification_status='passed',
    verification_error_code=null,verification_completed_at=v_now,updated_at=v_now
  where content.id=v_content.id and content.lifecycle_status='pending_review'
    and content.verification_scan_id=v_scan.id
    and content.verification_fingerprint=v_scan.content_fingerprint;
  if not found then return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','state_changed');end if;
  return pg_catalog.jsonb_build_object('content_id',v_content.id,'outcome','published','published',true);
end;
$$;

revoke all on function private.creator_premium_content_safety_policy_p1_v1()
  from public, anon, authenticated, service_role;
revoke all on function private.creator_premium_content_safety_decision_p1_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.finalize_creator_premium_safety_scan_v1(uuid)
  from public, anon, authenticated, service_role;

comment on function private.creator_premium_content_safety_policy_p1_v1() is
  'Owner-approved P1 normative policy. Operational activation and auto-publication remain disabled until all contextual and live evidence blockers are closed.';
comment on function private.creator_premium_content_safety_decision_p1_v1(uuid) is
  'Private fail-closed P1 decision boundary. Phrase detections remain review signals and only policy-bound contextual evidence can block or allow.';

commit;
