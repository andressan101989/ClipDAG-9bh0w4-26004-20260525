/* eslint-disable import/no-unresolved */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { verifyCallStatusWatchToken } from '../_shared/callStatusWatch.ts'

const LONG_POLL_MS = 14_000
const STATUS_POLL_MS = 2_000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const ACTIVE_STATUSES = new Set(['ringing', 'accepted'])
const TERMINAL_STATUSES = new Set(['cancelled', 'ended', 'expired', 'rejected', 'missed'])

type WatchRequest = {
  call_id: string
  device_id: string
  watch_token: string
}

type CallRow = {
  id: string
  callee_id: string
  callee_device_id: string | null
  status: string
  end_reason: string | null
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function parseRequest(value: unknown): WatchRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const body = value as Record<string, unknown>
  return typeof body.call_id === 'string' && UUID_PATTERN.test(body.call_id) &&
      typeof body.device_id === 'string' && UUID_PATTERN.test(body.device_id) &&
      typeof body.watch_token === 'string' && body.watch_token.length > 20
    ? { call_id: body.call_id, device_id: body.device_id, watch_token: body.watch_token }
    : null
}

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const body = parseRequest(await req.json().catch(() => null))
  if (!body) return json({ error: 'invalid_request' }, 400)

  const watchSecret = Deno.env.get('CALL_DISPATCH_SECRET')?.trim() ?? ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim() ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() ?? ''
  if (!watchSecret || !supabaseUrl || !serviceRoleKey) {
    return json({ error: 'watch_unavailable' }, 503)
  }

  const claims = await verifyCallStatusWatchToken(watchSecret, body.watch_token)
  if (!claims || claims.c !== body.call_id || claims.d !== body.device_id) {
    return json({ error: 'invalid_watch_token' }, 403)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: device } = await admin
    .from('call_devices')
    .select('id,user_id,active')
    .eq('id', body.device_id)
    .maybeSingle<{ id: string; user_id: string; active: boolean }>()
  const { data: delivery } = await admin
    .from('call_push_deliveries')
    .select('id')
    .eq('call_id', body.call_id)
    .eq('device_id', body.device_id)
    .eq('event_type', 'incoming_call')
    .eq('provider', 'apns_voip')
    .maybeSingle<{ id: string }>()
  if (!device?.active || !delivery) return json({ error: 'watch_not_authorized' }, 403)

  const deadline = Date.now() + LONG_POLL_MS
  while (true) {
    const { data: call, error } = await admin
      .from('calls')
      .select('id,callee_id,callee_device_id,status,end_reason')
      .eq('id', body.call_id)
      .maybeSingle<CallRow>()
    if (error) return json({ error: 'status_unavailable' }, 503)
    if (!call || call.callee_id !== device.user_id) return json({ error: 'watch_not_authorized' }, 403)

    const answeredElsewhere = call.status === 'accepted' &&
      Boolean(call.callee_device_id) &&
      call.callee_device_id !== body.device_id
    const status = answeredElsewhere ? 'answered_elsewhere' : call.status
    const terminal = answeredElsewhere || TERMINAL_STATUSES.has(status)
    if (terminal) {
      console.log('[CallStatusWatch] terminal', { call: body.call_id.slice(0, 8), status })
      return json({
        call_id: call.id,
        status,
        reason: answeredElsewhere ? 'answered_elsewhere' : call.end_reason,
        terminal: true,
      })
    }
    if (!ACTIVE_STATUSES.has(status)) {
      return json({ error: 'invalid_call_status' }, 503)
    }
    if (Date.now() >= deadline) {
      return json({ call_id: call.id, status, reason: null, terminal: false })
    }
    await new Promise(resolve => setTimeout(resolve, STATUS_POLL_MS))
  }
})
