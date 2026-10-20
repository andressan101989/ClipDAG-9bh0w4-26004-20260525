import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'

import {
  PolicyContextError,
  policyContextCompletionError,
  runPolicyContextAnalysis,
  validatePolicyContextResult,
} from '../supabase/functions/content-safety-scan/policyContext.mjs'

const policyInput = {
  text: 'Escena pacifica sin amenaza, fuerza, sangre, lesion ni violencia.',
  transcript: { coverage: 'complete', text: 'Todo tranquilo.' },
  visual: {
    coverage: 'complete',
    review_required: true,
    findings: [
      { category: 'weapons', triage_level: 'low', description: '' },
      { category: 'weapons', triage_level: 'low', description: '' },
      { category: 'weapons', triage_level: 'low', description: '' },
    ],
    summary: 'Three sampled frames contain a visible weapon without threat or use.',
    weapon_disposition: 'visible_non_threatening',
  },
}

function result(overrides = {}) {
  return {
    schema_version: 'creator-premium-context-p3-v1',
    policy_id: 'nelyon.creator_premium.general.p1.v2',
    decision: 'allow',
    categories: ['entertainment'],
    coverage: { text: 'complete', transcript: 'complete', visual: 'complete' },
    uncertainty: 'unambiguous',
    age_uncertainty: 'not_relevant',
    consent_uncertainty: 'not_relevant',
    weapon_state: 'visible_non_threatening',
    law_enforcement_state: 'not_observed',
    violence_state: 'none_observed',
    certainty_basis: 'discrete_contract',
    rationale_codes: ['benign_context'],
    ...overrides,
  }
}

function providerFetch(value) {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: name => name.toLowerCase() === 'cf-ray' ? 'p3c3-safe-ray' : null },
    json: async () => ({
      success: true,
      result: {
        choices: [{
          finish_reason: 'tool_calls',
          message: {
            tool_calls: [{
              id: 'call_p3c3',
              type: 'function',
              function: {
                name: 'report_visual_safety',
                arguments: JSON.stringify(value),
              },
            }],
          },
        }],
        usage: { prompt_tokens: 111, completion_tokens: 37, total_tokens: 148 },
      },
    }),
  })
}

test('P3-C3 deterministically restores only redundant non-threatening weapon annotations', async () => {
  const raw = result()
  const actual = await runPolicyContextAnalysis({
    token: 'test-token',
    accountId: 'test-account',
    input: policyInput,
    fetchImpl: providerFetch(raw),
  })

  assert.equal(actual.decision, raw.decision)
  assert.equal(actual.uncertainty, raw.uncertainty)
  assert.equal(actual.weapon_state, raw.weapon_state)
  assert.equal(actual.violence_state, raw.violence_state)
  assert.deepEqual(actual.categories, ['entertainment', 'non_threatening_weapon_presence'])
  assert.deepEqual(actual.rationale_codes, ['benign_context', 'non_threatening_weapon_context'])
})

test('P3-C3 never synthesizes a police annotation without an independent canonical signal', async () => {
  await assert.rejects(
    runPolicyContextAnalysis({
      token: 'test-token',
      accountId: 'test-account',
      input: policyInput,
      fetchImpl: providerFetch(result({ law_enforcement_state: 'routine_peaceful' })),
    }),
    error => {
      assert.ok(error instanceof PolicyContextError)
      assert.equal(error.code, 'creator_premium_context_schema_invalid')
      assert.equal(error.validationReason, 'allow_visual_binding_invalid')
      assert.equal(error.retryable, false)
      return true
    },
  )
})

test('P3-C3 keeps contradictory provider semantics private, terminal, and safely observable', async () => {
  await assert.rejects(
    runPolicyContextAnalysis({
      token: 'test-token',
      accountId: 'test-account',
      input: policyInput,
      fetchImpl: providerFetch(result({ weapon_state: 'not_observed' })),
    }),
    error => {
      assert.ok(error instanceof PolicyContextError)
      assert.equal(error.code, 'creator_premium_context_schema_invalid')
      assert.equal(error.validationReason, 'allow_visual_binding_invalid')
      assert.equal(error.retryable, false)
      assert.equal(error.providerCalled, true)
      assert.deepEqual(error.providerTelemetry, {
        status_code: 200,
        request_correlation_id: 'p3c3-safe-ray',
        carrier: 'choices_message_tool_calls',
        finish_reason: 'tool_calls',
        response_bytes: error.providerTelemetry.response_bytes,
        input_tokens: 111,
        output_tokens: 37,
        total_tokens: 148,
      })
      assert.ok(error.providerTelemetry.response_bytes > 0)
      assert.doesNotMatch(JSON.stringify(error), /test-token|Escena pacifica|Todo tranquilo/i)
      return true
    },
  )
})

