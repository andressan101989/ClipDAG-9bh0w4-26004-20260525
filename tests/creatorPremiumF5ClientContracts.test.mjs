import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

import * as finance from '../services/creatorPremiumFinanceContracts.mjs';

const root = path.resolve(import.meta.dirname, '..');
const read = relative => readFileSync(path.join(root, relative), 'utf8');
const uuid = value => `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const ids = Object.freeze({
  subscriber: uuid(1),
  creator: uuid(2),
  plan: uuid(3),
  subscription: uuid(4),
  period: uuid(5),
  idempotency: uuid(6),
});

const policy = Object.freeze({
  purchase_enabled: true,
  subscription_enabled: true,
  refunds_enabled: true,
  platform_fee_bps: 2000,
  policy_version: 'creator-premium-f4-general-v1',
});

const autoRenewalEnabled = Object.freeze({
  enabled: true,
  mandate_state: 'ENABLED',
  consented_at: '2026-10-26T13:00:00.000Z',
  revoked_at: null,
  next_charge_at: '2026-11-25T13:00:00.000Z',
  authorized_price_bdag: '100.00000000',
  authorized_plan_version: 2,
  retry_count: 0,
  last_result: null,
  last_attempt_at: null,
});

const autoRenewalAbsent = Object.freeze({
  enabled: false,
  mandate_state: null,
  consented_at: null,
  revoked_at: null,
  next_charge_at: null,
  authorized_price_bdag: null,
  authorized_plan_version: null,
  retry_count: 0,
  last_result: null,
  last_attempt_at: null,
});

const subscriptionItem = Object.freeze({
  id: ids.subscription,
  creator: {
    id: ids.creator,
    username: 'creadora',
    display_name: 'Creadora',
    avatar_url: null,
  },
  plan: {
    id: ids.plan,
    name: 'Plan VIP',
    description: '',
    version: 2,
    price_bdag: '100.00000000',
    currency: 'BDAG',
    billing_period_days: 30,
    status: 'active',
    relationship: {
      id: ids.subscription,
      status: 'active',
      cancelled_at: null,
      paid_through_at: '2026-11-25T13:00:00.000Z',
      access_state: 'active',
    },
    subscription_available: false,
    subscription_blocker: 'creator_premium_already_subscribed',
    renewal_available: false,
    renewal_blocker: 'creator_premium_already_subscribed',
  },
  status: 'active',
  started_at: '2026-10-26T13:00:00.000Z',
  cancelled_at: null,
  ended_at: null,
  period: {
    id: ids.period,
    starts_at: '2026-10-26T13:00:00.000Z',
    paid_through_at: '2026-11-25T13:00:00.000Z',
    access_state: 'active',
    gross_amount_bdag: '100.00000000',
  },
  access_active: true,
  auto_renew: false,
  renewal_supported: true,
  renewal_available: false,
  renewal_blocker: 'creator_premium_already_subscribed',
  is_latest_relationship: true,
  created_at: '2026-10-26T13:00:00.000Z',
  updated_at: '2026-10-26T13:00:00.000Z',
});

const subscriptionsV1 = Object.freeze({
  policy,
  items: [subscriptionItem],
  next_cursor: null,
});

const subscriptionsV2 = Object.freeze({
  policy,
  items: [{ ...subscriptionItem, auto_renewal: autoRenewalEnabled }],
  next_cursor: null,
});

const autoRenewalReceipt = Object.freeze({
  subscription_id: ids.subscription,
  auto_renewal: autoRenewalEnabled,
  money_moved: false,
  replayed: false,
});

const raceCancellationReceipt = Object.freeze({
  subscription_id: ids.subscription,
  status: 'expired',
  paid_through_at: '2026-11-25T13:00:00.000Z',
  money_moved: false,
  replayed: false,
  already_cancelled: false,
  cancellation_effect: 'future_renewal_revoked_after_race',
});

const autoRenewalRevoked = Object.freeze({
  ...autoRenewalEnabled,
  enabled: false,
  mandate_state: 'REVOKED',
  revoked_at: '2026-10-26T14:00:00.000Z',
  next_charge_at: null,
  last_result: 'revoked',
});

const autoRenewalCancelled = Object.freeze({
  ...autoRenewalRevoked,
  last_result: 'cancelled',
});

const autoRenewalPausedInsufficient = Object.freeze({
  ...autoRenewalEnabled,
  enabled: false,
  mandate_state: 'PAUSED',
  next_charge_at: null,
  retry_count: 3,
  last_result: 'insufficient_balance',
  last_attempt_at: '2026-11-25T14:00:00.000Z',
});

function compile(source, filename) {
  return ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
}

function loadLedgerEdge() {
  let handler;
  const rpcCalls = [];
  const admin = {
    auth: {
      async getUser() {
        return { data: { user: { id: ids.subscriber } }, error: null };
      },
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args: structuredClone(args) });
      return { data: structuredClone(autoRenewalReceipt), error: null };
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
    structuredClone,
    console,
    require(specifier) {
      if (specifier === 'https://esm.sh/@supabase/supabase-js@2.106.1') {
        return { createClient: () => admin };
      }
      if (specifier === '../_shared/cors.ts') return { corsHeaders: {} };
      throw new Error(`Unexpected bdag-ledger module: ${specifier}`);
    },
    Deno: {
      env: { get: () => 'synthetic-only' },
      serve(fn) { handler = fn; },
    },
  }, { filename: 'bdag-ledger.js' });
  return {
    rpcCalls,
    async post(body) {
      const response = await handler(new Request('https://edge.invalid', {
        method: 'POST',
        headers: { Authorization: 'Bearer synthetic-only', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }));
      return { status: response.status, body: await response.json() };
    },
  };
}

function loadLedgerClient() {
  const invokes = [];
  const client = {
    functions: {
      async invoke(name, options) {
        invokes.push({ name, body: structuredClone(options.body) });
        return {
          data: { success: true, data: structuredClone(autoRenewalReceipt) },
          error: null,
        };
      },
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(compile(read('services/financial/ledgerClient.ts'), 'ledgerClient.ts'), {
    module,
    exports: module.exports,
    structuredClone,
    console,
    crypto: { randomUUID: () => ids.idempotency },
    require(specifier) {
      if (specifier === '@/template') return { getSupabaseClient: () => client };
      if (specifier === '@/services/walletApi') {
        return { getWithdrawalConfigFromBackend: async () => ({ minimumBdag: 1 }) };
      }
      if (specifier === '@/services/creatorPremiumFinanceContracts.mjs') return finance;
      if (specifier === '@supabase/supabase-js') {
        return { FunctionsHttpError: class FunctionsHttpError extends Error {} };
      }
      throw new Error(`Unexpected ledgerClient module: ${specifier}`);
    },
  }, { filename: 'ledgerClient.js' });
  return { api: module.exports, invokes };
}

function clone(value) {
  return structuredClone(value);
}

function servicePage(item) {
  return {
    policy: clone(policy),
    items: [clone(item)],
    nextCursor: null,
  };
}

async function subscriptionHistoryScreen({
  initialPage = servicePage({ ...subscriptionItem, auto_renewal: autoRenewalAbsent }),
  setAutoRenewal,
  cancelSubscription,
  subscribeToPlan,
} = {}) {
  const slots = [];
  const effects = [];
  const alerts = [];
  const autoRenewalCalls = [];
  const cancellationCalls = [];
  const renewalCalls = [];
  const generated = [];
  let cursor = 0;
  let pending = [];
  let tree;
  let mounted = true;
  let serverPage = clone(initialPage);

  const changed = (before, after) => !before || !after || before.length !== after.length
    || after.some((value, index) => !Object.is(value, before[index]));
  const memo = (factory, deps) => {
    const index = cursor++;
    if (!slots[index] || changed(slots[index].deps, deps)) {
      slots[index] = { deps, value: factory() };
    }
    return slots[index].value;
  };
  const effect = (fn, deps) => {
    const index = cursor++;
    if (!effects[index] || changed(effects[index].deps, deps)) {
      pending.push(() => {
        effects[index]?.cleanup?.();
        effects[index] = { deps, cleanup: fn() };
      });
    }
  };
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => {
        slots[index] = typeof value === 'function' ? value(slots[index]) : value;
      }];
    },
    useRef(initial) {
      const index = cursor++;
      return slots[index] ??= { current: initial };
    },
    useCallback: (fn, deps) => memo(() => fn, deps),
    useEffect: effect,
  };
  const jsx = (type, props) => ({ type, props });
  const module = { exports: {} };
  const source = `${read('app/my-subscriptions.tsx')}\nexport { MySubscriptionsScreenContent };`;
  vm.runInNewContext(compile(source, 'my-subscriptions.tsx'), {
    module,
    exports: module.exports,
    console,
    structuredClone,
    require(specifier) {
      if (specifier === 'react') return { ...hooks, default: hooks };
      if (specifier === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
      if (specifier === 'react-native') return {
        ActivityIndicator: 'ActivityIndicator',
        Alert: { alert: (...args) => alerts.push(args) },
        Pressable: 'Pressable',
        RefreshControl: 'RefreshControl',
        ScrollView: 'ScrollView',
        StyleSheet: { create: styles => styles },
        Text: 'Text',
        View: 'View',
      };
      if (specifier === 'expo-router') return {
        useRouter: () => ({ back() {}, push() {} }),
        useFocusEffect: fn => effect(fn, [fn]),
      };
      if (specifier === 'expo-crypto') return {
        randomUUID: () => {
          const value = uuid(2000 + generated.length);
          generated.push(value);
          return value;
        },
      };
      if (specifier === 'react-native-safe-area-context') {
        return { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
      }
      if (specifier === '@/hooks/useAuth') {
        return { useAuth: () => ({ user: { id: ids.subscriber } }) };
      }
      if (specifier === '@/constants/theme') {
        return { Colors: {}, FontSize: {}, FontWeight: {}, Radius: {}, Spacing: {} };
      }
      if (specifier === '@/services/creatorPremiumIntegrationState') {
        return { creatorPremiumErrorMessage: cause => `SAFE:${cause && typeof cause === 'object' && typeof cause.message === 'string' ? cause.message : 'unknown'}` };
      }
      if (specifier === '@/services/creatorPremiumPresentation.mjs') {
        return { formatCreatorPremiumBdag: value => `${value} BDAG` };
      }
      if (specifier === '@/services/creatorPremiumService') return {
        fetchMyCreatorPremiumSubscriptions: async () => clone(serverPage),
        fetchMyCreatorPremiumSubscriptionsSnapshot: async () => clone(serverPage),
      };
      if (specifier === '@/services/financial/ledgerClient') return {
        subscribeToPlan: async params => {
          renewalCalls.push(clone(params));
          const outcome = subscribeToPlan
            ? await subscribeToPlan(clone(params), clone(serverPage))
            : { result: { success: false, error: 'not-configured' } };
          if (outcome?.page) serverPage = clone(outcome.page);
          return outcome?.result ?? outcome;
        },
        setCreatorPremiumAutoRenewal: async params => {
          autoRenewalCalls.push(clone(params));
          const outcome = setAutoRenewal
            ? await setAutoRenewal(clone(params), clone(serverPage))
            : { result: { success: false, error: 'not-configured' } };
          if (outcome?.page) serverPage = clone(outcome.page);
          return outcome?.result ?? outcome;
        },
        cancelCreatorPremiumSubscription: async params => {
          cancellationCalls.push(clone(params));
          const outcome = cancelSubscription
            ? await cancelSubscription(clone(params), clone(serverPage))
            : { result: { success: false, error: 'not-configured' } };
          if (outcome?.page) serverPage = clone(outcome.page);
          return outcome?.result ?? outcome;
        },
      };
      if (specifier === '@expo/vector-icons') return { MaterialCommunityIcons: 'Icon' };
      if (specifier === 'expo-image') return { Image: 'Image' };
      if (specifier === 'expo-status-bar') return { StatusBar: 'StatusBar' };
      throw new Error(`Unexpected subscriptions import: ${specifier}`);
    },
  }, { filename: 'my-subscriptions.js' });

  const render = () => {
    cursor = 0;
    pending = [];
    tree = module.exports.MySubscriptionsScreenContent();
    for (const run of pending) run();
    return tree;
  };
  const settle = async (turns = 5) => {
    for (let index = 0; index < turns; index += 1) {
      await new Promise(resolve => setImmediate(resolve));
      if (mounted) render();
    }
  };
  const nodes = () => {
    const found = [];
    const walk = node => {
      if (node === null || node === undefined || typeof node === 'boolean') return;
      if (typeof node !== 'object') return;
      found.push(node);
      for (const child of [node.props?.children].flat(Infinity)) walk(child);
    };
    walk(tree);
    return found;
  };
  const nodeText = node => {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (!node || typeof node !== 'object') return '';
    return [node.props?.children].flat(Infinity).map(nodeText).join('');
  };
  const press = label => {
    const action = nodes().find(node => node.type === 'Pressable' && nodeText(node).includes(label));
    assert.ok(action, `action missing: ${label}`);
    assert.equal(action.props.disabled, false, `action disabled: ${label}`);
    action.props.onPress();
    return action;
  };
  const confirm = async label => {
    const dialog = alerts.findLast(args => Array.isArray(args[2])
      && args[2].some(button => button.text === label));
    assert.ok(dialog, `confirmation missing: ${label}`);
    dialog[2].find(button => button.text === label).onPress();
    await settle();
  };

  render();
  await settle();
  return {
    alerts,
    autoRenewalCalls,
    cancellationCalls,
    renewalCalls,
    generated,
    render,
    settle,
    press,
    confirm,
    text: () => nodeText(tree),
    async refresh(page) {
      serverPage = clone(page);
      const scroll = nodes().find(node => node.props?.refreshControl);
      assert.ok(scroll, 'refresh control missing');
      scroll.props.refreshControl.props.onRefresh();
      await settle();
    },
    unmount() {
      if (!mounted) return;
      mounted = false;
      for (const entry of effects) entry?.cleanup?.();
    },
  };
}

function loadIntegrationMessages() {
  const module = { exports: {} };
  vm.runInNewContext(compile(read('services/creatorPremiumIntegrationState.ts'), 'integration.ts'), {
    module,
    exports: module.exports,
    console,
    require(specifier) {
      if (specifier === './creatorPremiumPresentation.mjs') {
        return { creatorPremiumPolicyBlocksRetry: () => false };
      }
      throw new Error(`Unexpected integration import: ${specifier}`);
    },
  }, { filename: 'integration.js' });
  return module.exports;
}

test('F5 v2 subscription projection adds one exact auto-renewal object while v1 bytes stay unchanged', () => {
  assert.deepEqual(finance.parseCreatorPremiumSubscriptionsPage(subscriptionsV1), subscriptionsV1);
  assert.throws(
    () => finance.parseCreatorPremiumSubscriptionsPage(subscriptionsV2),
    /creator_premium_subscriptions_invalid/,
  );
  assert.deepEqual(finance.parseCreatorPremiumSubscriptionsPageV2(subscriptionsV2), subscriptionsV2);

  for (const auto_renewal of [
    { ...autoRenewalEnabled, extra: true },
    { ...autoRenewalEnabled, enabled: false },
    { ...autoRenewalEnabled, mandate_state: 'PRIVATE' },
    { ...autoRenewalEnabled, authorized_price_bdag: 100 },
    { ...autoRenewalEnabled, authorized_price_bdag: '100' },
    { ...autoRenewalEnabled, authorized_plan_version: 0 },
    { ...autoRenewalEnabled, authorized_plan_version: 2147483648 },
    { ...autoRenewalEnabled, retry_count: 3 },
    { ...autoRenewalEnabled, next_charge_at: null },
    { ...autoRenewalAbsent, authorized_price_bdag: '100.00000000' },
  ]) {
    assert.throws(
      () => finance.parseCreatorPremiumSubscriptionsPageV2({
        ...subscriptionsV2,
        items: [{ ...subscriptionsV2.items[0], auto_renewal }],
      }),
      /creator_premium_subscriptions_invalid/,
    );
  }

  const missing = structuredClone(subscriptionsV2);
  delete missing.items[0].auto_renewal.last_attempt_at;
  assert.throws(
    () => finance.parseCreatorPremiumSubscriptionsPageV2(missing),
    /creator_premium_subscriptions_invalid/,
  );
});

test('F5 auto-renewal command receipts are target-bound, exact and move no money', () => {
  assert.equal(typeof finance.parseCreatorPremiumAutoRenewalReceipt, 'function');
  assert.deepEqual(
    finance.parseCreatorPremiumAutoRenewalReceipt(
      autoRenewalReceipt,
      ids.subscription,
      true,
    ),
    autoRenewalReceipt,
  );
  for (const invalid of [
    { ...autoRenewalReceipt, subscription_id: uuid(99) },
    { ...autoRenewalReceipt, money_moved: true },
    { ...autoRenewalReceipt, replayed: 'false' },
    { ...autoRenewalReceipt, extra: true },
    { ...autoRenewalReceipt, auto_renewal: autoRenewalAbsent },
    {
      ...autoRenewalReceipt,
      auto_renewal: autoRenewalPausedInsufficient,
    },
  ]) {
    assert.throws(
      () => finance.parseCreatorPremiumAutoRenewalReceipt(invalid, ids.subscription, true),
      /creator_premium_auto_renewal_receipt_invalid/,
    );
  }

  assert.throws(
    () => finance.parseCreatorPremiumAutoRenewalReceipt(
      { ...autoRenewalReceipt, auto_renewal: autoRenewalPausedInsufficient },
      ids.subscription,
      false,
    ),
    /creator_premium_auto_renewal_receipt_invalid/,
  );
});

test('F5 cancellation parser accepts only the reviewed cron-won acknowledgement', () => {
  assert.deepEqual(
    finance.parseCreatorPremiumCancellationReceipt(raceCancellationReceipt, ids.subscription),
    raceCancellationReceipt,
  );
  assert.deepEqual(
    finance.parseCreatorPremiumCancellationReceipt(
      { ...raceCancellationReceipt, replayed: true },
      ids.subscription,
    ),
    { ...raceCancellationReceipt, replayed: true },
  );
  for (const invalid of [
    { ...raceCancellationReceipt, status: 'cancelled' },
    { ...raceCancellationReceipt, cancellation_effect: 'refund_after_race' },
    { ...raceCancellationReceipt, already_cancelled: true },
    { ...raceCancellationReceipt, money_moved: true },
    { ...raceCancellationReceipt, extra: true },
  ]) {
    assert.throws(
      () => finance.parseCreatorPremiumCancellationReceipt(invalid, ids.subscription),
      /creator_premium_cancellation_receipt_invalid/,
    );
  }
});

test('F5 Edge action derives subscriber from JWT and forwards only reviewed assertions', async () => {
  const gateway = loadLedgerEdge();
  const response = await gateway.post({
    action: 'creator_premium_set_auto_renewal',
    idempotency_key: ids.idempotency,
    subscription_id: ids.subscription,
    enabled: true,
    expected_price_bdag: '100.00000000',
    expected_plan_version: 2,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(gateway.rpcCalls, [{
    name: 'set_creator_premium_auto_renewal_v1',
    args: {
      p_subscriber_id: ids.subscriber,
      p_subscription_id: ids.subscription,
      p_enabled: true,
      p_expected_price_bdag: '100.00000000',
      p_expected_plan_version: 2,
      p_idempotency_key: ids.idempotency,
    },
  }]);
});

test('F5 Edge action rejects malformed assertions, unknown fields and client financial authority', async () => {
  const base = {
    action: 'creator_premium_set_auto_renewal',
    idempotency_key: ids.idempotency,
    subscription_id: ids.subscription,
    enabled: true,
    expected_price_bdag: '100.00000000',
    expected_plan_version: 2,
  };
  for (const change of [
    { idempotency_key: 'bad' },
    { subscription_id: 'bad' },
    { enabled: 'true' },
    { expected_price_bdag: 100 },
    { expected_price_bdag: '100' },
    { expected_price_bdag: '0.00000000' },
    { expected_plan_version: 0 },
    { expected_plan_version: 2.5 },
    { expected_plan_version: 2147483648 },
    { subscriber_id: ids.subscriber },
    { creator_id: ids.creator },
    { amount: '100.00000000' },
    { platform_fee_bps: 2000 },
    { extra: true },
  ]) {
    const gateway = loadLedgerEdge();
    const response = await gateway.post({ ...base, ...change });
    assert.equal(response.status, 400, JSON.stringify(change));
    assert.equal(gateway.rpcCalls.length, 0, JSON.stringify(change));
  }
});

test('typed F5 ledger helper sends exact consent assertions and rejects extra authority locally', async () => {
  const harness = loadLedgerClient();
  assert.equal(typeof harness.api.setCreatorPremiumAutoRenewal, 'function');
  assert.deepEqual(
    structuredClone(await harness.api.setCreatorPremiumAutoRenewal({
      subscriptionId: ids.subscription,
      enabled: true,
      expectedPriceBdag: '100.00000000',
      expectedPlanVersion: 2,
      idempotencyKey: ids.idempotency,
    })),
    { success: true, data: autoRenewalReceipt },
  );
  assert.deepEqual(harness.invokes, [{
    name: 'bdag-ledger',
    body: {
      action: 'creator_premium_set_auto_renewal',
      idempotency_key: ids.idempotency,
      subscription_id: ids.subscription,
      enabled: true,
      expected_price_bdag: '100.00000000',
      expected_plan_version: 2,
    },
  }]);

  for (const change of [
    { subscriptionId: 'bad' },
    { enabled: 'true' },
    { expectedPriceBdag: '100' },
    { expectedPlanVersion: 0 },
    { expectedPlanVersion: 2147483648 },
    { idempotencyKey: 'bad' },
    { amount: '100.00000000' },
  ]) {
    const result = await harness.api.setCreatorPremiumAutoRenewal({
      subscriptionId: ids.subscription,
      enabled: true,
      expectedPriceBdag: '100.00000000',
      expectedPlanVersion: 2,
      idempotencyKey: ids.idempotency,
      ...change,
    });
    assert.equal(result.success, false, JSON.stringify(change));
    assert.equal(harness.invokes.length, 1, JSON.stringify(change));
  }
});

test('subscription UI requires explicit consent and trusts only the server-confirmed ON projection', async () => {
  const enabledItem = { ...subscriptionItem, auto_renewal: autoRenewalEnabled };
  const screen = await subscriptionHistoryScreen({
    setAutoRenewal: async params => ({
      result: {
        success: true,
        data: { ...autoRenewalReceipt, auto_renewal: autoRenewalEnabled },
      },
      page: servicePage(enabledItem),
    }),
  });

  assert.match(screen.text(), /Renovación automática desactivada/);
  screen.press('Activar renovación automática');
  assert.equal(screen.autoRenewalCalls.length, 0, 'consent dialog must precede transport');
  const dialog = screen.alerts.at(-1);
  assert.equal(dialog[0], 'Activar renovación automática');
  assert.match(dialog[1], /Plan VIP/);
  assert.match(dialog[1], /100\.00000000 BDAG/);
  assert.match(dialog[1], /próximo cobro/i);

  await screen.confirm('Activar');
  assert.deepEqual(screen.autoRenewalCalls, [{
    subscriptionId: ids.subscription,
    enabled: true,
    expectedPriceBdag: '100.00000000',
    expectedPlanVersion: 2,
    idempotencyKey: screen.autoRenewalCalls[0].idempotencyKey,
  }]);
  assert.match(screen.autoRenewalCalls[0].idempotencyKey, /^[0-9a-f-]{36}$/);
  assert.match(screen.text(), /Renovación automática activa/);
  assert.match(screen.text(), /Próximo cobro/);
  assert.match(screen.text(), /25 nov 2026/i);
  screen.unmount();
});

test('subscription UI does not claim ON when the command is not confirmed by readback', async () => {
  const screen = await subscriptionHistoryScreen({
    setAutoRenewal: async () => ({
      result: { success: true, data: autoRenewalReceipt },
    }),
  });
  screen.press('Activar renovación automática');
  await screen.confirm('Activar');
  assert.match(screen.text(), /Renovación automática desactivada/);
  assert.doesNotMatch(screen.text(), /Renovación automática activa/);
  assert.equal(screen.alerts.at(-1)[0], 'No se pudo actualizar');
  assert.equal(
    screen.alerts.at(-1)[1],
    'SAFE:creator_premium_auto_renewal_readback_pending',
  );
  screen.unmount();
});

test('subscription UI revokes future charges only after an exact server readback', async () => {
  const initial = servicePage({ ...subscriptionItem, auto_renewal: autoRenewalEnabled });
  const revokedItem = { ...subscriptionItem, auto_renewal: autoRenewalRevoked };
  const screen = await subscriptionHistoryScreen({
    initialPage: initial,
    setAutoRenewal: async () => ({
      result: {
        success: true,
        data: {
          subscription_id: ids.subscription,
          auto_renewal: autoRenewalRevoked,
          money_moved: false,
          replayed: false,
        },
      },
      page: servicePage(revokedItem),
    }),
  });
  assert.match(screen.text(), /Renovación automática activa/);
  screen.press('Desactivar renovación automática');
  assert.equal(screen.autoRenewalCalls.length, 0);
  await screen.confirm('Desactivar');
  assert.equal(screen.autoRenewalCalls.length, 1);
  assert.equal(screen.autoRenewalCalls[0].enabled, false);
  assert.match(screen.text(), /Renovación automática desactivada/);
  assert.doesNotMatch(screen.text(), /Renovación automática activa/);
  screen.unmount();
});

test('subscription UI does not call a PAUSED mandate a confirmed revocation', async () => {
  const initial = servicePage({ ...subscriptionItem, auto_renewal: autoRenewalEnabled });
  const pausedItem = { ...subscriptionItem, auto_renewal: autoRenewalPausedInsufficient };
  const screen = await subscriptionHistoryScreen({
    initialPage: initial,
    setAutoRenewal: async () => ({
      result: {
        success: true,
        data: {
          subscription_id: ids.subscription,
          auto_renewal: autoRenewalPausedInsufficient,
          money_moved: false,
          replayed: false,
        },
      },
      page: servicePage(pausedItem),
    }),
  });
  screen.press('Desactivar renovación automática');
  await screen.confirm('Desactivar');
  assert.equal(screen.alerts.at(-1)[0], 'No se pudo actualizar');
  assert.equal(
    screen.alerts.at(-1)[1],
    'SAFE:creator_premium_auto_renewal_readback_pending',
  );
  assert.doesNotMatch(screen.alerts.at(-1)[0], /desactivada/i);
  screen.unmount();
});

test('subscription UI permits revocation while Finance is OFF', async () => {
  const initial = servicePage({ ...subscriptionItem, auto_renewal: autoRenewalEnabled });
  initial.policy.subscription_enabled = false;
  const revokedPage = servicePage({ ...subscriptionItem, auto_renewal: autoRenewalRevoked });
  revokedPage.policy.subscription_enabled = false;
  const screen = await subscriptionHistoryScreen({
    initialPage: initial,
    setAutoRenewal: async params => ({
      result: {
        success: true,
        data: {
          subscription_id: ids.subscription,
          auto_renewal: autoRenewalRevoked,
          money_moved: false,
          replayed: false,
        },
      },
      page: revokedPage,
    }),
  });
  screen.press('Desactivar renovación automática');
  await screen.confirm('Desactivar');
  assert.equal(screen.autoRenewalCalls.length, 1);
  assert.equal(screen.autoRenewalCalls[0].enabled, false);
  assert.match(screen.text(), /Renovación automática desactivada/);
  screen.unmount();
});

test('subscription UI ignores an auto-renewal response after unmount', async () => {
  let resolveCommand;
  const command = new Promise(resolve => { resolveCommand = resolve; });
  const screen = await subscriptionHistoryScreen({
    setAutoRenewal: async () => command,
  });
  screen.press('Activar renovación automática');
  await screen.confirm('Activar');
  assert.equal(screen.autoRenewalCalls.length, 1);
  const alertCount = screen.alerts.length;
  screen.unmount();
  resolveCommand({
    result: { success: true, data: autoRenewalReceipt },
    page: servicePage({ ...subscriptionItem, auto_renewal: autoRenewalEnabled }),
  });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(screen.alerts.length, alertCount);
});

test('subscription UI rejects consent captured from a stale price or plan version', async () => {
  const screen = await subscriptionHistoryScreen({
    setAutoRenewal: async () => {
      throw new Error('transport_must_not_run');
    },
  });
  screen.press('Activar renovación automática');
  const changed = {
    ...subscriptionItem,
    plan: { ...subscriptionItem.plan, version: 3, price_bdag: '120.00000000' },
    auto_renewal: autoRenewalAbsent,
  };
  await screen.refresh(servicePage(changed));
  await screen.confirm('Activar');
  assert.deepEqual(screen.autoRenewalCalls, []);
  assert.equal(screen.alerts.at(-1)[0], 'No se pudo actualizar');
  assert.equal(
    screen.alerts.at(-1)[1],
    'SAFE:creator_premium_auto_renewal_snapshot_changed',
  );
  screen.unmount();
});

test('subscription UI rotates an ambiguous consent key after an opposite transition is confirmed', async () => {
  const enabledItem = { ...subscriptionItem, auto_renewal: autoRenewalEnabled };
  const revokedItem = { ...subscriptionItem, auto_renewal: autoRenewalRevoked };
  let firstEnableKey;
  const screen = await subscriptionHistoryScreen({
    setAutoRenewal: async params => {
      if (params.enabled && firstEnableKey === undefined) {
        firstEnableKey = params.idempotencyKey;
        return {
          result: { success: false, error: 'transport_timeout' },
          page: servicePage(enabledItem),
        };
      }
      if (!params.enabled) {
        return {
          result: {
            success: true,
            data: {
              subscription_id: ids.subscription,
              auto_renewal: autoRenewalRevoked,
              money_moved: false,
              replayed: false,
            },
          },
          page: servicePage(revokedItem),
        };
      }
      if (params.idempotencyKey === firstEnableKey) {
        return {
          result: {
            success: true,
            data: { ...autoRenewalReceipt, replayed: true },
          },
        };
      }
      return {
        result: { success: true, data: autoRenewalReceipt },
        page: servicePage(enabledItem),
      };
    },
  });

  screen.press('Activar renovación automática');
  await screen.confirm('Activar');
  assert.equal(screen.alerts.at(-1)[0], 'No se pudo actualizar');

  await screen.refresh(servicePage(enabledItem));
  screen.press('Desactivar renovación automática');
  await screen.confirm('Desactivar');
  assert.match(screen.text(), /Renovación automática desactivada/);

  screen.press('Activar renovación automática');
  await screen.confirm('Activar');
  assert.equal(screen.autoRenewalCalls.length, 3);
  assert.notEqual(
    screen.autoRenewalCalls[2].idempotencyKey,
    firstEnableKey,
    'the confirmed opposite transition must retire the old ambiguous consent key',
  );
  assert.match(screen.text(), /Renovación automática activa/);
  screen.unmount();
});

test('insufficient balance recovery requires manual renewal before fresh auto-renewal consent', async () => {
  const expired = {
    ...subscriptionItem,
    status: 'expired',
    ended_at: subscriptionItem.period.paid_through_at,
    access_active: false,
    period: { ...subscriptionItem.period, access_state: 'expired' },
    plan: {
      ...subscriptionItem.plan,
      relationship: {
        ...subscriptionItem.plan.relationship,
        status: 'expired',
        paid_through_at: subscriptionItem.period.paid_through_at,
        access_state: 'expired',
      },
      renewal_available: true,
      renewal_blocker: null,
    },
    auto_renewal: autoRenewalPausedInsufficient,
    renewal_available: true,
    renewal_blocker: null,
  };
  const renewedId = uuid(74);
  const renewed = {
    ...subscriptionItem,
    id: renewedId,
    plan: {
      ...subscriptionItem.plan,
      relationship: { ...subscriptionItem.plan.relationship, id: renewedId },
    },
    period: { ...subscriptionItem.period, id: uuid(75) },
    auto_renewal: autoRenewalPausedInsufficient,
  };
  const renewedEnabled = { ...renewed, auto_renewal: autoRenewalEnabled };
  const screen = await subscriptionHistoryScreen({
    initialPage: servicePage(expired),
    subscribeToPlan: async () => ({
      result: { success: true, data: { subscription_id: renewedId } },
      page: servicePage(renewed),
    }),
    setAutoRenewal: async params => ({
      result: {
        success: true,
        data: {
          ...autoRenewalReceipt,
          subscription_id: params.subscriptionId,
          auto_renewal: autoRenewalEnabled,
        },
      },
      page: servicePage(renewedEnabled),
    }),
  });

  assert.match(screen.text(), /saldo insuficiente/i);
  assert.match(screen.text(), /renueva manualmente/i);
  assert.doesNotMatch(screen.text(), /agrega saldo; si quedó pausada, vuelve a autorizar/i);
  screen.press('Renovar periodo');
  await screen.confirm('Renovar');
  assert.equal(screen.renewalCalls.length, 1);
  assert.match(screen.text(), /Renovación automática pausada/);

  screen.press('Activar renovación automática');
  await screen.confirm('Activar');
  assert.equal(screen.autoRenewalCalls.length, 1);
  assert.equal(screen.autoRenewalCalls[0].subscriptionId, renewedId);
  assert.match(screen.text(), /Renovación automática activa/);
  screen.unmount();
});

test('cron-won cancellation race stops future renewal but preserves the newly paid period', async () => {
  const oldItem = { ...subscriptionItem, auto_renewal: autoRenewalEnabled };
  const renewedId = uuid(44);
  const renewedPeriodId = uuid(45);
  const expired = {
    ...oldItem,
    status: 'expired',
    ended_at: raceCancellationReceipt.paid_through_at,
    access_active: false,
    is_latest_relationship: false,
    period: { ...oldItem.period, access_state: 'expired' },
    auto_renewal: autoRenewalCancelled,
  };
  const renewed = {
    ...oldItem,
    id: renewedId,
    status: 'active',
    started_at: '2026-11-25T13:00:00.000Z',
    period: {
      ...oldItem.period,
      id: renewedPeriodId,
      starts_at: '2026-11-25T13:00:00.000Z',
      paid_through_at: '2026-12-25T13:00:00.000Z',
    },
    plan: {
      ...oldItem.plan,
      relationship: {
        id: renewedId,
        status: 'active',
        cancelled_at: null,
        paid_through_at: '2026-12-25T13:00:00.000Z',
        access_state: 'active',
      },
    },
    is_latest_relationship: true,
    auto_renewal: autoRenewalCancelled,
  };
  const screen = await subscriptionHistoryScreen({
    initialPage: servicePage(oldItem),
    cancelSubscription: async () => ({
      result: { success: true, data: raceCancellationReceipt },
      page: { policy: clone(policy), items: [renewed, expired], nextCursor: null },
    }),
  });
  screen.press('Cancelar futuras renovaciones');
  await screen.confirm('Cancelar suscripción');
  assert.equal(screen.cancellationCalls.length, 1);
  assert.equal(screen.alerts.at(-1)[0], 'Renovación futura detenida');
  assert.match(screen.alerts.at(-1)[1], /nuevo periodo pagado permanece accesible/i);
  assert.doesNotMatch(screen.alerts.at(-1)[1], /reembols/i);
  assert.match(screen.text(), /25 dic 2026/i);
  screen.unmount();
});

test('cron-won cancellation race requires the exact revoked cancellation readback', async () => {
  const oldItem = { ...subscriptionItem, auto_renewal: autoRenewalEnabled };
  const expired = {
    ...oldItem,
    status: 'expired',
    ended_at: raceCancellationReceipt.paid_through_at,
    access_active: false,
    is_latest_relationship: false,
    period: { ...oldItem.period, access_state: 'expired' },
    auto_renewal: autoRenewalRevoked,
  };
  const renewed = {
    ...oldItem,
    id: uuid(54),
    status: 'active',
    started_at: '2026-11-25T13:00:00.000Z',
    period: {
      ...oldItem.period,
      id: uuid(55),
      starts_at: '2026-11-25T13:00:00.000Z',
      paid_through_at: '2026-12-25T13:00:00.000Z',
    },
    plan: {
      ...oldItem.plan,
      relationship: {
        id: uuid(54),
        status: 'active',
        cancelled_at: null,
        paid_through_at: '2026-12-25T13:00:00.000Z',
        access_state: 'active',
      },
    },
    is_latest_relationship: true,
    auto_renewal: autoRenewalRevoked,
  };
  const screen = await subscriptionHistoryScreen({
    initialPage: servicePage(oldItem),
    cancelSubscription: async () => ({
      result: { success: true, data: raceCancellationReceipt },
      page: { policy: clone(policy), items: [renewed, expired], nextCursor: null },
    }),
  });
  screen.press('Cancelar futuras renovaciones');
  await screen.confirm('Cancelar suscripción');
  assert.equal(screen.alerts.at(-1)[0], 'No se pudo cancelar');
  assert.equal(
    screen.alerts.at(-1)[1],
    'SAFE:creator_premium_cancellation_readback_pending',
  );
  screen.unmount();
});

test('F5 exposes bounded safe errors without leaking internal SQL details', () => {
  const integration = loadIntegrationMessages();
  const expected = new Map([
    ['creator_premium_auto_renewal_snapshot_changed', /plan o el precio cambió/i],
    ['creator_premium_auto_renewal_binding_invalid', /periodo pagado/i],
    ['creator_premium_auto_renewal_idempotency_conflict', /intento/i],
    ['creator_premium_auto_renewal_receipt_invalid', /respuesta.*verificarse/i],
    ['creator_premium_auto_renewal_readback_pending', /servidor.*confirmar/i],
  ]);
  for (const [code, pattern] of expected) {
    const copy = integration.creatorPremiumErrorMessage(new Error(code));
    assert.match(copy, pattern, code);
    assert.doesNotMatch(copy, /SQL|P000|private\.|security definer/i);
    assert.notEqual(copy, 'No pudimos completar la operación. Inténtalo de nuevo.');
  }
});

test('initial offer explains optional auto-renewal and never dispatches a mandate command', () => {
  const source = read('app/creator-premium-offer/[contentId].tsx');
  assert.match(source, /renovación automática es opcional/i);
  assert.match(source, /no la (?:activa|habilita)/i);
  assert.doesNotMatch(source, /setCreatorPremiumAutoRenewal/);
});
