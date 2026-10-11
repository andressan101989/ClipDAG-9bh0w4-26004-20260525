import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  MAX_AUDIO_BYTES,
  WHISPER_MODEL,
  bytesToBase64,
  normalizeWhisperResult,
} from '../supabase/functions/content-safety-scan/audioPipeline.mjs'
import {
  VISUAL_MODEL,
  VisualProbeError,
  runVisualProviderProbe,
} from '../supabase/functions/content-safety-scan/visualProbe.mjs'

export const CLOUDFLARE_API_ORIGIN = 'https://api.cloudflare.com'
export const ALLOWED_WORKERS_AI_MODELS = Object.freeze([VISUAL_MODEL, WHISPER_MODEL])

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_RESPONSE_BYTES = 1_000_000
const PRODUCTION_SUPABASE_PROJECT_REF = 'aewwdlvbwpczqyvkwvvj'
const CLOUDFLARE_ACCOUNT_ID = /^[0-9a-f]{32}$/u
const SUPABASE_PROJECT_REF = /^[a-z0-9]{20}$/u
const SAFE_CF_RAY = /^[A-Za-z0-9-]{1,128}$/u
const ALLOWED_OPTIONS = new Set([
  'accountId',
  'token',
  'fetchImpl',
  'timeoutMs',
  'maxResponseBytes',
  'maxAudioBytes',
])

export class CloudflareProviderAdapterError extends Error {
  constructor(code, { status = 502, retryable = false, providerCalled = false } = {}) {
    super(code)
    this.name = 'CloudflareProviderAdapterError'
    this.code = code
    this.status = status
    this.retryable = retryable
    this.providerCalled = providerCalled
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      status: this.status,
      retryable: this.retryable,
      provider_called: this.providerCalled,
    }
  }
}

function fail(code, options) {
  throw new CloudflareProviderAdapterError(code, options)
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex')
}

export function providerAdapterArtifactFingerprint() {
  return sha256(readFileSync(fileURLToPath(import.meta.url), 'utf8').replace(/\r\n/gu, '\n'))
}

function validateAccountId(value) {
  const accountId = typeof value === 'string' ? value.trim() : ''
  if (!CLOUDFLARE_ACCOUNT_ID.test(accountId)) fail('PROVIDER_ACCOUNT_ID_INVALID', { status: 400 })
  return accountId
}

function validateModel(value) {
  if (!ALLOWED_WORKERS_AI_MODELS.includes(value)) fail('PROVIDER_MODEL_NOT_ALLOWED', { status: 400 })
  return value
}

export function buildWorkersAiEndpoint({ accountId, model }) {
  const canonicalAccountId = validateAccountId(accountId)
  const canonicalModel = validateModel(model)
  return `${CLOUDFLARE_API_ORIGIN}/client/v4/accounts/${canonicalAccountId}/ai/run/${canonicalModel}`
}

function assertExactEndpoint(value, { accountId, model }) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    fail('PROVIDER_ENDPOINT_INVALID', { status: 400 })
  }
  const expected = buildWorkersAiEndpoint({ accountId, model })
  if (parsed.toString() !== expected || parsed.protocol !== 'https:' || parsed.origin !== CLOUDFLARE_API_ORIGIN ||
      parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) {
    fail('PROVIDER_ENDPOINT_INVALID', { status: 400 })
  }
  return expected
}

function boundedInteger(value, fallback, { min = 1, max }) {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('PROVIDER_CONFIGURATION_INVALID', { status: 400 })
  return value
}

function safeCorrelationId(headers) {
  const candidate = headers?.get?.('cf-ray')
  return typeof candidate === 'string' && SAFE_CF_RAY.test(candidate) ? candidate : null
}

function readWithAbort(reader, signal) {
  if (signal.aborted) return Promise.reject(new CloudflareProviderAdapterError('PROVIDER_TIMEOUT', {
    status: 504,
    retryable: true,
    providerCalled: true,
  }))
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new CloudflareProviderAdapterError('PROVIDER_TIMEOUT', {
      status: 504,
      retryable: true,
      providerCalled: true,
    }))
    signal.addEventListener('abort', onAbort, { once: true })
    reader.read().then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

