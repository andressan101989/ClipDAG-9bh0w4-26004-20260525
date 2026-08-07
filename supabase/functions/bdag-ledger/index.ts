/* eslint-disable import/no-unresolved -- Deno resolves URL imports at bundle/deploy time. */
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

const RECONCILE_SECRET: string = (() => {
  const s = Deno.env.get('RECONCILE_SECRET');
  if (!s) throw new Error('RECONCILE_SECRET env var is required');
  return s;
})();

// ── Velocity limits per operation ─────────────────────────────────────────
const VELOCITY: Record<string, { maxOps: number; maxAmount: number; windowHours: number }> = {
  transfer:  { maxOps: 20,  maxAmount: 50_000,  windowHours: 1 },
  gift:      { maxOps: 50,  maxAmount: 100_000, windowHours: 1 },
  boost:     { maxOps: 5,   maxAmount: 500_000, windowHours: 1 },
  purchase:  { maxOps: 100, maxAmount: 0,       windowHours: 1 },
  subscribe: { maxOps: 20,  maxAmount: 0,       windowHours: 24 },
  marketplace_checkout_pay: { maxOps: 20, maxAmount: 0, windowHours: 1 },
  marketplace_order_confirm_delivery: { maxOps: 20, maxAmount: 0, windowHours: 1 },
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    // MARKETPLACE CHECKOUT PAYMENT — server-authoritative amount, fee and inventory.
    if (action === 'marketplace_checkout_pay') {
      const { checkout_id } = body;
      if (typeof checkout_id !== 'string' || !UUID_RE.test(checkout_id) || typeof idempotency_key !== 'string' || !UUID_RE.test(idempotency_key)) {
        return fail('marketplace_payment_invalid_input');
      }
      const limit = VELOCITY.marketplace_checkout_pay;
      const { data: allowed, error: velocityError } = await admin.rpc('check_velocity_limit', {
        p_user_id: user.id, p_operation: 'marketplace_checkout_pay', p_amount: 0,
        p_max_ops: limit.maxOps, p_max_amount: limit.maxAmount, p_window_hours: limit.windowHours,
      });
      if (velocityError) log('WARN', 'marketplace_checkout_pay', { user_id: user.id, code: 'velocity_check_unavailable' });
      if (allowed === false) return fail('marketplace_payment_rate_limited', 429);
      const { data, error } = await admin.rpc('pay_marketplace_checkout_with_bdag', {
        p_buyer_id: user.id, p_checkout_id: checkout_id, p_idempotency_key: idempotency_key,
      });
      if (error) {
        const known = ['marketplace_checkout_not_found','marketplace_checkout_not_payable','marketplace_checkout_cancelled','marketplace_checkout_expired','marketplace_checkout_integrity_error','marketplace_insufficient_bdag_balance','marketplace_payment_idempotency_conflict'];
        const code = known.find(value => error.message === value || error.message.includes(value)) ?? 'marketplace_payment_unknown';
        log('ERROR', 'marketplace_checkout_pay', { user_id: user.id, checkout: `${checkout_id.slice(0, 8)}…`, code });
        return fail(code, code === 'marketplace_insufficient_bdag_balance' ? 402 : 409);
      }
      if (data?.error_code) return fail(String(data.error_code), 409);
      return ok(data);
    }

    if (action === 'marketplace_order_confirm_delivery') {
      const { order_id } = body;
      if (typeof order_id !== 'string' || !UUID_RE.test(order_id) || typeof idempotency_key !== 'string' || !UUID_RE.test(idempotency_key)) {
        return fail('marketplace_delivery_invalid_input', 400);
      }
      const limit = VELOCITY.marketplace_order_confirm_delivery;
      const { data: allowed, error: velocityError } = await admin.rpc('check_velocity_limit', {
        p_user_id: user.id, p_operation: 'marketplace_order_confirm_delivery', p_amount: 0,
        p_max_ops: limit.maxOps, p_max_amount: limit.maxAmount, p_window_hours: limit.windowHours,
      });
      if (velocityError) log('WARN', 'marketplace_order_confirm_delivery', { user_id: user.id, code: 'velocity_check_unavailable' });
      if (allowed === false) return fail('marketplace_settlement_rate_limited', 429);
      const { data, error } = await admin.rpc('confirm_marketplace_order_delivery_and_release', {
        p_buyer_id: user.id, p_order_id: order_id, p_idempotency_key: idempotency_key,
      });
      if (error) {
        const known = ['marketplace_delivery_invalid_input','marketplace_order_not_found','marketplace_order_not_owned','marketplace_order_not_shipped','marketplace_shipment_not_shipped','marketplace_order_not_paid','marketplace_allocation_not_held','marketplace_settlement_integrity_error','marketplace_settlement_idempotency_conflict','marketplace_escrow_insufficient_balance'];
        const code = known.find(value => error.message === value || error.message.includes(value)) ?? 'marketplace_settlement_unknown';
        log('ERROR', 'marketplace_order_confirm_delivery', { user_id: user.id, order: `${order_id.slice(0, 8)}…`, code });
        const status = code === 'marketplace_order_not_owned' ? 403 : code === 'marketplace_delivery_invalid_input' ? 400 : code === 'marketplace_settlement_unknown' ? 500 : 409;
        return fail(code, status);
      }
      return ok(data);
    }

    if (action === 'marketplace_dispute_fetch' || action === 'marketplace_dispute_resolve') {
      const { dispute_id, outcome, reason_code, note } = body;
      if (typeof dispute_id !== 'string' || !UUID_RE.test(dispute_id) ||
          typeof idempotency_key !== 'string' || !UUID_RE.test(idempotency_key)) {
        return fail('marketplace_dispute_resolution_invalid_input', 400);
      }
      const { data: profile, error: profileError } = await admin
        .from('user_profiles').select('is_admin').eq('id', user.id).maybeSingle();
      if (profileError || profile?.is_admin !== true) {
        log('WARN', String(action), { actor: `${user.id.slice(0, 8)}…`, code: 'marketplace_dispute_resolution_forbidden' });
        return fail('marketplace_dispute_resolution_forbidden', 403);
      }
      const rpc = action === 'marketplace_dispute_fetch'
        ? 'fetch_support_marketplace_dispute'
        : 'resolve_marketplace_dispute';
      const params = action === 'marketplace_dispute_fetch'
        ? { p_resolver_id: user.id, p_dispute_id: dispute_id }
        : {
            p_resolver_id: user.id, p_dispute_id: dispute_id, p_outcome: outcome,
            p_reason_code: reason_code, p_note: note ?? null,
            p_idempotency_key: idempotency_key, p_partial_amount: null,
          };
      const { data, error } = await admin.rpc(rpc, params);
      if (error) {
        const codes = [
          'marketplace_dispute_not_found','marketplace_dispute_not_open','marketplace_dispute_already_resolved',
          'marketplace_dispute_conflicting_decision','marketplace_refund_allocation_not_held',
          'marketplace_refund_requires_manual_review','marketplace_partial_refund_unsupported',
          'marketplace_refund_reconciliation_failed','marketplace_dispute_resolution_forbidden',
          'marketplace_dispute_resolution_auth_required','marketplace_refund_payment_not_paid',
          'marketplace_refund_order_state_invalid','marketplace_refund_already_completed',
          'marketplace_dispute_resolution_invalid_input',
        ];
        const code = codes.find(value => error.message.includes(value)) ?? 'marketplace_dispute_resolution_unknown';
        log(code === 'marketplace_dispute_resolution_unknown' ? 'ERROR' : 'WARN', String(action), {
          dispute: `${dispute_id.slice(0, 8)}…`, code,
        });
        return fail(code, code.endsWith('_forbidden') || code.endsWith('_auth_required') ? 403 : 409);
      }
      return ok(data);
    }

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
      if (secret !== RECONCILE_SECRET) return fail('forbidden', 403);
      const { data, error } = await admin.rpc('run_reconciliation_check');
      if (error) return fail(error.message);
      return ok(data);
    }

    // ════════════════════════════════════════════════════════════════════
    // REFUND EXPIRED PREMIUM DMs (service_role only)
    // ════════════════════════════════════════════════════════════════════
    if (action === 'refund_expired_dms') {
      const secret = req.headers.get('X-Reconcile-Secret');
      if (secret !== RECONCILE_SECRET) return fail('forbidden', 403);
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
