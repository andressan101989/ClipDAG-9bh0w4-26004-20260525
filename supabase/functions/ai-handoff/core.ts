export const AI_HANDOFF_SCHEMA_VERSION = 1
export const AI_HANDOFF_ROOT = 'internal/ai-handoff/v1'
export const MAX_ASSET_BYTES = 50_000_000
export const MAX_HANDOFF_BYTES = 250_000_000
export const MAX_LINK_TTL_SECONDS = 86_400
export const SIGNED_URL_TTL_SECONDS = 300

const PROJECT_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u
const HANDOFF_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u
const FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,179}$/u
const PURPOSE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}$/u
const SHA256_PATTERN = /^[a-fA-F0-9]{64}$/u
const TYPES = new Set(['branding', 'design', 'screenshot', 'document', 'temporary'])
const STATUSES = new Set(['approved', 'temporary'])
const MIME_EXTENSIONS = new Map([
  ['image/png', new Set(['png'])],
  ['image/jpeg', new Set(['jpg', 'jpeg'])],
  ['image/webp', new Set(['webp'])],
  ['image/svg+xml', new Set(['svg'])],
  ['application/pdf', new Set(['pdf'])],
  ['application/zip', new Set(['zip'])],
  ['application/json', new Set(['json'])],
  ['text/plain', new Set(['txt', 'md', 'log'])],
])
const RESERVED_FILENAMES = new Set(['manifest.json', '_init.json'])
const encoder = new TextEncoder()

export type HandoffAsset = {
  filename: string
  object_key: string
  mime_type: string
  size_bytes: number
  sha256: string
  purpose: string
}

export type HandoffManifest = {
  schema_version: 1
  handoff_id: string
  project: string
  type: string
  status: string
  created_at: string
  committed_at: string
  assets: HandoffAsset[]
}

type InitRecord = Omit<HandoffManifest, 'committed_at'> & { record_type: 'init' }
type Locator = {
  schema_version: 1
  record_type: 'locator'
  handoff_id: string
  project: string
  type: string
  status: string
  prefix: string
  init_key: string
  manifest_key: string
  created_at: string
}

export type HandoffStorage = {
  createJsonIfAbsent(key: string, value: unknown): Promise<boolean>
  readJson(key: string): Promise<unknown | null>
  head(key: string): Promise<{ size: number; contentType: string; metadata: Record<string, string> } | null>
  delete(key: string): Promise<void>
  signUpload(key: string, mimeType: string, sha256: string): Promise<{ url: string; headers: Record<string, string>; expiresAt: string }>
  signDownload(key: string): Promise<{ url: string; expiresAt: string }>
}

export type HandoffDependencies = {
  storage: HandoffStorage
  env: (name: string) => string | undefined
  now?: () => Date
  nonce?: () => string
  reportError?: (name: string) => void
}

