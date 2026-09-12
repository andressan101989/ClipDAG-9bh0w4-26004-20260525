export const MCP_TOOL_NAME = 'publish_nelyon_handoff'
export const MCP_TOOL_DESCRIPTION =
  'Uploads approved Nelyon design/branding assets to the canonical AI handoff bridge and returns a handoff ID plus a read-only capability URL for Codex.'
export const B2_MAX_FILES = 10
export const B2_MAX_ASSET_BYTES = 10_000_000
export const B2_MAX_HANDOFF_BYTES = 25_000_000
export const B2_MAX_REDIRECTS = 3
export const B2_MAX_LINK_TTL_SECONDS = 86_400

export const MCP_TOOL_METADATA = {
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  _meta: { 'openai/fileParams': ['files'] },
} as const

const HANDOFF_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u
const FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,179}$/u
const PURPOSE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}$/u
const FILE_ID_PATTERN = /^[A-Za-z0-9._-]{1,256}$/u
const TYPES = new Set(['branding', 'design', 'screenshot', 'document', 'temporary'])
const STATUSES = new Set(['approved', 'temporary'])
const MIME_EXTENSIONS = new Map<string, Set<string>>([
  ['image/png', new Set(['png'])],
  ['image/jpeg', new Set(['jpg', 'jpeg'])],
  ['image/webp', new Set(['webp'])],
  ['image/svg+xml', new Set(['svg'])],
  ['application/pdf', new Set(['pdf'])],
  ['application/zip', new Set(['zip'])],
  ['application/json', new Set(['json'])],
  ['text/plain', new Set(['txt', 'md', 'log'])],
])
const EXTENSION_FOR_MIME = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/svg+xml', 'svg'],
  ['application/pdf', 'pdf'],
  ['application/zip', 'zip'],
  ['application/json', 'json'],
  ['text/plain', 'txt'],
])
const GENERIC_CONTENT_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream'])
const encoder = new TextEncoder()

export type FileParam = {
  download_url: string
  file_id: string
  mime_type?: string
  file_name?: string
}

export type PublishInput = {
  handoff_id?: string
  type: string
  status: string
  files: FileParam[]
  purpose?: string
  expires_in_seconds?: number
}

export type PublishedAsset = {
  filename: string
  mime_type: string
  size_bytes: number
  sha256: string
}

export type PublishOutput = {
  handoff_id: string
  status: string
  capability_url: string
  expires_at: string
  assets: PublishedAsset[]
}

export type AdapterDependencies = {
  env: (name: string) => string | undefined
  fetchImpl?: typeof fetch
  resolveHostname: (hostname: string) => Promise<string[]>
  now?: () => Date
  randomBytes?: (length: number) => Uint8Array
  reportError?: (name: string) => void
}

type IngestedAsset = PublishedAsset & {
  bytes: Uint8Array
  purpose: string
}

export class AdapterError extends Error {
  status: number
  code: string

  constructor(status: number, code: string) {
    super(code)
    this.name = 'AdapterError'
    this.status = status
    this.code = code
  }
}

function fail(status: number, code: string): never {
  throw new AdapterError(status, code)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function extensionOf(filename: string): string {
  const index = filename.lastIndexOf('.')
  return index < 0 ? '' : filename.slice(index + 1).toLowerCase()
}

function validFilename(filename: string): boolean {
  return FILENAME_PATTERN.test(filename) && filename === filename.trim() &&
    !filename.includes('..') && !filename.includes('/') && !filename.includes('\\') &&
    !['_init.json', 'manifest.json'].includes(filename.toLowerCase())
}

function bytesStartWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value)
}

