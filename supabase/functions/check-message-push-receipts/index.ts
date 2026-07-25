/* eslint-disable import/no-unresolved -- Deno resolves URL imports at bundle/deploy time. */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  authorizeMessageDispatcher,
  EXPO_PUSH_RECEIPTS_URL,
  isTemporaryExpoError,
  jsonResponse,
  safeError,
} from '../_shared/messagePush.ts'

type ReceiptDelivery = {
  delivery_id: string
  device_id: string
  token_snapshot: string
  ticket_id: string
  receipt_attempt_count: number
}

serve(async (req) => {
  if (!authorizeMessageDispatcher(req)) return jsonResponse({ error: 'unauthorized' }, 401)
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const { data: claimed, error } = await admin.rpc('claim_message_push_receipts', { p_limit: 100 })
  if (error) return jsonResponse({ error: 'receipt_claim_failed' }, 500)
  const deliveries = (claimed ?? []) as ReceiptDelivery[]
  if (deliveries.length === 0) return jsonResponse({ claimed: 0 })

  try {
    const response = await fetch(EXPO_PUSH_RECEIPTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ ids: deliveries.map(item => item.ticket_id) }),
    })
    if (!response.ok) {
      return jsonResponse({ claimed: deliveries.length, pending: deliveries.length }, 202)
    }
    const payload = await response.json().catch(() => ({}))
    const receipts = payload?.data ?? {}
    let sent = 0
    let retried = 0
    let failed = 0

    for (const delivery of deliveries) {
      const receipt = receipts[delivery.ticket_id]
      if (!receipt) {
        if (delivery.receipt_attempt_count >= 10) {
          await admin.rpc('finalize_message_push_receipt', {
            p_delivery_id: delivery.delivery_id,
            p_result: 'failed',
            p_error: 'receipt_not_found_after_max_checks',
          })
          failed += 1
        }
        continue
      }
      const code = typeof receipt?.details?.error === 'string' ? receipt.details.error : null
      if (receipt.status === 'ok') {
        await admin.rpc('finalize_message_push_receipt', {
          p_delivery_id: delivery.delivery_id, p_result: 'sent', p_error: null,
        })
        sent += 1
      } else if (code === 'DeviceNotRegistered') {
        await admin.rpc('clear_invalid_message_expo_token', {
          p_device_id: delivery.device_id,
          p_token_snapshot: delivery.token_snapshot,
        })
        await admin.rpc('finalize_message_push_receipt', {
          p_delivery_id: delivery.delivery_id, p_result: 'failed', p_error: 'DeviceNotRegistered',
        })
        failed += 1
      } else if (isTemporaryExpoError(code)) {
        await admin.rpc('finalize_message_push_receipt', {
          p_delivery_id: delivery.delivery_id, p_result: 'retry', p_error: code ?? 'temporary_receipt_error',
        })
        retried += 1
      } else {
        await admin.rpc('finalize_message_push_receipt', {
          p_delivery_id: delivery.delivery_id, p_result: 'failed', p_error: code ?? 'permanent_receipt_error',
        })
        failed += 1
      }
    }
    console.log('[MessagePush] receipts_complete', {
      claimed: deliveries.length, sent, retried, failed,
    })
    return jsonResponse({ claimed: deliveries.length, sent, retried, failed })
  } catch (receiptError) {
    console.warn('[MessagePush] receipts_deferred', { error: safeError(receiptError) })
    return jsonResponse({ claimed: deliveries.length, pending: deliveries.length }, 202)
  }
})