class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string) {
    super(code)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function fail(status: number, code: string): never {
  throw new ApiError(status, code)
}

function extensionOf(filename: string): string {
  const index = filename.lastIndexOf('.')
  return index < 0 ? '' : filename.slice(index + 1).toLowerCase()
}

function validFilename(filename: string): boolean {
  if (!FILENAME_PATTERN.test(filename)) return false
  if (filename !== filename.trim() || filename.includes('..')) return false
  if (filename.includes('/') || filename.includes('\\')) return false
  return !RESERVED_FILENAMES.has(filename.toLowerCase())
}

export function validateHandoffInput(value: unknown) {
  if (!isRecord(value)) fail(400, 'invalid_request')
  const handoffId = typeof value.handoff_id === 'string' ? value.handoff_id : ''
  const project = typeof value.project === 'string' ? value.project : ''
  const type = typeof value.type === 'string' ? value.type : ''
  const status = typeof value.status === 'string' ? value.status : ''
  if (!HANDOFF_ID_PATTERN.test(handoffId)) fail(400, 'invalid_handoff_id')
  if (!PROJECT_PATTERN.test(project)) fail(400, 'invalid_project')
  if (!TYPES.has(type)) fail(400, 'invalid_type')
  if (!STATUSES.has(status)) fail(400, 'invalid_status')
  if ((type === 'temporary') !== (status === 'temporary')) fail(400, 'inconsistent_temporary_status')
  if (!Array.isArray(value.assets) || value.assets.length < 1 || value.assets.length > 100) {
    fail(400, 'invalid_assets')
  }

  const seen = new Set<string>()
  let totalBytes = 0
  const prefix = handoffPrefix(project, type, handoffId)
  const assets = value.assets.map((candidate) => {
    if (!isRecord(candidate)) fail(400, 'invalid_asset')
    if ('object_key' in candidate) fail(400, 'client_object_key_forbidden')
    const filename = typeof candidate.filename === 'string' ? candidate.filename : ''
    const mimeType = typeof candidate.mime_type === 'string' ? candidate.mime_type.toLowerCase() : ''
    const sizeBytes = candidate.size_bytes
    const sha256 = typeof candidate.sha256 === 'string' ? candidate.sha256.toLowerCase() : ''
    const purpose = candidate.purpose == null ? type : String(candidate.purpose)
    if (!validFilename(filename)) fail(400, 'invalid_filename')
    if (seen.has(filename.toLowerCase())) fail(400, 'duplicate_filename')
    seen.add(filename.toLowerCase())
    const extensions = MIME_EXTENSIONS.get(mimeType)
    if (!extensions) fail(400, 'mime_not_allowed')
    if (!extensions.has(extensionOf(filename))) fail(400, 'mime_extension_mismatch')
    if (!Number.isSafeInteger(sizeBytes) || Number(sizeBytes) < 1 || Number(sizeBytes) > MAX_ASSET_BYTES) {
      fail(400, 'invalid_asset_size')
    }
    totalBytes += Number(sizeBytes)
    if (totalBytes > MAX_HANDOFF_BYTES) fail(400, 'handoff_too_large')
    if (!SHA256_PATTERN.test(sha256)) fail(400, 'invalid_sha256')
    if (!PURPOSE_PATTERN.test(purpose) || purpose !== purpose.trim() || purpose.includes('..')) {
      fail(400, 'invalid_purpose')
    }
    return {
      filename,
      object_key: `${prefix}/${filename}`,
      mime_type: mimeType,
      size_bytes: Number(sizeBytes),
      sha256,
      purpose,
    }
  })
  return { handoff_id: handoffId, project, type, status, assets }
}

export function handoffPrefix(project: string, type: string, handoffId: string): string {
  return `${AI_HANDOFF_ROOT}/${project}/${type}/${handoffId}`
}

export function locatorKey(handoffId: string): string {
  return `${AI_HANDOFF_ROOT}/_index/${handoffId}.json`
}

function safeTokenEqual(left: string, right: string): boolean {
  const a = encoder.encode(left)
  const b = encoder.encode(right)
  const length = Math.max(a.length, b.length)
  let difference = a.length ^ b.length
  for (let index = 0; index < length; index += 1) difference |= (a[index] ?? 0) ^ (b[index] ?? 0)
  return difference === 0
}

function bearerToken(req: Request): string | null {
  const authorization = req.headers.get('Authorization')
  if (!authorization) return null
  const match = /^Bearer ([^\s]+)$/u.exec(authorization)
  return match?.[1] ?? null
}

function requireToken(req: Request, name: 'AI_HANDOFF_WRITE_TOKEN' | 'AI_HANDOFF_READ_TOKEN', deps: HandoffDependencies) {
  const supplied = bearerToken(req)
  if (!supplied) fail(401, 'unauthorized')
  const expected = deps.env(name)?.trim() ?? ''
  if (expected.length < 32) fail(503, 'bridge_not_configured')
  if (!safeTokenEqual(supplied, expected)) fail(401, 'unauthorized')
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function base64UrlDecode(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null
  try {
    const padded = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
  } catch {
    return null
  }
}

async function hmac(secret: string, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))
}

function safeBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  const length = Math.max(left.length, right.length)
  let difference = left.length ^ right.length
  for (let index = 0; index < length; index += 1) difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  return difference === 0
}

export async function createCapability(secret: string, handoffId: string, expiresAt: number, nonce: string): Promise<string> {
  if (secret.trim().length < 32) fail(503, 'bridge_not_configured')
  const payload = base64UrlEncode(encoder.encode(JSON.stringify({ v: 1, h: handoffId, e: expiresAt, p: 'ai-handoff-read', n: nonce })))
  return `${payload}.${base64UrlEncode(await hmac(secret, payload))}`
}

