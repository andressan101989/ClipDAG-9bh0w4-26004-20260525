import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()
const policyPath = join(root, 'docs', 'creator-premium-content-safety-policy-general-v1.json')

function loadPolicy() {
  assert.equal(existsSync(policyPath), true, 'P1 policy artifact must exist')
  return JSON.parse(readFileSync(policyPath, 'utf8'))
}

test('P1 binds the owner-approved general policy and excludes explicit adult Premium', () => {
  const policy = loadPolicy()
  assert.equal(policy.schema_version, 'nelyon.creator_premium_content_safety_policy.v1')
  assert.equal(policy.policy_id, 'nelyon.creator_premium.general.p1.v1')
  assert.equal(policy.normative_approval.status, 'approved')
  assert.equal(policy.normative_approval.source, 'owner_prompt')
  assert.equal(policy.scope.creator_premium_general, true)
  assert.equal(policy.scope.explicit_adult_premium, false)
  assert.equal(policy.scope.mobile_explicit_adult, false)
  assert.equal(policy.scope.finance_effect, false)
})

test('P1 decision matrix preserves context and never treats isolated words as enforcement proof', () => {
  const policy = loadPolicy()
  assert.deepEqual(policy.decision_matrix.allow, [
    'courses', 'tutorials', 'education', 'entertainment', 'dance', 'humor', 'sport',
    'fashion', 'kissing_and_affection', 'swimwear', 'non_explicit_sensual_clothing',
    'non_sexual_artistic_content',
  ])
  assert.deepEqual(policy.decision_matrix.review, [
    'contextual_artistic_or_medical_nudity', 'incidental_blood_or_informational_context',
    'documentary_violence', 'age_uncertain', 'consent_uncertain',
    'contradictory_signals', 'low_confidence', 'incomplete_multimodal_coverage',
  ])
  assert.deepEqual(policy.decision_matrix.block, [
    'explicit_sexual_activity', 'pornography', 'sexualized_explicit_genital_exposure',
    'child_sexual_exploitation', 'non_consensual_intimate_content', 'sexual_violence',
    'torture', 'mutilation', 'graphic_murder', 'graphic_serious_assault',
    'explicit_promotion_of_severe_harm',
  ])
  assert.equal(policy.context_contract.keywords_are_context_only, true)
  assert.equal(policy.context_contract.educational_or_medical_text_is_not_blocked_by_words_alone, true)
  assert.equal(policy.context_contract.missing_required_modality, 'review')
})

test('P1 is normatively approved but operationally fail-closed until every technical gate is resolved', () => {
  const policy = loadPolicy()
  assert.equal(policy.activation.status, 'approved_activation_pending')
  assert.equal(policy.activation.enabled, false)
  assert.equal(policy.activation.auto_publish_enabled, false)
  assert.deepEqual(policy.activation.blockers, [
    'contextual_text_classification_unverified',
    'contextual_transcript_classification_unverified',
    'age_uncertainty_signal_unavailable',
    'consent_uncertainty_signal_unavailable',
    'model_confidence_signal_unavailable',
    'account_quota_headroom_unverified',
    'private_media_policy_e2e_unverified',
  ])
  assert.equal(policy.publication.auto_publish_requires_all_modalities, true)
  assert.equal(policy.publication.technical_failure, 'fail_closed')
  assert.equal(policy.publication.ambiguous_or_incomplete, 'human_review')
  assert.equal(policy.publication.http_200_is_evidence, false)
})

test('P1 policy bytes have a stable digest suitable for SQL and release evidence', () => {
  loadPolicy()
  const digest = createHash('sha256').update(readFileSync(policyPath)).digest('hex')
  assert.match(digest, /^[0-9a-f]{64}$/)
  assert.notEqual(digest, '0'.repeat(64))
})