function decodeText(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

function detectMime(bytes: Uint8Array): string {
  if (bytesStartWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (bytesStartWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (bytes.length >= 12 && bytesStartWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytesStartWith(bytes.slice(8), [0x57, 0x45, 0x42, 0x50])) return 'image/webp'
  if (bytesStartWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'
  if (bytesStartWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || bytesStartWith(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
    bytesStartWith(bytes, [0x50, 0x4b, 0x07, 0x08])) return 'application/zip'

  const text = decodeText(bytes)
  if (text == null) fail(400, 'mime_not_allowed')
  const normalized = text.replace(/^\uFEFF/u, '').trimStart()
  const lowered = normalized.slice(0, 4_096).toLowerCase()
  if (lowered.startsWith('<!doctype html') || lowered.startsWith('<html') || lowered.includes('<script')) {
    fail(400, 'executable_text_forbidden')
  }
  if (/^(?:<\?xml[^>]*>\s*)?<svg[\s>]/iu.test(normalized)) {
    if (/<foreignobject[\s>]|\son[a-z]+\s*=|javascript\s*:/iu.test(normalized)) fail(400, 'active_svg_forbidden')
    return 'image/svg+xml'
  }
  if (normalized.startsWith('{') || normalized.startsWith('[')) {
    try {
      JSON.parse(normalized)
      return 'application/json'
    } catch {
      // A malformed JSON-looking file is not silently downgraded to plain text.
      fail(400, 'invalid_json_asset')
    }
  }
  if (/[^\u0009\u000a\u000d\u0020-\u007e\u00a0-\uffff]/u.test(text)) fail(400, 'mime_not_allowed')
  return 'text/plain'
}

function parseIpv4(hostname: string): number[] | null {
  const parts = hostname.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part))) return null
  const numbers = parts.map(Number)
  return numbers.every((part) => part >= 0 && part <= 255) ? numbers : null
}

export function isPublicIp(address: string): boolean {
  let normalized = address.toLowerCase().replace(/^\[|\]$/gu, '')
  const ipv4 = parseIpv4(normalized)
  if (ipv4) {
    const [a, b] = ipv4
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0) || (a === 192 && b === 0 && ipv4[2] === 2) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0 && ipv4[2] === 113))
  }
  if (!normalized.includes(':')) return false
  try {
    normalized = new URL(`https://[${normalized}]/`).hostname.replace(/^\[|\]$/gu, '')
  } catch {
    return false
  }
  if (normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') ||
    normalized.startsWith('ff') || /^fe[89ab]/u.test(normalized) || normalized.startsWith('2001:db8:')) return false
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice(7)
    return parseIpv4(mapped) ? isPublicIp(mapped) : false
  }
  return true
}

function blockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/u, '').replace(/^\[|\]$/gu, '')
  return host === 'localhost' || host === 'metadata.google.internal' || host.endsWith('.localhost') ||
    host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan') || host.endsWith('.home') ||
    host.endsWith('.arpa')
}

export async function validateDownloadUrl(raw: string, resolveHostname: AdapterDependencies['resolveHostname']): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    fail(400, 'invalid_file_reference')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) {
    fail(400, 'unsafe_download_url')
  }
  if (blockedHostname(url.hostname)) fail(400, 'unsafe_download_url')
  const literal = url.hostname.replace(/^\[|\]$/gu, '')
  const literalIp = parseIpv4(literal) || literal.includes(':')
  const addresses = literalIp ? [literal] : await resolveHostname(literal).catch(() => [])
  if (addresses.length < 1 || addresses.some((address) => !isPublicIp(address))) fail(400, 'unsafe_download_url')
  return url
}

function normalizeContentType(value: string | null): string {
  return String(value ?? '').split(';')[0].trim().toLowerCase()
}

function concatChunks(chunks: Uint8Array[], length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

async function downloadBytes(
  reference: FileParam,
  deps: AdapterDependencies,
): Promise<{ bytes: Uint8Array; responseContentType: string }> {
  const fetchImpl = deps.fetchImpl ?? fetch
  let url = await validateDownloadUrl(reference.download_url, deps.resolveHostname)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25_000)
  try {
    for (let redirects = 0; redirects <= B2_MAX_REDIRECTS; redirects += 1) {
      const response = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: controller.signal })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects === B2_MAX_REDIRECTS) fail(400, 'too_many_redirects')
        const location = response.headers.get('Location')
        if (!location) fail(400, 'invalid_redirect')
        await response.body?.cancel()
        url = await validateDownloadUrl(new URL(location, url).toString(), deps.resolveHostname)
        continue
      }
      if (!response.ok) fail(400, 'file_download_failed')
      const declaredLength = Number(response.headers.get('Content-Length'))
      if (Number.isFinite(declaredLength) && declaredLength > B2_MAX_ASSET_BYTES) fail(413, 'asset_too_large')
      if (!response.body) fail(400, 'empty_download')
      const chunks: Uint8Array[] = []
      let length = 0
      const reader = response.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.length
        if (length > B2_MAX_ASSET_BYTES) {
          await reader.cancel()
          fail(413, 'asset_too_large')
        }
        chunks.push(value)
      }
      if (length < 1) fail(400, 'empty_download')
      return { bytes: concatChunks(chunks, length), responseContentType: normalizeContentType(response.headers.get('Content-Type')) }
    }
  } finally {
    clearTimeout(timeout)
  }
  fail(400, 'file_download_failed')
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const owned = new Uint8Array(bytes.length)
  owned.set(bytes)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', owned.buffer))
  return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function randomHex(length: number, randomBytes?: AdapterDependencies['randomBytes']): string {
  const bytes = randomBytes ? randomBytes(length) : crypto.getRandomValues(new Uint8Array(length))
  if (bytes.length !== length) fail(500, 'random_source_failed')
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')
}

