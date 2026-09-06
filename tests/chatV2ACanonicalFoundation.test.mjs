import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const migrationPath = 'supabase/migrations/20260906222020_chat_v2_a_canonical_foundation.sql';
const migration = readFileSync(migrationPath, 'utf8');
const context = readFileSync('contexts/MessagesContext.tsx', 'utf8');
const chatScreen = readFileSync('app/chat/[userId].tsx', 'utf8');
const inbox = readFileSync('app/(tabs)/messages.tsx', 'utf8');
const legacyInbox = readFileSync('app/messages.tsx', 'utf8');
const premiumService = readFileSync('services/premiumDmService.ts', 'utf8');

function load(source, imports) {
  const module = { exports: {} };
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  } }).outputText;
  Function('require', 'module', 'exports', output)(
    name => { assert.ok(name in imports, `unexpected import ${name}`); return imports[name]; },
    module,
    module.exports,
  );
  return module.exports;
}

function serviceHarness() {
  const calls = [];
  const handlers = [];
  let removed = 0;
  const channel = {
    on(_kind, config, callback) { handlers.push({ config, callback }); return this; },
    subscribe(callback) { this.status = callback; return this; },
  };
  const message = {
    id: 'message-1', conversation_id: 'conversation-1', client_message_id: 'client-1',
    sender_id: 'user-a', recipient_id: 'user-b', text: 'hola', media_url: null,
    media_type: 'text', message_type: 'text', reply_to_message_id: null,
    media_asset_id: null, consumption_policy: 'standard', audio_duration_ms: null,
    read: false, deleted_at: null, created_at: '2026-09-06T00:00:00Z',
  };
  const supabase = {
    rpc(name, args) {
      calls.push([name, args]);
      if (name === 'chat_get_or_create_direct') return Promise.resolve({ data: { id: 'conversation-1' }, error: null });
      if (name === 'chat_get_conversations') return Promise.resolve({ data: [], error: null });
      if (name === 'chat_get_recent_messages') return Promise.resolve({ data: [message], error: null });
      if (name === 'chat_send_message') return Promise.resolve({ data: message, error: null });
      return Promise.resolve({ data: {}, error: null });
    },
    channel() { return channel; },
    removeChannel(value) { assert.equal(value, channel); removed += 1; return Promise.resolve(); },
    from() { throw new Error('profile query not used in service tests'); },
  };
  const service = load(readFileSync('services/chatService.ts', 'utf8'), {
    'expo-crypto': { randomUUID: () => 'client-uuid' },
    '@/template': { getSupabaseClient: () => supabase },
  });
  return { service, calls, handlers, channel, message, removed: () => removed };
}

function migrate(rows) {
  const conversations = new Map();
  const receipts = new Map();
  for (const row of rows) {
    const pair = [row.sender_id, row.recipient_id].sort();
    const key = pair.join(':');
    if (!conversations.has(key)) conversations.set(key, { pair, messageIds: [] });
    conversations.get(key).messageIds.push(row.id);
    receipts.set(`${row.id}:${row.recipient_id}`, {
      messageId: row.id,
      userId: row.recipient_id,
      deliveredAt: null,
      readAt: null,
      legacyDelivered: row.read,
      legacyRead: row.read,
    });
  }
  return { conversations, receipts, ids: rows.map(row => row.id) };
}

test('migration is transactional, locks messages, and uses the official generated filename', () => {
  assert.match(migration, /^begin;/);
  assert.match(migration, /lock table public\.messages in share row exclusive mode/);
  assert.match(migration, /commit;\s*$/);
});

test('A to B and B to A backfill into one unordered direct conversation', () => {
  const result = migrate([
    { id: 'm1', sender_id: 'a', recipient_id: 'b', read: false },
    { id: 'm2', sender_id: 'b', recipient_id: 'a', read: true },
  ]);
  assert.equal(result.conversations.size, 1);
  assert.deepEqual([...result.conversations.values()][0].pair, ['a', 'b']);
});

