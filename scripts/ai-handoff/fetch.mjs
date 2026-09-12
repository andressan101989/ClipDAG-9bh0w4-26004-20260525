#!/usr/bin/env node
import { constants } from 'node:fs'
import { copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SHA256_PATTERN = /^[a-f0-9]{64}$/u

export async function sha256File(filename) {
  return createHash('sha256').update(await readFile(filename)).digest('hex')
}

function safeFilename(filename) {
  return typeof filename === 'string' && filename.length > 0 && filename === path.basename(filename) &&
    !filename.includes('..') && !filename.includes('/') && !filename.includes('\\') && filename.toLowerCase() !== 'manifest.json'
}

export async function fetchHandoff({ capabilityUrl, outputDir, fetchImpl = fetch }) {
  if (!capabilityUrl) throw new Error('AI_HANDOFF_CAPABILITY_URL is required')
  if (!outputDir) throw new Error('--output is required')
  const response = await fetchImpl(capabilityUrl, { headers: { Accept: 'application/json' } })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${response.status}:${payload.error ?? 'handoff_fetch_failed'}`)
  if (!payload.manifest || payload.manifest.schema_version !== 1 || !Array.isArray(payload.manifest.assets) || !Array.isArray(payload.assets)) {
    throw new Error('invalid_manifest_response')
  }
  const manifestByName = new Map(payload.manifest.assets.map((asset) => [asset.filename, asset]))
  if (manifestByName.size !== payload.manifest.assets.length || payload.assets.length !== payload.manifest.assets.length) {
    throw new Error('invalid_asset_set')
  }
  await mkdir(outputDir, { recursive: true })
  const created = []
  try {
    for (const asset of payload.assets) {
      const expected = manifestByName.get(asset.filename)
      if (!expected || !safeFilename(asset.filename) || !SHA256_PATTERN.test(String(expected.sha256 ?? '')) ||
        asset.sha256 !== expected.sha256 || asset.size_bytes !== expected.size_bytes || asset.mime_type !== expected.mime_type) {
        throw new Error('asset_manifest_mismatch')
      }
      const download = await fetchImpl(asset.url)
      if (!download.ok) throw new Error(`asset_download_failed:${asset.filename}:${download.status}`)
      const bytes = Buffer.from(await download.arrayBuffer())
      if (bytes.length !== expected.size_bytes) throw new Error(`asset_size_mismatch:${asset.filename}`)
      const actualHash = createHash('sha256').update(bytes).digest('hex')
      if (actualHash !== expected.sha256) throw new Error(`asset_sha256_mismatch:${asset.filename}`)
      const target = path.join(outputDir, asset.filename)
      const temporary = path.join(outputDir, `.${asset.filename}.${randomUUID()}.part`)
      await writeFile(temporary, bytes, { flag: 'wx' })
      try {
        await copyFile(temporary, target, constants.COPYFILE_EXCL)
      } finally {
        await unlink(temporary).catch(() => {})
      }
      created.push(target)
    }
    const manifestPath = path.join(outputDir, 'manifest.json')
    await writeFile(manifestPath, `${JSON.stringify(payload.manifest, null, 2)}\n`, { flag: 'wx' })
    created.push(manifestPath)
    return { handoff_id: payload.manifest.handoff_id, output_dir: path.resolve(outputDir), assets_verified: payload.assets.length }
  } catch (error) {
    await Promise.allSettled(created.map((filename) => unlink(filename)))
    throw error
  }
}

function parseArguments(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith('--') || !value) throw new Error('arguments must be --name value pairs')
    values[name.slice(2).replaceAll('-', '_')] = value
  }
  return values
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const result = await fetchHandoff({
    capabilityUrl: options.url ?? process.env.AI_HANDOFF_CAPABILITY_URL,
    outputDir: options.output,
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`ai-handoff fetch failed: ${error.message}\n`)
    process.exitCode = 1
  })
}
