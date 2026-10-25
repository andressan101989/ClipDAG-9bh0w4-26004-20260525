import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as finance from '../services/creatorPremiumFinanceContracts.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const uuid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const id = { buyer: uuid(1), content: uuid(2), offer: uuid(3), key: uuid(4), creator: uuid(5), plan: uuid(6) };
const policy = {
  purchase_enabled: true, subscription_enabled: true, refunds_enabled: true,
  platform_fee_bps: 1000, policy_version: 'creator-premium-f3-v1',
};
const commerce = {
  content: { id: id.content, creator_id: id.creator, title: 'Synthetic canary', description: '',
    content_kind: 'image', access_mode: 'purchase_or_subscription',
    teaser_url: 'https://example.invalid/teaser.jpg', published_at: '2026-10-25T00:00:00Z' },
  creator: { id: id.creator, username: 'synthetic', display_name: null, avatar_url: null },
  offer: { id: id.offer, version: 1, price_bdag: '10.00000000', currency: 'BDAG', status: 'active' },
  plans: [{ id: id.plan, name: 'Manual', description: '', version: 1,
    price_bdag: '20.00000000', currency: 'BDAG', billing_period_days: 30, status: 'active',
    relationship: null, subscription_available: false,
    subscription_blocker: 'creator_premium_subscription_disabled', renewal_available: false,
    renewal_blocker: 'creator_premium_subscription_disabled' }],
  plan_count: 1, plans_truncated: false,
  entitlement: { allowed: false, source: 'none', reason: 'not_entitled', expires_at: null },
  operations: { purchase_available: false, purchase_blocker: 'creator_premium_purchase_disabled' },
  policy,
};

function load(file, require, globals = {}, suffix = '') {
  const module = { exports: {} };
  const source = ts.transpileModule(read(file) + suffix, {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require, console, ...globals }, { filename: file });
  return module.exports;
}

