import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import {
  POLICY_CONTEXT_PROMPT_VERSION,
  POLICY_CONTEXT_SCHEMA_VERSION,
  PolicyContextError,
  buildPolicyContextProbeRequest,
  buildPolicyContextRequest,
  runPolicyContextAnalysis,
  validatePolicyContextProbeResult,
  validatePolicyContextResult,
} from '../supabase/functions/content-safety-scan/policyContext.mjs'

const root = process.cwd()
const evidencePath = join(root, 'docs', 'creator-premium-content-safety-p2-evidence-v1.json')
const workerPath = join(root, 'supabase', 'functions', 'content-safety-scan', 'index.ts')
const migrationSuffix = '_creator_premium_content_safety_p2_evidence_runtime.sql'

function loadP2Migration() {
  const migrations = join(root, 'supabase', 'migrations')
  const matches = readdirSync(migrations).filter(name => name.endsWith(migrationSuffix))
  assert.equal(matches.length, 1, 'P2 must have exactly one forward-only evidence-runtime migration')
  return readFileSync(join(migrations, matches[0]), 'utf8')
}

function evidence() {
  assert.equal(existsSync(evidencePath), true, 'P2 evidence contract must exist')
  return JSON.parse(readFileSync(evidencePath, 'utf8'))
}

test('P2 evidence contract is pinned to the verified P1 production baseline', () => {
  const value = evidence()
  assert.equal(value.schema_version, 'nelyon.creator_premium_content_safety_p2_evidence.v1')
  assert.equal(value.policy_id, 'nelyon.creator_premium.general.p1.v1')
  assert.equal(value.baseline.git_sha, '6234e423664e5247a1dea5bcc92b8ab3ee97ad18')
  assert.equal(value.baseline.git_tree, 'a1793c9e648254b6a995d798cd79db80dfd862d8')
  assert.equal(value.baseline.migrations, 340)
  assert.equal(value.baseline.latest_migration, '20261018120000_creator_premium_content_safety_p1_policy_gate')
  assert.deepEqual(value.baseline.finance, {
    purchase_enabled: false,
    subscription_enabled: false,
    refunds_enabled: false,
    platform_fee_bps: 0,
  })
  assert.equal(value.baseline.explicit_adult_premium, false)
})

test('P2 names exactly the seven P1 blockers and cannot activate around one', () => {
  const value = evidence()
  assert.deepEqual(value.activation.blockers, [
    'contextual_text_classification_unverified',
    'contextual_transcript_classification_unverified',
    'age_uncertainty_signal_unavailable',
    'consent_uncertainty_signal_unavailable',
    'model_confidence_signal_unavailable',
    'account_quota_headroom_unverified',
    'private_media_policy_e2e_unverified',
  ])
  assert.equal(value.activation.enabled, false)
  assert.equal(value.activation.auto_publish_enabled, false)
  assert.equal(value.activation.strategy, 'two_checkpoint_forward_only')
  assert.equal(value.activation.require_all_gates_demonstrated, true)
})

test('P2 contextual result uses strict bounded evidence instead of numeric confidence or identity inference', () => {
  const value = evidence()
  assert.deepEqual(value.context_result.decisions, ['allow', 'review', 'block'])
  assert.deepEqual(value.context_result.coverage.text, ['complete'])
  assert.deepEqual(value.context_result.coverage.transcript, ['complete', 'no_speech', 'not_applicable'])
  assert.deepEqual(value.context_result.coverage.visual, ['complete'])
  assert.deepEqual(value.context_result.uncertainty, ['unambiguous', 'ambiguous'])
  assert.deepEqual(value.context_result.age_uncertainty, ['not_relevant', 'present'])
  assert.deepEqual(value.context_result.consent_uncertainty, ['not_relevant', 'present'])
  assert.equal(value.context_result.numeric_confidence_allowed, false)
  assert.equal(value.context_result.age_identity_assertion_allowed, false)
  assert.equal(value.context_result.consent_proof_from_appearance_allowed, false)
  assert.equal(value.context_result.unknown_or_incomplete, 'review_or_technical_failure')
})

