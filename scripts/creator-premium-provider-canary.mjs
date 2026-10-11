import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  VISUAL_MODEL,
  buildVisualProbeRequest,
  makeSyntheticVisualProbeImage,
  validateVisualProbeResponse,
} from '../supabase/functions/content-safety-scan/visualProbe.mjs'
import {
  WHISPER_MODEL,
  makeProbeWav,
  normalizeWhisperResult,
} from '../supabase/functions/content-safety-scan/audioPipeline.mjs'

export const CANARY_MODES = Object.freeze({
  DRY_RUN: 'DRY_RUN',
  REAL_PROVIDER_COMPONENT: 'REAL_PROVIDER_COMPONENT',
  PRIVATE_MEDIA_E2E: 'PRIVATE_MEDIA_E2E',
})

const POLICY_SCHEMA = 'nelyon.creator_premium_content_safety_policy_candidate.v1'
const AUTHORIZATION_SCHEMA = 'nelyon.creator_premium_provider_canary_authorization.v1'
const CANDIDATE_FINGERPRINT_CONTRACT = 'nelyon.creator_premium_candidate_rule.sha256-canonical-json.v1'
const CANARY_PLAN_FINGERPRINT_CONTRACT = 'nelyon.creator_premium_provider_canary_plan.sha256-canonical-json.v1'
const RECOMMENDED_OWNER_CAP_USD = 0.05
const QUOTA_CONFIRMATION_MAX_AGE_MS = 24 * 60 * 60 * 1000
const REQUIRED_CLEANUP_CONTROLS = Object.freeze({
  inventory_by_authorization_id: true,
  exact_resource_ids_only: true,
  verify_zero_residual_resources: true,
  preserve_user_resources: true,
})
const REQUIRED_STOP_CONDITIONS = Object.freeze([
  'cleanup_error',
  'model_error',
  'quota_error',
  'signature_error',
  'timeout',
  'unexpected_cost',
])
const SIMULATION_PROFILE_KEYS = new Set([
  'operation_delay_ms',
  'operation_cost_usd',
  'cleanup_delay_ms',
  'cleanup_residual_resources',
  'fail_operation_index',
])
const EXPECTED_RULE_CODES = Object.freeze([
  'cp_child_safety_csam_en_v1',
  'cp_child_safety_csam_es_v1',
  'cp_sexual_exploitation_en_v1',
  'cp_sexual_exploitation_es_v1',
  'cp_nc_intimate_imagery_en_v1',
  'cp_nc_intimate_imagery_es_v1',
  'cp_credible_threat_en_v1',
  'cp_credible_threat_es_v1',
  'cp_illegal_violence_en_v1',
  'cp_illegal_violence_es_v1',
  'cp_payment_fraud_en_v1',
  'cp_payment_fraud_es_v1',
])

const BASE_LIMITS = Object.freeze({
  max_ai_calls: 11,
  max_r2_uploads: 1,
  max_stream_uploads: 1,
  max_stream_transformations: 11,
  max_retries_per_operation: 0,
  max_duration_seconds: 900,
  max_bytes_transmitted: 25_000_000,
  max_persistent_objects: 2,
  concurrency: 1,
})

const COMPONENT_LIMITS = Object.freeze({
  max_ai_calls: 4,
  max_r2_uploads: 0,
  max_stream_uploads: 0,
  max_stream_transformations: 0,
  max_retries_per_operation: 0,
  max_duration_seconds: 300,
  max_bytes_transmitted: 5_000_000,
  max_persistent_objects: 0,
  concurrency: 1,
})

export class CanaryGateError extends Error {
  constructor(code) {
    super(code)
    this.name = 'CanaryGateError'
    this.code = code
  }
}

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
  const input = value instanceof Uint8Array ? value : String(value)
  return createHash('sha256').update(input, value instanceof Uint8Array ? undefined : 'utf8').digest('hex')
}

function normalizedPattern(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('und').replace(/\s+/gu, ' ').trim()
}

