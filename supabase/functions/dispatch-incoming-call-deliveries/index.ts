/* eslint-disable import/no-unresolved */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import {
  getApnsConfig,
  isInvalidApnsDeviceToken,
  sanitizeApnsError,
  sendApnsWithRetry,
  type ApnsSendResult,
} from '../_shared/callApns.ts'

const BATCH_LIMIT = 25
const CLOSE_LIMIT = 100
const RETRY_DELAY_MS = 60_000
const DEFAULT_PRIMARY_LEASE_MS = 10_000
const DEFAULT_WATCHDOG_LEASE_MS = 15_000
const PRIMARY_DEADLINE_WAIT_MAX_MS = 750
const PRIMARY_DEADLINE_MARGIN_MS = 35

type WakeBody = {
  source: 'start_call' | 'watchdog'
  call_id?: string
  lease_id: string
}

type DeliveryRow = {
  delivery_id: string
  call_id: string
  device_id: string
  event_type: string
  payload: Record<string, unknown>
  attempt_count: number
}

type DeviceRow = {
  id: string
  active: boolean
  platform: string
  foreground_presentation_version: number
  voip_push_token: string | null
}

type DispatchSummary = {
  claimed: number
  sent: number
  retryable: number
  permanent_failed: number
  skipped: number
  stale_worker: number
  closed_unprocessable: number
}

type AdminClient = ReturnType<typeof createClient>

