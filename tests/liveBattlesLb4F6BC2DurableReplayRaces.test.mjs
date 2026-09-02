import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const read = relative => readFile(new URL(relative, root), 'utf8');
const temp = await mkdtemp(path.join(tmpdir(), 'clipdag-f6bc2-red-'));
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

await compilePureModule('components/live/gifts/giftPresentationContract.ts');
const replayPath = await compilePureModule('components/live/gifts/giftPresentationReplay.ts');
const replayModule = createRequire(replayPath)('./giftPresentationReplay.js');
const {
  GiftPresentationReplayCoordinator,
  GIFT_REPLAY_MAX_AGE_MS,
  GIFT_REPLAY_MIN_UUID,
  createInitialGiftReplayCursor,
} = replayModule;

const BASE_TIME = Date.parse('2026-09-02T18:00:00.000Z');

function event(index, createdAt = BASE_TIME + index) {
  return Object.freeze({
    eventId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    transactionId: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    sessionId: 'session-c2', giftId: `gift-${index}`, label: `Gift ${index}`, icon: '🌌',
    category: 'legendary', costCoins: 10_000 + index, animationType: 'legendary_scene',
    durationMs: 4_000, priority: 100, senderUserId: 'sender-c2', senderDisplayName: 'Invitado',
    senderAvatarUrl: null, receiverUserId: 'receiver-c2', quantity: 1, createdAt,
  });
}

function row(value, inclusive = false) {
  return Object.freeze({
    cursor: Object.freeze({
      createdAt: new Date(value.createdAt).toISOString(),
      eventId: value.eventId,
      inclusive,
    }),
    event: value,
  });
}

function compareCursor(a, b) {
  return a.createdAt.localeCompare(b.createdAt) || a.eventId.localeCompare(b.eventId);
}

function pageSource(rows) {
  return async (cursor, limit) => rows
    .filter(item => cursor.inclusive ? compareCursor(item.cursor, cursor) >= 0 : compareCursor(item.cursor, cursor) > 0)
    .slice(0, limit);
}

async function waitUntil(predicate, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition_timeout');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test('C2: a request arriving during a short fetch forces another fetch', async () => {
  const row33 = row(event(33));
  const row34 = row(event(34));
  let resolveFirst;
  let calls = 0;
  const presented = [];
  const coordinator = new GiftPresentationReplayCoordinator({
    fetchPage: async () => {
      calls += 1;
      if (calls === 1) return new Promise(resolve => { resolveFirst = resolve; });
      return [row34];
    },
    enqueue: item => { presented.push(item.event.eventId); return { status: 'accepted' }; },
    now: () => BASE_TIME,
  });
  coordinator.request({ ...row33.cursor, inclusive: true });
  const replay = coordinator.notifyCapacityAvailable();
  await waitUntil(() => typeof resolveFirst === 'function');
  coordinator.request({ ...row34.cursor, inclusive: true });
  resolveFirst([row33]);
  await replay;
  assert.equal(calls, 2);
  assert.deepEqual(presented, [row33.event.eventId, row34.event.eventId]);
  assert.equal(coordinator.snapshot().pending, false);
});

test('C2: page-budget exhaustion schedules one continuation and reaches row 65+', async () => {
  const rows = Array.from({ length: 70 }, (_, index) => row(event(index + 1)));
  let calls = 0;
  const presented = [];
  const coordinator = new GiftPresentationReplayCoordinator({
    fetchPage: async (cursor, limit) => {
      calls += 1;
      return pageSource(rows)(cursor, limit);
    },
    enqueue: item => {
      if (item === rows.at(-1)) presented.push(item.event.eventId);
      return item === rows.at(-1) ? { status: 'accepted' } : { status: 'duplicate' };
    },
    now: () => BASE_TIME,
  });
  coordinator.request({
    createdAt: new Date(BASE_TIME).toISOString(),
    eventId: '00000000-0000-0000-0000-000000000000',
    inclusive: true,
  });
  await coordinator.notifyCapacityAvailable();
  await waitUntil(() => !coordinator.snapshot().pending && !coordinator.snapshot().inFlight && !coordinator.snapshot().timerActive);
  assert.ok(calls >= 5);
  assert.deepEqual(presented, [rows.at(-1).event.eventId]);
  assert.deepEqual(coordinator.snapshot(), {
    pending: false, inFlight: false, cancelled: false, timerActive: false,
  });
});

