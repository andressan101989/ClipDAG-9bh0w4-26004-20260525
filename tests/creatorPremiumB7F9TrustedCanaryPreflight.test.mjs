import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  CANARY_MODES,
  CanaryGateError,
  buildCanaryPlan,
  preparePolicyApprovalPackage,
  providerCanaryArtifactFingerprint,
  repositoryHeadSha,
  runSyntheticProviderCanary,
} from '../scripts/creator-premium-provider-canary.mjs'
import { providerAdapterArtifactFingerprint } from '../scripts/creator-premium-provider-adapter.mjs'
import {
  assessCloudflareInventory,
  assessExistingApprovalAuthority,
  assessSupabaseIsolation,
  buildCanaryAuthorizationRequestPackage,
  buildF9LocalPreflight,
  discoverRepositoryCloudflareInventory,
  preflightArtifactFingerprint,
} from '../scripts/creator-premium-canary-preflight.mjs'

const root = process.cwd()
const productionSupabaseRef = 'aewwdlvbwpczqyvkwvvj'
const candidate = JSON.parse(readFileSync(join(root, 'docs', 'creator-premium-content-safety-policy-candidate-v1.json'), 'utf8'))

function cloudflareRecord(overrides = {}) {
  return {
    source: 'apps/example/wrangler.jsonc',
    account_id: '0123456789abcdef0123456789abcdef',
    worker_name: 'nelyon-example',
    workers_dev: false,
    preview_urls: false,
    routes: ['nelyon.app/example'],
    evidence_level: 'LOCAL_CONFIGURATION',
    ...overrides,
  }
}

test('Cloudflare inventory deduplicates aliases, redacts account IDs, and never treats local config as remote identity', () => {
  const inventory = assessCloudflareInventory([
    cloudflareRecord(),
    cloudflareRecord({ source: 'apps/example/wrangler.preview.jsonc', workers_dev: true, preview_urls: true, routes: [] }),
  ])

  assert.equal(inventory.configurations_found, 2)
  assert.equal(inventory.unique_accounts_identified, 1)
  assert.equal(inventory.identity_status, 'LOCAL_CONFIGURATION_IDENTIFIED')
  assert.equal(inventory.remote_identity_status, 'REMOTE_IDENTITY_VERIFICATION_PENDING')
  assert.equal(inventory.production_context_detected, true)
  assert.equal(inventory.shared_billing_risk, 'UNVERIFIED_SHARED_ACCOUNT_RISK')
  assert.match(inventory.accounts[0].account_fingerprint_sha256, /^[0-9a-f]{64}$/u)
  assert.equal(JSON.stringify(inventory).includes('0123456789abcdef0123456789abcdef'), false)

  const multiple = assessCloudflareInventory([
    cloudflareRecord(),
    cloudflareRecord({ account_id: 'fedcba9876543210fedcba9876543210', worker_name: 'nelyon-test', routes: [] }),
  ])
  assert.equal(multiple.unique_accounts_identified, 2)
  assert.equal(multiple.remote_identity_status, 'REMOTE_IDENTITY_VERIFICATION_PENDING')
})

test('repository discovery finds the one locally declared Cloudflare account without exposing its identifier', () => {
  const inventory = discoverRepositoryCloudflareInventory({ root })

  assert.equal(inventory.unique_accounts_identified, 1)
  assert.ok(inventory.configurations_found >= 7)
  assert.equal(inventory.production_context_detected, true)
  assert.equal(inventory.r2_resource_identity, 'PENDING')
  assert.equal(inventory.stream_resource_identity, 'PENDING')
  assert.equal(JSON.stringify(inventory).includes('24a176456cf57435119db8caf3af61dd'), false)
})

test('Supabase isolation excludes production, accepts local disposable evidence, and does not block component-only probes', () => {
  const result = assessSupabaseIsolation({
    productionProjectRef: productionSupabaseRef,
    projects: [{ ref: productionSupabaseRef, name: 'ClipDag', status: 'ACTIVE_HEALTHY', evidence_level: 'REMOTE_READ_ONLY' }],
    branches: [{ project_ref: productionSupabaseRef, name: 'main', is_default: true, evidence_level: 'REMOTE_READ_ONLY' }],
    localDisposable: {
      available: true,
      engine: 'postgresql',
      version: '17.6.1.143',
      persistent: false,
      fixture_status: 'B7_F5_E2E_PASS',
    },
  })

  assert.equal(result.production_target_forbidden, true)
  assert.equal(result.verified_remote_nonproduction_projects, 0)
  assert.equal(result.component_probe.supabase_required, false)
  assert.equal(result.component_probe.ready, true)
  assert.equal(result.private_media_e2e.ready, false)
  assert.equal(result.private_media_e2e.status, 'REMOTE_MEDIA_ISOLATION_PENDING')
  assert.equal(result.local_disposable.status, 'LOCAL_DISPOSABLE_POSTGRES_IDENTIFIED')

  const declaredOnly = assessSupabaseIsolation({
    productionProjectRef: productionSupabaseRef,
    projects: [{ ref: 'abcdefghijklmnopqrst', name: 'dev', status: 'ACTIVE_HEALTHY', evidence_level: 'DECLARED' }],
  })
  assert.equal(declaredOnly.verified_remote_nonproduction_projects, 0)
  assert.equal(declaredOnly.declared_unverified_nonproduction_projects, 1)
})

