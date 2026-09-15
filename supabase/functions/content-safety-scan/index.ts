/* eslint-disable import/no-unresolved */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { evaluateTextRules } from './ruleEngine.mjs'
import { AudioPipelineError, MAX_AUDIO_BYTES, WHISPER_MODEL, bytesToBase64, makeProbeWav, normalizeWhisperResult, timecodeForMatch, validateStreamAudioUrl } from './audioPipeline.mjs'
import { VISUAL_AI_PROVIDER, VISUAL_MODEL, VisualProbeError, runVisualProviderProbe } from './visualProbe.mjs'
import { streamAccountId, streamCustomerCode, streamFetch } from '../_shared/stream.ts'

const BATCH_LIMIT = 25
const TRANSCRIPT_BATCH_LIMIT = 10
const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

function secretsEqual(actual: string, expected: string) {
  const left = new TextEncoder().encode(actual)
  const right = new TextEncoder().encode(expected)
  const length = Math.max(left.length, right.length)
  let difference = left.length ^ right.length
  for (let index = 0; index < length; index += 1) difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  return difference === 0
}

const uuid = (value: unknown): value is string => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function workersAi(audio: Uint8Array) {
  const token = Deno.env.get('CLOUDFLARE_AI_TOKEN')?.trim()
  if (!token) throw new AudioPipelineError('workers_ai_configuration_missing', { status: 503 })
  let encodedAudio: string
  try { encodedAudio = bytesToBase64(audio) } catch { throw new AudioPipelineError('workers_ai_payload_encoding_failed') }
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${streamAccountId()}/ai/run/${WHISPER_MODEL}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio: encodedAudio, task: 'transcribe', vad_filter: true }),
  }).catch(() => { throw new AudioPipelineError('workers_ai_network_error', { retryable: true, providerCalled: true }) })
  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500
    const code = response.status === 401 ? 'workers_ai_unauthorized' : response.status === 403 ? 'workers_ai_forbidden' :
      response.status === 404 || response.status === 400 ? 'workers_ai_model_unavailable' : retryable ? 'workers_ai_temporarily_unavailable' : 'workers_ai_rejected'
    throw new AudioPipelineError(code, { status: response.status, retryable, providerCalled: true })
  }
  const payload = await response.json().catch(() => null)
  return normalizeWhisperResult(payload)
}

async function streamAudioDownload(uid: string) {
  let downloads = object((await streamFetch(`/${uid}/downloads`, { method: 'GET' })).result)
  let audio = object(downloads.audio)
  if (!audio.status) {
    downloads = object((await streamFetch(`/${uid}/downloads/audio`, { method: 'POST' })).result)
    audio = object(downloads.audio)
  }
  const status = String(audio.status ?? '')
  if (status === 'inprogress') throw new AudioPipelineError('stream_audio_inprogress', { status: 425, retryable: true })
  if (status !== 'ready' || typeof audio.url !== 'string') throw new AudioPipelineError('stream_audio_generation_failed')
  let current = validateStreamAudioUrl(audio.url, uid, streamCustomerCode())
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const response = await fetch(current, { redirect: 'manual' }).catch(() => { throw new AudioPipelineError('stream_audio_network_error', { retryable: true }) })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location || redirect === 3) throw new AudioPipelineError('stream_audio_redirect_rejected')
      current = validateStreamAudioUrl(new URL(location, current).toString(), uid, streamCustomerCode())
      continue
    }
    if (!response.ok) throw new AudioPipelineError(response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500 ? 'stream_audio_temporarily_unavailable' : 'stream_audio_fetch_rejected', { status: response.status, retryable: response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500 })
    const declared = Number(response.headers.get('content-length') ?? 0)
    if (declared > MAX_AUDIO_BYTES) throw new AudioPipelineError('stream_audio_too_large')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) throw new AudioPipelineError('stream_audio_too_large')
    return bytes
  }
  throw new AudioPipelineError('stream_audio_redirect_rejected')
}

