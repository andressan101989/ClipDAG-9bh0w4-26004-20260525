import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const read = relative => readFile(new URL(relative, root), 'utf8');
const temp = await mkdtemp(path.join(tmpdir(), 'clipdag-f6b-'));
after(() => rm(temp, { recursive: true, force: true }));

async function compilePureModule(relative) {
  const source = await read(relative);
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: path.basename(relative),
  }).outputText;
  const destination = path.join(temp, path.basename(relative).replace(/\.ts$/, '.js'));
  await writeFile(destination, output);
  return destination;
}

await compilePureModule('components/live/gifts/giftPresentationContract.ts');
await compilePureModule('components/live/gifts/giftAnimationResolver.ts');
const queuePath = await compilePureModule('components/live/gifts/giftPresentationQueue.ts');
const requireFromQueue = createRequire(queuePath);
const contract = requireFromQueue('./giftPresentationContract.js');
const resolver = requireFromQueue('./giftAnimationResolver.js');
const queueModule = requireFromQueue('./giftPresentationQueue.js');

let sequence = 0;
function event(overrides = {}) {
  sequence += 1;
  return Object.freeze({
    eventId: `event-${sequence}`,
    transactionId: `transaction-${sequence}`,
    sessionId: 'session-a',
    giftId: 'clipdag_gift',
    label: 'Regalo ClipDAG',
    icon: '🎁',
    category: 'basic',
    costCoins: 5,
    animationType: null,
    durationMs: 1_800,
    priority: 0,
    senderUserId: 'sender-a',
    senderDisplayName: 'Ana',
    senderAvatarUrl: null,
    receiverUserId: 'receiver-a',
    quantity: 1,
    createdAt: 1_000 + sequence,
    ...overrides,
  });
}

test('resolver covers every price tier with bounded duration and particles', () => {
  const cases = [
    [1, 'micro', 8], [20, 'micro', 8], [21, 'standard', 8], [99, 'standard', 8],
    [100, 'featured', 12], [499, 'featured', 12], [500, 'premium', 18], [1_999, 'premium', 18],
    [2_000, 'epic', 24], [9_999, 'epic', 24], [10_000, 'legendary', 32], [34_999, 'legendary', 32],
  ];
  for (const [costCoins, tier, particles] of cases) {
    const resolved = resolver.resolveGiftAnimation(event({ costCoins, durationMs: costCoins === 1 ? 1 : 99_999 }));
    assert.equal(resolved.tier, tier);
    assert.equal(resolved.particleCount, particles);
    assert.ok(resolved.durationMs >= 800 && resolved.durationMs <= 15_000);
  }
});

test('resolver honors known families, legacy catalog types, categories and safe fallback', () => {
  const families = resolver.KNOWN_GIFT_ANIMATION_FAMILIES;
  assert.deepEqual([...families].sort(), [
    'celebration', 'floating', 'heart_wave', 'legendary_scene',
    'orbit', 'premium_scene', 'sparkle_burst', 'spotlight',
  ].sort());
  for (const family of families) assert.equal(resolver.resolveGiftAnimation(event({ animationType: family })).family, family);
  const categories = {
    basic: 'floating', love: 'heart_wave', celebration: 'celebration', fun: 'sparkle_burst',
    nature: 'orbit', lifestyle: 'spotlight', premium: 'premium_scene', legendary: 'legendary_scene',
  };
  for (const [category, family] of Object.entries(categories)) {
    assert.equal(resolver.resolveGiftAnimation(event({ animationType: 'unknown', category })).family, family);
  }
  assert.equal(resolver.resolveGiftAnimation(event({ animationType: 'center', costCoins: 200 })).family, 'sparkle_burst');
  assert.equal(resolver.resolveGiftAnimation(event({ animationType: 'entrance', costCoins: 800 })).family, 'orbit');
  assert.equal(resolver.resolveGiftAnimation(event({ animationType: 'fullscreen', costCoins: 12_000 })).family, 'legendary_scene');
  assert.equal(resolver.resolveGiftAnimation(event({ animationType: 'unknown', category: 'love' })).family, 'heart_wave');
  assert.equal(resolver.resolveGiftAnimation(event({ animationType: 'unknown', category: 'unknown', costCoins: 700 })).family, 'spotlight');
});

