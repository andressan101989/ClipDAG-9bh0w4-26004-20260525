import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ACCOUNT_ID = /^[0-9a-f]{32}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const REPOSITORY_SHA = /^[0-9a-f]{40}$/u
const PRODUCTION_SUPABASE_PROJECT_REF = 'aewwdlvbwpczqyvkwvvj'
const PRODUCTION_RELEASE_WORKFLOW = '.github/workflows/nelyon-production-release.yml'
const PRODUCTION_RELEASE_POLICY = '.github/nelyon-production-release-policy.json'
const RECOMMENDED_COMPONENT_BUDGET_USD = 0.05

const CLOUDFLARE_CONFIG_PATHS = Object.freeze([
  'apps/web-frontdoor/wrangler.jsonc',
  'apps/admin-web/deployment/wrangler.unbound.jsonc',
  'apps/admin-web/deployment/wrangler.preview.jsonc',
  'apps/admin-web/deployment/wrangler.route.jsonc',
  'apps/business-web/deployment/wrangler.unbound.jsonc',
  'apps/business-web/deployment/wrangler.preview.jsonc',
  'apps/business-web/deployment/wrangler.route.jsonc',
])

const REQUIRED_STOP_CONDITIONS = Object.freeze([
  'account_identity_mismatch',
  'authorization_evidence_invalid',
  'cleanup_error',
  'cost_bound_unverified',
  'model_error',
  'quota_error',
  'signature_error',
  'timeout',
  'unexpected_cost',
])

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]))
  }
  return value
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value))
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex')
}

function uniqueSorted(values) {
  return [...new Set(values.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))].sort()
}

function safeWorkerName(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,62}$/u.test(value) ? value : null
}

function safeSource(value) {
  const source = typeof value === 'string' ? value.replaceAll('\\', '/').trim() : ''
  return source && !source.includes('..') && !/^[a-z]+:\/\//iu.test(source) ? source : null
}

function routeSignalsProduction(route) {
  const pattern = typeof route === 'string' ? route : route?.pattern
  return typeof pattern === 'string' && /(^|\.)nelyon\.app(?:\/|$)/iu.test(pattern.trim())
}

function accountFingerprint(accountId) {
  return sha256(`cloudflare-account:${accountId}`)
}

export function preflightArtifactFingerprint() {
  return sha256(readFileSync(fileURLToPath(import.meta.url), 'utf8').replace(/\r\n/gu, '\n'))
}

export function assessCloudflareInventory(records = []) {
  if (!Array.isArray(records)) throw new TypeError('cloudflare_inventory_invalid')
  const accounts = new Map()
  let invalidConfigurations = 0
  let r2Bindings = 0
  let streamBindings = 0

  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record) || !ACCOUNT_ID.test(record.account_id ?? '')) {
      invalidConfigurations += 1
      continue
    }
    const fingerprint = accountFingerprint(record.account_id)
    const routes = Array.isArray(record.routes) ? record.routes : []
    const entry = accounts.get(fingerprint) ?? {
      account_fingerprint_sha256: fingerprint,
      evidence_level: 'LOCAL_CONFIGURATION_ONLY',
      remotely_verified: false,
      configuration_count: 0,
      worker_names: [],
      sources: [],
      production_context_detected: false,
      preview_configuration_detected: false,
    }
    entry.configuration_count += 1
    entry.worker_names = uniqueSorted([...entry.worker_names, safeWorkerName(record.worker_name)])
    entry.sources = uniqueSorted([...entry.sources, safeSource(record.source)])
    entry.production_context_detected ||= routes.some(routeSignalsProduction)
    entry.preview_configuration_detected ||= record.workers_dev === true || record.preview_urls === true
    accounts.set(fingerprint, entry)
    r2Bindings += Array.isArray(record.r2_bindings) ? record.r2_bindings.length : 0
    streamBindings += Array.isArray(record.stream_bindings) ? record.stream_bindings.length : 0
  }

  const safeAccounts = [...accounts.values()].sort((left, right) => left.account_fingerprint_sha256.localeCompare(right.account_fingerprint_sha256))
  const productionContextDetected = safeAccounts.some(account => account.production_context_detected)
  return {
    identity_status: safeAccounts.length > 0 ? 'LOCAL_CONFIGURATION_IDENTIFIED' : 'LOCAL_CONFIGURATION_NOT_FOUND',
    remote_identity_status: 'REMOTE_IDENTITY_VERIFICATION_PENDING',
    configurations_found: safeAccounts.reduce((total, account) => total + account.configuration_count, 0),
    invalid_configurations: invalidConfigurations,
    unique_accounts_identified: safeAccounts.length,
    accounts: safeAccounts,
    production_context_detected: productionContextDetected,
    nonproduction_account_verified: false,
    r2_bindings_declared: r2Bindings,
    stream_bindings_declared: streamBindings,
    r2_resource_identity: r2Bindings > 0 ? 'LOCAL_CONFIGURATION_ONLY' : 'PENDING',
    stream_resource_identity: streamBindings > 0 ? 'LOCAL_CONFIGURATION_ONLY' : 'PENDING',
    shared_billing_risk: safeAccounts.length > 0 ? 'UNVERIFIED_SHARED_ACCOUNT_RISK' : 'UNKNOWN',
    external_queries_performed: 0,
    credentials_inspected: false,
  }
}