export async function verifyCapability(secret: string, token: string, handoffId: string, nowSeconds: number): Promise<boolean> {
  if (secret.trim().length < 32) fail(503, 'bridge_not_configured')
  const parts = token.split('.')
  if (parts.length !== 2) return false
  const payloadBytes = base64UrlDecode(parts[0])
  const signature = base64UrlDecode(parts[1])
  if (!payloadBytes || !signature) return false
  if (!safeBytesEqual(signature, await hmac(secret, parts[0]))) return false
  try {
    const claims = JSON.parse(new TextDecoder().decode(payloadBytes))
    return isRecord(claims) && claims.v === 1 && claims.p === 'ai-handoff-read' && claims.h === handoffId &&
      typeof claims.e === 'number' && Number.isSafeInteger(claims.e) && claims.e > nowSeconds &&
      typeof claims.n === 'string' && claims.n.length >= 8
  } catch {
    return false
  }
}

function parseLocator(value: unknown, handoffId: string): Locator {
  if (!isRecord(value) || value.schema_version !== 1 || value.record_type !== 'locator' || value.handoff_id !== handoffId) {
    fail(404, 'handoff_not_found')
  }
  const project = String(value.project ?? '')
  const type = String(value.type ?? '')
  const status = String(value.status ?? '')
  if (!PROJECT_PATTERN.test(project) || !TYPES.has(type) || !STATUSES.has(status)) fail(404, 'handoff_not_found')
  const prefix = handoffPrefix(project, type, handoffId)
  const initKey = `${prefix}/_init.json`
  const manifestKey = `${prefix}/manifest.json`
  if (value.prefix !== prefix || value.init_key !== initKey || value.manifest_key !== manifestKey) fail(404, 'handoff_not_found')
  return value as Locator
}

function parseStoredAssets(value: unknown, locator: Locator): HandoffAsset[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) fail(404, 'handoff_not_found')
  return value.map((candidate) => {
    if (!isRecord(candidate)) fail(404, 'handoff_not_found')
    const filename = String(candidate.filename ?? '')
    const mimeType = String(candidate.mime_type ?? '')
    const sizeBytes = Number(candidate.size_bytes)
    const sha256 = String(candidate.sha256 ?? '')
    const purpose = String(candidate.purpose ?? '')
    const expectedKey = `${locator.prefix}/${filename}`
    if (!validFilename(filename) || !MIME_EXTENSIONS.get(mimeType)?.has(extensionOf(filename)) ||
      !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_ASSET_BYTES ||
      !SHA256_PATTERN.test(sha256) || !PURPOSE_PATTERN.test(purpose) || candidate.object_key !== expectedKey) {
      fail(404, 'handoff_not_found')
    }
    return { filename, object_key: expectedKey, mime_type: mimeType, size_bytes: sizeBytes, sha256, purpose }
  })
}

function parseInit(value: unknown, locator: Locator): InitRecord {
  if (!isRecord(value) || value.schema_version !== 1 || value.record_type !== 'init' ||
    value.handoff_id !== locator.handoff_id || value.project !== locator.project || value.type !== locator.type ||
    value.status !== locator.status || typeof value.created_at !== 'string') fail(404, 'handoff_not_found')
  return { ...(value as unknown as InitRecord), assets: parseStoredAssets(value.assets, locator) }
}

function parseManifest(value: unknown, locator: Locator): HandoffManifest {
  if (!isRecord(value) || value.schema_version !== 1 || value.handoff_id !== locator.handoff_id ||
    value.project !== locator.project || value.type !== locator.type || value.status !== locator.status ||
    typeof value.created_at !== 'string' || typeof value.committed_at !== 'string') fail(404, 'handoff_not_found')
  return { ...(value as unknown as HandoffManifest), assets: parseStoredAssets(value.assets, locator) }
}

async function readLocator(storage: HandoffStorage, handoffId: string): Promise<Locator> {
  return parseLocator(await storage.readJson(locatorKey(handoffId)), handoffId)
}

function routeFrom(url: URL): string {
  const marker = '/v1/handoffs'
  const index = url.pathname.indexOf(marker)
  return index < 0 ? '' : url.pathname.slice(index)
}

function handoffIdFromRoute(route: string, suffix = ''): string | null {
  const escapedSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const match = new RegExp(`^/v1/handoffs/([^/]+)${escapedSuffix}$`, 'u').exec(route)
  if (!match) return null
  try {
    const value = decodeURIComponent(match[1])
    return HANDOFF_ID_PATTERN.test(value) ? value : null
  } catch {
    return null
  }
}

