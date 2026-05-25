/**
 * bdag-deposit — instant mempool credit with background confirmation
 *
 * BIGINT-FREE: All hex/wei arithmetic uses Number or string operations only.
 *
 * PRICE AUTHORITY: Backend fetches live ETH price from CoinGecko + Binance
 * with multi-source fallback. Frontend NEVER calculates BDAG amounts — only
 * the backend determines how much BDAG to credit.
 *
 * CONVERSION:
 *   1 BDAG = $0.01 USD  →  1 USD = 100 BDAG
 *   ETH: live ETH/USD price × 100 BDAG per USD
 *   USDT: 1 USDT = $1 = 100 BDAG (fixed peg)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders }  from '../_shared/cors.ts';
import { callRPC }      from '../_shared/rpc.ts';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TREASURY_ADDRESS = (Deno.env.get('TREASURY_WALLET_ADDRESS') ?? '').toLowerCase();

const USDT_CONTRACTS: Record<string, string> = {
  '1':    '0xdac17f958d2ee523a2206206994597c13d831ec7',
  '8453': '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  '97':   '0x337610d27c682e347c9cd60bd4b3b107c9d34def',
};

// Fixed platform conversion rate
const USD_TO_BDAG = 100; // 1 USD = 100 BDAG

const MEMPOOL_ATTEMPTS = 12;    // 12 × 1500ms = 18 s max wait
const MEMPOOL_DELAY_MS = 1500;

// ETH price cache (within a single function invocation)
let _cachedEthPrice: number | null = null;

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

// ── Live ETH price (multi-source, no BigInt) ───────────────────────────────
/**
 * Fetches live ETH/USD price from CoinGecko and Binance as fallback.
 * Returns a hardened fallback of 2000 if all sources fail.
 * The price is cached per function invocation (not across invocations).
 */
async function fetchEthPriceUsd(): Promise<number> {
  if (_cachedEthPrice !== null) return _cachedEthPrice;

  // Source 1: CoinGecko (free tier, no key needed)
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
      { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(5000) },
    );
    if (res.ok) {
      const json = await res.json() as { ethereum?: { usd?: number } };
      const price = json?.ethereum?.usd;
      if (typeof price === 'number' && price > 100) {
        console.log('[bdag-deposit] ETH price from CoinGecko:', price);
        _cachedEthPrice = price;
        return price;
      }
    }
  } catch (e: unknown) {
    console.warn('[bdag-deposit] CoinGecko ETH price fetch failed:', (e as Error)?.message);
  }

  // Source 2: Binance public ticker
  try {
    const res = await fetch(
      'https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT',
      { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(5000) },
    );
    if (res.ok) {
      const json = await res.json() as { price?: string };
      const price = parseFloat(json?.price ?? '0');
      if (price > 100) {
        console.log('[bdag-deposit] ETH price from Binance:', price);
        _cachedEthPrice = price;
        return price;
      }
    }
  } catch (e: unknown) {
    console.warn('[bdag-deposit] Binance ETH price fetch failed:', (e as Error)?.message);
  }

  // Fallback: use a conservative estimate
  const fallback = 2000;
  console.warn('[bdag-deposit] ETH price: all sources failed, using fallback $' + fallback);
  _cachedEthPrice = fallback;
  return fallback;
}

// ── Hex helpers (NO BigInt) ────────────────────────────────────────────────────
function hexToNumber(hex: string): number {
  const h = (hex || '0x0').replace('0x', '') || '0';
  if (h.length <= 8) return parseInt(h, 16);
  const hi = parseInt(h.slice(0, h.length - 8), 16);
  const lo = parseInt(h.slice(-8), 16);
  return hi * 0x100000000 + lo;
}

function weiToDecimal(wei: number, decimals: number): number {
  return wei / Math.pow(10, decimals);
}

function decodeAbiAddress(slot: string): string {
  return '0x' + slot.slice(-40).toLowerCase();
}

