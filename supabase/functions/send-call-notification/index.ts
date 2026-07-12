import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

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

type DeviceRow = {
  id: string
  expo_push_token: string
}

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

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
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

    const since = new Date(Date.now() - DEVICE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const { data: devices, error: devicesError } = await admin
      .from('call_devices')
      .select('id, expo_push_token')
      .eq('user_id', recipientId)
      .eq('active', true)
      .not('expo_push_token', 'is', null)
      .gte('last_seen_at', since)
      .returns<DeviceRow[]>()

    if (devicesError) return json({ success: false, error: devicesError.message }, 500)

    const recipientDevices = (devices ?? [])
      .filter(device => typeof device.expo_push_token === 'string' && device.expo_push_token.startsWith('ExponentPushToken'))
      .filter(device => device.id !== call.caller_device_id)

    if (recipientDevices.length === 0) {
      return json({ success: true, sent: 0, skipped: 0, failed: 0, reason: 'no_active_devices' })
    }

    const { data: callerProfile } = await admin
      .from('user_profiles')
      .select('username, display_name, avatar_url')
      .eq('id', call.caller_id)
      .maybeSingle()

    const callerName =
      callerProfile?.display_name ||
      callerProfile?.username ||
      'Llamada entrante'

    let sent = 0
    let skipped = 0
    let failed = 0
    const toSend: Array<{ device: DeviceRow; deliveryId: string }> = []

    for (const device of recipientDevices) {
      const { error: insertError } = await admin
        .from('call_push_deliveries')
        .upsert({
          call_id: call.id,
          device_id: device.id,
          event_type,
          provider: 'expo',
          status: 'pending',
        }, {
          onConflict: 'call_id,device_id,event_type',
          ignoreDuplicates: true,
        })

      if (insertError) {
        failed += 1
        continue
      }

      const { data: delivery, error: deliveryError } = await admin
        .from('call_push_deliveries')
        .select('id, status')
        .eq('call_id', call.id)
        .eq('device_id', device.id)
        .eq('event_type', event_type)
        .maybeSingle()

      if (deliveryError || !delivery?.id) {
        failed += 1
        continue
      }

      if (delivery.status !== 'pending') {
        skipped += 1
        continue
      }

      toSend.push({ device, deliveryId: delivery.id })
    }

    const title = event_type === 'incoming_call'
      ? callerName
      : 'Llamada actualizada'
    const body = event_type === 'incoming_call'
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
          type: event_type,
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
          sent += 1
          await admin
            .from('call_push_deliveries')
            .update({
              status: 'sent',
              provider_ticket_id: ticket.id ?? null,
              attempted_at: new Date().toISOString(),
              delivered_at: new Date().toISOString(),
              error_code: null,
              error_message: null,
            })
            .eq('id', deliveryId)
        } else {
          failed += 1
          const errorCode = ticket?.details?.error ?? ticket?.status ?? 'unknown'
          const errorMessage = sanitizeErrorMessage(ticket?.message ?? response.statusText)
          await admin
            .from('call_push_deliveries')
            .update({
              status: 'failed',
              attempted_at: new Date().toISOString(),
              error_code: errorCode,
              error_message: errorMessage,
            })
            .eq('id', deliveryId)

          if (errorCode === 'DeviceNotRegistered') {
            await admin
              .from('call_devices')
              .update({ active: false, expo_push_token: null })
              .eq('id', device.id)
          }
        }
      }
    }

    return json({ success: true, sent, skipped, failed, device_count: recipientDevices.length })
  } catch (error) {
    return json({ success: false, error: sanitizeErrorMessage(error) }, 500)
  }
})