test('C2: initial session cursor closes first-subscribe gap and deduplicates Realtime race', async () => {
  assert.equal(typeof createInitialGiftReplayCursor, 'function');
  const initial = createInitialGiftReplayCursor(BASE_TIME);
  assert.deepEqual(initial, {
    createdAt: new Date(BASE_TIME).toISOString(),
    eventId: GIFT_REPLAY_MIN_UUID,
    inclusive: true,
  });
  const missed = row(event(80, BASE_TIME + 25));
  const seen = new Set();
  const presented = [];
  const coordinator = new GiftPresentationReplayCoordinator({
    fetchPage: pageSource([missed]),
    enqueue: item => {
      if (seen.has(item.event.eventId)) return { status: 'duplicate' };
      seen.add(item.event.eventId);
      presented.push(item.event.eventId);
      return { status: 'accepted' };
    },
    now: () => BASE_TIME + 50,
  });
  seen.add(missed.event.eventId);
  presented.push(missed.event.eventId);
  await coordinator.notifyReconnect(initial);
  assert.deepEqual(presented, [missed.event.eventId]);
  const hook = await read('hooks/live/useLiveGiftAnimations.ts');
  assert.match(hook, /sessionStartCursorRef/);
  assert.match(hook, /notifyReconnect\(\s*lastAcknowledgedCursorRef\.current \?\? sessionStartCursorRef\.current/);
  const initialCursorAt = hook.indexOf('sessionStartCursorRef.current = sessionId ? createInitialGiftReplayCursor() : null');
  const sessionEffectAt = hook.indexOf('useEffect(() => {', initialCursorAt);
  assert.ok(initialCursorAt >= 0 && sessionEffectAt > initialCursorAt, 'mount cursor exists before subscription effects');
});

test('C2: an old cursor is clamped and recent rows still replay', async () => {
  assert.equal(typeof GIFT_REPLAY_MIN_UUID, 'string');
  const old = row(event(90, BASE_TIME - GIFT_REPLAY_MAX_AGE_MS - 60_000));
  const recent = row(event(91, BASE_TIME - 1_000));
  const fetchedCursors = [];
  const presented = [];
  const coordinator = new GiftPresentationReplayCoordinator({
    fetchPage: async (cursor, limit) => {
      fetchedCursors.push(cursor);
      return pageSource([old, recent])(cursor, limit);
    },
    enqueue: item => { presented.push(item.event.eventId); return { status: 'accepted' }; },
    now: () => BASE_TIME,
  });
  coordinator.request({ ...old.cursor, inclusive: true });
  await coordinator.notifyCapacityAvailable();
  assert.deepEqual(fetchedCursors[0], {
    createdAt: new Date(BASE_TIME - GIFT_REPLAY_MAX_AGE_MS).toISOString(),
    eventId: GIFT_REPLAY_MIN_UUID,
    inclusive: true,
  });
  assert.deepEqual(presented, [recent.event.eventId]);
});

test('C2: a full non-advancing source stops and network exhaustion never polls', async () => {
  const repeated = Array.from({ length: 16 }, (_, index) => row(event(index + 100)));
  let calls = 0;
  const coordinator = new GiftPresentationReplayCoordinator({
    fetchPage: async () => { calls += 1; return repeated; },
    enqueue: () => ({ status: 'duplicate' }),
    now: () => BASE_TIME,
  });
  coordinator.request({
    createdAt: new Date(BASE_TIME).toISOString(),
    eventId: '00000000-0000-0000-0000-000000000000',
    inclusive: true,
  });
  await coordinator.notifyCapacityAvailable();
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(calls, 2, 'second identical page proves no progress and must stop continuation');
  assert.equal(coordinator.snapshot().timerActive, false);

  let failures = 0;
  const offline = new GiftPresentationReplayCoordinator({
    fetchPage: async () => { failures += 1; throw new Error('offline'); },
    enqueue: () => ({ status: 'accepted' }),
    now: () => BASE_TIME,
  });
  offline.request(repeated[0].cursor);
  await offline.notifyCapacityAvailable();
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(failures, 2);
  assert.equal(offline.snapshot().timerActive, false);
});

test('C2: lifecycle fences late work and each session owns fresh replay state', async () => {
  assert.equal(typeof createInitialGiftReplayCursor, 'function');
  let resolvePage;
  let enqueues = 0;
  const first = new GiftPresentationReplayCoordinator({
    fetchPage: () => new Promise(resolve => { resolvePage = resolve; }),
    enqueue: () => { enqueues += 1; return { status: 'accepted' }; },
    now: () => BASE_TIME,
  });
  first.request(createInitialGiftReplayCursor(BASE_TIME));
  const pending = first.notifyCapacityAvailable();
  await waitUntil(() => typeof resolvePage === 'function');
  first.cancel();
  resolvePage([row(event(200))]);
  await pending;
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(enqueues, 0);
  assert.deepEqual(first.snapshot(), {
    pending: false, inFlight: false, cancelled: true, timerActive: false,
  });

  const nextInitial = createInitialGiftReplayCursor(BASE_TIME + 10_000);
  assert.notDeepEqual(nextInitial, createInitialGiftReplayCursor(BASE_TIME));
  const second = new GiftPresentationReplayCoordinator({
    fetchPage: async () => [], enqueue: () => ({ status: 'accepted' }), now: () => BASE_TIME + 10_000,
  });
  assert.deepEqual(second.snapshot(), {
    pending: false, inFlight: false, cancelled: false, timerActive: false,
  });
});