async function parseBody(req: Request): Promise<unknown> {
  const contentType = req.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()
  if (contentType !== 'application/json') fail(400, 'content_type_must_be_json')
  return await req.json().catch(() => fail(400, 'invalid_json'))
}

async function initialize(req: Request, deps: HandoffDependencies, now: Date): Promise<Response> {
  requireToken(req, 'AI_HANDOFF_WRITE_TOKEN', deps)
  const input = validateHandoffInput(await parseBody(req))
  const prefix = handoffPrefix(input.project, input.type, input.handoff_id)
  const initKey = `${prefix}/_init.json`
  const manifestKey = `${prefix}/manifest.json`
  const indexKey = locatorKey(input.handoff_id)
  const createdAt = now.toISOString()
  const init: InitRecord = { schema_version: 1, record_type: 'init', ...input, created_at: createdAt }
  const locator: Locator = {
    schema_version: 1,
    record_type: 'locator',
    handoff_id: input.handoff_id,
    project: input.project,
    type: input.type,
    status: input.status,
    prefix,
    init_key: initKey,
    manifest_key: manifestKey,
    created_at: createdAt,
  }
  if (!(await deps.storage.createJsonIfAbsent(indexKey, locator))) fail(409, 'handoff_exists')
  let initCreated = false
  try {
    initCreated = await deps.storage.createJsonIfAbsent(initKey, init)
  } catch (error) {
    await deps.storage.delete(indexKey)
    throw error
  }
  if (!initCreated) {
    await deps.storage.delete(indexKey)
    fail(409, 'handoff_exists')
  }
  try {
    const uploads = await Promise.all(input.assets.map(async (asset) => {
      const signed = await deps.storage.signUpload(asset.object_key, asset.mime_type, asset.sha256)
      return { filename: asset.filename, method: 'PUT', ...signed }
    }))
    return json({ schema_version: 1, handoff_id: input.handoff_id, uploads })
  } catch (error) {
    await Promise.allSettled([deps.storage.delete(indexKey), deps.storage.delete(initKey)])
    throw error
  }
}

async function commit(req: Request, deps: HandoffDependencies, now: Date): Promise<Response> {
  requireToken(req, 'AI_HANDOFF_WRITE_TOKEN', deps)
  const body = await parseBody(req)
  const handoffId = isRecord(body) && typeof body.handoff_id === 'string' ? body.handoff_id : ''
  if (!HANDOFF_ID_PATTERN.test(handoffId)) fail(400, 'invalid_handoff_id')
  const locator = await readLocator(deps.storage, handoffId)
  if (await deps.storage.head(locator.manifest_key)) fail(409, 'handoff_committed')
  const init = parseInit(await deps.storage.readJson(locator.init_key), locator)
  for (const asset of init.assets) {
    const head = await deps.storage.head(asset.object_key)
    if (!head) fail(409, 'manifest_incomplete')
    if (head.size !== asset.size_bytes) fail(409, 'uploaded_object_size_mismatch')
    if (head.contentType !== asset.mime_type) fail(409, 'uploaded_object_content_type_mismatch')
    if (head.metadata.sha256?.toLowerCase() !== asset.sha256) fail(409, 'uploaded_object_sha256_mismatch')
  }
  const manifest: HandoffManifest = {
    schema_version: 1,
    handoff_id: init.handoff_id,
    project: init.project,
    type: init.type,
    status: init.status,
    created_at: init.created_at,
    committed_at: now.toISOString(),
    assets: init.assets,
  }
  if (!(await deps.storage.createJsonIfAbsent(locator.manifest_key, manifest))) fail(409, 'handoff_committed')
  return json({ success: true, manifest })
}