function candidateRuleMaterial(rule) {
  return {
    code: rule.code,
    name: rule.name,
    category: rule.category,
    detector_type: rule.detector_type,
    normalized_pattern: normalizedPattern(rule.pattern),
    severity: rule.severity,
    scopes: [...new Set(Array.isArray(rule.scopes) ? rule.scopes.map(value => String(value).trim()) : [])].sort(),
    locale: rule.locale,
    policy_source: rule.policy_source,
    policy_reference: rule.policy_reference,
    policy_version: rule.policy_version,
    rationale: rule.rationale,
    benign_examples: Array.isArray(rule.benign_examples) ? rule.benign_examples : [],
    false_positive_risk: rule.false_positive_risk,
    proposed_approval_state: rule.proposed_approval_state,
    proposed_enabled: rule.proposed_enabled,
    effect: rule.effect,
  }
}

export function candidateRuleFingerprint(rule) {
  return sha256(`${CANDIDATE_FINGERPRINT_CONTRACT}\n${canonicalJson(candidateRuleMaterial(rule))}`)
}

export function providerCanaryArtifactFingerprint() {
  return sha256(readFileSync(fileURLToPath(import.meta.url), 'utf8').replace(/\r\n/gu, '\n'))
}

function validateCandidate(candidate) {
  if (!candidate || candidate.schema_version !== POLICY_SCHEMA || candidate.production_effect !== false ||
      candidate.provider_external_calls_authorized !== false || candidate.external_budget_usd !== 0 ||
      candidate.fingerprint_contract?.algorithm !== 'sha256' ||
      candidate.fingerprint_contract?.canonicalization !== CANDIDATE_FINGERPRINT_CONTRACT ||
      !Array.isArray(candidate.rules) || candidate.rules.length !== EXPECTED_RULE_CODES.length) {
    throw new CanaryGateError('POLICY_CANDIDATE_INVALID')
  }
  const codes = new Set()
  for (const rule of candidate.rules) {
    if (!rule || typeof rule.code !== 'string' || codes.has(rule.code) || rule.proposed_enabled !== false ||
        rule.proposed_approval_state !== 'draft' || !['en', 'es'].includes(rule.locale) ||
        !Array.isArray(rule.scopes) || !rule.scopes.includes('creator_premium_text') || !rule.scopes.includes('transcript')) {
      throw new CanaryGateError('POLICY_CANDIDATE_INVALID')
    }
    codes.add(rule.code)
    if (rule.candidate_fingerprint_sha256 !== candidateRuleFingerprint(rule)) {
      throw new CanaryGateError('POLICY_CANDIDATE_FINGERPRINT_MISMATCH')
    }
  }
  if (EXPECTED_RULE_CODES.some(code => !codes.has(code))) throw new CanaryGateError('POLICY_CANDIDATE_INVALID')
  return candidate
}

export function preparePolicyApprovalPackage(candidate) {
  validateCandidate(candidate)
  const rules = candidate.rules.map(rule => ({
    code: rule.code,
    locale: rule.locale,
    category: rule.category,
    pattern: rule.pattern,
    severity: rule.severity,
    source: rule.policy_reference,
    benign_example: rule.benign_examples[0],
    false_positive_risk: rule.false_positive_risk,
    recommendation: 'REVIEW',
    candidate_fingerprint_sha256: rule.candidate_fingerprint_sha256,
    governance_fingerprint: null,
  }))
  const packageMaterial = {
    schema_version: candidate.schema_version,
    status: candidate.status,
    authority: candidate.authority,
    decision_model: candidate.decision_model,
    scopes: candidate.scopes,
    rules: rules.map(({ governance_fingerprint: _ignored, ...rule }) => rule),
    activation_prerequisites: candidate.activation_prerequisites,
  }
  return {
    status: 'POLICY_PREPARED',
    production_effect: false,
    rule_count: rules.length,
    fingerprint_contract: CANDIDATE_FINGERPRINT_CONTRACT,
    package_fingerprint_sha256: sha256(canonicalJson(packageMaterial)),
    canonical_governance_fingerprint_status: 'PENDING_RULE_CREATION_AND_PREVIEW',
    governance_note: 'The database fingerprint includes the UUID and version assigned by the canonical governance RPC. It must be captured from an audited preview after rule creation and cannot be fabricated from this draft.',
    rules,
  }
}

