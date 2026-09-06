import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const migration = readFileSync('supabase/migrations/20260906231826_chat_v2_b_presence_receipts_ui.sql', 'utf8');
const context = readFileSync('contexts/MessagesContext.tsx', 'utf8');
const screen = readFileSync('app/chat/[userId].tsx', 'utf8');
const inbox = readFileSync('app/(tabs)/messages.tsx', 'utf8');
const legacyInbox = readFileSync('app/messages.tsx', 'utf8');
const presenceSource = readFileSync('modules/realtime/PresenceManager.ts', 'utf8');

function load(source, imports = {}) {
  const module = { exports: {} };
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  Function('require', 'module', 'exports', output)(name => {
    assert.ok(name in imports, `unexpected import ${name}`); return imports[name];
  }, module, module.exports);
  return module.exports;
}

const reliability = load(readFileSync('services/chatReliability.ts', 'utf8'));

function fakeClock() {
  let now = 0; let nextId = 1; const tasks = new Map();
  return {
    now: () => now,
    setTimeout(fn, delay) { const id = nextId++; tasks.set(id, { at: now + delay, fn }); return id; },
    clearTimeout(id) { tasks.delete(id); },
    advance(ms) {
      now += ms;
      for (const [id, task] of [...tasks].sort((a, b) => a[1].at - b[1].at)) {
        if (task.at <= now) { tasks.delete(id); task.fn(); }
      }
    },
    pending: () => tasks.size,
  };
}

function loadTyping() {
  return load(readFileSync('services/chatTypingSession.ts', 'utf8'), { '@/template': { getSupabaseClient() { throw new Error('unused'); } } });
}

function typingSessionHarness() {
  const channels = [];
  class Channel {
    constructor(topic, config) { this.topic = topic; this.config = config; this.handlers = []; this.sent = []; }
    on(kind, filter, callback) { this.handlers.push({ kind, filter, callback }); return this; }
    subscribe(callback) { queueMicrotask(() => callback('SUBSCRIBED')); return this; }
    send(event) { this.sent.push(event); return Promise.resolve('ok'); }
    emit(payload) { this.handlers.filter(h => h.kind === 'broadcast' && h.filter.event === 'typing').forEach(h => h.callback({ payload })); }
  }
  const supabase = {
    realtime: { setAuth: () => Promise.resolve() },
    channel(topic, config) { const channel = new Channel(topic, config); channels.push(channel); return channel; },
    removeChannel(channel) { channel.removed = true; return Promise.resolve('ok'); },
  };
  const typing = load(readFileSync('services/chatTypingSession.ts', 'utf8'), { '@/template': { getSupabaseClient: () => supabase } });
  return { typing, channels };
}

function serviceHarness() {
  const calls = [];
  const row = { id: 'm1', conversation_id: 'c1', client_message_id: 'k1', sender_id: 'a', recipient_id: 'b',
    text: 'hola', media_url: null, media_type: 'text', message_type: 'text', reply_to_message_id: null,
    media_asset_id: null, consumption_policy: 'standard', audio_duration_ms: null, read: false, deleted_at: null,
    created_at: '2026-01-01T00:00:00Z', delivered_at: '2026-01-01T00:00:01Z', read_at: null,
    legacy_delivered: false, legacy_read: false, delivery_status: 'delivered' };
  const supabase = { rpc(name, args) { calls.push([name, args]); return Promise.resolve({ data: name === 'chat_acknowledge_pending_deliveries' ? 7 : [row], error: null }); } };
  const service = load(readFileSync('services/chatService.ts', 'utf8'), {
    'expo-crypto': { randomUUID: () => 'uuid' }, '@/template': { getSupabaseClient: () => supabase },
  });
  return { service, calls, row };
}