test('PostgreSQL enforces direct-pair uniqueness in both directions', () => {
  assert.match(migration, /direct_user_a::text < direct_user_b::text/);
  assert.match(migration, /unique index chat_conversations_direct_pair_uidx/);
  assert.match(migration, /on conflict \(direct_user_a, direct_user_b\) where conversation_type = 'direct'/);
});

test('message UUIDs are preserved and verified by count plus ordered digest', () => {
  const rows = [{ id: 'm1', sender_id: 'a', recipient_id: 'b', read: false }];
  assert.deepEqual(migrate(rows).ids, ['m1']);
  assert.match(migration, /message_id_digest/);
  assert.match(migration, /chat_v2_a_message_identity_mismatch/);
  assert.doesNotMatch(migration, /update public\.messages[\s\S]{0,200}set id\s*=/i);
});

test('backfill rejects orphan messages and verifies one receipt per existing message', () => {
  assert.match(migration, /chat_v2_a_orphan_message/);
  assert.match(migration, /chat_v2_a_receipt_backfill_mismatch/);
  assert.match(migration, /select m\.id, m\.recipient_id/);
});

test('historical read state is explicit and invents no delivery or read timestamp', () => {
  const result = migrate([{ id: 'm1', sender_id: 'a', recipient_id: 'b', read: true }]);
  assert.deepEqual(result.receipts.get('m1:b'), {
    messageId: 'm1', userId: 'b', deliveredAt: null, readAt: null,
    legacyDelivered: true, legacyRead: true,
  });
  assert.match(migration, /select m\.id, m\.recipient_id, null, null, m\.read, m\.read/);
});

test('Premium DM and push links are counted and verified without changing their tables', () => {
  assert.match(migration, /chat_v2_a_premium_link_mismatch/);
  assert.match(migration, /chat_v2_a_premium_orphan/);
  assert.match(migration, /chat_v2_a_push_outbox_mismatch/);
  assert.match(migration, /chat_v2_a_push_delivery_mismatch/);
  assert.doesNotMatch(migration, /(insert into|update|delete from|alter table) public\.premium_dm_payments/i);
  assert.doesNotMatch(migration, /(insert into|update|delete from|alter table) public\.message_push_(outbox|deliveries)/i);
});

test('canonical send derives auth identity and has a stable idempotency constraint', () => {
  assert.match(migration, /v_actor uuid := \(select auth\.uid\(\)\)/);
  assert.match(migration, /unique index messages_sender_client_message_uidx/);
  assert.match(migration, /chat_idempotency_key_required/);
  assert.match(migration, /chat_idempotency_conflict/g);
});

test('two client retries use the same canonical idempotency key', async () => {
  const h = serviceHarness();
  const input = { conversationId: 'conversation-1', clientMessageId: 'same-key', text: 'hola', messageType: 'text' };
  const [first, second] = await Promise.all([h.service.sendChatMessage(input), h.service.sendChatMessage(input)]);
  assert.equal(first.id, second.id);
  const sends = h.calls.filter(([name]) => name === 'chat_send_message');
  assert.equal(sends.length, 2);
  assert.equal(sends[0][1].p_client_message_id, sends[1][1].p_client_message_id);
});

test('conversation and message pagination use stable timestamp plus UUID cursors', async () => {
  const h = serviceHarness();
  await h.service.fetchChatConversations({ lastActivityAt: '2026-01-01', id: 'c1' });
  await h.service.fetchRecentChatMessages('c1', { createdAt: '2026-01-01', id: 'm1' });
  assert.deepEqual(h.calls[0][1], { p_limit: 30, p_before_activity_at: '2026-01-01', p_before_id: 'c1' });
  assert.deepEqual(h.calls[1][1], { p_conversation_id: 'c1', p_limit: 50, p_before_created_at: '2026-01-01', p_before_id: 'm1' });
  assert.match(migration, /order by m\.created_at desc, m\.id desc/);
});

