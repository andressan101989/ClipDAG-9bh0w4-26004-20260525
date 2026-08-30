import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const managerSource = await read('modules/creator/sessions/CreatorRecoveryManager.ts');
const hookSource = await read('hooks/useCreatorSession.ts');
const studioSource = await read('app/creator-studio.tsx');

function loadTypeScript(source, imports = {}) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    reportDiagnostics: true,
  });
  const diagnostics = (compiled.diagnostics ?? [])
    .filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.deepEqual(diagnostics, []);
  const module = { exports: {} };
  const require = name => {
    if (name in imports) return imports[name];
    throw new Error(`unexpected import: ${name}`);
  };
  Function('require', 'module', 'exports', compiled.outputText)(require, module, module.exports);
  return module.exports;
}

class MemoryStorage {
  values = new Map();
  writes = [];
  failuresRemaining = 0;
  controlled = false;
  gates = [];

  async setItem(key, value) {
    this.writes.push({ key, value });
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error('storage_unavailable');
    }
    if (this.controlled) {
      const gate = deferred();
      this.gates.push({ ...gate, key, value });
      await gate.promise;
    }
    this.values.set(key, value);
  }

  async getItem(key) {
    return this.values.get(key) ?? null;
  }

  async getAllKeys() {
    return [...this.values.keys()];
  }

  async removeItem(key) {
    this.values.delete(key);
  }

  async multiRemove(keys) {
    keys.forEach(key => this.values.delete(key));
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

function harness(options = {}) {
  const storage = options.storage ?? new MemoryStorage();
  const logs = [];
  const warnings = [];
  let now = options.now ?? 1_000;
  const logger = {
    log: (...values) => logs.push(values),
    warn: (...values) => warnings.push(values),
  };
  const asyncStorageImport = {
    default: storage,
    ...storage,
  };
  const exports = loadTypeScript(managerSource, {
    '@react-native-async-storage/async-storage': asyncStorageImport,
  });
  const manager = new exports.CreatorRecoveryManagerImpl(
    storage,
    logger,
    () => ++now,
  );
  return { manager, storage, logs, warnings };
}

test('first valid checkpoint performs one write', async () => {
  const { manager, storage } = harness();
  await manager.saveCheckpoint('creator_studio_main', 'editing', { tab: 'ar' });
  assert.equal(storage.writes.length, 1);
});

test('one hundred identical rerenders remain one write', async () => {
  const { manager, storage } = harness();
  const state = { tab: 'ar' };
  await manager.saveCheckpoint('creator_studio_main', 'editing', state);
  for (let index = 0; index < 100; index += 1) {
    await manager.saveCheckpoint('creator_studio_main', 'editing', state);
  }
  assert.equal(storage.writes.length, 1);
});

test('one hundred new objects with equal content and volatile timestamps remain one write', async () => {
  const { manager, storage } = harness();
  for (let index = 0; index < 100; index += 1) {
    await manager.saveCheckpoint('creator_studio_main', 'editing', {
      timestamp: index,
      nested: index % 2 === 0 ? { effect: 'none', strength: 0 } : { strength: 0, effect: 'none' },
      tab: 'ar',
    });
  }
  assert.equal(storage.writes.length, 1);
});

test('each semantic change performs exactly one additional write', async () => {
  const { manager, storage } = harness();
  await manager.saveCheckpoint('creator_studio_main', 'editing', { tab: 'ar' });
  await manager.saveCheckpoint('creator_studio_main', 'editing', { tab: 'videos' });
  await manager.saveCheckpoint('creator_studio_main', 'editing', { tab: 'music' });
  assert.equal(storage.writes.length, 3);
});

test('two simultaneous identical calls share one persistence', async () => {
  const { manager, storage } = harness();
  await Promise.all([
    manager.saveCheckpoint('creator_studio_main', 'editing', { tab: 'ar' }),
    manager.saveCheckpoint('creator_studio_main', 'editing', { tab: 'ar' }),
  ]);
  assert.equal(storage.writes.length, 1);
});

test('storage failure does not confirm the signature and a later retry persists', async () => {
  const { manager, storage, logs, warnings } = harness();
  storage.failuresRemaining = 1;
  await assert.rejects(
    manager.saveCheckpoint('creator_studio_main', 'editing', { tab: 'ar' }),
    /storage_unavailable/,
  );
  await manager.saveCheckpoint('creator_studio_main', 'editing', { tab: 'ar' });
  assert.equal(storage.writes.length, 2);
  assert.equal(warnings.length, 1);
  assert.equal(logs.filter(values => String(values[0]).includes('checkpoint saved')).length, 1);
});

test('an older in-flight write cannot overwrite a newer checkpoint', async () => {
  const storage = new MemoryStorage();
  storage.controlled = true;
  const { manager } = harness({ storage });
  const older = manager.saveCheckpoint('creator_studio_main', 'editing', { tab: 'ar' });
  await settle();
  const newer = manager.saveCheckpoint('creator_studio_main', 'editing', { tab: 'videos' });
  await settle();
  assert.equal(storage.gates.length, 1);
  storage.gates[0].resolve();
  await settle();
  assert.equal(storage.gates.length, 2);
  storage.gates[1].resolve();
  await Promise.all([older, newer]);
  const restored = JSON.parse(storage.values.get('creator_recovery:creator_studio_main'));
  assert.equal(restored.metadata.tab, 'videos');
});

test('Strict Mode stop-start keeps one timer and stale initialization is generation-guarded', async () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const timers = new Map();
  let timerId = 0;
  globalThis.setInterval = callback => {
    timerId += 1;
    timers.set(timerId, callback);
    return timerId;
  };
  globalThis.clearInterval = id => {
    timers.delete(id);
  };
  try {
    const { manager, storage } = harness();
    const opts = {
      getCheckpoint: () => ({ phase: 'editing', data: { tab: 'ar' } }),
    };
    manager.startAutosave('creator_studio_main', opts);
    manager.stopAutosave();
    manager.startAutosave('creator_studio_main', opts);
    assert.equal(timers.size, 1);
    await Promise.all(Array.from({ length: 100 }, () => [...timers.values()][0]()));
    assert.equal(storage.writes.length, 1);
    manager.stopAutosave();
    assert.equal(timers.size, 0);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
  assert.match(hookSource, /lifecycleGenerationRef/);
  assert.match(hookSource, /generation === lifecycleGenerationRef\.current/);
  assert.doesNotMatch(hookSource, /autosaveRef|setInterval/);
  assert.match(hookSource, /CreatorRecoveryManager\.startAutosave/);
  assert.match(hookSource, /CreatorRecoveryManager\.stopAutosave/);
  assert.doesNotMatch(studioSource, /timestamp:\s*Date\.now\(\)/);
});

test('checkpoint log is emitted only after a real successful persistence', async () => {
  const { manager, storage, logs } = harness();
  await manager.saveCheckpoint('creator_studio_main', 'editing', { tab: 'ar' });
  await manager.saveCheckpoint('creator_studio_main', 'editing', { tab: 'ar' });
  await manager.saveCheckpoint('creator_studio_main', 'editing', { tab: 'videos' });
  assert.equal(storage.writes.length, 2);
  assert.equal(logs.filter(values => String(values[0]).includes('checkpoint saved')).length, 2);
});

test('a fresh manager restores the last successfully persisted checkpoint', async () => {
  const storage = new MemoryStorage();
  const firstRuntime = harness({ storage, now: 10_000 });
  await firstRuntime.manager.saveCheckpoint('creator_studio_main', 'editing', { tab: 'ar' });
  await firstRuntime.manager.saveCheckpoint('creator_studio_main', 'editing', { tab: 'music' });

  const restartedRuntime = harness({ storage, now: 10_100 });
  const draft = await restartedRuntime.manager.getLatestDraft('creator_studio_main');
  assert.equal(draft.phase, 'editing');
  assert.equal(draft.metadata.tab, 'music');
  assert.equal(storage.writes.length, 2);
});
