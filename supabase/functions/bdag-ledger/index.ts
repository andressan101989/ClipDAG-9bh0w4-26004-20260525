/**
 * bdag-ledger — unified internal BDAG transaction gateway
 *
 * Single entry point for ALL internal BDAG economy operations.
 * Every action:
 *   1. Verifies JWT authentication
 *   2. Validates inputs
 *   3. Calls atomic PostgreSQL RPC (SECURITY DEFINER)
 *   4. Returns structured response
 *
 * Actions:
 *   transfer  → transfer_bdag_internal()
 *   purchase  → purchase_exclusive_content()
 *   subscribe → subscribe_to_creator()
 *   gift      → atomic_ledger_transfer() (gift type)
 *   boost     → purchase_boost()
 *   balance   → get_user_bdag_balance()
 *   reconcile → run_reconciliation_check()
 *   refund_expired_dms → refund_expired_premium_dms()
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders }  from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

// ── Velocity limits per operation ─────────────────────────────────────────
const VELOCITY: Record<string, { maxOps: number; maxAmount: number; windowHours: number }> = {
  transfer:  { maxOps: 20,  maxAmount: 50_000,  windowHours: 1 },
  gift:      { maxOps: 50,  maxAmount: 100_000, windowHours: 1 },
  boost:     { maxOps: 5,   maxAmount: 500_000, windowHours: 1 },
  purchase:  { maxOps: 100, maxAmount: 0,       windowHours: 1 },
  subscribe: { maxOps: 20,  maxAmount: 0,       windowHours: 24 },
};

function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status,
  });
}
function fail(error: string, status = 400) {
  return new Response(JSON.stringify({ success: false, error }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status,
  });
}

// ── Structured logger ─────────────────────────────────────────────────────
function log(level: 'INFO' | 'WARN' | 'ERROR', action: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ level, action, ts: new Date().toISOString(), ...data }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // ── Auth ──────────────────────────────────────────────────────────────
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return fail('unauthorized', 401);

  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) return fail('unauthorized', 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return fail('invalid JSON body'); }

  const { action, idempotency_key } = body;
  if (!action) return fail('action required');
  if (!idempotency_key) return fail('idempotency_key required');

  log('INFO', String(action), { user_id: user.id });

  try {
    // ════════════════════════════════════════════════════════════════════
    // TRANSFER
    // ════════════════════════════════════════════════════════════════════
    if (action === 'transfer') {
      const { to_user_id, amount } = body;
      if (!to_user_id || !amount)   return fail('to_user_id and amount required');
      const amt = Number(amount);
      if (isNaN(amt) || amt <= 0)   return fail('amount must be a positive number');
      if (to_user_id === user.id)   return fail('self-transfer not allowed');

      const { data, error } = await admin.rpc('transfer_bdag_internal', {
        p_from_user_id:    user.id,
        p_to_user_id:      to_user_id,
        p_amount:          amt,
        p_idempotency_key: idempotency_key,
      });
      if (error) { log('ERROR', 'transfer', { err: error.message }); return fail(error.message); }
      return ok(data);
    }

    // ════════════════════════════════════════════════════════════════════
    // PURCHASE EXCLUSIVE CONTENT
    // ════════════════════════════════════════════════════════════════════
    if (action === 'purchase') {
      const { content_id } = body;
      if (!content_id) return fail('content_id required');

      const { data, error } = await admin.rpc('purchase_exclusive_content', {
        p_buyer_id:        user.id,
        p_content_id:      content_id,
        p_idempotency_key: idempotency_key,
      });
      if (error) { log('ERROR', 'purchase', { err: error.message, content_id }); return fail(error.message); }
      if (data?.idempotent) return ok({ already_purchased: true });
      return ok(data);
    }

    // ════════════════════════════════════════════════════════════════════
    // SUBSCRIBE TO CREATOR PLAN
    // ════════════════════════════════════════════════════════════════════
    if (action === 'subscribe') {
      const { plan_id } = body;
      if (!plan_id) return fail('plan_id required');

      const { data, error } = await admin.rpc('subscribe_to_creator', {
        p_subscriber_id:   user.id,
        p_plan_id:         plan_id,
        p_idempotency_key: idempotency_key,
      });
      if (error) { log('ERROR', 'subscribe', { err: error.message, plan_id }); return fail(error.message); }
      return ok(data);
    }

    // ════════════════════════════════════════════════════════════════════
    // GIFT / TIP
    // ════════════════════════════════════════════════════════════════════
    if (action === 'gift') {
      const { to_user_id, amount, gift_type, video_id } = body;
      if (!to_user_id || !amount) return fail('to_user_id and amount required');
      const amt = Number(amount);
      if (isNaN(amt) || amt <= 0) return fail('amount must be positive');
      if (to_user_id === user.id) return fail('self-gift not allowed');

      // Atomic transfer with fee
      const fee = Math.round(amt * 0.10 * 1e8) / 1e8;
      const { data, error } = await admin.rpc('atomic_ledger_transfer', {
        p_from_user_id:    user.id,
        p_to_user_id:      to_user_id,
        p_amount:          amt,
        p_fee:             fee,
        p_operation_type:  'gift',
        p_idempotency_key: idempotency_key,
        p_reference_type:  video_id ? 'video' : null,
        p_reference_id:    video_id ?? null,
        p_description:     `Gift: ${gift_type ?? 'heart'}`,
      });
      if (error) { log('ERROR', 'gift', { err: error.message }); return fail(error.message); }

      // Record gift
      await admin.from('gifts').insert({
        sender_id:    user.id,
        recipient_id: to_user_id,
        video_id:     video_id ?? null,
        gift_type:    gift_type ?? 'heart',
        dag_value:    amt,
      });

      return ok(data);
    }

    // ════════════════════════════════════════════════════════════════════
    // BOOST PROFILE / CONTENT
    // ════════════════════════════════════════════════════════════════════
    if (action === 'boost') {
      const { reference_id, reference_type, boost_type, amount, hours, multiplier } = body;
      if (!reference_id || !boost_type || !amount) return fail('reference_id, boost_type, amount required');
      const amt = Number(amount);
      if (isNaN(amt) || amt <= 0) return fail('amount must be positive');

      const { data, error } = await admin.rpc('purchase_boost', {
        p_user_id:         user.id,
        p_reference_id:    reference_id,
        p_reference_type:  reference_type ?? 'profile',
        p_boost_type:      boost_type,
        p_amount_bdag:     amt,
        p_hours:           Number(hours ?? 24),
        p_multiplier:      Number(multiplier ?? 1.5),
        p_idempotency_key: idempotency_key,
      });
      if (error) { log('ERROR', 'boost', { err: error.message }); return fail(error.message); }
      return ok(data);
    }

    // ════════════════════════════════════════════════════════════════════
    // BALANCE (authoritative read)
    // ════════════════════════════════════════════════════════════════════
    if (action === 'balance') {
      const { data, error } = await admin.rpc('get_user_bdag_balance', { p_user_id: user.id });
      if (error) return fail(error.message);
      return ok({ balance: data ?? 0, user_id: user.id });
    }

    // ════════════════════════════════════════════════════════════════════
    // PREMIUM DM — send
    // ════════════════════════════════════════════════════════════════════
    if (action === 'premium_dm_send') {
      const { recipient_id, message_text, amount_bdag } = body;
      if (!recipient_id || !message_text) return fail('recipient_id and message_text required');

      const { data, error } = await admin.rpc('send_premium_dm', {
        p_sender_id:       user.id,
        p_recipient_id:    recipient_id,
        p_message_text:    message_text,
        p_amount_bdag:     Number(amount_bdag ?? 0),
        p_idempotency_key: idempotency_key,
      });
      if (error) { log('ERROR', 'premium_dm_send', { err: error.message }); return fail(error.message); }
      return ok(data);
    }

    // ════════════════════════════════════════════════════════════════════
    // PREMIUM DM — release
    // ════════════════════════════════════════════════════════════════════
    if (action === 'premium_dm_release') {
      const { payment_id } = body;
      if (!payment_id) return fail('payment_id required');

      const { data, error } = await admin.rpc('release_premium_dm', {
        p_payment_id: payment_id,
        p_creator_id: user.id,
      });
      if (error) { log('ERROR', 'premium_dm_release', { err: error.message }); return fail(error.message); }
      return ok(data);
    }

    // ════════════════════════════════════════════════════════════════════
    // RECONCILE (service_role only via secret header)
    // ════════════════════════════════════════════════════════════════════
    if (action === 'reconcile') {
      const secret = req.headers.get('X-Reconcile-Secret');
      if (secret !== Deno.env.get('RECONCILE_SECRET')) return fail('forbidden', 403);
      const { data, error } = await admin.rpc('run_reconciliation_check');
      if (error) return fail(error.message);
      return ok(data);
    }

    // ════════════════════════════════════════════════════════════════════
    // REFUND EXPIRED PREMIUM DMs (service_role only)
    // ════════════════════════════════════════════════════════════════════
    if (action === 'refund_expired_dms') {
      const secret = req.headers.get('X-Reconcile-Secret');
      if (secret !== Deno.env.get('RECONCILE_SECRET')) return fail('forbidden', 403);
      const { data, error } = await admin.rpc('refund_expired_premium_dms');
      if (error) return fail(error.message);
      return ok(data);
    }

    return fail(`unknown action: ${action}`);

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log('ERROR', String(action), { err: msg, user_id: user.id });
    return fail(msg, 500);
  }
});