// ── ERC-20 input decoder (transfer selector: a9059cbb) ─────────────────────
function decodeMempoolErc20Transfer(
  input: string,
): { to: string; amountHex: string; amountDecimal: number } | null {
  try {
    const hex = input.replace('0x', '');
    if (hex.length < 136) return null;
    if (hex.slice(0, 8).toLowerCase() !== 'a9059cbb') return null;

    const toSlot     = hex.slice(8, 72);
    const amountSlot = hex.slice(72, 136);
    const to         = decodeAbiAddress(toSlot);
    const amountWei  = hexToNumber(amountSlot);
    const amountUSDT = weiToDecimal(amountWei, 6); // USDT = 6 decimals

    return { to, amountHex: amountSlot, amountDecimal: amountUSDT };
  } catch (e: unknown) {
    console.error('[bdag-deposit] decodeMempoolErc20Transfer error:', (e as Error)?.message);
    return null;
  }
}

// ── Response helpers ──────────────────────────────────────────────────────────
function ok(d: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data: d }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

function fail(e: string, code = 400): Response {
  return new Response(JSON.stringify({ success: false, error: e }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: code,
  });
}

// ── Mempool fetch ─────────────────────────────────────────────────────────────
async function fetchMempoolTx(
  chainId: string,
  txHash: string,
): Promise<Record<string, unknown> | null> {
  for (let i = 0; i < MEMPOOL_ATTEMPTS; i++) {
    try {
      const tx = await callRPC(chainId, 'eth_getTransactionByHash', [txHash]) as Record<string, unknown> | null;
      if (tx && tx['hash']) {
        console.log(`[bdag-deposit] mempool tx found on attempt ${i + 1}`);
        return tx;
      }
      console.log(`[bdag-deposit] mempool attempt ${i + 1}/${MEMPOOL_ATTEMPTS}: not visible yet`);
    } catch (e: unknown) {
      console.warn(`[bdag-deposit] mempool attempt ${i + 1} RPC error:`, (e as Error)?.message);
    }
    if (i < MEMPOOL_ATTEMPTS - 1) {
      await new Promise<void>(r => setTimeout(r, MEMPOOL_DELAY_MS));
    }
  }
  return null;
}

// ── Validate mempool tx with live pricing ─────────────────────────────────────
interface ValidationResult {
  valid:       boolean;
  amountWei:   string;    // decimal string (no BigInt)
  tokenType:   'ETH' | 'USDT';
  bdagAmount:  number;    // final BDAG to credit
  usdValue:    number;    // USD equivalent
  ethPriceUsd: number;    // price used for conversion (stored for audit)
  error?:      string;
}

