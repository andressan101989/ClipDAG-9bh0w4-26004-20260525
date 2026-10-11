import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeSyntheticVisualProbeImage } from '../supabase/functions/content-safety-scan/visualProbe.mjs'

import {
  CANARY_MODES,
  CanaryGateError,
  buildCanaryPlan,
  candidateRuleFingerprint,
  preparePolicyApprovalPackage,
  providerCanaryArtifactFingerprint,
  redactCanaryEvidence,
  runSyntheticProviderCanary,
  validateExternalAuthorization,
} from '../scripts/creator-premium-provider-canary.mjs'

const root = process.cwd()
const candidate = JSON.parse(readFileSync(join(root, 'docs', 'creator-premium-content-safety-policy-candidate-v1.json'), 'utf8'))

function authorization(overrides = {}) {
  const authorizedMode = overrides.authorized_mode ?? CANARY_MODES.REAL_PROVIDER_COMPONENT
  const plan = buildCanaryPlan(authorizedMode)
  const policy = preparePolicyApprovalPackage(candidate)
  return {
    schema_version: 'nelyon.creator_premium_provider_canary_authorization.v1',
    authorization_source: 'OWNER_APPROVED_DOCUMENT',
    authorization_id: 'owner-canary-approval-example',
    approved_by_role: 'product_owner',
    approved_at: '2026-10-11T12:00:00.000Z',
    expires_at: '2026-10-12T12:00:00.000Z',
    authorized_mode: authorizedMode,
    runner_artifact_fingerprint_sha256: providerCanaryArtifactFingerprint(),
    canary_plan_fingerprint_sha256: plan.plan_fingerprint_sha256,
    policy_package_fingerprint_sha256: policy.package_fingerprint_sha256,
    non_production: true,
    account_authorized: true,
    environment: {
      name: 'creator-premium-canary-nonprod',
      supabase_project_ref: 'synthetic-nonprod-ref',
      cloudflare_account_alias: 'synthetic-nonprod-account',
      production: false,
    },
    quotas_confirmed: true,
    quota_checked_at: '2026-10-11T11:55:00.000Z',
    pricing_checked_at: '2026-10-11T11:55:00.000Z',
    scope: ['workers_ai_visual', 'workers_ai_audio'],
    max_budget_usd: 0.05,
    cost_estimate: {
      currency: 'USD',
      worst_case_usd: 0.02,
      includes_all_planned_operations: true,
      source: 'OWNER_REVIEWED_CURRENT_PROVIDER_PRICING',
    },
    limits: {
      max_ai_calls: 4,
      max_r2_uploads: 0,
      max_stream_uploads: 0,
      max_stream_transformations: 0,
      max_retries_per_operation: 0,
      max_duration_seconds: 300,
      max_bytes_transmitted: 5_000_000,
      max_persistent_objects: 0,
      concurrency: 1,
    },
    cleanup_plan: {
      inventory_by_authorization_id: true,
      exact_resource_ids_only: true,
      verify_zero_residual_resources: true,
      preserve_user_resources: true,
    },
    stop_conditions: ['quota_error', 'model_error', 'signature_error', 'timeout', 'unexpected_cost', 'cleanup_error'],
    ...overrides,
  }
}

test('default canary executes a strict local dry-run with zero network and zero spend', async () => {
  const result = await runSyntheticProviderCanary({ candidate })

  assert.equal(result.mode, CANARY_MODES.DRY_RUN)
  assert.equal(result.status, 'DRY_RUN_PASS')
  assert.equal(result.readiness.CANARY_DRY_RUN, 'PASS')
  assert.equal(result.readiness.REAL_PROVIDER_COMPONENT, 'PENDING')
  assert.equal(result.readiness.PREMIUM_PRIVATE_MEDIA_E2E, 'PENDING')
  assert.equal(result.external.network_requests, 0)
  assert.equal(result.external.spend_usd, 0)
  assert.equal(result.fixtures.image.mime_type, 'image/png')
  assert.equal(result.fixtures.image.contains_identifiable_people, false)
  assert.equal(result.fixtures.video.materialization, 'FUTURE_AUTHORIZED_LOCAL_GENERATION')
  assert.deepEqual(result.fixtures.audio.map(item => item.locale), ['es', 'en', 'und'])
  assert.deepEqual(result.local_contracts.audio.map(item => item.no_speech), [false, false, true])
  assert.equal(result.local_contracts.visual.schema_valid, true)
  assert.equal(result.policy.rule_count, 12)
  const png = Buffer.from(makeSyntheticVisualProbeImage().split(',')[1], 'base64')
  assert.equal(result.fixtures.image.sha256, createHash('sha256').update(png).digest('hex'))
})

