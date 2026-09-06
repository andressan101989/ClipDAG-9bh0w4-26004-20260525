import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { runInNewContext } from 'node:vm';
const root = new URL('../', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8').replace(/\r\n/g, '\n');
const history = readdirSync(new URL('supabase/migrations/', root)).filter(n => n.endsWith('.sql')).sort().map(n => read(`supabase/migrations/${n}`));
function body(name) {
  const marker = `create or replace function ${name}(`;
  const source = history.findLast(s => s.includes(marker));
  if (!source) return '';
  const start = source.lastIndexOf(marker);
  return source.slice(start, source.indexOf('\n$$;', start) + 4);
}
const record = body('private.record_live_battle_score_locked');
const reconcile = body('private.reconcile_live_battle_score_locked');
const likes = body('public.send_live_battle_likes');
for (const [cost, expected] of [[1, 10], [5, 50]]) test(`new rule: gift ${cost} coins produces ${expected} base points`, () => {
  // Read the actual SQL recorder's arithmetic, not a duplicate scoring helper.
  const expression = record.match(/v_awarded_points := ([^;]+);/)[1];
  const factor = expression.includes('v_rules.gift_points_per_coin') ? 10 : 1;
  assert.equal(cost * factor, expected);
  assert.match(body('private.live_battle_score_event_contract_is_valid'), /p_gift\.amount_coins::bigint \* v_rule\.gift_points_per_coin/);
});
test('likes have a server-authoritative competitive journal', () => {
  assert.match(likes, /insert into public\.live_battle_like_score_events/);
  assert.match(likes, /auth\.uid\(\)/);
  assert.doesNotMatch(likes, /atomic_ledger_transfer|send_live_gift|send_live_battle_gift|advance_live_battle_rose/);
});
test('per-viewer cap is checked under the canonical Battle lock', () => {
  assert.match(likes, /for update;/);
  assert.match(likes, /sum\(event\.accepted_count\)/);
  assert.match(likes, /v_rules\.max_scoreable_likes_per_viewer - v_used/);
});
test('like replay precedes mutable active-state validation', () => {
  assert.ok(likes.includes('v_existing.id') && likes.indexOf('v_existing.id') < likes.indexOf("v_battle.status = 'active'"));
  assert.match(likes, /live_battle_like_idempotency_conflict/);
});
test('canonical reconciliation includes likes before deciding the winner', () => {
  assert.ok(reconcile.includes('public.live_battle_like_score_events'));
  assert.ok(reconcile.indexOf('public.live_battle_like_score_events') < reconcile.indexOf("v_battle.status = 'completed'"));
});

function loadBatcher() {
  const exports = {};
  const timers = new Map();
  let next = 0;
  const output = ts.transpileModule(read('services/liveBattleLikeBatcher.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(output, { exports, setTimeout: fn => { timers.set(++next, fn); return next; }, clearTimeout: id => timers.delete(id) });
  return { ...exports, timers };
}
test('rapid hearts batch with strict payload bounds and new keys after success', async () => {
  const { LiveBattleLikeBatcher, timers } = loadBatcher();
  const calls = []; let key = 0, confirmations = 0;
  const queue = new LiveBattleLikeBatcher(async batch => { calls.push({ ...batch }); return { accepted_count: 0, awarded_points: 0 }; }, () => confirmations++, () => `key-${++key}`);
  for (let i = 0; i < 21; i++) queue.add();
  assert.equal(calls.length, 0);
  assert.equal(timers.size, 1);
  await queue.flush(); await queue.flush();
  assert.deepEqual(calls, [{ count: 16, idempotencyKey: 'key-1' }, { count: 5, idempotencyKey: 'key-2' }]);
  assert.equal(confirmations, 2);
  assert.equal(timers.size, 0);
});
test('ambiguous failure preserves count and key; in-flight double flush cannot duplicate', async () => {
  const { LiveBattleLikeBatcher } = loadBatcher();
  const calls = []; let fail = true, release;
  const queue = new LiveBattleLikeBatcher(async batch => { calls.push({ ...batch }); if (fail) throw Error('network'); await new Promise(resolve => { release = resolve; }); }, () => {});
  queue.add(); queue.add(); await queue.flush();
  fail = false;
  const flight = queue.flush(); await queue.flush();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  release(); await flight;
});
test('closed context drains its original batch without updating the unmounted screen', async () => {
  const { LiveBattleLikeBatcher } = loadBatcher();
  const calls = []; let confirmed = 0;
  const queue = new LiveBattleLikeBatcher(async batch => calls.push(batch), () => confirmed++);
  queue.add(); queue.close(); queue.add();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(calls.length, 1); assert.equal(calls[0].count, 1); assert.equal(confirmed, 0);
});
test('terminal authorization rejection stops retries without surfacing intrusive feedback', async () => {
  const { LiveBattleLikeBatcher, LikeBatchRejectedError, timers } = loadBatcher();
  const queue = new LiveBattleLikeBatcher(async () => { throw new LikeBatchRejectedError('rejected'); }, () => assert.fail('not confirmed'));
  queue.add(); await queue.flush(); assert.equal(timers.size, 0);
});
const watch = read('app/live/watch/[streamId].tsx');
const watchAst = ts.createSourceFile('watch.tsx', watch, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let reaction;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(watchAst) === 'sendReaction') reaction = node.initializer.arguments[0].getText(watchAst);
  ts.forEachChild(node, visit);
}
visit(watchAst);
function reactionHarness(status, actor = 'viewer') {
  const trace = []; let release;
  const env = {
    streamId: 'session', user: { id: actor }, battleState: status === null ? null : { status, localHostUserId: 'host', opponentHostUserId: 'rival' },
    likeBatcherRef: { current: { add: () => trace.push('batch') } }, addFloatingReaction: () => trace.push('animation'), getDisplayUsername: () => 'fixture',
    lastReactionAtRef: { current: 0 }, seenReactionEventIdsRef: { current: new Set() }, rememberSeenReactionEvent() {},
    emitLiveReaction: () => { trace.push('visual-rpc'); return new Promise(resolve => { release = resolve; }); }, console: { warn() {} },
  };
  const js = ts.transpileModule(`const send = ${reaction};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return { trace, send: Function(...Object.keys(env), js + '; return send;')(...Object.values(env)), release: () => release?.({ id: 'visual-event' }) };
}
test('Battle heart animates immediately before either network confirmation or batch transport', async () => {
  const h = reactionHarness('active'); const flight = h.send('❤️');
  assert.deepEqual(h.trace, ['animation', 'batch', 'visual-rpc']);
  h.release(); await flight; assert.equal(h.trace.filter(x => x === 'animation').length, 1);
});
for (const [label, status, actor] of [['ordinary LIVE', null, 'viewer'], ['countdown', 'countdown', 'viewer'], ['postround', 'completed', 'viewer'], ['local host', 'active', 'host'], ['opponent host', 'active', 'rival']]) {
  test(`${label} preserves visual reactions without requesting points`, async () => {
    const h = reactionHarness(status, actor); const flight = h.send('❤️'); h.release(); await flight;
    assert.deepEqual(h.trace, ['visual-rpc', 'animation']);
  });
}
test('cap exhaustion cannot disable animations or calculate competitive points in React Native', () => {
  assert.doesNotMatch(reaction, /accepted_count|awarded_points|like_points|score\s*[+*=]|wallet/);
  const service = read('services/liveBattleLikesService.ts');
  assert.match(service, /rpc\('send_live_battle_likes'/);
  assert.doesNotMatch(service, /send_live_gift|send_live_battle_gift|atomic_ledger_transfer|p_target_user_id|p_points|p_multiplier/);
  assert.match(watch, /sendLiveGiftForContext/);
  assert.match(watch, /\(\) => \{ void battleProjection\.reconcile\(\); \}/);
  assert.match(service, /auth\.session\?\.user\.id !== actorId/);
});
test('effect remount creates a live queue after cleanup instead of reusing a closed one', () => {
  let effect;
  function find(node) {
    if (ts.isCallExpression(node) && node.expression.getText(watchAst) === 'useEffect'
      && node.arguments[0]?.getText(watchAst).includes('new LiveBattleLikeBatcher')) effect = node.arguments[0].getText(watchAst);
    ts.forEachChild(node, find);
  }
  find(watchAst); assert.ok(effect);
  const env = { streamId: 'session', user: { id: 'viewer' }, battleState: { battleId: 'battle' },
    battleProjection: { reconcile() {} }, sendLiveBattleLikes() {}, likeBatcherRef: { current: null },
    LiveBattleLikeBatcher: class { closed = false; close() { this.closed = true; } } };
  const js = ts.transpileModule(`const setup = ${effect};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const setup = Function(...Object.keys(env), js + '; return setup;')(...Object.values(env));
  const cleanup = setup(); const first = env.likeBatcherRef.current; cleanup();
  assert.equal(first.closed, true); assert.equal(env.likeBatcherRef.current, null);
  const secondCleanup = setup(); assert.notEqual(env.likeBatcherRef.current, first);
  assert.equal(env.likeBatcherRef.current.closed, false); secondCleanup();
});