function syntheticFixtures() {
  const imageDataUri = makeSyntheticVisualProbeImage()
  const imageBytes = Buffer.from(imageDataUri.split(',')[1], 'base64')
  return {
    image: {
      id: 'synthetic-red-square-blue-circle-v1',
      mime_type: 'image/png',
      byte_length: imageBytes.length,
      sha256: sha256(imageBytes),
      contains_identifiable_people: false,
      personal_data: false,
      remote_upload_performed: false,
    },
    video: {
      id: 'synthetic-color-shapes-with-benign-audio-v1',
      mime_type: 'video/mp4',
      duration_seconds: 6,
      frame_timestamps_ms: [0, 1500, 3000, 4500, 5999],
      contains_identifiable_people: false,
      personal_data: false,
      materialization: 'FUTURE_AUTHORIZED_LOCAL_GENERATION',
      remote_upload_performed: false,
    },
    audio: [
      { id: 'synthetic-benign-es-v1', locale: 'es', kind: 'MOCKED_TRANSCRIPT_CONTRACT', remote_upload_performed: false },
      { id: 'synthetic-benign-en-v1', locale: 'en', kind: 'MOCKED_TRANSCRIPT_CONTRACT', remote_upload_performed: false },
      { id: 'synthetic-silence-v1', locale: 'und', kind: 'DETERMINISTIC_PCM_WAV', byte_length: makeProbeWav().length, remote_upload_performed: false },
    ],
  }
}

function knownCost() {
  const visualCalls = 7
  const audioCalls = 4
  const streamTransformations = 11
  const visualOutput = visualCalls * 1200 / 1_000_000 * 0.30
  const audio = audioCalls * 0.000513
  const stream = streamTransformations / 1000 * 0.50
  return Number((visualOutput + audio + stream).toFixed(6))
}

function operation(kind, service, extra = {}) {
  return { kind, service, external: true, ...extra }
}

export function buildCanaryPlan(mode = CANARY_MODES.DRY_RUN) {
  if (!Object.values(CANARY_MODES).includes(mode)) throw new CanaryGateError('CANARY_MODE_INVALID')
  const componentOperations = [
    operation('workers_ai_visual_probe', 'workers_ai', { model: VISUAL_MODEL }),
    operation('workers_ai_audio_probe_es', 'workers_ai', { model: WHISPER_MODEL, locale: 'es' }),
    operation('workers_ai_audio_probe_en', 'workers_ai', { model: WHISPER_MODEL, locale: 'en' }),
    operation('workers_ai_audio_probe_silence', 'workers_ai', { model: WHISPER_MODEL, locale: 'und' }),
  ]
  const privateMediaOperations = [
    operation('r2_private_upload', 'r2', { asset: 'synthetic_image', count: 1 }),
    operation('workers_ai_visual_original', 'workers_ai', { model: VISUAL_MODEL }),
    operation('stream_private_upload', 'stream', { asset: 'synthetic_video', count: 1, require_signed_urls: true }),
    ...[0, 1500, 3000, 4500, 5999].flatMap((timestamp, frame_index) => [
      operation('stream_signed_frame', 'stream', { timestamp_ms: timestamp, frame_index, billable_transformations: 1 }),
      operation('workers_ai_visual_frame', 'workers_ai', { model: VISUAL_MODEL, timestamp_ms: timestamp, frame_index }),
    ]),
    operation('stream_signed_audio_download', 'stream', { downloadable: true, ttl_seconds: 300, billable_transformations: 6 }),
    operation('workers_ai_audio_transcription', 'workers_ai', { model: WHISPER_MODEL }),
    operation('canonical_reconciliation', 'supabase_disposable', { external: false, publication_authority: 'creator_premium' }),
  ]
  const operations = mode === CANARY_MODES.PRIVATE_MEDIA_E2E ? [...componentOperations, ...privateMediaOperations] : componentOperations
  const limits = mode === CANARY_MODES.PRIVATE_MEDIA_E2E ? { ...BASE_LIMITS } : { ...COMPONENT_LIMITS }
  const plan = {
    schema_version: 'nelyon.creator_premium_provider_canary_plan.v1',
    mode,
    default_execution: mode === CANARY_MODES.DRY_RUN,
    network_enabled: mode !== CANARY_MODES.DRY_RUN,
    operations,
    limits,
    required_scopes: mode === CANARY_MODES.PRIVATE_MEDIA_E2E
      ? ['workers_ai_visual', 'workers_ai_audio', 'r2_private_canary', 'stream_private_canary', 'supabase_disposable_reconciliation']
      : ['workers_ai_visual', 'workers_ai_audio'],
    expected_usage: mode === CANARY_MODES.PRIVATE_MEDIA_E2E
      ? {
          total_operations: 20,
          provider_network_operations: 19,
          ai_inferences: 11,
          r2_uploads: 1,
          stream_uploads: 1,
          stream_transformations: 11,
          disposable_reconciliations: 1,
        }
      : {
          total_operations: 4,
          provider_network_operations: 4,
          ai_inferences: 4,
          r2_uploads: 0,
          stream_uploads: 0,
          stream_transformations: 0,
          disposable_reconciliations: 0,
        },
    cleanup: {
      required: mode === CANARY_MODES.PRIVATE_MEDIA_E2E,
      resource_types: ['r2_object', 'stream_video', 'stream_audio_derivative'],
      pass_condition: 'residual_resources=0',
    },
    cost: {
      pricing_checked_at: '2026-10-11',
      known_variable_cost_usd: knownCost(),
      includes_visual_input_or_image_units: false,
      includes_account_specific_r2_or_stream_allowances: false,
      recommended_owner_cap_usd: RECOMMENDED_OWNER_CAP_USD,
      authorized_budget_usd: 0,
      authorization_required_before_network: true,
    },
  }
  return {
    ...plan,
    plan_fingerprint_contract: CANARY_PLAN_FINGERPRINT_CONTRACT,
    plan_fingerprint_sha256: sha256(`${CANARY_PLAN_FINGERPRINT_CONTRACT}\n${canonicalJson(plan)}`),
  }
}