async function validateMempoolTx(
  tx:           Record<string, unknown>,
  chainId:      string,
  expectedFrom: string,
): Promise<ValidationResult> {
  const INVALID = (error: string): ValidationResult =>
    ({ valid: false, amountWei: '0', tokenType: 'ETH', bdagAmount: 0, usdValue: 0, ethPriceUsd: 0, error });

  const fromAddr  = ((tx['from'] as string | undefined) ?? '').toLowerCase();
  const expectedL = expectedFrom.toLowerCase();

  if (fromAddr !== expectedL) {
    console.error(`[bdag-deposit] sender mismatch: tx.from=${fromAddr} expected=${expectedL}`);
    return INVALID('sender_mismatch');
  }

  const toAddr    = ((tx['to'] as string | undefined) ?? '').toLowerCase();
  const inputData = ((tx['input'] as string | undefined) ?? '0x');
  const usdtAddr  = (USDT_CONTRACTS[chainId] ?? '').toLowerCase();

  // ── ERC-20 USDT path ───────────────────────────────────────────────────────
  if (usdtAddr && toAddr === usdtAddr) {
    const decoded = decodeMempoolErc20Transfer(inputData);
    if (!decoded) return INVALID('invalid_erc20_input');

    if (decoded.to.toLowerCase() !== TREASURY_ADDRESS) {
      console.error(`[bdag-deposit] USDT recipient mismatch: ${decoded.to} != ${TREASURY_ADDRESS}`);
      return INVALID('treasury_not_recipient');
    }

    const usdtAmount = decoded.amountDecimal;
    if (usdtAmount <= 0) return INVALID('zero_amount');

    // USDT is pegged 1:1 to USD — no live price needed
    const usdValue   = usdtAmount;
    const bdagAmount = Number((usdValue * USD_TO_BDAG).toFixed(2));

    console.log(`[bdag-deposit] USDT: ${usdtAmount} USDT → $${usdValue} USD → ${bdagAmount} BDAG`);

    return {
      valid: true,
      amountWei:   String(hexToNumber(decoded.amountHex)),
      tokenType:   'USDT',
      bdagAmount,
      usdValue,
      ethPriceUsd: 1, // USDT = 1 USD, not applicable
    };
  }

  // ── Native ETH path ────────────────────────────────────────────────────────
  if (toAddr === TREASURY_ADDRESS) {
    const valueHex  = ((tx['value'] as string | undefined) ?? '0x0');
    const valueWei  = hexToNumber(valueHex);
    const ethAmount = weiToDecimal(valueWei, 18);

    if (ethAmount <= 0) return INVALID('zero_amount');

    // Fetch live ETH price — backend is the ONLY price authority
    const ethPriceUsd = await fetchEthPriceUsd();
    const usdValue    = Number((ethAmount * ethPriceUsd).toFixed(6));
    const bdagAmount  = Number((usdValue * USD_TO_BDAG).toFixed(2));

    console.log(`[bdag-deposit] ETH: ${ethAmount} ETH × $${ethPriceUsd}/ETH = $${usdValue} → ${bdagAmount} BDAG`);

    return {
      valid: true,
      amountWei:   String(valueWei),
      tokenType:   'ETH',
      bdagAmount,
      usdValue,
      ethPriceUsd,
    };
  }

  console.error(`[bdag-deposit] treasury not found. to=${toAddr}, treasury=${TREASURY_ADDRESS}`);
  return INVALID('treasury_not_recipient');
}