async function readBoundedBytes(response, maxResponseBytes, signal) {
  const declaredLength = Number(response.headers?.get?.('content-length') ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
    try { await response.body?.cancel?.() } catch { /* best-effort response disposal */ }
    fail('PROVIDER_RESPONSE_TOO_LARGE', { status: 502, providerCalled: true })
  }

  if (!response.body || typeof response.body.getReader !== 'function') {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxResponseBytes) fail('PROVIDER_RESPONSE_TOO_LARGE', { status: 502, providerCalled: true })
    return bytes
  }

  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await readWithAbort(reader, signal)
      if (done) break
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
      total += bytes.byteLength
      if (total > maxResponseBytes) {
        try { await reader.cancel() } catch { /* best-effort response disposal */ }
        fail('PROVIDER_RESPONSE_TOO_LARGE', { status: 502, providerCalled: true })
      }
      chunks.push(bytes)
    }
  } catch (error) {
    try { await reader.cancel() } catch { /* best-effort response disposal */ }
    throw error
  } finally {
    try { reader.releaseLock() } catch { /* response already closed */ }
  }
  const combined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return combined
}

function providerStatusError(status) {
  if (status === 401) return new CloudflareProviderAdapterError('PROVIDER_UNAUTHORIZED', { status, providerCalled: true })
  if (status === 403) return new CloudflareProviderAdapterError('PROVIDER_FORBIDDEN', { status, providerCalled: true })
  if (status === 429) return new CloudflareProviderAdapterError('PROVIDER_RATE_LIMITED', { status, retryable: true, providerCalled: true })
  if (status === 400 || status === 404) return new CloudflareProviderAdapterError('PROVIDER_MODEL_UNAVAILABLE', { status, providerCalled: true })
  const retryable = status === 408 || status === 425 || status >= 500
  return new CloudflareProviderAdapterError(
    retryable ? 'PROVIDER_TEMPORARILY_UNAVAILABLE' : 'PROVIDER_REQUEST_REJECTED',
    { status: status || 502, retryable, providerCalled: true },
  )
}

function normalizedUsage(payload) {
  const result = payload?.result && typeof payload.result === 'object' && !Array.isArray(payload.result) ? payload.result : {}
  const source = result.usage && typeof result.usage === 'object' && !Array.isArray(result.usage) ? result.usage : {}
  const read = key => {
    const rawValue = source[key]
    if (typeof rawValue !== 'number' && (typeof rawValue !== 'string' || rawValue.trim() === '')) return null
    const value = Number(rawValue)
    return Number.isFinite(value) && value >= 0 ? value : null
  }
  return {
    input_tokens: read('prompt_tokens') ?? read('input_tokens'),
    output_tokens: read('completion_tokens') ?? read('output_tokens'),
    total_tokens: read('total_tokens'),
  }
}

function sanitizedReceipt({ operation, model, response, payload, durationMs }) {
  return {
    operation,
    model,
    status_code: response.status,
    duration_ms: Math.max(0, Math.round(durationMs)),
    retry_count: 0,
    usage: normalizedUsage(payload),
    request_correlation_id: safeCorrelationId(response.headers),
    validation: 'PASS',
    provider_transport: 'CLOUDFLARE_WORKERS_AI_REST',
    estimated_cost_usd: null,
    cost_bound_status: 'UNVERIFIED',
  }
}

