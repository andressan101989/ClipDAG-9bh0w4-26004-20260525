import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const BASE = '714cc8c83a8d4ef6ef0f831c8bacf6f1fba964de';
const sharedSource = readFileSync('modules/realtime/PresenceManager.ts', 'utf8');
const chatSource = readFileSync('services/chatPresenceService.ts', 'utf8');
const contextSource = readFileSync('contexts/MessagesContext.tsx', 'utf8');
const battleSource = readFileSync('app/battle/[roomId].tsx', 'utf8');

function load(source, imports = {}) {
  const module = { exports: {} };
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  Function('require', 'module', 'exports', output)(name => {
    assert.ok(name in imports, `unexpected import ${name}`);
    return imports[name];
  }, module, module.exports);
  return module.exports;
}

function harness({ trackResult = 'ok' } = {}) {
  const channels = [];
  const foreground = new Set(); const background = new Set();
  class Channel {
    constructor(topic, config) {
      this.topic = topic; this.config = config; this.handlers = []; this.state = {};
      this.tracked = []; this.untracked = 0; this.removed = false;
    }
    on(kind, filter, callback) { this.handlers.push({ kind, filter, callback }); return this; }
    subscribe(callback) { this.status = callback; return this; }
    track(payload) { this.tracked.push(payload); return Promise.resolve(trackResult); }
    untrack() { this.untracked += 1; return Promise.resolve('ok'); }
    presenceState() { return this.state; }
    emit(event) {
      this.handlers.filter(handler => handler.kind === 'presence' && handler.filter.event === event)
        .forEach(handler => handler.callback());
    }
  }
  const supabase = {
    realtime: { setAuth: () => Promise.resolve() },
    channel(topic, config) { const channel = new Channel(topic, config); channels.push(channel); return channel; },
    removeChannel(channel) { channel.removed = true; return Promise.resolve('ok'); },
  };
  const lifecycle = {
    isActive: true,
    onForeground(callback) { foreground.add(callback); return () => foreground.delete(callback); },
    onBackground(callback) { background.add(callback); return () => background.delete(callback); },
  };
  const loaded = load(chatSource, {
    'expo-crypto': { randomUUID: () => 'device-key' },
    '@/template': { getSupabaseClient: () => supabase },
    '@/modules/core/AppLifecycle': { AppLifecycle: lifecycle },
  });
  return { service: new loaded.ChatPresenceServiceImpl(), channels, foreground, background };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

test('CHAT owns its presence boundary while Battle keeps the shared manager', () => {
  assert.match(contextSource, /ChatPresenceService/);
  assert.doesNotMatch(contextSource, /modules\/realtime\/PresenceManager/);
  assert.match(battleSource, /modules\/realtime\/PresenceManager/);
  assert.match(battleSource, /PresenceManager\.subscribe/);
  assert.match(battleSource, /PresenceManager\.fetchPresence/);
  assert.doesNotMatch(sharedSource, /chat-presence:|chat-typing:|chat_can_observe_presence|chat_can_access_realtime_conversation/);
});

test('no non-CHAT consumer imports the CHAT presence service', () => {
  const consumers = execFileSync('git', ['grep', '-l', 'ChatPresenceService', '--', 'app', 'components', 'contexts', 'hooks', 'modules', 'services'], { encoding: 'utf8' })
    .trim().split(/\r?\n/).filter(Boolean);
  assert.deepEqual(consumers.filter(file => file !== 'services/chatPresenceService.ts'), ['contexts/MessagesContext.tsx']);
});

test('B1 changes no Battle, LIVE, call, Agora, finance, or migration file', () => {
  const changed = execFileSync('git', ['diff', '--name-only', BASE], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
  assert.equal(changed.some(file => /^(app\/battle|app\/live|hooks\/(gaming|streaming)|modules\/(gaming|streaming)|.*Agora|.*agora|supabase\/migrations|services\/financial|.*wallet|.*ledger|.*marketplace)/.test(file)), false);
});

test('CHAT-V2-A and B migrations remain byte-for-byte unchanged', () => {
  for (const file of [
    'supabase/migrations/20260906222020_chat_v2_a_canonical_foundation.sql',
    'supabase/migrations/20260906231826_chat_v2_b_presence_receipts_ui.sql',
  ]) {
    const baseBlob = execFileSync('git', ['rev-parse', `${BASE}:${file}`], { encoding: 'utf8' }).trim();
    const worktreeBlob = execFileSync('git', ['hash-object', `--path=${file}`, file], { encoding: 'utf8' }).trim();
    assert.equal(worktreeBlob, baseBlob);
  }
});

test('self presence is private and tracks only after SUBSCRIBED', async () => {
  const h = harness(); h.service.initialize('user-a'); await tick();
  const self = h.channels.find(channel => channel.topic === 'chat-presence:user-a');
  assert.ok(self); assert.equal(self.config.config.private, true); assert.equal(self.tracked.length, 0);
  assert.equal(h.service.currentStatus, 'offline');
  self.status('SUBSCRIBED'); await tick();
  assert.deepEqual(self.tracked, [{ user_id: 'user-a', online_at: self.tracked[0].online_at }]);
  assert.equal(h.service.currentStatus, 'online');
});

test('track failure never reports a false online state', async () => {
  const h = harness({ trackResult: 'error' }); h.service.initialize('user-a'); await tick();
  h.channels[0].status('SUBSCRIBED'); await tick();
  assert.equal(h.service.currentStatus, 'offline');
});

test('presence remains online until the final remote device leaves', async () => {
  const h = harness(); const statuses = [];
  h.service.initialize('me'); h.service.onPresenceChange(users => {
    const partner = users.find(user => user.userId === 'partner');
    if (partner?.presence) statuses.push(partner.presence.status);
  });
  h.service.watchUsers(['partner']); await tick();
  const watcher = h.channels.find(channel => channel.topic === 'chat-presence:partner');
  watcher.state = { deviceA: [{ user_id: 'partner' }], deviceB: [{ user_id: 'partner' }] }; watcher.emit('sync');
  watcher.state = { deviceB: [{ user_id: 'partner' }] }; watcher.emit('leave');
  assert.equal(statuses.at(-1), 'online');
  watcher.state = {}; watcher.emit('leave');
  assert.equal(statuses.at(-1), 'offline');
});

test('background untracks CHAT and foreground creates fresh channels', async () => {
  const h = harness(); h.service.initialize('me'); h.service.watchUsers(['partner']); await tick();
  const self = h.channels.find(channel => channel.topic === 'chat-presence:me'); self.status('SUBSCRIBED'); await tick();
  const firstWatcher = h.channels.find(channel => channel.topic === 'chat-presence:partner');
  [...h.background][0](); await tick(); await tick();
  assert.equal(self.untracked, 1); assert.equal(self.removed, true); assert.equal(firstWatcher.removed, true);
  [...h.foreground][0](); await tick();
  assert.equal(h.channels.filter(channel => channel.topic === 'chat-presence:me').length, 2);
  assert.equal(h.channels.filter(channel => channel.topic === 'chat-presence:partner').length, 2);
});

test('logout removes channels and account switch fences the old callback', async () => {
  const h = harness(); h.service.initialize('old'); await tick();
  const old = h.channels.find(channel => channel.topic === 'chat-presence:old');
  h.service.initialize('new'); await tick();
  assert.equal(old.removed, true); old.status('SUBSCRIBED'); await tick(); assert.equal(old.tracked.length, 0);
  const current = h.channels.find(channel => channel.topic === 'chat-presence:new'); current.status('SUBSCRIBED'); await tick();
  assert.equal(h.service.currentStatus, 'online');
  await h.service.destroy();
  assert.equal(current.removed, true); assert.equal(h.service.currentStatus, 'offline');
});

test('watchers deduplicate, remove only stale partners, and ignore stale callbacks', async () => {
  const h = harness(); const snapshots = [];
  h.service.initialize('me'); h.service.onPresenceChange(users => snapshots.push(users.map(user => user.userId).sort()));
  h.service.watchUsers(['one']); h.service.watchUsers(['one', 'two']); await tick();
  assert.equal(h.channels.filter(channel => channel.topic === 'chat-presence:one').length, 1);
  assert.equal(h.channels.filter(channel => channel.topic === 'chat-presence:two').length, 1);
  const one = h.channels.find(channel => channel.topic === 'chat-presence:one');
  const two = h.channels.find(channel => channel.topic === 'chat-presence:two');
  h.service.unwatchUsers(['one']); one.state = { old: [{ user_id: 'one' }] }; one.emit('sync');
  assert.equal(one.removed, true); assert.equal(two.removed, false);
  assert.deepEqual(snapshots.at(-1), ['two']);
  await h.service.destroy(); assert.equal(two.removed, true);
});

test('MessagesProvider explicitly owns initialization and complete cleanup', () => {
  assert.match(contextSource, /ChatPresenceService\.initialize\(userId\)/);
  assert.match(contextSource, /ChatPresenceService\.unwatchUsers/);
  assert.match(contextSource, /ChatPresenceService\.destroy\(\)/);
  assert.match(contextSource, /activeUserRef\.current !== userId \|\| generation !== generationRef\.current/);
});