test('external modes fail before execution when owner authorization is absent or budget is zero', async () => {
  await assert.rejects(
    runSyntheticProviderCanary({ mode: CANARY_MODES.REAL_PROVIDER_COMPONENT, candidate }),
    error => error instanceof CanaryGateError && error.code === 'EXTERNAL_AUTHORIZATION_REQUIRED',
  )
  await assert.rejects(
    runSyntheticProviderCanary({
      mode: CANARY_MODES.REAL_PROVIDER_COMPONENT,
      candidate,
      authorization: authorization({ max_budget_usd: 0 }),
    }),
    error => error instanceof CanaryGateError && error.code === 'EXTERNAL_BUDGET_NOT_AUTHORIZED',
  )
})

test('authorization rejects production, mode mismatch, stale quota, and unbounded execution', () => {
  const now = new Date('2026-10-11T12:30:00.000Z')
  for (const [override, code] of [
    [{ non_production: false }, 'PRODUCTION_ENVIRONMENT_FORBIDDEN'],
    [{ authorized_mode: CANARY_MODES.PRIVATE_MEDIA_E2E }, 'EXTERNAL_AUTHORIZATION_MODE_MISMATCH'],
    [{ quota_checked_at: '2026-10-09T12:00:00.000Z' }, 'EXTERNAL_QUOTA_CONFIRMATION_STALE'],
    [{ limits: { ...authorization().limits, concurrency: 2 } }, 'EXTERNAL_LIMITS_INVALID'],
    [{ expires_at: '2026-10-11T12:15:00.000Z' }, 'EXTERNAL_AUTHORIZATION_EXPIRED'],
    [{ environment: { ...authorization().environment, production: true } }, 'PRODUCTION_ENVIRONMENT_FORBIDDEN'],
    [{ max_budget_usd: 0.051 }, 'EXTERNAL_BUDGET_LIMIT_EXCEEDED'],
    [{ max_budget_usd: 0.01 }, 'EXTERNAL_BUDGET_NOT_COVERED'],
    [{ cost_estimate: { ...authorization().cost_estimate, worst_case_usd: 0.001 } }, 'EXTERNAL_COST_ESTIMATE_UNDERSTATED'],
    [{ scope: ['workers_ai_visual', 'workers_ai_audio', 'r2_private_canary'] }, 'EXTERNAL_SCOPE_NOT_AUTHORIZED'],
    [{ cleanup_plan: ['cleanup somehow'] }, 'EXTERNAL_SAFETY_PLAN_REQUIRED'],
    [{ stop_conditions: ['quota_error', 'model_error', 'timeout', 'unexpected_cost'] }, 'EXTERNAL_SAFETY_PLAN_REQUIRED'],
    [{ limits: { ...authorization().limits, max_ai_calls: 5 } }, 'EXTERNAL_LIMITS_INVALID'],
    [{ canary_plan_fingerprint_sha256: '0'.repeat(64) }, 'EXTERNAL_PLAN_FINGERPRINT_MISMATCH'],
    [{ policy_package_fingerprint_sha256: '0'.repeat(64) }, 'EXTERNAL_POLICY_FINGERPRINT_MISMATCH'],
    [{ runner_artifact_fingerprint_sha256: '0'.repeat(64) }, 'EXTERNAL_RUNNER_FINGERPRINT_MISMATCH'],
  ]) {
    assert.throws(
      () => validateExternalAuthorization({
        mode: CANARY_MODES.REAL_PROVIDER_COMPONENT,
        authorization: authorization(override),
        policyPackage: preparePolicyApprovalPackage(candidate),
        now,
      }),
      error => error instanceof CanaryGateError && error.code === code,
      code,
    )
  }
})