async function strictWorkersAiPost({
  accountId,
  token,
  model,
  body,
  fetchImpl,
  timeoutMs,
  maxResponseBytes,
  operation,
}) {
  const endpoint = assertExactEndpoint(buildWorkersAiEndpoint({ accountId, model }), { accountId, model })
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const startedAt = performance.now()
  let response
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'manual',
      signal: controller.signal,
    })
  } catch {
    clearTimeout(timer)
    if (timedOut || controller.signal.aborted) fail('PROVIDER_TIMEOUT', { status: 504, retryable: true, providerCalled: true })
    fail('PROVIDER_NETWORK_ERROR', { status: 502, retryable: true, providerCalled: true })
  }
  try {
    if (!response || typeof response.status !== 'number' || typeof response.ok !== 'boolean') {
      fail('PROVIDER_RESPONSE_INVALID', { status: 502, providerCalled: true })
    }
    if (response.status >= 300 && response.status < 400) {
      try { await response.body?.cancel?.() } catch { /* best-effort response disposal */ }
      fail('PROVIDER_REDIRECT_REJECTED', { status: response.status, providerCalled: true })
    }
    if (response.ok) {
      const contentType = String(response.headers?.get?.('content-type') ?? '').toLowerCase()
      if (!contentType.startsWith('application/json')) {
        try { await response.body?.cancel?.() } catch { /* best-effort response disposal */ }
        fail('PROVIDER_CONTENT_TYPE_INVALID', { status: 502, providerCalled: true })
      }
    }
    const bytes = await readBoundedBytes(response, maxResponseBytes, controller.signal)
    if (!response.ok) throw providerStatusError(response.status)
    let payload
    try {
      payload = JSON.parse(new TextDecoder().decode(bytes))
    } catch {
      fail('PROVIDER_RESPONSE_MALFORMED', { status: 502, providerCalled: true })
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.success !== true ||
        !payload.result || typeof payload.result !== 'object' || Array.isArray(payload.result)) {
      fail('PROVIDER_ENVELOPE_REJECTED', { status: 502, providerCalled: true })
    }
    const durationMs = performance.now() - startedAt
    const headers = new Headers({ 'content-type': 'application/json' })
    const correlation = safeCorrelationId(response.headers)
    if (correlation) headers.set('cf-ray', correlation)
    return {
      response: new Response(JSON.stringify(payload), { status: response.status, headers }),
      payload,
      receipt: sanitizedReceipt({ operation, model, response, payload, durationMs }),
    }
  } catch (error) {
    if (error instanceof CloudflareProviderAdapterError) throw error
    if (timedOut || controller.signal.aborted) fail('PROVIDER_TIMEOUT', { status: 504, retryable: true, providerCalled: true })
    fail('PROVIDER_RESPONSE_READ_FAILED', { status: 502, retryable: true, providerCalled: true })
  } finally {
    clearTimeout(timer)
  }
}

function mapVisualProbeError(error) {
  if (!(error instanceof VisualProbeError)) return new CloudflareProviderAdapterError('PROVIDER_VISUAL_RESPONSE_INVALID', { providerCalled: true })
  if (error.code === 'visual_workers_ai_unauthorized') return providerStatusError(401)
  if (error.code === 'visual_workers_ai_forbidden') return providerStatusError(403)
  if (error.code === 'visual_workers_ai_temporarily_unavailable') return providerStatusError(error.status)
  if (error.code === 'visual_workers_ai_model_unavailable') return providerStatusError(error.status)
  return new CloudflareProviderAdapterError('PROVIDER_VISUAL_RESPONSE_INVALID', { status: error.status, providerCalled: true })
}

function exactOptionKeys(options) {
  return options && typeof options === 'object' && !Array.isArray(options) &&
    Object.keys(options).every(key => ALLOWED_OPTIONS.has(key))
}

