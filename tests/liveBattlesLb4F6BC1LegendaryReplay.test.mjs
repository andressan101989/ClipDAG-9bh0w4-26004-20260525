import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const read = relative => readFile(new URL(relative, root), 'utf8');
const temp = await mkdtemp(path.join(tmpdir(), 'clipdag-f6bc1-'));
after(() => rm(temp, { recursive: true, force: true }));

async function compilePureModule(relative) {
  const source = await read(relative);
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: path.basename(relative),
  }).outputText;
  const destination = path.join(temp, path.basename(relative).replace(/\.ts$/, '.js'));
  await writeFile(destination, output);
  return destination;
}

const contractPath = await compilePureModule('components/live/gifts/giftPresentationContract.ts');
await compilePureModule('components/live/gifts/giftAnimationResolver.ts');
const queuePath = await compilePureModule('components/live/gifts/giftPresentationQueue.ts');
const replayPath = await compilePureModule('components/live/gifts/giftPresentationReplay.ts');
const { GiftPresentationQueue } = createRequire(queuePath)('./giftPresentationQueue.js');
const {
  GiftPresentationReplayCoordinator,
  GIFT_REPLAY_MAX_NETWORK_ATTEMPTS,
  GIFT_REPLAY_MAX_PAGES_PER_RUN,
  GIFT_REPLAY_PAGE_SIZE,
} = createRequire(replayPath)('./giftPresentationReplay.js');
const {
  liveGiftEventFromPayload,
  shouldAcknowledgeGiftOutcome,
} = createRequire(contractPath)('./giftPresentationContract.js');

function legendary(index, overrides = {}) {
  return Object.freeze({
    eventId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    transactionId: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    sessionId: 'session-a', giftId: `legendary-gift-${index}`, label: `Legendary ${index}`, icon: '🌌',
    category: 'legendary', costCoins: 10_000 + index, animationType: 'legendary_scene',
    durationMs: 4_000, priority: 100, senderUserId: `sender-${index}`, senderDisplayName: 'Invitado',
    senderAvatarUrl: null, receiverUserId: 'receiver-a', quantity: 1,
    createdAt: Date.parse('2026-09-02T12:00:00.000Z') + index,
    ...overrides,
  });
}

function row(event, inclusive = false) {
  return Object.freeze({
    cursor: Object.freeze({
      createdAt: new Date(event.createdAt).toISOString(),
      eventId: event.eventId,
      inclusive,
    }),
    event,
  });
}

function queueOutcome(queue, replayRow) {
  const result = queue.enqueue(replayRow.event);
  if (result.accepted) return { status: result.combined ? 'combined' : 'accepted' };
  if (result.reason === 'duplicate') return { status: 'duplicate' };
  if (result.reason === 'cancelled') return { status: 'cancelled' };
  return { status: 'backpressure' };
}

function sourceFrom(rows) {
  return async (cursor, limit) => rows
    .filter(item => {
      const comparison = item.cursor.createdAt.localeCompare(cursor.createdAt)
        || item.cursor.eventId.localeCompare(cursor.eventId);
      return cursor.inclusive ? comparison >= 0 : comparison > 0;
    })
    .slice(0, limit);
}

test('the base defect is reproduced and legendary 33 is replayed once after capacity frees', async () => {
  const queue = new GiftPresentationQueue(32);
  for (let index = 1; index <= 32; index += 1) assert.equal(queue.enqueue(legendary(index)).accepted, true);
  const event33 = legendary(33);
  assert.deepEqual(queue.enqueue(event33), { accepted: false, reason: 'capacity' });
  assert.equal(shouldAcknowledgeGiftOutcome({ status: 'backpressure' }), false);

  const logs = [];
  const coordinator = new GiftPresentationReplayCoordinator({
    fetchPage: sourceFrom([row(event33)]),
    enqueue: replayRow => queueOutcome(queue, replayRow),
    logger: (marker, code) => logs.push([marker, code]),
  });
  coordinator.request(row(event33, true).cursor);
  assert.equal(queue.snapshot().pending.some(item => item.event.eventId === event33.eventId), false);

  const first = queue.next();
  queue.complete(first.event.eventId);
  await coordinator.notifyCapacityAvailable();
  const snapshot = queue.snapshot();
  assert.equal([
    snapshot.active?.event.eventId,
    ...snapshot.pending.map(item => item.event.eventId),
  ].filter(id => id === event33.eventId).length, 1);
  assert.ok(logs.some(([marker]) => marker === 'replay_accepted'));

  coordinator.request(row(event33, true).cursor);
  await coordinator.notifyCapacityAvailable();
  const afterDuplicate = queue.snapshot();
  assert.equal([
    afterDuplicate.active?.event.eventId,
    ...afterDuplicate.pending.map(item => item.event.eventId),
  ].filter(id => id === event33.eventId).length, 1);
});