test('the internal simulator can exercise the authorized operation plan but never claims real provider PASS', async () => {
  const result = await runSyntheticProviderCanary({
    mode: CANARY_MODES.REAL_PROVIDER_COMPONENT,
    candidate,
    authorization: authorization(),
    now: new Date('2026-10-11T12:30:00.000Z'),
    simulateAuthorizedPlan: true,
  })

  assert.equal(result.status, 'SIMULATED_PROVIDER_COMPONENT_PASS')
  assert.notEqual(result.status, 'REAL_PROVIDER_COMPONENT_PASS')
  assert.deepEqual(result.execution.evidence.map(item => item.operation), ['workers_ai_visual_probe', 'workers_ai_audio_probe_es', 'workers_ai_audio_probe_en', 'workers_ai_audio_probe_silence'])
  assert.equal(result.execution.operation_count, 4)
  assert.equal(result.execution.authorization_id, 'owner-canary-approval-example')
  assert.equal(result.execution.cleanup.residual_resources, 0)
  assert.equal(result.external.network_requests, 0)
  assert.equal(result.external.simulated_requests, 4)
  assert.equal(result.external.provider_inferences, 0)
  assert.ok(result.execution.evidence.every(item => Object.keys(item.result).every(key => ['ok', 'request_id', 'status_code', 'duration_ms', 'retry_count', 'cost_usd'].includes(key))))
})

test('no caller-supplied executor can run or self-attest any provider result', async () => {
  let calls = 0
  await assert.rejects(
    runSyntheticProviderCanary({
      mode: CANARY_MODES.REAL_PROVIDER_COMPONENT,
      candidate,
      authorization: authorization(),
      now: new Date('2026-10-11T12:30:00.000Z'),
      simulateAuthorizedPlan: true,
      externalExecutor: {
        execute: async () => { calls += 1; return { ok: true, cost_usd: 0 } },
        cleanup: async () => ({ ok: true, residual_resources: 0 }),
      },
    }),
    error => error instanceof CanaryGateError && error.code === 'CALLER_SUPPLIED_EXECUTOR_FORBIDDEN',
  )
  assert.equal(calls, 0)

  await assert.rejects(
    runSyntheticProviderCanary({
      mode: CANARY_MODES.REAL_PROVIDER_COMPONENT,
      candidate,
      authorization: authorization(),
      now: new Date('2026-10-11T12:30:00.000Z'),
    }),
    error => error instanceof CanaryGateError && error.code === 'REAL_PROVIDER_EXECUTOR_NOT_IMPLEMENTED',
  )
})

test('cleanup failure is a hard failure and remains visible without leaking secret material', async () => {
  await assert.rejects(
    runSyntheticProviderCanary({
      mode: CANARY_MODES.REAL_PROVIDER_COMPONENT,
      candidate,
      authorization: authorization(),
      now: new Date('2026-10-11T12:30:00.000Z'),
      simulateAuthorizedPlan: true,
      simulationProfile: { cleanup_residual_resources: 1 },
    }),
    error => error instanceof CanaryGateError && error.code === 'CANARY_CLEANUP_FAILED' && !error.message.includes('secret.invalid'),
  )
})

test('simulated receipts that exceed the owner budget stop before PASS and still complete cleanup', async () => {
  await assert.rejects(
    runSyntheticProviderCanary({
      mode: CANARY_MODES.REAL_PROVIDER_COMPONENT,
      candidate,
      authorization: authorization(),
      now: new Date('2026-10-11T12:30:00.000Z'),
      simulateAuthorizedPlan: true,
      simulationProfile: { operation_cost_usd: 0.02 },
    }),
    error => error instanceof CanaryGateError && error.code === 'CANARY_BUDGET_EXCEEDED' && error.cleanup_status === 'PASS',
  )
})

test('an operation timeout fails closed, performs cleanup, and does not retry', async () => {
  await assert.rejects(
    runSyntheticProviderCanary({
      mode: CANARY_MODES.REAL_PROVIDER_COMPONENT,
      candidate,
      authorization: authorization(),
      now: new Date('2026-10-11T12:30:00.000Z'),
      operationTimeoutMs: 5,
      simulateAuthorizedPlan: true,
      simulationProfile: { operation_delay_ms: 50 },
    }),
    error => error instanceof CanaryGateError && error.code === 'CANARY_TIMEOUT' && error.cleanup_status === 'PASS',
  )
})