export function discoverRepositoryCloudflareInventory({ root }) {
  if (typeof root !== 'string' || !root.trim()) throw new TypeError('repository_root_required')
  const records = []
  for (const relativePath of CLOUDFLARE_CONFIG_PATHS) {
    const absolutePath = join(root, ...relativePath.split('/'))
    if (!existsSync(absolutePath)) continue
    let config
    try {
      config = JSON.parse(readFileSync(absolutePath, 'utf8'))
    } catch {
      records.push({ source: relativePath })
      continue
    }
    records.push({
      source: relativePath,
      account_id: config.account_id,
      worker_name: config.name,
      workers_dev: config.workers_dev,
      preview_urls: config.preview_urls,
      routes: Array.isArray(config.routes) ? config.routes : [],
      r2_bindings: Array.isArray(config.r2_buckets) ? config.r2_buckets.map(binding => binding?.binding).filter(Boolean) : [],
      stream_bindings: config.stream?.binding ? [config.stream.binding] : [],
      evidence_level: 'LOCAL_CONFIGURATION',
    })
  }
  return assessCloudflareInventory(records)
}

function projectFingerprint(projectRef) {
  return sha256(`supabase-project:${projectRef}`)
}

export function assessSupabaseIsolation({
  productionProjectRef = PRODUCTION_SUPABASE_PROJECT_REF,
  projects = [],
  branches = [],
  localDisposable,
} = {}) {
  const safeProjects = Array.isArray(projects) ? projects : []
  const safeBranches = Array.isArray(branches) ? branches : []
  const remoteNonproduction = safeProjects.filter(project =>
    project?.evidence_level === 'REMOTE_READ_ONLY' && typeof project.ref === 'string' && project.ref !== productionProjectRef)
  const declaredNonproduction = safeProjects.filter(project =>
    project?.evidence_level !== 'REMOTE_READ_ONLY' && typeof project?.ref === 'string' && project.ref !== productionProjectRef)
  const disposableReady = localDisposable?.available === true && localDisposable.engine === 'postgresql' && localDisposable.persistent === false

  return {
    status: remoteNonproduction.length > 0 || disposableReady
      ? 'SUPABASE_ISOLATION_PARTIALLY_IDENTIFIED'
      : 'SUPABASE_ISOLATION_PENDING',
    production_target_forbidden: true,
    production_project_fingerprint_sha256: typeof productionProjectRef === 'string' && productionProjectRef
      ? projectFingerprint(productionProjectRef)
      : null,
    projects_observed: safeProjects.length,
    branches_observed: safeBranches.length,
    verified_remote_nonproduction_projects: remoteNonproduction.length,
    declared_unverified_nonproduction_projects: declaredNonproduction.length,
    verified_remote_nonproduction_project_fingerprints: remoteNonproduction.map(project => projectFingerprint(project.ref)).sort(),
    local_disposable: {
      status: disposableReady ? 'LOCAL_DISPOSABLE_POSTGRES_IDENTIFIED' : 'LOCAL_DISPOSABLE_POSTGRES_NOT_VERIFIED_BY_RUNNER',
      available: disposableReady,
      persistent: disposableReady ? false : null,
      fixture_status: disposableReady ? String(localDisposable.fixture_status ?? 'UNKNOWN') : 'NOT_PROVIDED',
      suitable_for_component_probe: false,
      suitable_for_canonical_reconciliation: disposableReady,
      suitable_for_remote_media_authority: false,
    },
    component_probe: {
      ready: true,
      supabase_required: false,
      status: 'COMPONENT_PROBE_DOES_NOT_REQUIRE_SUPABASE',
    },
    private_media_e2e: {
      ready: false,
      database_isolation_available: disposableReady || remoteNonproduction.length > 0,
      media_isolation_verified: false,
      status: 'REMOTE_MEDIA_ISOLATION_PENDING',
    },
    production_data_copy_required: false,
  }
}

