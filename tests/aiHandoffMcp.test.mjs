import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import {
  AdapterError,
  B2_MAX_ASSET_BYTES,
  MCP_TOOL_DESCRIPTION,
  MCP_TOOL_METADATA,
  MCP_TOOL_NAME,
  createAuthenticatedMcpHandler,
  generateHandoffId,
  isPublicIp,
  publishNelyonHandoff,
} from '../supabase/functions/ai-handoff-mcp/core.ts'

const MCP_TOKEN = 'm'.repeat(64)
const WRITE_TOKEN = 'w'.repeat(64)
const FILE_BYTES = new TextEncoder().encode('hello')
const FILE_HASH = createHash('sha256').update(FILE_BYTES).digest('hex')

function fileReference(overrides = {}) {
  return {
    download_url: 'https://files.openai.test/asset-token',
    file_id: 'file_test_123',
    mime_type: 'text/plain',
    file_name: 'hello.txt',
    ...overrides,
  }
}

function validInput(overrides = {}) {
  return {
    type: 'temporary',
    status: 'temporary',
    files: [fileReference()],
    purpose: 'smoke asset',
    expires_in_seconds: 600,
    ...overrides,
  }
}

function fixture(options = {}) {
  const calls = []
  let committed = false
  const fetchImpl = async (url, init = {}) => {
    const href = String(url)
    if (href.startsWith('https://files.openai.test/')) {
      calls.push({ kind: 'download', href })
      return new Response(options.fileBytes ?? FILE_BYTES, {
        status: 200,
        headers: {
          'Content-Type': options.downloadContentType ?? 'text/plain',
          'Content-Length': String(options.contentLength ?? (options.fileBytes ?? FILE_BYTES).length),
        },
      })
    }
    if (href.endsWith('/v1/handoffs/init')) {
      calls.push({ kind: 'init', body: JSON.parse(String(init.body)), headers: init.headers })
      if (committed || options.initConflict) return new Response(JSON.stringify({ error: 'handoff_exists' }), { status: 409 })
      const body = JSON.parse(String(init.body))
      return Response.json({
        schema_version: 1,
        handoff_id: body.handoff_id,
        uploads: body.assets.map((asset) => ({
          filename: asset.filename,
          method: 'PUT',
          url: `https://upload.r2.test/${encodeURIComponent(asset.filename)}`,
          headers: {
            'Content-Type': asset.mime_type,
            'If-None-Match': '*',
            'x-amz-meta-sha256': asset.sha256,
          },
          expiresAt: '2030-01-01T00:05:00.000Z',
        })),
      })
    }
    if (href.startsWith('https://upload.r2.test/')) {
      calls.push({ kind: 'put', href, headers: structuredClone(init.headers), bytes: new Uint8Array(init.body) })
      return new Response(null, { status: options.putStatus ?? 200 })
    }
    if (href.endsWith('/v1/handoffs/commit')) {
      calls.push({ kind: 'commit', body: JSON.parse(String(init.body)) })
      committed = true
      return Response.json({ success: true, manifest: {} })
    }
    if (href.includes('/link')) {
      calls.push({ kind: 'link', body: JSON.parse(String(init.body)) })
      const handoffId = decodeURIComponent(href.split('/').at(-2))
      return Response.json({
        handoff_id: handoffId,
        capability_url: `https://bridge.test/functions/v1/ai-handoff/v1/handoffs/${handoffId}?cap=redacted-capability`,
        expires_at: '2030-01-01T00:10:00.000Z',
      })
    }
    throw new Error(`unexpected fetch: ${href}`)
  }
  const deps = {
    env: (name) => ({
      AI_HANDOFF_MCP_TOKEN: MCP_TOKEN,
      AI_HANDOFF_WRITE_TOKEN: WRITE_TOKEN,
      SUPABASE_URL: 'https://bridge.test',
    })[name],
    fetchImpl,
    resolveHostname: async (hostname) => options.resolvedAddresses ??
      (hostname.endsWith('.test') ? ['93.184.216.34'] : []),
    now: () => new Date('2030-01-02T03:04:05.000Z'),
    randomBytes: (length) => new Uint8Array(length).fill(0xab),
  }
  return { calls, deps }
}

