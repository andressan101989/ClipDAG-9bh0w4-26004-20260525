import { createAiHandoffHandler } from './core.ts'
import { R2_PRIVATE_BUCKET, signDelete, signGet, signHead, signPutIfAbsent } from '../_shared/r2.ts'

const privateBucket = R2_PRIVATE_BUCKET()

async function r2Fetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

const storage = {
  async createJsonIfAbsent(key: string, value: unknown) {
    const url = await signPutIfAbsent(privateBucket, key, 'application/json', {})
    const response = await r2Fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-None-Match': '*' },
      body: JSON.stringify(value),
    })
    if (response.status === 409 || response.status === 412) return false
    if (!response.ok) throw new Error(`r2_write_${response.status}`)
    return true
  },
  async readJson(key: string) {
    const response = await r2Fetch(await signGet(privateBucket, key, 60), { method: 'GET' })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`r2_read_${response.status}`)
    return await response.json()
  },
  async head(key: string) {
    const response = await r2Fetch(await signHead(privateBucket, key), { method: 'HEAD' })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`r2_head_${response.status}`)
    let size = Number(response.headers.get('Content-Length'))
    if (!Number.isSafeInteger(size) || size < 1) {
      const rangeResponse = await r2Fetch(await signGet(privateBucket, key, 60), {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
      })
      if (!rangeResponse.ok) throw new Error(`r2_range_${rangeResponse.status}`)
      const match = rangeResponse.headers.get('Content-Range')?.match(/\/(\d+)$/u)
      size = match ? Number(match[1]) : Number.NaN
      await rangeResponse.body?.cancel()
    }
    if (!Number.isSafeInteger(size) || size < 1) throw new Error('r2_size_unavailable')
    return {
      size,
      contentType: String(response.headers.get('Content-Type') ?? '').toLowerCase(),
      metadata: { sha256: response.headers.get('x-amz-meta-sha256') ?? '' },
    }
  },
  async delete(key: string) {
    const response = await r2Fetch(await signDelete(privateBucket, key), { method: 'DELETE' })
    if (!response.ok && response.status !== 404) throw new Error(`r2_delete_${response.status}`)
  },
  async signUpload(key: string, mimeType: string, sha256: string) {
    const url = await signPutIfAbsent(privateBucket, key, mimeType, { sha256 })
    return {
      url,
      headers: {
        'Content-Type': mimeType,
        'If-None-Match': '*',
        'x-amz-meta-sha256': sha256,
      },
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    }
  },
  async signDownload(key: string) {
    return {
      url: await signGet(privateBucket, key, 300),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    }
  },
}

Deno.serve(createAiHandoffHandler({
  storage,
  env: (name) => Deno.env.get(name),
  reportError: (name) => console.error('[ai-handoff] request failed', name),
}))
