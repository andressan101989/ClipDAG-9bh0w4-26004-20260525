import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()
const evidencePath = join(root, 'docs', 'creator-premium-content-safety-p2-evidence-v1.json')

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