test('P3-C3 maps deterministic completion SQL failures without spending blind retries', () => {
  const deterministic = [
    ['22023', 'creator_premium_context_schema_invalid', 'creator_premium_context_completion_schema_invalid'],
    ['55000', 'creator_premium_context_binding_invalid', 'creator_premium_context_completion_binding_invalid'],
    ['55000', 'creator_premium_context_attempt_stale', 'creator_premium_context_completion_attempt_stale'],
    ['23505', 'creator_premium_context_completion_conflict', 'creator_premium_context_completion_conflict'],
    ['P0002', 'creator_premium_context_evaluation_not_found', 'creator_premium_context_completion_not_found'],
  ]
  for (const [sqlstate, message, code] of deterministic) {
    const actual = policyContextCompletionError({ code: sqlstate, message })
    assert.equal(actual.code, code)
    assert.equal(actual.retryable, false)
    assert.equal(actual.providerCalled, true)
  }

  const unknown = policyContextCompletionError({ code: '08006', message: 'connection_failure' })
  assert.equal(unknown.code, 'creator_premium_context_completion_failed')
  assert.equal(unknown.retryable, true)
  assert.equal(unknown.providerCalled, true)
})

test('P3-C3 JS accepts a REVIEW with independent bounded weapon and police signals', () => {
  const review = result({
    decision: 'review',
    categories: ['ambiguous_weapon_or_law_enforcement_context'],
    uncertainty: 'ambiguous',
    law_enforcement_state: 'routine_peaceful',
    rationale_codes: ['ambiguous_context'],
  })
  assert.deepEqual(validatePolicyContextResult(review, policyInput), review)
})

test('P3-C3 migration aligns PostgreSQL with the JS decision contract without widening ACL', () => {
  const names = readdirSync(new URL('../supabase/migrations/', import.meta.url))
    .filter(name => /_creator_premium_p3_c3_safety_decision_recovery\.sql$/u.test(name))
  assert.equal(names.length, 1)
  const sql = readFileSync(new URL(`../supabase/migrations/${names[0]}`, import.meta.url), 'utf8')

  assert.match(sql, /^\s*begin\s*;/iu)
  assert.match(sql, /commit\s*;\s*$/iu)
  assert.match(sql, /create\s+or\s+replace\s+function\s+private\.creator_premium_content_safety_context_result_valid_p3_v1/iu)
  assert.match(sql, /v_decision\s*=\s*'allow'[\s\S]*v_weapon_state\s*=\s*'visible_non_threatening'/iu)
  assert.equal([...sql.matchAll(/\('non_threatening_weapon_presence'=any\(v_categories\)\)\s+is\s+distinct\s+from\s+\(v_weapon_state='visible_non_threatening'\)/giu)].length, 1)
  assert.equal([...sql.matchAll(/\('non_graphic_law_enforcement_operation'=any\(v_categories\)\)\s+is\s+distinct\s+from\s+\(v_law_enforcement_state='routine_peaceful'\)/giu)].length, 1)
  assert.match(sql, /revoke\s+all\s+on\s+function\s+private\.creator_premium_content_safety_context_result_valid_p3_v1\s*\(\s*jsonb\s*,\s*text\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/iu)
  assert.match(sql, /grant\s+execute\s+on\s+function\s+private\.creator_premium_content_safety_context_result_valid_p3_v1\s*\(\s*jsonb\s*,\s*text\s*\)\s+to\s+postgres\s*,\s*supabase_admin/iu)
})

test('P3-C3 worker emits the bounded validation reason without raw provider arguments', () => {
  const worker = readFileSync(new URL('../supabase/functions/content-safety-scan/index.ts', import.meta.url), 'utf8')
  assert.match(worker, /validation_reason:\s*issue\.validationReason\s*\?\?\s*null/u)
  assert.match(worker, /scan_id:\s*String\(claim\.scan_id\)/u)
  assert.doesNotMatch(worker, /provider_(?:arguments|response_body|raw_response)|context_result_raw/u)
})
