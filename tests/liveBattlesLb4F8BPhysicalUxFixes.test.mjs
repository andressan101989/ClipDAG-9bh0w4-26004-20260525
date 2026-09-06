import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Red against c03f611 before UI edits: 14 tests, 6 pass, 8 fail, 0 cancelled/skipped/todo.
// Failed: keyboard stacking, root passthrough, visual passthrough, localized zIndex,
// countdown, completed postround, rematch routing, and normalized Battle feedback.
// Command: node --test --test-reporter=tap tests/liveBattlesLb4F8BPhysicalUxFixes.test.mjs

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const stage = read('components/live/LiveBattleStage.tsx');
const watch = read('app/live/watch/[streamId].tsx');
const broadcast = read('app/live/broadcast/[streamId].tsx');
const parse = source => ts.createSourceFile('fixture.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const ast = parse(stage);
function nodes(root, predicate) {
  const found = [];
  function visit(node) { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); }
  visit(root);
  return found;
}
const openings = nodes(ast, n => ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n));
const attr = (node, name) => node.attributes.properties.find(p => p.name?.text === name)?.initializer;
const panel = name => {
  const matches = openings.filter(n => attr(n, 'style')?.getText(ast).match(new RegExp(`\\bstyles\\.${name}\\b`)));
  assert.equal(matches.length, 1, `unique ${name} panel`);
  return matches[0];
};
function styleZ(source, name) {
  const tree = parse(source);
  const styleCall = nodes(tree, n => ts.isCallExpression(n) && n.expression.getText(tree) === 'StyleSheet.create');
  assert.equal(styleCall.length, 1);
  const style = styleCall[0].arguments[0].properties.find(p => p.name?.getText(tree) === name);
  assert.ok(style, `style ${name} exists`);
  return Number(style.initializer.properties.find(p => p.name?.getText(tree) === 'zIndex')?.initializer.getText(tree) ?? 0);
}
const pointer = node => attr(node, 'pointerEvents')?.text ?? 'auto';
function assertTouchable(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isJsxElement(parent)) assert.ok(!['none', 'box-only'].includes(pointer(parent.openingElement)), 'ancestor passes child touches');
  }
}

