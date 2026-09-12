#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const MIME_BY_EXTENSION = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.pdf', 'application/pdf'],
  ['.zip', 'application/zip'],
  ['.json', 'application/json'],
  ['.txt', 'text/plain'],
  ['.md', 'text/plain'],
  ['.log', 'text/plain'],
])

export function parseArguments(argv) {
  const values = { files: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (!name.startsWith('--')) throw new Error(`unexpected_argument:${name}`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`missing_value:${name}`)
    index += 1
    if (name === '--file') values.files.push(value)
    else values[name.slice(2).replaceAll('-', '_')] = value
  }
  return values
}

export async function sha256File(filename) {
  return createHash('sha256').update(await readFile(filename)).digest('hex')
}

async function requestJson(url, token, init) {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${response.status}:${body.error ?? 'request_failed'}`)
  return body
}

export async function uploadHandoff(options, env = process.env) {
  const endpoint = String(options.endpoint ?? env.AI_HANDOFF_ENDPOINT ?? '').replace(/\/+$/u, '')
  const token = env.AI_HANDOFF_WRITE_TOKEN ?? ''
  if (!endpoint) throw new Error('AI_HANDOFF_ENDPOINT is required')
  if (token.length < 32) throw new Error('AI_HANDOFF_WRITE_TOKEN is required')

  if (options.purge) {
    return await requestJson(`${endpoint}/v1/handoffs/${encodeURIComponent(options.purge)}/purge`, token, {
      method: 'POST',
      body: '{}',
    })
  }

  const handoffId = options.handoff_id
  const project = options.project
  const type = options.type
  const status = options.status
  if (!handoffId || !project || !type || !status || options.files.length < 1) {
    throw new Error('--handoff-id, --project, --type, --status and at least one --file are required')
  }
  const assets = await Promise.all(options.files.map(async (filename) => {
    const absolute = path.resolve(filename)
    const details = await stat(absolute)
    if (!details.isFile()) throw new Error(`not_a_file:${filename}`)
    const mimeType = MIME_BY_EXTENSION.get(path.extname(absolute).toLowerCase())
    if (!mimeType) throw new Error(`unsupported_extension:${filename}`)
    return {
      absolute,
      filename: path.basename(absolute),
      mime_type: mimeType,
      size_bytes: details.size,
      sha256: await sha256File(absolute),
      purpose: options.purpose ?? type,
    }
  }))

  const initialized = await requestJson(`${endpoint}/v1/handoffs/init`, token, {
    method: 'POST',
    body: JSON.stringify({
      handoff_id: handoffId,
      project,
      type,
      status,
      assets: assets.map(({ absolute: _absolute, ...asset }) => asset),
    }),
  })
  const uploads = new Map(initialized.uploads.map((upload) => [upload.filename, upload]))
  for (const asset of assets) {
    const upload = uploads.get(asset.filename)
    if (!upload) throw new Error(`missing_upload:${asset.filename}`)
    const response = await fetch(upload.url, {
      method: 'PUT',
      headers: upload.headers,
      body: await readFile(asset.absolute),
    })
    if (!response.ok) throw new Error(`upload_failed:${asset.filename}:${response.status}`)
  }
  const committed = await requestJson(`${endpoint}/v1/handoffs/commit`, token, {
    method: 'POST',
    body: JSON.stringify({ handoff_id: handoffId }),
  })
  const linked = await requestJson(`${endpoint}/v1/handoffs/${encodeURIComponent(handoffId)}/link`, token, {
    method: 'POST',
    body: JSON.stringify({ expires_in_seconds: Number(options.expires ?? 3600) }),
  })
  return {
    handoff_id: handoffId,
    manifest: committed.manifest,
    capability_url: linked.capability_url,
    capability_expires_at: linked.expires_at,
  }
}

async function main() {
  const result = await uploadHandoff(parseArguments(process.argv.slice(2)))
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`ai-handoff upload failed: ${error.message}\n`)
    process.exitCode = 1
  })
}
