/* eslint-disable import/no-unresolved */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.1'
import { evaluateTextRules } from './ruleEngine.mjs'
import { AudioPipelineError, WHISPER_MODEL, bytesToBase64, downloadStreamAudioBytes, loadStreamAudioDescriptor, makeProbeWav, normalizeWhisperResult, selectStreamAudioDownloadRoute, timecodeForMatch, validateStreamAudioTargetType } from './audioPipeline.mjs'
import { VISUAL_AI_PROVIDER, VISUAL_MODEL, VisualProbeError, runVisualMultiImageProviderProbe, runVisualProviderProbe } from './visualProbe.mjs'
import { CREATOR_PREMIUM_VISUAL_PROMPT_VERSION, MAX_PREMIUM_VISUAL_IMAGE_BYTES, MAX_VISUAL_IMAGE_BYTES, VISUAL_PROMPT_VERSION, VisualPipelineError, analyzeVisualBytes, fetchStreamFrame, mergeVisualFrameResults, sampleVideoFrameTimestamps } from './visualPipeline.mjs'
import { POLICY_CONTEXT_POLICY_ID, POLICY_CONTEXT_PROMPT_VERSION, POLICY_CONTEXT_SCHEMA_VERSION, PolicyContextError, policyContextCompletionError, policyContextErrorFrom, runPolicyContextAnalysis, runPolicyContextProviderProbe } from './policyContext.mjs'
import { streamAccountId, streamCustomerCode, streamFetch } from '../_shared/stream.ts'
import {
  STORY_STREAM_PURPOSE,
  createPrivateStreamAudioDownloadGrant,
  createPrivateStreamPlaybackGrant,
} from '../_shared/premiumStreamSecurity.ts'
import { getObjectBytes, isR2Transient } from '../_shared/r2.ts'

const BATCH_LIMIT = 25
const TRANSCRIPT_BATCH_LIMIT = 10
const WORKER_CONTRACT = 'content-safety-scan-p3-v1'
const CONTENT_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/u
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

function jwtRole(token: string) {
  try {
    const payload = token.split('.')[1]
    if (!payload) return ''
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '='))
    const value = JSON.parse(decoded)
    return typeof value?.role === 'string' ? value.role : ''
  } catch { return '' }
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