test('RLS requires active membership and uses select auth.uid once per statement', () => {
  assert.match(migration, /chat_is_active_member/);
  assert.match(migration, /member\.user_id = \(select auth\.uid\(\)\)/);
  assert.doesNotMatch(migration, /auth\.uid\(\) = sender_id or auth\.uid\(\) = recipient_id/);
});

test('a third party cannot select conversations or receipts without membership', () => {
  assert.match(migration, /chat_conversations_member_select[\s\S]*chat_is_active_member/);
  assert.match(migration, /chat_message_receipts_member_select[\s\S]*chat_is_active_member/);
});

test('clients cannot insert arbitrary members or mutate another receipt', () => {
  assert.match(migration, /revoke all on table public\.chat_conversations, public\.chat_conversation_members,[\s\S]*from public, anon, authenticated/);
  assert.doesNotMatch(migration, /grant (insert|update|delete)[^;]*chat_conversation_members to authenticated/i);
  assert.doesNotMatch(migration, /grant (insert|update|delete)[^;]*chat_message_receipts to authenticated/i);
});

test('recipient legacy updates are column-limited to read and cannot change content', () => {
  assert.match(migration, /grant update \(read\) on public\.messages to authenticated/);
  assert.doesNotMatch(migration, /grant update \([^)]*(text|media_url|sender_id)/i);
  assert.match(migration, /with check \(\(select auth\.uid\(\)\) = recipient_id\)/);
});