// Preserve hook slots and dependency-driven cleanup across real screen renders.
// Only native rendering, identity and remote I/O are replaced here.
async function consentScreen({ history = false, projection, subscription }) {
  const slots = [], effects = [], alerts = [], purchases = [], generated = [];
  let cursor = 0, pending = [], tree, mounted = true, user = { id: id.buyer }, next = projection;
  const changed = (before, after) => !before || !after || before.length !== after.length
    || after.some((value, index) => !Object.is(value, before[index]));
  const memo = (fn, deps) => {
    const index = cursor++;
    if (!slots[index] || changed(slots[index].deps, deps)) slots[index] = { deps, value: fn() };
    return slots[index].value;
  };
  const effect = (fn, deps) => {
    const index = cursor++;
    if (!effects[index] || changed(effects[index].deps, deps)) pending.push(() => {
      effects[index]?.cleanup?.();
      effects[index] = { deps, cleanup: fn() };
    });
  };
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback: (fn, deps) => memo(() => fn, deps), useMemo: memo, useEffect: effect,
  };
  const jsx = (type, props) => ({ type, props });
  const component = history ? 'MySubscriptionsScreenContent' : 'CreatorPremiumOfferScreenContent';
  const page = () => ({ items: [subscription], next_cursor: null, policy });
  const module = load(history ? 'app/my-subscriptions.tsx' : 'app/creator-premium-offer/[contentId].tsx', name => {
    if (name === 'react') return { ...hooks, default: hooks };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (name === 'react-native') return { Alert: { alert: (...args) => alerts.push(args) },
      StyleSheet: { create: styles => styles }, Pressable: 'Pressable', View: 'View', Text: 'Text',
      ScrollView: 'ScrollView', RefreshControl: 'RefreshControl' };
    if (name === 'expo-router') return { useLocalSearchParams: () => ({ contentId: id.content }),
      useRouter: () => ({}), useFocusEffect: fn => effect(fn, [fn]) };
    if (name === 'expo-crypto') return { randomUUID: () => { const key = uuid(1000 + generated.length); generated.push(key); return key; } };
    if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
    if (name === '@/hooks/useAuth') return { useAuth: () => ({ user }) };
    if (name === '@/constants/theme') return { Colors: {}, FontSize: {}, FontWeight: {}, Radius: {}, Spacing: {} };
    if (name === '@/services/creatorPremiumIntegrationState') return { creatorPremiumErrorMessage: () => 'Safe error' };
    if (name === '@/services/creatorPremiumPresentation.mjs') return { formatCreatorPremiumBdag: text => `${text} BDAG` };
    if (name === '@/services/creatorPremiumService') return { CREATOR_PREMIUM_REPORT_REASONS: [],
      fetchCreatorPremiumCommerce: async () => next, fetchMyCreatorPremiumSubscriptions: async () => page() };
    if (name === '@/services/financial/ledgerClient') {
      const invoke = async params => { purchases.push(structuredClone(params)); return { success: false, error: 'uncertain' }; };
      return { purchaseContent: invoke, subscribeToPlan: invoke };
    }
    if (name === '@/services/creatorPremiumViewerRuntime.mjs') return {};
    if (name === '@expo/vector-icons') return { MaterialCommunityIcons: 'Icon' };
    if (name === 'expo-image') return { Image: 'Image' };
    if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
    throw new Error(`Unexpected import ${name}`);
  }, {}, `\nexport { ${component} };`);
  const render = () => {
    cursor = 0; pending = []; tree = module[component]();
    for (const run of pending) run();
    return tree;
  };
  const settle = async () => { await new Promise(resolve => setImmediate(resolve)); if (mounted) render(); };
  const nodes = () => {
    const found = [];
    const walk = node => { if (!node || typeof node !== 'object') return; found.push(node);
      for (const child of [node.props?.children].flat(Infinity)) walk(child); };
    walk(tree); return found;
  };
  render(); await settle();
  return {
    alerts, purchases, generated, render, settle,
    press() { const action = nodes().find(node => node.type === 'Pressable' && node.props.disabled === false);
      assert.ok(action, 'charge action missing'); action.props.onPress(); },
    async confirm() { const dialog = alerts.findLast(args => args[2]?.some(button => button.text === 'Confirmar' || button.text === 'Renovar'));
      assert.ok(dialog, 'charge confirmation missing'); dialog[2].find(button => button.style !== 'cancel').onPress(); await settle(); },
    async refresh(value) { if (history) subscription = value; else next = value;
      const scroll = nodes().find(node => node.props?.refreshControl);
      assert.ok(scroll, 'refresh control missing'); scroll.props.refreshControl.props.onRefresh(); await settle(); },
    session(value) { user = value; render(); },
    unmount() { if (mounted) { mounted = false; for (const entry of effects) entry?.cleanup?.(); } },
  };
}

test('F3 foundation ships exactly one forward migration and no activation migration', () => {
  const names = readdirSync(new URL('../supabase/migrations/', import.meta.url))
    .filter(name => name.includes('_creator_premium_f3_'));
  assert.deepEqual(names, ['20261025011000_creator_premium_f3_bounded_financial_activation.sql']);
});