async function streamAudioDownload(uid: string, targetType: unknown) {
  const canonicalTargetType = validateStreamAudioTargetType(targetType)
  const audio = await loadStreamAudioDescriptor({ uid, streamFetchImpl: streamFetch })
  const route = await selectStreamAudioDownloadRoute({
    targetType: canonicalTargetType,
    uid,
    customerCode: streamCustomerCode(),
    providerUrl: audio.url,
    createPrivateGrant: createPrivateStreamAudioDownloadGrant,
  })
  return downloadStreamAudioBytes({ route })
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
  const body = object(await req.json().catch(() => ({})))
  const expectedSecret = Deno.env.get('CALL_DISPATCH_SECRET') ?? ''
  const suppliedSecret = req.headers.get('x-content-safety-secret') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const bearer = req.headers.get('Authorization')?.slice('Bearer '.length) ?? ''
  const apiKey = req.headers.get('apikey') ?? ''
  const dispatchAuthorized = Boolean(expectedSecret && suppliedSecret && secretsEqual(suppliedSecret, expectedSecret))
  const serviceProbeAuthorized = ['visual_provider_probe', 'visual_multi_image_probe', 'provider_probe', 'policy_context_provider_probe'].includes(String(body.action ?? '')) &&
    Boolean((serviceRoleKey && ((bearer && secretsEqual(bearer, serviceRoleKey)) || (apiKey && secretsEqual(apiKey, serviceRoleKey)))) || jwtRole(bearer) === 'service_role')
  const serviceRunAuthorized = body.action === 'run_once' && jwtRole(bearer) === 'service_role'
  if (!dispatchAuthorized && !serviceProbeAuthorized && !serviceRunAuthorized) {
    return json({ success: false, error: 'invalid_dispatch_authorization' }, 401)
  }
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
  if (body.action === 'visual_multi_image_probe') {
    try {
      const result = await runVisualMultiImageProviderProbe({ token: Deno.env.get('CLOUDFLARE_AI_TOKEN')?.trim(), accountId: streamAccountId() })
      return json({ success: true, action: 'visual_multi_image_probe', configured: true, provider: VISUAL_AI_PROVIDER, model: VISUAL_MODEL,
        vision_input: result.visionInput, structured_output: result.structuredOutput, schema_valid: result.schemaValid, multi_image: result.multiImage, error: null })
    } catch (error) {
      const issue = error instanceof VisualProbeError ? error : new VisualProbeError('visual_workers_ai_multi_image_probe_failed')
      return json({ success: false, action: 'visual_multi_image_probe', configured: issue.code !== 'visual_workers_ai_configuration_missing',
        provider: VISUAL_AI_PROVIDER, model: VISUAL_MODEL, vision_input: false, structured_output: false, schema_valid: false, multi_image: false, error: issue.code }, issue.status)
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
  if (body.action === 'policy_context_provider_probe') {
    try {
      const result = await runPolicyContextProviderProbe({ token: Deno.env.get('CLOUDFLARE_AI_TOKEN')?.trim(), accountId: streamAccountId() })
      return json({ success: true, action: 'policy_context_provider_probe', configured: true, provider: VISUAL_AI_PROVIDER,
        model: VISUAL_MODEL, schema_valid: true, cases_valid: result.cases.length, error: null })
    } catch (error) {
      const issue = policyContextErrorFrom(error)
      return json({ success: false, action: 'policy_context_provider_probe',
        configured: issue.code !== 'visual_workers_ai_configuration_missing', provider: VISUAL_AI_PROVIDER,
        model: VISUAL_MODEL, schema_valid: false, cases_valid: 0, error: issue.code }, issue.status)
    }
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
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
    const malformedStoryVideo = scan.target_type === 'story' && (
      (scan.purpose !== undefined && scan.purpose !== STORY_STREAM_PURPOSE) ||
      typeof scan.duration_seconds !== 'number' || scan.duration_seconds <= 0 || scan.duration_seconds > 15
    )
    if (!uuid(scan.scan_id) || !uuid(scan.source_asset_id) || typeof scan.cloudflare_uid !== 'string' ||
        typeof scan.content_fingerprint !== 'string' || !CONTENT_FINGERPRINT_PATTERN.test(scan.content_fingerprint) ||
        malformedStoryVideo) {
      if (uuid(scan.scan_id)) await admin.rpc('fail_content_safety_audio_scan', {
        p_scan_id: scan.scan_id,
        p_error_code: malformedStoryVideo ? 'story_video_incomplete_modality_evidence' : 'malformed_audio_scan',
        p_retryable: false,
        p_provider_called: false,
      })
      audioFailed += 1; continue
    }
    let stage = 'stream_audio'
    try {
      const audio = await streamAudioDownload(scan.cloudflare_uid, scan.target_type)
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
      console.error('audio_processing_failed', {
        code: issue.code,
        retryable: issue.retryable,
        provider_called: issue.providerCalled,
        stage,
        attempt_count: Number(scan.attempt_count ?? 0),
      })
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
      const matches = evaluateTextRules({ text: transcript.text, scope: 'transcript' }, rulesData)
        .map((match: Record<string, unknown>) => timecodeForMatch(match, transcript.segments))
      const { data, error } = await admin.rpc('complete_content_safety_transcript_evaluation', { p_transcript_id: transcript.transcript_id, p_ruleset_fingerprint: transcript.ruleset_fingerprint, p_matches: matches })
      if (error) throw new Error('transcript_completion_failed')
      transcriptAlerts += Number(object(data).alerts_processed ?? 0); transcriptEvaluated += 1
    } catch {
      await admin.rpc('fail_content_safety_transcript_evaluation', { p_transcript_id: transcript.transcript_id, p_error_code: 'transcript_evaluation_failed', p_retryable: true })
    }
  }

  let visualClaimed = 0, visualAnalyzed = 0, visualAdvanced = 0, visualRetried = 0, visualFailed = 0, visualAlerts = 0
  const visualErrors: { scan_id: string; code: string; retryable: boolean; provider_called: boolean }[] = []
  const { data: visualData, error: visualClaimError } = await admin.rpc('claim_content_safety_visual_scans', {
    p_limit: 1,
    p_worker_contract: WORKER_CONTRACT,
  })
  if (!visualClaimError) for (const value of Array.isArray(visualData) ? visualData : []) {
    const scan = object(value); visualClaimed += 1
    const promptVersion = String(scan.visual_prompt_version ?? '')
    const supportedPrompt = promptVersion === VISUAL_PROMPT_VERSION ||
      (scan.target_type === 'creator_premium' && promptVersion === CREATOR_PREMIUM_VISUAL_PROMPT_VERSION)
    const sourceKind = String(scan.source_kind)
    const malformedStorySource = scan.target_type === 'story' && (
      (sourceKind === 'eligible_stream_video' && (
        (scan.purpose !== undefined && scan.purpose !== STORY_STREAM_PURPOSE) ||
        typeof scan.duration_seconds !== 'number' || scan.duration_seconds <= 0 || scan.duration_seconds > 15
      )) ||
      (sourceKind === 'eligible_image' && scan.purpose !== undefined && scan.purpose !== 'story_image')
    )
    if (!uuid(scan.scan_id) || typeof scan.content_fingerprint !== 'string' ||
        !CONTENT_FINGERPRINT_PATTERN.test(scan.content_fingerprint) ||
        !['eligible_image', 'eligible_stream_video'].includes(sourceKind) || !supportedPrompt || malformedStorySource) {
      if (uuid(scan.scan_id)) await admin.rpc('fail_content_safety_visual_scan', { p_scan_id: scan.scan_id, p_error_code: 'malformed_visual_scan', p_retryable: false, p_provider_called: false })
      visualFailed += 1; continue
    }
    let providerCalled = false
    try {
      const frameCursor = Number(scan.frame_cursor ?? 0)
      const isPremium = scan.target_type === 'creator_premium'
      const isStory = scan.target_type === 'story'
      const isPrivateStream = isPremium || isStory
      let bytes: Uint8Array, mimeType: string, timestampMs: number | null = null, timestamps: number[] = []
      if (sourceKind === 'eligible_image') {
        if (!uuid(scan.media_asset_id) || typeof scan.bucket_name !== 'string' || typeof scan.object_key !== 'string' ||
            !['image/jpeg', 'image/png', 'image/webp'].includes(String(scan.mime_type))) throw new VisualPipelineError('invalid_canonical_image_source')
        const imageByteLimit = isPremium ? MAX_PREMIUM_VISUAL_IMAGE_BYTES : MAX_VISUAL_IMAGE_BYTES
        const result = await getObjectBytes(scan.bucket_name, scan.object_key, imageByteLimit).catch(error => {
          const retryable = isR2Transient(error)
          throw new VisualPipelineError(retryable ? 'r2_visual_temporarily_unavailable' : 'r2_visual_fetch_rejected', { retryable })
        })
        mimeType = String(scan.mime_type)
        if (result.contentType && result.contentType.split(';')[0].trim().toLowerCase() !== mimeType) throw new VisualPipelineError('r2_visual_mime_mismatch')
        bytes = result.bytes
      } else {
        if (!uuid(scan.video_asset_id) || typeof scan.cloudflare_uid !== 'string' || typeof scan.duration_seconds !== 'number') throw new VisualPipelineError('invalid_canonical_stream_source')
        timestamps = sampleVideoFrameTimestamps(scan.duration_seconds)
        if (!Number.isInteger(frameCursor) || frameCursor < 0 || frameCursor >= timestamps.length) throw new VisualPipelineError('invalid_visual_frame_cursor')
        timestampMs = timestamps[frameCursor]
        // Both Premium and Story Stream assets are private. Content Safety gets
        // the same bounded provider grant used by playback; no provider UID or
        // signed URL is exposed to the client.
        const signedThumbnailUrl = isPrivateStream
          ? (await createPrivateStreamPlaybackGrant({
              cloudflareUid: scan.cloudflare_uid,
              customerCode: streamCustomerCode(),
            })).thumbnailUrl
          : undefined
        bytes = await fetchStreamFrame({
          uid: scan.cloudflare_uid,
          customerCode: streamCustomerCode(),
          timestampMs,
          signedThumbnailUrl,
        })
        mimeType = 'image/jpeg'
      }
      const finding = await analyzeVisualBytes({ token: Deno.env.get('CLOUDFLARE_AI_TOKEN')?.trim(), accountId: streamAccountId(), bytes, mimeType,
        sourceKind, frameIndex: sourceKind === 'eligible_stream_video' ? frameCursor : null,
        promptVersion: String(scan.visual_prompt_version),
        imageByteLimit: isPremium ? MAX_PREMIUM_VISUAL_IMAGE_BYTES : MAX_VISUAL_IMAGE_BYTES })
      providerCalled = true
      if (sourceKind === 'eligible_stream_video' && frameCursor < timestamps.length - 1) {
        const { error } = await admin.rpc('advance_content_safety_visual_scan', { p_scan_id: scan.scan_id, p_expected_cursor: frameCursor,
          p_frame_timestamp_ms: timestampMs, p_frame_result: finding })
        if (error) throw new VisualPipelineError('visual_advance_failed', { retryable: true, providerCalled: true })
        visualAdvanced += 1
      } else {
        const prior = Array.isArray(object(scan.partial_result).frames) ? object(scan.partial_result).frames as Record<string, unknown>[] : []
        const result = sourceKind === 'eligible_image' ? finding : mergeVisualFrameResults([...prior, { frame_index: frameCursor, timestamp_ms: timestampMs, result: finding }])
        const frameTimestamps = sourceKind === 'eligible_image' ? [] : timestamps
        const fingerprint = await sha256(`${scan.scan_id}|${scan.content_fingerprint}|${VISUAL_MODEL}|${scan.visual_prompt_version}|${JSON.stringify(frameTimestamps)}|${JSON.stringify(result)}`)
        const { data, error } = await admin.rpc('complete_content_safety_visual_analysis', { p_scan_id: scan.scan_id,
          p_content_fingerprint: scan.content_fingerprint, p_analysis_result: result, p_analysis_fingerprint: fingerprint,
          p_frame_timestamps_ms: frameTimestamps })
        if (error) throw new VisualPipelineError('visual_completion_failed', { retryable: true, providerCalled: true })
        visualAlerts += Number(object(data).alerts_processed ?? 0); visualAnalyzed += 1
      }
    } catch (error) {
      const issue = error instanceof VisualPipelineError ? error : new VisualPipelineError('visual_processing_unexpected', { retryable: true, providerCalled })
      console.warn('visual_processing_failed', {
        code: issue.code,
        retryable: issue.retryable,
        provider_called: issue.providerCalled || providerCalled,
        source_kind: String(scan.source_kind),
        attempt_count: Number(scan.attempt_count ?? 0),
        provider_status_code: issue.providerTelemetry?.status_code ?? null,
        provider_correlation_id: issue.providerTelemetry?.request_correlation_id ?? null,
        provider_carrier: issue.providerTelemetry?.carrier ?? null,
        provider_finish_reason: issue.providerTelemetry?.finish_reason ?? null,
        provider_response_bytes: issue.providerTelemetry?.response_bytes ?? null,
        provider_input_tokens: issue.providerTelemetry?.input_tokens ?? null,
        provider_output_tokens: issue.providerTelemetry?.output_tokens ?? null,
        provider_total_tokens: issue.providerTelemetry?.total_tokens ?? null,
      })
      const { data } = await admin.rpc('fail_content_safety_visual_scan', { p_scan_id: scan.scan_id, p_error_code: issue.code,
        p_retryable: issue.retryable, p_provider_called: issue.providerCalled || providerCalled })
      visualErrors.push({ scan_id: String(scan.scan_id), code: issue.code, retryable: issue.retryable, provider_called: issue.providerCalled || providerCalled })
      if (object(data).visual_status === 'pending') visualRetried += 1
      else visualFailed += 1
    }
  }

  let contextClaimed = 0, contextAnalyzed = 0, contextRetried = 0, contextFailed = 0
  const contextErrors: { scan_id: string; code: string; retryable: boolean; provider_called: boolean }[] = []
  const { data: contextData, error: contextClaimError } = await admin.rpc(
    'claim_creator_premium_content_safety_context_v1',
    { p_limit: 1, p_worker_contract: WORKER_CONTRACT },
  )
  if (!contextClaimError) for (const value of Array.isArray(contextData) ? contextData : []) {
    const claim = object(value); contextClaimed += 1
    const visualResult = object(claim.visual_result)
    const findings = Array.isArray(visualResult.findings) ? visualResult.findings.map(value => {
      const finding = object(value)
      return {
        category: finding.category,
        triage_level: finding.triage_level,
        description: finding.description,
      }
    }) : []
    try {
      if (!uuid(claim.scan_id) || typeof claim.content_fingerprint !== 'string' ||
          !/^[0-9a-f]{64}$/u.test(claim.content_fingerprint) || typeof claim.text !== 'string' ||
          claim.policy_id !== POLICY_CONTEXT_POLICY_ID ||
          claim.schema_version !== POLICY_CONTEXT_SCHEMA_VERSION ||
          claim.prompt_version !== POLICY_CONTEXT_PROMPT_VERSION ||
          visualResult.schema_version !== CREATOR_PREMIUM_VISUAL_PROMPT_VERSION ||
          !['none', 'visible_non_threatening', 'threatening_or_used', 'ambiguous'].includes(
            String(visualResult.weapon_disposition),
          ) ||
          !Number.isInteger(claim.attempt_count) || Number(claim.attempt_count) < 1 || Number(claim.attempt_count) > 5 ||
          !['complete', 'no_speech', 'not_applicable'].includes(String(claim.transcript_coverage)) ||
          typeof claim.transcript_text !== 'string') {
        throw new PolicyContextError('creator_premium_context_claim_invalid', { status: 400 })
      }
      const input = {
        text: claim.text,
        transcript: { coverage: claim.transcript_coverage, text: claim.transcript_text },
        visual: {
          coverage: 'complete',
          review_required: visualResult.review_required,
          findings,
          summary: visualResult.summary,
          weapon_disposition: visualResult.weapon_disposition,
        },
      }
      const result = await runPolicyContextAnalysis({ token: Deno.env.get('CLOUDFLARE_AI_TOKEN')?.trim(),
        accountId: streamAccountId(), input })
      const { error } = await admin.rpc('complete_creator_premium_content_safety_context_v1', {
        p_scan_id: claim.scan_id,
        p_content_fingerprint: claim.content_fingerprint,
        p_attempt_count: claim.attempt_count,
        p_context_result: result,
        p_worker_contract: WORKER_CONTRACT,
      })
      if (error) throw policyContextCompletionError(error)
      contextAnalyzed += 1
    } catch (error) {
      const issue = policyContextErrorFrom(error)
      console.warn('creator_premium_context_processing_failed', {
        scan_id: String(claim.scan_id),
        policy_id: String(claim.policy_id),
        schema_version: String(claim.schema_version),
        prompt_version: String(claim.prompt_version),
        code: issue.code,
        retryable: issue.retryable,
        provider_called: issue.providerCalled,
        validation_reason: issue.validationReason ?? null,
        attempt_count: Number(claim.attempt_count ?? 0),
        provider_status_code: issue.providerTelemetry?.status_code ?? null,
        provider_correlation_id: issue.providerTelemetry?.request_correlation_id ?? null,
        provider_carrier: issue.providerTelemetry?.carrier ?? null,
        provider_finish_reason: issue.providerTelemetry?.finish_reason ?? null,
        provider_response_bytes: issue.providerTelemetry?.response_bytes ?? null,
        provider_input_tokens: issue.providerTelemetry?.input_tokens ?? null,
        provider_output_tokens: issue.providerTelemetry?.output_tokens ?? null,
        provider_total_tokens: issue.providerTelemetry?.total_tokens ?? null,
      })
      if (uuid(claim.scan_id)) {
        const { data } = await admin.rpc('fail_creator_premium_content_safety_context_v1', {
          p_scan_id: claim.scan_id,
          p_content_fingerprint: claim.content_fingerprint,
          p_attempt_count: claim.attempt_count,
          p_error_code: issue.code,
          p_retryable: issue.retryable,
          p_provider_called: issue.providerCalled,
          p_worker_contract: WORKER_CONTRACT,
        })
        if (object(data).context_status === 'pending') contextRetried += 1
        else contextFailed += 1
      } else contextFailed += 1
      contextErrors.push({ scan_id: String(claim.scan_id ?? ''), code: issue.code,
        retryable: issue.retryable, provider_called: issue.providerCalled })
    }
  }
  const { data: publicationData, error: publicationError } = await admin.rpc(
    'reconcile_creator_premium_publications_v1',
    { p_limit: 25 },
  )
  if (publicationError) return json({ success: false, error: 'creator_premium_reconcile_failed' }, 500)
  return json({ success: true, claimed: scansData.length, completed, retried, failed, alerts, external_providers: audioClaimed + visualClaimed,
    audio: { claimed: audioClaimed, analyzed: audioAnalyzed, retried: audioRetried, failed: audioFailed, cleanup_completed: cleanupCompleted },
    transcripts: { evaluated: transcriptEvaluated, alerts: transcriptAlerts },
    visual: { claimed: visualClaimed, analyzed: visualAnalyzed, advanced: visualAdvanced, retried: visualRetried, failed: visualFailed, alerts: visualAlerts, errors: visualErrors },
    premium_context: { claimed: contextClaimed, analyzed: contextAnalyzed, retried: contextRetried, failed: contextFailed,
      claim_error: contextClaimError ? 'creator_premium_context_claim_failed' : null, errors: contextErrors },
    premium_publication: publicationData })
})
