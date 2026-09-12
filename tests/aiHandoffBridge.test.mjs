import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  AI_HANDOFF_ROOT,
  MAX_ASSET_BYTES,
  createAiHandoffHandler,
} from '../supabase/functions/ai-handoff/core.ts'
import { fetchHandoff, sha256File } from '../scripts/ai-handoff/fetch.mjs'

const WRITE = 'w'.repeat(48)
const READ = 'r'.repeat(48)
const LINK = 'l'.repeat(48)
const HELLO = Buffer.from('hello')
const HELLO_HASH = createHash('sha256').update(HELLO).digest('hex')

class MemoryStorage {
  constructor() {
    this.values = new Map()
  }

  async createJsonIfAbsent(key, value) {
    if (this.values.has(key)) return false
    this.values.set(key, { kind: 'json', value: structuredClone(value) })
    return true
  }

  async readJson(key) {
    const entry = this.values.get(key)
    return entry?.kind === 'json' ? structuredClone(entry.value) : null
  }

  async head(key) {
    const entry = this.values.get(key)
    if (!entry) return null
    if (entry.kind === 'asset') return { size: entry.bytes.length, contentType: entry.mimeType, metadata: entry.metadata }
    return { size: JSON.stringify(entry.value).length, contentType: 'application/json', metadata: {} }
  }

  async delete(key) {
    this.values.delete(key)
  }

  async signUpload(key, mimeType, sha256) {
    return {
      url: `memory://upload/${encodeURIComponent(key)}?sha256=${sha256}`,
      headers: { 'Content-Type': mimeType, 'If-None-Match': '*', 'x-amz-meta-sha256': sha256 },
      expiresAt: '2030-01-01T00:05:00.000Z',
    }
  }

  async signDownload(key) {
    return { url: `memory://download/${encodeURIComponent(key)}`, expiresAt: '2030-01-01T00:05:00.000Z' }
  }

  uploadFor(handoffId, bytes = HELLO, overrides = {}) {
    const init = [...this.values.values()].find((entry) => entry.kind === 'json' && entry.value.record_type === 'init' && entry.value.handoff_id === handoffId)?.value
    assert.ok(init, 'init record must exist')
    for (const asset of init.assets) {
      this.values.set(asset.object_key, {
        kind: 'asset',
        bytes,
        mimeType: overrides.mimeType ?? asset.mime_type,
        metadata: { sha256: overrides.sha256 ?? asset.sha256 },
      })
    }
  }
}

function validInput(overrides = {}) {
  return {
    handoff_id: 'nelyon-brand-v1',
    project: 'nelyon',
    type: 'branding',
    status: 'approved',
    assets: [{ filename: 'brand.txt', mime_type: 'text/plain', size_bytes: HELLO.length, sha256: HELLO_HASH, purpose: 'brand guide' }],
    ...overrides,
  }
}

function fixture() {
  const storage = new MemoryStorage()
  let now = new Date('2030-01-01T00:00:00.000Z')
  const handler = createAiHandoffHandler({
    storage,
    env: (name) => ({ AI_HANDOFF_WRITE_TOKEN: WRITE, AI_HANDOFF_READ_TOKEN: READ, AI_HANDOFF_LINK_SECRET: LINK })[name],
    now: () => now,
    nonce: () => 'fixed-nonce',
  })
  const request = async (route, { method = 'POST', token = WRITE, body = {}, rawUrl } = {}) => {
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    return await handler(new Request(rawUrl ?? `https://bridge.test/functions/v1/ai-handoff${route}`, {
      method,
      headers,
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    }))
  }
  return { storage, request, setNow: (value) => { now = new Date(value) } }
}

async function initAndCommit(context, input = validInput()) {
  const initialized = await context.request('/v1/handoffs/init', { body: input })
  assert.equal(initialized.status, 200)
  context.storage.uploadFor(input.handoff_id)
  const committed = await context.request('/v1/handoffs/commit', { body: { handoff_id: input.handoff_id } })
  assert.equal(committed.status, 200)
  return await committed.json()
}

test('A. valid filename initializes a handoff', async () => {
  const context = fixture()
  const response = await context.request('/v1/handoffs/init', { body: validInput() })
  assert.equal(response.status, 200)
  const upload = (await response.json()).uploads[0]
  assert.equal(upload.filename, 'brand.txt')
  assert.equal(upload.headers['x-amz-meta-sha256'], HELLO_HASH)
})

test('B. traversal filename is rejected', async () => {
  const context = fixture()
  const input = validInput({ assets: [{ ...validInput().assets[0], filename: '../secret.txt' }] })
  assert.equal((await context.request('/v1/handoffs/init', { body: input })).status, 400)
})