test('the total execution deadline covers all operations and cleanup', async () => {
  await assert.rejects(
    runSyntheticProviderCanary({
      mode: CANARY_MODES.REAL_PROVIDER_COMPONENT,
      candidate,
      authorization: authorization(),
      now: new Date('2026-10-11T12:30:00.000Z'),
      operationTimeoutMs: 100,
      totalTimeoutMs: 12,
      simulateAuthorizedPlan: true,
      simulationProfile: { operation_delay_ms: 7 },
    }),
    error => error instanceof CanaryGateError && error.code === 'CANARY_TIMEOUT' && error.cleanup_status === 'PASS',
  )

  await assert.rejects(
    runSyntheticProviderCanary({
      mode: CANARY_MODES.REAL_PROVIDER_COMPONENT,
      candidate,
      authorization: authorization(),
      now: new Date('2026-10-11T12:30:00.000Z'),
      totalTimeoutMs: 15,
      simulateAuthorizedPlan: true,
      simulationProfile: { cleanup_delay_ms: 30 },
    }),
    error => error instanceof CanaryGateError && error.code === 'CANARY_TIMEOUT' && error.cleanup_status === 'TIMEOUT',
  )

  const eventLoopBlocker = setTimeout(() => {
    const blockedUntil = Date.now() + 80
    while (Date.now() < blockedUntil) { /* deterministic event-loop stall */ }
  }, 1)
  try {
    await assert.rejects(
      runSyntheticProviderCanary({
        mode: CANARY_MODES.REAL_PROVIDER_COMPONENT,
        candidate,
        authorization: authorization(),
        now: new Date('2026-10-11T12:30:00.000Z'),
        totalTimeoutMs: 30,
        simulateAuthorizedPlan: true,
        simulationProfile: { cleanup_delay_ms: 10 },
      }),
      error => error instanceof CanaryGateError && error.code === 'CANARY_TIMEOUT' && error.cleanup_status === 'TIMEOUT',
    )
  } finally {
    clearTimeout(eventLoopBlocker)
  }
})

test('private-media simulation traverses one R2 asset, one signed Stream asset, five frames, reconciliation, and cleanup', async () => {
  const privateAuthorization = authorization({
    authorization_id: 'owner-private-e2e-example',
    authorized_mode: CANARY_MODES.PRIVATE_MEDIA_E2E,
    scope: ['workers_ai_visual', 'workers_ai_audio', 'r2_private_canary', 'stream_private_canary', 'supabase_disposable_reconciliation'],
    limits: {
      max_ai_calls: 11,
      max_r2_uploads: 1,
      max_stream_uploads: 1,
      max_stream_transformations: 11,
      max_retries_per_operation: 0,
      max_duration_seconds: 900,
      max_bytes_transmitted: 25_000_000,
      max_persistent_objects: 2,
      concurrency: 1,
    },
  })
  const result = await runSyntheticProviderCanary({
    mode: CANARY_MODES.PRIVATE_MEDIA_E2E,
    candidate,
    authorization: privateAuthorization,
    now: new Date('2026-10-11T12:30:00.000Z'),
    simulateAuthorizedPlan: true,
  })
  assert.equal(result.status, 'SIMULATED_PRIVATE_MEDIA_E2E_PASS')
  const seen = result.execution.evidence.map(item => item.operation)
  assert.equal(seen.filter(kind => kind === 'r2_private_upload').length, 1)
  assert.equal(seen.filter(kind => kind === 'stream_private_upload').length, 1)
  assert.equal(seen.filter(kind => kind === 'workers_ai_visual_frame').length, 5)
  assert.equal(seen.filter(kind => kind === 'canonical_reconciliation').length, 1)
  assert.equal(result.external.network_requests, 0)
  assert.equal(result.execution.cleanup.residual_resources, 0)
})

