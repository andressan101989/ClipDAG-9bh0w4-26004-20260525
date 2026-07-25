/* eslint-disable import/no-unresolved -- Deno resolves URL imports at bundle/deploy time. */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  authorizeMessageDispatcher,
  EXPO_PUSH_SEND_URL,
  isTemporaryExpoError,
  jsonResponse,
  safeError,
  sanitizePreview,
} from '../_shared/messagePush.ts'

type ClaimedDelivery = {
  delivery_id: string
  outbox_id: string
  message_id: string
  device_id: string
  token_snapshot: string
  attempt_id: string
  attempt_count: number
}

const BATCH_LIMIT = 25

serve(async (req) => {
  if (!authorizeMessageDispatcher(req)) return jsonResponse({ error: 'unauthorized' }, 401)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  const { data: claimed, error: claimError } = await admin
    .rpc('claim_message_push_deliveries', { p_limit: BATCH_LIMIT })
  if (claimError) return jsonResponse({ error: 'claim_failed' }, 500)

  let ticketed = 0
  let retried = 0
  let failed = 0
  let skipped = 0

  for (const delivery of (claimed ?? []) as ClaimedDelivery[]) {
    const finalize = async (
      result: 'ticketed' | 'sent' | 'skipped' | 'retry' | 'failed',
      ticketId: string | null,
      error: string | null,
    ) => {
      await admin.rpc('finalize_message_push_delivery', {
        p_delivery_id: delivery.delivery_id,
        p_attempt_id: delivery.attempt_id,
        p_result: result,
        p_ticket_id: ticketId,
        p_error: error,
      })
    }

    try {
      const [{ data: message }, { data: device }] = await Promise.all([
        admin.from('messages')
          .select('id, sender_id, recipient_id, text, media_type, read')
          .eq('id', delivery.message_id).maybeSingle(),
        admin.from('call_devices')
          .select('id, user_id, active, expo_push_token')
          .eq('id', delivery.device_id).maybeSingle(),
      ])

      if (!message || !device || device.user_id !== message.recipient_id) {
        await finalize('skipped', null, 'resource_not_found')
        skipped += 1
        continue
      }
      if (!device.active || device.expo_push_token !== delivery.token_snapshot) {
        await finalize('skipped', null, 'device_or_token_changed')
        skipped += 1
        continue
      }
      if (message.sender_id === message.recipient_id || message.read === true) {
        await finalize('skipped', null, message.read ? 'already_read' : 'self_message')
        skipped += 1
        continue
      }

      const [{ data: sender }, { count: unreadCount }, { data: premium }] = await Promise.all([
        admin.from('user_profiles')
          .select('display_name, username').eq('id', message.sender_id).maybeSingle(),
        admin.from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('recipient_id', message.recipient_id).eq('read', false),
        admin.from('premium_dm_payments')
          .select('id').eq('message_id', message.id).limit(1).maybeSingle(),
      ])

      const mediaType = String(message.media_type ?? 'text').toLowerCase()
      const body = premium || mediaType === 'premium_dm'
        ? 'Te envió un DM Premium'
        : mediaType === 'image'
          ? 'Te envió una imagen'
          : mediaType === 'video'
            ? 'Te envió un video'
            : sanitizePreview(String(message.text ?? '')) || 'Nuevo mensaje'
      const title = sanitizePreview(sender?.display_name || sender?.username || 'Nuevo mensaje')

      const expoResponse = await fetch(EXPO_PUSH_SEND_URL, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: delivery.token_snapshot,
          title,
          body,
          sound: 'default',
          priority: 'high',
          interruptionLevel: 'active',
          badge: Math.max(0, Number(unreadCount ?? 0)),
          data: {
            type: 'message',
            from_user_id: String(message.sender_id),
            message_id: String(message.id),
          },
        }),
      })

      const responseBody = await expoResponse.json().catch(() => ({}))
      const ticket = Array.isArray(responseBody?.data) ? responseBody.data[0] : responseBody?.data
      const code = typeof ticket?.details?.error === 'string' ? ticket.details.error : null

      if (expoResponse.ok && ticket?.status === 'ok' && typeof ticket.id === 'string') {
        await finalize('ticketed', ticket.id, null)
        ticketed += 1
      } else if (code === 'DeviceNotRegistered') {
        await admin.rpc('clear_invalid_message_expo_token', {
          p_device_id: delivery.device_id,
          p_token_snapshot: delivery.token_snapshot,
        })
        await finalize('failed', null, 'DeviceNotRegistered')
        failed += 1
      } else if (isTemporaryExpoError(code, expoResponse.status)) {
        await finalize('retry', null, code ?? `expo_http_${expoResponse.status}`)
        retried += 1
      } else {
        await finalize('failed', null, code ?? `expo_rejected_${expoResponse.status}`)
        failed += 1
      }
    } catch (error) {
      await finalize('retry', null, safeError(error))
      retried += 1
    }
  }

  console.log('[MessagePush] dispatch_complete', {
    claimed: claimed?.length ?? 0, ticketed, retried, failed, skipped,
  })
  return jsonResponse({ claimed: claimed?.length ?? 0, ticketed, retried, failed, skipped })
})