test('P2 quota evidence is official, bounded, and separate from Stream credentials', () => {
  const value = evidence()
  assert.equal(value.gates.account_quota_headroom.status, 'demonstrated')
  assert.equal(value.gates.account_quota_headroom.source, 'cloudflare_dashboard_workers_ai_usage')
  assert.equal(value.gates.account_quota_headroom.daily_allocation_neurons, 10000)
  assert.equal(value.gates.account_quota_headroom.used_neurons, 409.62)
  assert.equal(value.gates.account_quota_headroom.headroom_neurons, 9590.38)
  assert.equal(value.gates.account_quota_headroom.reset, '00:00 UTC')
  assert.equal(value.gates.account_quota_headroom.stream_token_reused, false)
  assert.equal(value.gates.account_quota_headroom.max_live_inferences, 5)
})

test('P2 private E2E gate requires persisted evidence and a private result before activation', () => {
  const value = evidence()
  assert.equal(value.gates.private_media_policy_e2e.status, 'pending_live_evidence')
  assert.deepEqual(value.gates.private_media_policy_e2e.required_chain, [
    'private_media_source',
    'visual_analysis_bound',
    'audio_transcript_bound_or_not_applicable',
    'canonical_text_bound',
    'context_evaluation_persisted',
    'p1_decision_observed',
    'reconciler_observed',
    'content_remains_private',
  ])
  assert.equal(value.gates.private_media_policy_e2e.new_upload_allowed, false)
})

const completeImageInput = Object.freeze({
  text: 'Curso de historia del arte sobre un mural urbano.',
  transcript: { coverage: 'not_applicable', text: '' },
  visual: {
    coverage: 'complete',
    review_required: false,
    findings: [],
    summary: 'A presenter stands beside a painted mural.',
  },
})

const allowResult = Object.freeze({
  schema_version: 'creator-premium-context-p2-v1',
  policy_id: 'nelyon.creator_premium.general.p1.v1',
  decision: 'allow',
  categories: ['education'],
  coverage: { text: 'complete', transcript: 'not_applicable', visual: 'complete' },
  uncertainty: 'unambiguous',
  age_uncertainty: 'not_relevant',
  consent_uncertainty: 'not_relevant',
  certainty_basis: 'discrete_contract',
  rationale_codes: ['educational_context'],
})

test('P2 production request uses the existing single forced tool and carries no numeric confidence field', () => {
  const request = buildPolicyContextRequest(completeImageInput)
  assert.equal(request.stream, false)
  assert.equal(request.parallel_tool_calls, false)
  assert.deepEqual(request.tool_choice, { type: 'function', function: { name: 'report_visual_safety' } })
  assert.equal(request.tools.length, 1)
  assert.equal(request.tools[0].function.strict, true)
  assert.equal(request.tools[0].function.name, 'report_visual_safety')
  assert.equal(request.tools[0].function.parameters.properties.confidence, undefined)
  assert.equal(request.tools[0].function.parameters.properties.confidence_score, undefined)
  assert.match(request.messages[0].content, /never infer or assert age/i)
  assert.match(request.messages[0].content, /appearance cannot prove consent/i)
  assert.match(request.messages[0].content, /negation, quotation, education/i)
  assert.doesNotMatch(JSON.stringify(request), /user_id|owner_user_id|signed_url|access_token/i)
})

test('P2 validator accepts an unambiguous contextual allow bound to actual modality coverage', () => {
  assert.equal(POLICY_CONTEXT_SCHEMA_VERSION, 'creator-premium-context-p2-v1')
  assert.equal(POLICY_CONTEXT_PROMPT_VERSION, 'creator-premium-context-p2-v1')
  assert.deepEqual(validatePolicyContextResult(allowResult, completeImageInput), allowResult)
})

test('P2 validator routes uncertainty through review and never accepts appearance as age or consent proof', () => {
  const review = {
    ...allowResult,
    decision: 'review',
    categories: ['age_uncertain', 'consent_uncertain'],
    uncertainty: 'ambiguous',
    age_uncertainty: 'present',
    consent_uncertainty: 'present',
    rationale_codes: ['age_requires_review', 'consent_requires_review'],
  }
  assert.deepEqual(validatePolicyContextResult(review, completeImageInput), review)

  for (const invalid of [
    { ...allowResult, age_uncertainty: 'adult' },
    { ...allowResult, consent_uncertainty: 'confirmed' },
    { ...allowResult, confidence: 0.99 },
    { ...allowResult, decision: 'allow', uncertainty: 'ambiguous' },
    { ...allowResult, decision: 'allow', age_uncertainty: 'present' },
    { ...allowResult, decision: 'allow', categories: ['explicit_sexual_activity'] },
    { ...allowResult, decision: 'review', categories: ['age_uncertain'], uncertainty: 'ambiguous' },
    { ...allowResult, decision: 'review', categories: ['consent_uncertain'], uncertainty: 'ambiguous' },
    { ...allowResult, coverage: { ...allowResult.coverage, transcript: 'complete' } },
  ]) {
    assert.throws(
      () => validatePolicyContextResult(invalid, completeImageInput),
      error => error instanceof PolicyContextError && error.code === 'creator_premium_context_schema_invalid',
    )
  }
})