// ── Try receipt (already mined?) ──────────────────────────────────────────────
async function tryGetReceipt(
  chainId: string,
  txHash: string,
): Promise<Record<string, unknown> | null> {
  try {
    const receipt = await callRPC(chainId, 'eth_getTransactionReceipt', [txHash]) as Record<string, unknown> | null;
    if (receipt && receipt['blockNumber']) return receipt;
  } catch { /* ignore */ }
  return null;
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req: Request): Promise<Response> => {
  try {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    // ── Auth ────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return fail('unauthorized', 401);

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !user) {
      console.error('[bdag-deposit] auth error:', authErr?.message);
      return fail('unauthorized', 401);
    }

    // ── Parse body ──────────────────────────────────────────────────────────
    let body: { tx_hash?: string; chain_id?: string; wallet_address?: string };
    try {
      body = await req.json();
    } catch (e: unknown) {
      console.error('[bdag-deposit] JSON parse error:', (e as Error)?.message);
      return fail('invalid JSON body');
    }

    const { tx_hash, chain_id, wallet_address } = body;
    if (!tx_hash || !chain_id || !wallet_address) {
      return fail('tx_hash, chain_id, wallet_address required');
    }

    const txHashNorm = tx_hash.toLowerCase().trim();
    const walletNorm = wallet_address.toLowerCase().trim();

    console.log(`[bdag-deposit] START user=${user.id} tx=${txHashNorm.slice(0, 14)}... chain=${chain_id}`);

    // ── 1. Replay protection ────────────────────────────────────────────────
    const { data: existing } = await admin
      .from('deposit_confirmations')
      .select('id, status, bdag_credited')
      .eq('tx_hash', txHashNorm)
      .eq('chain_id', chain_id)
      .maybeSingle();

    if (existing) {
      const st = existing.status as string;
      if (['credited', 'confirmed', 'provisional'].includes(st)) {
        console.log(`[bdag-deposit] idempotent — already ${st}`);
        return ok({ already_credited: true, tx_hash: txHashNorm, bdag_credited: Number(existing.bdag_credited ?? 0) });
      }
      if (st === 'duplicate') return fail('duplicate transaction', 409);
      console.log(`[bdag-deposit] re-processing deposit with status=${st}`);
    }

    // ── 2. Mempool fetch (<18 s total) ───────────────────────────────────────
    const mempoolTx = await fetchMempoolTx(chain_id, txHashNorm);
    if (!mempoolTx) {
      console.warn('[bdag-deposit] tx not found after mempool polling — retryable');
      return fail(
        'Transaction not yet visible on the network. Please wait a moment and try again. Your funds are safe.',
        202,
      );
    }

    // ── 3. Validate with live ETH price ─────────────────────────────────────
    const validation = await validateMempoolTx(mempoolTx, chain_id, walletNorm);
    if (!validation.valid) {
      console.error('[bdag-deposit] validation failed:', validation.error);
      return fail(validation.error ?? 'blockchain_validation_failed');
    }
    if (validation.bdagAmount <= 0) {
      return fail('deposit amount is zero or could not be decoded');
    }

    // ── 4. Non-blocking receipt check ────────────────────────────────────────
    const receipt       = await tryGetReceipt(chain_id, txHashNorm);
    const receiptStatus = receipt ? (receipt['status'] as string | undefined) : null;

    if (receipt && receiptStatus !== '0x1') {
      console.error('[bdag-deposit] receipt status reverted:', receiptStatus);
      return fail('transaction_reverted_on_chain');
    }

    const depositStatus  = (receipt && receiptStatus === '0x1') ? 'confirmed' : 'provisional';
    const blockNumberHex = receipt ? (receipt['blockNumber'] as string | undefined) : null;
    const blockNumber    = blockNumberHex ? parseInt(blockNumberHex, 16) : null;

    console.log(`[bdag-deposit] validation OK status=${depositStatus} bdag=${validation.bdagAmount} tokenType=${validation.tokenType} ethPrice=${validation.ethPriceUsd} usd=${validation.usdValue}`);

    // ── 5. Upsert deposit_confirmations with price snapshot ────────────────
    console.log('[LEDGER_DEBUG] 1. Upserting deposit_confirmations', {
      user_id:    user.id,
      tx_hash:    txHashNorm.slice(0, 14) + '...',
      chain_id,
      bdag:       validation.bdagAmount,
      usd:        validation.usdValue,
      eth_price:  validation.ethPriceUsd,
      status:     depositStatus,
    });

    const { data: depositRecord, error: depositErr } = await admin
      .from('deposit_confirmations')
      .upsert({
        user_id:               user.id,
        tx_hash:               txHashNorm,
        chain_id,
        from_address:          walletNorm,
        to_address:            TREASURY_ADDRESS,
        raw_amount_wei:        validation.amountWei,
        bdag_credited:         validation.bdagAmount,
        eth_price_usd:         validation.tokenType === 'ETH' ? validation.ethPriceUsd : null,
        usd_value:             validation.usdValue,
        conversion_rate_used:  `1 USD = ${USD_TO_BDAG} BDAG`,
        block_number:          blockNumber,
        confirmations:         blockNumber ? 1 : 0,
        status:                depositStatus,
        validated_at:          new Date().toISOString(),
      }, { onConflict: 'tx_hash,chain_id', ignoreDuplicates: false })
      .select('id')
      .single();

    if (depositErr) {
      console.error('[LEDGER_DEBUG] deposit_confirmations upsert FAILED:', depositErr.message);
      return fail(depositErr.message);
    }

    console.log('[LEDGER_DEBUG] 2. deposit_confirmations OK id=', depositRecord.id);

    // ── 6. Ensure ledger account exists ─────────────────────────────────────
    const { data: userLedger } = await admin
      .from('ledger_accounts')
      .select('id, balance, frozen')
      .eq('owner_id', user.id)
      .eq('account_type', 'user')
      .maybeSingle();

    console.log('[LEDGER_DEBUG] 3. ledger_accounts check', {
      found:   !!userLedger,
      balance: userLedger?.balance ?? null,
    });

    if (!userLedger) {
      console.log('[LEDGER_DEBUG] 3a. Creating ledger account via ensure_ledger_account');
      const { error: ensureErr } = await admin
        .rpc('ensure_ledger_account', { p_user_id: user.id });
      if (ensureErr) {
        console.error('[LEDGER_DEBUG] ensure_ledger_account FAILED:', ensureErr.message);
        return fail('Could not create ledger account: ' + ensureErr.message);
      }
    }

    // ── 7. Atomic BDAG credit ────────────────────────────────────────────────
    console.log('[LEDGER_DEBUG] 4. Calling credit_deposit_to_ledger', {
      user_id:     user.id,
      bdag_amount: validation.bdagAmount,
      tx_hash:     txHashNorm.slice(0, 14) + '...',
    });

    const { data: creditResult, error: creditErr } = await admin.rpc('credit_deposit_to_ledger', {
      p_user_id:     user.id,
      p_bdag_amount: validation.bdagAmount,
      p_tx_hash:     txHashNorm,
      p_chain_id:    chain_id,
      p_deposit_id:  depositRecord.id,
    });

    const creditResultStr = creditResult ? JSON.stringify(creditResult) : 'null';
    console.log('[LEDGER_DEBUG] 5. credit_deposit_to_ledger result', {
      error:  creditErr?.message ?? null,
      result: creditResultStr,
    });

    if (creditErr) {
      console.error('[LEDGER_DEBUG] RPC ERROR:', creditErr.message);
      return fail(creditErr.message);
    }

    const cr = creditResult as {
      success:       boolean;
      idempotent?:   boolean;
      error?:        string;
      new_balance?:  number;
      fin_txn_id?:   string;
      bdag_credited?: number;
    } | null;

    if (!cr?.success) {
      if (cr?.idempotent) {
        console.log('[LEDGER_DEBUG] idempotent hit — already credited');
        return ok({
          already_credited: true,
          new_balance:      cr.new_balance ?? 0,
          bdag_credited:    validation.bdagAmount,
        });
      }
      console.error('[LEDGER_DEBUG] credit failed:', cr?.error ?? 'unknown');
      return fail(cr?.error ?? 'ledger credit failed');
    }

    // ── 8. Final balance verification ────────────────────────────────────────
    const { data: finalLedger } = await admin
      .from('ledger_accounts')
      .select('balance')
      .eq('owner_id', user.id)
      .eq('account_type', 'user')
      .maybeSingle();

    console.log('[LEDGER_DEBUG] 6. Final balance', {
      from_proc: cr.new_balance,
      from_db:   finalLedger?.balance ?? null,
      credited:  validation.bdagAmount,
      eth_price: validation.ethPriceUsd,
      usd_value: validation.usdValue,
    });

    // ── 9. Record blockchain settlement (best-effort) ─────────────────────────
    await admin.from('blockchain_settlements').upsert({
      settlement_type: 'deposit',
      reference_id:    depositRecord.id,
      chain_id,
      tx_hash:         txHashNorm,
      from_address:    walletNorm,
      to_address:      TREASURY_ADDRESS,
      amount_wei:      validation.amountWei,
      block_number:    blockNumber,
      status:          depositStatus,
      rpc_verified:    depositStatus === 'confirmed',
      verified_at:     new Date().toISOString(),
    }, { onConflict: 'tx_hash' });

    console.log(`[LEDGER_DEBUG] COMPLETE: credited ${validation.bdagAmount} BDAG | new_balance=${cr.new_balance} | eth_price=$${validation.ethPriceUsd} | usd=$${validation.usdValue}`);

    return ok({
      bdag_credited: validation.bdagAmount,
      token_type:    validation.tokenType,
      usd_value:     validation.usdValue,
      eth_price_usd: validation.ethPriceUsd,
      new_balance:   cr.new_balance ?? 0,
      fin_txn_id:    cr.fin_txn_id ?? '',
      block_number:  blockNumber ?? 0,
      status:        depositStatus,
    });

  } catch (e: unknown) {
    const err = e as Error;
    console.error('[bdag-deposit] UNHANDLED ERROR', {
      message: err?.message ?? String(e),
      stack:   err?.stack   ?? '(no stack)',
    });
    return new Response(
      JSON.stringify({ success: false, error: err?.message ?? 'internal_error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 },
    );
  }
});
