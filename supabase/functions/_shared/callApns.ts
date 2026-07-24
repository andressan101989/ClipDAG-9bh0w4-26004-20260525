/* eslint-disable import/no-unresolved */
import { SignJWT, importPKCS8 } from 'https://esm.sh/jose@5.9.6'

const APNS_JWT_MAX_AGE_MS = 45 * 60 * 1000
const APNS_REQUEST_TIMEOUT_MS = 10_000

export type ApnsEnvironment = 'sandbox' | 'production'

export type ApnsConfig = {
  keyId: string
  teamId: string
  privateKey: string
  topic: string
  environment: ApnsEnvironment
}

export type ApnsSendResult = {
  ok: boolean
  apnsId: string | null
  status: number
  reason: string
  message: string
}

type SendApnsParams = {
  config: ApnsConfig
  deliveryId: string
  deviceToken: string
  expiration: string
  payload: Record<string, unknown>
}

let cachedApnsJwt: { token: string; expiresAtMs: number } | null = null

export function sanitizeApnsError(value: unknown): string {
  const message = typeof value === 'string' ? value : String(value ?? '')
  return message.slice(0, 240)
}

export function getApnsConfig(): { config: ApnsConfig | null; error: string | null } {
  const keyId = Deno.env.get('APNS_KEY_ID')?.trim() ?? ''
  const teamId = Deno.env.get('APNS_TEAM_ID')?.trim() ?? ''
  const rawPrivateKey = Deno.env.get('APNS_PRIVATE_KEY') ?? ''
  const topic = Deno.env.get('APNS_TOPIC')?.trim() ?? ''
  const environmentValue = Deno.env.get('APNS_ENVIRONMENT')?.trim().toLowerCase() ?? ''

  if (!keyId || !teamId || !rawPrivateKey || !topic || !environmentValue) {
    return { config: null, error: 'missing APNs configuration' }
  }
  if (environmentValue !== 'sandbox' && environmentValue !== 'production') {
    return { config: null, error: 'invalid APNs environment' }
  }

  return {
    config: {
      keyId,
      teamId,
      privateKey: rawPrivateKey.replace(/\\n/g, '\n').trim(),
      topic,
      environment: environmentValue,
    },
    error: null,
  }
}

async function getApnsJwt(config: ApnsConfig): Promise<string> {
  if (cachedApnsJwt && cachedApnsJwt.expiresAtMs > Date.now() + 30_000) {
    return cachedApnsJwt.token
  }
  try {
    const key = await importPKCS8(config.privateKey, 'ES256')
    const issuedAt = Math.floor(Date.now() / 1000)
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: config.keyId })
      .setIssuer(config.teamId)
      .setIssuedAt(issuedAt)
      .sign(key)
    cachedApnsJwt = { token, expiresAtMs: Date.now() + APNS_JWT_MAX_AGE_MS }
    return token
  } catch (error) {
    throw new Error(`APNS_JWT_FAILED: ${sanitizeApnsError(error)}`)
  }
}

async function parseApnsError(response: Response): Promise<{ reason: string; message: string }> {
  const fallback = `HTTP_${response.status}`
  try {
    const body = await response.json()
    const reason = typeof body?.reason === 'string' && body.reason ? body.reason : fallback
    return { reason, message: sanitizeApnsError(reason) }
  } catch {
    return { reason: fallback, message: sanitizeApnsError(response.statusText || fallback) }
  }
}

async function sendApnsRequest(params: SendApnsParams, jwt: string): Promise<ApnsSendResult> {
  const baseUrl = params.config.environment === 'sandbox'
    ? 'https://api.sandbox.push.apple.com'
    : 'https://api.push.apple.com'
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), APNS_REQUEST_TIMEOUT_MS)
  let response: Response

  try {
    response = await fetch(`${baseUrl}/3/device/${params.deviceToken}`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `bearer ${jwt}`,
        'apns-push-type': 'voip',
        'apns-topic': params.config.topic,
        'apns-priority': '10',
        'apns-expiration': params.expiration,
        'apns-id': params.deliveryId,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ...params.payload, aps: {} }),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, apnsId: null, status: 0, reason: 'APNS_TIMEOUT', message: 'APNs request timed out' }
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }

  const apnsId = response.headers.get('apns-id')
  if (response.ok) {
    return { ok: true, apnsId, status: response.status, reason: 'OK', message: '' }
  }
  const error = await parseApnsError(response)
  return { ok: false, apnsId, status: response.status, reason: error.reason, message: error.message }
}

export async function sendApnsWithRetry(params: SendApnsParams): Promise<ApnsSendResult> {
  const firstJwt = await getApnsJwt(params.config)
  const firstResult = await sendApnsRequest(params, firstJwt)
  if (firstResult.reason !== 'ExpiredProviderToken') return firstResult

  cachedApnsJwt = null
  const retryJwt = await getApnsJwt(params.config)
  return sendApnsRequest(params, retryJwt)
}

export function isInvalidApnsDeviceToken(reason: string): boolean {
  return reason === 'Unregistered' || reason === 'BadDeviceToken'
}