const redactId = (value: string) => `${value.slice(0, 8)}…`
const dispatchLog = (event: string, details: Record<string, unknown>) => {
  console.log('[IncomingDispatch]', event, details)
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function emptySummary(): DispatchSummary {
  return {
    claimed: 0,
    sent: 0,
    retryable: 0,
    permanent_failed: 0,
    skipped: 0,
    stale_worker: 0,
    closed_unprocessable: 0,
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function parseWake(value: unknown): WakeBody | null {
  if (!value || typeof value !== 'object') return null
  const body = value as Record<string, unknown>
  if ((body.source !== 'start_call' && body.source !== 'watchdog') || !isUuid(body.lease_id)) return null
  if (body.source === 'start_call') {
    return isUuid(body.call_id)
      ? { source: 'start_call', call_id: body.call_id, lease_id: body.lease_id }
      : null
  }
  if (body.call_id !== undefined && body.call_id !== null) return null
  return { source: 'watchdog', lease_id: body.lease_id }
}

function secretsEqual(actual: string, expected: string): boolean {
  const actualBytes = new TextEncoder().encode(actual)
  const expectedBytes = new TextEncoder().encode(expected)
  const length = Math.max(actualBytes.length, expectedBytes.length)
  let difference = actualBytes.length ^ expectedBytes.length
  for (let index = 0; index < length; index += 1) {
    difference |= (actualBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0)
  }
  return difference === 0
}

function isIncomingPayload(delivery: DeliveryRow): boolean {
  const payload = delivery.payload
  return delivery.event_type === 'incoming_call' &&
    payload?.type === 'incoming_call' &&
    payload?.call_id === delivery.call_id &&
    typeof payload?.caller_id === 'string' &&
    typeof payload?.caller_name === 'string' &&
    (payload?.call_type === 'audio' || payload?.call_type === 'video') &&
    typeof payload?.has_video === 'boolean' &&
    typeof payload?.expires_at === 'string'
}

function apnsExpiration(payload: Record<string, unknown>): string {
  const expiresAt = typeof payload.expires_at === 'string' ? new Date(payload.expires_at).getTime() : Number.NaN
  return Number.isFinite(expiresAt) ? String(Math.floor(expiresAt / 1000)) : '0'
}

function isRetryableApnsResult(result: ApnsSendResult): boolean {
  return result.status === 0 || result.status === 429 || result.status >= 500
}

async function rpcBoolean(
  admin: AdminClient,
  name: string,
  params: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await admin.rpc(name, params)
  if (error) throw new Error(`${name} failed: ${sanitizeApnsError(error.message)}`)
  return data === true
}

async function finalize(
  admin: AdminClient,
  delivery: DeliveryRow,
  leaseId: string,
  params: {
    result: 'sent' | 'failed'
    providerTicketId?: string | null
    errorCode?: string | null
    errorMessage?: string | null
    nextAttemptAt?: string | null
  },
): Promise<boolean> {
  return rpcBoolean(admin, 'finalize_incoming_call_delivery', {
    p_delivery_id: delivery.delivery_id,
    p_expected_attempt: delivery.attempt_count,
    p_lease_id: leaseId,
    p_result: params.result,
    p_provider_ticket_id: params.providerTicketId ?? null,
    p_error_code: params.errorCode ?? null,
    p_error_message: params.errorMessage ?? null,
    p_next_attempt_at: params.nextAttemptAt ?? null,
  })
}

async function clearInvalidToken(admin: AdminClient, device: DeviceRow, token: string) {
  const { error } = await admin
    .from('call_devices')
    .update({ voip_push_token: null, foreground_presentation_version: 0 })
    .eq('id', device.id)
    .eq('voip_push_token', token)
  if (error) console.error('[incoming-dispatch] device token cleanup failed')
}

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ success: false, error: 'method not allowed' }, 405)

  if (!req.headers.get('Authorization')?.startsWith('Bearer ') || !req.headers.get('apikey')) {
    return json({ success: false, error: 'missing authorization' }, 401)
  }
  const dispatchSecret = Deno.env.get('CALL_DISPATCH_SECRET')
  if (!dispatchSecret) return json({ success: false, error: 'dispatch authentication unavailable' }, 503)
  const requestSecret = req.headers.get('x-call-dispatch-secret') ?? ''
  if (!requestSecret || !secretsEqual(requestSecret, dispatchSecret)) {
    return json({ success: false, error: 'invalid dispatch authorization' }, 401)
  }

  const wake = parseWake(await req.json().catch(() => null))
  if (!wake) return json({ success: false, error: 'invalid wake body' }, 400)
  dispatchLog('wake_received', {
    source: wake.source,
    call: wake.call_id ? redactId(wake.call_id) : null,
  })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ success: false, error: 'server configuration unavailable' }, 503)
  }
  const admin = createClient(supabaseUrl, serviceRoleKey)
  const summary = emptySummary()
  let leaseMs = wake.source === 'watchdog' ? DEFAULT_WATCHDOG_LEASE_MS : DEFAULT_PRIMARY_LEASE_MS
  let leaseAlive = true
  let heartbeat: ReturnType<typeof setInterval> | null = null

  const validateLease = () => wake.source === 'watchdog'
    ? rpcBoolean(admin, 'validate_incoming_watchdog_lease', { p_lease_id: wake.lease_id })
    : rpcBoolean(admin, 'validate_incoming_call_dispatch_lease', {
      p_call_id: wake.call_id,
      p_lease_id: wake.lease_id,
    })
  const renewLease = async () => {
    const renewed = wake.source === 'watchdog'
      ? await rpcBoolean(admin, 'renew_incoming_watchdog_lease', {
        p_lease_id: wake.lease_id,
        p_lease_ms: leaseMs,
      })
      : await rpcBoolean(admin, 'renew_incoming_call_dispatch_lease', {
        p_call_id: wake.call_id,
        p_lease_id: wake.lease_id,
        p_lease_ms: leaseMs,
      })
    leaseAlive = leaseAlive && renewed
    return renewed
  }
  const releaseLease = () => wake.source === 'watchdog'
    ? rpcBoolean(admin, 'release_incoming_watchdog_lease', { p_lease_id: wake.lease_id })
    : rpcBoolean(admin, 'release_incoming_call_dispatch_lease', {
      p_call_id: wake.call_id,
      p_lease_id: wake.lease_id,
    })

  try {
    if (!(await validateLease())) return json({ success: false, error: 'invalid or expired lease', ...summary }, 409)
    dispatchLog('lease_acquired', {
      source: wake.source,
      call: wake.call_id ? redactId(wake.call_id) : null,
    })

    const { config, error: configError } = getApnsConfig()
    if (!config) return json({ success: false, error: sanitizeApnsError(configError), ...summary }, 503)

    const { data: configRow } = await admin
      .from('call_presentation_config')
      .select('primary_lease_ms, watchdog_lease_ms')
      .eq('id', true)
      .maybeSingle<{ primary_lease_ms: number; watchdog_lease_ms: number }>()
    const configuredLeaseMs = wake.source === 'watchdog'
      ? configRow?.watchdog_lease_ms
      : configRow?.primary_lease_ms
    if (typeof configuredLeaseMs === 'number' && configuredLeaseMs >= 250 && configuredLeaseMs <= 60_000) {
      leaseMs = configuredLeaseMs
    }

    if (!(await renewLease())) return json({ success: false, error: 'lease renewal failed', ...summary }, 409)
    heartbeat = setInterval(() => {
      renewLease().catch(() => { leaseAlive = false })
    }, Math.max(250, Math.floor(leaseMs / 3)))

    if (wake.source === 'watchdog') {
      const { data, error } = await admin.rpc('close_unprocessable_incoming_call_presentations', {
        p_limit: CLOSE_LIMIT,
      })
      if (error) throw new Error(`close failed: ${sanitizeApnsError(error.message)}`)
      summary.closed_unprocessable = typeof data === 'number' ? data : 0
    }

    if (!leaseAlive || !(await renewLease())) {
      return json({ success: false, error: 'lease renewal failed', ...summary }, 409)
    }
    const claimDeliveries = async () => {
      const { data, error } = await admin.rpc('claim_incoming_call_deliveries', {
        p_lease_id: wake.lease_id,
        p_call_id: wake.source === 'start_call' ? wake.call_id : null,
        p_limit: BATCH_LIMIT,
      })
      .returns<DeliveryRow[]>()
      if (error) throw new Error(`claim failed: ${sanitizeApnsError(error.message)}`)
      return (data ?? []).filter(delivery => delivery.event_type === 'incoming_call')
    }

    let deliveries = await claimDeliveries()
    if (wake.source === 'start_call' && deliveries.length === 0 && wake.call_id) {
      const { data: pending } = await admin
        .from('call_push_deliveries')
        .select('claim_deadline_at, status, presentation_owner, presentation_version')
        .eq('call_id', wake.call_id)
        .eq('event_type', 'incoming_call')
        .eq('provider', 'apns_voip')
        .gte('presentation_version', 1)
        .maybeSingle<{
          claim_deadline_at: string | null
          status: string
          presentation_owner: string | null
          presentation_version: number
        }>()
      const deadlineMs = pending?.claim_deadline_at ? new Date(pending.claim_deadline_at).getTime() : Number.NaN
      const remainingMs = deadlineMs - Date.now()
      if (pending?.status === 'pending' && pending.presentation_owner === null &&
          Number.isFinite(remainingMs) && remainingMs > 0) {
        const waitMs = Math.min(PRIMARY_DEADLINE_WAIT_MAX_MS, Math.ceil(remainingMs) + PRIMARY_DEADLINE_MARGIN_MS)
        dispatchLog('primary_deadline_wait', { call: redactId(wake.call_id), waitMs })
        await new Promise(resolve => setTimeout(resolve, waitMs))
        if (leaseAlive && await renewLease()) deliveries = await claimDeliveries()
      }
    }

    summary.claimed = deliveries.length
    dispatchLog('deliveries_claimed', { source: wake.source, claimed: summary.claimed })

    for (const delivery of deliveries) {
      if (!leaseAlive || !(await renewLease())) {
        summary.stale_worker += 1
        break
      }
      if (!isIncomingPayload(delivery)) {
        const marked = await rpcBoolean(admin, 'mark_incoming_call_delivery_send_started', {
          p_delivery_id: delivery.delivery_id,
          p_expected_attempt: delivery.attempt_count,
          p_lease_id: wake.lease_id,
        })
        if (!marked) summary.stale_worker += 1
        else if (await finalize(admin, delivery, wake.lease_id, {
          result: 'failed',
          errorCode: 'INVALID_INCOMING_PAYLOAD',
          errorMessage: 'immutable delivery payload failed validation',
        })) summary.skipped += 1
        else summary.stale_worker += 1
        continue
      }

      const { data: device, error: deviceError } = await admin
        .from('call_devices')
        .select('id, active, platform, foreground_presentation_version, voip_push_token')
        .eq('id', delivery.device_id)
        .maybeSingle<DeviceRow>()
      const token = device?.voip_push_token?.trim() ?? ''
      const deviceEligible = !deviceError && device?.active && device.platform === 'ios' &&
        device.foreground_presentation_version >= 1 && token.length > 0
      dispatchLog('delivery_eligibility', {
        delivery: redactId(delivery.delivery_id),
        eligible: Boolean(deviceEligible),
        attempt: delivery.attempt_count,
      })

      if (!leaseAlive || !(await renewLease())) {
        summary.stale_worker += 1
        break
      }
      const marked = await rpcBoolean(admin, 'mark_incoming_call_delivery_send_started', {
        p_delivery_id: delivery.delivery_id,
        p_expected_attempt: delivery.attempt_count,
        p_lease_id: wake.lease_id,
      })
      if (!marked) {
        summary.stale_worker += 1
        continue
      }

      if (deviceError) {
        const finalized = await finalize(admin, delivery, wake.lease_id, {
          result: 'failed',
          errorCode: 'DEVICE_LOOKUP_FAILED',
          errorMessage: sanitizeApnsError('device lookup failed'),
          nextAttemptAt: new Date(Date.now() + RETRY_DELAY_MS).toISOString(),
        })
        if (finalized) summary.retryable += 1
        else summary.stale_worker += 1
        continue
      }

      if (!deviceEligible || !device) {
        const finalized = await finalize(admin, delivery, wake.lease_id, {
          result: 'failed',
          errorCode: 'DEVICE_NOT_ELIGIBLE',
          errorMessage: 'device is not foreground presentation capable',
        })
        if (finalized) summary.skipped += 1
        else summary.stale_worker += 1
        continue
      }

      try {
        dispatchLog('send_attempted', {
          delivery: redactId(delivery.delivery_id),
          attempt: delivery.attempt_count,
        })
        const result = await sendApnsWithRetry({
          config,
          deliveryId: delivery.delivery_id,
          deviceToken: token,
          expiration: apnsExpiration(delivery.payload),
          payload: delivery.payload,
        })
        if (result.ok) {
          const finalized = await finalize(admin, delivery, wake.lease_id, {
            result: 'sent',
            providerTicketId: result.apnsId ?? delivery.delivery_id,
          })
          if (finalized) summary.sent += 1
          else summary.stale_worker += 1
          dispatchLog('apns_finalized', {
            delivery: redactId(delivery.delivery_id),
            classification: finalized ? 'sent' : 'stale_worker',
          })
          continue
        }

        const invalidToken = isInvalidApnsDeviceToken(result.reason)
        const retryable = !invalidToken && isRetryableApnsResult(result)
        if (invalidToken) await clearInvalidToken(admin, device, token)
        const finalized = await finalize(admin, delivery, wake.lease_id, {
          result: 'failed',
          errorCode: sanitizeApnsError(result.reason || `HTTP_${result.status}`),
          errorMessage: sanitizeApnsError(result.message || result.reason || 'unexpected APNs response'),
          nextAttemptAt: retryable ? new Date(Date.now() + RETRY_DELAY_MS).toISOString() : null,
        })
        if (!finalized) summary.stale_worker += 1
        else if (retryable) summary.retryable += 1
        else summary.permanent_failed += 1
        dispatchLog('apns_finalized', {
          delivery: redactId(delivery.delivery_id),
          classification: !finalized ? 'stale_worker' : retryable ? 'retryable' : 'permanent',
        })
      } catch (error) {
        const finalized = await finalize(admin, delivery, wake.lease_id, {
          result: 'failed',
          errorCode: 'APNS_SEND_FAILED',
          errorMessage: sanitizeApnsError(error),
          nextAttemptAt: new Date(Date.now() + RETRY_DELAY_MS).toISOString(),
        }).catch(() => false)
        if (finalized) summary.retryable += 1
        else summary.stale_worker += 1
        dispatchLog('apns_finalized', {
          delivery: redactId(delivery.delivery_id),
          classification: finalized ? 'retryable_exception' : 'stale_worker',
        })
      }
    }

    return json({ success: true, ...summary })
  } catch (error) {
    console.error('[incoming-dispatch] dispatch failed', sanitizeApnsError(error))
    return json({ success: false, error: 'dispatch failed', ...summary }, 500)
  } finally {
    if (heartbeat) clearInterval(heartbeat)
    const released = await releaseLease().catch(() => false)
    dispatchLog('lease_released', { source: wake.source, released })
  }
})
