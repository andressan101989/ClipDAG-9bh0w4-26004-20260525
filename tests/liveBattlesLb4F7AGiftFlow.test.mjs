import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const read = relative => readFile(new URL(relative, root), 'utf8');
const [watchSource, giftServiceSource, giftSheetSource, f4a, f4b, f4da, f4db] = await Promise.all([
  read('app/live/watch/[streamId].tsx'),
  read('services/liveGiftsService.ts'),
  read('components/live/gifts/LiveGiftSheet.tsx'),
  read('supabase/migrations/20260829225002_live_battles_lb4_f4a_directed_gifts.sql'),
  read('supabase/migrations/20260830030845_live_battles_lb4_f4b_score_outcome.sql'),
  read('supabase/migrations/20260830053531_live_battles_lb4_f4d_a_power_engine.sql'),
  read('supabase/migrations/20260830162244_live_battles_lb4_f4d_b_power_projection.sql'),
]);

function loadGiftService(rpc) {
  const compiled = ts.transpileModule(giftServiceSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    reportDiagnostics: true,
  });
  assert.deepEqual((compiled.diagnostics ?? []).filter(item => item.category === 1), []);
  const module = { exports: {} };
  const require = name => {
    if (name === '@/template') return { getSupabaseClient: () => ({ rpc }) };
    throw new Error(`unexpected import: ${name}`);
  };
  Function('require', 'module', 'exports', compiled.outputText)(require, module, module.exports);
  return module.exports;
}

