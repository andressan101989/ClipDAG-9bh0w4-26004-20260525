begin;

-- P2 activates only the already owner-approved P1 policy after the seven
-- evidence gates have been independently verified. The normative matrix is
-- unchanged, explicit adult Premium remains excluded, and Finance remains off.
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
      "status":"active",
      "enabled":true,
      "auto_publish_enabled":true,
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

-- The active decision authority delegates to the single strict P2 contextual
-- candidate. It cannot convert missing, stale, malformed, or ambiguous
-- evidence into an allow decision.
create or replace function private.creator_premium_content_safety_decision_p1_v1(
  p_scan_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_policy jsonb := private.creator_premium_content_safety_policy_p1_v1();
  v_policy_enabled boolean;
  v_candidate jsonb;
begin
  v_policy_enabled := coalesce(
    v_policy->>'schema_version' =
      'nelyon.creator_premium_content_safety_policy.v1'
    and v_policy->>'policy_id' = 'nelyon.creator_premium.general.p1.v1'
    and v_policy->>'artifact_sha256' =
      '43da0f9039abb930aa34e09d513220713264e46b0f4187f91a769c1f9a3af52b'
    and v_policy#>>'{normative_approval,status}' = 'approved'
    and v_policy#>>'{normative_approval,source}' = 'owner_prompt'
    and v_policy#>>'{normative_approval,authorized_phase}' =
      'CREATOR-PREMIUM-CONTENT-SAFETY-P1'
    and v_policy#>'{normative_approval,owner_bound}' = 'true'::jsonb
    and v_policy#>'{scope,creator_premium_general}' = 'true'::jsonb
    and v_policy#>'{scope,explicit_adult_premium}' = 'false'::jsonb
    and v_policy#>'{scope,mobile_explicit_adult}' = 'false'::jsonb
    and v_policy#>'{scope,finance_effect}' = 'false'::jsonb
    and v_policy#>>'{activation,status}' = 'active'
    and v_policy#>'{activation,enabled}' = 'true'::jsonb
    and v_policy#>'{activation,auto_publish_enabled}' = 'true'::jsonb
    and v_policy#>>'{activation,authorized_phase}' =
      'CREATOR-PREMIUM-CONTENT-SAFETY-P2'
    and v_policy#>'{activation,owner_bound}' = 'true'::jsonb
    and v_policy#>>'{activation,activation_evidence_sha256}' =
      '9837d584c15864d4ed34963bf050cbf2d018f601e91f49142bb4910d1c8c1f7a'
    and v_policy#>'{activation,gates}' =
      '{"contextual_text_classification":"verified","contextual_transcript_classification":"verified","age_uncertainty_signal":"verified","consent_uncertainty_signal":"verified","model_confidence_contract":"verified","account_quota_headroom":"verified","private_media_policy_e2e":"verified"}'::jsonb
    and pg_catalog.jsonb_typeof(v_policy#>'{activation,blockers}') = 'array'
    and pg_catalog.jsonb_array_length(v_policy#>'{activation,blockers}') = 0
    and v_policy#>'{publication,auto_publish_requires_all_modalities}' =
      'true'::jsonb
    and v_policy#>'{publication,requires_current_generation}' = 'true'::jsonb
    and v_policy#>'{publication,requires_current_owner_and_permissions}' =
      'true'::jsonb
    and v_policy#>'{publication,requires_provider_validity}' = 'true'::jsonb
    and v_policy#>'{publication,requires_active_approved_policy}' =
      'true'::jsonb
    and v_policy#>'{publication,requires_unambiguous_allow}' = 'true'::jsonb
    and v_policy#>>'{publication,technical_failure}' = 'fail_closed'
    and v_policy#>>'{publication,ambiguous_or_incomplete}' = 'human_review'
    and v_policy#>'{publication,http_200_is_evidence}' = 'false'::jsonb
    and v_policy#>'{finance,purchase_enabled}' = 'false'::jsonb
    and v_policy#>'{finance,subscription_enabled}' = 'false'::jsonb
    and v_policy#>'{finance,refunds_enabled}' = 'false'::jsonb
    and v_policy#>>'{finance,platform_fee_bps}' = '0',
    false
  );

  if not v_policy_enabled then
    return pg_catalog.jsonb_build_object(
      'scan_id', p_scan_id,
      'policy_id', v_policy->>'policy_id',
      'decision', 'awaiting_policy',
      'reason', 'content_safety_policy_activation_invalid',
      'activation_effect', false
    );
  end if;

  v_candidate :=
    private.creator_premium_content_safety_candidate_p2_v1(p_scan_id);
  if v_candidate->>'policy_id' is distinct from
       'nelyon.creator_premium.general.p1.v1'
     or v_candidate->>'decision' not in ('allow','review','block') then
    return pg_catalog.jsonb_build_object(
      'scan_id', p_scan_id,
      'content_id', v_candidate->'content_id',
      'policy_id', 'nelyon.creator_premium.general.p1.v1',
      'decision', 'technical_failure',
      'reason', 'creator_premium_contextual_evidence_invalid',
      'activation_effect', false
    );
  end if;

  return v_candidate || pg_catalog.jsonb_build_object(
    'activation_effect', true,
    'activation_evidence_sha256',
      '9837d584c15864d4ed34963bf050cbf2d018f601e91f49142bb4910d1c8c1f7a'
  );
end;
$$;

-- A policy-blocked record may be reconsidered only when its exact current
-- scan has a completed P2 contextual evaluation. Other failed records remain
-- terminal and are never swept into an activation retry.
create or replace function public.reconcile_creator_premium_publications_v1(
  p_limit integer default 25
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scan_id uuid;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_count integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501',
      message = 'creator_premium_service_role_required';
  end if;
  if p_limit < 1 or p_limit > 50 then
    raise exception using errcode = '22023',
      message = 'creator_premium_reconcile_limit_invalid';
  end if;
  for v_scan_id in
    select scan.id
    from private.content_safety_scans scan
    join private.creator_premium_contents content
      on content.id = scan.target_id
    where scan.target_type = 'creator_premium' and (
      (
        content.lifecycle_status = 'pending_review'
        and content.verification_scan_id = scan.id
        and (
          content.verification_status = 'pending'
          or (
            content.verification_status = 'commercial_pending'
            and exists (
              select 1
              from private.creator_premium_plan_contents mapping
              join private.creator_premium_plans plan
                on plan.id = mapping.plan_id
               and plan.creator_id = mapping.creator_id
              where mapping.content_id = content.id
                and mapping.creator_id = content.creator_id
                and plan.status = 'active'
            )
          )
          or (
            content.verification_status='failed'
            and content.verification_error_code=
              'content_safety_policy_not_configured'
            and exists (
              select 1
              from private.creator_premium_content_safety_context_evaluations
                evaluation
              where evaluation.source_scan_id = scan.id
                and evaluation.source_content_fingerprint=
                  scan.content_fingerprint
                and evaluation.policy_id =
                  'nelyon.creator_premium.general.p1.v1'
                and evaluation.schema_version =
                  'creator-premium-context-p2-v1'
                and evaluation.status='completed'
            )
          )
        )
      )
      or (
        content.lifecycle_status = 'published'
        and exists (
          select 1
          from private.content_safety_alerts alert
          where alert.scan_id = scan.id
            and not (
              alert.status = 'dismissed'
              and alert.resolution = 'no_violation'
            )
        )
      )
    )
    order by scan.updated_at, scan.id
    limit p_limit
    for update of scan skip locked
  loop
    v_result := private.finalize_creator_premium_safety_scan_v1(v_scan_id);
    v_results := v_results || pg_catalog.jsonb_build_array(v_result);
    v_count := v_count + 1;
  end loop;
  return pg_catalog.jsonb_build_object(
    'processed', v_count,
    'results', v_results
  );
end;
$$;

revoke all on function
  private.creator_premium_content_safety_policy_p1_v1()
  from public, anon, authenticated, service_role;
revoke all on function
  private.creator_premium_content_safety_decision_p1_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function
  public.reconcile_creator_premium_publications_v1(integer)
  from public, anon, authenticated, service_role;
grant execute on function
  public.reconcile_creator_premium_publications_v1(integer)
  to service_role;

comment on function private.creator_premium_content_safety_policy_p1_v1() is
  'Owner-approved Creator Premium general P1 policy, activated only after the seven P2 evidence gates; explicit adult Premium remains excluded.';
comment on function private.creator_premium_content_safety_decision_p1_v1(uuid)
  is 'Active fail-closed P1 decision authority bound to strict current P2 contextual evidence.';
comment on function public.reconcile_creator_premium_publications_v1(integer)
  is 'Service-role-only Premium reconciler. It may recover only exact policy-blocked records with completed current P2 evidence.';

commit;