export function assessExistingApprovalAuthority({ workflow = '', policy = {} } = {}) {
  const environmentName = policy?.environment?.name
  const defaultBranch = policy?.default_branch
  const modes = Array.isArray(policy?.modes) ? policy.modes : []
  const c2Detected = typeof workflow === 'string' && /\bon:\s*\r?\n\s+workflow_dispatch:/mu.test(workflow) &&
    /environment:\s*production/u.test(workflow) && environmentName === 'production'
  return {
    owner_authority_status: 'OWNER_AUTHORITY_UNVERIFIED',
    execution_capability_issued: false,
    c2: {
      detected: c2Detected,
      scope: 'PRODUCTION_RELEASE_ONLY',
      reusable_for_canary: false,
      environment_name: environmentName ?? null,
      default_branch: defaultBranch ?? null,
      modes: [...modes],
      reasons: [
        'C2 is bound to the production Environment and production Supabase project.',
        'C2 accepts only production release modes and exact origin/main release identities.',
        'Changing C2 authority is outside B7-F9 and could weaken the production gate.',
      ],
    },
    recommended_integration: {
      status: 'PROPOSAL_ONLY',
      platform: 'GITHUB_ACTIONS_PROTECTED_ENVIRONMENT',
      environment_name: 'premium-provider-canary',
      workflow_name: 'Nelyon Creator Premium provider canary',
      trigger: 'workflow_dispatch',
      authenticated_api_snapshots_required: true,
      required_reviewer_identity: policy?.owner ?? null,
      exact_sha_checkout_required: true,
      immutable_request_artifact_required: true,
      single_use_permission_required: true,
      production_secrets_forbidden: true,
      creation_authorized: false,
      c2_must_remain_unchanged: true,
    },
  }
}

function assertHash(value, pattern, code) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new TypeError(code)
  return value
}

export function buildCanaryAuthorizationRequestPackage({
  mode,
  repositorySha,
  runnerFingerprint,
  adapterFingerprint,
  preflightFingerprint,
  plan,
  policyPackage,
  cloudflareInventory,
  supabaseIsolation,
  approvalAuthority,
}) {
  if (!['REAL_PROVIDER_COMPONENT', 'PRIVATE_MEDIA_E2E'].includes(mode)) throw new TypeError('canary_authorization_mode_invalid')
  assertHash(repositorySha, REPOSITORY_SHA, 'repository_sha_invalid')
  assertHash(runnerFingerprint, SHA256, 'runner_fingerprint_invalid')
  assertHash(adapterFingerprint, SHA256, 'adapter_fingerprint_invalid')
  assertHash(preflightFingerprint, SHA256, 'preflight_fingerprint_invalid')
  assertHash(plan?.plan_fingerprint_sha256, SHA256, 'plan_fingerprint_invalid')
  assertHash(policyPackage?.package_fingerprint_sha256, SHA256, 'policy_fingerprint_invalid')

  const accountFingerprints = cloudflareInventory?.accounts?.map(account => account.account_fingerprint_sha256) ?? []
  const requestedBudgetUsd = mode === 'REAL_PROVIDER_COMPONENT' ? RECOMMENDED_COMPONENT_BUDGET_USD : null
  const material = {
    schema_version: 'nelyon.creator_premium_provider_canary_authorization_request.v2',
    mode,
    bindings: {
      repository_sha: repositorySha,
      runner_artifact_fingerprint_sha256: runnerFingerprint,
      provider_adapter_artifact_fingerprint_sha256: adapterFingerprint,
      preflight_artifact_fingerprint_sha256: preflightFingerprint,
      canary_plan_fingerprint_sha256: plan.plan_fingerprint_sha256,
      policy_package_fingerprint_sha256: policyPackage.package_fingerprint_sha256,
      candidate_cloudflare_account_fingerprints: [...accountFingerprints].sort(),
      selected_cloudflare_account_fingerprint: null,
      selected_supabase_project_fingerprint: null,
    },
    scope: [...plan.required_scopes],
    models: [...(plan.provider_adapter?.models ?? [])],
    limits: { ...plan.limits },
    requested_budget_usd: requestedBudgetUsd,
    authorized_budget_usd: 0,
    cost_bound_status: 'EXTERNAL_COST_BOUND_UNVERIFIED',
    quota_status: 'ACCOUNT_QUOTA_READ_ONLY_VERIFICATION_PENDING',
    pricing_status: 'PUBLIC_DOCUMENTATION_ONLY_ACCOUNT_BILLING_PENDING',
    environment: {
      cloudflare_identity: cloudflareInventory?.remote_identity_status ?? 'REMOTE_IDENTITY_VERIFICATION_PENDING',
      account_selection: 'OWNER_SELECTION_AND_REMOTE_VERIFICATION_REQUIRED',
      supabase_requirement: mode === 'REAL_PROVIDER_COMPONENT'
        ? 'NOT_REQUIRED_FOR_COMPONENT_PROBE'
        : supabaseIsolation?.private_media_e2e?.status ?? 'REMOTE_MEDIA_ISOLATION_PENDING',
      production_supabase_forbidden: true,
    },
    authority: {
      status: approvalAuthority?.owner_authority_status ?? 'OWNER_AUTHORITY_UNVERIFIED',
      proposed_platform: approvalAuthority?.recommended_integration?.platform ?? null,
      proposed_environment: approvalAuthority?.recommended_integration?.environment_name ?? null,
      existing_c2_reused: false,
      creation_authorized: false,
    },
    approval_requirements: {
      authenticated_platform_evidence: true,
      exact_actor_identity: true,
      approved_at: null,
      expires_at: null,
      single_use: true,
      evidence_source: null,
    },
    cleanup: {
      inventory_by_authorization_id: true,
      exact_resource_ids_only: true,
      verify_zero_residual_resources: true,
      preserve_user_resources: true,
    },
    stop_conditions: [...REQUIRED_STOP_CONDITIONS],
    reuse_policy: 'SINGLE_USE_REQUIRED_PENDING_PLATFORM_ENFORCEMENT',
  }
  return {
    ...material,
    status: 'OWNER_PLATFORM_APPROVAL_REQUIRED',
    authorization_id: null,
    execution_authorized: false,
    request_fingerprint_sha256: sha256(`nelyon.creator_premium_provider_canary_authorization_request.sha256-canonical-json.v2\n${canonicalJson(material)}`),
  }
}

