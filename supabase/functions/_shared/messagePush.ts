export const EXPO_PUSH_SEND_URL = 'https://exp.host/--/api/v2/push/send'
export const EXPO_PUSH_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts'

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function timingSafeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder()
  const a = encoder.encode(left)
  const b = encoder.encode(right)
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i += 1) mismatch |= a[i] ^ b[i]
  return mismatch === 0
}

export function authorizeMessageDispatcher(req: Request): boolean {
  if (req.method !== 'POST') return false
  const expected = Deno.env.get('CALL_DISPATCH_SECRET') ?? ''
  const supplied = req.headers.get('x-message-dispatch-secret') ?? ''
  return expected.length >= 32 && timingSafeEqual(supplied, expected)
}

export function sanitizePreview(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length <= 120 ? compact : `${compact.slice(0, 117)}...`
}

export function isTemporaryExpoError(code: string | null, httpStatus?: number): boolean {
  if (httpStatus === 408 || httpStatus === 429 || (httpStatus ?? 0) >= 500) return true
  return ['MessageRateExceeded', 'ExpoServerError', 'NetworkError'].includes(code ?? '')
}

export function safeError(value: unknown): string {
  if (value instanceof Error) return value.name
  return typeof value === 'string' ? value.slice(0, 120) : 'unknown_error'
}