test('the production release gate is auditable but not reusable as Premium canary authority', () => {
  const workflow = readFileSync(join(root, '.github', 'workflows', 'nelyon-production-release.yml'), 'utf8')
  const policy = JSON.parse(readFileSync(join(root, '.github', 'nelyon-production-release-policy.json'), 'utf8'))
  const authority = assessExistingApprovalAuthority({ workflow, policy })

  assert.equal(authority.c2.detected, true)
  assert.equal(authority.c2.reusable_for_canary, false)
  assert.equal(authority.c2.scope, 'PRODUCTION_RELEASE_ONLY')
  assert.equal(authority.owner_authority_status, 'OWNER_AUTHORITY_UNVERIFIED')
  assert.equal(authority.execution_capability_issued, false)
  assert.equal(authority.recommended_integration.creation_authorized, false)
  assert.match(authority.recommended_integration.environment_name, /premium-provider-canary/u)
})

test('approval request package binds every mutable fact but remains a request with zero authorized budget', () => {
  const mode = CANARY_MODES.REAL_PROVIDER_COMPONENT
  const plan = buildCanaryPlan(mode)
  const policy = preparePolicyApprovalPackage(candidate)
  const cloudflare = assessCloudflareInventory([cloudflareRecord()])
  const supabase = assessSupabaseIsolation({ productionProjectRef: productionSupabaseRef })
  const authority = assessExistingApprovalAuthority({
    workflow: readFileSync(join(root, '.github', 'workflows', 'nelyon-production-release.yml'), 'utf8'),
    policy: JSON.parse(readFileSync(join(root, '.github', 'nelyon-production-release-policy.json'), 'utf8')),
  })
  const request = buildCanaryAuthorizationRequestPackage({
    mode,
    repositorySha: repositoryHeadSha(),
    runnerFingerprint: providerCanaryArtifactFingerprint(),
    adapterFingerprint: providerAdapterArtifactFingerprint(),
    preflightFingerprint: preflightArtifactFingerprint(),
    plan,
    policyPackage: policy,
    cloudflareInventory: cloudflare,
    supabaseIsolation: supabase,
    approvalAuthority: authority,
  })

  assert.equal(request.status, 'OWNER_PLATFORM_APPROVAL_REQUIRED')
  assert.equal(request.execution_authorized, false)
  assert.equal(request.authorization_id, null)
  assert.equal(request.authorized_budget_usd, 0)
  assert.equal(request.requested_budget_usd, 0.05)
  assert.equal(request.cost_bound_status, 'EXTERNAL_COST_BOUND_UNVERIFIED')
  assert.equal(request.bindings.repository_sha, repositoryHeadSha())
  assert.equal(request.bindings.runner_artifact_fingerprint_sha256, providerCanaryArtifactFingerprint())
  assert.equal(request.bindings.provider_adapter_artifact_fingerprint_sha256, providerAdapterArtifactFingerprint())
  assert.equal(request.bindings.preflight_artifact_fingerprint_sha256, preflightArtifactFingerprint())
  assert.equal(request.bindings.canary_plan_fingerprint_sha256, plan.plan_fingerprint_sha256)
  assert.equal(request.bindings.policy_package_fingerprint_sha256, policy.package_fingerprint_sha256)
  assert.equal(request.limits.max_ai_calls, 4)
  assert.equal(request.limits.max_r2_uploads, 0)
  assert.equal(request.limits.max_stream_uploads, 0)
  assert.equal(request.limits.max_retries_per_operation, 0)
  assert.match(request.request_fingerprint_sha256, /^[0-9a-f]{64}$/u)
})

test('component and private-media budgets are separate and use the current Stream minute basis', () => {
  const component = buildCanaryPlan(CANARY_MODES.REAL_PROVIDER_COMPONENT)
  const privateMedia = buildCanaryPlan(CANARY_MODES.PRIVATE_MEDIA_E2E)

  assert.equal(component.cost.estimate_scope, 'COMPONENT_CANARY')
  assert.equal(privateMedia.cost.estimate_scope, 'PRIVATE_MEDIA_E2E')
  assert.equal(component.cost.stream_pricing_basis, 'NO_STREAM_OPERATIONS')
  assert.equal(privateMedia.cost.stream_pricing_basis, 'MINUTES_STORED_AND_DELIVERED')
  assert.equal(component.cost.stream_prepaid_capacity_required, false)
  assert.equal(privateMedia.cost.stream_prepaid_capacity_required, true)
  assert.ok(component.cost.known_variable_cost_usd < privateMedia.cost.known_variable_cost_usd)
  assert.equal(component.cost.cost_bound_status, 'EXTERNAL_COST_BOUND_UNVERIFIED')
  assert.equal(privateMedia.cost.cost_bound_status, 'EXTERNAL_COST_BOUND_UNVERIFIED')
  assert.ok(privateMedia.cost.unverified_components.includes('stream_storage_capacity'))
  assert.ok(privateMedia.cost.unverified_components.includes('r2_billing_rounding'))
})