async function expectCode(operation, code) {
  await assert.rejects(operation, (error) => error instanceof AdapterError && error.code === code)
}

test('A. MCP tools/list contract exposes only publish_nelyon_handoff', () => {
  assert.equal(MCP_TOOL_NAME, 'publish_nelyon_handoff')
  assert.match(MCP_TOOL_DESCRIPTION, /canonical AI handoff bridge/u)
})

test('B. tool metadata marks the action as write, non-destructive, and non-idempotent', () => {
  assert.deepEqual(MCP_TOOL_METADATA.annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  })
})

test('C. files are declared through openai/fileParams', () => {
  assert.deepEqual(MCP_TOOL_METADATA._meta, { 'openai/fileParams': ['files'] })
})

test('D. missing MCP token returns 401', async () => {
  const { deps } = fixture()
  const handler = createAuthenticatedMcpHandler(deps, async () => new Response(null, { status: 204 }))
  assert.equal((await handler(new Request('https://bridge.test/mcp', { method: 'POST' }))).status, 401)
})

test('E. incorrect MCP token returns 401', async () => {
  const { deps } = fixture()
  const handler = createAuthenticatedMcpHandler(deps, async () => new Response(null, { status: 204 }))
  const response = await handler(new Request('https://bridge.test/mcp', {
    method: 'POST', headers: { Authorization: `Bearer ${'x'.repeat(64)}` },
  }))
  assert.equal(response.status, 401)
})

test('missing configured MCP secret returns 503', async () => {
  const { deps } = fixture()
  deps.env = (name) => name === 'AI_HANDOFF_MCP_TOKEN' ? undefined : WRITE_TOKEN
  const handler = createAuthenticatedMcpHandler(deps, async () => new Response(null, { status: 204 }))
  assert.equal((await handler(new Request('https://bridge.test/mcp', { method: 'POST' }))).status, 503)
})

test('F. malformed or string file references are rejected', async () => {
  const { deps } = fixture()
  await expectCode(() => publishNelyonHandoff(validInput({ files: ['sandbox://asset.png'] }), deps), 'invalid_file_reference')
  await expectCode(() => publishNelyonHandoff(validInput({ files: [{ download_url: 'https://files.openai.test/a' }] }), deps), 'invalid_file_reference')
})

test('G. a non-HTTPS file reference is rejected', async () => {
  const { deps } = fixture()
  await expectCode(() => publishNelyonHandoff(validInput({ files: [fileReference({ download_url: 'http://files.openai.test/a' })] }), deps), 'unsafe_download_url')
})

test('H. private, loopback, and metadata destinations are rejected before fetch', async () => {
  for (const downloadUrl of [
    'https://127.0.0.1/a',
    'https://169.254.169.254/latest/meta-data',
    'https://localhost/a',
    'https://private.example.test/a',
  ]) {
    const context = fixture({ resolvedAddresses: ['10.0.0.1'] })
    await expectCode(() => publishNelyonHandoff(validInput({ files: [fileReference({ download_url: downloadUrl })] }), context.deps), 'unsafe_download_url')
    assert.equal(context.calls.length, 0)
  }
})