export function generateHandoffId(type: string, now = new Date(), randomBytes?: AdapterDependencies['randomBytes']): string {
  const timestamp = now.toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'z').replace('T', 't')
  return `nelyon-${type}-${timestamp}-${randomHex(6, randomBytes)}`
}

function parseInput(value: unknown): PublishInput {
  if (!isRecord(value)) fail(400, 'invalid_request')
  const type = typeof value.type === 'string' ? value.type : ''
  const status = typeof value.status === 'string' ? value.status : ''
  if (!TYPES.has(type)) fail(400, 'invalid_type')
  if (!STATUSES.has(status)) fail(400, 'invalid_status')
  if ((type === 'temporary') !== (status === 'temporary')) fail(400, 'inconsistent_temporary_status')
  if (!Array.isArray(value.files) || value.files.length < 1 || value.files.length > B2_MAX_FILES) fail(400, 'invalid_files')
  const handoffId = value.handoff_id == null ? undefined : String(value.handoff_id)
  if (handoffId != null && !HANDOFF_ID_PATTERN.test(handoffId)) fail(400, 'invalid_handoff_id')
  const purpose = value.purpose == null ? undefined : String(value.purpose)
  if (purpose != null && !PURPOSE_PATTERN.test(purpose)) fail(400, 'invalid_purpose')
  const ttl = value.expires_in_seconds == null ? 3_600 : Number(value.expires_in_seconds)
  if (!Number.isSafeInteger(ttl) || ttl < 60 || ttl > B2_MAX_LINK_TTL_SECONDS) fail(400, 'invalid_link_ttl')
  const files = value.files.map((candidate) => {
    if (!isRecord(candidate) || typeof candidate.download_url !== 'string' || typeof candidate.file_id !== 'string' ||
      !FILE_ID_PATTERN.test(candidate.file_id)) fail(400, 'invalid_file_reference')
    const allowedKeys = new Set(['download_url', 'file_id', 'mime_type', 'file_name'])
    if (Object.keys(candidate).some((key) => !allowedKeys.has(key))) fail(400, 'invalid_file_reference')
    if (candidate.mime_type != null && typeof candidate.mime_type !== 'string') fail(400, 'invalid_file_reference')
    if (candidate.file_name != null && typeof candidate.file_name !== 'string') fail(400, 'invalid_file_reference')
    return candidate as FileParam
  })
  return { handoff_id: handoffId, type, status, files, purpose, expires_in_seconds: ttl }
}

async function ingestFiles(input: PublishInput, deps: AdapterDependencies): Promise<IngestedAsset[]> {
  const assets: IngestedAsset[] = []
  const filenames = new Set<string>()
  let totalBytes = 0
  for (let index = 0; index < input.files.length; index += 1) {
    const reference = input.files[index]
    const { bytes, responseContentType } = await downloadBytes(reference, deps)
    totalBytes += bytes.length
    if (totalBytes > B2_MAX_HANDOFF_BYTES) fail(413, 'handoff_too_large')
    const mimeType = detectMime(bytes)
    const suppliedMime = normalizeContentType(reference.mime_type ?? '')
    if (suppliedMime && suppliedMime !== mimeType) fail(400, 'mime_mismatch')
    if (!GENERIC_CONTENT_TYPES.has(responseContentType) && responseContentType !== mimeType) fail(400, 'mime_mismatch')
    if (!MIME_EXTENSIONS.has(mimeType)) fail(400, 'mime_not_allowed')
    const filename = reference.file_name ?? `asset-${index + 1}.${EXTENSION_FOR_MIME.get(mimeType)}`
    if (!validFilename(filename) || !MIME_EXTENSIONS.get(mimeType)?.has(extensionOf(filename))) fail(400, 'invalid_filename')
    const filenameKey = filename.toLowerCase()
    if (filenames.has(filenameKey)) fail(400, 'duplicate_filename')
    filenames.add(filenameKey)
    assets.push({
      filename,
      mime_type: mimeType,
      size_bytes: bytes.length,
      sha256: await sha256Hex(bytes),
      purpose: input.purpose ?? input.type,
      bytes,
    })
  }
  return assets
}

async function responseJson(response: Response, expectedCode: string): Promise<Record<string, unknown>> {
  if (!response.ok) fail(response.status === 409 ? 409 : 502, response.status === 409 ? 'handoff_exists' : expectedCode)
  const body = await response.json().catch(() => fail(502, expectedCode))
  if (!isRecord(body)) fail(502, expectedCode)
  return body
}