test('rematch and glove stage is above both full-screen keyboard dismiss layers', () => {
  for (const source of [watch, broadcast]) {
    assert.ok(styleZ(stage, 'root') > styleZ(source, 'keyboardDismissLayer'), 'stage must win the keyboard layer hit test');
    assert.match(source, /<LiveBattleStage[\s\S]*style=\{styles\.keyboardDismissLayer\}/);
  }
});
test('full-screen stage passes empty-area touches through', () => {
  assert.equal(pointer(panel('root')), 'box-none');
  assert.equal(pointer(panel('battlePanel')), 'box-none');
});
test('visual panels and video surfaces cannot intercept control touches', () => {
  for (const name of ['panels', 'identityRow', 'balanceRow', 'powerRow', 'statusRow', 'centerDivider']) {
    assert.equal(pointer(panel(name)), 'none', name);
  }
  assert.match(read('components/live/LiveBattleViewerHUD.tsx'), /<View pointerEvents="none" style=\{\[styles\.root/);
});
test('real rematch, accept, reject and glove handlers remain reachable', () => {
  const expected = ['onActivateGlove', '() => runSeriesAction(onRequestRematch)', '() => runSeriesAction(onAcceptRematch)', '() => runSeriesAction(onRejectRematch)'];
  const controls = openings.filter(n => n.tagName.getText(ast) === 'Pressable');
  assert.deepEqual(controls.map(n => attr(n, 'onPress').expression.getText(ast)), expected);
  for (const control of controls) assertTouchable(control);
  const run = nodes(ast, n => ts.isVariableDeclaration(n) && n.name.getText(ast) === 'runSeriesAction')[0];
  const js = ts.transpileModule(`const run = ${run.initializer.getText(ast)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let calls = 0;
  Function(`${js}; return run;`)()(() => { calls++; return Promise.resolve(); });
  assert.equal(calls, 1);
});
test('localized stacking preserves header, chat and composer priority', () => {
  for (const [source, chat] of [[watch, 'bottomSection'], [broadcast, 'chatArea']]) {
    for (const name of ['header', chat, 'inputRow']) assert.ok(styleZ(source, name) > styleZ(stage, 'root'), name);
  }
  assert.equal(styleZ(stage, 'root'), 3);
});

// Execute the actual screen callback and existing service, with only network/UI stubs.
const watchAst = parse(watch);
const callback = nodes(watchAst, n => ts.isVariableDeclaration(n) && n.name.getText(watchAst) === 'sendRealGift')[0].initializer.arguments[0];
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const serviceCode = compile(read('services/liveGiftsService.ts'));
const callbackCode = compile(`const send = ${callback.getText(watchAst)};`);
const sessionId = '20000000-0000-4000-8000-000000000001';
const battleId = '30000000-0000-4000-8000-000000000001';
const userId = '10000000-0000-4000-8000-000000000001';
const gift = { id: 'rose', name: 'Rosa', priceBdag: 5 };
function harness(status, rpcResult) {
  const calls = [], feedback = [];
  const module = { exports: {} };
  const rpc = async (name, args) => {
    calls.push({ name, args });
    if (rpcResult) return rpcResult();
    return { data: { transaction_id: '40000000-0000-4000-8000-000000000001', battle_id: battleId, target_session_id: sessionId, receiver_user_id: userId, gift_id: 'rose', amount_coins: 5, new_sender_balance: 95 }, error: null };
  };
  Function('require', 'exports', 'module', serviceCode)(name => {
    assert.equal(name, '@/template'); return { getSupabaseClient: () => ({ rpc }) };
  }, module.exports, module);
  let reconciles = 0;
  const env = {
    streamId: sessionId, user: { id: userId }, giftsEnabled: true, walletBalance: 100,
    sendingGiftRef: { current: false }, pendingGiftAttemptRef: { current: null },
    battleState: status === null ? null : { status, battleId, localHostUserId: userId },
    setSendingGiftId() {}, setWalletBalance() {}, setWalletBalanceError() {}, setGiftSheetVisible() {},
    showGiftFeedback: message => feedback.push(message),
    battleProjection: { reconcile() { reconciles++; } },
    sendLiveGiftForContext: module.exports.sendLiveGiftForContext,
    console: { warn() {} },
  };
  const send = Function(...Object.keys(env), `${callbackCode}; return send;`)(...Object.values(env));
  return { send: () => send(gift), calls, feedback, env, reconciles: () => reconciles };
}
for (const [label, status, expected] of [
  ['active round', 'active', 'send_live_battle_gift'],
  ['countdown', 'countdown', 'send_live_gift'],
  ['completed postround', 'completed', 'send_live_gift'],
  ['completed rematch window', 'completed', 'send_live_gift'],
  ['ordinary LIVE', null, 'send_live_gift'],
]) test(`${label} invokes exactly ${expected}`, async () => {
  const h = harness(status);
  if (label.includes('rematch')) h.env.battleState.series = { status: 'active', rematchRequestStatus: 'pending' };
  await h.send();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].name, expected);
  assert.equal(h.reconciles(), expected === 'send_live_battle_gift' ? 1 : 0);
  assert.doesNotMatch(JSON.stringify(h.calls), /price|cost|score|points|multiplier|fee/);
});
test('known Battle errors display service-normalized safe messages', async () => {
  for (const [code, message] of [
    ['live_battle_gift_not_active', 'La Battle ya no acepta regalos'],
    ['live_battle_gift_target_invalid', 'Destinatario Battle no disponible'],
    ['insufficient balance', 'Saldo BDAG insuficiente'],
  ]) {
    const h = harness('active', () => ({ error: { message: code } }));
    await h.send();
    assert.deepEqual(h.feedback, [message]);
    assert.equal(h.calls.length, 1, 'no fallback transfer on rejection');
    assert.equal(h.reconciles(), 0);
  }
});
test('unknown RPC errors and exceptions never reach visible feedback', async () => {
  const secret = 'internal PostgreSQL detail token=DO_NOT_DISPLAY';
  for (const status of ['active', null]) for (const throws of [false, true]) {
    const h = harness(status, () => { if (throws) throw new Error(secret); return { error: { message: secret } }; });
    await h.send();
    assert.equal(h.feedback.length, 1);
    assert.doesNotMatch(h.feedback[0], /PostgreSQL|DO_NOT_DISPLAY|token=/);
    assert.equal(h.calls.length, 1);
  }
});
test('double taps stay single-flight and failed retries retain their key', async () => {
  let release;
  const h = harness('active', () => new Promise(resolve => { release = resolve; }));
  const first = h.send();
  await h.send();
  assert.equal(h.calls.length, 1);
  release({ error: { message: 'live_battle_gift_not_active' } });
  await first;
  const retry = h.send();
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].args.p_idempotency_key, h.calls[1].args.p_idempotency_key);
  release({ error: { message: 'live_battle_gift_not_active' } });
  await retry;
});
test('economic authority, gross score, multipliers and roses remain byte-identical', () => {
  const migration = read('supabase/migrations/20260905230823_live_gift_platform_commission_35.sql').replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(migration).digest('hex'), '63a1baa0a7ae9c29c55caa08ffc3a3bb1fa1f9ab5d806d3094ebc295a3058d89');
  assert.doesNotMatch(callback.getText(watchAst), /atomic_ledger_transfer|\.rpc\(|set(?:Battle)?Score|setRoseProgress/);
});