function authorizationError(code) {
  throw new CanaryGateError(code)
}

function sameStringSet(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length &&
    [...actual].sort().every((value, index) => value === [...expected].sort()[index])
}

function exactNumericLimits(actual, expected) {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false
  const actualKeys = Object.keys(actual).sort()
  const expectedKeys = Object.keys(expected).sort()
  return actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index] && Number(actual[key]) === Number(expected[key]))
}

function validCleanupPlan(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actualKeys = Object.keys(value).sort()
  const expectedKeys = Object.keys(REQUIRED_CLEANUP_CONTROLS).sort()
  return actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index] && value[key] === REQUIRED_CLEANUP_CONTROLS[key])
}

export function validateExternalAuthorization({ mode, authorization, policyPackage, now = new Date() }) {
  if (!authorization || typeof authorization !== 'object') authorizationError('EXTERNAL_AUTHORIZATION_REQUIRED')
  if (authorization.schema_version !== AUTHORIZATION_SCHEMA || authorization.authorization_source !== 'OWNER_APPROVED_DOCUMENT' ||
      typeof authorization.authorization_id !== 'string' || !authorization.authorization_id.trim() || authorization.approved_by_role !== 'product_owner') {
    authorizationError('EXTERNAL_AUTHORIZATION_INVALID')
  }
  if (authorization.authorized_mode !== mode) authorizationError('EXTERNAL_AUTHORIZATION_MODE_MISMATCH')
  if (authorization.non_production !== true || authorization.environment?.production !== false) authorizationError('PRODUCTION_ENVIRONMENT_FORBIDDEN')
  if (!authorization.environment || typeof authorization.environment.name !== 'string' || !authorization.environment.name.trim() ||
      typeof authorization.environment.supabase_project_ref !== 'string' || !authorization.environment.supabase_project_ref.trim() ||
      typeof authorization.environment.cloudflare_account_alias !== 'string' || !authorization.environment.cloudflare_account_alias.trim()) {
    authorizationError('EXTERNAL_ENVIRONMENT_NOT_AUTHORIZED')
  }
  if (authorization.account_authorized !== true) authorizationError('EXTERNAL_ACCOUNT_NOT_AUTHORIZED')
  if (!(Number(authorization.max_budget_usd) > 0)) authorizationError('EXTERNAL_BUDGET_NOT_AUTHORIZED')
  if (Number(authorization.max_budget_usd) > RECOMMENDED_OWNER_CAP_USD) authorizationError('EXTERNAL_BUDGET_LIMIT_EXCEEDED')
  const approvedAt = Date.parse(authorization.approved_at)
  const expiresAt = Date.parse(authorization.expires_at)
  const quotaCheckedAt = Date.parse(authorization.quota_checked_at)
  const pricingCheckedAt = Date.parse(authorization.pricing_checked_at)
  const current = now instanceof Date ? now.getTime() : Date.parse(now)
  if (![approvedAt, expiresAt, quotaCheckedAt, pricingCheckedAt, current].every(Number.isFinite)) authorizationError('EXTERNAL_AUTHORIZATION_INVALID')
  if (current > expiresAt || current < approvedAt) authorizationError('EXTERNAL_AUTHORIZATION_EXPIRED')
  if (authorization.quotas_confirmed !== true || current - quotaCheckedAt > QUOTA_CONFIRMATION_MAX_AGE_MS || quotaCheckedAt > current + 5 * 60 * 1000) {
    authorizationError('EXTERNAL_QUOTA_CONFIRMATION_STALE')
  }
  if (current - pricingCheckedAt > QUOTA_CONFIRMATION_MAX_AGE_MS || pricingCheckedAt > current + 5 * 60 * 1000) {
    authorizationError('EXTERNAL_PRICING_CONFIRMATION_STALE')
  }
  const plan = buildCanaryPlan(mode)
  if (authorization.runner_artifact_fingerprint_sha256 !== providerCanaryArtifactFingerprint()) {
    authorizationError('EXTERNAL_RUNNER_FINGERPRINT_MISMATCH')
  }
  if (authorization.canary_plan_fingerprint_sha256 !== plan.plan_fingerprint_sha256) {
    authorizationError('EXTERNAL_PLAN_FINGERPRINT_MISMATCH')
  }
  if (!policyPackage || authorization.policy_package_fingerprint_sha256 !== policyPackage.package_fingerprint_sha256) {
    authorizationError('EXTERNAL_POLICY_FINGERPRINT_MISMATCH')
  }
  const costEstimate = authorization.cost_estimate
  if (!costEstimate || costEstimate.currency !== 'USD' || costEstimate.includes_all_planned_operations !== true ||
      costEstimate.source !== 'OWNER_REVIEWED_CURRENT_PROVIDER_PRICING' || !(Number(costEstimate.worst_case_usd) > 0)) {
    authorizationError('EXTERNAL_COST_ESTIMATE_INVALID')
  }
  if (Number(costEstimate.worst_case_usd) < plan.cost.known_variable_cost_usd) {
    authorizationError('EXTERNAL_COST_ESTIMATE_UNDERSTATED')
  }
  if (Number(costEstimate.worst_case_usd) > Number(authorization.max_budget_usd)) {
    authorizationError('EXTERNAL_BUDGET_NOT_COVERED')
  }
  const limits = authorization.limits
  if (!exactNumericLimits(limits, plan.limits)) {
    authorizationError('EXTERNAL_LIMITS_INVALID')
  }
  if (!sameStringSet(authorization.scope, plan.required_scopes)) {
    authorizationError('EXTERNAL_SCOPE_NOT_AUTHORIZED')
  }
  if (!validCleanupPlan(authorization.cleanup_plan) || !sameStringSet(authorization.stop_conditions, REQUIRED_STOP_CONDITIONS)) {
    authorizationError('EXTERNAL_SAFETY_PLAN_REQUIRED')
  }
  return {
    authorization_id: authorization.authorization_id,
    mode,
    max_budget_usd: Number(authorization.max_budget_usd),
    worst_case_cost_usd: Number(costEstimate.worst_case_usd),
    runner_artifact_fingerprint_sha256: authorization.runner_artifact_fingerprint_sha256,
    canary_plan_fingerprint_sha256: authorization.canary_plan_fingerprint_sha256,
    policy_package_fingerprint_sha256: authorization.policy_package_fingerprint_sha256,
    environment: { ...authorization.environment },
    scope: [...authorization.scope],
    quotas_confirmed: true,
    quota_checked_at: authorization.quota_checked_at,
    pricing_checked_at: authorization.pricing_checked_at,
    limits: { ...limits },
    cleanup_plan: { ...authorization.cleanup_plan },
    stop_conditions: [...authorization.stop_conditions],
  }
}

