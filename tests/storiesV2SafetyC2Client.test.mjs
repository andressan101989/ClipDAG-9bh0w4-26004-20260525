import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the actual provider effects with a tiny hook host. Supabase and the
// native lifecycle are the external boundaries; loading/coalescing stay real.
function providerHarness({ stories = true, appState = 'active' } = {}) {
  const effects = [], intervals = new Map(), cleanups = [], state = [];
  let stateIndex = 0, queryCount = 0, statusCallback, lifecycle, channels = 0;
  let resolveQuery;
  let queryResult = { data: [], error: null };
  const native = { AppState: { currentState: appState, addEventListener: (_event, callback) => {
    lifecycle = callback;
    return { remove() {} };
  } } };
  const react = {
    createContext: () => ({ Provider: 'Provider' }),
    createElement: (_type, props) => props,
    useContext: () => ({ user: { id: 'actor' } }),
    useRef: value => ({ current: value }),
    useCallback: callback => callback,
    useEffect: callback => effects.push(callback),
    useState: initial => {
      const index = stateIndex++;
      state[index] = index === 0 && stories ? [{ stories: [{ id: 'revoked', expiresAt: '2099-01-01' }] }] : initial;
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    },
  };
  const client = {
    from(table) {
      assert.equal(table, 'stories');
      queryCount++;
      const query = { select: () => query, gt: () => query, order: () => query,
        then(resolve) { return resolveQuery ? new Promise(done => { resolveQuery = () => done(resolve(queryResult)); }) : Promise.resolve(queryResult).then(resolve); } };
      return query;
    },
    channel() {
      channels++;
      const channel = { on: () => channel, subscribe: callback => { statusCallback = callback; return channel; } };
      return channel;
    },
    removeChannel() {},
  };
  const output = ts.transpileModule(readFileSync('contexts/StoriesContext.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  const exports = {};
  vm.runInNewContext(output, {
    exports, console,
    require(name) {
      if (name === 'react') return { ...react, default: react };
      if (name === 'react-native') return native;
      if (name === '@/template') return { getSupabaseClient: () => client };
      if (name.endsWith('storyViewerRuntime')) return {
        isRealtimeRecoveryStatus: status => ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status),
        nextRealtimeRetry: () => ({ attempt: 1, delay: 1000 }),
      };
      return {};
    },
    setInterval(callback, delay) { const id = Symbol(); intervals.set(id, { callback, delay }); return id; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout: () => Symbol(), clearTimeout() {},
  });
  exports.StoriesProvider({ children: null });
  // Skip initial session reset; represent an already loaded active store.
  for (const effect of effects.slice(1)) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }
  return {
    intervals, state,
    queries: () => queryCount,
    channels: () => channels,
    subscribed: () => statusCallback('SUBSCRIBED'),
    failed: () => statusCallback('CHANNEL_ERROR'),
    foreground(next) { native.AppState.currentState = next; lifecycle(next); },
    tick() { for (const timer of intervals.values()) timer.callback(); },
    hold() { resolveQuery = () => {}; },
    release() { const resolve = resolveQuery; resolveQuery = undefined; resolve(); },
    cleanup() { cleanups.forEach(cleanup => cleanup()); },
    deny() { queryResult = { data: [], error: null }; },
  };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('healthy Realtime still reconciles revoked RLS visibility within a bounded interval', async () => {
  const host = providerHarness();
  host.subscribed();
  await flush();
  const before = host.queries();
  assert.equal(host.intervals.size, 1, 'private changes need a timer even after SUBSCRIBED');
  assert.ok([...host.intervals.values()][0].delay >= 30_000);
  assert.ok([...host.intervals.values()][0].delay <= 60_000);
  host.deny();
  host.tick();
  await flush();
  assert.equal(host.queries(), before + 1);
  assert.equal(host.state[0].length, 0, 'canonical RLS denial removes the cached Story');
  assert.equal(host.channels(), 1);
  host.cleanup();
  assert.equal(host.intervals.size, 0);
});

test('reconciliation pauses in background and for an empty healthy store', async () => {
  const host = providerHarness({ appState: 'background' });
  assert.equal(host.intervals.size, 1);
  host.tick();
  await flush();
  assert.equal(host.queries(), 0);
  host.foreground('active');
  await flush();
  assert.equal(host.queries(), 1, 'foreground refresh uses canonical loading');
  host.cleanup();
  const empty = providerHarness({ stories: false });
  assert.equal(empty.intervals.size, 1);
  empty.tick();
  await flush();
  assert.equal(empty.queries(), 0);
  empty.failed();
  empty.tick();
  await flush();
  assert.equal(empty.queries(), 1, 'existing recovery fallback shares the timer');
  empty.cleanup();
});

test('timer and Realtime invalidations share one flight and one coalesced follow-up', async () => {
  const host = providerHarness();
  assert.equal(host.intervals.size, 1);
  host.hold();
  host.tick();
  await flush();
  host.tick();
  host.subscribed();
  assert.equal(host.queries(), 1);
  host.release();
  await flush();
  assert.equal(host.queries(), 2);
  const callback = [...host.intervals.values()][0].callback;
  host.cleanup();
  callback();
  await flush();
  assert.equal(host.queries(), 2, 'late timer is fenced after session cleanup');
});