test('normalizer rejects malformed authority snapshots and applies safe visual fallbacks', () => {
  const row = {
    id: 'event-real', event_type: 'reaction', actor_user_id: 'sender', created_at: '2026-09-02T12:00:00Z',
    payload: {
      gift_real: true, transaction_id: 'transaction-real', session_id: 'session-a', gift_id: 'gift-a',
      recipient_user_id: 'receiver', amount_coins: 5, duration_ms: 50, quantity: 1,
    },
  };
  const normalized = contract.liveGiftEventFromPayload(row, 'session-a');
  assert.equal(normalized.costCoins, 5);
  assert.equal(normalized.durationMs, 800);
  assert.equal(normalized.label, 'Regalo ClipDAG');
  assert.equal(normalized.icon, '🎁');
  assert.equal(normalized.quantity, 1);
  assert.ok(Object.isFrozen(normalized));
  assert.equal(contract.liveGiftEventFromPayload({ ...row, payload: { ...row.payload, amount_coins: 0 } }, 'session-a'), null);
  assert.equal(contract.liveGiftEventFromPayload({ ...row, payload: { ...row.payload, recipient_user_id: '' } }, 'session-a'), null);
  assert.equal(contract.liveGiftEventFromPayload({ ...row, payload: { ...row.payload, quantity: -1 } }, 'session-a'), null);
  assert.equal(contract.isGiftPresentationEventFresh({ ...normalized, createdAt: 1_000 }, 17_001), false);
  assert.equal(contract.isGiftPresentationEventFresh({ ...normalized, createdAt: 10_000 }, 9_000), true);
});

test('queue is deterministic, prioritized, bounded and deduplicated', () => {
  const queue = new queueModule.GiftPresentationQueue(3);
  const basic = event({ createdAt: 100, eventId: 'basic', transactionId: 'tx-basic', giftId: 'basic-gift', costCoins: 5 });
  const premium = event({ createdAt: 300, eventId: 'premium', transactionId: 'tx-premium', giftId: 'premium-gift', costCoins: 700 });
  const featured = event({ createdAt: 200, eventId: 'featured', transactionId: 'tx-featured', giftId: 'featured-gift', costCoins: 200 });
  assert.equal(queue.enqueue(basic).accepted, true);
  assert.equal(queue.enqueue(premium).accepted, true);
  assert.equal(queue.enqueue(featured).accepted, true);
  assert.equal(queue.enqueue(basic).reason, 'duplicate');
  assert.equal(queue.snapshot().pending.length, 3);
  assert.equal(queue.next().event.eventId, 'premium');
  assert.equal(queue.complete('premium').event.eventId, 'featured');
});

test('legendary presentation evicts a lower tier, is not interrupted, and advances cleanly', () => {
  const queue = new queueModule.GiftPresentationQueue(2);
  const first = event({ eventId: 'first', transactionId: 'tx-first', giftId: 'first-gift', costCoins: 200 });
  const basic = event({ eventId: 'basic-2', transactionId: 'tx-basic-2', giftId: 'basic-2-gift', costCoins: 5 });
  const legendary = event({ eventId: 'legendary', transactionId: 'tx-legendary', giftId: 'legendary-gift', costCoins: 12_000 });
  queue.enqueue(first);
  queue.enqueue(basic);
  const accepted = queue.enqueue(legendary);
  assert.equal(accepted.accepted, true);
  assert.ok(accepted.evictedEventId);
  assert.equal(queue.next().event.eventId, 'legendary');
  assert.equal(queue.next().event.eventId, 'legendary');
  assert.notEqual(queue.complete('legendary')?.event.eventId, 'legendary');
});

