const encoder = new TextEncoder()

export const CALL_STATUS_WATCH_PURPOSE = 'call_status_watch'
export const CALL_STATUS_WATCH_TTL_SECONDS = 24 * 60 * 60

export type CallStatusWatchClaims = {
  c: string
  d: string
  e: number
  p: typeof CALL_STATUS_WATCH_PURPOSE
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function base64UrlDecode(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null
  const padded = value.replaceAll('-', '+').replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  try {
    const binary = atob(padded)
    return Uint8Array.from(binary, character => character.charCodeAt(0))
  } catch {
    return null
  }
}

async function hmac(secret: string, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  const length = Math.max(left.length, right.length)
  let difference = left.length ^ right.length
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  }
  return difference === 0
}

export async function createCallStatusWatchToken(
  secret: string,
  claims: CallStatusWatchClaims,
): Promise<string> {
  const payload = base64UrlEncode(encoder.encode(JSON.stringify(claims)))
  const signature = base64UrlEncode(await hmac(secret, payload))
  return `${payload}.${signature}`
}

export async function verifyCallStatusWatchToken(
  secret: string,
  token: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<CallStatusWatchClaims | null> {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [payload, encodedSignature] = parts
  const payloadBytes = base64UrlDecode(payload)
  const signature = base64UrlDecode(encodedSignature)
  if (!payloadBytes || !signature) return null
  const expected = await hmac(secret, payload)
  if (!timingSafeEqual(signature, expected)) return null

  try {
    const claims = JSON.parse(new TextDecoder().decode(payloadBytes)) as Partial<CallStatusWatchClaims>
    if (
      typeof claims.c !== 'string' ||
      typeof claims.d !== 'string' ||
      typeof claims.e !== 'number' ||
      claims.p !== CALL_STATUS_WATCH_PURPOSE ||
      claims.e <= nowSeconds
    ) return null
    return claims as CallStatusWatchClaims
  } catch {
    return null
  }
}
