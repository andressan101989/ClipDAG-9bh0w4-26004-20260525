/**
 * bdag-monitor — confirmation worker + reconciliation cron
 *
 * RESPONSIBILITIES (post-instant-broadcast architecture):
 *   0. Confirm provisional deposits (mempool credit → on-chain proof)
 *   1. Confirm broadcasted withdrawals (poll receipt, release escrow, mark completed)
 *   2. Handle dropped transactions (re-queue for bdag-withdraw retry)
 *   3. Expire abandoned withdrawals (refund escrow)
 *   4. Refund expired premium DMs
 *   5. Reconciliation check
 *   6. Cleanup expired idempotency keys + stale velocity counters
 *
 * NOTE: bdag-monitor NO LONGER broadcasts new transactions.
 * All signing/broadcasting is done synchronously in bdag-withdraw.
 * This function only confirms already-broadcasted txs.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders }  from '../_shared/cors.ts';
import { callRPC, getLatestBlock } from '../_shared/rpc.ts';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MONITOR_SECRET   = Deno.env.get('RECONCILE_SECRET') ?? 'dev-secret';
const TREASURY_ADDRESS = (Deno.env.get('TREASURY_WALLET_ADDRESS') ?? '').toLowerCase();

const MIN_CONFIRMATIONS     = 2;
const PROVISIONAL_EXPIRE_MS = 60 * 60 * 1000; // 1 h without receipt → reverse
const BDAG_TO_USD           = 0.01;            // 1 BDAG = $0.01 USD (fixed)

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string, meta?: Record<string, unknown>) {
  console.log(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...meta }));
}

// ─────────────────────────────────────────────────────────────────────────────
// DEPOSIT CONFIRMATION
// ─────────────────────────────────────────────────────────────────────────────

async function reverseProvisionalCredit(
  depositId:  string,
  userId:     string,
  bdagAmount: number,
  reason:     string,
): Promise<void> {
  await admin.from('deposit_confirmations')
    .update({ status: 'failed', rejection_reason: reason })
    .eq('id', depositId);

  if (bdagAmount <= 0) return;

  const { data: userAcct } = await admin.from('ledger_accounts')
    .select('id').eq('owner_id', userId).eq('account_type', 'user').single();

  if (!userAcct?.id) {
    log('ERROR', 'reversal_no_ledger_account', { user_id: userId, deposit_id: depositId });
    return;
  }

  const { error: debitErr } = await admin.rpc('ledger_debit', {
    p_txn_id:      crypto.randomUUID(),
    p_account_id:  userAcct.id,
    p_amount:      bdagAmount,
    p_description: `provisional_credit_reversed: ${reason}`,
    p_metadata:    JSON.stringify({ deposit_id: depositId, reason }),
  });

  if (debitErr) {
    log('ERROR', 'reversal_debit_failed', { user_id: userId, error: debitErr.message });
    await admin.from('suspicious_activity_logs').insert({
      user_id:     userId,
      event_type:  'provisional_reversal_failed',
      severity:    'critical',
      description: `Failed to reverse provisional deposit ${depositId}: ${debitErr.message}`,
      metadata:    { deposit_id: depositId, bdag_amount: bdagAmount, reason },
    });
    return;
  }

  log('WARN', 'provisional_credit_reversed', {
    user_id: userId, deposit_id: depositId, bdag_amount: bdagAmount, reason,
  });
}

async function confirmOrReverseProvisionalDeposit(dep: Record<string, unknown>): Promise<boolean> {
  const txHash       = dep.tx_hash as string;
  const chainId      = dep.chain_id as string;
  const userId       = dep.user_id as string;
  const depositId    = dep.id as string;
  const bdagCredited = Number(dep.bdag_credited ?? 0);

  let receipt: Record<string, unknown> | null = null;
  try {
    receipt = await callRPC(chainId, 'eth_getTransactionReceipt', [txHash]) as Record<string, unknown> | null;
  } catch (e: unknown) {
    log('WARN', 'receipt_rpc_error', { tx_hash: txHash, error: (e as Error)?.message });
    return false;
  }

  if (!receipt || !receipt['blockNumber']) {
    const ageMs = Date.now() - new Date(dep.created_at as string).getTime();
    if (ageMs > PROVISIONAL_EXPIRE_MS) {
      log('WARN', 'deposit_expired_no_receipt', { tx_hash: txHash, age_min: Math.floor(ageMs / 60000) });
      await reverseProvisionalCredit(depositId, userId, bdagCredited, 'tx_dropped_from_mempool');
    }
    return false;
  }

  if (receipt['status'] !== '0x1') {
    await reverseProvisionalCredit(depositId, userId, bdagCredited, 'tx_reverted_on_chain');
    return false;
  }

  const blockNum  = parseInt(receipt['blockNumber'] as string, 16);
  const latestHex = await callRPC(chainId, 'eth_blockNumber', []) as string;
  const confs     = Math.max(0, parseInt(latestHex, 16) - blockNum);

  await admin.from('deposit_confirmations').update({
    status: 'confirmed', block_number: blockNum, confirmations: confs,
    validated_at: new Date().toISOString(),
  }).eq('id', depositId);

  await admin.from('blockchain_settlements').update({
    status: 'confirmed', rpc_verified: true,
    verified_at: new Date().toISOString(), block_number: blockNum,
  }).eq('tx_hash', txHash);

  log('INFO', 'deposit_confirmed', { tx_hash: txHash, confs, user_id: userId });
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// WITHDRAWAL CONFIRMATION (no signing — tx already broadcasted by bdag-withdraw)
// ─────────────────────────────────────────────────────────────────────────────
async function confirmBroadcastedWithdrawal(wr: Record<string, unknown>): Promise<'confirmed' | 'pending' | 'dropped'> {
  const wId      = wr.id as string;
  const txHash   = wr.tx_hash as string;
  const chainId  = wr.chain_id as string;
  const netBdag  = Number(wr.net_bdag ?? 0);
  const toAddr   = (wr.to_address as string).toLowerCase();
  const tokenType = ((wr.token_type as string) ?? 'ETH').toUpperCase();

  if (!txHash) {
    log('WARN', 'broadcasted_withdrawal_no_txhash', { withdrawal_id: wId });
    return 'dropped';
  }

  log('INFO', 'confirming_withdrawal', { withdrawal_id: wId, tx_hash: txHash.slice(0, 12) });

  let receipt: Record<string, unknown> | null = null;
  try {
    receipt = await callRPC(chainId, 'eth_getTransactionReceipt', [txHash]) as Record<string, unknown> | null;
  } catch (e: unknown) {
    log('WARN', 'withdrawal_receipt_rpc_error', { tx_hash: txHash, error: (e as Error)?.message });
    return 'pending';
  }

  // Not mined yet
  if (!receipt || !receipt['blockNumber']) {
    const broadcastedAt = wr.last_attempt_at
      ? new Date(wr.last_attempt_at as string).getTime()
      : new Date(wr.created_at as string).getTime();
    const ageMs = Date.now() - broadcastedAt;
    // After 30 minutes without a receipt, consider dropped
    if (ageMs > 30 * 60 * 1000) {
      log('WARN', 'withdrawal_tx_dropped', { withdrawal_id: wId, tx_hash: txHash, age_min: Math.floor(ageMs / 60000) });
      return 'dropped';
    }
    log('INFO', 'withdrawal_awaiting_mine', { withdrawal_id: wId, tx_hash: txHash, age_sec: Math.floor(ageMs / 1000) });
    return 'pending';
  }

  // Reverted on-chain
  if (receipt['status'] !== '0x1') {
    log('ERROR', 'withdrawal_tx_reverted', { withdrawal_id: wId, tx_hash: txHash });
    // Refund the escrow back to user
    await admin.rpc('refund_withdrawal_to_ledger', {
      p_withdrawal_id:  wId,
      p_failure_reason: `tx_reverted_on_chain: ${txHash}`,
    });
    return 'dropped';
  }

  const blockNum = parseInt(receipt['blockNumber'] as string, 16);
  const latest   = await getLatestBlock(chainId);
  const confs    = Math.max(0, latest - blockNum);

  log('INFO', 'withdrawal_receipt_found', { withdrawal_id: wId, tx_hash: txHash, block: blockNum, confs });

  if (confs < MIN_CONFIRMATIONS) {
    log('INFO', 'withdrawal_not_enough_confs', { withdrawal_id: wId, confs, need: MIN_CONFIRMATIONS });
    return 'pending';
  }

  // ── Confirmed — release escrow and mark completed ─────────────────────────
  await admin.from('blockchain_settlements').upsert({
    settlement_type: 'withdrawal',
    reference_id:    wId,
    chain_id:        chainId,
    tx_hash:         txHash,
    from_address:    TREASURY_ADDRESS,
    to_address:      toAddr,
    amount_wei:      '0',
    block_number:    blockNum,
    status:          'confirmed',
    rpc_verified:    true,
    verified_at:     new Date().toISOString(),
    raw_receipt:     receipt,
  }, { onConflict: 'tx_hash' });

  // Release escrow
  const { data: escrow } = await admin.from('ledger_accounts')
    .select('id').eq('account_type', 'escrow').maybeSingle();
  if (escrow?.id) {
    const { error: escrowErr } = await admin.rpc('ledger_debit', {
      p_txn_id:      crypto.randomUUID(),
      p_account_id:  escrow.id,
      p_amount:      netBdag,
      p_description: `withdrawal_settled_${tokenType}: ${txHash}`,
      p_metadata:    JSON.stringify({ tx_hash: txHash, token_type: tokenType }),
    });
    if (escrowErr) {
      log('ERROR', 'escrow_debit_failed', { error: escrowErr.message, withdrawal_id: wId });
    }
  }

  await admin.from('withdrawal_requests').update({
    status: 'completed', tx_hash: txHash, confirmations: confs,
  }).eq('id', wId);

  // ── Also mark the financial_transaction as completed ──────────────────
  // withdrawal_requests.fin_txn_id links to the financial_transactions record
  // which starts as 'pending' — update it so the wallet history shows correctly
  if (wr.fin_txn_id) {
    const { error: ftErr } = await admin
      .from('financial_transactions')
      .update({ status: 'completed', blockchain_txid: txHash })
      .eq('id', wr.fin_txn_id as string);
    if (ftErr) {
      log('WARN', 'fin_txn_status_update_failed', { fin_txn_id: wr.fin_txn_id, error: ftErr.message });
    } else {
      log('INFO', 'fin_txn_marked_completed', { fin_txn_id: wr.fin_txn_id, tx_hash: txHash });
    }
  }

  await admin.from('audit_events').insert({
    entity_type: 'withdrawal_request',
    entity_id:   wId,
    action:      'completed',
    new_state:   { tx_hash: txHash, confirmations: confs, token_type: tokenType },
  });

  log('INFO', 'withdrawal_completed', { withdrawal_id: wId, tx_hash: txHash, confs });
  return 'confirmed';
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const secret     = req.headers.get('X-Monitor-Secret') ?? req.headers.get('Authorization');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const isAuthorized =
    secret === MONITOR_SECRET ||
    secret === `Bearer ${MONITOR_SECRET}` ||
    (serviceKey && secret === `Bearer ${serviceKey}`);

  if (!isAuthorized) {
    log('WARN', 'monitor_forbidden', { secret_prefix: (secret ?? '').slice(0, 12) });
    return new Response(
      JSON.stringify({ error: 'forbidden' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 },
    );
  }

  log('INFO', 'monitor_triggered', { method: req.method });
  const results: Record<string, unknown> = {};

  try {
    // ── 0. Confirm provisional deposits ──────────────────────────────────
    const { data: provisionalDeposits } = await admin
      .from('deposit_confirmations')
      .select('*')
      .in('status', ['provisional', 'pending'])
      .gt('created_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: true })
      .limit(20);

    const depositResults = [];
    for (const dep of (provisionalDeposits ?? [])) {
      try {
        const confirmed = await confirmOrReverseProvisionalDeposit(dep as Record<string, unknown>);
        depositResults.push({ id: dep.id, confirmed });
      } catch (e: unknown) {
        depositResults.push({ id: dep.id, confirmed: false, error: String(e) });
      }
    }
    results.deposit_confirmations = depositResults;

    // ── 1. Confirm broadcasted withdrawals (receipt polling only) ─────────
    // Pick up withdrawals that bdag-withdraw already broadcasted
    const { data: broadcastedWithdrawals } = await admin
      .from('withdrawal_requests')
      .select('*')
      .in('status', ['broadcasted', 'signing'])  // signing = may have been mid-broadcast when monitor was called
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(10);

    log('INFO', 'broadcasted_withdrawals_queue', { count: broadcastedWithdrawals?.length ?? 0 });

    const confirmResults = [];
    for (const wr of (broadcastedWithdrawals ?? [])) {
      try {
        const outcome = await confirmBroadcastedWithdrawal(wr as Record<string, unknown>);
        confirmResults.push({ id: wr.id, outcome });

        // If dropped, try to recover: re-queue for retry
        if (outcome === 'dropped') {
          const currentAttempts = Number(wr.attempts ?? 1);
          if (currentAttempts < 3) {
            await admin.from('withdrawal_requests').update({
              status: 'queued',
              failure_reason: 'tx_dropped_requeued_for_retry',
              tx_hash: null,
            }).eq('id', wr.id);
            log('WARN', 'dropped_withdrawal_requeued', { withdrawal_id: wr.id });
          } else {
            // Max retries exceeded — refund
            await admin.rpc('refund_withdrawal_to_ledger', {
              p_withdrawal_id:  wr.id,
              p_failure_reason: 'tx_dropped_max_retries_exceeded',
            });
            log('WARN', 'dropped_withdrawal_refunded', { withdrawal_id: wr.id });
          }
        }
      } catch (e: unknown) {
        log('ERROR', 'confirm_withdrawal_error', {
          withdrawal_id: wr.id, error: e instanceof Error ? e.message : String(e),
        });
        confirmResults.push({ id: wr.id, outcome: 'error', error: String(e) });
      }
    }
    results.withdrawal_confirmations = confirmResults;

    // ── 2. Handle abandoned queued withdrawals (missed by bdag-withdraw) ──
    // These should rarely occur in the new architecture but keep as safety net
    const { data: abandonedQueued } = await admin
      .from('withdrawal_requests')
      .select('id, created_at, attempts')
      .eq('status', 'queued')
      .lt('created_at', new Date(Date.now() - 5 * 60 * 1000).toISOString()) // queued > 5 min
      .lt('attempts', 3)
      .limit(5);

    if (abandonedQueued && abandonedQueued.length > 0) {
      log('WARN', 'abandoned_queued_withdrawals_found', { count: abandonedQueued.length });
      // Trigger bdag-withdraw to re-process — these will be picked up on next user retry
      // or admin can manually trigger. Log for visibility only.
      results.abandoned_queued = abandonedQueued.map(w => w.id);
    }

    // ── 3. Expire timed-out withdrawals ───────────────────────────────────
    const { data: expiredWds } = await admin
      .from('withdrawal_requests')
      .select('id')
      .in('status', ['queued', 'requested'])
      .lt('expires_at', new Date().toISOString());

    let expiredCount = 0;
    for (const wd of (expiredWds ?? [])) {
      const { error: refErr } = await admin.rpc('refund_withdrawal_to_ledger', {
        p_withdrawal_id:  wd.id,
        p_failure_reason: 'withdrawal_expired',
      });
      if (!refErr) {
        expiredCount++;
        log('WARN', 'expired_withdrawal_refunded', { withdrawal_id: wd.id });
      }
    }
    results.expired_refunds = expiredCount;

    // ── 4. Refund expired premium DMs ─────────────────────────────────────
    const { data: dmRefunds, error: dmErr } = await admin.rpc('refund_expired_premium_dms');
    if (dmErr) log('ERROR', 'dm_refund_failed', { error: dmErr.message });
    results.dm_refunds = dmRefunds;

    // ── 5. Reconciliation ─────────────────────────────────────────────────
    const { data: recon, error: reconErr } = await admin.rpc('run_reconciliation_check');
    if (reconErr) log('ERROR', 'reconciliation_failed', { error: reconErr.message });
    results.reconciliation = recon;

    // ── 6. Cleanup ────────────────────────────────────────────────────────
    const { data: cleaned } = await admin.rpc('cleanup_expired_idempotency_keys');
    results.idempotency_cleaned = cleaned ?? 0;

    await admin.from('velocity_counters')
      .delete()
      .lt('window_end', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());

    log('INFO', 'monitor_cycle_complete', results as Record<string, unknown>);

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
    });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log('ERROR', 'monitor_cycle_error', { error: msg });
    return new Response(JSON.stringify({ success: false, error: msg }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
    });
  }
});
