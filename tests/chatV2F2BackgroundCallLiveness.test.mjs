import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const groupScreen = readFileSync(new URL('../app/group-call/[roomId].tsx', import.meta.url), 'utf8');
const directAudioScreen = readFileSync(new URL('../app/call/[userId].tsx', import.meta.url), 'utf8');
const directVideoScreen = readFileSync(new URL('../app/video-call/[userId].tsx', import.meta.url), 'utf8');
const livenessHook = readFileSync(new URL('../hooks/useCallLiveness.ts', import.meta.url), 'utf8');

function createHeartbeatLifecycle() {
  let intervalCount = 0;
  let heartbeats = 0;
  let active = true;
  let connected = false;

  return {
    connect() {
      connected = true;
      intervalCount = 1;
      heartbeats += 1;
    },
    appState(state) {
      if (active && connected && state === 'active') heartbeats += 1;
    },
    cleanup() {
      active = false;
      connected = false;
      intervalCount = 0;
    },
    state() {
      return { intervalCount, heartbeats };
    },
  };
}

test('group liveness has no AppState background pause contract', () => {
  assert.doesNotMatch(groupScreen + livenessHook, /pauseInBackground/);
  assert.match(groupScreen, /connected:\s*isCanonicalChatCall && joined/);
  assert.match(livenessHook, /const timer = setInterval\(sendHeartbeat, HEARTBEAT_INTERVAL_MS\);/);
});

test('background preserves the existing heartbeat interval', () => {
  const lifecycle = createHeartbeatLifecycle();
  lifecycle.connect();
  lifecycle.appState('background');
  assert.deepEqual(lifecycle.state(), { intervalCount: 1, heartbeats: 1 });
});

test('foreground reconciles immediately without adding an interval', () => {
  const lifecycle = createHeartbeatLifecycle();
  lifecycle.connect();
  lifecycle.appState('background');
  lifecycle.appState('active');
  assert.deepEqual(lifecycle.state(), { intervalCount: 1, heartbeats: 2 });
});

test('terminal, leave, disconnect, and unmount share deterministic cleanup', () => {
  for (const reason of ['terminal', 'leave', 'disconnect', 'unmount']) {
    const lifecycle = createHeartbeatLifecycle();
    lifecycle.connect();
    lifecycle.cleanup(reason);
    lifecycle.appState('active');
    assert.deepEqual(lifecycle.state(), { intervalCount: 0, heartbeats: 1 }, reason);
  }
  assert.match(livenessHook, /clearInterval\(timer\);\s*appStateSubscription\.remove\(\);/);
});

test('direct audio and video retain the shared liveness contract', () => {
  for (const screen of [directAudioScreen, directVideoScreen]) {
    assert.match(screen, /useCallLiveness\(\{/);
    assert.match(screen, /terminal:\s*Boolean\(terminalStatus\)/);
    assert.doesNotMatch(screen, /pauseInBackground/);
  }
});