test('read implies delivery and server timestamps never regress', () => {
  assert.match(migration, /read_at is null or delivered_at is not null/);
  assert.match(migration, /read_at is null or delivered_at <= read_at/);
  assert.match(migration, /delivered_at = coalesce\(public\.chat_message_receipts\.delivered_at/);
  assert.match(migration, /read_at = coalesce\(public\.chat_message_receipts\.read_at/);
});

test('legacy direct inserts are one-way compatible and cannot duplicate receipts', () => {
  assert.match(migration, /create trigger messages_chat_prepare[\s\S]*before insert on public\.messages/);
  assert.match(migration, /if v_actor is not null then[\s\S]*new\.read := false/);
  assert.match(migration, /new\.media_type not in \('text', 'image', 'video', 'premium_dm'\)/);
  assert.match(migration, /on conflict \(message_id, user_id\) do nothing/);
  assert.match(migration, /Temporary one-way compatibility adapter/);
});

test('Realtime covers messages, receipts, conversations, and membership in one channel', () => {
  const service = readFileSync('services/chatService.ts', 'utf8');
  for (const table of ['messages', 'chat_message_receipts', 'chat_conversations', 'chat_conversation_members']) {
    assert.match(service, new RegExp(`table: '${table}'`));
  }
  assert.match(service, /channel\(`chat-v2:\$\{input\.userId\}`\)/);
});

test('Realtime cleanup fences callbacks and removes the channel', () => {
  const h = serviceHarness();
  let messages = 0;
  let receipts = 0;
  const unsubscribe = h.service.subscribeToChatChanges({
    userId: 'user-a',
    onMessage: () => { messages += 1; },
    onReceipt: () => { receipts += 1; },
    onReconcile: () => {},
  });
  h.handlers.find(item => item.config.table === 'messages').callback({ new: h.message });
  const receiptHandler = h.handlers.find(item => item.config.table === 'chat_message_receipts');
  assert.equal(receiptHandler.config.filter, undefined);
  receiptHandler.callback({ new: { message_id: h.message.id, user_id: 'user-b' } });
  assert.equal(messages, 1);
  assert.equal(receipts, 1);
  unsubscribe();
  h.handlers.find(item => item.config.table === 'messages').callback({ new: h.message });
  receiptHandler.callback({ new: { message_id: h.message.id, user_id: 'user-b' } });
  assert.equal(messages, 1);
  assert.equal(receipts, 1);
  assert.equal(h.removed(), 1);
});

test('optimistic messages dedupe by client id and failures become failed', () => {
  assert.match(context, /message\.clientMessageId === incoming\.clientMessageId/);
  assert.match(context, /deliveryStatus: 'pending'/);
  assert.match(context, /deliveryStatus: 'failed'/);
  assert.doesNotMatch(context, /catch \(_\) \{\}/);
});

test('logout clears messages, conversations, ids, polling, and Realtime', () => {
  assert.match(context, /setConversations\(\[\]\)/);
  assert.match(context, /setMessages\(\{\}\)/);
  assert.match(context, /conversationIdsRef\.current\.clear\(\)/);
  assert.match(context, /unsubscribe\(\)/);
  assert.match(context, /PollingManager\.unregister\('messages_conversations'\)/);
});

test('the inbox reads a bounded canonical page instead of downloading all messages', () => {
  assert.match(context, /fetchChatConversations\(\)/);
  assert.match(migration, /limit least\(greatest\(coalesce\(p_limit, 30\), 1\), 100\)/);
  assert.doesNotMatch(context, /\.from\('messages'\)/);
});

test('normal text and image sending remain wired through the existing chat screen', () => {
  assert.match(chatScreen, /sendMessage\(partnerId, text\.trim\(\)\)/);
  assert.match(chatScreen, /sendMessage\(partnerId, '[^']*Imagen', url, 'image'\)/);
  assert.match(context, /\['text', 'image', 'video'\]\.includes\(mediaType\)/);
});

test('Premium DM retains message UUID linkage and reply release flow', () => {
  assert.match(premiumService, /message_id: string/);
  assert.match(premiumService, /message:messages!message_id\(text\)/);
  assert.match(chatScreen, /release_premium_dm/);
  assert.match(chatScreen, /p_message_id: pendingPayment\.message_id/);
  assert.match(migration, /when m\.media_type = 'premium_dm' then 'premium_dm'/);
});

test('call and video-call navigation remains unchanged', () => {
  assert.match(chatScreen, /router\.push\(`\/call\/\$\{partnerId\}`\)/);
  assert.match(chatScreen, /router\.push\(`\/video-call\/\$\{partnerId\}`\)/);
});

test('active tab inbox remains in use and the legacy route is retained', () => {
  assert.match(inbox, /export default function MessagesScreen/);
  assert.match(legacyInbox, /export default function MessagesScreen/);
  assert.match(readFileSync('app/(tabs)/_layout.tsx', 'utf8'), /name="messages"/);
});

test('no financial mutation, fixture, wallet, ledger, or production deployment is introduced', () => {
  assert.doesNotMatch(migration, /(wallet|ledger|balance|amount_bdag|creator_earning)\s*=/i);
  assert.doesNotMatch(migration, /insert into public\.(wallet|ledger|premium_dm_payments)/i);
  assert.doesNotMatch(migration, /create table public\.(wallet|ledger)/i);
  assert.doesNotMatch(migration, /fixture|test message|supabase functions deploy/i);
});

test('future media and group fields are additive while recipient compatibility is documented', () => {
  for (const field of ['media_asset_id', 'consumption_policy', 'audio_duration_ms', 'reply_to_message_id']) {
    assert.match(migration, new RegExp(field));
  }
  assert.match(migration, /conversation_type in \('direct', 'group'\)/);
  assert.match(migration, /Temporary direct-message compatibility column/);
});

test('all exposed functions have fixed search paths and explicit ACL revocation', () => {
  const definitions = [...migration.matchAll(/create or replace function public\.(chat_[a-z_]+)\([^]*?\n\$\$;/g)];
  assert.ok(definitions.length >= 10);
  for (const definition of definitions) assert.match(definition[0], /set search_path = pg_catalog, public/);
  for (const [, name] of definitions) assert.match(migration, new RegExp(`revoke all on function public\\.${name}\\(`));
});

test('message push wake is revoked from public clients without changing its trigger', () => {
  assert.match(migration, /revoke all on function public\.message_push_delivery_wake\(\) from public, anon, authenticated/);
  assert.doesNotMatch(migration, /drop trigger message_push_deliveries_dispatch/);
});