export function buildF9LocalPreflight({
  root,
  repositorySha,
  runnerFingerprint,
  adapterFingerprint,
  plan,
  policyPackage,
  supabaseEvidence,
} = {}) {
  if (typeof root !== 'string' || !root.trim()) throw new TypeError('repository_root_required')
  if (!['REAL_PROVIDER_COMPONENT', 'PRIVATE_MEDIA_E2E'].includes(plan?.mode)) {
    throw new TypeError('external_canary_plan_required')
  }
  const cloudflare = discoverRepositoryCloudflareInventory({ root })
  const releaseWorkflow = readFileSync(join(root, ...PRODUCTION_RELEASE_WORKFLOW.split('/')), 'utf8')
  const releasePolicy = JSON.parse(readFileSync(join(root, ...PRODUCTION_RELEASE_POLICY.split('/')), 'utf8'))
  const authority = assessExistingApprovalAuthority({ workflow: releaseWorkflow, policy: releasePolicy })
  const supabase = assessSupabaseIsolation({
    productionProjectRef: releasePolicy?.supabase?.project_ref ?? PRODUCTION_SUPABASE_PROJECT_REF,
    ...(supabaseEvidence ?? {}),
  })
  const authorizationRequest = buildCanaryAuthorizationRequestPackage({
    mode: plan.mode,
    repositorySha,
    runnerFingerprint,
    adapterFingerprint,
    preflightFingerprint: preflightArtifactFingerprint(),
    plan,
    policyPackage,
    cloudflareInventory: cloudflare,
    supabaseIsolation: supabase,
    approvalAuthority: authority,
  })
  return {
    schema_version: 'nelyon.creator_premium_provider_canary_preflight.v1',
    status: 'LOCAL_PREFLIGHT_COMPLETE_EXTERNAL_AUTHORITY_PENDING',
    cloudflare: {
      environment: cloudflare.unique_accounts_identified > 0
        ? 'CLOUDFLARE_ENVIRONMENT_IDENTIFIED_REMOTE_PENDING'
        : 'CLOUDFLARE_ENVIRONMENT_PENDING',
      ...cloudflare,
    },
    supabase,
    authority,
    authorization_request: authorizationRequest,
    external: { network_requests: 0, uploads: 0, inferences: 0, spend_usd: 0 },
    final_states: {
      CLOUDFLARE_ENVIRONMENT: cloudflare.unique_accounts_identified > 0 ? 'IDENTIFIED_LOCAL_REMOTE_PENDING' : 'PENDING',
      SUPABASE_ISOLATION: supabase.status,
      OWNER_AUTHORITY: authority.owner_authority_status,
      COST_BOUND: 'EXTERNAL_COST_BOUND_UNVERIFIED',
      REAL_PROVIDER_COMPONENT: 'NOT_EXECUTED',
      PRODUCTION_ACTIVATION: 'NOT_AUTHORIZED',
    },
  }
}
