import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'

import { makeProbeWav, WHISPER_MODEL } from '../supabase/functions/content-safety-scan/audioPipeline.mjs'
import { VISUAL_MODEL, VISUAL_TOOL_NAME } from '../supabase/functions/content-safety-scan/visualProbe.mjs'
import {
  CloudflareProviderAdapterError,
  buildWorkersAiEndpoint,
  createCloudflareWorkersAiAdapter,
  providerAdapterArtifactFingerprint,
  validateNonProductionPreflight,
} from '../scripts/creator-premium-provider-adapter.mjs'

const ACCOUNT_ID = '0123456789abcdef0123456789abcdef'
const TOKEN = 'synthetic-test-token-not-a-secret'
const PRODUCTION_SUPABASE = 'aewwdlvbwpczqyvkwvvj'

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function validVisualEnvelope(overrides = {}) {
  return {
    success: true,
    result: {
      choices: [{
        index: 0,
        finish_reason: 'tool_calls',
        message: { role: 'assistant', content: null, refusal: null, tool_calls: [{
          id: 'call_visual_1', type: 'function', function: { name: VISUAL_TOOL_NAME, arguments: JSON.stringify({
            objects: [
              { shape: 'square', color: 'red' },
              { shape: 'circle', color: 'blue' },
            ],
          }) },
        }] },
      }],
      usage: { prompt_tokens: 40, completion_tokens: 15, total_tokens: 55 },
      ...overrides,
    },
  }
}

function validAudioEnvelope(overrides = {}) {
  return {
    success: true,
    result: {
      transcription_info: { text: 'Hola mundo', language: 'es', word_count: 2 },
      segments: [{ start: 0, end: 0.7, text: 'Hola mundo' }],
      ...overrides,
    },
  }
}

function recordingFetch(responseFactory) {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options })
    return typeof responseFactory === 'function' ? responseFactory(url, options, calls.length) : responseFactory
  }
  return { calls, fetchImpl }
}

function adapter(fetchImpl, overrides = {}) {
  return createCloudflareWorkersAiAdapter({
    accountId: ACCOUNT_ID,
    token: TOKEN,
    fetchImpl,
    timeoutMs: 100,
    maxResponseBytes: 32_000,
    ...overrides,
  })
}

async function rejectsCode(promise, code) {
  await assert.rejects(
    promise,
    error => error instanceof CloudflareProviderAdapterError && error.code === code,
    code,
  )
}

test('visual adapter uses the exact Cloudflare endpoint, request contract, and sanitized receipt', async () => {
  const transport = recordingFetch(jsonResponse(validVisualEnvelope(), { headers: { 'cf-ray': '1234abcd-EWR' } }))
  const result = await adapter(transport.fetchImpl).runVisualProbe()

  assert.equal(transport.calls.length, 1)
  const call = transport.calls[0]
  assert.equal(call.url, buildWorkersAiEndpoint({ accountId: ACCOUNT_ID, model: VISUAL_MODEL }))
  assert.equal(call.options.method, 'POST')
  assert.equal(call.options.redirect, 'manual')
  assert.equal(call.options.headers.Authorization, `Bearer ${TOKEN}`)
  assert.equal(call.options.headers['Content-Type'], 'application/json')
  const body = JSON.parse(call.options.body)
  assert.equal(body.tools[0].function.name, VISUAL_TOOL_NAME)
  assert.equal(body.tools[0].function.strict, true)
  assert.equal(body.parallel_tool_calls, false)
  assert.match(body.messages[1].content[1].image_url.url, /^data:image\/png;base64,/u)
  assert.deepEqual(result.validation, { visionInput: true, structuredOutput: true, schemaValid: true })
  assert.deepEqual(result.receipt.usage, { input_tokens: 40, output_tokens: 15, total_tokens: 55 })
  assert.equal(result.receipt.request_correlation_id, '1234abcd-EWR')
  assert.equal(result.receipt.retry_count, 0)
  assert.equal(result.receipt.estimated_cost_usd, null)
  assert.equal(result.receipt.cost_bound_status, 'UNVERIFIED')
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN, 'u'))
  assert.equal(Object.hasOwn(result, 'raw_response'), false)
})

test('provider usage does not turn explicit null telemetry into a fabricated zero', async () => {
  const transport = recordingFetch(jsonResponse(validVisualEnvelope({
    usage: { prompt_tokens: null, completion_tokens: null, total_tokens: null },
  })))
  const result = await adapter(transport.fetchImpl).runVisualProbe()

  assert.deepEqual(result.receipt.usage, {
    input_tokens: null,
    output_tokens: null,
    total_tokens: null,
  })
})

