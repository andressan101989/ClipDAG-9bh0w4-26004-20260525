import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { evaluateTextRules } from '../supabase/functions/content-safety-scan/ruleEngine.mjs'

const root = process.cwd()
const candidatePath = join(root, 'docs', 'creator-premium-content-safety-policy-candidate-v1.json')
const readinessPath = join(root, 'docs', 'creator-premium-content-safety-readiness.md')
const candidate = JSON.parse(readFileSync(candidatePath, 'utf8'))
const readiness = readFileSync(readinessPath, 'utf8')
const worker = readFileSync(join(root, 'supabase', 'functions', 'content-safety-scan', 'index.ts'), 'utf8')
const migration = readFileSync(join(root, 'supabase', 'migrations', '20261010053524_creator_premium_b7_full_functional_commercial_completion.sql'), 'utf8')

test('F6 candidate is inert, reviewable, bilingual, and bound to canonical scopes', () => {
  assert.equal(candidate.schema_version, 'nelyon.creator_premium_content_safety_policy_candidate.v1')
  assert.equal(candidate.status, 'POLICY_AUTHORITY_PENDING')
  assert.equal(candidate.production_effect, false)
  assert.equal(candidate.external_budget_usd, 0)
  assert.equal(candidate.provider_external_calls_authorized, false)
  assert.deepEqual(candidate.scopes, ['creator_premium_text', 'transcript'])
  assert.ok(Array.isArray(candidate.rules) && candidate.rules.length >= 10)

  const codes = new Set()
  const localeCategoryPairs = new Set()
  for (const rule of candidate.rules) {
    assert.match(rule.code, /^[a-z][a-z0-9_]{2,63}$/)
    assert.equal(codes.has(rule.code), false, `duplicate rule code: ${rule.code}`)
    codes.add(rule.code)
    assert.ok(['child_safety', 'sexual', 'threat', 'violence', 'fraud'].includes(rule.category), rule.code)
    assert.equal(rule.detector_type, 'phrase')
    assert.ok(typeof rule.pattern === 'string' && rule.pattern.trim().length >= 3)
    assert.ok(['critical', 'high'].includes(rule.severity))
    assert.deepEqual(rule.scopes, ['creator_premium_text', 'transcript'])
    assert.ok(['en', 'es'].includes(rule.locale))
    localeCategoryPairs.add(`${rule.locale}:${rule.category}`)
    assert.equal(rule.policy_source, 'owner_manual')
    assert.match(rule.policy_reference, /^owner-policy-2026-10-[a-z0-9-]+$/)
    assert.equal(rule.policy_version, 'candidate-v1')
    assert.ok(rule.rationale.length >= 20)
    assert.ok(rule.false_positive_risk.length >= 20)
    assert.ok(Array.isArray(rule.benign_examples) && rule.benign_examples.length >= 1)
    assert.equal(rule.proposed_approval_state, 'draft')
    assert.equal(rule.proposed_enabled, false)
    assert.equal(rule.effect, 'SIGNAL_ONLY_REQUIRES_HUMAN_REVIEW')
  }
  for (const locale of ['en', 'es']) {
    for (const category of ['child_safety', 'sexual', 'threat', 'violence', 'fraud']) {
      assert.equal(localeCategoryPairs.has(`${locale}:${category}`), true, `${locale}:${category}`)
    }
  }
  assert.doesNotMatch(JSON.stringify(candidate), /(?:api[_-]?key|bearer|secret|private[_-]?key|access[_-]?token)\s*[=:]\s*["'][^"']+/i)
})

test('candidate phrase previews are deterministic and expose their documented benign false positives', () => {
  for (const [index, definition] of candidate.rules.entries()) {
    const rule = { ...definition, id: `candidate-${index + 1}` }
    const direct = evaluateTextRules({ text: `Prefix ${definition.pattern.toUpperCase()} suffix.`, scope: 'creator_premium_text' }, [rule])
    assert.equal(direct.length, 1, definition.code)
    assert.deepEqual(direct[0].matched_terms, [definition.pattern.toLocaleLowerCase('und')])
    const benign = evaluateTextRules({ text: definition.benign_examples[0], scope: 'transcript' }, [rule])
    assert.equal(benign.length, 1, `documented false-positive preview: ${definition.code}`)
  }
  const rules = candidate.rules.map((rule, index) => ({ ...rule, id: `candidate-${index + 1}` }))
  assert.deepEqual(evaluateTextRules({ text: 'A quiet landscape and an ordinary conversation.', scope: 'creator_premium_text' }, rules), [])
})

test('readiness record separates contracts, disposable E2E, component validation, and full provider E2E', () => {
  for (const level of [
    'STATIC_CONTRACT_PASS',
    'DISPOSABLE_E2E_PASS',
    'REAL_PROVIDER_COMPONENT_PASS',
    'PREMIUM_PROVIDER_E2E_PASS',
  ]) assert.match(readiness, new RegExp(`\\b${level}\\b`), level)
  assert.match(readiness, /POLICY_AUTHORITY_PENDING/)
  assert.match(readiness, /USD 0/)
  assert.match(readiness, /five frames[\s\S]*five provider calls/i)
  assert.match(readiness, /generalist visual model[\s\S]*(?:cannot|does not)[\s\S]*(?:age|consent|illegal)/i)
  assert.match(readiness, /no production rule was created, approved, enabled, or changed/i)
  assert.match(readiness, /provider validation[\s\S]*not executed/i)
})

test('canonical publication remains fail-closed and uses one Content Safety authority', () => {
  assert.match(migration, /content_safety_policy_not_configured/)
  assert.match(migration, /content_safety_audio_policy_not_configured/)
  assert.match(migration, /v_scan\.visual_status in\('failed','not_configured'\)/)
  assert.match(migration, /content_safety_visual_analyses/)
  assert.match(worker, /const BATCH_LIMIT = 25/)
  assert.match(worker, /const TRANSCRIPT_BATCH_LIMIT = 10/)
  assert.match(worker, /claim_content_safety_audio_scans', \{ p_limit: 1 \}/)
  assert.match(
    worker,
    /claim_content_safety_visual_scans'[\s\S]{0,160}p_limit:\s*1[\s\S]{0,160}p_worker_contract:\s*WORKER_CONTRACT/,
  )
  assert.match(worker, /reconcile_creator_premium_publications_v1/)
  assert.doesNotMatch(worker, /createClient\([^\n]+(?:ledger|wallet|escrow)/i)
})