const REDACTED_NORMALIZED_KEYS = new Set([
  'authorization', 'secret', 'token', 'password', 'credential', 'privatekey',
  'servicerolekey', 'signedurl', 'objectkey', 'payload', 'mediabytes', 'datauri',
  'accountid', 'assetid', 'contentid', 'streamuid', 'cloudflareuid', 'videouid',
  'resourceid', 'apikey', 'thumbnailurl', 'audiourl', 'playbackurl', 'body',
  'request', 'response', 'message', 'accesstoken', 'refreshtoken', 'privatemedialocator',
  'medialocator', 'storagepath', 'resourceids', 'raw', 'binary', 'bytes', 'uri', 'url',
])

function mustRedactKey(key) {
  const normalized = String(key).replace(/[^a-z0-9]/giu, '').toLowerCase()
  return REDACTED_NORMALIZED_KEYS.has(normalized) ||
    /(?:secret|token|password|credential|privatekey|servicerolekey|signedurl|objectkey|locator|storagepath|resourceids?|mediabytes|datauri|apikey|privateuri|privateurl)$/u.test(normalized)
}

export function redactCanaryEvidence(value, key = '') {
  if (mustRedactKey(key)) return '[REDACTED]'
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return '[REDACTED]'
  if (Array.isArray(value)) return value.map(item => redactCanaryEvidence(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactCanaryEvidence(entryValue, entryKey)]))
  }
  if (typeof value === 'string' && (/(?:\b(?:https?|data|r2|s3|cfstream):|\bBearer\s+|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.)/iu.test(value) || value.length > 512)) return '[REDACTED]'
  return value
}