test('P2 validator preserves severe block and contextual review without keyword-only enforcement', () => {
  const severe = {
    ...allowResult,
    decision: 'block',
    categories: ['non_consensual_intimate_content'],
    consent_uncertainty: 'present',
    rationale_codes: ['severe_explicit_context'],
  }
  assert.deepEqual(validatePolicyContextResult(severe, completeImageInput), severe)

  const educational = validatePolicyContextResult({
    ...allowResult,
    categories: ['education'],
    rationale_codes: ['quoted_or_negated_context', 'educational_context'],
  }, completeImageInput)
  assert.equal(educational.decision, 'allow')

  const ambiguous = {
    ...allowResult,
    decision: 'review',
    categories: ['contradictory_signals'],
    uncertainty: 'ambiguous',
    rationale_codes: ['ambiguous_context'],
  }
  assert.deepEqual(validatePolicyContextResult(ambiguous, completeImageInput), ambiguous)
})

test('P2 transcript coverage distinguishes complete, no speech, and not applicable', () => {
  const video = {
    ...completeImageInput,
    transcript: { coverage: 'complete', text: 'Este documental condena la violencia y no la promueve.' },
  }
  const result = {
    ...allowResult,
    coverage: { text: 'complete', transcript: 'complete', visual: 'complete' },
    categories: ['education'],
    rationale_codes: ['quoted_or_negated_context', 'educational_context'],
  }
  assert.deepEqual(validatePolicyContextResult(result, video), result)
  assert.throws(
    () => validatePolicyContextResult({ ...result, coverage: { ...result.coverage, transcript: 'no_speech' } }, video),
    error => error.code === 'creator_premium_context_schema_invalid',
  )
})

test('P2 fixed synthetic probe covers negation, quotation, education, ambiguity, age, consent, and severe block', () => {
  const request = buildPolicyContextProbeRequest()
  assert.equal(request.tools.length, 1)
  assert.equal(request.tools[0].function.name, 'report_visual_safety')
  assert.equal(request.tools[0].function.strict, true)
  assert.equal(request.tools[0].function.parameters.properties.cases.maxItems, 7)
  const expected = [
    ['educational_quote', 'allow'],
    ['negated_threat', 'allow'],
    ['ambiguous_threat', 'review'],
    ['uncertain_age', 'review'],
    ['uncertain_consent', 'review'],
    ['explicit_non_consent', 'block'],
    ['explicit_sexual_activity', 'block'],
  ]
  const value = { cases: expected.map(([id, decision]) => ({ id, decision })) }
  assert.deepEqual(validatePolicyContextProbeResult(value), value)
  assert.throws(
    () => validatePolicyContextProbeResult({ cases: value.cases.map((item, index) => index === 0 ? { ...item, decision: 'block' } : item) }),
    error => error.code === 'creator_premium_context_probe_semantics_invalid',
  )
})

test('P2 provider transport rejects malformed, refused, truncated, and ambiguous tool output fail-closed', async () => {
  const envelopes = [
    [{ success: true, result: { response: JSON.stringify(allowResult) } }, 'visual_workers_ai_tool_call_missing'],
    [{ success: true, result: { tool_calls: [
      { name: 'report_visual_safety', arguments: allowResult },
      { name: 'report_visual_safety', arguments: allowResult },
    ] } }, 'visual_workers_ai_tool_call_ambiguous'],
    [{ success: true, result: { choices: [{ finish_reason: 'content_filter', message: { refusal: 'refused', tool_calls: [] } }] } }, 'visual_workers_ai_tool_call_refused'],
    [{ success: true, result: { choices: [{ finish_reason: 'length', message: { refusal: null, tool_calls: [] } }] } }, 'visual_workers_ai_tool_call_truncated'],
  ]
  for (const [payload, code] of envelopes) {
    await assert.rejects(
      () => runPolicyContextAnalysis({
        token: 'dedicated-ai-token',
        accountId: 'account-id',
        input: completeImageInput,
        fetchImpl: async () => new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json', 'cf-ray': 'p2-test-EWR' },
        }),
      }),
      error => error.code === code && error.providerCalled === true,
      code,
    )
  }
})

