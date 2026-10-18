import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'

const migrations = new URL('../supabase/migrations/', import.meta.url)
const matches = readdirSync(migrations)
  .filter(name => name.endsWith('_creator_premium_content_safety_p2_activation.sql'))
const sql = matches.length === 1
  ? readFileSync(new URL(`../supabase/migrations/${matches[0]}`, import.meta.url), 'utf8')
  : ''
const evidenceUrl = new URL('../docs/creator-premium-content-safety-p2-activation-v1.json', import.meta.url)
const evidenceBytes = existsSync(evidenceUrl) ? readFileSync(evidenceUrl) : Buffer.alloc(0)
const evidence = evidenceBytes.length ? JSON.parse(evidenceBytes.toString('utf8')) : null
const evidenceSha256 = createHash('sha256').update(evidenceBytes).digest('hex')

const gateIds = [
  'contextual_text_classification',
  'contextual_transcript_classification',
  'age_uncertainty_signal',
  'consent_uncertainty_signal',
  'model_confidence_contract',
  'account_quota_headroom',
  'private_media_policy_e2e',
]

test('P2 activation is exactly one forward-only migration with owner-bound seven-gate evidence', () => {
  assert.equal(matches.length, 1)
  assert.match(matches[0], /^\d{14}_creator_premium_content_safety_p2_activation\.sql$/)
  assert.equal(evidence?.phase, 'CREATOR-PREMIUM-CONTENT-SAFETY-P2')
  assert.equal(evidence?.owner_authorization?.owner_bound, true)
  assert.deepEqual(Object.keys(evidence?.gates ?? {}).sort(), [...gateIds].sort())
  for (const id of gateIds) assert.equal(evidence.gates[id].status, 'verified', id)
  assert.equal(evidence.live_provider_evidence.inference_count, 2)
  assert.deepEqual(evidence.live_provider_evidence.modalities, ['image', 'video'])
  assert.equal(evidence.quota.workers_ai_headroom_neurons, 9590.38)
  assert.equal(evidence.recovery.run_id, 39159725066)
  assert.equal(evidence.recovery.result, 'POSTCHECK_RECOVERY_SUCCESS')
  assert.match(sql, new RegExp(evidenceSha256))
})

test('P2 activation preserves the exact P1 policy scope and requires every gate', () => {
  assert.match(sql, /creator_premium_content_safety_policy_p1_v1\(\)/i)
  assert.match(sql, /"status"\s*:\s*"active"/i)
  assert.match(sql, /"enabled"\s*:\s*true/i)
  assert.match(sql, /"auto_publish_enabled"\s*:\s*true/i)
  assert.match(sql, /"blockers"\s*:\s*\[\s*\]/i)
  for (const id of gateIds) assert.match(sql, new RegExp(`"${id}"\\s*:\\s*"verified"`, 'i'))
  assert.match(sql, /"explicit_adult_premium"\s*:\s*false/i)
  assert.match(sql, /"mobile_explicit_adult"\s*:\s*false/i)
  assert.match(sql, /"purchase_enabled"\s*:\s*false/i)
  assert.match(sql, /"subscription_enabled"\s*:\s*false/i)
  assert.match(sql, /"refunds_enabled"\s*:\s*false/i)
  assert.match(sql, /"platform_fee_bps"\s*:\s*0/i)
})

test('P2 activation delegates to the single strict contextual candidate and fails closed', () => {
  assert.match(sql, /create\s+or\s+replace\s+function\s+private\.creator_premium_content_safety_decision_p1_v1\(\s*p_scan_id uuid\s*\)/i)
  assert.match(sql, /private\.creator_premium_content_safety_candidate_p2_v1\(p_scan_id\)/i)
  assert.match(sql, /decision'\s+not\s+in\s*\(\s*'allow'\s*,\s*'review'\s*,\s*'block'\s*\)/i)
  assert.match(sql, /'activation_effect'\s*,\s*true/i)
  assert.match(sql, /'activation_effect'\s*,\s*false/i)
  assert.doesNotMatch(sql, /confidence\s*[><=]+\s*0\./i)
  assert.doesNotMatch(sql, /create\s+(?:or\s+replace\s+)?function\s+private\.[^(]*(?:wallet|ledger|escrow|scanner)/i)
})

test('policy-blocked completed evidence is the only failed state eligible for recovery', () => {
  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.reconcile_creator_premium_publications_v1\(\s*p_limit integer default 25\s*\)/i)
  assert.match(sql, /verification_status\s*=\s*'failed'[\s\S]*verification_error_code\s*=\s*'content_safety_policy_not_configured'/i)
  assert.match(sql, /creator_premium_content_safety_context_evaluations[\s\S]*status='completed'/i)
  assert.match(sql, /evaluation\.source_content_fingerprint\s*=\s*scan\.content_fingerprint/i)
  assert.match(sql, /for\s+update\s+of\s+scan\s+skip\s+locked/i)
  assert.match(sql, /grant\s+execute\s+on\s+function\s+public\.reconcile_creator_premium_publications_v1\(integer\)\s+to\s+service_role/i)
  assert.doesNotMatch(sql, /grant\s+execute[\s\S]*to\s+(?:anon|authenticated)/i)
})

test('activation migration is narrow and never mutates Finance or existing QA rows directly', () => {
  assert.doesNotMatch(sql, /\b(?:drop|truncate)\b/i)
  assert.doesNotMatch(sql, /update\s+private\.creator_premium_contents/i)
  assert.doesNotMatch(sql, /insert\s+into\s+private\.creator_premium_contents/i)
  assert.doesNotMatch(sql, /update\s+private\.creator_premium_finance_policy/i)
  assert.doesNotMatch(sql, /insert\s+into\s+(?:public\.)?(?:financial_transactions|ledger_entries)/i)
  assert.doesNotMatch(sql, /create\s+table/i)
})
