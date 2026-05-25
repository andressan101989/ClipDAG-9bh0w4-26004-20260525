/**
 * bdag-withdraw — INSTANT broadcast settlement
 *
 * ARCHITECTURE (changed from queue-based to instant-broadcast):
 *   1. Validate request (idempotency, balance, address, cooldown)
 *   2. Debit user ledger → escrow atomically via request_withdrawal_from_ledger
 *   3. Sign & broadcast blockchain tx IMMEDIATELY (< 5 s)
 *   4. Persist txHash, mark status = 'broadcasted'
 *   5. Return { success, txHash, status } to frontend instantly
 *   6. Fire-and-forget: trigger bdag-monitor for confirmation-only (async)
 *
 * bdag-monitor ONLY handles: on-chain confirmation, escrow release,
 * status → completed, dropped-tx detection, reconciliation.
 * It NO LONGER broadcasts new transactions.
 *
 * CONVERSION RATES (backend is sole authority):
 *   1 BDAG = $0.01 USD
 *   1 USDT = 1 USD  (1:1 peg, no price feed needed)
 *   1 ETH  = live CoinGecko price at broadcast time
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders }  from '../_shared/cors.ts';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MONITOR_SECRET   = Deno.env.get('RECONCILE_SECRET') ?? 'dev-secret';
const TREASURY_KEY     = Deno.env.get('TREASURY_PRIVATE_KEY');
const TREASURY_ADDRESS = (Deno.env.get('TREASURY_WALLET_ADDRESS') ?? '').toLowerCase();
const ALCHEMY_KEY      = Deno.env.get('ALCHEMY_ETH_KEY') ?? '';

const MIN_WITHDRAWAL_BDAG  = 100;
const MAX_WITHDRAWAL_BDAG  = 1_000_000;
const WITHDRAWAL_COOLDOWN_MS = 10 * 60 * 1000;
const BDAG_TO_USD          = 0.01;   // 1 BDAG = $0.01 USD (fixed)
const USDT_DECIMALS        = 6;

// ── USDT contract addresses per EIP-155 chain ID ──────────────────────────────
const USDT_CONTRACTS: Record<string, string> = {
  '1':        '0xdac17f958d2ee523a2206206994597c13d831ec7', // Ethereum mainnet
  '8453':     '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // Base mainnet
  '97':       '0x337610d27c682e347c9cd60bd4b3b107c9d34def', // BSC testnet
  '11155111': '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06', // Sepolia testnet
};

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
];

// Signing RPC: prefer Alchemy, fall back to public nodes
function getSigningRPC(chainId: string): string {
  if (ALCHEMY_KEY) {
    const map: Record<string, string> = {
      '1':        `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
      '8453':     `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
      '11155111': `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_KEY}`,
    };
    if (map[chainId]) return map[chainId];
  }
  const fallback: Record<string, string> = {
    '1':        'https://ethereum-rpc.publicnode.com',
    '8453':     'https://base-rpc.publicnode.com',
    '97':       'https://data-seed-prebsc-1-s1.binance.org:8545',
    '11155111': 'https://ethereum-sepolia-rpc.publicnode.com',
  };
  return fallback[chainId] ?? fallback['1'];
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

function log(level: string, msg: string, meta?: Record<string, unknown>) {
  console.log(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...meta }));
}
function ok(d: unknown) {
  return new Response(JSON.stringify({ success: true, data: d }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
  });
}
function fail(e: string, code = 400) {
  return new Response(JSON.stringify({ success: false, error: e }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: code,
  });
}
function isValidEVMAddress(addr: string) { return /^0x[a-fA-F0-9]{40}$/.test(addr); }

// ── Live ETH price ─────────────────────────────────────────────────────────────
async function fetchEthPriceUsd(): Promise<number> {
  try {
    const r = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
      { signal: AbortSignal.timeout(5000) },
    );
    if (r.ok) {
      const j = await r.json() as { ethereum?: { usd?: number } };
      const p = j?.ethereum?.usd;
      if (typeof p === 'number' && p > 100) return p;
    }
  } catch { /* try next */ }
  try {
    const r = await fetch(
      'https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT',
      { signal: AbortSignal.timeout(5000) },
    );
    if (r.ok) {
      const j = await r.json() as { price?: string };
      const p = parseFloat(j?.price ?? '0');
      if (p > 100) return p;
    }
  } catch { /* fallback */ }
  log('WARN', 'eth_price_fallback', { price: 2000 });
  return 2000;
}