for (const operation of ['purchase', 'subscription', 'renewal', 'changed_offer', 'history_renewal', 'history_changed_plan']) test(`offer ${operation} requires exact projected consent before dispatch`, async () => {
  const projection = structuredClone(commerce);
  const purchasing = operation === 'purchase' || operation === 'changed_offer';
  const history = operation.startsWith('history_');
  projection.operations = purchasing ? { purchase_available: true, purchase_blocker: null } : projection.operations;
  if (purchasing) { projection.plans = []; projection.plan_count = 0; }
  else {
    const plan = projection.plans[0];
    plan.subscription_available = operation === 'subscription'; plan.renewal_available = operation === 'renewal' || history;
    plan.subscription_blocker = plan.subscription_available ? null : 'creator_premium_renewal_required';
    plan.renewal_blocker = plan.renewal_available ? null : 'creator_premium_subscription_not_found';
    if (plan.renewal_available) plan.relationship = { id: uuid(30), status: 'cancelled',
      cancelled_at: '2026-10-25T00:00:00Z', paid_through_at: '2026-10-26T00:00:00Z', access_state: 'expired' };
  }
  const subscription = { id: uuid(30), plan: projection.plans[0], creator: projection.creator,
    status: 'cancelled', started_at: '2026-09-26T00:00:00Z', cancelled_at: '2026-10-25T00:00:00Z', ended_at: null,
    period: { id: uuid(31), starts_at: '2026-09-26T00:00:00Z', paid_through_at: '2026-10-26T00:00:00Z', access_state: 'expired', gross_amount_bdag: '20.00000000' },
    access_active: false, auto_renew: false, renewal_supported: true, renewal_available: true, renewal_blocker: null,
    is_latest_relationship: true, created_at: '2026-09-26T00:00:00Z', updated_at: '2026-10-25T00:00:00Z' };
  if (history) finance.parseCreatorPremiumSubscriptionsPageV2({ policy, items: [subscription], next_cursor: null });
  else finance.parseCreatorPremiumCommerceV2(projection, id.content);
  const alerts = [], purchases = [];
  let stateIndex = 0;
  const jsx = (type, props) => ({ type, props });
  const hooks = { useState: initial => { const index = stateIndex++; return [history
    ? index === 0 ? [subscription] : index === 2 ? false : index === 7 ? policy : initial
    : index === 0 ? projection : index === 1 ? false : initial, () => {}]; },
    useRef: current => ({ current }), useCallback: fn => fn, useEffect() {}, useMemo: fn => fn() };
  const component = history ? 'MySubscriptionsScreenContent' : 'CreatorPremiumOfferScreenContent';
  const module = load(history ? 'app/my-subscriptions.tsx' : 'app/creator-premium-offer/[contentId].tsx', name => {
    if (name === 'react') return { ...hooks, default: hooks };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (name === 'react-native') return { Alert: { alert: (...args) => alerts.push(args) },
      StyleSheet: { create: styles => styles }, Pressable: 'Pressable', View: 'View', Text: 'Text', ScrollView: 'ScrollView' };
    if (name === 'expo-router') return { useLocalSearchParams: () => ({ contentId: id.content }), useRouter: () => ({}), useFocusEffect() {} };
    if (name === 'expo-crypto') return { randomUUID: () => id.key };
    if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
    if (name === '@/hooks/useAuth') return { useAuth: () => ({ user: { id: id.buyer } }) };
    if (name === '@/constants/theme') return { Colors: {}, FontSize: {}, FontWeight: {}, Radius: {}, Spacing: {} };
    if (name === '@/services/creatorPremiumIntegrationState') return { creatorPremiumErrorMessage: () => 'Safe error' };
    if (name === '@/services/creatorPremiumPresentation.mjs') return { formatCreatorPremiumBdag: text => `${text} BDAG` };
    if (name === '@/services/creatorPremiumService') return { CREATOR_PREMIUM_REPORT_REASONS: [], fetchCreatorPremiumCommerce: async () => projection };
    if (name === '@/services/financial/ledgerClient') { const invoke = async params => { purchases.push(params); return { success: false }; }; return { purchaseContent: invoke, subscribeToPlan: invoke }; }
    if (name === '@/services/creatorPremiumViewerRuntime.mjs') return {};
    if (name === '@expo/vector-icons') return { MaterialCommunityIcons: 'Icon' };
    if (name === 'expo-image') return { Image: 'Image' };
    if (name === 'expo-status-bar') return { StatusBar: 'StatusBar' };
    throw new Error(`Unexpected import ${name}`);
  }, {}, `\nexport { ${component} };`);
  const tree = module[component]();
  const nodes = [];
  const walk = node => { if (!node || typeof node !== 'object') return; nodes.push(node);
    const children = node.props?.children; for (const child of [children].flat(Infinity)) walk(child); };
  walk(tree);
  const button = nodes.find(node => node.type === 'Pressable' && node.props.disabled === false);
  assert.ok(button, 'purchase action missing');
  button.props.onPress();
  assert.equal(purchases.length, 0, 'purchase dispatched before consent');
  assert.match(alerts[0]?.[1] ?? '', purchasing ? /10\.00000000 BDAG/ : /20\.00000000 BDAG/);
  if (!purchasing) { assert.match(alerts[0][1], /30 días|periodo de 30 días/); assert.match(alerts[0][1], /manual.*automática/s); }
  if (operation === 'changed_offer') projection.offer.id = uuid(999);
  if (operation === 'history_changed_plan') subscription.plan.price_bdag = '99.00000000';
  const confirm = alerts[0][2].find(button => button.style !== 'cancel');
  confirm.onPress();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(structuredClone(purchases), ['changed_offer', 'history_changed_plan'].includes(operation) ? [] : [purchasing
    ? { contentId: id.content, offerVersionId: id.offer, idempotencyKey: id.key }
    : { planId: id.plan, idempotencyKey: id.key }]);
});