test('full legendary queue reports bounded backpressure and permits a later retry', () => {
  const queue = new queueModule.GiftPresentationQueue(1);
  queue.enqueue(event({ eventId: 'legendary-a', transactionId: 'legendary-a-tx', giftId: 'legendary-a-gift', costCoins: 10_000 }));
  const waiting = event({ eventId: 'legendary-b', transactionId: 'legendary-b-tx', giftId: 'legendary-b-gift', costCoins: 20_000 });
  assert.equal(queue.enqueue(waiting).reason, 'capacity');
  queue.next();
  queue.complete('legendary-a');
  assert.equal(queue.enqueue(waiting).accepted, true, 'capacity rejection is observable and retryable');
});

test('combos are visual-only and require matching gift, sender and receiver inside the window', () => {
  const queue = new queueModule.GiftPresentationQueue();
  const original = event({ eventId: 'combo-1', transactionId: 'combo-tx-1', createdAt: 1_000, quantity: 7 });
  const same = event({ eventId: 'combo-2', transactionId: 'combo-tx-2', createdAt: 1_500, quantity: 3 });
  assert.equal(queue.enqueue(original).combined, false);
  const combined = queue.enqueue(same);
  assert.equal(combined.combined, true);
  assert.equal(combined.entry.comboCount, 2);
  assert.equal(combined.entry.event.quantity, 7, 'economic quantity remains immutable');
  assert.equal(queue.enqueue(event({ eventId: 'sender-b', transactionId: 'sender-b-tx', createdAt: 1_600, senderUserId: 'sender-b' })).combined, false);
  assert.equal(queue.enqueue(event({ eventId: 'receiver-b', transactionId: 'receiver-b-tx', createdAt: 1_700, receiverUserId: 'receiver-b' })).combined, false);
  assert.equal(queue.enqueue(event({ eventId: 'expired', transactionId: 'expired-tx', createdAt: 3_000 })).combined, false);
});

test('cancel clears work and ignores late events without state resurrection', () => {
  const queue = new queueModule.GiftPresentationQueue();
  queue.enqueue(event());
  queue.cancel();
  assert.equal(queue.snapshot().active, null);
  assert.equal(queue.snapshot().pending.length, 0);
  assert.equal(queue.enqueue(event()).reason, 'cancelled');
});