function runLocalContracts() {
  const visualRequest = buildVisualProbeRequest()
  const visual = validateVisualProbeResponse({
    success: true,
    result: { response: { objects: [{ shape: 'square', color: 'red' }, { shape: 'circle', color: 'blue' }] } },
  })
  const audioPayloads = [
    { result: { transcription_info: { text: 'Esta es una muestra sintética benigna.', word_count: 6, language: 'es' }, segments: [{ start: 0, end: 1.2, text: 'Esta es una muestra sintética benigna.' }] } },
    { result: { transcription_info: { text: 'This is a benign synthetic sample.', word_count: 6, language: 'en' }, segments: [{ start: 0, end: 1.2, text: 'This is a benign synthetic sample.' }] } },
    { result: { transcription_info: { text: '', word_count: 0 }, segments: [] } },
  ]
  return {
    visual: {
      vision_input: visual.visionInput,
      structured_output: visual.structuredOutput,
      schema_valid: visual.schemaValid,
      model: VISUAL_MODEL,
      request_has_inline_synthetic_image: visualRequest.messages[1].content.some(part => part.type === 'image_url' && part.image_url.url.startsWith('data:image/png;base64,')),
    },
    audio: audioPayloads.map(payload => {
      const normalized = normalizeWhisperResult(payload)
      return {
        detected_language: normalized.detectedLanguage,
        word_count: normalized.wordCount,
        no_speech: normalized.noSpeech,
        segment_count: normalized.segments.length,
        timecodes_valid: normalized.segments.every(segment => segment.start >= 0 && segment.end >= segment.start),
      }
    }),
  }
}

function validateSimulationProfile(profile = {}) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile) ||
      (Object.getPrototypeOf(profile) !== Object.prototype && Object.getPrototypeOf(profile) !== null)) {
    throw new CanaryGateError('CANARY_SIMULATION_PROFILE_INVALID')
  }
  const descriptors = Object.getOwnPropertyDescriptors(profile)
  const ownKeys = Reflect.ownKeys(profile)
  if (ownKeys.some(key => typeof key !== 'string' || !SIMULATION_PROFILE_KEYS.has(key))) {
    throw new CanaryGateError('CANARY_SIMULATION_PROFILE_INVALID')
  }
  const values = {}
  for (const key of ownKeys) {
    const descriptor = descriptors[key]
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'number' ||
        !Number.isFinite(descriptor.value) || descriptor.value < 0) {
      throw new CanaryGateError('CANARY_SIMULATION_PROFILE_INVALID')
    }
    values[key] = descriptor.value
  }
  if (values.cleanup_residual_resources !== undefined && !Number.isInteger(values.cleanup_residual_resources)) {
    throw new CanaryGateError('CANARY_SIMULATION_PROFILE_INVALID')
  }
  if (values.fail_operation_index !== undefined && !Number.isInteger(values.fail_operation_index)) {
    throw new CanaryGateError('CANARY_SIMULATION_PROFILE_INVALID')
  }
  return {
    operation_delay_ms: values.operation_delay_ms ?? 0,
    operation_cost_usd: values.operation_cost_usd ?? 0,
    cleanup_delay_ms: values.cleanup_delay_ms ?? 0,
    cleanup_residual_resources: values.cleanup_residual_resources ?? 0,
    fail_operation_index: values.fail_operation_index ?? null,
  }
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function delayBeforeDeadline(milliseconds, deadline) {
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new CanaryGateError('CANARY_TIMEOUT')
  if (milliseconds >= remaining) throw new CanaryGateError('CANARY_TIMEOUT')
  if (milliseconds > 0) await delay(milliseconds)
  if (Date.now() >= deadline) throw new CanaryGateError('CANARY_TIMEOUT')
}

