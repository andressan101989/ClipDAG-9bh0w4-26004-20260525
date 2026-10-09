import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { createAppSwitcherProtectionCoordinator } from '../services/screenProtectionCoordinator.mjs';

const root = path.resolve(import.meta.dirname, '..');
const read = relative => readFileSync(path.join(root, relative), 'utf8');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeCoordinator(overrides = {}) {
  const calls = [];
  const adapter = {
    enable: async () => { calls.push('enable'); },
    disable: async () => { calls.push('disable'); },
    ...overrides,
  };
  return { coordinator: createAppSwitcherProtectionCoordinator(adapter), calls };
}

test('one owner enables once, duplicate acquire is idempotent, and final release disables once', async () => {
  const { coordinator, calls } = makeCoordinator();
  await coordinator.acquire('premium-viewer:one');
  await coordinator.acquire('premium-viewer:one');
  assert.equal(coordinator.claimCount(), 1);
  assert.equal(coordinator.has('premium-viewer:one'), true);
  assert.deepEqual(calls, ['enable']);
  await coordinator.release('premium-viewer:one');
  assert.equal(coordinator.claimCount(), 0);
  assert.deepEqual(calls, ['enable', 'disable']);
});

test('chat release cannot disable app-switcher protection still owned by the Premium viewer', async () => {
  const { coordinator, calls } = makeCoordinator();
  await coordinator.acquire('premium-viewer:content-a');
  await coordinator.acquire('chat-one-time-media:conversation-a');
  assert.deepEqual(calls, ['enable']);

  await coordinator.release('chat-one-time-media:conversation-a');
  assert.equal(coordinator.claimCount(), 1);
  assert.equal(coordinator.has('premium-viewer:content-a'), true);
  assert.deepEqual(calls, ['enable']);

  await coordinator.release('premium-viewer:content-a');
  assert.deepEqual(calls, ['enable', 'disable']);
});

test('Premium release cannot disable app-switcher protection still owned by chat', async () => {
  const { coordinator, calls } = makeCoordinator();
  await coordinator.acquire('chat-one-time-media:conversation-a');
  await coordinator.acquire('premium-viewer:content-a');
  await coordinator.release('premium-viewer:content-a');
  assert.equal(coordinator.has('chat-one-time-media:conversation-a'), true);
  assert.deepEqual(calls, ['enable']);
  await coordinator.releaseAllForOwner('chat-one-time-media:conversation-a');
  assert.deepEqual(calls, ['enable', 'disable']);
});

test('unknown and out-of-order releases do not alter active protection', async () => {
  const { coordinator, calls } = makeCoordinator();
  await coordinator.release('unknown');
  await coordinator.acquire('premium-viewer:one');
  await coordinator.release('unknown');
  assert.equal(coordinator.claimCount(), 1);
  assert.deepEqual(calls, ['enable']);
});

test('concurrent acquisition serializes native enable and preserves both claims', async () => {
  const enabling = deferred();
  const calls = [];
  const coordinator = createAppSwitcherProtectionCoordinator({
    enable: async () => { calls.push('enable'); await enabling.promise; },
    disable: async () => { calls.push('disable'); },
  });
  const first = coordinator.acquire('premium-viewer:one');
  const second = coordinator.acquire('chat-one-time-media:one');
  enabling.resolve();
  await Promise.all([first, second]);
  assert.equal(coordinator.claimCount(), 2);
  assert.deepEqual(calls, ['enable']);
});

test('failed native enable rolls back the owner claim', async () => {
  const coordinator = createAppSwitcherProtectionCoordinator({
    enable: async () => { throw new Error('native_unavailable'); },
    disable: async () => {},
  });
  await assert.rejects(() => coordinator.acquire('premium-viewer:one'), /native_unavailable/);
  assert.equal(coordinator.claimCount(), 0);
  assert.equal(coordinator.has('premium-viewer:one'), false);
});

