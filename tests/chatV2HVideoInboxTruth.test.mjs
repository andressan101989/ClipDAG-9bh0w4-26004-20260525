import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const direct = read('app/chat/[userId].tsx');
const group = read('app/chat/group/[conversationId].tsx');
const inbox = read('app/(tabs)/messages.tsx');
const context = read('contexts/MessagesContext.tsx');
const chatMedia = read('services/chatMediaService.ts');
const mediaService = read('services/mediaService.ts');
const video = read('components/chat/PrivateChatVideo.tsx');
const purposes = read('supabase/functions/_shared/mediaPurposes.ts');
const getMediaUrl = read('supabase/functions/get-media-url/index.ts');
const createMediaUpload = read('supabase/functions/create-media-upload/index.ts');
const migration = read('supabase/migrations/20260907234811_chat_v2_h_video_inbox_truth.sql');

function accessResponse(assetId, url, expiresAt = new Date(Date.now() + 120_000).toISOString()) {
  return { data: { success: true, data: { assetId, url, expiresAt, consumptionPolicy: 'standard', consumedAt: null } }, error: null };
}

function loadChatMedia({ userId = 'user-a', invoke, upload } = {}) {
  let activeUserId = userId;
  let invokes = 0;
  const uploads = [];
  const module = { exports: {} };
  const output = ts.transpileModule(chatMedia, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const imports = {
    '@/template': { getSupabaseClient: () => ({
      auth: { getSession: async () => ({ data: { session: activeUserId ? { user: { id: activeUserId } } : null } }) },
      functions: { invoke: async (...args) => { invokes += 1; return invoke?.(...args) ?? accessResponse(args[1].body.asset_id, `https://signed/${activeUserId}/${args[1].body.asset_id}`); } },
    }) },
    '@/services/mediaService': {
      deleteMediaAsset: async () => undefined,
      uploadMediaFromUri: async input => { uploads.push(input); return upload?.(input) ?? {
        assetId: 'video-asset', provider: 'r2', mediaKind: 'video', purpose: 'chat_video', visibility: 'private', status: 'ready',
      }; },
    },
  };
  Function('require', 'module', 'exports', output)(name => imports[name], module, module.exports);
  return { api: module.exports, uploads, get invokes() { return invokes; }, setUser(next) { activeUserId = next; } };
}

test('direct normal picker accepts images and videos', () => {
  assert.match(direct, /mode === 'one-time' \? \['images'\] : \['images', 'videos'\]/);
});
test('one-time picker remains image-only', () => {
  assert.match(direct, /mode === 'one-time' \? \['images'\]/);
  assert.doesNotMatch(migration, /one_time_video/);
});
test('group picker accepts images and videos', () => assert.match(group, /mediaTypes: \['images', 'videos'\]/));
test('MP4 is accepted by the client contract', () => assert.match(chatMedia, /CHAT_VIDEO_MIME_TYPES = \['video\/mp4', 'video\/quicktime'\]/));
test('QuickTime is accepted by the client contract', () => assert.match(chatMedia, /'video\/quicktime'/));
test('videos over 100 MB are rejected client-side', async () => {
  const harness = loadChatMedia();
  await assert.rejects(harness.api.uploadPrivateChatVideo({ uri: 'file:///large.mp4', mimeType: 'video/mp4', sizeBytes: 100_000_001 }), /chat_video_too_large/);
  assert.equal(harness.uploads.length, 0);
});
test('chat video upload uses the chat_video purpose', async () => {
  const harness = loadChatMedia();
  assert.equal(await harness.api.uploadPrivateChatVideo({ uri: 'file:///ok.mp4', mimeType: 'video/mp4', sizeBytes: 10 }), 'video-asset');
  assert.equal(harness.uploads[0].purpose, 'chat_video');
});
test('chat video upload is private', async () => {
  const harness = loadChatMedia();
  await harness.api.uploadPrivateChatVideo({ uri: 'file:///ok.mov', mimeType: 'video/quicktime', sizeBytes: 10 });
  assert.equal(harness.uploads[0].visibility, 'private');
});
test('direct video sends its media asset id', () => assert.match(direct, /sendMediaMessage\(partnerId, \{ text: 'Video', mediaType: 'video', mediaAssetId \}\)/));
test('chat video does not send a media URL', () => {
  assert.match(migration, /p_message_type = 'video' and \(p_media_asset_id is null or p_media_url is not null\)/);
  assert.doesNotMatch(direct, /mediaType: 'video'[\s\S]{0,80}mediaUrl/);
});
test('message send waits for the READY upload result', () => {
  assert.ok(direct.indexOf('await uploadPrivateChatVideo') < direct.indexOf("mediaType: 'video'"));
  assert.ok(group.indexOf('await uploadPrivateChatVideo') < group.indexOf("mediaType: 'video'"));
  assert.match(mediaService, /status: "ready"/);
});
test('direct video renders the shared PrivateChatVideo', () => assert.match(direct, /isVideo \? <PrivateChatVideo assetId=\{item\.mediaAssetId\}/));
test('group video reuses the same PrivateChatVideo', () => assert.match(group, /item\.mediaType === 'video' \? <PrivateChatVideo assetId=\{item\.mediaAssetId\}/));
test('private video uses expo-video without autoplay', () => {
  assert.match(video, /useVideoPlayer\(url/);
  assert.match(video, /nativeControls/);
  assert.doesNotMatch(video, /\.play\(/);
});
test('video playback exposes a recoverable retry state', () => {
  assert.match(video, /status\.status === 'error'/);
  assert.match(video, /accessibilityLabel="Reintentar video"/);
});
test('inbox video preview is Video', () => assert.match(context, /message_type === 'video'\) return 'Video'/));

test('media purposes contains private 100 MB chat_video', () => {
  const rule = purposes.slice(purposes.indexOf('chat_video: {'), purposes.indexOf('chat_audio: {'));
  assert.match(rule, /kind: "video"/); assert.match(rule, /maxBytes: 100_000_000/); assert.match(rule, /defaultVisibility: "private"/);
});
test('create-media-upload consumes the canonical purpose validator', () => assert.match(createMediaUpload, /validateMediaRequest\(/));
test('public chat_video is rejected', () => assert.match(purposes, /defaultVisibility === "private" && visibility !== "private"/));
test('unsupported video MIME is rejected', async () => {
  const harness = loadChatMedia();
  await assert.rejects(harness.api.uploadPrivateChatVideo({ uri: 'file:///bad.webm', mimeType: 'video/webm', sizeBytes: 10 }), /chat_video_mime_invalid/);
});
test('get-media-url routes chat_video through chat authorization', () => {
  assert.match(getMediaUrl, /a\.purpose==='chat_image'\|\|a\.purpose==='chat_video'\|\|a\.purpose==='voice_note'/);
  assert.match(getMediaUrl, /caller\.rpc\('chat_authorize_media_access'/);
});
test('outsiders fail closed through chat_can_read_message', () => assert.match(migration, /not public\.chat_can_read_message\(v_message\.conversation_id, v_message\.created_at\)/));
test('direct participants use canonical chat authorization', () => assert.match(migration, /v_type = 'direct'[\s\S]*chat_media_blocked/));
test('group members use canonical chat authorization', () => assert.match(migration, /chat_can_read_message/));
test('inactive or non-members cannot read private chat video', () => assert.match(migration, /chat_can_read_message/));
test('blocked direct semantics remain enforced', () => assert.match(migration, /raise exception 'chat_media_blocked'/));
test('chat_send_message accepts direct video', () => assert.match(migration, /p_message_type not in \('text', 'image', 'video', 'one_time_image', 'voice'\)/));
test('chat_send_message accepts group video', () => assert.match(migration, /p_message_type not in \('text', 'image', 'video', 'voice'\)/));
test('another owner asset is rejected', () => assert.match(migration, /v_asset\.owner_id <> v_actor/));
test('non-ready assets are rejected', () => assert.match(migration, /v_asset\.status <> 'ready'/));
test('product_video is rejected as chat content', () => assert.match(migration, /v_asset\.purpose <> 'chat_video'/));
test('public assets and public URLs are rejected', () => {
  assert.match(migration, /v_asset\.visibility <> 'private'/); assert.match(migration, /v_asset\.public_url is not null/);
});
test('already-linked assets are rejected', () => assert.match(migration, /exists \(select 1 from public\.media_asset_links where asset_id = p_media_asset_id\)/));
test('idempotency comparison includes video media identity', () => {
  assert.match(migration, /v_existing\.media_asset_id is distinct from p_media_asset_id/);
  assert.match(migration, /chat_idempotency_conflict/);
});
test('one-time video remains unsupported', () => assert.doesNotMatch(context, /one_time_video/));

test('incoming last message has no outgoing indicator', () => assert.match(inbox, /lastMessageSenderId === user\?\.id/));
test('outgoing sent uses canonical indicator', () => assert.match(inbox, /MessageDeliveryIndicator status=\{item\.lastMessageDeliveryStatus\}/));
test('outgoing delivered uses canonical indicator', () => assert.match(read('components/chat/MessageDeliveryIndicator.tsx'), /status === 'sent' \? 'check' : 'check-all'/));
test('outgoing read uses the blue canonical indicator', () => assert.match(read('components/chat/MessageDeliveryIndicator.tsx'), /status === 'read' \? '#5EDCFF'/));
test('direct receipt counts are projected', () => assert.match(migration, /'recipient_count', receipt_counts\.recipient_count/));
test('group aggregate requires all recipients delivered', () => assert.match(migration, /delivered_count = receipt_counts\.recipient_count then 'delivered'/));
test('partial group delivery is not declared delivered', () => assert.match(migration, /recipient_count > 0 and receipt_counts\.delivered_count = receipt_counts\.recipient_count/));
test('partial group read is not declared read', () => assert.match(migration, /recipient_count > 0 and receipt_counts\.read_count = receipt_counts\.recipient_count/));
test('receipt updates reconcile the inbox without opening chat', () => {
  assert.match(context, /onReceipt:[\s\S]*reconcileAggregate\) \{ reconcile\(\); return; \}/);
  assert.match(context, /const reconcile = \(\) => \{[\s\S]*fetchConversations\(\)/);
});
test('unreadCount does not control the receipt indicator', () => {
  const indicator = inbox.slice(inbox.indexOf('item.lastMessageSenderId'), inbox.indexOf('<Text', inbox.indexOf('item.lastMessageSenderId')));
  assert.match(indicator, /lastMessageSenderId/); assert.doesNotMatch(indicator, /hasUnread/);
});
test('unread badge remains independent', () => assert.match(inbox, /hasUnread \? \([\s\S]*styles\.unreadBadge/));

test('Crear grupo remains in the header', () => assert.match(inbox, /accessibilityLabel="Crear grupo"/));
test('top pencil action is removed', () => {
  const header = inbox.slice(inbox.indexOf('<View style={styles.header}>'), inbox.indexOf('{/* ── Search'));
  assert.doesNotMatch(header, /pencil-outline|Nuevo mensaje/);
});
test('header magnify action is present', () => assert.match(inbox, /accessibilityLabel="Buscar conversaciones"[\s\S]*name="magnify"/));
test('header magnify focuses the existing input', () => {
  assert.match(inbox, /searchInputRef\.current\?\.focus\(\)/); assert.match(inbox, /ref=\{searchInputRef\}/);
});
test('dots-vertical is removed from Inbox', () => assert.doesNotMatch(inbox, /dots-vertical/));
test('Inbox header no longer navigates to notifications', () => assert.doesNotMatch(inbox, /router\.push\('\/notifications'\)/));
test('FAB keeps new-message navigation', () => assert.match(inbox, /accessibilityLabel="Nuevo mensaje"[\s\S]*router\.push\('\/new-message'\)/));
test('FAB keeps TAB_BAR_HEIGHT plus 14 clearance', () => assert.match(inbox, /bottom: TAB_BAR_HEIGHT \+ 14/));

test('video cache is scoped to the authenticated session user', async () => {
  const harness = loadChatMedia();
  const first = await harness.api.getStandardChatVideoAccess('same-video');
  const again = await harness.api.getStandardChatVideoAccess('same-video');
  assert.equal(harness.invokes, 1); assert.equal(again.url, first.url);
  harness.setUser('user-b');
  const other = await harness.api.getStandardChatVideoAccess('same-video');
  assert.equal(harness.invokes, 2); assert.notEqual(other.url, first.url);
});
test('cross-account video in-flight requests are isolated', async () => {
  const pending = new Map(); let requestUser = 'user-a';
  const harness = loadChatMedia({ invoke: (_name, { body }) => new Promise(resolve => {
    const scope = requestUser; pending.set(scope, () => resolve(accessResponse(body.asset_id, `https://signed/${scope}/${body.asset_id}`)));
  }) });
  const a = harness.api.getStandardChatVideoAccess('flight-video');
  await new Promise(resolve => setImmediate(resolve));
  requestUser = 'user-b'; harness.setUser('user-b');
  const b = harness.api.getStandardChatVideoAccess('flight-video');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.invokes, 2);
  pending.get('user-b')(); pending.get('user-a')();
  assert.notEqual((await a).url, (await b).url);
});
test('video cache honors actual expiry', async () => {
  const harness = loadChatMedia({ invoke: (_name, { body }) => accessResponse(body.asset_id, 'https://signed/short', new Date(Date.now() + 20_000).toISOString()) });
  await harness.api.getStandardChatVideoAccess('short-video'); await harness.api.getStandardChatVideoAccess('short-video');
  assert.equal(harness.invokes, 2);
});
test('standard private media cache keeps a 30-second safety margin', () => assert.match(chatMedia, /CACHE_SAFETY_MS = 30_000/));
test('standard private media cache is bounded to 64 LRU entries', async () => {
  const harness = loadChatMedia();
  for (let i = 0; i < 65; i += 1) await harness.api.getStandardChatVideoAccess(`lru-video-${i}`);
  await harness.api.getStandardChatVideoAccess('lru-video-0');
  assert.equal(harness.invokes, 66);
});
test('one-time access bypasses the standard cache', () => {
  assert.doesNotMatch(chatMedia.slice(chatMedia.indexOf('openOneTimeChatImage')), /standardPrivateMediaAccessCache/);
});
test('voice reuses the same standard private media cache authority', () => assert.match(chatMedia, /getStandardChatVoiceAccess[\s\S]*getStandardPrivateChatMediaAccess/));

test('migration changes only three canonical functions', () => {
  assert.equal((migration.match(/create or replace function public\./g) || []).length, 3);
  assert.doesNotMatch(migration, /create table|alter table|create policy|create index/i);
});
test('security definer functions retain safe search paths', () => {
  assert.equal((migration.match(/security definer/g) || []).length, 2);
  assert.equal((migration.match(/set search_path to 'pg_catalog', 'public'/g) || []).length, 3);
});
test('canonical ACL remains authenticated and service-role only', () => {
  assert.equal((migration.match(/revoke all on function/g) || []).length, 3);
  assert.equal((migration.match(/to authenticated, service_role/g) || []).length, 3);
});
test('no parallel media receipt or inbox architecture is introduced', () => {
  const all = direct + group + context + chatMedia + migration;
  assert.doesNotMatch(all, /chat_get_conversations_v2|chat_get_inbox_receipts|chatVideoUploadService|InboxReceiptService|one_time_video/);
});