test('C. slash path is rejected', async () => {
  const context = fixture()
  const input = validInput({ assets: [{ ...validInput().assets[0], filename: 'nested/secret.txt' }] })
  assert.equal((await context.request('/v1/handoffs/init', { body: input })).status, 400)
})

test('D. invalid handoff id is rejected', async () => {
  const context = fixture()
  assert.equal((await context.request('/v1/handoffs/init', { body: validInput({ handoff_id: '../bad' }) })).status, 400)
})

test('E. disallowed MIME is rejected', async () => {
  const context = fixture()
  const input = validInput({ assets: [{ ...validInput().assets[0], filename: 'run.exe', mime_type: 'application/octet-stream' }] })
  assert.equal((await context.request('/v1/handoffs/init', { body: input })).status, 400)
})

test('F. asset over the per-file limit is rejected', async () => {
  const context = fixture()
  const input = validInput({ assets: [{ ...validInput().assets[0], size_bytes: MAX_ASSET_BYTES + 1 }] })
  assert.equal((await context.request('/v1/handoffs/init', { body: input })).status, 400)
})

test('G. handoff over the total limit is rejected', async () => {
  const context = fixture()
  const assets = Array.from({ length: 6 }, (_, index) => ({
    filename: `asset-${index}.txt`, mime_type: 'text/plain', size_bytes: MAX_ASSET_BYTES, sha256: HELLO_HASH,
  }))
  assert.equal((await context.request('/v1/handoffs/init', { body: validInput({ assets }) })).status, 400)
})

test('H. request without a token returns 401', async () => {
  const context = fixture()
  assert.equal((await context.request('/v1/handoffs/init', { token: null, body: validInput() })).status, 401)
})

test('I. incorrect WRITE token returns 401', async () => {
  const context = fixture()
  assert.equal((await context.request('/v1/handoffs/init', { token: 'x'.repeat(48), body: validInput() })).status, 401)
})

test('J. READ token cannot write', async () => {
  const context = fixture()
  assert.equal((await context.request('/v1/handoffs/init', { token: READ, body: validInput() })).status, 401)
})

test('K. capability for one handoff cannot read another', async () => {
  const context = fixture()
  await initAndCommit(context, validInput({ handoff_id: 'first' }))
  await initAndCommit(context, validInput({ handoff_id: 'second' }))
  const linkResponse = await context.request('/v1/handoffs/first/link', { body: { expires_in_seconds: 60 } })
  const link = (await linkResponse.json()).capability_url
  const wrong = new URL(link)
  wrong.pathname = wrong.pathname.replace('/first', '/second')
  assert.equal((await context.request('', { method: 'GET', token: null, rawUrl: wrong.toString() })).status, 401)
})

test('capability URL restores the public functions gateway path used by the Edge runtime', async () => {
  const context = fixture()
  await initAndCommit(context)
  const response = await context.request('', {
    body: { expires_in_seconds: 60 },
    rawUrl: 'https://bridge.test/ai-handoff/v1/handoffs/nelyon-brand-v1/link',
  })
  const link = new URL((await response.json()).capability_url)
  assert.equal(link.pathname, '/functions/v1/ai-handoff/v1/handoffs/nelyon-brand-v1')
})

test('L. expired capability fails', async () => {
  const context = fixture()
  await initAndCommit(context)
  const linkResponse = await context.request('/v1/handoffs/nelyon-brand-v1/link', { body: { expires_in_seconds: 60 } })
  const link = (await linkResponse.json()).capability_url
  context.setNow('2030-01-01T00:01:01.000Z')
  assert.equal((await context.request('', { method: 'GET', token: null, rawUrl: link })).status, 401)
})

test('M. manipulated capability fails', async () => {
  const context = fixture()
  await initAndCommit(context)
  const linkResponse = await context.request('/v1/handoffs/nelyon-brand-v1/link', { body: { expires_in_seconds: 60 } })
  const link = new URL((await linkResponse.json()).capability_url)
  const capability = link.searchParams.get('cap')
  link.searchParams.set('cap', `${capability.slice(0, -1)}${capability.endsWith('A') ? 'B' : 'A'}`)
  assert.equal((await context.request('', { method: 'GET', token: null, rawUrl: link.toString() })).status, 401)
})

test('N. every object is rooted under the canonical prefix and client keys are forbidden', async () => {
  const context = fixture()
  const response = await context.request('/v1/handoffs/init', { body: validInput() })
  assert.equal(response.status, 200)
  for (const key of context.storage.values.keys()) assert.ok(key.startsWith(`${AI_HANDOFF_ROOT}/`))
  const keyed = validInput({ assets: [{ ...validInput().assets[0], object_key: 'elsewhere/brand.txt' }] })
  assert.equal((await fixture().request('/v1/handoffs/init', { body: keyed })).status, 400)
})