async function timedFetch(fetchImpl: typeof fetch, url: string, init: RequestInit, timeoutMs = 25_000): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal })
  } catch {
    fail(502, 'upstream_unavailable')
  } finally {
    clearTimeout(timeout)
  }
}

function b1Endpoint(deps: AdapterDependencies): string {
  const base = deps.env('SUPABASE_URL')?.trim().replace(/\/+$/u, '') ?? ''
  if (!base.startsWith('https://')) fail(503, 'adapter_not_configured')
  return `${base}/functions/v1/ai-handoff`
}

function writeToken(deps: AdapterDependencies): string {
  const token = deps.env('AI_HANDOFF_WRITE_TOKEN')?.trim() ?? ''
  if (!token) fail(503, 'adapter_not_configured')
  return token
}

export async function publishNelyonHandoff(value: unknown, deps: AdapterDependencies): Promise<PublishOutput> {
  const input = parseInput(value)
  const fetchImpl = deps.fetchImpl ?? fetch
  const assets = await ingestFiles(input, deps)
  const handoffId = input.handoff_id ?? generateHandoffId(input.type, deps.now?.() ?? new Date(), deps.randomBytes)
  const endpoint = b1Endpoint(deps)
  const token = writeToken(deps)
  const jsonHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const initResponse = await timedFetch(fetchImpl, `${endpoint}/v1/handoffs/init`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      handoff_id: handoffId,
      project: 'nelyon',
      type: input.type,
      status: input.status,
      assets: assets.map(({ bytes: _bytes, ...asset }) => asset),
    }),
  })
  const initialized = await responseJson(initResponse, 'b1_init_failed')
  if (!Array.isArray(initialized.uploads) || initialized.uploads.length !== assets.length) fail(502, 'invalid_b1_init_response')

  for (const asset of assets) {
    const upload = initialized.uploads.find((candidate) => isRecord(candidate) && candidate.filename === asset.filename)
    if (!isRecord(upload) || upload.method !== 'PUT' || typeof upload.url !== 'string' || !upload.url.startsWith('https://') ||
      !isRecord(upload.headers) || Object.values(upload.headers).some((value) => typeof value !== 'string')) {
      fail(502, 'invalid_b1_init_response')
    }
    const uploadResponse = await timedFetch(fetchImpl, upload.url, {
      method: 'PUT',
      headers: upload.headers as Record<string, string>,
      body: Uint8Array.from(asset.bytes).buffer,
    }, 40_000)
    if (!uploadResponse.ok) fail(502, 'asset_upload_failed')
  }

  await responseJson(await timedFetch(fetchImpl, `${endpoint}/v1/handoffs/commit`, {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify({ handoff_id: handoffId }),
  }), 'b1_commit_failed')
  const link = await responseJson(await timedFetch(fetchImpl, `${endpoint}/v1/handoffs/${encodeURIComponent(handoffId)}/link`, {
    method: 'POST', headers: jsonHeaders, body: JSON.stringify({ expires_in_seconds: input.expires_in_seconds }),
  }), 'b1_link_failed')
  if (link.handoff_id !== handoffId || typeof link.capability_url !== 'string' || !link.capability_url.startsWith('https://') ||
    typeof link.expires_at !== 'string') fail(502, 'invalid_b1_link_response')
  return {
    handoff_id: handoffId,
    status: input.status,
    capability_url: link.capability_url,
    expires_at: link.expires_at,
    assets: assets.map(({ bytes: _bytes, purpose: _purpose, ...asset }) => asset),
  }
}

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ])
  const a = new Uint8Array(leftHash)
  const b = new Uint8Array(rightHash)
  let different = left.length === right.length ? 0 : 1
  for (let index = 0; index < a.length; index += 1) different |= a[index] ^ b[index]
  return different === 0
}

function bearerToken(request: Request): string {
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/u.exec(request.headers.get('Authorization') ?? '')
  return match?.[1] ?? ''
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

export function createAuthenticatedMcpHandler(
  deps: AdapterDependencies,
  handleMcp: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const configured = deps.env('AI_HANDOFF_MCP_TOKEN')?.trim() ?? ''
    if (configured.length < 64) return json({ error: 'service_unavailable' }, 503)
    const supplied = bearerToken(request)
    if (!supplied || !(await constantTimeEqual(supplied, configured))) return json({ error: 'unauthorized' }, 401)
    try {
      return await handleMcp(request)
    } catch (error) {
      deps.reportError?.(error instanceof Error ? error.name : 'UnknownError')
      return json({ error: 'internal_error' }, 500)
    }
  }
}

export function safeToolError(error: unknown): string {
  return error instanceof AdapterError ? error.code : 'publish_failed'
}