test('private-media plan is bounded, serial, and inventories cleanup for exact synthetic resources', () => {
  const plan = buildCanaryPlan(CANARY_MODES.PRIVATE_MEDIA_E2E)
  assert.equal(plan.limits.concurrency, 1)
  assert.equal(plan.limits.max_retries_per_operation, 0)
  assert.equal(plan.operations.filter(item => item.kind === 'workers_ai_visual_frame').length, 5)
  assert.equal(plan.operations.filter(item => item.kind === 'r2_private_upload').length, 1)
  assert.equal(plan.operations.filter(item => item.kind === 'stream_private_upload').length, 1)
  assert.equal(plan.operations.some(item => item.kind === 'stream_signed_audio_download'), true)
  assert.equal(plan.cleanup.required, true)
  assert.deepEqual(plan.cleanup.resource_types, ['r2_object', 'stream_video', 'stream_audio_derivative'])
  assert.deepEqual(plan.expected_usage, {
    total_operations: 20,
    provider_network_operations: 19,
    ai_inferences: 11,
    r2_uploads: 1,
    stream_uploads: 1,
    stream_transformations: 11,
    disposable_reconciliations: 1,
  })
  assert.equal(plan.operations.find(item => item.kind === 'canonical_reconciliation').external, false)
  assert.equal(plan.cost.authorized_budget_usd, 0)
  assert.ok(plan.cost.recommended_owner_cap_usd > plan.cost.known_variable_cost_usd)
})

test('candidate fingerprints are deterministic, complete, unique, and distinct from pending DB governance fingerprints', () => {
  const approval = preparePolicyApprovalPackage(candidate)
  assert.equal(approval.status, 'POLICY_PREPARED')
  assert.equal(approval.canonical_governance_fingerprint_status, 'PENDING_RULE_CREATION_AND_PREVIEW')
  assert.match(approval.package_fingerprint_sha256, /^[0-9a-f]{64}$/)
  assert.equal(approval.rules.length, candidate.rules.length)
  assert.equal(new Set(approval.rules.map(rule => rule.candidate_fingerprint_sha256)).size, candidate.rules.length)
  for (const [index, rule] of candidate.rules.entries()) {
    assert.equal(rule.candidate_fingerprint_sha256, candidateRuleFingerprint(rule), rule.code)
    assert.equal(approval.rules[index].candidate_fingerprint_sha256, rule.candidate_fingerprint_sha256)
    assert.equal(approval.rules[index].governance_fingerprint, null)
  }
  const changed = { ...candidate.rules[0], severity: 'high' }
  assert.notEqual(candidateRuleFingerprint(changed), candidateRuleFingerprint(candidate.rules[0]))
  assert.throws(
    () => preparePolicyApprovalPackage({
      ...candidate,
      fingerprint_contract: { ...candidate.fingerprint_contract, canonicalization: 'unrecognized-contract' },
    }),
    error => error instanceof CanaryGateError && error.code === 'POLICY_CANDIDATE_INVALID',
  )
  assert.throws(
    () => preparePolicyApprovalPackage({ ...candidate, rules: [] }),
    error => error instanceof CanaryGateError && error.code === 'POLICY_CANDIDATE_INVALID',
  )
})

test('evidence redaction recursively removes URLs, tokens, credentials, private locators, and payloads', () => {
  const redacted = redactCanaryEvidence({
    ok: true,
    token: 'abc',
    signed_url: 'https://secret.invalid/value',
    object_key: 'private/user/file',
    asset_id: 'private-asset-id',
    content_id: 'private-content-id',
    stream_uid: 'private-stream-uid',
    assetId: 'private-camel-asset-id',
    cloudflareUid: 'private-cloudflare-uid',
    objectKey: 'private/camel/object',
    apiKey: 'private-api-key',
    accessToken: 'private-access-token',
    refresh_token: 'private-refresh-token',
    privateMediaLocator: 'r2://private-bucket/object',
    storagePath: 'private/user/object',
    resourceIds: ['one', 'two'],
    raw: Buffer.from('private bytes'),
    uri: 'data:text/plain;base64,cHJpdmF0ZQ==',
    message: 'provider returned https://private.invalid/signed/value',
    authorization: 'Bearer abc',
    nested: { service_role_key: 'secret', payload: 'private bytes', request_id: 'safe-request-id' },
  })
  assert.deepEqual(redacted, {
    ok: true,
    token: '[REDACTED]',
    signed_url: '[REDACTED]',
    object_key: '[REDACTED]',
    asset_id: '[REDACTED]',
    content_id: '[REDACTED]',
    stream_uid: '[REDACTED]',
    assetId: '[REDACTED]',
    cloudflareUid: '[REDACTED]',
    objectKey: '[REDACTED]',
    apiKey: '[REDACTED]',
    accessToken: '[REDACTED]',
    refresh_token: '[REDACTED]',
    privateMediaLocator: '[REDACTED]',
    storagePath: '[REDACTED]',
    resourceIds: '[REDACTED]',
    raw: '[REDACTED]',
    uri: '[REDACTED]',
    message: '[REDACTED]',
    authorization: '[REDACTED]',
    nested: { service_role_key: '[REDACTED]', payload: '[REDACTED]', request_id: 'safe-request-id' },
  })
})

