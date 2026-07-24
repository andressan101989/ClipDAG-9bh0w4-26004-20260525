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
const RETRY_DELAY_MS = 60_000
const TERMINAL_EVENTS = new Set([
  'call_cancelled',
  'call_expired',
  'call_rejected',
  'call_ended',
  'call_answered_elsewhere',
])

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
  terminal_voip_version: number
  voip_push_token: string | null
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function isTerminalPayload(delivery: DeliveryRow): boolean {
  const payload = delivery.payload
  return TERMINAL_EVENTS.has(delivery.event_type) &&
    payload?.type === delivery.event_type &&
    payload?.call_id === delivery.call_id &&
    typeof payload?.status === 'string' &&
    typeof payload?.reason === 'string' &&
    typeof payload?.timestamp === 'string'
}

function isRetryableApnsResult(result: ApnsSendResult): boolean {
  return result.status === 0 || result.status === 429 || result.status >= 500
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

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ success: false, error: 'method not allowed' }, 405)

  // Supabase's gateway verifies the publishable-key/JWT invocation. This
  // additional check rejects direct anonymous HTTP requests before any claim.
  if (!req.headers.get('Authorization')?.startsWith('Bearer ') || !req.headers.get('apikey')) {
    return json({ success: false, error: 'missing authorization' }, 401)
  }

  const dispatchSecret = Deno.env.get('CALL_DISPATCH_SECRET')
  if (!dispatchSecret) {
    return json({ success: false, error: 'dispatch authentication unavailable' }, 503)
  }
  const requestDispatchSecret = req.headers.get('x-call-dispatch-secret') ?? ''
  if (!requestDispatchSecret || !secretsEqual(requestDispatchSecret, dispatchSecret)) {
    return json({ success: false, error: 'invalid dispatch authorization' }, 401)
  }

  if (Deno.env.get('CALL_TERMINAL_VOIP_ENABLED')?.trim().toLowerCase() !== 'true') {
    return json({ success: true, enabled: false, claimed: 0 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ success: false, error: 'server configuration unavailable' }, 503)
  }

  const { config, error: configError } = getApnsConfig()
  if (!config) return json({ success: false, error: sanitizeApnsError(configError) }, 503)

  const admin = createClient(supabaseUrl, serviceRoleKey)
  const { data, error: claimError } = await admin
    .rpc('claim_pending_call_push_deliveries', {
      p_provider: 'apns_voip',
      p_limit: BATCH_LIMIT,
    })
    .returns<DeliveryRow[]>()

  if (claimError) return json({ success: false, error: sanitizeApnsError(claimError.message) }, 500)

  const deliveries = data ?? []
  const summary = {
    claimed: deliveries.length,
    sent: 0,
    retryable: 0,
    permanent_failed: 0,
    skipped: 0,
    stale_worker: 0,
  }

  for (const delivery of deliveries) {
    const updateDelivery = async (patch: Record<string, unknown>): Promise<boolean> => {
      const { data: updated, error } = await admin
        .from('call_push_deliveries')
        .update(patch)
        .eq('id', delivery.delivery_id)
        .eq('status', 'processing')
        .eq('attempt_count', delivery.attempt_count)
        .select('id')
        .maybeSingle<{ id: string }>()
      if (error) throw new Error(`delivery update failed: ${sanitizeApnsError(error.message)}`)
      return Boolean(updated?.id)
    }

    if (!isTerminalPayload(delivery)) {
      const finalized = await updateDelivery({
        status: 'skipped',
        error_code: 'INVALID_TERMINAL_PAYLOAD',
        error_message: 'immutable delivery payload failed validation',
        next_attempt_at: null,
      }).catch(() => {})
      if (finalized) summary.skipped += 1
      else summary.stale_worker += 1
      continue
    }

    const { data: device, error: deviceError } = await admin
      .from('call_devices')
      .select('id, active, platform, terminal_voip_version, voip_push_token')
      .eq('id', delivery.device_id)
      .maybeSingle<DeviceRow>()

    const token = device?.voip_push_token?.trim() ?? ''
    if (deviceError) {
      const finalized = await updateDelivery({
        status: 'failed',
        error_code: 'DEVICE_LOOKUP_FAILED',
        error_message: sanitizeApnsError(deviceError.message),
        next_attempt_at: new Date(Date.now() + RETRY_DELAY_MS).toISOString(),
      }).catch(() => false)
      if (finalized) summary.retryable += 1
      else summary.stale_worker += 1
      continue
    }

    if (!device || !device.active || device.platform !== 'ios' || device.terminal_voip_version < 1 || !token) {
      const finalized = await updateDelivery({
        status: 'skipped',
        error_code: 'DEVICE_NOT_ELIGIBLE',
        error_message: 'device is not terminal VoIP capable',
        next_attempt_at: null,
      }).catch(() => false)
      if (finalized) summary.skipped += 1
      else summary.stale_worker += 1
      continue
    }

    try {
      const { data: owned, error: ownershipError } = await admin
        .from('call_push_deliveries')
        .select('id')
        .eq('id', delivery.delivery_id)
        .eq('status', 'processing')
        .eq('attempt_count', delivery.attempt_count)
        .maybeSingle<{ id: string }>()
      if (ownershipError || !owned?.id) {
        summary.stale_worker += 1
        continue
      }

      const result = await sendApnsWithRetry({
        config,
        deliveryId: delivery.delivery_id,
        deviceToken: token,
        expiration: '0',
        payload: delivery.payload,
      })

      if (result.ok) {
        const finalized = await updateDelivery({
          status: 'sent',
          provider_ticket_id: result.apnsId ?? delivery.delivery_id,
          delivered_at: new Date().toISOString(),
          error_code: null,
          error_message: null,
          next_attempt_at: null,
        })
        if (finalized) summary.sent += 1
        else summary.stale_worker += 1
        continue
      }

      const invalidToken = isInvalidApnsDeviceToken(result.reason)
      const retryable = !invalidToken && isRetryableApnsResult(result)
      if (invalidToken) {
        await admin
          .from('call_devices')
          .update({ voip_push_token: null, terminal_voip_version: 0 })
          .eq('id', device.id)
          .eq('voip_push_token', token)
      }

      const finalized = await updateDelivery({
        status: invalidToken ? 'skipped' : 'failed',
        error_code: sanitizeApnsError(result.reason),
        error_message: sanitizeApnsError(result.message || result.reason),
        next_attempt_at: retryable ? new Date(Date.now() + RETRY_DELAY_MS).toISOString() : null,
      })
      if (!finalized) summary.stale_worker += 1
      else if (invalidToken) summary.skipped += 1
      else if (retryable) summary.retryable += 1
      else summary.permanent_failed += 1
    } catch (error) {
      const finalized = await updateDelivery({
        status: 'failed',
        error_code: 'APNS_SEND_FAILED',
        error_message: sanitizeApnsError(error),
        next_attempt_at: new Date(Date.now() + RETRY_DELAY_MS).toISOString(),
      }).catch(() => false)
      if (finalized) summary.retryable += 1
      else summary.stale_worker += 1
    }
  }

  return json({ success: true, enabled: true, ...summary })
})