test('mobile accepts effective-disabled canary blockers with the unchanged five-key policy', () => {
  assert.deepEqual(finance.parseCreatorPremiumCommerce(commerce, id.content), commerce);
  assert.equal(Object.keys(finance.parseCreatorPremiumFinancePolicy(policy)).length, 5);
  for (const blocker of ['creator_premium_canary_denied', 'creator_premium_canary_expired', 'public', '', null]) {
    const invalid = structuredClone(commerce);
    invalid.operations.purchase_blocker = blocker;
    assert.throws(() => finance.parseCreatorPremiumCommerce(invalid, id.content), /creator_premium_commerce_invalid/);
  }
  for (const extra of [{ activation_mode: 'canary' }, { active_authorization_id: uuid(8) }]) {
    assert.throws(() => finance.parseCreatorPremiumFinancePolicy({ ...policy, ...extra }), /creator_premium_/);
  }
  const invalid = structuredClone(commerce);
  invalid.plans[0].subscription_blocker = 'creator_premium_canary_denied';
  assert.throws(() => finance.parseCreatorPremiumCommerce(invalid, id.content), /creator_premium_commerce_invalid/);
});

function consentFixture(operation) {
  const projection = structuredClone(commerce);
  const history = operation === 'history_renewal';
  projection.operations = { purchase_available: operation === 'purchase', purchase_blocker: operation === 'purchase' ? null : 'creator_premium_purchase_disabled' };
  if (operation === 'purchase') { projection.plans = []; projection.plan_count = 0; }
  else {
    Object.assign(projection.plans[0], { subscription_available: operation === 'subscription',
      subscription_blocker: operation === 'subscription' ? null : 'creator_premium_renewal_required',
      renewal_available: operation !== 'subscription',
      renewal_blocker: operation === 'subscription' ? 'creator_premium_subscription_not_found' : null,
      relationship: operation === 'subscription' ? null : { id: uuid(30), status: 'cancelled',
        cancelled_at: '2026-10-25T00:00:00Z', paid_through_at: '2026-10-26T00:00:00Z', access_state: 'expired' } });
  }
  const subscription = history ? { id: uuid(30), plan: projection.plans[0], creator: projection.creator,
    status: 'cancelled', started_at: '2026-09-26T00:00:00Z', cancelled_at: '2026-10-25T00:00:00Z', ended_at: null,
    period: { id: uuid(31), starts_at: '2026-09-26T00:00:00Z', paid_through_at: '2026-10-26T00:00:00Z', access_state: 'expired', gross_amount_bdag: '20.00000000' },
    access_active: false, auto_renew: false, renewal_supported: true, renewal_available: true, renewal_blocker: null,
    is_latest_relationship: true, created_at: '2026-09-26T00:00:00Z', updated_at: '2026-10-25T00:00:00Z' } : undefined;
  if (history) finance.parseCreatorPremiumSubscriptionsPageV2({ policy, items: [subscription], next_cursor: null });
  else finance.parseCreatorPremiumCommerceV2(projection, id.content);
  return { history, projection, subscription };
}

