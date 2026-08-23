/* eslint-disable import/no-unresolved -- Deno resolves URL imports at bundle/deploy time. */
/**
 * bdag-monitor — confirmation worker cron
 *
 * RESPONSIBILITIES (post-instant-broadcast architecture):
 *   0. Confirm provisional deposits (mempool credit → on-chain proof)
 *   1. Confirm broadcasted withdrawals (poll receipt, release escrow, mark completed)
 *   2. Handle dropped transactions (re-queue for bdag-withdraw retry)
 *   3. Expire abandoned withdrawals (refund escrow)
 *   4. Cleanup stale velocity counters
 *
 * NOTE: bdag-monitor NO LONGER broadcasts new transactions.
 * All signing/broadcasting is done synchronously in bdag-withdraw.
 * This function only confirms already-broadcasted txs.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders }  from '../_shared/cors.ts';
import { callRPC, getLatestBlock } from '../_shared/rpc.ts';
import {
  isMonitorAuthorized,
  MonitorStepError,
  monitorHttpResult,
  requireMonitorResult,
  sanitizeMonitorMessage,
} from '../_shared/monitorContract.mjs';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MONITOR_SECRET   = (() => {
  const s = Deno.env.get('RECONCILE_SECRET');
  return s ?? '';
})();
const DISPATCH_SECRET = Deno.env.get('CALL_DISPATCH_SECRET') ?? '';

const MIN_CONFIRMATIONS     = 2;
const PROVISIONAL_EXPIRE_MS = 60 * 60 * 1000; // 1 h without receipt → reverse

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
  await requireMonitorResult('mark_provisional_deposit_failed', () =>
    admin.from('deposit_confirmations')
      .update({ status: 'failed', rejection_reason: reason })
      .eq('id', depositId));

  if (bdagAmount <= 0) return;

  const userAcct = await requireMonitorResult('load_provisional_deposit_account', () =>
    admin.from('ledger_accounts')
      .select('id').eq('owner_id', userId).eq('account_type', 'user').single());

  if (!userAcct?.id) {
    throw new MonitorStepError('load_provisional_deposit_account', 'ledger_account_not_found');
  }

  const debitResult = await admin.rpc('ledger_debit', {
    p_txn_id:      crypto.randomUUID(),
    p_account_id:  userAcct.id,
    p_amount:      bdagAmount,
    p_description: `provisional_credit_reversed: ${reason}`,
    p_metadata:    JSON.stringify({ deposit_id: depositId, reason }),
  });

  if (debitResult.error) {
    const debitFailure = new MonitorStepError('reverse_provisional_deposit_credit', debitResult.error);
    await requireMonitorResult('record_provisional_reversal_failure', () =>
      admin.from('suspicious_activity_logs').insert({
        user_id:     userId,
        event_type:  'provisional_reversal_failed',
        severity:    'critical',
        description: 'Failed to reverse provisional deposit credit',
        metadata:    { deposit_id: depositId, bdag_amount: bdagAmount, reason },
      }));
    throw debitFailure;
  }

  log('WARN', 'provisional_credit_reversed', { deposit_id: depositId, reason });
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
    throw new MonitorStepError('load_provisional_deposit_receipt', e);
  }

  if (!receipt || !receipt['blockNumber']) {
    const ageMs = Date.now() - new Date(dep.created_at as string).getTime();
    if (ageMs > PROVISIONAL_EXPIRE_MS) {
      log('WARN', 'deposit_expired_no_receipt', { deposit_id: depositId, age_min: Math.floor(ageMs / 60000) });
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

  await requireMonitorResult('confirm_provisional_deposit', () =>
    admin.from('deposit_confirmations').update({
      status: 'confirmed', block_number: blockNum, confirmations: confs,
      validated_at: new Date().toISOString(),
    }).eq('id', depositId));

  await requireMonitorResult('confirm_deposit_blockchain_settlement', () =>
    admin.from('blockchain_settlements').update({
      status: 'confirmed', rpc_verified: true,
      verified_at: new Date().toISOString(), block_number: blockNum,
    }).eq('tx_hash', txHash));

  log('INFO', 'deposit_confirmed', { deposit_id: depositId, confs });
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// WITHDRAWAL CONFIRMATION (no signing — tx already broadcasted by bdag-withdraw)
// ─────────────────────────────────────────────────────────────────────────────
async function confirmBroadcastedWithdrawal(wr: Record<string, unknown>): Promise<'confirmed' | 'pending' | 'dropped'> {
  const wId      = wr.id as string;
  const txHash   = wr.tx_hash as string;
  const chainId  = wr.chain_id as string;

  if (!txHash) {
    log('WARN', 'broadcasted_withdrawal_no_txhash', { withdrawal_id: wId });
    return 'dropped';
  }

  log('INFO', 'confirming_withdrawal', { withdrawal_id: wId });

  let receipt: Record<string, unknown> | null = null;
  try {
    receipt = await callRPC(chainId, 'eth_getTransactionReceipt', [txHash]) as Record<string, unknown> | null;
  } catch (e: unknown) {
    throw new MonitorStepError('load_withdrawal_receipt', e);
  }

  // Not mined yet
  if (!receipt || !receipt['blockNumber']) {
    const broadcastedAt = wr.last_attempt_at
      ? new Date(wr.last_attempt_at as string).getTime()
      : new Date(wr.created_at as string).getTime();
    const ageMs = Date.now() - broadcastedAt;
    // After 30 minutes without a receipt, consider dropped
    if (ageMs > 30 * 60 * 1000) {
      log('WARN', 'withdrawal_tx_dropped', { withdrawal_id: wId, age_min: Math.floor(ageMs / 60000) });
      return 'dropped';
    }
    log('INFO', 'withdrawal_awaiting_mine', { withdrawal_id: wId, age_sec: Math.floor(ageMs / 1000) });
    return 'pending';
  }

  // Reverted on-chain
  if (receipt['status'] !== '0x1') {
    log('ERROR', 'withdrawal_tx_reverted', { withdrawal_id: wId });
    // Refund the escrow back to user
    await requireMonitorResult('refund_reverted_withdrawal', () =>
      admin.rpc('refund_withdrawal_to_ledger', {
        p_withdrawal_id:  wId,
        p_failure_reason: `tx_reverted_on_chain: ${txHash}`,
      }));
    return 'dropped';
  }

  const blockNum = parseInt(receipt['blockNumber'] as string, 16);
  const latest   = await getLatestBlock(chainId);
  const confs    = Math.max(0, latest - blockNum);

  log('INFO', 'withdrawal_receipt_found', { withdrawal_id: wId, block: blockNum, confs });

  if (confs < MIN_CONFIRMATIONS) {
    log('INFO', 'withdrawal_not_enough_confs', { withdrawal_id: wId, confs, need: MIN_CONFIRMATIONS });
    return 'pending';
  }

  const { data: completion, error: completionError } = await admin.rpc(
    'complete_withdrawal_settlement',
    {
      p_withdrawal_id: wId,
      p_tx_hash: txHash,
      p_confirmations: confs,
      p_block_number: blockNum,
      p_receipt: receipt,
    },
  );
  if (completionError || !completion?.success) {
    throw new Error(completionError?.message ?? completion?.error ?? 'atomic withdrawal completion failed');
  }

  log('INFO', 'withdrawal_completed', { withdrawal_id: wId, confs });
  return 'confirmed';
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const secret     = req.headers.get('X-Monitor-Secret') ?? req.headers.get('Authorization');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const isAuthorized = isMonitorAuthorized(
    secret,
    MONITOR_SECRET,
    DISPATCH_SECRET,
    serviceKey,
  );

  if (!isAuthorized) {
    log('WARN', 'monitor_forbidden');
    return new Response(
      JSON.stringify({ error: 'forbidden' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 },
    );
  }

  log('INFO', 'monitor_triggered', { method: req.method });
  const results: Record<string, unknown> = {};

  try {
    // ── 0. Confirm provisional deposits ──────────────────────────────────
    const provisionalDeposits = await requireMonitorResult('load_provisional_deposits', () =>
      admin.from('deposit_confirmations')
        .select('*')
        .in('status', ['provisional', 'pending'])
        .gt('created_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: true })
        .limit(20));

    const depositResults = [];
    for (const dep of (provisionalDeposits ?? [])) {
      try {
        const confirmed = await confirmOrReverseProvisionalDeposit(dep as Record<string, unknown>);
        depositResults.push({ id: dep.id, confirmed });
      } catch (e: unknown) {
        const failure = e instanceof MonitorStepError
          ? e
          : new MonitorStepError('confirm_provisional_deposit', e);
        depositResults.push({
          id: dep.id,
          confirmed: false,
          error: { step: failure.step, message: sanitizeMonitorMessage(failure) },
        });
        throw failure;
      }
    }
    results.deposit_confirmations = depositResults;

    // ── 1. Confirm broadcasted withdrawals (receipt polling only) ─────────
    // Pick up withdrawals that bdag-withdraw already broadcasted
    const broadcastedWithdrawals = await requireMonitorResult('load_broadcasted_withdrawals', () =>
      admin.from('withdrawal_requests')
        .select('*')
        .in('status', ['broadcasted', 'signing'])
        .order('created_at', { ascending: true })
        .limit(10));

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
            await requireMonitorResult('requeue_dropped_withdrawal', () =>
              admin.from('withdrawal_requests').update({
                status: 'queued',
                failure_reason: 'tx_dropped_requeued_for_retry',
                tx_hash: null,
              }).eq('id', wr.id));
            log('WARN', 'dropped_withdrawal_requeued', { withdrawal_id: wr.id });
          } else {
            // Max retries exceeded — refund
            await requireMonitorResult('refund_dropped_withdrawal', () =>
              admin.rpc('refund_withdrawal_to_ledger', {
                p_withdrawal_id:  wr.id,
                p_failure_reason: 'tx_dropped_max_retries_exceeded',
              }));
            log('WARN', 'dropped_withdrawal_refunded', { withdrawal_id: wr.id });
          }
        }
      } catch (e: unknown) {
        const failure = e instanceof MonitorStepError
          ? e
          : new MonitorStepError('confirm_broadcasted_withdrawal', e);
        log('ERROR', 'confirm_withdrawal_error', {
          withdrawal_id: wr.id,
          step: failure.step,
          error: sanitizeMonitorMessage(failure),
        });
        confirmResults.push({
          id: wr.id,
          outcome: 'error',
          error: { step: failure.step, message: sanitizeMonitorMessage(failure) },
        });
        throw failure;
      }
    }
    results.withdrawal_confirmations = confirmResults;

    // ── 2. Handle abandoned queued withdrawals (missed by bdag-withdraw) ──
    // These should rarely occur in the new architecture but keep as safety net
    const abandonedQueued = await requireMonitorResult('load_abandoned_withdrawals', () =>
      admin.from('withdrawal_requests')
        .select('id, created_at, attempts')
        .eq('status', 'queued')
        .lt('created_at', new Date(Date.now() - 5 * 60 * 1000).toISOString()) // queued > 5 min
        .lt('attempts', 3)
        .limit(5));

    if (abandonedQueued && abandonedQueued.length > 0) {
      log('WARN', 'abandoned_queued_withdrawals_found', { count: abandonedQueued.length });
      // Trigger bdag-withdraw to re-process — these will be picked up on next user retry
      // or admin can manually trigger. Log for visibility only.
      results.abandoned_queued = abandonedQueued.map(w => w.id);
    }

    // ── 3. Expire timed-out withdrawals ───────────────────────────────────
    const expiredWds = await requireMonitorResult('load_expired_withdrawals', () =>
      admin.from('withdrawal_requests')
        .select('id')
        .in('status', ['queued', 'requested'])
        .lt('expires_at', new Date().toISOString()));

    let expiredCount = 0;
    for (const wd of (expiredWds ?? [])) {
      await requireMonitorResult('refund_expired_withdrawal', () =>
        admin.rpc('refund_withdrawal_to_ledger', {
          p_withdrawal_id:  wd.id,
          p_failure_reason: 'withdrawal_expired',
        }));
      expiredCount++;
      log('WARN', 'expired_withdrawal_refunded', { withdrawal_id: wd.id });
    }
    results.expired_refunds = expiredCount;

    // ── 4. Cleanup stale velocity counters ────────────────────────────────
    await requireMonitorResult('cleanup_stale_velocity_counters', () =>
      admin.from('velocity_counters')
        .delete()
        .lt('window_end', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()));
    results.velocity_counters_cleaned = true;

    log('INFO', 'monitor_cycle_complete', {
      deposit_count: depositResults.length,
      withdrawal_count: confirmResults.length,
      expired_refund_count: expiredCount,
    });

    const outcome = monitorHttpResult(null, results);
    return new Response(JSON.stringify(outcome.body), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: outcome.status,
    });

  } catch (e: unknown) {
    const outcome = monitorHttpResult(e, results);
    const failure = outcome.body.error as { step: string; message: string };
    log('ERROR', 'monitor_cycle_error', failure);
    return new Response(JSON.stringify(outcome.body), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: outcome.status,
    });
  }
});