test('visual adapter rejects invalid schema, auth failures, throttling, server errors, and oversized responses', async () => {
  await rejectsCode(
    adapter(recordingFetch(jsonResponse(validVisualEnvelope({ response: '{"objects":[]}' }))).fetchImpl).runVisualProbe(),
    'PROVIDER_VISUAL_RESPONSE_INVALID',
  )
  for (const [status, code] of [
    [401, 'PROVIDER_UNAUTHORIZED'],
    [403, 'PROVIDER_FORBIDDEN'],
    [429, 'PROVIDER_RATE_LIMITED'],
    [500, 'PROVIDER_TEMPORARILY_UNAVAILABLE'],
  ]) {
    await rejectsCode(
      adapter(recordingFetch(jsonResponse({ success: false, errors: [{ message: TOKEN }] }, { status })).fetchImpl).runVisualProbe(),
      code,
    )
  }
  const oversized = jsonResponse({ success: true, result: { response: 'x'.repeat(1000) } })
  await rejectsCode(
    adapter(recordingFetch(oversized).fetchImpl, { maxResponseBytes: 100 }).runVisualProbe(),
    'PROVIDER_RESPONSE_TOO_LARGE',
  )
  await rejectsCode(
    adapter(recordingFetch(new Response('{"success":true}', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })).fetchImpl).runVisualProbe(),
    'PROVIDER_CONTENT_TYPE_INVALID',
  )
})

test('transport rejects redirects and never follows an alternate host', async () => {
  const transport = recordingFetch(new Response(null, {
    status: 302,
    headers: { location: 'https://evil.invalid/steal' },
  }))
  await rejectsCode(adapter(transport.fetchImpl).runVisualProbe(), 'PROVIDER_REDIRECT_REJECTED')
  assert.equal(transport.calls.length, 1)
  assert.equal(transport.calls[0].options.redirect, 'manual')
  assert.doesNotMatch(transport.calls[0].url, /evil/u)
})

test('transport enforces timeout with cancellation and reports no secret', async () => {
  const hangingFetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  let failure
  try {
    await adapter(hangingFetch, { timeoutMs: 5 }).runVisualProbe()
  } catch (error) {
    failure = error
  }
  assert.ok(failure instanceof CloudflareProviderAdapterError)
  assert.equal(failure.code, 'PROVIDER_TIMEOUT')
  assert.doesNotMatch(JSON.stringify(failure), new RegExp(TOKEN, 'u'))
  assert.doesNotMatch(failure.message, new RegExp(TOKEN, 'u'))
})

