import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sql = read('supabase/migrations/20260906053652_live_battle_gift_like_scoring.sql');
const rpc = sql.split('create or replace function public.send_live_battle_likes(')[1].split('\n$$;')[0];
function harness(send) {
  const exports = {}, timers = new Map(); let next = 0, keys = 0, confirmations = 0;
  runInNewContext(ts.transpileModule(read('services/liveBattleLikeBatcher.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, setTimeout: (fn, delay) => { timers.set(++next, { fn, delay }); return next; }, clearTimeout: id => timers.delete(id) });
  const calls = [];
  const queue = new exports.LiveBattleLikeBatcher(async batch => { calls.push({ ...batch }); return send(batch, exports); }, () => confirmations++, () => `key-${++keys}`);
  return { queue, timers, calls, confirmations: () => confirmations, tick: async () => { const [id, task] = timers.entries().next().value; timers.delete(id); task.fn(); await settle(); } };
}
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
const full = batch => ({ accepted_count: batch.count, awarded_points: batch.count * 5 });
test('zero receipts cannot persist: table enforces strictly positive quantities and points', () => {
  assert.match(sql, /accepted_count integer not null check \(accepted_count between 1 and requested_count\)/);
  assert.match(sql, /like_points integer not null check \(like_points between 1 and 1000\)/);
  assert.match(sql, /awarded_points bigint not null check \(awarded_points > 0 and awarded_points = accepted_count::bigint \* like_points\)/);
});
test('post-cap and other zero outcomes return before the only journal insert and reconciliation', () => {
  const guard = rpc.match(/if v_accepted = 0 then\s+return query select 0, 0::bigint;\s+return;\s+end if;/);
  assert.ok(guard, 'missing terminal zero return');
  assert.ok(guard.index < rpc.indexOf('insert into public.live_battle_like_score_events'));
  assert.equal(rpc.match(/insert into public.live_battle_like_score_events/g).length, 1);
  assert.ok(rpc.indexOf('v_existing.id') < rpc.indexOf('v_session.host_id'));
});
for (const accepted of [0, 2]) test(`receipt ${accepted}/5 permanently stops scoring and clears queue/timers`, async () => {
  const h = harness(() => ({ accepted_count: accepted, awarded_points: accepted * 5 }));
  for (let i = 0; i < 5; i++) h.queue.add();
  await h.queue.flush(); for (let i = 0; i < 50; i++) h.queue.add(); await h.queue.flush();
  assert.equal(h.calls.length, 1); assert.equal(h.timers.size, 0);
});
test('terminal rejection discards queued work and disables future add', async () => {
  const h = harness((batch, { LikeBatchRejectedError }) => { throw new LikeBatchRejectedError('terminal'); });
  for (let i = 0; i < 40; i++) h.queue.add(); await h.queue.flush();
  assert.equal(h.timers.size, 0); h.queue.add(); await h.queue.flush();
  assert.equal(h.calls.length, 1); assert.equal(h.confirmations(), 0);
});
test('ambiguous mounted failure retries the identical key/count with backoff', async () => {
  let fail = true; const h = harness(batch => { if (fail) throw Error('network'); return full(batch); });
  h.queue.add(); h.queue.add(); await h.queue.flush();
  assert.equal([...h.timers.values()][0].delay, 1000); fail = false; await h.tick();
  assert.deepEqual(h.calls[1], h.calls[0]); assert.equal(h.timers.size, 0); assert.equal(h.confirmations(), 1);
});
test('ambiguous failure followed by close cancels all retries and handles', async () => {
  const h = harness(() => { throw Error('network'); }); h.queue.add(); await h.queue.flush();
  h.queue.close(); await settle();
  assert.equal(h.timers.size, 0); const count = h.calls.length;
  h.queue.add(); await h.queue.flush(); h.queue.close(); await settle();
  assert.equal(h.calls.length, count); assert.ok(count <= 2); assert.equal(h.confirmations(), 0);
});
for (const reject of [false, true]) test(`close in flight (reject=${reject}) cannot send queued batches or notify UI`, async () => {
  let resolve, fail, calls = 0;
  const h = harness(batch => ++calls === 1 ? new Promise((a, b) => { resolve = a; fail = b; }) : full(batch));
  h.queue.add(); const flight = h.queue.flush(); for (let i = 0; i < 30; i++) h.queue.add();
  h.queue.close(); assert.equal(h.timers.size, 0);
  if (reject) fail(Error('network')); else resolve({ accepted_count: 1, awarded_points: 5 });
  await flight; await settle(); h.queue.add(); await h.queue.flush();
  assert.equal(h.calls.length, 1); assert.equal(h.confirmations(), 0); assert.equal(h.timers.size, 0);
});
test('close flushes at most one bounded pending batch, without follow-up timers', async () => {
  const h = harness(full); for (let i = 0; i < 40; i++) h.queue.add();
  h.queue.close(); h.queue.close(); await settle(); await h.queue.flush();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].count, 16); assert.equal(h.timers.size, 0); assert.equal(h.confirmations(), 0);
});
test('exact cap allows at most one subsequent zero response', async () => {
  let used = 0; const h = harness(batch => { const accepted = Math.min(batch.count, 20 - used); used += accepted; return { accepted_count: accepted, awarded_points: accepted * 5 }; });
  for (let i = 0; i < 100; i++) { h.queue.add(); await h.queue.flush(); }
  assert.equal(used, 20); assert.equal(h.calls.length, 21); assert.equal(h.timers.size, 0);
});
test('actual heart callback keeps immediate animation after scoring is disabled', async () => {
  const source = read('app/live/watch/[streamId].tsx');
  const ast = ts.createSourceFile('watch.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let reaction;
  function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'sendReaction') reaction = node.initializer.arguments[0].getText(ast); ts.forEachChild(node, visit); }
  visit(ast); assert.ok(reaction);
  const h = harness(() => ({ accepted_count: 0, awarded_points: 0 }));
  let animations = 0;
  const env = { streamId: 'session', user: { id: 'viewer' }, battleState: { status: 'active', localHostUserId: 'host', opponentHostUserId: 'rival' },
    likeBatcherRef: { current: h.queue }, addFloatingReaction: () => animations++, getDisplayUsername: () => 'fixture',
    lastReactionAtRef: { current: 0 }, seenReactionEventIdsRef: { current: new Set() }, rememberSeenReactionEvent() {},
    emitLiveReaction: async () => ({ id: 'visual' }), console: { warn() {} } };
  const js = ts.transpileModule(`const send = ${reaction};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const send = Function(...Object.keys(env), js + '; return send;')(...Object.values(env));
  await send('\u2764\ufe0f'); await h.queue.flush();
  for (let i = 0; i < 25; i++) await send('\u2764\ufe0f');
  await h.queue.flush(); assert.equal(animations, 26); assert.equal(h.calls.length, 1); assert.equal(h.timers.size, 0);
});