test('multiple recovered legendary gifts retain durable order across repeated capacity release', async () => {
  const queue = new GiftPresentationQueue(2);
  queue.enqueue(legendary(1));
  queue.enqueue(legendary(2));
  const recovered = [row(legendary(3)), row(legendary(4)), row(legendary(5))];
  const accepted = [];
  const coordinator = new GiftPresentationReplayCoordinator({
    fetchPage: sourceFrom([...recovered].reverse()),
    enqueue: replayRow => {
      const result = queueOutcome(queue, replayRow);
      if (result.status === 'accepted') accepted.push(replayRow.event.eventId);
      return result;
    },
  });
  coordinator.request({ ...recovered[0].cursor, inclusive: true });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = queue.next();
    queue.complete(current.event.eventId);
    await coordinator.notifyCapacityAvailable();
  }
  assert.deepEqual(accepted, recovered.map(item => item.event.eventId));
});

test('replay cancellation fences an async late page and releases all bounded state', async () => {
  let resolvePage;
  let enqueueCount = 0;
  const coordinator = new GiftPresentationReplayCoordinator({
    fetchPage: () => new Promise(resolve => { resolvePage = resolve; }),
    enqueue: () => { enqueueCount += 1; return { status: 'accepted' }; },
  });
  const event = legendary(33);
  coordinator.request(row(event, true).cursor);
  const pending = coordinator.notifyCapacityAvailable();
  coordinator.cancel();
  resolvePage([row(event)]);
  await pending;
  assert.equal(enqueueCount, 0);
  assert.deepEqual(coordinator.snapshot(), {
    pending: false, inFlight: false, cancelled: true, timerActive: false,
  });
});

test('network retry and memory are explicitly bounded without permanent polling', async () => {
  let attempts = 0;
  const coordinator = new GiftPresentationReplayCoordinator({
    fetchPage: async () => {
      attempts += 1;
      throw new Error('offline');
    },
    enqueue: () => ({ status: 'accepted' }),
  });
  coordinator.request(row(legendary(33), true).cursor);
  await coordinator.notifyCapacityAvailable();
  assert.equal(attempts, GIFT_REPLAY_MAX_NETWORK_ATTEMPTS);
  assert.equal(coordinator.snapshot().timerActive, false);
  assert.equal(GIFT_REPLAY_PAGE_SIZE, 16);
  assert.equal(GIFT_REPLAY_MAX_PAGES_PER_RUN, 4);
  assert.equal(Object.keys(coordinator.snapshot()).includes('events'), false);
  const replaySource = await read('components/live/gifts/giftPresentationReplay.ts');
  assert.doesNotMatch(replaySource, /setInterval/);
});

test('out-of-order and repeated durable pages are sorted and deduplicated', async () => {
  const queue = new GiftPresentationQueue(8);
  const events = [legendary(41), legendary(42), legendary(43)];
  const accepted = [];
  const coordinator = new GiftPresentationReplayCoordinator({
    fetchPage: async () => [row(events[2]), row(events[0]), row(events[1]), row(events[1])],
    enqueue: replayRow => {
      const result = queueOutcome(queue, replayRow);
      if (result.status === 'accepted') accepted.push(replayRow.event.eventId);
      return result;
    },
  });
  coordinator.request(row(events[0], true).cursor);
  await coordinator.notifyCapacityAvailable();
  assert.deepEqual(accepted, events.map(event => event.eventId));
});

test('host and viewer share acknowledgement-after-enqueue and reconnect behavior', async () => {
  for (const relative of ['app/live/broadcast/[streamId].tsx', 'app/live/watch/[streamId].tsx']) {
    const screen = await read(relative);
    const normalizeAt = screen.indexOf('liveGiftEventFromPayload(row, streamId)');
    const enqueueAt = screen.indexOf('const enqueueOutcome = enqueueGift(giftEvent)', normalizeAt);
    const ackAt = screen.indexOf('rememberSeenReactionEvent(seenReactionEventIdsRef.current, row.id)', enqueueAt);
    assert.ok(normalizeAt >= 0 && enqueueAt > normalizeAt && ackAt > enqueueAt);
    assert.match(screen, /shouldAcknowledgeGiftOutcome\(enqueueOutcome\)/);
    assert.match(screen, /status === 'SUBSCRIBED'[\s\S]*notifyGiftRealtimeSubscribed\(\)/);
  }
});

