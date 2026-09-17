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
import { STABLECOINS, getStablecoin } from '../_shared/stablecoins.ts';
import { BDAG_PER_USD } from '../_shared/bdagEconomics.ts';
import {
  bdagUnitsToStablecoinUnits,
  bdagUnitsToUsdString,
  formatBdagUnits,
  formatStablecoinUnits,
  parseBdagUnits,
} from '../_shared/bdagPayoutPrecision.ts';
import { corsHeaders }  from '../_shared/cors.ts';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MONITOR_SECRET   = (() => {
  const s = Deno.env.get('RECONCILE_SECRET');
  if (!s) throw new Error('RECONCILE_SECRET env var is not set');
  return s;
})();
const TREASURY_KEY     = Deno.env.get('TREASURY_PRIVATE_KEY');
const TREASURY_ADDRESS = (Deno.env.get('TREASURY_WALLET_ADDRESS') ?? '').toLowerCase();
const ALCHEMY_KEY      = Deno.env.get('ALCHEMY_ETH_KEY') ?? '';

const WITHDRAWAL_COOLDOWN_MS = 10 * 60 * 1000;

// ── USDT contract addresses per EIP-155 chain ID ──────────────────────────────
const USDT_CONTRACTS: Record<string, string> = {
  '1':        '0xdac17f958d2ee523a2206206994597c13d831ec7', // Ethereum mainnet
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

type WithdrawalConfig = {
  minimum_bdag: number;
  maximum_bdag: number;
  fee_bps: number;
  bdag_per_usd: number;
  max_active_per_user: number;
  required_confirmations: number;
};

async function getWithdrawalConfig(): Promise<WithdrawalConfig> {
  const { data, error } = await admin.rpc('get_withdrawal_config');
  if (error || !data) throw new Error(error?.message ?? 'withdrawal_config_unavailable');
  return data as WithdrawalConfig;
}

const NETWORK_LABELS: Record<string, string> = { '1': 'Ethereum', '8453': 'Base' };
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
  const usd = bdag / BDAG_PER_USD;
  const eth = usd / ethPriceUsd;
  return Math.floor(eth * 1e18);
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
async function broadcastStablecoin(params: {
  toAddress: string; netBdagUnits: bigint; chainId: string; tokenType: 'USDT' | 'USDC';
}): Promise<{ txHash: string; stablecoinAmount: string; stablecoinRawUnits: string } | { error: string }> {
  if (!TREASURY_KEY) return { error: 'TREASURY_PRIVATE_KEY not configured' };

  const stablecoin = getStablecoin(params.chainId, params.tokenType);
  if (!stablecoin) return { error: `${params.tokenType} not supported on chain ${params.chainId}` };
  const usdtContract = stablecoin.contractAddress;

  try {
    const { ethers } = await import('https://esm.sh/ethers@6.13.1');
    const rpcUrl     = getSigningRPC(params.chainId);
    const provider   = new ethers.JsonRpcProvider(rpcUrl);
    const wallet     = new ethers.Wallet(TREASURY_KEY, provider);
    const contract   = new ethers.Contract(usdtContract, ERC20_ABI, wallet);

    const stablecoinRawUnits = bdagUnitsToStablecoinUnits(params.netBdagUnits, stablecoin.decimals);
    const stablecoinAmount = formatStablecoinUnits(stablecoinRawUnits, stablecoin.decimals);

    if (stablecoinRawUnits <= BigInt(0)) return { error: `stablecoin_amount_too_small: ${stablecoinRawUnits}` };

    log('INFO', 'usdt_broadcast_amounts', {
      net_bdag: formatBdagUnits(params.netBdagUnits), stablecoin_amount: stablecoinAmount,
      stablecoin_raw_units: stablecoinRawUnits.toString(),
      contract: usdtContract, to: params.toAddress,
    });

    // Verify treasury balance
    try {
      const bal = await contract['balanceOf'](TREASURY_ADDRESS) as bigint;
      if (bal < stablecoinRawUnits) {
        return { error: `treasury_insufficient_stablecoin: balance=${bal} need=${stablecoinRawUnits}` };
      }
    } catch { /* non-fatal, continue */ }

    // Estimate gas with 20% buffer
    let gasLimit = BigInt(100_000); // safe default
    try {
      const est: bigint = await contract['transfer'].estimateGas(params.toAddress, stablecoinRawUnits) as bigint;
      gasLimit = BigInt(Math.ceil(Number(est) * 1.2));
      log('INFO', 'usdt_gas_estimated', { estimated: est.toString(), with_buffer: gasLimit.toString() });
    } catch (e: unknown) {
      log('WARN', 'usdt_gas_estimation_failed', { error: (e as Error)?.message });
    }

    const tx = await contract['transfer'](params.toAddress, stablecoinRawUnits, { gasLimit });

    log('INFO', 'stablecoin_tx_broadcasted', { tx_hash: tx.hash, to: params.toAddress, stablecoin_amount: stablecoinAmount });
    return { txHash: tx.hash, stablecoinAmount, stablecoinRawUnits: stablecoinRawUnits.toString() };
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
    // ── Canonical configuration ───────────────────────────────────────────
    if (action === 'config') {
      const config = await getWithdrawalConfig();
      return ok({
        ...config,
        rails: STABLECOINS.map((rail) => ({
          token: rail.symbol,
          chain_id: rail.chainId,
          network: NETWORK_LABELS[rail.chainId] ?? `Chain ${rail.chainId}`,
          decimals: rail.decimals,
        })),
      });
    }

    // ── Server-authoritative quote (no persistence / no ledger mutation) ─
    if (action === 'quote') {
      const config = await getWithdrawalConfig();
      const grossUnits = parseBdagUnits(body.amount);
      const chainId = String(body.chain_id ?? '');
      const tokenType = String(body.token_type ?? '').toUpperCase();
      const rail = getStablecoin(chainId, tokenType);
      if (!grossUnits) return fail('invalid withdrawal amount');
      const minimumUnits = parseBdagUnits(config.minimum_bdag);
      const maximumUnits = parseBdagUnits(config.maximum_bdag);
      if (!minimumUnits || grossUnits < minimumUnits) return fail(`minimum withdrawal: ${config.minimum_bdag} BDAG`);
      if (!maximumUnits || grossUnits > maximumUnits) return fail(`maximum withdrawal: ${config.maximum_bdag} BDAG`);
      if (!rail) return fail(`${tokenType || 'token'} not supported on chain ${chainId || 'unknown'}`);
      const feeUnits = (grossUnits * BigInt(config.fee_bps) + BigInt(5_000)) / BigInt(10_000);
      const netUnits = grossUnits - feeUnits;
      const stablecoinRawUnits = bdagUnitsToStablecoinUnits(netUnits, rail.decimals);
      return ok({
        gross_bdag: formatBdagUnits(grossUnits),
        fee_bdag: formatBdagUnits(feeUnits),
        net_bdag: formatBdagUnits(netUnits),
        estimated_stablecoin_amount: formatStablecoinUnits(stablecoinRawUnits, rail.decimals),
        fee_bps: config.fee_bps,
        minimum_bdag: config.minimum_bdag,
        bdag_per_usd: config.bdag_per_usd,
        token: rail.symbol,
        chain_id: rail.chainId,
        network: NETWORK_LABELS[rail.chainId] ?? `Chain ${rail.chainId}`,
      });
    }

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

    const config = await getWithdrawalConfig();
    const amountUnits = parseBdagUnits(amount);
    const minimumUnits = parseBdagUnits(config.minimum_bdag);
    const maximumUnits = parseBdagUnits(config.maximum_bdag);
    if (!amountUnits) return fail('invalid withdrawal amount');
    if (!minimumUnits || amountUnits < minimumUnits) return fail(`minimum withdrawal: ${config.minimum_bdag} BDAG`);
    if (!maximumUnits || amountUnits > maximumUnits) return fail(`maximum withdrawal: ${config.maximum_bdag} BDAG`);
    const normalizedAmount = formatBdagUnits(amountUnits);
    if (!isValidEVMAddress(to_address as string)) return fail('invalid EVM wallet address');

    const chainId  = String(chain_id);
    const toAddr   = (to_address as string).toLowerCase();
    const tokenTyp = (token_type as string).toUpperCase();
    if (!['USDT', 'USDC'].includes(tokenTyp)) return fail('token_type must be USDT or USDC');
    if (!getStablecoin(chainId, tokenTyp)) return fail(`${tokenTyp} not supported on chain ${chainId}`);

    // Resolve an existing logical request before enforcing the new-request
    // cooldown. The RPC revalidates the immutable fingerprint, so a changed
    // amount/address/rail with the same key still fails closed.
    const { data: existingByKey } = await admin.from('withdrawal_requests')
      .select('id')
      .eq('user_id', user.id)
      .eq('idempotency_key', String(idempotency_key))
      .maybeSingle();
    if (existingByKey) {
      const { data: retryData, error: retryError } = await admin.rpc('request_withdrawal_from_ledger', {
        p_user_id: user.id,
        p_bdag_amount: normalizedAmount,
        p_to_address: toAddr,
        p_chain_id: chainId,
        p_token_type: tokenTyp,
        p_idempotency_key: idempotency_key,
      });
      if (retryError) return fail(retryError.message);
      const { data: existing } = await admin.from('withdrawal_requests')
        .select('id,status,net_bdag,fee_bdag,tx_hash')
        .eq('id', retryData.withdrawal_id).eq('user_id', user.id).single();
      return ok({
        withdrawal_id: retryData.withdrawal_id,
        net_bdag: existing?.net_bdag ?? retryData.net_amount,
        fee_bdag: existing?.fee_bdag ?? retryData.fee,
        tx_hash: existing?.tx_hash ?? null,
        status: existing?.status ?? retryData.status,
        idempotent: true,
      });
    }

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

    // ── Pre-flight: check treasury key is configured ────────────────────────
    if (!TREASURY_KEY) {
      log('ERROR', 'treasury_key_missing', { user_id: user.id });
      return fail('withdrawal system not configured — contact support', 503);
    }

    // ── Atomic: debit user → escrow, create withdrawal record ──────────────
    const { data: rpcData, error: rpcErr } = await admin.rpc('request_withdrawal_from_ledger', {
      p_user_id:         user.id,
      p_bdag_amount:     normalizedAmount,
      p_to_address:      toAddr,
      p_chain_id:        chainId,
      p_token_type:      tokenTyp,
      p_idempotency_key: idempotency_key,
    });

    if (rpcErr) return fail(rpcErr.message);
    if (!rpcData?.success) return fail(rpcData?.error ?? 'withdrawal request failed');

    // A retry returns the original canonical request and never broadcasts a
    // second blockchain transfer.
    if (rpcData.idempotent) {
      const { data: existing } = await admin.from('withdrawal_requests')
        .select('id,status,net_bdag,fee_bdag,tx_hash')
        .eq('id', rpcData.withdrawal_id).eq('user_id', user.id).single();
      return ok({
        withdrawal_id: rpcData.withdrawal_id,
        net_bdag: existing?.net_bdag ?? rpcData.net_amount,
        fee_bdag: existing?.fee_bdag ?? rpcData.fee,
        tx_hash: existing?.tx_hash ?? null,
        status: existing?.status ?? rpcData.status,
        idempotent: true,
      });
    }

    const withdrawalId = rpcData.withdrawal_id;
    const netBdagUnits = parseBdagUnits(rpcData.net_amount);
    if (netBdagUnits === null || netBdagUnits <= BigInt(0)) {
      log('ERROR', 'canonical_net_amount_invalid_refunding', { withdrawal_id: withdrawalId });
      await admin.rpc('refund_withdrawal_to_ledger', {
        p_withdrawal_id: withdrawalId,
        p_failure_reason: 'canonical_net_amount_invalid',
      });
      return fail('canonical withdrawal net amount invalid', 502);
    }
    const netBdagExact = formatBdagUnits(netBdagUnits);
    const netBdag      = Number(netBdagExact);
    const feeBdag      = Number(rpcData.fee ?? 0);

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

    if (tokenTyp === 'USDT' || tokenTyp === 'USDC') {
      const result = await broadcastStablecoin({ toAddress: toAddr, netBdagUnits, chainId, tokenType: tokenTyp });
      if ('error' in result) {
        broadcastErr = result.error;
      } else {
        txHash      = result.txHash;
        broadcastOk = true;
        log('INFO', 'usdt_broadcast_success', {
          withdrawal_id: withdrawalId, tx_hash: txHash,
          stablecoin_amount: result.stablecoinAmount,
          stablecoin_raw_units: result.stablecoinRawUnits,
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
      const { data: refundData, error: refundErr } = await admin.rpc('refund_withdrawal_to_ledger', {
        p_withdrawal_id:  withdrawalId,
        p_failure_reason: `broadcast_failed: ${broadcastErr}`,
      });
      if (refundErr) {
        log('ERROR', 'refund_rpc_failed_funds_may_be_stuck', {
          withdrawal_id: withdrawalId, error: refundErr.message,
        });
      } else {
        log('INFO', 'refund_completed', { withdrawal_id: withdrawalId, refundData });
      }
      return fail(`broadcast failed: ${broadcastErr}`, 502);
    }

    // ── Persist txHash, mark broadcasted ──────────────────────────────────
    const updatePayload: Record<string, unknown> = {
      status:  'broadcasted',
      tx_hash: txHash,
      usd_equivalent_at_withdrawal: bdagUnitsToUsdString(netBdagUnits),
      broadcast_at: new Date().toISOString(),
    };
    if (ethPriceSnapshot !== null) updatePayload['eth_price_usd'] = ethPriceSnapshot;

    await admin.from('withdrawal_requests')
      .update(updatePayload)
      .eq('id', withdrawalId);

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
