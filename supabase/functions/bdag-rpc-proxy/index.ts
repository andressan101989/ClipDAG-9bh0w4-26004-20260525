/**
 * Edge Function: bdag-rpc-proxy
 *
 * Secure server-side proxy for BlockDAG Mainnet JSON-RPC calls.
 * Uses raw fetch with Cloudflare-bypass headers + multi-endpoint fallback.
 * The mobile app NEVER calls the BlockDAG RPC directly.
 */

import { corsHeaders } from '../_shared/cors.ts';
import { rpcCall } from '../_shared/rpc.ts';

// Read-only methods allowed via this proxy
const ALLOWED_METHODS = new Set([
  'eth_getBalance',
  'eth_blockNumber',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_call',
  'eth_chainId',
  'net_version',
  'eth_gasPrice',
  'eth_getLogs',
  'eth_getTransactionCount',
]);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let body: { method?: string; params?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON request body' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { method, params = [] } = body;

  if (!method || typeof method !== 'string') {
    return new Response(JSON.stringify({ error: 'Missing "method" field' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!ALLOWED_METHODS.has(method)) {
    return new Response(JSON.stringify({
      error: `Method "${method}" not allowed. Use dedicated endpoints for write operations.`,
    }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  console.log(`[bdag-proxy] ${method}(${JSON.stringify(params).slice(0, 80)})`);

  try {
    const result = await rpcCall(method, params as unknown[]);
    return new Response(JSON.stringify({ result }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    const clean = (e.message ?? 'BlockDAG RPC unavailable').replace(/<[^>]+>/g, '').slice(0, 300);
    console.error(`[bdag-proxy] Error for ${method}:`, clean);
    return new Response(JSON.stringify({ error: clean }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
