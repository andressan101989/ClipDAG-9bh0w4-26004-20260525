export const WORKERS_AI_PROVIDER = 'cloudflare_workers_ai'
export const WHISPER_MODEL = '@cf/openai/whisper-large-v3-turbo'
export const MAX_AUDIO_BYTES = 20_000_000

export class AudioPipelineError extends Error {
  constructor(code, { status = 502, retryable = false, providerCalled = false } = {}) {
    super(code)
    this.name = 'AudioPipelineError'
    this.code = code
    this.status = status
    this.retryable = retryable
    this.providerCalled = providerCalled
  }
}

export function validateStreamAudioUrl(value, uid, customerCode) {
  let url
  try { url = new URL(String(value ?? '')) } catch { throw new AudioPipelineError('stream_audio_url_invalid') }
  const code = String(customerCode ?? '').trim().toLowerCase()
    .replace(/^https?:\/\//iu, '')
    .replace(/\/$/u, '')
    .replace(/^customer-/iu, '')
    .replace(/\.cloudflarestream\.com$/iu, '')
  const expectedHost = `customer-${code}.cloudflarestream.com`
  if (!code || !uid || url.protocol !== 'https:' || url.username || url.password || url.port) throw new AudioPipelineError('stream_audio_url_untrusted_scheme')
  if (url.hostname.toLowerCase() !== expectedHost) throw new AudioPipelineError('stream_audio_url_untrusted_host')
  let pathname
  try { pathname = decodeURIComponent(url.pathname) } catch { throw new AudioPipelineError('stream_audio_url_untrusted_path') }
  const parts = pathname.split('/').filter(Boolean)
  const returnedIdentity = parts[0] ?? ''
  const requestedIdentity = String(uid ?? '').trim()
  const canonicalDerivativeIdentity = /^[0-9a-f]{32}$/iu.test(returnedIdentity)
  if (parts.length !== 3 || (returnedIdentity.toLowerCase() !== requestedIdentity.toLowerCase() && !canonicalDerivativeIdentity)) {
    throw new AudioPipelineError('stream_audio_url_untrusted_identity')
  }
  if (!['downloads', 'dl'].includes(parts[1]?.toLowerCase())) throw new AudioPipelineError('stream_audio_url_untrusted_path')
  if (parts[2]?.toLowerCase() !== 'audio.m4a') throw new AudioPipelineError('stream_audio_url_untrusted_format')
  return url.toString()
}

export function retryPolicy(status) {
  const value = Number(status)
  return { retryable: value === 408 || value === 425 || value === 429 || value >= 500 }
}

export function bytesToBase64(bytes) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)))
  }
  return btoa(binary)
}

function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

export function parseVttSegments(value) {
  if (typeof value !== 'string') return []
  const segments = []
  const lines = value.replace(/\r/gu, '').split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\d{2}):(\d{2}):(\d{2}(?:\.\d{3})?)\s+-->\s+(\d{2}):(\d{2}):(\d{2}(?:\.\d{3})?)/u)
    if (!match) continue
    const start = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
    const end = Number(match[4]) * 3600 + Number(match[5]) * 60 + Number(match[6])
    const text = String(lines[index + 1] ?? '').trim().slice(0, 1000)
    if (text && Number.isFinite(start) && Number.isFinite(end) && end >= start) segments.push({ start, end, text })
    if (segments.length >= 500) break
  }
  return segments
}

export function normalizeWhisperResult(payload) {
  const result = payload && typeof payload === 'object' && payload.result && typeof payload.result === 'object' ? payload.result : payload
  if (!result || typeof result !== 'object') throw new AudioPipelineError('workers_ai_invalid_response', { providerCalled: true })
  const info = result.transcription_info && typeof result.transcription_info === 'object' ? result.transcription_info : result
  const text = typeof info.text === 'string' ? info.text.trim() : typeof result.text === 'string' ? result.text.trim() : ''
  const rawSegments = Array.isArray(result.segments) ? result.segments : Array.isArray(info.segments) ? info.segments : []
  const segments = rawSegments.slice(0, 500).flatMap(segment => {
    if (!segment || typeof segment !== 'object') return []
    const start = finiteNumber(segment.start), end = finiteNumber(segment.end)
    const segmentText = typeof segment.text === 'string' ? segment.text.trim().slice(0, 1000) : ''
    return start !== null && end !== null && end >= start && segmentText ? [{ start, end, text: segmentText }] : []
  })
  const normalizedSegments = segments.length ? segments : parseVttSegments(result.vtt ?? info.vtt)
  const language = typeof info.language === 'string' ? info.language.trim().slice(0, 32) :
    typeof result.language === 'string' ? result.language.trim().slice(0, 32) : null
  const statedCount = Number(info.word_count ?? result.word_count)
  const wordCount = Number.isInteger(statedCount) && statedCount >= 0 ? statedCount : (text ? text.split(/\s+/u).length : 0)
  return { text: text.slice(0, 100000), wordCount, segments: normalizedSegments, detectedLanguage: language || null, noSpeech: text.length === 0 }
}

export function timecodeForMatch(match, segments) {
  const terms = Array.isArray(match?.matched_terms) ? match.matched_terms.map(value => String(value).normalize('NFKC').toLocaleLowerCase('und')) : []
  if (!terms.length || !Array.isArray(segments)) return { ...match, timecode_start: null, timecode_end: null }
  const segment = segments.find(value => value && typeof value === 'object' && typeof value.text === 'string' &&
    terms.some(term => value.text.normalize('NFKC').toLocaleLowerCase('und').includes(term)))
  return { ...match, timecode_start: segment ? finiteNumber(segment.start) : null, timecode_end: segment ? finiteNumber(segment.end) : null }
}

export function makeProbeWav() {
  const sampleRate = 16000, samples = 1600, dataLength = samples * 2
  const buffer = new ArrayBuffer(44 + dataLength), view = new DataView(buffer)
  const write = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)))
  write(0, 'RIFF'); view.setUint32(4, 36 + dataLength, true); write(8, 'WAVE'); write(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, dataLength, true)
  return new Uint8Array(buffer)
}