function safeOperationReceipt(operationIndex, durationMs, costUsd) {
  return {
    ok: true,
    request_id: `simulated-${operationIndex + 1}`,
    status_code: 200,
    duration_ms: durationMs,
    retry_count: 0,
    cost_usd: costUsd,
  }
}

function attachCleanupStatus(error, status) {
  const safeError = error instanceof CanaryGateError ? error : new CanaryGateError('CANARY_OPERATION_FAILED')
  safeError.cleanup_status = status
  return safeError
}

async function simulateAuthorizedPlan({
  mode,
  plan,
  authorization,
  operationTimeoutMs,
  totalTimeoutMs,
  simulationProfile,
}) {
  const profile = validateSimulationProfile(simulationProfile)
  const evidence = []
  let spendUsd = 0
  let executionFailure = null
  const startedAt = Date.now()
  const totalBudgetMs = Math.min(
    Number.isFinite(totalTimeoutMs) && totalTimeoutMs > 0 ? totalTimeoutMs : authorization.limits.max_duration_seconds * 1000,
    authorization.limits.max_duration_seconds * 1000,
  )
  const finalDeadline = startedAt + totalBudgetMs
  const cleanupReserveMs = Math.min(Math.max(5, Math.floor(totalBudgetMs * 0.1)), Math.max(1, totalBudgetMs - 1))
  const operationDeadline = finalDeadline - cleanupReserveMs

  try {
    for (const [operationIndex, item] of plan.operations.entries()) {
      const operationStartedAt = Date.now()
      const operationLimitMs = Number.isFinite(operationTimeoutMs) && operationTimeoutMs > 0 ? operationTimeoutMs : 30_000
      const deadline = Math.min(operationDeadline, operationStartedAt + operationLimitMs)
      await delayBeforeDeadline(profile.operation_delay_ms, deadline)
      if (profile.fail_operation_index === operationIndex) throw new CanaryGateError('CANARY_OPERATION_FAILED')
      const receipt = safeOperationReceipt(operationIndex, Date.now() - operationStartedAt, profile.operation_cost_usd)
      spendUsd = Number((spendUsd + receipt.cost_usd).toFixed(6))
      if (spendUsd > authorization.max_budget_usd) throw new CanaryGateError('CANARY_BUDGET_EXCEEDED')
      evidence.push({ operation: item.kind, result: receipt })
    }
  } catch (error) {
    executionFailure = error instanceof CanaryGateError ? error : new CanaryGateError('CANARY_OPERATION_FAILED')
  }

  let cleanup
  try {
    await delayBeforeDeadline(profile.cleanup_delay_ms, finalDeadline)
    cleanup = {
      ok: profile.cleanup_residual_resources === 0,
      residual_resources: profile.cleanup_residual_resources,
      inventory_verified: true,
      exact_resource_ids_only: true,
    }
    if (Date.now() >= finalDeadline) throw new CanaryGateError('CANARY_TIMEOUT')
  } catch (error) {
    throw attachCleanupStatus(error instanceof CanaryGateError ? error : new CanaryGateError('CANARY_CLEANUP_FAILED'), 'TIMEOUT')
  }
  if (!cleanup.ok || cleanup.residual_resources !== 0) {
    throw attachCleanupStatus(new CanaryGateError('CANARY_CLEANUP_FAILED'), 'FAILED')
  }
  if (executionFailure) throw attachCleanupStatus(executionFailure, 'PASS')
  if (Date.now() >= finalDeadline) throw attachCleanupStatus(new CanaryGateError('CANARY_TIMEOUT'), 'TIMEOUT')

  const status = mode === CANARY_MODES.PRIVATE_MEDIA_E2E ? 'SIMULATED_PRIVATE_MEDIA_E2E_PASS' : 'SIMULATED_PROVIDER_COMPONENT_PASS'
  return {
    status,
    authorization_id: authorization.authorization_id,
    operation_count: evidence.length,
    spend_usd: spendUsd,
    evidence,
    cleanup,
    real_provider: false,
    executor: 'INTERNAL_DETERMINISTIC_SIMULATOR',
  }
}

