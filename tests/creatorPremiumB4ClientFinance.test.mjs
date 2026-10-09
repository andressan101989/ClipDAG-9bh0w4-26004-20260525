import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');
const read = relative => readFileSync(path.join(root, relative), 'utf8');
const userId = '10000000-0000-4000-8000-000000000001';
const contentId = '20000000-0000-4000-8000-000000000001';
const planId = '30000000-0000-4000-8000-000000000001';
const subscriptionId = '40000000-0000-4000-8000-000000000001';
const idempotencyKey = '50000000-0000-4000-8000-000000000001';

function compile(source, filename) {
  return ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
}

function loadLedgerEdge({ user = { id: userId }, rpcResult = { data: { money_moved: false }, error: null } } = {}) {
  let handler;
  const rpcCalls = [];
  const admin = {
    auth: { getUser: async () => ({ data: { user }, error: user ? null : { message: 'bad token' } }) },
    async rpc(name, args) {
      rpcCalls.push({ name, args: structuredClone(args) });
      return rpcResult;
    },
    from() {
      return { insert: async () => ({ error: null }) };
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(compile(read('supabase/functions/bdag-ledger/index.ts'), 'bdag-ledger.ts'), {
    module,
    exports: module.exports,
    Request,
    Response,
    Headers,
    console,
    structuredClone,
    require(specifier) {
      if (specifier === 'https://esm.sh/@supabase/supabase-js@2') {
        return { createClient: () => admin };
      }
      if (specifier === '../_shared/cors.ts') return { corsHeaders: {} };
      throw new Error(`Unexpected bdag-ledger module: ${specifier}`);
    },
    Deno: {
      env: { get: () => 'test' },
      serve(fn) { handler = fn; },
    },
  }, { filename: 'bdag-ledger.js' });
  return { handler, rpcCalls };
}

async function post(handler, body, token = 'test-token') {
  const response = await handler(new Request('https://edge.test', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
  return { response, payload: await response.json() };
}

test('bdag-ledger routes only canonical Premium actions with JWT-derived identity', async () => {
  const cases = [
    ['creator_premium_purchase', 'content_id', contentId, 'purchase_creator_premium_content_v1', {
      p_buyer_id: userId, p_content_id: contentId, p_idempotency_key: idempotencyKey,
    }],
    ['creator_premium_subscribe', 'plan_id', planId, 'subscribe_creator_premium_plan_v1', {
      p_subscriber_id: userId, p_plan_id: planId, p_idempotency_key: idempotencyKey,
    }],
    ['creator_premium_cancel_subscription', 'subscription_id', subscriptionId, 'cancel_creator_premium_subscription_v1', {
      p_subscriber_id: userId, p_subscription_id: subscriptionId, p_idempotency_key: idempotencyKey,
    }],
  ];
  for (const [action, field, value, rpc, args] of cases) {
    const harness = loadLedgerEdge();
    const { response } = await post(harness.handler, { action, idempotency_key: idempotencyKey, [field]: value });
    assert.equal(response.status, 200);
    assert.deepEqual(harness.rpcCalls, [{ name: rpc, args }]);
  }
});

test('Premium Edge actions reject malformed UUIDs and every client financial authority field', async () => {
  const targets = [
    ['creator_premium_purchase', 'content_id', contentId],
    ['creator_premium_subscribe', 'plan_id', planId],
    ['creator_premium_cancel_subscription', 'subscription_id', subscriptionId],
  ];
  for (const [action, field, value] of targets) {
    for (const body of [
      { action, idempotency_key: 'not-a-uuid', [field]: value },
      { action, idempotency_key: idempotencyKey, [field]: 'not-a-uuid' },
      { action, idempotency_key: idempotencyKey, [field]: value, amount: 1 },
      { action, idempotency_key: idempotencyKey, [field]: value, price: 1 },
      { action, idempotency_key: idempotencyKey, [field]: value, fee: 1 },
      { action, idempotency_key: idempotencyKey, [field]: value, platform_fee: 1 },
      { action, idempotency_key: idempotencyKey, [field]: value, creator_id: userId },
      { action, idempotency_key: idempotencyKey, [field]: value, account_id: userId },
      { action, idempotency_key: idempotencyKey, [field]: value, buyer_id: userId },
      { action, idempotency_key: idempotencyKey, [field]: value, subscriber_id: userId },
    ]) {
      const harness = loadLedgerEdge();
      const { response } = await post(harness.handler, body);
      assert.equal(response.status, 400);
      assert.equal(harness.rpcCalls.length, 0);
    }
  }
});

test('legacy purchase/subscribe remain stably disabled and never call missing RPCs', async () => {
  for (const action of ['purchase', 'subscribe']) {
    const harness = loadLedgerEdge();
    const { response, payload } = await post(harness.handler, { action, idempotency_key: idempotencyKey });
    assert.equal(response.status, 410);
    assert.equal(payload.error, 'creator_premium_legacy_action_disabled');
    assert.equal(harness.rpcCalls.length, 0);
  }
  const source = read('supabase/functions/bdag-ledger/index.ts');
  assert.doesNotMatch(source, /admin\.rpc\(['"](?:purchase_exclusive_content|subscribe_to_creator)['"]/);
  assert.doesNotMatch(source, /creator_premium_(?:purchase|subscribe|cancel_subscription)[\s\S]*refund_creator_premium/i);
});

test('bdag-ledger still requires a valid JWT before any Premium RPC', async () => {
  const missing = loadLedgerEdge();
  assert.equal((await post(missing.handler, {
    action: 'creator_premium_purchase', idempotency_key: idempotencyKey, content_id: contentId,
  }, '')).response.status, 401);
  assert.equal(missing.rpcCalls.length, 0);
  const invalid = loadLedgerEdge({ user: null });
  assert.equal((await post(invalid.handler, {
    action: 'creator_premium_purchase', idempotency_key: idempotencyKey, content_id: contentId,
  })).response.status, 401);
  assert.equal(invalid.rpcCalls.length, 0);
});

function loadLedgerClient() {
  const invokes = [];
  const client = {
    functions: {
      async invoke(name, options) {
        invokes.push({ name, body: structuredClone(options.body) });
        return { data: { success: true, data: { money_moved: false } }, error: null };
      },
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(compile(read('services/financial/ledgerClient.ts'), 'ledgerClient.ts'), {
    module,
    exports: module.exports,
    console,
    crypto: { randomUUID: () => idempotencyKey },
    require(specifier) {
      if (specifier === '@/template') return { getSupabaseClient: () => client };
      if (specifier === '@/services/walletApi') return { getWithdrawalConfigFromBackend: async () => ({ minimumBdag: 1 }) };
      if (specifier === '@supabase/supabase-js') return { FunctionsHttpError: class FunctionsHttpError extends Error {} };
      throw new Error(`Unexpected ledgerClient module: ${specifier}`);
    },
  }, { filename: 'ledgerClient.js' });
  return { service: module.exports, invokes };
}

test('canonical ledgerClient sends UUID identity only and no monetary authority', async () => {
  const harness = loadLedgerClient();
  await harness.service.purchaseContent({ contentId });
  await harness.service.subscribeToPlan({ planId });
  await harness.service.cancelCreatorPremiumSubscription({ subscriptionId });
  assert.deepEqual(harness.invokes, [
    { name: 'bdag-ledger', body: { action: 'creator_premium_purchase', idempotency_key: idempotencyKey, content_id: contentId } },
    { name: 'bdag-ledger', body: { action: 'creator_premium_subscribe', idempotency_key: idempotencyKey, plan_id: planId } },
    { name: 'bdag-ledger', body: { action: 'creator_premium_cancel_subscription', idempotency_key: idempotencyKey, subscription_id: subscriptionId } },
  ]);
  for (const call of harness.invokes) {
    assert.match(call.body.idempotency_key, /^[0-9a-f-]{36}$/i);
    for (const forbidden of ['amount', 'price', 'fee', 'platform_fee', 'creator_id', 'account_id', 'buyer_id', 'subscriber_id']) {
      assert.equal(Object.hasOwn(call.body, forbidden), false);
    }
  }
});

test('Premium client validates target UUIDs and finance remains product-disabled', async () => {
  const harness = loadLedgerClient();
  assert.equal((await harness.service.purchaseContent({ contentId: 'bad' })).success, false);
  assert.equal((await harness.service.subscribeToPlan({ planId: 'bad' })).success, false);
  assert.equal((await harness.service.cancelCreatorPremiumSubscription({ subscriptionId: 'bad' })).success, false);
  assert.equal(harness.invokes.length, 0);
  assert.match(read('services/creatorPremiumService.ts'), /CREATOR_PREMIUM_FINANCE_AVAILABLE(?:\s*:\s*boolean)?\s*=\s*false/);
  assert.equal(read('services/financial/ledgerClient.ts').includes('creatorPremiumFinanceClient'), false);
});