function presenceHarness() {
  const channels = [];
  const foreground = new Set(); const background = new Set();
  class Channel {
    constructor(topic, config) { this.topic = topic; this.config = config; this.handlers = []; this.state = {}; this.tracked = []; this.untracked = 0; }
    on(kind, filter, callback) { this.handlers.push({ kind, filter, callback }); return this; }
    subscribe(callback) { this.status = callback; return this; }
    track(payload) { this.tracked.push(payload); return Promise.resolve('ok'); }
    untrack() { this.untracked += 1; return Promise.resolve('ok'); }
    presenceState() { return this.state; }
    emit(event) { this.handlers.filter(h => h.kind === 'presence' && h.filter.event === event).forEach(h => h.callback()); }
  }
  const supabase = {
    realtime: { setAuth: () => Promise.resolve() },
    channel(topic, config) { const channel = new Channel(topic, config); channels.push(channel); return channel; },
    removeChannel(channel) { channel.removed = true; return Promise.resolve('ok'); },
  };
  const lifecycle = { isActive: true,
    onForeground(fn) { foreground.add(fn); return () => foreground.delete(fn); },
    onBackground(fn) { background.add(fn); return () => background.delete(fn); } };
  const manager = load(presenceSource, {
    'expo-crypto': { randomUUID: () => 'device-key' }, '@/template': { getSupabaseClient: () => supabase },
    '../core/AppLifecycle': { AppLifecycle: lifecycle }, '../core/EventBus': { EventBus: { emit() {} } },
  }).PresenceManager;
  return { manager, channels, foreground, background };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

test('persisted, delivered and read states are monotonic', () => {
  assert.equal(reliability.monotonicDeliveryStatus('sent', 'delivered'), 'delivered');
  assert.equal(reliability.monotonicDeliveryStatus('delivered', 'read'), 'read');
  assert.equal(reliability.monotonicDeliveryStatus('read', 'delivered'), 'read');
  assert.equal(reliability.monotonicDeliveryStatus('delivered', 'sent'), 'delivered');
});

test('failed optimistic state is recoverable but cannot degrade persisted state', () => {
  assert.equal(reliability.monotonicDeliveryStatus('pending', 'failed'), 'failed');
  assert.equal(reliability.monotonicDeliveryStatus('failed', 'sent'), 'sent');
  assert.equal(reliability.monotonicDeliveryStatus('read', 'failed'), 'read');
});

test('read gate requires exact user, foreground, partner and generation', () => {
  const base = { authenticatedUserId: 'a', expectedUserId: 'a', activePartnerId: 'b', messagePartnerId: 'b', appActive: true, generation: 2, expectedGeneration: 2 };
  assert.equal(reliability.isChatReadEligible(base), true);
  assert.equal(reliability.isChatReadEligible({ ...base, appActive: false }), false);
  assert.equal(reliability.isChatReadEligible({ ...base, activePartnerId: 'c' }), false);
  assert.equal(reliability.isChatReadEligible({ ...base, generation: 3 }), false);
  assert.equal(reliability.isChatReadEligible({ ...base, authenticatedUserId: null }), false);
});

test('retry double tap shares one Promise and one attempt', async () => {
  const coordinator = new reliability.ChatRetryCoordinator(); let attempts = 0; let release;
  const task = () => { attempts += 1; return new Promise(resolve => { release = resolve; }); };
  const first = coordinator.run('a:b:key', task); const second = coordinator.run('a:b:key', task);
  assert.equal(first, second); assert.equal(attempts, 1); assert.equal(coordinator.size, 1);
  release(); await first; assert.equal(coordinator.size, 0);
});

test('failed retry can run again with the same idempotency key', async () => {
  const coordinator = new reliability.ChatRetryCoordinator(); let attempts = 0;
  await assert.rejects(coordinator.run('same', async () => { attempts += 1; throw new Error('network'); }));
  await coordinator.run('same', async () => { attempts += 1; });
  assert.equal(attempts, 2);
});

test('typing starts once per throttle window and sends no content', async () => {
  const { TypingSignalController, CHAT_TYPING_THROTTLE_MS } = loadTyping();
  const clock = fakeClock(); const signals = [];
  const controller = new TypingSignalController(async value => { signals.push(value); }, () => {}, clock);
  await controller.setLocalTyping(true); await controller.setLocalTyping(true);
  clock.advance(CHAT_TYPING_THROTTLE_MS); await controller.setLocalTyping(true);
  assert.deepEqual(signals, [true, true]);
});

test('typing stops on empty text and send', async () => {
  const { TypingSignalController } = loadTyping(); const signals = [];
  const controller = new TypingSignalController(async value => { signals.push(value); }, () => {}, fakeClock());
  await controller.setLocalTyping(false); await controller.stop(); assert.deepEqual(signals, [false, false]);
});

test('remote typing expires and dispose cancels timers', () => {
  const { TypingSignalController, CHAT_TYPING_EXPIRES_MS } = loadTyping();
  const clock = fakeClock(); const states = [];
  const controller = new TypingSignalController(async () => {}, state => states.push(state), clock);
  controller.receiveRemote(true); clock.advance(CHAT_TYPING_EXPIRES_MS - 1); assert.deepEqual(states, [true]);
  clock.advance(1); assert.deepEqual(states, [true, false]);
  controller.receiveRemote(true); controller.dispose(); assert.equal(clock.pending(), 0); assert.deepEqual(states.slice(-2), [true, false]);
});

test('typing session binds send identity to its private topic and listens only to partner topic', async () => {
  const h = typingSessionHarness(); const remote = [];
  const session = await h.typing.createChatTypingSession({
    userId: 'user-a', partnerId: 'user-b', conversationId: 'conversation-1', generation: 4,
    onRemoteChange: value => remote.push(value),
  });
  assert.deepEqual(h.channels.map(channel => channel.topic), [
    'chat-typing:conversation-1:user-a', 'chat-typing:conversation-1:user-b',
  ]);
  assert.equal(h.channels.every(channel => channel.config.config.private), true);
  await session.setTyping(true);
  assert.deepEqual(h.channels[0].sent[0].payload, { conversation_id: 'conversation-1', generation: 4, typing: true });
  h.channels[0].emit({ conversation_id: 'conversation-1', typing: true });
  assert.deepEqual(remote, []);
  h.channels[1].emit({ conversation_id: 'conversation-1', typing: true });
  assert.deepEqual(remote, [true]);
  await session.dispose();
  assert.equal(h.channels.every(channel => channel.removed), true);
});

test('receipt projection and stable compound cursor use one RPC', async () => {
  const h = serviceHarness(); const rows = await h.service.fetchRecentChatMessages('c1', { createdAt: 't', id: 'm1' });
  assert.equal(rows[0].delivery_status, 'delivered');
  assert.deepEqual(h.calls[0], ['chat_get_recent_messages_v2', { p_conversation_id: 'c1', p_limit: 50, p_before_created_at: 't', p_before_id: 'm1' }]);
});

test('pending deliveries reconcile in one bounded batch', async () => {
  const h = serviceHarness(); assert.equal(await h.service.acknowledgePendingChatDeliveries(200), 7);
  assert.deepEqual(h.calls[0], ['chat_acknowledge_pending_deliveries', { p_limit: 200 }]);
});

test('presence tracks authenticated self only after subscription', async () => {
  const h = presenceHarness(); h.manager.initialize('user-a'); await tick(); await tick();
  const self = h.channels.find(c => c.topic === 'chat-presence:user-a'); assert.ok(self); assert.equal(self.tracked.length, 0);
  self.status('SUBSCRIBED'); assert.equal(self.tracked.length, 1); assert.equal(self.tracked[0].user_id, 'user-a');
  assert.equal(self.config.config.private, true);
});

test('presence sync treats either of two devices as online', async () => {
  const h = presenceHarness(); h.manager.initialize('me'); await tick(); await tick();
  const states = []; const unsubscribe = h.manager.subscribe('partner', p => states.push(p.status));
  await tick();
  const watcher = h.channels.find(c => c.topic === 'chat-presence:partner');
  watcher.state = { one: [{ user_id: 'partner' }], two: [{ user_id: 'partner' }] }; watcher.emit('sync');
  watcher.state = { two: [{ user_id: 'partner' }] }; watcher.emit('leave'); assert.equal(states.at(-1), 'online');
  watcher.state = {}; watcher.emit('leave'); assert.equal(states.at(-1), 'offline'); unsubscribe();
});

test('background untracks self and foreground creates a new tracked channel', async () => {
  const h = presenceHarness(); h.manager.initialize('me'); await tick(); await tick();
  const first = h.channels.find(c => c.topic === 'chat-presence:me'); first.status('SUBSCRIBED');
  [...h.background][0](); await tick(); assert.equal(first.untracked, 1); assert.equal(first.removed, true);
  [...h.foreground][0](); await tick(); assert.equal(h.channels.filter(c => c.topic === 'chat-presence:me').length, 2);
});

test('logout and account change remove channels and fence old callbacks', async () => {
  const h = presenceHarness(); h.manager.initialize('old'); await tick(); await tick(); const old = h.channels[0];
  h.manager.initialize('new'); await tick(); await tick(); assert.equal(old.removed, true);
  old.status('SUBSCRIBED'); assert.equal(old.tracked.length, 0);
  await h.manager.destroy(); assert.equal(h.manager.currentStatus, 'offline');
});

test('SQL batch ACK is recipient-only, monotonic and never reads', () => {
  assert.match(migration, /m\.recipient_id = v_actor and m\.sender_id <> v_actor/);
  assert.match(migration, /chat_acknowledge_pending_deliveries/);
  assert.match(migration, /delivered_at = coalesce\(public\.chat_message_receipts\.delivered_at/);
  const ack = migration.slice(migration.indexOf('chat_acknowledge_pending_deliveries'), migration.indexOf('chat_acknowledge_read_batch'));
  assert.doesNotMatch(ack, /read_at\s*=/);
});

test('read batch accepts only loaded IDs owned by the authenticated recipient', () => {
  assert.match(migration, /chat_acknowledge_read_batch\(p_message_ids uuid\[\]\)/);
  assert.match(migration, /m\.recipient_id = v_actor and m\.sender_id <> v_actor/);
  assert.match(migration, /cardinality\(p_message_ids\), 0\) > 500/);
  assert.match(context, /messagesRef\.current\[partnerId\]/);
  assert.match(context, /acknowledgeChatReads\(loadedIds\)/);
  assert.match(context, /markConversationRead\(partnerId, ordered\)/);
});

test('SQL projection restores receipt status without N+1 or invented history', () => {
  assert.match(migration, /left join public\.chat_message_receipts r/);
  assert.match(migration, /r\.read_at is not null or coalesce\(r\.legacy_read, false\) or m\.read/);
  assert.match(migration, /r\.delivered_at is not null or coalesce\(r\.legacy_delivered, false\)/);
  assert.doesNotMatch(migration, /legacy_read[^\n]*now\(\)/);
});

test('private presence and typing topics are authorized by active membership', () => {
  assert.match(migration, /extension = 'presence'/); assert.match(migration, /extension = 'broadcast'/);
  assert.match(migration, /chat_can_observe_presence/); assert.match(migration, /chat_can_access_realtime_conversation/);
  assert.match(migration, /chat_realtime_typing_publisher\(\(select realtime\.topic\(\)\)\) = \(select auth\.uid\(\)\)/);
  assert.match(migration, /mine\.user_id = \(select auth\.uid\(\)\) and mine\.is_active/);
  assert.match(migration, /chat_realtime_broad_policy_detected/);
});

test('presence privacy and both-way blocks are enforced server-side', () => {
  assert.match(migration, /not up\.hide_activity/);
  assert.match(migration, /b\.blocker_id = \(select auth\.uid\(\)\) and b\.blocked_id = p_target/);
  assert.match(migration, /b\.blocker_id = p_target and b\.blocked_id = \(select auth\.uid\(\)\)/);
});

test('canonical sends cannot bypass blocks or message audience', () => {
  assert.match(migration, /chat_interaction_blocked/); assert.match(migration, /chat_recipient_messages_disabled/);
  assert.match(migration, /chat_recipient_followers_only/); assert.match(migration, /f\.follower_id = v_actor and f\.following_id = v_recipient/);
});

test('Realtime channels are private and typing payload excludes message text', () => {
  assert.match(presenceSource, /config: \{ private: true/);
  const typing = readFileSync('services/chatTypingSession.ts', 'utf8'); assert.match(typing, /private: true/);
  assert.match(typing, /`chat-typing:\$\{input\.conversationId\}:\$\{input\.userId\}`/);
  assert.match(typing, /`chat-typing:\$\{input\.conversationId\}:\$\{input\.partnerId\}`/);
  assert.doesNotMatch(typing, /payload: \{[^}]*user_id/);
  assert.doesNotMatch(typing, /payload: \{[^}]*text/);
});

test('UI maps every delivery state and retry is accessible', () => {
  for (const state of ['pending', 'sent', 'read', 'failed']) assert.match(screen, new RegExp(`deliveryStatus === '${state}'`));
  assert.match(screen, /clock-outline/); assert.match(screen, /check-all/); assert.match(screen, /Reintentar mensaje/);
  assert.match(screen, /retryMessage\(partnerId, item\.clientMessageId\)/);
});

test('push is never used as delivery or read authority', () => {
  assert.doesNotMatch(context, /(push|notification).*deliveryStatus/i);
  assert.doesNotMatch(migration, /message_push[^\n]*(delivered_at|read_at)/i);
});

test('focused foreground conversation reads new messages; background cannot', () => {
  assert.match(context, /activePartnerRef\.current === partnerId && AppLifecycle\.isActive/);
  assert.match(context, /AppLifecycle\.onBackground/); assert.match(context, /AppLifecycle\.onForeground/);
  assert.match(context, /markConversationRead\(partnerId\)/);
});

test('pagination prepends through dedupe and preserves visible content', () => {
  assert.match(context, /loadOlderMessages/); assert.match(context, /olderFlightRef\.current\.has\(partnerId\)/);
  assert.match(context, /mergeMany\(previous\[partnerId\] \|\| \[\]/);
  assert.match(screen, /maintainVisibleContentPosition/); assert.match(screen, /contentOffset\.y <= 24/);
  assert.doesNotMatch(screen, /usePolling/);
});

test('same timestamp pagination remains stable by UUID', () => {
  assert.match(migration, /\(m\.created_at, m\.id\) < \(p_before_created_at, p_before_id\)/);
  assert.match(migration, /order by m\.created_at desc, m\.id desc/);
});

test('receipts and polling cannot regress newer UI state', () => {
  assert.match(context, /monotonicDeliveryStatus\(message\.deliveryStatus, deliveryStatus\)/);
  assert.match(context, /mergeChatMessage\(previous\[partnerId\] \|\| \[\], mapChatMessage\(row\)\)/);
});

test('failed send rejects caller and Premium release follows durable reply', () => {
  assert.match(context, /message send failed[\s\S]*throw error/);
  const sendBlock = screen.slice(screen.indexOf('const handleSend = useCallback'), screen.indexOf('// ── Send premium DM'));
  assert.ok(sendBlock.indexOf('await sendMessage') < sendBlock.indexOf("release_premium_dm"));
  assert.match(sendBlock, /catch/);
  assert.match(sendBlock, /if \(!text\.trim\(\) \|\| !partnerId \|\| isSendingRef\.current\) return/);
  assert.ok(sendBlock.indexOf('isSendingRef.current = true') < sendBlock.indexOf('await sendMessage'));
});

test('logout clears messages, flights, cursors, channels and typing', () => {
  for (const token of ['setMessages({})', 'cursorsRef.current.clear()', 'retryFlightRef.current.clear()', 'unsubscribe()', 'typingSessionRef.current?.dispose()']) {
    assert.ok(context.includes(token), token);
  }
});

test('active inbox uses real presence and legacy route no longer equates unread with online', () => {
  assert.match(inbox, /presenceByUser\[item\.partnerId\] === 'online'/);
  assert.match(legacyInbox, /online=\{presenceByUser\[item\.partnerId\] === 'online'\}/);
  assert.match(screen, /presenceByUser\[partnerId \|\| ''\] === 'online'[\s\S]{0,220}<Text style=\{styles\.onlineText\}>En línea<\/Text>/);
});

test('typing UI is conversation-fenced and clears on close and background', () => {
  assert.match(context, /activePartnerRef\.current !== partnerId/);
  assert.match(context, /generation !== generationRef\.current/);
  assert.match(screen, /setConversationTyping\(partnerId, false\)/);
  assert.match(screen, /Escribiendo…/);
});

test('calls, video calls, Premium DM, normal image and push navigation remain wired', () => {
  assert.match(screen, /router\.push\(`\/call\/\$\{partnerId\}`\)/);
  assert.match(screen, /router\.push\(`\/video-call\/\$\{partnerId\}`\)/);
  assert.match(screen, /send_premium_dm/); assert.match(screen, /sendMessage\(partnerId, '[^']*Imagen', url, 'image'\)/);
  assert.match(readFileSync('services/messageNotificationPresentation.ts', 'utf8'), /setActiveMessageChat/);
});

test('migration changes no financial, marketplace, LIVE, battle or Agora object', () => {
  assert.doesNotMatch(migration, /(insert into|update|delete from|alter table) public\.(wallet|ledger|premium_dm_payments|gifts|marketplace)/i);
  assert.doesNotMatch(migration, /(agora|live_battle|media_relay)/i);
});

test('no runtime component writes the removed user_presence table', () => {
  assert.doesNotMatch(presenceSource, /user_presence/);
  assert.doesNotMatch(readFileSync('modules/realtime/ConnectionManager.ts', 'utf8'), /user_presence/);
});

test('migration is transactional, additive to V2-A and locked down', () => {
  assert.match(migration, /^begin;/); assert.match(migration, /commit;\s*$/);
  assert.match(migration, /revoke all on function public\.chat_acknowledge_pending_deliveries\(integer\) from public, anon/);
  assert.doesNotMatch(migration, /20260906222020_chat_v2_a_canonical_foundation/);
});

test('canonical and legacy inbox routes are retained with the tab route canonical', () => {
  assert.match(readFileSync('app/(tabs)/_layout.tsx', 'utf8'), /name="messages"/);
  assert.match(inbox, /export default function MessagesScreen/); assert.match(legacyInbox, /export default function MessagesScreen/);
});