// ── Conversion helpers ─────────────────────────────────────────────────────────
function bdagToEthWei(bdag: number, ethPriceUsd: number): number {
  const usd = bdag * BDAG_TO_USD;
  const eth = usd / ethPriceUsd;
  return Math.floor(eth * 1e18);
}
function bdagToUsdtUnits(bdag: number): number {
  const usdt = bdag * BDAG_TO_USD;
  return Math.floor(usdt * 10 ** USDT_DECIMALS);
}

// ── ETH native broadcast ───────────────────────────────────────────────────────
async function broadcastETH(params: {
  toAddress: string; netBdag: number; chainId: string;
}): Promise<{ txHash: string; amountWei: number; ethPriceUsd: number } | { error: string }> {
  if (!TREASURY_KEY) return { error: 'TREASURY_PRIVATE_KEY not configured' };

  try {
    const { ethers } = await import('https://esm.sh/ethers@6.13.1');
    const rpcUrl     = getSigningRPC(params.chainId);
    const provider   = new ethers.JsonRpcProvider(rpcUrl);
    const wallet     = new ethers.Wallet(TREASURY_KEY, provider);

    const ethPriceUsd = await fetchEthPriceUsd();
    const grossWei    = bdagToEthWei(params.netBdag, ethPriceUsd);

    // Estimate gas fee and subtract from gross amount
    const feeData     = await provider.getFeeData();
    const gasPrice    = feeData.gasPrice ?? BigInt(20_000_000_000); // 20 gwei fallback
    const gasLimit    = BigInt(21_000);
    const gasFeeWei   = gasPrice * gasLimit;
    const netWei      = BigInt(grossWei) - gasFeeWei;

    log('INFO', 'eth_broadcast_amounts', {
      net_bdag: params.netBdag, eth_price_usd: ethPriceUsd,
      gross_wei: grossWei, gas_fee_wei: gasFeeWei.toString(), net_wei: netWei.toString(),
    });

    if (netWei <= BigInt(0)) {
      return { error: `withdrawal_too_small_for_gas: grossWei=${grossWei} gasFee=${gasFeeWei}` };
    }

    const tx = await wallet.sendTransaction({
      to:       params.toAddress,
      value:    netWei,
      gasLimit,
    });

    log('INFO', 'eth_tx_broadcasted', { tx_hash: tx.hash, to: params.toAddress });
    return { txHash: tx.hash, amountWei: Number(netWei), ethPriceUsd };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// ── USDT ERC-20 broadcast ──────────────────────────────────────────────────────
async function broadcastUSDT(params: {
  toAddress: string; netBdag: number; chainId: string;
}): Promise<{ txHash: string; usdtAmount: number; usdtUnits: number } | { error: string }> {
  if (!TREASURY_KEY) return { error: 'TREASURY_PRIVATE_KEY not configured' };

  const usdtContract = USDT_CONTRACTS[params.chainId];
  if (!usdtContract) {
    return { error: `USDT not supported on chain ${params.chainId}` };
  }

  try {
    const { ethers } = await import('https://esm.sh/ethers@6.13.1');
    const rpcUrl     = getSigningRPC(params.chainId);
    const provider   = new ethers.JsonRpcProvider(rpcUrl);
    const wallet     = new ethers.Wallet(TREASURY_KEY, provider);
    const contract   = new ethers.Contract(usdtContract, ERC20_ABI, wallet);

    const usdtUnits  = bdagToUsdtUnits(params.netBdag);
    const usdtAmount = params.netBdag * BDAG_TO_USD;

    if (usdtUnits <= 0) return { error: `usdt_amount_too_small: ${usdtUnits}` };

    log('INFO', 'usdt_broadcast_amounts', {
      net_bdag: params.netBdag, usdt_amount: usdtAmount, usdt_units: usdtUnits,
      contract: usdtContract, to: params.toAddress,
    });

    // Verify treasury balance
    try {
      const bal = await contract['balanceOf'](TREASURY_ADDRESS) as bigint;
      if (bal < BigInt(usdtUnits)) {
        return { error: `treasury_insufficient_usdt: balance=${bal} need=${usdtUnits}` };
      }
    } catch { /* non-fatal, continue */ }

    // Estimate gas with 20% buffer
    let gasLimit = BigInt(100_000); // safe default
    try {
      const est: bigint = await contract['transfer'].estimateGas(params.toAddress, BigInt(usdtUnits)) as bigint;
      gasLimit = BigInt(Math.ceil(Number(est) * 1.2));
      log('INFO', 'usdt_gas_estimated', { estimated: est.toString(), with_buffer: gasLimit.toString() });
    } catch (e: unknown) {
      log('WARN', 'usdt_gas_estimation_failed', { error: (e as Error)?.message });
    }

    const tx = await contract['transfer'](params.toAddress, BigInt(usdtUnits), { gasLimit });

    log('INFO', 'usdt_tx_broadcasted', { tx_hash: tx.hash, to: params.toAddress, usdt_amount: usdtAmount });
    return { txHash: tx.hash, usdtAmount, usdtUnits };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return fail('unauthorized', 401);
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) return fail('unauthorized', 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail('invalid JSON'); }

  const { action = 'request' } = body;

  try {
    // ── Status check ──────────────────────────────────────────────────────
    if (action === 'status') {
      const { withdrawal_id } = body;
      if (!withdrawal_id) return fail('withdrawal_id required');
      const { data, error } = await admin.from('withdrawal_requests')
        .select('id, status, bdag_amount, net_bdag, fee_bdag, to_address, tx_hash, failure_reason, created_at, updated_at')
        .eq('id', withdrawal_id).eq('user_id', user.id).single();
      if (error) return fail('withdrawal not found');
      return ok(data);
    }

    // ── List withdrawals ───────────────────────────────────────────────────
    if (action === 'list') {
      const { data } = await admin.from('withdrawal_requests')
        .select('id, status, bdag_amount, net_bdag, to_address, tx_hash, created_at')
        .eq('user_id', user.id).order('created_at', { ascending: false }).limit(20);
      return ok(data ?? []);
    }

    // ── Validate request ───────────────────────────────────────────────────
    const { amount, to_address, chain_id, token_type, idempotency_key } = body;
    if (!amount || !to_address || !chain_id || !token_type || !idempotency_key)
      return fail('amount, to_address, chain_id, token_type, idempotency_key required');

    const amt = Number(amount);
    if (isNaN(amt) || amt < MIN_WITHDRAWAL_BDAG) return fail(`minimum withdrawal: ${MIN_WITHDRAWAL_BDAG} BDAG`);
    if (amt > MAX_WITHDRAWAL_BDAG) return fail(`maximum withdrawal: ${MAX_WITHDRAWAL_BDAG} BDAG`);
    if (!isValidEVMAddress(to_address as string)) return fail('invalid EVM wallet address');
    if (!['ETH', 'USDT'].includes(token_type as string)) return fail('token_type must be ETH or USDT');

    const chainId  = String(chain_id);
    const toAddr   = (to_address as string).toLowerCase();
    const tokenTyp = (token_type as string).toUpperCase();

    // ── Cooldown check ─────────────────────────────────────────────────────
    const since = new Date(Date.now() - WITHDRAWAL_COOLDOWN_MS).toISOString();
    const { data: recentWithdrawal } = await admin
      .from('withdrawal_requests')
      .select('id, created_at, status')
      .eq('user_id', user.id)
      .in('status', ['queued', 'signing', 'broadcasted', 'confirmed', 'completed'])
      .gte('created_at', since)
      .limit(1)
      .maybeSingle();

    if (recentWithdrawal) {
      const createdAt   = new Date(recentWithdrawal.created_at).getTime();
      const cooldownEnd = createdAt + WITHDRAWAL_COOLDOWN_MS;
      const remainingMs = Math.max(0, cooldownEnd - Date.now());
      const min = Math.floor(remainingMs / 60000);
      const sec = Math.floor((remainingMs % 60000) / 1000);
      const timeStr = min > 0 ? `${min}m ${sec}s` : `${sec}s`;
      return fail(`withdrawal_cooldown: Next withdrawal available in ${timeStr}`, 429);
    }

    // ── Balance check from authoritative ledger ────────────────────────────
    const { data: ledgerAcct } = await admin
      .from('ledger_accounts')
      .select('balance')
      .eq('owner_id', user.id)
      .eq('account_type', 'user')
      .single();
    const currentBalance = Number(ledgerAcct?.balance ?? 0);
    log('INFO', 'balance_check', { user_id: user.id, ledger_balance: currentBalance, requested: amt });
    if (currentBalance < amt)
      return fail(`insufficient BDAG balance. Available: ${currentBalance.toFixed(2)} BDAG`);

    // ── Pre-flight: check treasury key is configured ────────────────────────
    if (!TREASURY_KEY) {
      log('ERROR', 'treasury_key_missing', { user_id: user.id });
      return fail('withdrawal system not configured — contact support', 503);
    }

    // ── Atomic: debit user → escrow, create withdrawal record ──────────────
    const { data: rpcData, error: rpcErr } = await admin.rpc('request_withdrawal_from_ledger', {
      p_user_id:         user.id,
      p_bdag_amount:     amt,
      p_to_address:      toAddr,
      p_chain_id:        chainId,
      p_token_type:      tokenTyp,
      p_idempotency_key: idempotency_key,
    });

    if (rpcErr) return fail(rpcErr.message);
    if (!rpcData?.success) return fail(rpcData?.error ?? 'withdrawal request failed');

    const withdrawalId = rpcData.withdrawal_id;
    const netBdag      = Number(rpcData.net_bdag ?? 0);
    const feeBdag      = Number(rpcData.fee_bdag ?? 0);

    log('INFO', 'withdrawal_queued', {
      withdrawal_id: withdrawalId, net_bdag: netBdag, fee_bdag: feeBdag,
      token_type: tokenTyp, chain_id: chainId, to: toAddr,
    });

    // ── Mark as signing ────────────────────────────────────────────────────
    await admin.from('withdrawal_requests').update({
      status: 'signing', attempts: 1, last_attempt_at: new Date().toISOString(),
    }).eq('id', withdrawalId);

    // ── INSTANT BROADCAST ──────────────────────────────────────────────────
    let txHash      = '';
    let broadcastOk = false;
    let broadcastErr = '';
    let ethPriceSnapshot: number | null = null;

    if (tokenTyp === 'USDT') {
      const result = await broadcastUSDT({ toAddress: toAddr, netBdag, chainId });
      if ('error' in result) {
        broadcastErr = result.error;
      } else {
        txHash      = result.txHash;
        broadcastOk = true;
        log('INFO', 'usdt_broadcast_success', {
          withdrawal_id: withdrawalId, tx_hash: txHash, usdt_amount: result.usdtAmount,
        });
      }
    } else {
      const result = await broadcastETH({ toAddress: toAddr, netBdag, chainId });
      if ('error' in result) {
        broadcastErr = result.error;
      } else {
        txHash             = result.txHash;
        broadcastOk        = true;
        ethPriceSnapshot   = result.ethPriceUsd;
        log('INFO', 'eth_broadcast_success', {
          withdrawal_id: withdrawalId, tx_hash: txHash,
          amount_wei: result.amountWei, eth_price: result.ethPriceUsd,
        });
      }
    }

    // ── Broadcast failed — refund escrow and mark failed ──────────────────
    if (!broadcastOk) {
      log('ERROR', 'broadcast_failed_refunding', { withdrawal_id: withdrawalId, error: broadcastErr });
      await admin.rpc('refund_withdrawal_to_ledger', {
        p_withdrawal_id:  withdrawalId,
        p_failure_reason: `broadcast_failed: ${broadcastErr}`,
      });
      return fail(`broadcast failed: ${broadcastErr}`, 502);
    }

    // ── Persist txHash, mark broadcasted ──────────────────────────────────
    const updatePayload: Record<string, unknown> = {
      status:  'broadcasted',
      tx_hash: txHash,
      usd_equivalent_at_withdrawal: netBdag * BDAG_TO_USD,
    };
    if (ethPriceSnapshot !== null) updatePayload['eth_price_usd'] = ethPriceSnapshot;

    await admin.from('withdrawal_requests')
      .update(updatePayload)
      .eq('id', withdrawalId);

    // ── Update financial_transaction to 'completed' immediately after broadcast ───────
    // The fin_txn_id was returned by request_withdrawal_from_ledger RPC.
    // Marking it 'completed' here ensures the wallet history shows correctly
    // without waiting for bdag-monitor to confirm on-chain (which can take minutes).
    if (rpcData.fin_txn_id) {
      try {
        await admin
          .from('financial_transactions')
          .update({ status: 'completed', blockchain_txid: txHash })
          .eq('id', rpcData.fin_txn_id);
        log('INFO', 'fin_txn_marked_completed_on_broadcast', { fin_txn_id: rpcData.fin_txn_id });
      } catch (ftErr) {
        log('WARN', 'fin_txn_update_failed_non_fatal', { fin_txn_id: rpcData.fin_txn_id });
      }
    }

    // Also record in blockchain_settlements
    try {
      await admin.from('blockchain_settlements').upsert({
        settlement_type: 'withdrawal',
        reference_id:    withdrawalId,
        chain_id:        chainId,
        tx_hash:         txHash,
        from_address:    TREASURY_ADDRESS,
        to_address:      toAddr,
        amount_wei:      '0',
        status:          'pending',
        rpc_verified:    false,
      }, { onConflict: 'tx_hash' });
    } catch { /* non-fatal — settlement record is informational only */ }

    // ── Fire-and-forget: trigger bdag-monitor for CONFIRMATION ONLY ────────
    // Monitor will poll for receipt, release escrow, mark completed.
    const monitorUrl = `${SUPABASE_URL}/functions/v1/bdag-monitor`;
    fetch(monitorUrl, {
      method:  'POST',
      headers: {
        'Content-Type':     'application/json',
        'X-Monitor-Secret': MONITOR_SECRET,
        'Authorization':    `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ triggered_by: 'withdrawal_broadcasted', withdrawal_id: withdrawalId }),
      signal: AbortSignal.timeout(25_000),
    }).then(r => {
      log('INFO', 'monitor_confirmation_triggered', {
        withdrawal_id: withdrawalId, monitor_status: r.status,
      });
    }).catch(e => {
      log('WARN', 'monitor_trigger_failed_non_fatal', { error: e?.message });
    });

    // ── Return txHash to frontend IMMEDIATELY ──────────────────────────────
    return ok({
      withdrawal_id: withdrawalId,
      fin_txn_id:    rpcData.fin_txn_id,
      net_bdag:      netBdag,
      fee_bdag:      feeBdag,
      tx_hash:       txHash,
      status:        'broadcasted',
      message:       'Transaction broadcasted successfully — awaiting on-chain confirmation',
    });

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log('ERROR', 'bdag_withdraw_error', { error: msg });
    return fail(msg, 500);
  }
});