// Removing current-projection/generation checks or effect cleanup must expose a
// transport call after the user has consented to an obsolete screen or identity.
for (const operation of ['purchase', 'subscription', 'renewal', 'history_renewal']) {
  for (const invalidation of ['rerender', 'session', 'unmount']) {
    test(`${operation} pending consent cannot dispatch after ${invalidation}`, async () => {
      const fixture = consentFixture(operation);
      const screen = await consentScreen(fixture);
      screen.press();
      assert.equal(screen.purchases.length, 0);
      if (invalidation === 'rerender') {
        const changed = structuredClone(fixture.history ? fixture.subscription : fixture.projection);
        if (fixture.history) changed.plan.price_bdag = '99.00000000';
        else if (operation === 'purchase') changed.offer = { ...changed.offer, id: uuid(999), version: 2 };
        else changed.plans[0].price_bdag = '99.00000000';
        await screen.refresh(changed);
      } else if (invalidation === 'session') screen.session(null);
      else screen.unmount();
      await screen.confirm();
      assert.deepEqual(screen.purchases, [], 'obsolete confirmation crossed the transport boundary');
      screen.unmount();
    });
  }
}

for (const operation of ['purchase', 'subscription', 'history_renewal']) {
  test(`${operation} uncertain retry retains its key and changed immutable target rotates it`, async () => {
    const fixture = consentFixture(operation);
    const screen = await consentScreen(fixture);
    const charge = async () => { screen.press(); await screen.confirm(); };
    await charge();
    await charge();
    assert.equal(screen.purchases.length, 2);
    assert.equal(screen.purchases[0].idempotencyKey, screen.purchases[1].idempotencyKey);
    const changed = structuredClone(fixture.history ? fixture.subscription : fixture.projection);
    if (operation === 'purchase') changed.offer = { ...changed.offer, id: uuid(999), version: 2 };
    else if (fixture.history) changed.plan = { ...changed.plan, id: uuid(998), version: 2 };
    else changed.plans[0] = { ...changed.plans[0], id: uuid(998), version: 2 };
    await screen.refresh(changed);
    await charge();
    await charge();
    assert.equal(screen.purchases.length, 4);
    const [first, retry, rotated, rotatedRetry] = screen.purchases;
    assert.deepEqual(first, operation === 'purchase'
      ? { contentId: id.content, offerVersionId: id.offer, idempotencyKey: first.idempotencyKey }
      : { planId: id.plan, idempotencyKey: first.idempotencyKey });
    assert.deepEqual(retry, first);
    assert.deepEqual(rotated, operation === 'purchase'
      ? { contentId: id.content, offerVersionId: uuid(999), idempotencyKey: rotated.idempotencyKey }
      : { planId: uuid(998), idempotencyKey: rotated.idempotencyKey });
    assert.notEqual(rotated.idempotencyKey, first.idempotencyKey);
    assert.deepEqual(rotatedRetry, rotated);
    assert.ok(screen.generated.includes(first.idempotencyKey));
    assert.ok(screen.generated.includes(rotated.idempotencyKey));
    assert.equal(new Set(screen.generated).size, screen.generated.length);
    screen.unmount();
  });
}