test('O. committed handoff cannot be overwritten', async () => {
  const context = fixture()
  await initAndCommit(context)
  assert.equal((await context.request('/v1/handoffs/commit', { body: { handoff_id: 'nelyon-brand-v1' } })).status, 409)
  assert.equal((await context.request('/v1/handoffs/init', { body: validInput() })).status, 409)
})

test('P. incomplete manifest cannot commit', async () => {
  const context = fixture()
  await context.request('/v1/handoffs/init', { body: validInput() })
  const response = await context.request('/v1/handoffs/commit', { body: { handoff_id: 'nelyon-brand-v1' } })
  assert.equal(response.status, 409)
  assert.equal((await response.json()).error, 'manifest_incomplete')
})

test('Q. fetch script recalculates and verifies SHA-256', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'ai-handoff-good-'))
  await rm(outputDir, { recursive: true })
  const manifest = { schema_version: 1, handoff_id: 'fetch-good', assets: [{ filename: 'brand.txt', mime_type: 'text/plain', size_bytes: 5, sha256: HELLO_HASH }] }
  const fetchImpl = async (url) => url === 'https://cap.test/good'
    ? new Response(JSON.stringify({ manifest, assets: [{ ...manifest.assets[0], url: 'https://asset.test/brand' }] }), { status: 200 })
    : new Response(HELLO, { status: 200 })
  const result = await fetchHandoff({ capabilityUrl: 'https://cap.test/good', outputDir, fetchImpl })
  assert.equal(result.assets_verified, 1)
  assert.equal(await sha256File(path.join(outputDir, 'brand.txt')), HELLO_HASH)
  await rm(outputDir, { recursive: true })
})

test('R. fetch hash mismatch is a hard error and leaves no asset', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'ai-handoff-bad-'))
  await rm(outputDir, { recursive: true })
  const manifest = { schema_version: 1, handoff_id: 'fetch-bad', assets: [{ filename: 'brand.txt', mime_type: 'text/plain', size_bytes: 5, sha256: HELLO_HASH }] }
  const fetchImpl = async (url) => url === 'https://cap.test/bad'
    ? new Response(JSON.stringify({ manifest, assets: [{ ...manifest.assets[0], url: 'https://asset.test/brand' }] }), { status: 200 })
    : new Response(Buffer.from('HELLO'), { status: 200 })
  await assert.rejects(fetchHandoff({ capabilityUrl: 'https://cap.test/bad', outputDir, fetchImpl }), /asset_sha256_mismatch/u)
  assert.deepEqual(await readdir(outputDir), [])
  await rm(outputDir, { recursive: true })
})

test('S. purge removes only a temporary handoff', async () => {
  const context = fixture()
  const input = validInput({ handoff_id: 'smoke-temp', type: 'temporary', status: 'temporary' })
  await initAndCommit(context, input)
  const response = await context.request('/v1/handoffs/smoke-temp/purge', { body: {} })
  assert.equal(response.status, 200)
  assert.equal(context.storage.values.size, 0)
})

test('T. approved handoff purge is denied', async () => {
  const context = fixture()
  await initAndCommit(context)
  const response = await context.request('/v1/handoffs/nelyon-brand-v1/purge', { body: {} })
  assert.equal(response.status, 403)
})

test('READ token can fetch a committed manifest without a capability', async () => {
  const context = fixture()
  await initAndCommit(context)
  const response = await context.request('/v1/handoffs/nelyon-brand-v1', { method: 'GET', token: READ })
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.manifest.handoff_id, 'nelyon-brand-v1')
  assert.equal(payload.assets.length, 1)
})

test('commit rejects size, content type, or SHA metadata mismatch', async () => {
  const cases = [
    [{ bytes: Buffer.from('too-long') }, 'uploaded_object_size_mismatch'],
    [{ mimeType: 'application/json' }, 'uploaded_object_content_type_mismatch'],
    [{ sha256: '0'.repeat(64) }, 'uploaded_object_sha256_mismatch'],
  ]
  for (const [overrides, expectedError] of cases) {
    const context = fixture()
    await context.request('/v1/handoffs/init', { body: validInput() })
    context.storage.uploadFor('nelyon-brand-v1', overrides.bytes ?? HELLO, overrides)
    const response = await context.request('/v1/handoffs/commit', { body: { handoff_id: 'nelyon-brand-v1' } })
    assert.equal(response.status, 409)
    assert.equal((await response.json()).error, expectedError)
  }
})
