/* eslint-disable import/no-unresolved */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import {
  getApnsConfig as getSharedApnsConfig,
  sendApnsWithRetry as sendSharedApnsWithRetry,
} from '../_shared/callApns.ts'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
const MAX_BATCH_SIZE = 100
const DEVICE_MAX_AGE_DAYS = 90

type EventType = 'incoming_call' | 'call_cancelled' | 'call_ended'

type CallRow = {
  id: string
  caller_id: string
  callee_id: string
  status: string
  call_type: 'audio' | 'video'
  expires_at: string | null
  caller_device_id: string | null
}

type ProfileRow = {
  username?: string | null
  display_name?: string | null
  avatar_url?: string | null
}

type ExpoDeviceRow = {
  id: string
  expo_push_token: string
  platform: string
}

type ApnsDeviceRow = {
  id: string
  voip_push_token: string
}

type DeliveryClaimRow = {
  delivery_id: string
  attempt_count: number
}

type ChannelSummary = {
  sent: number
  skipped: number
  failed: number
  authoritative?: number
  retryable?: number
  error?: string
}

type SupabaseAdminClient = ReturnType<typeof createClient>

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function isEventType(value: unknown): value is EventType {
  return value === 'incoming_call' || value === 'call_cancelled' || value === 'call_ended'
}

function sanitizeErrorMessage(value: unknown): string {
  const message = typeof value === 'string' ? value : String(value ?? '')
  return message.slice(0, 240)
}

function getTtlSeconds(expiresAt: string | null): number {
  if (!expiresAt) return 45
  const ttl = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)
  return Number.isFinite(ttl) ? Math.max(1, Math.min(ttl, 3600)) : 45
}

function getApnsExpiration(expiresAt: string | null): string {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const fallback = nowSeconds + 45

  if (!expiresAt) {
    return String(fallback)
  }

  const expiresAtMs = new Date(expiresAt).getTime()
  if (!Number.isFinite(expiresAtMs)) {
    return String(fallback)
  }

  const expiresAtSeconds = Math.floor(expiresAtMs / 1000)
  return String(expiresAtSeconds)
}