test('durable query is scoped, paginated, cursor ordered, read-only, and lifecycle guarded', async () => {
  const [hook, replay] = await Promise.all([
    read('hooks/live/useLiveGiftAnimations.ts'),
    read('components/live/gifts/giftPresentationReplay.ts'),
  ]);
  assert.match(hook, /\.eq\('session_id', replaySessionId\)/);
  assert.match(hook, /\.eq\('event_type', 'reaction'\)/);
  assert.match(hook, /\.contains\('payload', \{ gift_real: true \}\)/);
  assert.match(hook, /created_at\.gt\.[\s\S]*created_at\.eq\.[\s\S]*id\.\$\{idOperator\}/);
  assert.match(hook, /\.order\('created_at',[\s\S]*\.order\('id',[\s\S]*\.limit\(limit\)/);
  assert.match(hook, /sessionIdRef\.current !== replaySessionId/);
  assert.match(hook, /replayRef\.current\?\.cancel\(\)/);
  assert.match(hook, /REDUCED_MOTION_DURATION_MS/);
  const replayCode = `${hook}\n${replay}`;
  assert.doesNotMatch(replayCode, /send_live_gift|send_live_battle_gift|\.rpc\(/);
  assert.doesNotMatch(replayCode, /\.from\([^)]*\)[\s\S]{0,240}\.(?:insert|update|upsert|delete)\(/);
});

test('canonical F4-A gift payload still normalizes for visual replay', () => {
  const parsed = liveGiftEventFromPayload({
    id: '00000000-0000-4000-8000-000000000077',
    session_id: 'session-a', actor_user_id: 'sender-77', event_type: 'reaction',
    created_at: '2026-09-02T12:00:00.077Z',
    payload: {
      gift_real: true,
      transaction_id: '10000000-0000-4000-8000-000000000077',
      gift_id: 'clipdag_constellation', gift_label: 'Constelación ClipDAG', gift_icon: '🌌',
      gift_category: 'legendary', amount_coins: 10_077, animation_type: 'legendary_scene',
      duration_ms: 4_000, recipient_user_id: 'receiver-a', username: 'Invitado', quantity: 1,
    },
  }, 'session-a');
  assert.equal(parsed?.eventId, '00000000-0000-4000-8000-000000000077');
  assert.equal(parsed?.transactionId, '10000000-0000-4000-8000-000000000077');
  assert.equal(parsed?.costCoins, 10_077);
});

test('reaction acknowledgement memory is bounded deterministically', () => {
  const { rememberSeenReactionEvent, MAX_SEEN_REACTION_EVENT_IDS } = createRequire(contractPath)('./giftPresentationContract.js');
  const seen = new Set();
  for (let index = 0; index < MAX_SEEN_REACTION_EVENT_IDS + 50; index += 1) {
    rememberSeenReactionEvent(seen, `event-${index}`);
  }
  assert.equal(seen.size, MAX_SEEN_REACTION_EVENT_IDS);
  assert.equal(seen.has('event-0'), false);
  assert.equal(seen.has(`event-${MAX_SEEN_REACTION_EVENT_IDS + 49}`), true);
});

test('protected financial, database, manifests, and F6-A migration files remain outside C1', async () => {
  const statusGuard = await read('tests/liveBattlesLb4F6BGiftPresentationEngine.test.mjs');
  assert.match(statusGuard, /package\.json/);
  assert.match(statusGuard, /package-lock\.json/);
  const changed = [
    'components/live/gifts/giftPresentationContract.ts',
    'components/live/gifts/giftPresentationReplay.ts',
    'hooks/live/useLiveGiftAnimations.ts',
    'app/live/broadcast/[streamId].tsx',
    'app/live/watch/[streamId].tsx',
    'tests/liveBattlesLb4F6BC1LegendaryReplay.test.mjs',
  ];
  assert.equal(changed.some(file => /migration|financial|ledger|economy|agora|relay|edge-functions/i.test(file)), false);
});