test('expanded IPv6 loopback, unspecified, link-local, and multicast addresses are non-public', () => {
  for (const address of ['0:0:0:0:0:0:0:1', '0:0:0:0:0:0:0:0', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1']) {
    assert.equal(isPublicIp(address), false)
  }
  assert.equal(isPublicIp('2606:4700:4700::1111'), true)
})

test('I. actual bytes and declared MIME must agree with the allowlist', async () => {
  const context = fixture({ fileBytes: new Uint8Array([0, 1, 2]), downloadContentType: 'application/octet-stream' })
  await expectCode(() => publishNelyonHandoff(validInput({ files: [fileReference({ file_name: 'payload.bin', mime_type: 'application/octet-stream' })] }), context.deps), 'mime_not_allowed')
  const mismatch = fixture()
  await expectCode(() => publishNelyonHandoff(validInput({ files: [fileReference({ file_name: 'hello.json', mime_type: 'application/json' })] }), mismatch.deps), 'mime_mismatch')
})

test('J. oversized files are rejected from Content-Length before buffering', async () => {
  const context = fixture({ contentLength: B2_MAX_ASSET_BYTES + 1 })
  await expectCode(() => publishNelyonHandoff(validInput(), context.deps), 'asset_too_large')
  assert.equal(context.calls.filter((call) => call.kind === 'init').length, 0)
})

test('K. SHA-256 is calculated from downloaded bytes', async () => {
  const context = fixture()
  const output = await publishNelyonHandoff(validInput(), context.deps)
  assert.equal(output.assets[0].sha256, FILE_HASH)
})

test('L. B1 init receives only calculated metadata and server-fixed project', async () => {
  const context = fixture()
  await publishNelyonHandoff(validInput({ handoff_id: 'smoke-fixed' }), context.deps)
  const body = context.calls.find((call) => call.kind === 'init').body
  assert.deepEqual(body, {
    handoff_id: 'smoke-fixed',
    project: 'nelyon',
    type: 'temporary',
    status: 'temporary',
    assets: [{ filename: 'hello.txt', mime_type: 'text/plain', size_bytes: 5, sha256: FILE_HASH, purpose: 'smoke asset' }],
  })
  assert.equal(JSON.stringify(body).includes('download_url'), false)
})

test('M. signed PUT uses every and only header returned by B1', async () => {
  const context = fixture()
  await publishNelyonHandoff(validInput(), context.deps)
  const put = context.calls.find((call) => call.kind === 'put')
  assert.deepEqual(put.headers, {
    'Content-Type': 'text/plain',
    'If-None-Match': '*',
    'x-amz-meta-sha256': FILE_HASH,
  })
  assert.deepEqual(put.bytes, FILE_BYTES)
})

test('N. commit happens only after every upload succeeds', async () => {
  const context = fixture()
  await publishNelyonHandoff(validInput(), context.deps)
  assert.deepEqual(context.calls.map((call) => call.kind), ['download', 'init', 'put', 'commit', 'link'])
})

test('O. a failed PUT prevents commit and link creation', async () => {
  const context = fixture({ putStatus: 500 })
  await expectCode(() => publishNelyonHandoff(validInput(), context.deps), 'asset_upload_failed')
  assert.equal(context.calls.some((call) => call.kind === 'commit'), false)
  assert.equal(context.calls.some((call) => call.kind === 'link'), false)
})

test('P. capability link is requested only after commit', async () => {
  const context = fixture()
  await publishNelyonHandoff(validInput(), context.deps)
  assert.ok(context.calls.findIndex((call) => call.kind === 'link') > context.calls.findIndex((call) => call.kind === 'commit'))
})

test('Q. output contains no write token, signed PUT URL, bucket, or internal locator', async () => {
  const context = fixture()
  const output = await publishNelyonHandoff(validInput(), context.deps)
  const serialized = JSON.stringify(output)
  for (const forbidden of [WRITE_TOKEN, 'upload.r2.test', 'bucket', 'object_key', 'download_url', 'internal/ai-handoff']) {
    assert.equal(serialized.includes(forbidden), false)
  }
})

test('R. generated handoff IDs satisfy the B1 regex', () => {
  const generated = generateHandoffId('temporary', new Date('2030-01-02T03:04:05.000Z'), (length) => new Uint8Array(length).fill(0xab))
  assert.equal(generated, 'nelyon-temporary-20300102t030405z-abababababab')
  assert.match(generated, /^[a-z0-9][a-z0-9._-]{0,127}$/u)
})

test('S. retry cannot overwrite an already committed handoff', async () => {
  const context = fixture()
  const input = validInput({ handoff_id: 'no-overwrite' })
  await publishNelyonHandoff(input, context.deps)
  await expectCode(() => publishNelyonHandoff(input, context.deps), 'handoff_exists')
  assert.equal(context.calls.filter((call) => call.kind === 'commit').length, 1)
})
