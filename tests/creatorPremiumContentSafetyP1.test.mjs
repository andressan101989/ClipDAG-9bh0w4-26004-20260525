import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()
const policyPath = join(root, 'docs', 'creator-premium-content-safety-policy-general-v1.json')
const migrationSuffix = '_creator_premium_content_safety_p1_policy_gate.sql'

function loadMigration() {
  const migrations = join(root, 'supabase', 'migrations')
  const matches = readdirSync(migrations).filter(name => name.endsWith(migrationSuffix))
  assert.equal(matches.length, 1, 'P1 must have exactly one forward-only policy migration')
  return readFileSync(join(migrations, matches[0]), 'utf8')
}

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
  const policy = loadPolicy()
  const sql = loadMigration()
  const digest = createHash('sha256').update(readFileSync(policyPath)).digest('hex')
  assert.match(digest, /^[0-9a-f]{64}$/)
  assert.notEqual(digest, '0'.repeat(64))
  const embedded = sql.match(/\$policy\$\s*([\s\S]*?)\s*\$policy\$::jsonb/i)
  assert.ok(embedded, 'migration must embed one canonical P1 policy object')
  const sqlPolicy = JSON.parse(embedded[1])
  assert.equal(sqlPolicy.artifact_sha256, digest)
  assert.equal(sqlPolicy.policy_id, policy.policy_id)
  assert.deepEqual(sqlPolicy.normative_approval, policy.normative_approval)
  assert.deepEqual(sqlPolicy.scope, policy.scope)
  assert.deepEqual(sqlPolicy.decision_matrix, policy.decision_matrix)
  assert.deepEqual(sqlPolicy.activation, policy.activation)
  assert.deepEqual(sqlPolicy.publication, policy.publication)
})

test('P1 migration embeds the immutable policy identity and artifact digest', () => {
  const sql = loadMigration()
  assert.match(sql, /creator_premium_content_safety_policy_p1_v1\(\)/i)
  assert.match(sql, /nelyon\.creator_premium\.general\.p1\.v1/i)
  assert.match(sql, /43da0f9039abb930aa34e09d513220713264e46b0f4187f91a769c1f9a3af52b/i)
  assert.match(sql, /"explicit_adult_premium"\s*:\s*false/i)
  assert.match(sql, /"auto_publish_enabled"\s*:\s*false/i)
})

test('P1 decision engine is private, fail-closed, and preserves contextual review', () => {
  const sql = loadMigration()
  assert.match(sql, /creator_premium_content_safety_decision_p1_v1\(p_scan_id uuid\)/i)
  assert.match(sql, /security definer\s+set search_path\s*=\s*''/i)
  assert.match(sql, /not v_policy_enabled[\s\S]*'decision'\s*,\s*'awaiting_policy'/i)
  assert.match(sql, /source_type\s*=\s*'text_rule'[\s\S]*'decision'\s*,\s*'review'/i)
  assert.match(sql, /evidence->>'policy_id'\s*=\s*v_policy_id/i)
  assert.match(sql, /evidence->>'policy_decision'\s*=\s*'block'/i)
  assert.match(sql, /'decision'\s*,\s*'block'/i)
  assert.match(sql, /v_policy_decision->>'decision'\s+is distinct from\s+'allow'/i)
  assert.match(sql, /jsonb_typeof\(v_policy#>'\{activation,blockers\}'\)\s*=\s*'array'/i)
  assert.match(sql, /jsonb_array_length\(v_policy#>'\{activation,blockers\}'\)\s*=\s*0/i)
  assert.match(sql, /v_content\.verification_scan_id\s+is distinct from\s+v_scan\.id/i)
  assert.match(sql, /alert\.source_type\s*=\s*'visual_classifier'/i)
  assert.match(sql, /alert\.severity\s+in\s*\('high','critical'\)/i)
  assert.match(sql, /jsonb_typeof\(alert\.evidence->'coverage_complete'\)\s*=\s*'boolean'/i)
  assert.match(sql, /analysis\.analysis_fingerprint\s*=\s*alert\.evidence->>'analysis_fingerprint'/i)
  for (const signature of [
    'private.creator_premium_content_safety_policy_p1_v1()',
    'private.creator_premium_content_safety_decision_p1_v1(uuid)',
  ]) {
    assert.match(sql, new RegExp(`revoke all on function ${signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*from public, anon, authenticated, service_role`, 'i'))
  }
})

test('P1 finalizer consumes the decision without weakening generation, fingerprint, or provider fences', () => {
  const sql = loadMigration()
  assert.match(sql, /create or replace function private\.finalize_creator_premium_safety_scan_v1\(p_scan_id uuid\)/i)
  assert.match(sql, /verification_scan_id\s+is distinct from\s+v_scan\.id/i)
  assert.match(sql, /verification_fingerprint\s+is distinct from\s+v_scan\.content_fingerprint/i)
  assert.match(sql, /v_current_fingerprint<>v_scan\.content_fingerprint/i)
  assert.match(sql, /v_scan\.status='failed'[\s\S]*creator_premium_safety_provider_failed/i)
  assert.match(sql, /creator_premium_content_safety_decision_p1_v1\(v_scan\.id\)/i)
  assert.match(sql, /v_policy_decision->>'decision'='awaiting_policy'[\s\S]*content_safety_policy_not_configured/i)
  assert.match(sql, /v_policy_decision->>'decision'='review'[\s\S]*creator_premium_safety_review_required/i)
  assert.match(sql, /v_policy_decision->>'decision'='block'[\s\S]*lifecycle_status='rejected'[\s\S]*verification_status='blocked'[\s\S]*creator_premium_safety_blocked/i)
  assert.match(sql, /v_policy_decision->>'decision'\s+is distinct from\s+'allow'[\s\S]*creator_premium_safety_decision_invalid/i)
})