test('all 100 active catalog gifts are resolved without production ID branches', async () => {
  const [migration, service, rendererSource, resolverSource] = await Promise.all([
    read('supabase/migrations/20260902141502_live_battles_lb4_f6_a_gift_catalog_expansion.sql'),
    read('services/liveGiftsService.ts'),
    read('components/live/gifts/GiftAnimationRenderer.tsx'),
    read('components/live/gifts/giftAnimationResolver.ts'),
  ]);
  const newRows = [...migration.matchAll(/\('([^']+)',\s*'[^']*',\s*'[^']*',\s*'([^']+)',\s*(\d+),\s*\d+,\s*\d+,\s*'([^']+)',\s*'([^']+)'/g)]
    .map(match => ({ id: match[1], label: match[2], cost: Number(match[3]), category: match[4], animation: match[5] }));
  const historical = [...service.matchAll(/^\s{2}([a-z_]+):\s+\{[^\n]*category:\s*'([^']+)'[^\n]*animationType:\s*'([^']+)'[^\n]*durationMs:\s*(\d+)/gm)]
    .map(match => ({ id: match[1], label: match[1], cost: 100, category: match[2], animation: match[3], duration: Number(match[4]) }));
  assert.equal(newRows.length, 88);
  assert.equal(historical.length, 12);
  const active = [...historical, ...newRows];
  assert.equal(active.length, 100);
  for (const gift of active) {
    const resolved = resolver.resolveGiftAnimation(event({ giftId: gift.id, label: gift.label, costCoins: gift.cost, category: gift.category, animationType: gift.animation, durationMs: gift.duration ?? 1_800 }));
    assert.ok(familiesHas(resolved.family));
  }
  assert.doesNotMatch(rendererSource, /switch\s*\(\s*(?:gift|event)\.giftId|case\s+['"](?:lion|rocket|private_jet|phoenix|dragon|castle|galaxy)['"]/);
  assert.doesNotMatch(resolverSource, /giftId\s*===|switch\s*\(\s*event\.giftId/);
  function familiesHas(value) { return resolver.KNOWN_GIFT_ANIMATION_FAMILIES.includes(value); }
});

test('shared layer preserves interaction, accessibility, Battle and one event source per screen', async () => {
  const [layer, rendererSource, hook, host, viewer, stage, overlay] = await Promise.all([
    read('components/live/gifts/LiveGiftPresentationLayer.tsx'),
    read('components/live/gifts/GiftAnimationRenderer.tsx'),
    read('hooks/live/useLiveGiftAnimations.ts'),
    read('app/live/broadcast/[streamId].tsx'),
    read('app/live/watch/[streamId].tsx'),
    read('components/live/LiveBattleStage.tsx'),
    read('components/live/gifts/LiveGiftOverlay.tsx'),
  ]);
  assert.match(layer, /pointerEvents="none"/);
  assert.match(layer, /useSafeAreaInsets/);
  assert.match(hook, /AccessibilityInfo\.isReduceMotionEnabled/);
  assert.match(hook, /reduceMotionChanged/);
  assert.match(hook, /legendary_capacity/);
  assert.doesNotMatch(hook, /setInterval/);
  assert.match(rendererSource, /accessibilityElementsHidden/);
  assert.match(rendererSource, /useNativeDriver:\s*true/);
  assert.doesNotMatch(rendererSource, /audio|vibrat|Haptics/i);
  assert.equal((host.match(/<LiveGiftOverlay\b/g) ?? []).length, 1);
  assert.equal((viewer.match(/<LiveGiftOverlay\b/g) ?? []).length, 1);
  assert.match(overlay, /LiveGiftPresentationLayer/);
  assert.doesNotMatch(stage, /LiveGiftPresentationLayer|LiveGiftOverlay/);
  assert.match(host, /LiveBattleStage/);
  assert.match(viewer, /LiveBattleStage/);
  assert.match(host, /placeholder="Escribe un mensaje\.\.\."/);
  assert.match(viewer, /placeholder="Mensaje\.\.\."/);
  assert.match(host, /!battleState[\s\S]*LiveProductRail/);
  assert.match(viewer, /!battleState[\s\S]*LiveViewerCommerce/);
});

test('visual engine has no database, scoring, boost, or financial authority', async () => {
  const sources = (await Promise.all([
    'giftPresentationContract.ts', 'giftAnimationResolver.ts', 'giftPresentationQueue.ts',
    'GiftAnimationRenderer.tsx', 'LiveGiftPresentationLayer.tsx', 'GiftComboBadge.tsx',
  ].map(name => read(`components/live/gifts/${name}`)))).join('\n');
  assert.doesNotMatch(sources, /supabase|\.rpc\(|financial_transactions|ledger_entries|score_events|boost_events|costCoins\s*[+*\/-]=/i);
  assert.doesNotMatch(sources, /setInterval/);
});

test('protected manifests and deployed F6-A migration remain byte-equivalent after LF normalization', async () => {
  const expected = new Map([
    ['package.json', '67b0b13e81b3b4d89fa068205636a6c6c55abe52856d5256beb0d39bcc50f3c0'],
    ['package-lock.json', '9563f6480ec75a028a4580025d68884aca731c7836320ee148785156b0c40bf4'],
    ['supabase/migrations/20260902141502_live_battles_lb4_f6_a_gift_catalog_expansion.sql', '8adfe6b93e1164dd53242523a3e5b3096e71f5e1ab8869d49c7e2e628c629dbf'],
  ]);
  for (const [file, hash] of expected) {
    const normalized = (await read(file)).replace(/\r\n/g, '\n');
    assert.equal(createHash('sha256').update(normalized).digest('hex'), hash, file);
  }
});