test('simulation profiles are data-only and cannot smuggle functions or unknown controls', async () => {
  for (const simulationProfile of [
    { execute: () => ({ ok: true }) },
    { arbitrary: true },
    Object.assign(Object.create({ inherited: true }), { operation_delay_ms: 0 }),
  ]) {
    await assert.rejects(
      runSyntheticProviderCanary({
        mode: CANARY_MODES.REAL_PROVIDER_COMPONENT,
        candidate,
        authorization: authorization(),
        now: new Date('2026-10-11T12:30:00.000Z'),
        simulateAuthorizedPlan: true,
        simulationProfile,
      }),
      error => error instanceof CanaryGateError && error.code === 'CANARY_SIMULATION_PROFILE_INVALID',
    )
  }

  let getterCalls = 0
  const accessorProfile = {}
  Object.defineProperty(accessorProfile, 'operation_delay_ms', {
    enumerable: true,
    get() {
      getterCalls += 1
      return 0
    },
  })
  await assert.rejects(
    runSyntheticProviderCanary({
      mode: CANARY_MODES.REAL_PROVIDER_COMPONENT,
      candidate,
      authorization: authorization(),
      now: new Date('2026-10-11T12:30:00.000Z'),
      simulateAuthorizedPlan: true,
      simulationProfile: accessorProfile,
    }),
    error => error instanceof CanaryGateError && error.code === 'CANARY_SIMULATION_PROFILE_INVALID',
  )
  assert.equal(getterCalls, 0)

  let coercionCalls = 0
  const coercibleProfile = {
    operation_delay_ms: {
      [Symbol.toPrimitive]() {
        coercionCalls += 1
        return 0
      },
    },
  }
  await assert.rejects(
    runSyntheticProviderCanary({
      mode: CANARY_MODES.REAL_PROVIDER_COMPONENT,
      candidate,
      authorization: authorization(),
      now: new Date('2026-10-11T12:30:00.000Z'),
      simulateAuthorizedPlan: true,
      simulationProfile: coercibleProfile,
    }),
    error => error instanceof CanaryGateError && error.code === 'CANARY_SIMULATION_PROFILE_INVALID',
  )
  assert.equal(coercionCalls, 0)
})

test('CLI gate failures use an external authorization status, never DRY_RUN_FAIL', () => {
  const result = spawnSync(process.execPath, [join(root, 'scripts', 'creator-premium-provider-canary.mjs'), '--mode=REAL_PROVIDER_COMPONENT'], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.equal(result.status, 1)
  const output = JSON.parse(result.stderr.trim())
  assert.equal(output.mode, CANARY_MODES.REAL_PROVIDER_COMPONENT)
  assert.equal(output.status, 'EXTERNAL_AUTHORIZATION_REQUIRED')
  assert.equal(output.error, 'EXTERNAL_AUTHORIZATION_REQUIRED')
})

test('repository exposes one canonical dry-run command and documents F7 authorization and policy decisions', () => {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const readiness = readFileSync(join(root, 'docs', 'creator-premium-content-safety-readiness.md'), 'utf8')
  assert.equal(packageJson.scripts['test:safety:premium-canary'], 'node scripts/creator-premium-provider-canary.mjs')
  for (const marker of [
    'B7-F7 synthetic provider canary',
    'CANARY_DRY_RUN_PASS',
    'EXTERNAL_AUTHORIZATION_REQUIRED',
    'candidate_fingerprint_sha256',
    'PENDING_RULE_CREATION_AND_PREVIEW',
    'USD 0.05',
    'Apple App Review Guidelines 1.2',
    'Google Play User Generated Content policy',
    'Owner decisions still required',
    'Rollback and STOP',
  ]) assert.match(readiness, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'i'), marker)
})