async function deleteStreamAudio(uid: string) {
  try { await streamFetch(`/${uid}/downloads/audio`, { method: 'DELETE' }); return true } catch (error) {
    return error && typeof error === 'object' && 'code' in error && error.code === 'stream_not_found'
  }
}

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ success: false, error: 'method_not_allowed' }, 405)
  if (!req.headers.get('Authorization')?.startsWith('Bearer ') || !req.headers.get('apikey')) {
    return json({ success: false, error: 'missing_authorization' }, 401)
  }
  const expectedSecret = Deno.env.get('CALL_DISPATCH_SECRET') ?? ''
  const suppliedSecret = req.headers.get('x-content-safety-secret') ?? ''
  if (!expectedSecret || !suppliedSecret || !secretsEqual(suppliedSecret, expectedSecret)) {
    return json({ success: false, error: 'invalid_dispatch_authorization' }, 401)
  }
  const body = object(await req.json().catch(() => ({})))
  if (body.action === 'visual_provider_probe') {
    try {
      const result = await runVisualProviderProbe({ token: Deno.env.get('CLOUDFLARE_AI_TOKEN')?.trim(), accountId: streamAccountId() })
      return json({ success: true, action: 'visual_provider_probe', configured: true, provider: VISUAL_AI_PROVIDER, model: VISUAL_MODEL,
        vision_input: result.visionInput, structured_output: result.structuredOutput, schema_valid: result.schemaValid, error: null })
    } catch (error) {
      const issue = error instanceof VisualProbeError ? error : new VisualProbeError('visual_workers_ai_probe_failed')
      return json({ success: false, action: 'visual_provider_probe', configured: issue.code !== 'visual_workers_ai_configuration_missing',
        provider: VISUAL_AI_PROVIDER, model: VISUAL_MODEL, vision_input: false, structured_output: false, schema_valid: false, error: issue.code }, issue.status)
    }
  }
  if (body.action === 'provider_probe') {
    try {
      await workersAi(makeProbeWav())
      return json({ success: true, action: 'provider_probe', configured: true, provider: 'Cloudflare Workers AI', model: WHISPER_MODEL })
    } catch (error) {
      const issue = error instanceof AudioPipelineError ? error : new AudioPipelineError('workers_ai_probe_failed')
      return json({ success: false, action: 'provider_probe', configured: issue.code !== 'workers_ai_configuration_missing', provider: 'Cloudflare Workers AI', model: WHISPER_MODEL, error: issue.code }, issue.status)
    }
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return json({ success: false, error: 'server_configuration_unavailable' }, 503)
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: rulesData, error: rulesError } = await admin.rpc('get_content_safety_worker_rules')
  if (rulesError || !Array.isArray(rulesData)) return json({ success: false, error: 'rule_load_failed' }, 500)
  const { data: scansData, error: scansError } = await admin.rpc('claim_content_safety_scans', { p_limit: BATCH_LIMIT })
  if (scansError || !Array.isArray(scansData)) return json({ success: false, error: 'scan_claim_failed' }, 500)
  let completed = 0
  let retried = 0
  let failed = 0
  let alerts = 0
  for (const value of scansData) {
    const scan = value && typeof value === 'object' ? value as Record<string, unknown> : null
    if (!scan || !uuid(scan.id) || typeof scan.scope !== 'string' || typeof scan.text !== 'string') {
      if (scan && uuid(scan.id)) {
        await admin.rpc('fail_content_safety_scan', { p_scan_id: scan.id, p_error_code: 'malformed_scan', p_retryable: false })
      }
      failed += 1
      continue
    }
    try {
      const matches = evaluateTextRules({ text: scan.text, scope: scan.scope }, rulesData)
      const { data, error } = await admin.rpc('complete_content_safety_scan', { p_scan_id: scan.id, p_matches: matches })
      if (error) throw new Error('complete_failed')
      const receipt = data && typeof data === 'object' ? data as Record<string, unknown> : {}
      alerts += typeof receipt.alerts_processed === 'number' ? receipt.alerts_processed : 0
      completed += 1
    } catch {
      const { data } = await admin.rpc('fail_content_safety_scan', {
        p_scan_id: scan.id,
        p_error_code: 'worker_processing_error',
        p_retryable: true,
      })
      const receipt = data && typeof data === 'object' ? data as Record<string, unknown> : {}
      if (receipt.status === 'queued') retried += 1
      else failed += 1
    }
  }
  let cleanupCompleted = 0
  const { data: cleanupData } = await admin.rpc('claim_content_safety_audio_cleanup', { p_limit: 1 })
  for (const value of Array.isArray(cleanupData) ? cleanupData : []) {
    const cleanup = object(value)
    if (uuid(cleanup.scan_id) && typeof cleanup.cloudflare_uid === 'string' && await deleteStreamAudio(cleanup.cloudflare_uid)) {
      const { error } = await admin.rpc('complete_content_safety_audio_cleanup', { p_scan_id: cleanup.scan_id })
      if (!error) cleanupCompleted += 1
    }
  }

  let audioClaimed = 0, audioAnalyzed = 0, audioRetried = 0, audioFailed = 0
  const { data: audioData, error: audioClaimError } = await admin.rpc('claim_content_safety_audio_scans', { p_limit: 1 })
  if (!audioClaimError) for (const value of Array.isArray(audioData) ? audioData : []) {
    const scan = object(value); audioClaimed += 1
    if (!uuid(scan.scan_id) || !uuid(scan.source_asset_id) || typeof scan.cloudflare_uid !== 'string' || typeof scan.content_fingerprint !== 'string') { audioFailed += 1; continue }
    let stage = 'stream_audio'
    try {
      const audio = await streamAudioDownload(scan.cloudflare_uid)
      stage = 'workers_ai'
      const result = await workersAi(audio)
      stage = 'transcript_persistence'
      const fingerprint = await sha256(`${result.text}|${JSON.stringify(result.segments)}|${WHISPER_MODEL}`)
      const { error } = await admin.rpc('complete_content_safety_audio_transcription', {
        p_scan_id: scan.scan_id, p_source_asset_id: scan.source_asset_id, p_content_fingerprint: scan.content_fingerprint,
        p_detected_language: result.detectedLanguage, p_transcript_text: result.text, p_word_count: result.wordCount,
        p_segments: result.segments, p_no_speech: result.noSpeech, p_transcript_fingerprint: fingerprint, p_cleanup_pending: true,
      })
      if (error) throw new AudioPipelineError('audio_completion_failed', { retryable: true, providerCalled: true })
      if (await deleteStreamAudio(scan.cloudflare_uid)) {
        await admin.rpc('complete_content_safety_audio_cleanup', { p_scan_id: scan.scan_id })
      }
      audioAnalyzed += 1
    } catch (error) {
      const issue = error instanceof AudioPipelineError ? error : new AudioPipelineError(`${stage}_unexpected`, { retryable: true })
      const { data } = await admin.rpc('fail_content_safety_audio_scan', { p_scan_id: scan.scan_id, p_error_code: issue.code, p_retryable: issue.retryable, p_provider_called: issue.providerCalled })
      if (object(data).audio_status === 'pending') audioRetried += 1
      else audioFailed += 1
    }
  }

  let transcriptEvaluated = 0, transcriptAlerts = 0
  const { data: transcriptData } = await admin.rpc('claim_content_safety_transcript_evaluations', { p_limit: TRANSCRIPT_BATCH_LIMIT })
  for (const value of Array.isArray(transcriptData) ? transcriptData : []) {
    const transcript = object(value)
    if (!uuid(transcript.transcript_id) || typeof transcript.text !== 'string' || typeof transcript.ruleset_fingerprint !== 'string') continue
    try {
      const matches = evaluateTextRules({ text: transcript.text, scope: 'transcript' }, rulesData).map(match => timecodeForMatch(match, transcript.segments))
      const { data, error } = await admin.rpc('complete_content_safety_transcript_evaluation', { p_transcript_id: transcript.transcript_id, p_ruleset_fingerprint: transcript.ruleset_fingerprint, p_matches: matches })
      if (error) throw new Error('transcript_completion_failed')
      transcriptAlerts += Number(object(data).alerts_processed ?? 0); transcriptEvaluated += 1
    } catch {
      await admin.rpc('fail_content_safety_transcript_evaluation', { p_transcript_id: transcript.transcript_id, p_error_code: 'transcript_evaluation_failed', p_retryable: true })
    }
  }
  return json({ success: true, claimed: scansData.length, completed, retried, failed, alerts, external_providers: audioClaimed,
    audio: { claimed: audioClaimed, analyzed: audioAnalyzed, retried: audioRetried, failed: audioFailed, cleanup_completed: cleanupCompleted },
    transcripts: { evaluated: transcriptEvaluated, alerts: transcriptAlerts } })
})