test('F3 v2 parser accepts safe canary blockers without weakening the installed v1 contract', () => {
  assert.equal(typeof finance.parseCreatorPremiumCommerceV2, 'function', 'versioned canary commerce parser is missing');
  for (const blocker of ['creator_premium_canary_denied', 'creator_premium_canary_not_open',
    'creator_premium_canary_expired', 'creator_premium_canary_limit_reached']) {
    const projection = structuredClone(commerce);
    projection.operations.purchase_blocker = blocker;
    projection.plans[0].subscription_blocker = blocker;
    projection.plans[0].renewal_blocker = blocker;
    assert.deepEqual(finance.parseCreatorPremiumCommerceV2(projection, id.content), projection);
    assert.throws(() => finance.parseCreatorPremiumCommerce(projection, id.content), /creator_premium_commerce_invalid/);
  }
  const unknown = structuredClone(commerce);
  unknown.operations.purchase_blocker = 'creator_premium_canary_debug_private_actor';
  assert.throws(() => finance.parseCreatorPremiumCommerceV2(unknown, id.content), /creator_premium_commerce_invalid/);
});

test('F3 v2 subscription parser accepts capped renewal while v1 remains strict', () => {
  assert.equal(typeof finance.parseCreatorPremiumSubscriptionsPageV2, 'function', 'versioned subscription parser is missing');
  const relationship = { id: uuid(30), status: 'cancelled', cancelled_at: '2026-10-25T00:00:00Z',
    paid_through_at: '2026-10-26T00:00:00Z', access_state: 'expired' };
  const plan = { ...commerce.plans[0], relationship,
    subscription_blocker: 'creator_premium_renewal_required',
    renewal_blocker: 'creator_premium_canary_limit_reached' };
  const projection = { policy, items: [{
    id: relationship.id, creator: commerce.creator, plan, status: 'cancelled',
    started_at: '2026-09-26T00:00:00Z', cancelled_at: relationship.cancelled_at, ended_at: null,
    period: { id: uuid(31), starts_at: '2026-09-26T00:00:00Z', paid_through_at: relationship.paid_through_at,
      access_state: 'expired', gross_amount_bdag: '20.00000000' },
    access_active: false, auto_renew: false, renewal_supported: true,
    renewal_available: false, renewal_blocker: 'creator_premium_canary_limit_reached',
    is_latest_relationship: true, created_at: '2026-09-26T00:00:00Z', updated_at: relationship.cancelled_at,
  }], next_cursor: null };
  assert.deepEqual(finance.parseCreatorPremiumSubscriptionsPageV2(projection), projection);
  const acquired = structuredClone(projection);
  acquired.items[0].access_active = true;
  acquired.items[0].period.access_state = 'active';
  acquired.items[0].plan.relationship.access_state = 'active';
  acquired.items[0].plan.subscription_blocker = 'creator_premium_already_subscribed';
  assert.deepEqual(finance.parseCreatorPremiumSubscriptionsPageV2(acquired), acquired);
  assert.throws(() => finance.parseCreatorPremiumSubscriptionsPage(projection), /creator_premium_subscriptions_invalid/);
  const unknown = structuredClone(projection);
  unknown.items[0].renewal_blocker = 'private_debug_unknown';
  assert.throws(() => finance.parseCreatorPremiumSubscriptionsPageV2(unknown), /creator_premium_subscriptions_invalid/);
});

test('purchase client preserves the displayed immutable offer version in the gateway command', async () => {
  const invokes = [];
  const receipt = { receipt_id: uuid(10), content_id: id.content, financial_transaction_id: uuid(11),
    gross_amount_bdag: '10.00000000', platform_fee_bdag: '1.00000000', creator_net_bdag: '9.00000000',
    access_state: 'active', already_owned: false, money_moved: true, replayed: false };
  const api = load('services/financial/ledgerClient.ts', name => {
    if (name === '@/template') return { getSupabaseClient: () => ({ functions: {
      async invoke(name, options) { invokes.push({ name, body: structuredClone(options.body) });
        return { data: { success: true, data: receipt }, error: null }; },
    } }) };
    if (name === '@/services/walletApi') return { getWithdrawalConfigFromBackend: async () => ({ minimumBdag: 1 }) };
    if (name === '@/services/creatorPremiumFinanceContracts.mjs') return finance;
    if (name === '@supabase/supabase-js') return { FunctionsHttpError: class extends Error {} };
    throw new Error(`Unexpected import ${name}`);
  }, { crypto: { randomUUID: () => id.key } });
  const result = await api.purchaseContent({ contentId: id.content, offerVersionId: id.offer, idempotencyKey: id.key });
  assert.equal(result.success, true);
  assert.deepEqual(invokes, [{ name: 'bdag-ledger', body: {
    action: 'creator_premium_purchase', content_id: id.content,
    offer_version_id: id.offer, idempotency_key: id.key,
  } }]);
  for (const change of [{ offerVersionId: undefined }, { offerVersionId: 'bad' },
    { idempotencyKey: '' }, { idempotencyKey: null }, { idempotencyKey: 'bad' }, { price_bdag: '10.00000000' }]) {
    const rejected = await api.purchaseContent({ contentId: id.content, offerVersionId: id.offer, idempotencyKey: id.key, ...change });
    assert.equal(rejected.success, false);
    assert.equal(invokes.length, 1, 'invalid purchase crossed the transport boundary');
  }
});