test('failed native disable conservatively retains the final claim for a safe retry', async () => {
  let disableFails = true;
  let disables = 0;
  const coordinator = createAppSwitcherProtectionCoordinator({
    enable: async () => {},
    disable: async () => {
      disables += 1;
      if (disableFails) throw new Error('disable_failed');
    },
  });
  await coordinator.acquire('premium-viewer:one');
  await assert.rejects(() => coordinator.release('premium-viewer:one'), /disable_failed/);
  assert.equal(coordinator.claimCount(), 1);
  assert.equal(coordinator.has('premium-viewer:one'), true);
  disableFails = false;
  await coordinator.release('premium-viewer:one');
  assert.equal(coordinator.claimCount(), 0);
  assert.equal(disables, 2);
});

test('B6 hook exposes fail-closed arming/protected/failed states and exact keyed cleanup', () => {
  const hook = read('hooks/usePremiumScreenProtection.ts');
  assert.match(hook, /isAvailableAsync\(\)/);
  assert.match(hook, /preventScreenCaptureAsync\(captureKey\)/);
  assert.match(hook, /allowScreenCaptureAsync\(captureKey\)/);
  assert.match(hook, /'arming'\s*\|\s*'protected'\s*\|\s*'failed'/);
  assert.match(hook, /appSwitcherProtectionCoordinator\.acquire\(owner\)/);
  assert.match(hook, /appSwitcherProtectionCoordinator\.release\(owner\)/);
  assert.doesNotMatch(hook, /usePreventScreenCapture|MediaLibrary|ImagePicker|requestPermissions/i);
});

test('screen-protection retry uses distinct claims so late cleanup cannot disarm the current attempt', () => {
  const hook = read('hooks/usePremiumScreenProtection.ts');
  assert.match(hook, /premium-viewer:\$\{scopeId\}:\$\{instanceRef\.current\}:\$\{attempt\}/);
  assert.match(hook, /creator-premium-viewer:\$\{scopeId\}:\$\{instanceRef\.current\}:\$\{attempt\}/);
  assert.match(hook, /\[scopeId, attempt\]/);
});

test('Android relies on keyed FLAG_SECURE capture protection without invoking the iOS app-switcher API', () => {
  const hook = read('hooks/usePremiumScreenProtection.ts');
  const chat = read('app/chat/[userId].tsx');
  assert.match(hook, /Platform\.OS\s*===\s*'ios'/);
  assert.match(hook, /preventScreenCaptureAsync\(captureKey\)/);
  assert.match(hook, /if\s*\(Platform\.OS\s*===\s*'ios'\)[\s\S]*?appSwitcherProtectionCoordinator\.acquire\(owner\)/);
  assert.match(chat, /if\s*\(!url\s*\|\|\s*Platform\.OS\s*!==\s*'ios'\)\s*return undefined/);
});

test('chat one-time media shares the coordinator and has no direct global disable call', () => {
  const chat = read('app/chat/[userId].tsx');
  assert.match(chat, /appSwitcherProtectionCoordinator/);
  assert.match(chat, /chat-one-time-media:/);
  assert.doesNotMatch(chat, /ScreenCapture\.enableAppSwitcherProtectionAsync/);
  assert.doesNotMatch(chat, /ScreenCapture\.disableAppSwitcherProtectionAsync/);
  assert.match(chat, /usePreventScreenCapture\(ONE_TIME_CAPTURE_KEY\)/);
});

test('STATIC Android and iOS native contracts remain distinct from PENDING physical validation', () => {
  const hook = read('hooks/usePremiumScreenProtection.ts');
  const coordinator = read('services/screenProtectionCoordinator.mjs');
  const plan = read('docs/superpowers/plans/2026-10-09-creator-premium-b6-protected-consumer-viewer.md');
  const design = read('docs/superpowers/specs/2026-10-09-creator-premium-b6-protected-consumer-viewer-design.md');
  assert.match(hook, /preventScreenCaptureAsync\(captureKey\)/);
  assert.match(hook, /allowScreenCaptureAsync\(captureKey\)/);
  assert.match(coordinator, /enableAppSwitcherProtectionAsync\(1\)/);
  assert.match(coordinator, /disableAppSwitcherProtectionAsync\(\)/);
  assert.match(design, /FLAG_SECURE/);
  assert.match(design, /best-effort platform defenses, not an absolute guarantee/);
  assert.match(plan, /PHYSICAL ANDROID VALIDATION/);
  assert.match(plan, /PHYSICAL IOS VALIDATION/);
  assert.match(plan, /mark it `PENDING`; never infer PASS/);
});