async function createLink(req: Request, deps: HandoffDependencies, now: Date, handoffId: string): Promise<Response> {
  requireToken(req, 'AI_HANDOFF_WRITE_TOKEN', deps)
  const body = await parseBody(req)
  const ttl = isRecord(body) && body.expires_in_seconds != null ? Number(body.expires_in_seconds) : 3600
  if (!Number.isSafeInteger(ttl) || ttl < 60 || ttl > MAX_LINK_TTL_SECONDS) fail(400, 'invalid_link_ttl')
  const locator = await readLocator(deps.storage, handoffId)
  if (!(await deps.storage.head(locator.manifest_key))) fail(409, 'handoff_not_committed')
  const expires = Math.floor(now.getTime() / 1000) + ttl
  const secret = deps.env('AI_HANDOFF_LINK_SECRET')?.trim() ?? ''
  const capability = await createCapability(secret, handoffId, expires, deps.nonce?.() ?? crypto.randomUUID())
  const url = new URL(req.url)
  const markerIndex = url.pathname.indexOf('/v1/handoffs')
  const runtimeBase = url.pathname.slice(0, markerIndex)
  const publicBase = runtimeBase.startsWith('/functions/v1/') ? runtimeBase : `/functions/v1${runtimeBase}`
  url.pathname = `${publicBase}/v1/handoffs/${encodeURIComponent(handoffId)}`
  url.search = ''
  url.searchParams.set('cap', capability)
  return json({ handoff_id: handoffId, capability_url: url.toString(), expires_at: new Date(expires * 1000).toISOString() })
}

async function readHandoff(req: Request, deps: HandoffDependencies, now: Date, handoffId: string): Promise<Response> {
  const url = new URL(req.url)
  const supplied = bearerToken(req)
  if (supplied) {
    requireToken(req, 'AI_HANDOFF_READ_TOKEN', deps)
  } else {
    const capability = url.searchParams.get('cap') ?? ''
    const secret = deps.env('AI_HANDOFF_LINK_SECRET')?.trim() ?? ''
    if (!capability || !(await verifyCapability(secret, capability, handoffId, Math.floor(now.getTime() / 1000)))) {
      fail(401, 'unauthorized')
    }
  }
  const locator = await readLocator(deps.storage, handoffId)
  const manifest = parseManifest(await deps.storage.readJson(locator.manifest_key), locator)
  const assets = await Promise.all(manifest.assets.map(async (asset) => ({
    filename: asset.filename,
    mime_type: asset.mime_type,
    size_bytes: asset.size_bytes,
    sha256: asset.sha256,
    purpose: asset.purpose,
    ...(await deps.storage.signDownload(asset.object_key)),
  })))
  return json({ manifest, assets })
}

async function purge(req: Request, deps: HandoffDependencies, handoffId: string): Promise<Response> {
  requireToken(req, 'AI_HANDOFF_WRITE_TOKEN', deps)
  await parseBody(req)
  const storage = deps.storage
  const locator = await readLocator(storage, handoffId)
  if (locator.type !== 'temporary' || locator.status !== 'temporary') fail(403, 'approved_handoff_cannot_be_purged')
  const manifestValue = await storage.readJson(locator.manifest_key)
  const initValue = await storage.readJson(locator.init_key)
  const record = manifestValue ? parseManifest(manifestValue, locator) : initValue ? parseInit(initValue, locator) : null
  const assets = record?.assets ?? []
  for (const asset of assets) await storage.delete(asset.object_key)
  await storage.delete(locator.manifest_key)
  await storage.delete(locator.init_key)
  await storage.delete(locatorKey(handoffId))
  return json({ success: true, handoff_id: handoffId, purged: true })
}

export function createAiHandoffHandler(deps: HandoffDependencies) {
  return async (req: Request): Promise<Response> => {
    try {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204 })
      const route = routeFrom(new URL(req.url))
      const now = deps.now?.() ?? new Date()
      if (req.method === 'POST' && route === '/v1/handoffs/init') return await initialize(req, deps, now)
      if (req.method === 'POST' && route === '/v1/handoffs/commit') return await commit(req, deps, now)
      const linkId = handoffIdFromRoute(route, '/link')
      if (req.method === 'POST' && linkId) return await createLink(req, deps, now, linkId)
      const purgeId = handoffIdFromRoute(route, '/purge')
      if (req.method === 'POST' && purgeId) return await purge(req, deps, purgeId)
      const readId = handoffIdFromRoute(route)
      if (req.method === 'GET' && readId) return await readHandoff(req, deps, now, readId)
      return json({ error: 'not_found' }, 404)
    } catch (error) {
      if (error instanceof ApiError) return json({ error: error.code }, error.status)
      deps.reportError?.(error instanceof Error ? error.name : 'unknown_error')
      return json({ error: 'internal_error' }, 500)
    }
  }
}