const temp = await mkdtemp(path.join(tmpdir(), 'clipdag-f7a-'));
after(() => rm(temp, { recursive: true, force: true }));
async function compilePure(relative) {
  const output = ts.transpileModule(await read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const destination = path.join(temp, path.basename(relative).replace(/\.ts$/, '.js'));
  await writeFile(destination, output);
  return destination;
}
await compilePure('components/live/gifts/giftPresentationContract.ts');
await compilePure('components/live/gifts/giftAnimationResolver.ts');
const queuePath = await compilePure('components/live/gifts/giftPresentationQueue.ts');
const pureRequire = createRequire(queuePath);
const contract = pureRequire('./giftPresentationContract.js');
const { GiftPresentationQueue } = pureRequire('./giftPresentationQueue.js');

const sessionId = '20000000-0000-4000-8000-000000000001';
const battleId = '30000000-0000-4000-8000-000000000001';
const targetUserId = '10000000-0000-4000-8000-000000000001';
const transactionId = '40000000-0000-4000-8000-000000000001';

test('active Battle context invokes only the directed Battle RPC with no client price or score', async () => {
  const calls = [];
  const service = loadGiftService(async (name, args) => {
    calls.push({ name, args });
    return { data: {
      transaction_id: transactionId, battle_id: battleId, target_session_id: sessionId,
      receiver_user_id: targetUserId, gift_id: 'rose', emoji: '🌹', amount_coins: 5,
      creator_amount_coins: 5, new_sender_balance: 95,
    }, error: null };
  });
  const result = await service.sendLiveGiftForContext({
    sessionId, giftId: 'rose', idempotencyKey: 'stable-attempt',
    battle: { battleId, targetUserId },
  });
  assert.equal(result.success, true);
  assert.deepEqual(calls, [{ name: 'send_live_battle_gift', args: {
    p_battle_id: battleId, p_target_user_id: targetUserId,
    p_gift_id: 'rose', p_idempotency_key: 'stable-attempt',
  } }]);
  assert.doesNotMatch(JSON.stringify(calls), /price|cost|score|points|multiplier/i);
});

test('ordinary LIVE context preserves the original live gift authority', async () => {
  const calls = [];
  const service = loadGiftService(async (name, args) => {
    calls.push({ name, args });
    return { data: { transaction_id: transactionId, gift_id: 'rose', emoji: '🌹', amount_coins: 5, new_sender_balance: 95 }, error: null };
  });
  assert.equal((await service.sendLiveGiftForContext({
    sessionId, giftId: 'rose', idempotencyKey: 'live-attempt', battle: null,
  })).success, true);
  assert.deepEqual(calls, [{ name: 'send_live_gift', args: {
    p_session_id: sessionId, p_gift_id: 'rose', p_idempotency_key: 'live-attempt',
  } }]);
});

test('viewer connects the canonical Battle projection to the shared service router', () => {
  assert.match(watchSource, /sendLiveGiftForContext/);
  assert.match(watchSource, /battleContext = battleState[\s\S]*battleId: battleState\.battleId[\s\S]*targetUserId: battleState\.localHostUserId/);
  assert.match(watchSource, /battle:\s*battleContext/);
  assert.doesNotMatch(watchSource, /set(?:Battle)?Score|setRoseProgress|score\s*[+]=|roseProgress\s*[+]=/);
});

test('successful send closes the native modal, confirms outside it, and reconciles authority', () => {
  const start = watchSource.indexOf('const sendRealGift');
  const end = watchSource.indexOf('const shareLive', start);
  const callback = watchSource.slice(start, end);
  const failure = callback.indexOf('if (!result.success)');
  const failureReturn = callback.indexOf('return;', failure);
  const close = callback.indexOf('setGiftSheetVisible(false)', failure);
  assert.ok(failure >= 0 && failureReturn > failure && close > failureReturn);
  assert.match(callback.slice(failure, failureReturn), /showGiftFeedback/);
  assert.doesNotMatch(callback.slice(failure, failureReturn), /setGiftSheetVisible\(false\)/);
  assert.match(callback.slice(close), /battleProjection\.reconcile\(\)/);
  assert.match(watchSource, /giftFeedback && !giftSheetVisible/);
  assert.match(giftSheetSource, /<Modal[\s\S]*presentationStyle="overFullScreen"/);
});

test('single-flight blocks double taps and ambiguous retries reuse one idempotency key', () => {
  const start = watchSource.indexOf('const sendRealGift');
  const end = watchSource.indexOf('const shareLive', start);
  const callback = watchSource.slice(start, end);
  assert.match(callback, /if \(sendingGiftRef\.current\) return/);
  assert.match(callback, /pendingGiftAttemptRef\.current\?\.fingerprint !== fingerprint/);
  assert.equal((callback.match(/pendingGiftAttemptRef\.current = null/g) ?? []).length, 1);
  assert.ok(callback.indexOf('pendingGiftAttemptRef.current = null') > callback.indexOf('if (!result.success)'));
  assert.match(callback, /finally[\s\S]*sendingGiftRef\.current = false/);
});

test('a production-shaped rose event normalizes and presents exactly once', () => {
  const now = new Date().toISOString();
  const row = {
    id: '50000000-0000-4000-8000-000000000001', session_id: sessionId,
    actor_user_id: '10000000-0000-4000-8000-000000000003', event_type: 'reaction', created_at: now,
    payload: {
      gift_real: true, gift_visual: true, battle_gift: true,
      transaction_id: transactionId, battle_id: battleId, session_id: sessionId,
      recipient_user_id: targetUserId, gift_id: 'rose', gift_name: 'Rosa',
      icon: '🌹', amount_coins: 5, category: 'basic', animation_type: 'floating',
      duration_ms: 1900, priority: 2, created_at: now,
    },
  };
  const event = contract.liveGiftEventFromPayload(row, sessionId);
  assert.ok(event);
  assert.equal(event.giftId, 'rose');
  assert.equal(event.costCoins, 5);
  const queue = new GiftPresentationQueue();
  assert.equal(queue.enqueue(event).accepted, true);
  assert.equal(queue.enqueue({ ...event, eventId: '50000000-0000-4000-8000-000000000002' }).reason, 'duplicate');
  assert.equal(queue.snapshot().pending.length, 1);
});

test('server contract links gift, score, rose power, projection and two-session visual events', () => {
  assert.match(f4b, /insert into public\.live_gift_transactions[\s\S]*financial_transaction_id, battle_id[\s\S]*perform private\.record_live_battle_score_locked/);
  assert.match(f4b, /gift_transaction_id uuid not null unique/);
  assert.equal((f4b.match(/public\.atomic_ledger_transfer\(/g) ?? []).length, 1);
  assert.match(f4da, /v_gift\.gift_id is distinct from v_rules\.rose_gift_id/);
  assert.match(f4da, /rose_progress_units = v_progress/);
  assert.match(f4da, /order by boost\.multiplier desc, boost\.starts_at, boost\.id[\s\S]*limit 1/);
  assert.doesNotMatch(f4da, /atomic_ledger_transfer|update public\.financial_transactions|update public\.ledger_entries/i);
  assert.match(f4db, /sync_live_battle_competitive_projection_locked/);
  assert.match(f4a, /from \(values \(v_battle\.challenger_session_id\), \(v_battle\.opponent_session_id\)\)/);
  assert.match(f4a, /'battle_gift', true/);
  assert.match(f4a, /on conflict \(\s*session_id, \(payload ->> 'transaction_id'\)\s*\)/);
});

test('protected manifests and deployed migrations remain LF-identical', async () => {
  const expected = new Map([
    ['package.json', '67b0b13e81b3b4d89fa068205636a6c6c55abe52856d5256beb0d39bcc50f3c0'],
    ['package-lock.json', '9563f6480ec75a028a4580025d68884aca731c7836320ee148785156b0c40bf4'],
    ['supabase/migrations/20260830053531_live_battles_lb4_f4d_a_power_engine.sql', '3803e2fbcd23e7c63f5cff45e1ff5994b61011f3e3fdf89fa0166bd6efb3ab25'],
    ['supabase/migrations/20260830162244_live_battles_lb4_f4d_b_power_projection.sql', '60955601e14619f34e71c0ccc782a109530e76cbe63f14cacb1db6b34f660dd6'],
    ['supabase/migrations/20260830195917_live_battles_lb4_f4d_c_visual_realtime.sql', 'f5cd23b73c943ce15c5dddbbf35ed9200e0ae8ef10af883d08ecd67c7a423d17'],
    ['supabase/migrations/20260902141502_live_battles_lb4_f6_a_gift_catalog_expansion.sql', '8adfe6b93e1164dd53242523a3e5b3096e71f5e1ab8869d49c7e2e628c629dbf'],
  ]);
  for (const [file, hash] of expected) {
    const normalized = (await read(file)).replace(/\r\n/g, '\n');
    assert.equal(createHash('sha256').update(normalized).digest('hex'), hash, file);
  }
});