export async function runSyntheticProviderCanary({
  mode = CANARY_MODES.DRY_RUN,
  candidate,
  authorization,
  externalExecutor,
  simulateAuthorizedPlan: shouldSimulateAuthorizedPlan = false,
  simulationProfile,
  now = new Date(),
  operationTimeoutMs,
  totalTimeoutMs,
} = {}) {
  const plan = buildCanaryPlan(mode)
  const fixtures = syntheticFixtures()
  const policy = preparePolicyApprovalPackage(candidate)
  const localContracts = runLocalContracts()
  if (mode === CANARY_MODES.DRY_RUN) {
    return redactCanaryEvidence({
      schema_version: 'nelyon.creator_premium_provider_canary_result.v1',
      mode,
      status: 'DRY_RUN_PASS',
      readiness: {
        POLICY_PREPARED: 'PASS',
        CANARY_DRY_RUN: 'PASS',
        REAL_PROVIDER_COMPONENT: 'PENDING',
        PREMIUM_PRIVATE_MEDIA_E2E: 'PENDING',
        PRODUCTION_ACTIVATION: 'NOT_AUTHORIZED',
      },
      external: { network_requests: 0, remote_uploads: 0, provider_inferences: 0, spend_usd: 0 },
      fixtures,
      plan,
      local_contracts: localContracts,
      policy,
    })
  }
  const validatedAuthorization = validateExternalAuthorization({ mode, authorization, policyPackage: policy, now })
  if (externalExecutor !== undefined) throw new CanaryGateError('CALLER_SUPPLIED_EXECUTOR_FORBIDDEN')
  if (shouldSimulateAuthorizedPlan !== true) throw new CanaryGateError('REAL_PROVIDER_EXECUTOR_NOT_IMPLEMENTED')
  const execution = await simulateAuthorizedPlan({
    mode,
    plan,
    authorization: validatedAuthorization,
    operationTimeoutMs,
    totalTimeoutMs,
    simulationProfile,
  })
  return redactCanaryEvidence({
    schema_version: 'nelyon.creator_premium_provider_canary_result.v1',
    mode,
    status: execution.status,
    external: {
      network_requests: 0,
      simulated_requests: execution.operation_count,
      provider_inferences: 0,
      spend_usd: execution.spend_usd,
    },
    fixtures,
    plan,
    local_contracts: localContracts,
    policy,
    execution,
  })
}

function argumentValue(args, name) {
  const inline = args.find(value => value.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

async function main() {
  const args = process.argv.slice(2)
  const mode = argumentValue(args, '--mode') ?? CANARY_MODES.DRY_RUN
  const authorizationPath = argumentValue(args, '--authorization-file')
  const scriptDirectory = dirname(fileURLToPath(import.meta.url))
  const candidate = JSON.parse(readFileSync(join(scriptDirectory, '..', 'docs', 'creator-premium-content-safety-policy-candidate-v1.json'), 'utf8'))
  let authorization
  if (authorizationPath) authorization = JSON.parse(readFileSync(resolve(authorizationPath), 'utf8'))
  try {
    const result = await runSyntheticProviderCanary({ mode, candidate, authorization })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    const code = error instanceof CanaryGateError ? error.code : 'CANARY_UNEXPECTED_FAILURE'
    process.stderr.write(`${JSON.stringify({ mode, status: mode === CANARY_MODES.DRY_RUN ? 'DRY_RUN_FAIL' : code, error: code })}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main()