test('P2 extends the canonical worker with one bounded context claim and a service-role probe', () => {
  const worker = readFileSync(workerPath, 'utf8')
  assert.match(worker, /runPolicyContextAnalysis/)
  assert.match(worker, /runPolicyContextProviderProbe/)
  assert.match(worker, /body\.action === 'policy_context_provider_probe'/)
  assert.match(worker, /claim_creator_premium_content_safety_context_v1'[\s\S]{0,120}p_limit:\s*1/)
  assert.match(worker, /complete_creator_premium_content_safety_context_v1'[\s\S]{0,260}p_attempt_count:\s*claim\.attempt_count/)
  assert.match(worker, /fail_creator_premium_content_safety_context_v1'[\s\S]{0,260}p_attempt_count:\s*claim\.attempt_count/)
  assert.match(worker, /premium_context:/)
  assert.doesNotMatch(worker, /p_limit:\s*[2-9][0-9]*[^\n]*creator_premium_content_safety_context/i)
})

test('P2 evidence runtime is private, bound, bounded, idempotent, and does not activate P1', () => {
  const sql = loadP2Migration()
  assert.match(sql, /create table private\.creator_premium_content_safety_context_evaluations/i)
  assert.match(sql, /enable row level security/i)
  assert.match(sql, /force row level security/i)
  assert.match(sql, /unique\s*\(source_scan_id,source_content_fingerprint,policy_id,prompt_version\)/i)
  assert.match(sql, /attempt_count\s+between\s+0\s+and\s+5/i)
  assert.match(sql, /provider_call_count\s+between\s+0\s+and\s+5/i)
  assert.match(sql, /for update of evaluation skip locked limit p_limit/i)
  assert.match(sql, /claim_creator_premium_content_safety_context_v1\(\s*p_limit integer default 1\s*\)/i)
  assert.match(sql, /complete_creator_premium_content_safety_context_v1\(\s*p_scan_id uuid,\s*p_content_fingerprint text,\s*p_attempt_count integer,\s*p_context_result jsonb/i)
  assert.match(sql, /fail_creator_premium_content_safety_context_v1\(\s*p_scan_id uuid,\s*p_attempt_count integer,\s*p_error_code text,/i)
  assert.match(sql, /p_attempt_count is null\s+or p_attempt_count<>v_evaluation\.attempt_count[\s\S]*creator_premium_context_attempt_stale/i)
  assert.match(sql, /v_evaluation\.transcript_coverage[\s\S]*v_evaluation\.transcript_fingerprint[\s\S]*v_evaluation\.visual_analysis_fingerprint[\s\S]*p_context_result::text/i)
  assert.match(sql, /creator_premium_content_safety_candidate_p2_v1\(\s*p_scan_id uuid\s*\)/i)
  assert.match(sql, /grant execute on function\s+public\.claim_creator_premium_content_safety_context_v1\(integer\)\s+to service_role/i)
  assert.match(sql, /revoke all privileges on table\s+private\.creator_premium_content_safety_context_evaluations[\s\S]*service_role/i)
  assert.doesNotMatch(sql, /"enabled"\s*:\s*true|"auto_publish_enabled"\s*:\s*true/i)
  assert.doesNotMatch(sql, /create or replace function private\.creator_premium_content_safety_policy_p1_v1/i)
})

test('P2 SQL completion validates the same discrete context contract as the worker', () => {
  const sql = loadP2Migration()
  for (const value of [
    POLICY_CONTEXT_SCHEMA_VERSION,
    POLICY_CONTEXT_PROMPT_VERSION,
    'nelyon.creator_premium.general.p1.v1',
    'discrete_contract',
    'unambiguous',
    'ambiguous',
    'not_relevant',
    'present',
    'creator_premium_context_schema_invalid',
  ]) assert.match(sql, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))
  assert.match(sql, /decision='allow'[\s\S]*age_uncertainty<>'not_relevant'[\s\S]*consent_uncertainty<>'not_relevant'/i)
  assert.match(sql, /explicit_sexual_activity[\s\S]*explicit_promotion_of_severe_harm[\s\S]*v_decision='block'/i)
  assert.match(sql, /age_uncertain[\s\S]*consent_uncertain[\s\S]*v_decision='review'/i)
})