test('F9 local preflight separates component readiness from private-media isolation', () => {
  const plan = buildCanaryPlan(CANARY_MODES.REAL_PROVIDER_COMPONENT)
  const policyPackage = preparePolicyApprovalPackage(candidate)
  const result = buildF9LocalPreflight({
    root,
    repositorySha: repositoryHeadSha(),
    runnerFingerprint: providerCanaryArtifactFingerprint(),
    adapterFingerprint: providerAdapterArtifactFingerprint(),
    plan,
    policyPackage,
  })

  assert.equal(result.status, 'LOCAL_PREFLIGHT_COMPLETE_EXTERNAL_AUTHORITY_PENDING')
  assert.equal(result.cloudflare.environment, 'CLOUDFLARE_ENVIRONMENT_IDENTIFIED_REMOTE_PENDING')
  assert.equal(result.supabase.component_probe.status, 'COMPONENT_PROBE_DOES_NOT_REQUIRE_SUPABASE')
  assert.equal(result.supabase.private_media_e2e.status, 'REMOTE_MEDIA_ISOLATION_PENDING')
  assert.equal(result.authority.owner_authority_status, 'OWNER_AUTHORITY_UNVERIFIED')
  assert.equal(result.authorization_request.execution_authorized, false)
  assert.equal(result.external.network_requests, 0)
  assert.equal(result.external.uploads, 0)
  assert.equal(result.external.inferences, 0)
  assert.equal(result.external.spend_usd, 0)
})

test('dry-run exposes F9 discovery without changing its zero-network contract', async () => {
  const result = await runSyntheticProviderCanary({ candidate })

  assert.equal(result.status, 'DRY_RUN_PASS')
  assert.equal(result.readiness.OWNER_AUTHORITY, 'UNVERIFIED')
  assert.equal(result.f9_preflight.status, 'LOCAL_PREFLIGHT_COMPLETE_EXTERNAL_AUTHORITY_PENDING')
  assert.equal(result.f9_preflight.authorization_request.execution_authorized, false)
  assert.deepEqual(result.external, { network_requests: 0, remote_uploads: 0, provider_inferences: 0, spend_usd: 0 })
  assert.equal(JSON.stringify(result).includes('24a176456cf57435119db8caf3af61dd'), false)
  assert.equal(JSON.stringify(result).includes(productionSupabaseRef), false)
})

test('fabricated files, credentials, and environment flags cannot unlock the external mode', async () => {
  const original = process.env.CREATOR_PREMIUM_CANARY_OWNER_APPROVED
  process.env.CREATOR_PREMIUM_CANARY_OWNER_APPROVED = 'true'
  try {
    await assert.rejects(
      runSyntheticProviderCanary({
        mode: CANARY_MODES.REAL_PROVIDER_COMPONENT,
        candidate,
        authorization: {
          schema_version: 'nelyon.creator_premium_provider_canary_authorization.v1',
          authorization_source: 'OWNER_APPROVED_DOCUMENT',
          approved_by_role: 'product_owner',
          account_authorized: true,
        },
      }),
      error => error instanceof CanaryGateError && error.code !== 'REAL_PROVIDER_COMPONENT_PASS',
    )
  } finally {
    if (original === undefined) delete process.env.CREATOR_PREMIUM_CANARY_OWNER_APPROVED
    else process.env.CREATOR_PREMIUM_CANARY_OWNER_APPROVED = original
  }
})

test('F9 readiness documentation records pending authority, isolation, cost, and separate owner decisions', () => {
  const readiness = readFileSync(join(root, 'docs', 'creator-premium-content-safety-readiness.md'), 'utf8')
  for (const marker of [
    'B7-F9 environment discovery and trusted authorization preparation',
    'CLOUDFLARE_ENVIRONMENT_IDENTIFIED_REMOTE_PENDING',
    'REMOTE_MEDIA_ISOLATION_PENDING',
    'OWNER_AUTHORITY_UNVERIFIED',
    'OWNER_PLATFORM_APPROVAL_REQUIRED',
    'REAL_PROVIDER_COMPONENT_NOT_EXECUTED',
    'PRODUCTION_ACTIVATION_NOT_AUTHORIZED',
    'USD 0.001587',
    'USD 0.004360',
    'separate owner decisions',
  ]) assert.match(readiness, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'iu'), marker)
})