function isCallExpiredForApns(call: CallRow): boolean {
  if (!call.expires_at) return false
  const expiresAtMs = new Date(call.expires_at).getTime()
  return Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function createSummary(): ChannelSummary {
  return { sent: 0, skipped: 0, failed: 0 }
}

function setSummaryError(summary: ChannelSummary, error: unknown) {
  summary.error = sanitizeErrorMessage(error)
}

function getCallerName(callerProfile: ProfileRow | null): string {
  return callerProfile?.display_name || callerProfile?.username || 'Llamada entrante'
}

async function updateDelivery(
  admin: SupabaseAdminClient,
  deliveryId: string,
  patch: Record<string, unknown>,
) {
  const { error } = await admin
    .from('call_push_deliveries')
    .update(patch)
    .eq('id', deliveryId)

  if (error) {
    throw new Error(`delivery update failed: ${sanitizeErrorMessage(error.message)}`)
  }
}

async function markApnsSent(
  admin: SupabaseAdminClient,
  deliveryId: string,
  providerTicketId: string | null,
) {
  // APNs is an external side effect; using deliveryId as apns-id makes retries
  // correlate to the same DB row if persistence fails after Apple accepts it.
  await updateDelivery(admin, deliveryId, {
    status: 'sent',
    provider_ticket_id: providerTicketId ?? deliveryId,
    attempted_at: new Date().toISOString(),
    delivered_at: new Date().toISOString(),
    error_code: null,
    error_message: null,
  })
}

async function markApnsFailed(
  admin: SupabaseAdminClient,
  deliveryId: string,
  reason: string,
  message: string,
) {
  await updateDelivery(admin, deliveryId, {
    status: 'failed',
    attempted_at: new Date().toISOString(),
    error_code: sanitizeErrorMessage(reason),
    error_message: sanitizeErrorMessage(message),
  })
}

async function markApnsSkipped(
  admin: SupabaseAdminClient,
  deliveryId: string,
  reason: string,
  message: string,
) {
  await updateDelivery(admin, deliveryId, {
    status: 'skipped',
    attempted_at: new Date().toISOString(),
    error_code: sanitizeErrorMessage(reason),
    error_message: sanitizeErrorMessage(message),
  })
}

async function clearExactVoipToken(
  admin: SupabaseAdminClient,
  deviceId: string,
  tokenSent: string,
) {
  const { error } = await admin
    .from('call_devices')
    .update({
      voip_push_token: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', deviceId)
    .eq('voip_push_token', tokenSent)

  if (error) {
    throw new Error(`voip token cleanup failed: ${sanitizeErrorMessage(error.message)}`)
  }
}

async function sendExpoNotifications(
  admin: SupabaseAdminClient,
  call: CallRow,
  eventType: EventType,
  recipientId: string,
  callerProfile: ProfileRow | null,
): Promise<{ summary: ChannelSummary; deviceCount: number }> {
  const summary = createSummary()
  const since = new Date(Date.now() - DEVICE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { data: devices, error: devicesError } = await admin
    .from('call_devices')
    .select('id, expo_push_token, platform')
    .eq('user_id', recipientId)
    .eq('active', true)
    .not('expo_push_token', 'is', null)
    .gte('last_seen_at', since)
    .returns<ExpoDeviceRow[]>()

  if (devicesError) {
    throw new Error(devicesError.message)
  }

  const expoDevices = (devices ?? [])
    .filter(device => typeof device.expo_push_token === 'string' && device.expo_push_token.startsWith('ExponentPushToken'))
    .filter(device => device.id !== call.caller_device_id)
    // Incoming calls on iOS have a single presentation authority:
    // D4D/PushKit. Expo remains the incoming transport for Android only.
    .filter(device => eventType !== 'incoming_call' || device.platform !== 'ios')

  const toSend: { device: ExpoDeviceRow; deliveryId: string }[] = []

  for (const device of expoDevices) {
    const { error: insertError } = await admin
      .from('call_push_deliveries')
      .upsert({
        call_id: call.id,
        device_id: device.id,
        event_type: eventType,
        provider: 'expo',
        status: 'pending',
      }, {
        onConflict: 'call_id,device_id,event_type,provider',
        ignoreDuplicates: true,
      })

    if (insertError) {
      summary.failed += 1
      continue
    }

    const { data: delivery, error: deliveryError } = await admin
      .from('call_push_deliveries')
      .select('id, status')
      .eq('call_id', call.id)
      .eq('device_id', device.id)
      .eq('event_type', eventType)
      .eq('provider', 'expo')
      .maybeSingle()

    if (deliveryError || !delivery?.id) {
      summary.failed += 1
      continue
    }

    if (delivery.status !== 'pending') {
      summary.skipped += 1
      continue
    }

    toSend.push({ device, deliveryId: delivery.id })
  }

  const callerName = getCallerName(callerProfile)
  const title = eventType === 'incoming_call'
    ? callerName
    : 'Llamada actualizada'
  const body = eventType === 'incoming_call'
    ? (call.call_type === 'audio' ? 'Llamada de audio entrante' : 'Videollamada entrante')
    : 'La llamada ya no esta disponible'

  for (const batch of chunk(toSend, MAX_BATCH_SIZE)) {
    const messages = batch.map(({ device }) => ({
      to: device.expo_push_token,
      title,
      body,
      sound: 'default',
      priority: 'high',
      channelId: 'calls',
      ttl: getTtlSeconds(call.expires_at),
      data: {
        type: eventType,
        call_id: call.id,
        caller_id: call.caller_id,
        caller_name: callerName,
        caller_avatar: callerProfile?.avatar_url ?? null,
        call_type: call.call_type,
        expires_at: call.expires_at,
      },
    }))

    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify(messages),
    })

    const result = await response.json().catch(() => ({ data: [] }))
    const tickets = Array.isArray(result?.data) ? result.data : []

    for (let index = 0; index < batch.length; index += 1) {
      const { device, deliveryId } = batch[index]
      const ticket = tickets[index]
      const ticketStatus = ticket?.status

      if (ticketStatus === 'ok') {
        try {
          await updateDelivery(admin, deliveryId, {
            status: 'sent',
            provider_ticket_id: ticket.id ?? null,
            attempted_at: new Date().toISOString(),
            delivered_at: new Date().toISOString(),
            error_code: null,
            error_message: null,
          })
          summary.sent += 1
        } catch (error) {
          console.error('[send-call-notification] Expo sent delivery update failed', sanitizeErrorMessage(error))
          summary.failed += 1
        }
      } else {
        const errorCode = ticket?.details?.error ?? ticket?.status ?? 'unknown'
        const errorMessage = sanitizeErrorMessage(ticket?.message ?? response.statusText)
        try {
          await updateDelivery(admin, deliveryId, {
            status: 'failed',
            attempted_at: new Date().toISOString(),
            error_code: errorCode,
            error_message: errorMessage,
          })
          summary.failed += 1
        } catch (error) {
          console.error('[send-call-notification] Expo failed delivery update failed', sanitizeErrorMessage(error))
          summary.failed += 1
        }

        if (errorCode === 'DeviceNotRegistered') {
          const { error } = await admin
            .from('call_devices')
            .update({ active: false, expo_push_token: null })
            .eq('id', device.id)

          if (error) {
            console.error('[send-call-notification] Expo device cleanup failed', sanitizeErrorMessage(error.message))
          }
        }
      }
    }
  }

  return { summary, deviceCount: expoDevices.length }
}

async function sendApnsVoipNotifications(
  admin: SupabaseAdminClient,
  call: CallRow,
  eventType: EventType,
  callerName: string,
): Promise<ChannelSummary> {
  const summary = createSummary()

  if (eventType !== 'incoming_call') {
    return summary
  }

  const { data: devices, error: devicesError } = await admin
    .from('call_devices')
    .select('id, voip_push_token')
    .eq('user_id', call.callee_id)
    .eq('platform', 'ios')
    .eq('active', true)
    .not('voip_push_token', 'is', null)
    .returns<ApnsDeviceRow[]>()

  if (devicesError) {
    throw new Error(devicesError.message)
  }

  const recipientDevices = (devices ?? [])
    .filter(device => typeof device.voip_push_token === 'string' && device.voip_push_token.trim().length > 0)
    .filter(device => device.id !== call.caller_device_id)

  if (recipientDevices.length === 0) {
    return summary
  }

  const { config, error: configError } = getSharedApnsConfig()
  if (!config) {
    console.error('[send-call-notification] APNs disabled:', configError)
    summary.skipped += recipientDevices.length
    summary.error = sanitizeErrorMessage(configError)
    return summary
  }

  let stopApnsBatch = false

  for (const device of recipientDevices) {
    if (stopApnsBatch) {
      summary.skipped += 1
      continue
    }

    // D4D ownership is represented by the authoritative outbox row itself,
    // independently of its current state. Fail closed if ownership cannot be
    // determined so IOS-B can never race a D4D dispatcher send.
    const { data: authoritativeDelivery, error: barrierError } = await admin
      .from('call_push_deliveries')
      .select('id')
      .eq('call_id', call.id)
      .eq('device_id', device.id)
      .eq('event_type', 'incoming_call')
      .eq('provider', 'apns_voip')
      .gte('presentation_version', 1)
      .limit(1)
      .maybeSingle<{ id: string }>()

    if (barrierError) {
      summary.failed += 1
      summary.retryable = (summary.retryable ?? 0) + 1
      setSummaryError(summary, 'authoritative delivery lookup failed')
      continue
    }
    if (authoritativeDelivery?.id) {
      summary.skipped += 1
      summary.authoritative = (summary.authoritative ?? 0) + 1
      continue
    }

    const { data: claimRows, error: claimError } = await admin
      .rpc('claim_call_push_delivery', {
        p_call_id: call.id,
        p_device_id: device.id,
        p_event_type: eventType,
        p_provider: 'apns_voip',
      })
      .returns<DeliveryClaimRow[]>()

    if (claimError) {
      console.error('[send-call-notification] APNs delivery claim failed', claimError.message)
      summary.failed += 1
      continue
    }

    const claim = Array.isArray(claimRows) ? claimRows[0] : null
    if (!claim?.delivery_id) {
      summary.skipped += 1
      continue
    }

    const tokenSent = device.voip_push_token.trim()

    if (isCallExpiredForApns(call)) {
      try {
        await markApnsSkipped(admin, claim.delivery_id, 'CALL_EXPIRED', 'call expired before APNs send')
        summary.skipped += 1
      } catch (error) {
        console.error('[send-call-notification] APNs skipped delivery update failed', sanitizeErrorMessage(error))
        summary.failed += 1
      }
      continue
    }

    try {
      const result = await sendSharedApnsWithRetry({
        config,
        deliveryId: claim.delivery_id,
        deviceToken: tokenSent,
        expiration: getApnsExpiration(call.expires_at),
        payload: {
          call_id: call.id,
          caller_name: callerName,
          call_type: call.call_type,
          has_video: call.call_type === 'video',
        },
      })

      if (result.ok) {
        try {
          await markApnsSent(admin, claim.delivery_id, result.apnsId)
          summary.sent += 1
        } catch (error) {
          console.error('[send-call-notification] APNs sent delivery update failed', sanitizeErrorMessage(error))
          summary.failed += 1
        }
        continue
      }

      try {
        await markApnsFailed(admin, claim.delivery_id, result.reason, result.message || result.reason)
        summary.failed += 1
      } catch (error) {
        console.error('[send-call-notification] APNs failed delivery update failed', sanitizeErrorMessage(error))
        summary.failed += 1
      }

      if (result.reason === 'Unregistered') {
        try {
          await clearExactVoipToken(admin, device.id, tokenSent)
        } catch (error) {
          console.error('[send-call-notification] APNs token cleanup failed', sanitizeErrorMessage(error))
        }
      }

      if (result.reason === 'InvalidProviderToken' || result.reason === 'ExpiredProviderToken') {
        stopApnsBatch = true
      }
    } catch (error) {
      const sanitized = sanitizeErrorMessage(error)
      const isJwtError = sanitized.includes('APNS_JWT_FAILED')
      try {
        await markApnsFailed(admin, claim.delivery_id, isJwtError ? 'APNS_JWT_FAILED' : 'APNS_SEND_FAILED', sanitized)
      } catch (updateError) {
        console.error('[send-call-notification] APNs exception delivery update failed', sanitizeErrorMessage(updateError))
      }
      summary.failed += 1
      if (isJwtError) {
        stopApnsBatch = true
      }
    }
  }

  return summary
}

function settledChannelResult<T>(
  result: PromiseSettledResult<T>,
  fallback: T,
  summary?: ChannelSummary,
): T {
  if (result.status === 'fulfilled') {
    return result.value
  }

  if (summary) {
    setSummaryError(summary, result.reason)
    summary.failed += 1
  }

  return fallback
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ success: false, error: 'method not allowed' }, 405)
  }

  try {
    const { call_id, event_type } = await req.json()
    if (typeof call_id !== 'string' || !isEventType(event_type)) {
      return json({ success: false, error: 'call_id and valid event_type are required' }, 400)
    }

    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) {
      return json({ success: false, error: 'missing authorization' }, 401)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const admin = createClient(supabaseUrl, serviceRoleKey)

    const { data: userData, error: userError } = await userClient.auth.getUser()
    if (userError || !userData.user) {
      return json({ success: false, error: 'not authenticated' }, 401)
    }
    const requesterId = userData.user.id

    const { data: call, error: callError } = await admin
      .from('calls')
      .select('id, caller_id, callee_id, status, call_type, expires_at, caller_device_id')
      .eq('id', call_id)
      .maybeSingle<CallRow>()

    if (callError) return json({ success: false, error: callError.message }, 500)
    if (!call) return json({ success: false, error: 'call not found' }, 404)

    if (event_type === 'incoming_call') {
      if (requesterId !== call.caller_id) {
        return json({ success: false, error: 'only caller can send incoming_call' }, 403)
      }
      if (call.status !== 'ringing') {
        return json({ success: false, error: 'call is not ringing', status: call.status }, 409)
      }
      if (call.expires_at && new Date(call.expires_at).getTime() <= Date.now()) {
        return json({ success: false, error: 'call is expired' }, 409)
      }
    } else {
      const isParticipant = requesterId === call.caller_id || requesterId === call.callee_id
      if (!isParticipant) return json({ success: false, error: 'not a call participant' }, 403)
      if (!['rejected', 'missed', 'ended', 'cancelled', 'expired'].includes(call.status)) {
        return json({ success: false, error: 'call is not terminal', status: call.status }, 409)
      }
    }

    const recipientId = event_type === 'incoming_call'
      ? call.callee_id
      : (requesterId === call.caller_id ? call.callee_id : call.caller_id)

    const { data: callerProfile } = await admin
      .from('user_profiles')
      .select('username, display_name, avatar_url')
      .eq('id', call.caller_id)
      .maybeSingle<ProfileRow>()

    const callerName = getCallerName(callerProfile ?? null)
    const expoFallback = { summary: createSummary(), deviceCount: 0 }
    const apnsFallback = createSummary()

    const [expoSettled, apnsSettled] = await Promise.allSettled([
      sendExpoNotifications(admin, call, event_type, recipientId, callerProfile ?? null),
      sendApnsVoipNotifications(admin, call, event_type, callerName),
    ])

    const expoResult = settledChannelResult(expoSettled, expoFallback, expoFallback.summary)
    const apnsVoip = settledChannelResult(apnsSettled, apnsFallback, apnsFallback)
    const expo = expoResult.summary

    const noActiveDevices =
      expoResult.deviceCount === 0 &&
      expo.sent === 0 &&
      expo.failed === 0 &&
      expo.skipped === 0 &&
      apnsVoip.sent === 0 &&
      apnsVoip.failed === 0 &&
      apnsVoip.skipped === 0

    return json({
      success: true,
      sent: expo.sent,
      skipped: expo.skipped,
      failed: expo.failed,
      device_count: expoResult.deviceCount,
      reason: noActiveDevices ? 'no_active_devices' : undefined,
      expo,
      apns_voip: apnsVoip,
    })
  } catch (error) {
    return json({ success: false, error: sanitizeErrorMessage(error) }, 500)
  }
})