export function createCloudflareWorkersAiAdapter(options = {}) {
  if (!exactOptionKeys(options)) fail('PROVIDER_CONFIGURATION_INVALID', { status: 400 })
  const accountId = validateAccountId(options.accountId)
  const token = typeof options.token === 'string' ? options.token.trim() : ''
  if (!token || token.length > 4096) fail('PROVIDER_CONFIGURATION_INVALID', { status: 400 })
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') fail('PROVIDER_CONFIGURATION_INVALID', { status: 400 })
  const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, { max: 120_000 })
  const maxResponseBytes = boundedInteger(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES, { max: 5_000_000 })
  const maxAudioBytes = boundedInteger(options.maxAudioBytes, MAX_AUDIO_BYTES, { max: MAX_AUDIO_BYTES })

  return Object.freeze({
    async runVisualProbe() {
      let strictFailure = null
      let receipt = null
      const guardedFetch = async (url, requestOptions) => {
        try {
          const expected = buildWorkersAiEndpoint({ accountId, model: VISUAL_MODEL })
          if (url !== expected || requestOptions?.method !== 'POST') fail('PROVIDER_ENDPOINT_INVALID', { status: 400 })
          const result = await strictWorkersAiPost({
            accountId,
            token,
            model: VISUAL_MODEL,
            body: JSON.parse(requestOptions.body),
            fetchImpl,
            timeoutMs,
            maxResponseBytes,
            operation: 'workers_ai_visual_probe',
          })
          receipt = result.receipt
          return result.response
        } catch (error) {
          strictFailure = error instanceof CloudflareProviderAdapterError
            ? error
            : new CloudflareProviderAdapterError('PROVIDER_REQUEST_INVALID', { status: 400 })
          throw strictFailure
        }
      }
      try {
        const validation = await runVisualProviderProbe({ token, accountId, fetchImpl: guardedFetch })
        return { component: 'visual', model: VISUAL_MODEL, validation, receipt }
      } catch (error) {
        if (strictFailure) throw strictFailure
        throw mapVisualProbeError(error)
      }
    },

    async runAudioProbe({ audioBytes } = {}) {
      const bytes = audioBytes instanceof Uint8Array ? audioBytes : null
      if (!bytes || bytes.byteLength === 0) fail('PROVIDER_AUDIO_INVALID', { status: 400 })
      if (bytes.byteLength > maxAudioBytes) fail('PROVIDER_AUDIO_TOO_LARGE', { status: 413 })
      let encodedAudio
      try {
        encodedAudio = bytesToBase64(bytes)
      } catch {
        fail('PROVIDER_AUDIO_ENCODING_FAILED', { status: 422 })
      }
      let result
      try {
        result = await strictWorkersAiPost({
          accountId,
          token,
          model: WHISPER_MODEL,
          body: { audio: encodedAudio, task: 'transcribe', vad_filter: true },
          fetchImpl,
          timeoutMs,
          maxResponseBytes,
          operation: 'workers_ai_audio_probe',
        })
      } catch (error) {
        if (error instanceof CloudflareProviderAdapterError && error.code === 'PROVIDER_ENVELOPE_REJECTED') {
          fail('PROVIDER_AUDIO_RESPONSE_INVALID', { status: error.status, providerCalled: true })
        }
        throw error
      }
      let transcript
      try {
        const source = result.payload.result
        const info = source.transcription_info && typeof source.transcription_info === 'object' && !Array.isArray(source.transcription_info)
          ? source.transcription_info
          : source
        if (typeof info.text !== 'string') fail('PROVIDER_AUDIO_RESPONSE_INVALID', { status: 502, providerCalled: true })
        transcript = normalizeWhisperResult(result.payload)
      } catch {
        fail('PROVIDER_AUDIO_RESPONSE_INVALID', { status: 502, providerCalled: true })
      }
      return {
        component: 'audio',
        model: WHISPER_MODEL,
        transcript,
        safety_conclusion: 'NOT_EVALUATED',
        receipt: result.receipt,
      }
    },
  })
}

export function validateNonProductionPreflight({
  cloudflareAccountId,
  supabaseProjectRef,
  productionCloudflareAccountId,
  productionSupabaseProjectRef = PRODUCTION_SUPABASE_PROJECT_REF,
} = {}) {
  const cloudflareId = cloudflareAccountId === undefined ? null : validateAccountId(cloudflareAccountId)
  const productionCloudflareId = productionCloudflareAccountId === undefined
    ? null
    : validateAccountId(productionCloudflareAccountId)
  const supabaseRef = supabaseProjectRef === undefined
    ? null
    : typeof supabaseProjectRef === 'string' && SUPABASE_PROJECT_REF.test(supabaseProjectRef.trim())
      ? supabaseProjectRef.trim()
      : fail('NONPROD_SUPABASE_IDENTITY_INVALID', { status: 400 })
  const productionSupabaseRef = typeof productionSupabaseProjectRef === 'string' && SUPABASE_PROJECT_REF.test(productionSupabaseProjectRef.trim())
    ? productionSupabaseProjectRef.trim()
    : null

  if (cloudflareId && productionCloudflareId && cloudflareId === productionCloudflareId) {
    fail('PRODUCTION_CLOUDFLARE_FORBIDDEN', { status: 403 })
  }
  if (supabaseRef && productionSupabaseRef && supabaseRef === productionSupabaseRef) {
    fail('PRODUCTION_SUPABASE_FORBIDDEN', { status: 403 })
  }

  return {
    local_transport_contract: 'LOCAL_TRANSPORT_CONTRACT_PASS',
    cloudflare_identity: 'NONPROD_ACCOUNT_IDENTITY_PENDING',
    supabase_identity: 'NONPROD_SUPABASE_IDENTITY_PENDING',
    owner_authority: 'OWNER_AUTHORITY_UNVERIFIED',
    external_execution: 'NOT_AUTHORIZED',
    models: [...ALLOWED_WORKERS_AI_MODELS],
    cloudflare_account_fingerprint: cloudflareId ? sha256(`cloudflare-account:${cloudflareId}`) : null,
    supabase_project_fingerprint: supabaseRef ? sha256(`supabase-project:${supabaseRef}`) : null,
    provider_queries_performed: 0,
    external_requests_performed: 0,
  }
}