test('transport timeout also covers a response body that never completes', async () => {
  let cancelled = false
  const response = new Response(new ReadableStream({
    pull() {},
    cancel() { cancelled = true },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
  await rejectsCode(
    adapter(async () => response, { timeoutMs: 5 }).runVisualProbe(),
    'PROVIDER_TIMEOUT',
  )
  assert.equal(cancelled, true)
})

test('audio adapter sends the canonical Whisper body and normalizes language, text, segments, and timecodes', async () => {
  const transport = recordingFetch(jsonResponse(validAudioEnvelope(), { headers: { 'cf-ray': 'audio-ray-EWR' } }))
  const wav = makeProbeWav()
  const result = await adapter(transport.fetchImpl).runAudioProbe({ audioBytes: wav })

  assert.equal(transport.calls.length, 1)
  const call = transport.calls[0]
  assert.equal(call.url, buildWorkersAiEndpoint({ accountId: ACCOUNT_ID, model: WHISPER_MODEL }))
  assert.equal(call.options.method, 'POST')
  assert.equal(call.options.redirect, 'manual')
  const body = JSON.parse(call.options.body)
  assert.equal(body.task, 'transcribe')
  assert.equal(body.vad_filter, true)
  assert.equal(Buffer.from(body.audio, 'base64').byteLength, wav.byteLength)
  assert.deepEqual(result.transcript, {
    text: 'Hola mundo',
    wordCount: 2,
    segments: [{ start: 0, end: 0.7, text: 'Hola mundo' }],
    detectedLanguage: 'es',
    noSpeech: false,
  })
  assert.equal(result.receipt.request_correlation_id, 'audio-ray-EWR')
  assert.doesNotMatch(JSON.stringify(result.receipt), /Hola mundo/u)
})

test('audio adapter treats silence as a transcript result, not a safety pass', async () => {
  const transport = recordingFetch(jsonResponse(validAudioEnvelope({
    transcription_info: { text: '', language: null, word_count: 0 },
    segments: [],
  })))
  const result = await adapter(transport.fetchImpl).runAudioProbe({ audioBytes: makeProbeWav() })
  assert.equal(result.transcript.noSpeech, true)
  assert.equal(result.transcript.text, '')
  assert.equal(result.safety_conclusion, 'NOT_EVALUATED')
})

test('audio adapter fails closed for malformed JSON, malformed envelopes, provider errors, and byte limits', async () => {
  await rejectsCode(
    adapter(recordingFetch(new Response('{', { status: 200, headers: { 'content-type': 'application/json' } })).fetchImpl).runAudioProbe({ audioBytes: makeProbeWav() }),
    'PROVIDER_RESPONSE_MALFORMED',
  )
  await rejectsCode(
    adapter(recordingFetch(jsonResponse({ success: true, result: null })).fetchImpl).runAudioProbe({ audioBytes: makeProbeWav() }),
    'PROVIDER_AUDIO_RESPONSE_INVALID',
  )
  await rejectsCode(
    adapter(recordingFetch(jsonResponse({ success: true, result: {} })).fetchImpl).runAudioProbe({ audioBytes: makeProbeWav() }),
    'PROVIDER_AUDIO_RESPONSE_INVALID',
  )
  await rejectsCode(
    adapter(recordingFetch(jsonResponse({ success: false }, { status: 503 })).fetchImpl).runAudioProbe({ audioBytes: makeProbeWav() }),
    'PROVIDER_TEMPORARILY_UNAVAILABLE',
  )
  await rejectsCode(
    adapter(recordingFetch(jsonResponse(validAudioEnvelope())).fetchImpl, { maxAudioBytes: 16 }).runAudioProbe({ audioBytes: makeProbeWav() }),
    'PROVIDER_AUDIO_TOO_LARGE',
  )
})

test('endpoint construction rejects unknown models, malformed accounts, and caller-controlled origins', () => {
  assert.equal(
    buildWorkersAiEndpoint({ accountId: ACCOUNT_ID, model: VISUAL_MODEL }),
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${VISUAL_MODEL}`,
  )
  assert.throws(
    () => buildWorkersAiEndpoint({ accountId: '../victim', model: VISUAL_MODEL }),
    error => error instanceof CloudflareProviderAdapterError && error.code === 'PROVIDER_ACCOUNT_ID_INVALID',
  )
  assert.throws(
    () => buildWorkersAiEndpoint({ accountId: ACCOUNT_ID, model: '@cf/attacker/model' }),
    error => error instanceof CloudflareProviderAdapterError && error.code === 'PROVIDER_MODEL_NOT_ALLOWED',
  )
  assert.throws(
    () => createCloudflareWorkersAiAdapter({ accountId: ACCOUNT_ID, token: TOKEN, endpoint: 'https://evil.invalid' }),
    error => error instanceof CloudflareProviderAdapterError && error.code === 'PROVIDER_CONFIGURATION_INVALID',
  )
})

test('non-production preflight never treats aliases or format-only identities as verified evidence', () => {
  const pending = validateNonProductionPreflight({
    cloudflareAccountId: ACCOUNT_ID,
    supabaseProjectRef: 'abcdefghijklmnopqrst',
    productionSupabaseProjectRef: PRODUCTION_SUPABASE,
  })
  assert.equal(pending.cloudflare_identity, 'NONPROD_ACCOUNT_IDENTITY_PENDING')
  assert.equal(pending.supabase_identity, 'NONPROD_SUPABASE_IDENTITY_PENDING')
  assert.equal(pending.owner_authority, 'OWNER_AUTHORITY_UNVERIFIED')
  assert.equal(pending.external_execution, 'NOT_AUTHORIZED')
  assert.match(pending.cloudflare_account_fingerprint, /^[0-9a-f]{64}$/u)
  assert.equal(Object.hasOwn(pending, 'cloudflare_account_id'), false)

  assert.throws(
    () => validateNonProductionPreflight({
      cloudflareAccountId: ACCOUNT_ID,
      supabaseProjectRef: PRODUCTION_SUPABASE,
    }),
    error => error instanceof CloudflareProviderAdapterError && error.code === 'PRODUCTION_SUPABASE_FORBIDDEN',
  )
  assert.throws(
    () => validateNonProductionPreflight({
      cloudflareAccountId: ACCOUNT_ID,
      productionCloudflareAccountId: ACCOUNT_ID,
      supabaseProjectRef: 'abcdefghijklmnopqrst',
      productionSupabaseProjectRef: PRODUCTION_SUPABASE,
    }),
    error => error instanceof CloudflareProviderAdapterError && error.code === 'PRODUCTION_CLOUDFLARE_FORBIDDEN',
  )
  assert.throws(
    () => validateNonProductionPreflight({ supabaseProjectRef: 'nonprod-by-name-only' }),
    error => error instanceof CloudflareProviderAdapterError && error.code === 'NONPROD_SUPABASE_IDENTITY_INVALID',
  )
})

test('adapter artifact fingerprint is deterministic and binds the future authorization package', () => {
  const first = providerAdapterArtifactFingerprint()
  assert.match(first, /^[0-9a-f]{64}$/u)
  assert.equal(first, providerAdapterArtifactFingerprint())
})