function gateway() {
  let handler;
  const calls = [];
  const admin = { auth: { async getUser() { return { data: { user: { id: id.buyer } }, error: null }; } },
    async rpc(name, args) { calls.push({ name, args: structuredClone(args) }); return { data: { money_moved: false }, error: null }; } };
  load('supabase/functions/bdag-ledger/index.ts', name => {
    if (name.includes('@supabase/supabase-js')) return { createClient: () => admin };
    if (name.endsWith('/cors.ts')) return { corsHeaders: {} };
    throw new Error(`Unexpected import ${name}`);
  }, { Deno: { env: { get: () => 'synthetic-only' }, serve(fn) { handler = fn; } }, Request, Response });
  return { calls, async request(body) {
    const response = await handler(new Request('https://example.invalid', {
      method: 'POST', headers: { Authorization: 'Bearer synthetic-only', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));
    return { status: response.status, body: await response.json() };
  } };
}

test('gateway forwards the expected offer UUID and server-derived actor only', async () => {
  const api = gateway();
  const response = await api.request({ action: 'creator_premium_purchase', content_id: id.content,
    offer_version_id: id.offer, idempotency_key: id.key });
  assert.equal(response.status, 200);
  assert.deepEqual(api.calls, [{ name: 'purchase_creator_premium_content_v1', args: {
    p_buyer_id: id.buyer, p_content_id: id.content,
    p_offer_version_id: id.offer, p_idempotency_key: id.key,
  } }]);
});

test('gateway rejects a missing displayed offer before calling a money-moving RPC', async () => {
  const api = gateway();
  const response = await api.request({ action: 'creator_premium_purchase', content_id: id.content, idempotency_key: id.key });
  assert.equal(response.status, 400);
  assert.equal(api.calls.length, 0);
});

test('gateway rejects malformed offer identities and all client money/account authority', async () => {
  for (const fields of [
    { offer_version_id: 'bad' }, { amount: '10.00000000' }, { price_bdag: '10.00000000' },
    { platform_fee_bps: 0 }, { creator_id: id.creator }, { buyer_account_id: uuid(12) }, { extra: true },
  ]) {
    const api = gateway();
    const response = await api.request({ action: 'creator_premium_purchase', content_id: id.content,
      offer_version_id: id.offer, idempotency_key: id.key, ...fields });
    assert.equal(response.status, 400);
    assert.equal(api.calls.length, 0);
  }
});

// This is a separate read boundary: never widen the strict mobile policy or existing search response.
const activation = {
  mode: 'canary', authorization_id: uuid(20),
  charge_starts_at: '2026-10-25T00:00:00Z', charge_expires_at: '2026-10-25T00:30:00Z',
  refund_expires_at: '2026-10-25T01:00:00Z',
  operations: { purchase_enabled: true, subscription_enabled: true, refunds_enabled: true },
  limits: { purchase_count: 1, subscription_count: 1, refund_count: 1,
    purchase_amount_bdag: '10.00000000', subscription_amount_bdag: '20.00000000', gross_bdag: '30.00000000' },
  consumed: { purchase_count: 1, subscription_count: 0, refund_count: 0, gross_bdag: '10.00000000' },
  remaining: { purchase_count: 0, subscription_count: 1, refund_count: 1, gross_bdag: '20.00000000' },
};

function adminApi() {
  return load('apps/admin-web/src/lib/adminObservabilityApi.ts', name => {
    if (name === './supabase') return { supabase: { rpc: async () => ({ data: { activation }, error: null }) } };
    throw new Error(`Unexpected import ${name}`);
  });
}

test('Admin parses exact sanitized activation limits and consumption without discarding them', () => {
  const api = adminApi();
  assert.equal(typeof api.parseAdminCreatorPremiumFinanceActivation, 'function', 'separate authorized activation parser is required');
  assert.deepEqual(structuredClone(api.parseAdminCreatorPremiumFinanceActivation({ activation })), { activation });
});

test('Admin treats a pre-F3 missing activation as UNKNOWN during rollout', () => {
  const api = adminApi();
  assert.equal(typeof api.parseAdminCreatorPremiumFinanceActivation, 'function');
  assert.deepEqual(structuredClone(api.parseAdminCreatorPremiumFinanceActivation({})), { activation: null });
  const off = { mode: 'off', authorization_id: null, charge_starts_at: null, charge_expires_at: null,
    refund_expires_at: null, operations: { purchase_enabled: false, subscription_enabled: false, refunds_enabled: false },
    limits: { purchase_count: 0, subscription_count: 0, refund_count: 0, purchase_amount_bdag: '0.00000000', subscription_amount_bdag: '0.00000000', gross_bdag: '0.00000000' },
    consumed: { purchase_count: 0, subscription_count: 0, refund_count: 0, gross_bdag: '0.00000000' },
    remaining: { purchase_count: 0, subscription_count: 0, refund_count: 0, gross_bdag: '0.00000000' } };
  assert.deepEqual(structuredClone(api.parseAdminCreatorPremiumFinanceActivation({ activation: off })), { activation: off });
});

test('Admin rejects public mode, malformed amounts, invalid windows, overconsumption and private fields', () => {
  const api = adminApi();
  assert.equal(typeof api.parseAdminCreatorPremiumFinanceActivation, 'function');
  const invalid = [
    { ...activation, mode: 'public' },
    { ...activation, authorization_id: null },
    { ...activation, operations: { ...activation.operations, purchase_enabled: 'true' } },
    { ...activation, charge_starts_at: 'tomorrow' },
    { ...activation, charge_expires_at: '2026-10-24T23:59:59Z' },
    { ...activation, charge_expires_at: '2026-10-25T02:00:00Z' },
    { ...activation, refund_expires_at: '2026-10-24T23:59:59Z' },
    { ...activation, refund_expires_at: '2026-10-27T00:00:00Z' },
    { ...activation, limits: { ...activation.limits, gross_bdag: 30 } },
    { ...activation, limits: { ...activation.limits, purchase_amount_bdag: '1e1' } },
    { ...activation, consumed: { ...activation.consumed, purchase_count: 2 } },
    { ...activation, consumed: { ...activation.consumed, purchase_count: 0.5 } },
    { ...activation, consumed: { ...activation.consumed, purchase_count: Number.MAX_SAFE_INTEGER + 1 } },
    { ...activation, consumed: { ...activation.consumed, gross_bdag: '0.00000000' }, remaining: { ...activation.remaining, gross_bdag: '30.00000000' } },
    { ...activation, remaining: { ...activation.remaining, gross_bdag: '30.00000000' } },
    { ...activation, buyer_account_id: uuid(21) },
    { ...activation, mode: 'off' },
  ];
  for (const value of invalid) {
    assert.throws(() => api.parseAdminCreatorPremiumFinanceActivation({ activation: value }), /activation|inválida/i);
  }
});
