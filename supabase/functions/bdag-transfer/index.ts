/**
 * Edge Function: bdag-transfer
 *
 * Internal BDAG credit transfer between platform accounts.
 * Zero blockchain involvement — pure DB economy, instant, no gas.
 *
 * Flow:
 *   1. Authenticate sender via JWT
 *   2. Resolve recipient by username or email query
 *   3. Validate (not self, amount > 0, at least 1 BDAG)
 *   4. Call transfer_bdag_internal() — PostgreSQL atomic function
 *      (idempotency, row-level locks, double-entry ledger entries, velocity check)
 *   5. Return new sender balance + recipient info
 *
 * Payload:
 *   recipient_query  — username or email (string)
 *   amount           — BDAG amount (number, >= 1)
 *   note             — optional note (string, max 200 chars)
 *
 * The RPC function transfer_bdag_internal() handles:
 *   - balance debit/credit atomically
 *   - idempotency_key deduplication
 *   - velocity limits (max 20/hr, max 50k BDAG/hr)
 *   - self-transfer rejection
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const MIN_TRANSFER = 1; // minimum 1 BDAG

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const respOk   = (data: object) => new Response(JSON.stringify(data), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  const respFail = (msg: string, status = 400) => new Response(JSON.stringify({ success: false, error: msg }), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  // ── 1. Authenticate sender ─────────────────────────────────────────────────
  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return respFail('unauthorized', 401);

  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) return respFail('unauthorized', 401);

  const senderId = user.id;
  console.log(`[bdag-transfer] sender=${senderId}`);

  // ── 2. Parse body ──────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return respFail('invalid JSON body'); }

  const { recipient_query, amount } = body;
  // Sanitize note: trim, strip control chars, enforce max 200 chars
  const rawNote = typeof body.note === 'string' ? body.note : '';
  const note = rawNote
    .replace(/[\x00-\x1F\x7F]/g, ' ')  // strip control characters
    .trim()
    .slice(0, 200);

  const bdagAmount = Number(amount);
  if (!recipient_query || typeof recipient_query !== 'string' || !recipient_query.trim()) {
    return respFail('recipient_query required (username or email)');
  }
  if (isNaN(bdagAmount) || bdagAmount < MIN_TRANSFER) {
    return respFail(`minimum transfer is ${MIN_TRANSFER} BDAG`);
  }

  const query = String(recipient_query).trim().toLowerCase();
  console.log(`[bdag-transfer] resolving recipient query="${query}" amount=${bdagAmount}`);

  // ── 3. Resolve recipient ───────────────────────────────────────────────────
  const { data: recipientProfile, error: recipientErr } = await admin
    .from('user_profiles')
    .select('id, username, email, avatar_url, display_name')
    .or(`username.ilike.${query},email.ilike.${query}`)
    .limit(1)
    .single();

  if (recipientErr || !recipientProfile) {
    console.warn(`[bdag-transfer] recipient not found for query="${query}"`);
    return respFail('recipient not found — check username or email');
  }

  const recipientId = recipientProfile.id;
  console.log(`[bdag-transfer] recipient=${recipientId} username=${recipientProfile.username}`);

  // ── 4. Validate not self ───────────────────────────────────────────────────
  if (senderId === recipientId) {
    return respFail('self-transfer not allowed');
  }

  // ── 5. Check sender ledger balance (authoritative) ─────────────────────────
  const { data: senderAcct } = await admin
    .from('ledger_accounts')
    .select('balance')
    .eq('owner_id', senderId)
    .eq('account_type', 'user')
    .single();

  const senderBalance = Number(senderAcct?.balance ?? 0);
  console.log(`[bdag-transfer] sender ledger balance=${senderBalance} requested=${bdagAmount}`);

  if (bdagAmount > senderBalance) {
    return respFail(`insufficient balance. Available: ${senderBalance.toFixed(2)} BDAG`);
  }

  // ── 6. Atomic transfer via new PostgreSQL function ─────────────────────────
  // transfer_bdag_internal(p_from_user_id, p_to_user_id, p_amount, p_idempotency_key)
  const idempotencyKey = `transfer:${crypto.randomUUID()}:${Date.now()}`;

  console.log(`[bdag-transfer] calling transfer_bdag_internal from=${senderId} to=${recipientId} amount=${bdagAmount}`);

  const { data: result, error: rpcErr } = await admin.rpc('transfer_bdag_internal', {
    p_from_user_id:    senderId,
    p_to_user_id:      recipientId,
    p_amount:          bdagAmount,
    p_idempotency_key: idempotencyKey,
  });

  if (rpcErr) {
    console.error('[bdag-transfer] RPC error:', rpcErr.message);
    // Map common RPC error messages to user-friendly responses
    if (rpcErr.message?.includes('velocity_limit_exceeded')) {
      return respFail('transfer limit reached: max 20 transfers per hour', 429);
    }
    if (rpcErr.message?.includes('recipient_not_found')) {
      return respFail('recipient account not found');
    }
    return respFail('transfer failed — please try again');
  }

  if (!result?.success) {
    console.error('[bdag-transfer] RPC returned failure:', result?.error);
    return respFail(result?.error ?? 'transfer failed');
  }

  console.log(`[bdag-transfer] OK from=${senderId} -${bdagAmount} BDAG → to=${recipientId} net=${result.net_amount}`);

  // ── 7. Create notification for recipient ───────────────────────────────────
  try {
    const { data: senderProfile } = await admin
      .from('user_profiles')
      .select('username, display_name')
      .eq('id', senderId)
      .single();

    const senderName = senderProfile?.display_name || senderProfile?.username || 'Someone';
    await admin.from('notifications').insert({
      user_id:        recipientId,
      from_user_id:   senderId,
      from_username:  senderProfile?.username ?? '',
      type:           'transfer_received',
      message:        `${senderName} sent you ${bdagAmount.toFixed(2)} BDAG${note ? ': ' + note.slice(0, 100) : ''}`,  // cap notification text
      reference_type: 'transfer',
    });
  } catch (e: any) {
    console.warn('[bdag-transfer] notification insert failed (non-fatal):', e?.message);
  }

  // ── 8. Get new sender balance from ledger ──────────────────────────────────
  const { data: updatedAcct } = await admin
    .from('ledger_accounts')
    .select('balance')
    .eq('owner_id', senderId)
    .eq('account_type', 'user')
    .single();

  const newBalance = Number(updatedAcct?.balance ?? 0);

  return respOk({
    success:               true,
    amount:                bdagAmount,
    net_amount:            result.net_amount ?? bdagAmount,
    recipient_username:    recipientProfile.username,
    recipient_display_name: recipientProfile.display_name || recipientProfile.username,
    recipient_avatar:      recipientProfile.avatar_url ?? null,
    new_balance:           newBalance,
    message:               `${bdagAmount.toFixed(2)} BDAG transferred to @${recipientProfile.username}`,
  });
});
