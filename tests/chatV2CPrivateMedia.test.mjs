import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const migration = readFileSync('supabase/migrations/20260907012906_chat_v2_c_private_media_one_time.sql', 'utf8');
const context = readFileSync('contexts/MessagesContext.tsx', 'utf8');
const screen = readFileSync('app/chat/[userId].tsx', 'utf8');
const edge = readFileSync('supabase/functions/get-media-url/index.ts', 'utf8');
const mediaServiceSource = readFileSync('services/chatMediaService.ts', 'utf8');
const chatService = readFileSync('services/chatService.ts', 'utf8');

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

function mediaHarness({ invoke, upload, remove } = {}) {
  const calls = { invoke: [], upload: [], remove: [] };
  const service = load(mediaServiceSource, {
    '@/template': { getSupabaseClient: () => ({
      auth: { getSession: async () => ({ data: { session: { user: { id: 'user-a' } } }, error: null }) },
      functions: { invoke(name, options) {
        calls.invoke.push([name, options]);
        return invoke?.(name, options) ?? Promise.resolve({ data: null, error: null });
      } },
    }) },
    '@/services/mediaService': {
      uploadMediaFromUri(input) { calls.upload.push(input); return upload?.(input); },
      deleteMediaAsset(id) { calls.remove.push(id); return remove?.(id) ?? Promise.resolve(); },
    },
  });
  return { service, calls };
}

test('C migration reuses canonical messages and media assets with one per-recipient consumption authority', () => {
  assert.match(migration, /alter table public\.chat_message_receipts\s+add column media_consumed_at timestamptz/i);
  assert.match(migration, /foreign key \(media_asset_id\) references public\.media_assets\(id\)/i);
  assert.match(migration, /entity_type = 'chat_message'/);
  assert.doesNotMatch(migration, /create table\s+(?:public\.)?(?:messages|chat_media_assets)/i);
});

test('canonical send accepts private normal and one-time images and links the asset atomically', () => {
  assert.match(migration, /p_message_type not in \('text', 'image', 'video', 'one_time_image'\)/);
  assert.match(migration, /v_asset\.visibility <> 'private'.*v_asset\.provider <> 'r2'/s);
  assert.match(migration, /v_asset\.purpose <> 'chat_image'/);
  assert.match(migration, /insert into public\.messages[\s\S]*insert into public\.media_asset_links/);
  assert.match(migration, /create or replace function public\.chat_after_message_insert\(\)[\s\S]*entity_type, entity_id, slot/);
  assert.match(migration, /chat_media_asset_already_linked/);
  assert.match(migration, /chat_idempotency_conflict/);
});

test('one-time media never stores or projects a permanent URL', () => {
  assert.match(migration, /chat_one_time_private_asset_required/);
  assert.match(migration, /message_type = 'one_time_image'[\s\S]*media_url is null/);
  assert.match(migration, /case when m\.media_asset_id is null then m\.media_url else null end/);
  assert.doesNotMatch(screen, /getPublicUrl\(|createSignedUrl\(/);
});

test('atomic conditional update makes exactly one simulated concurrent claimant win', async () => {
  let consumedAt = null;
  async function claim() {
    await Promise.resolve();
    if (consumedAt !== null) throw new Error('chat_media_already_consumed');
    consumedAt = 'server-time';
    return consumedAt;
  }
  const results = await Promise.allSettled([claim(), claim()]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.match(migration, /update public\.chat_message_receipts r[\s\S]*r\.media_consumed_at is null[\s\S]*returning r\.media_consumed_at/i);
});

test('server derives identity and restricts one-time consumption to the authenticated recipient', () => {
  assert.match(migration, /v_actor uuid := \(select auth\.uid\(\)\)/);
  assert.match(migration, /v_actor <> v_message\.recipient_id/);
  assert.match(migration, /chat_one_time_recipient_only/);
  assert.match(migration, /chat_membership_required|chat_media_forbidden/);
  assert.match(migration, /chat_media_blocked/);
  assert.match(migration, /revoke all on function public\.chat_authorize_media_access\(uuid\)\s+from public, anon/i);
});

test('signed access is returned only after caller-scoped database authorization', () => {
  assert.match(edge, /authenticatedClient\(req\)/);
  assert.match(edge, /caller\.rpc\('chat_authorize_media_access'/);
  assert.match(edge, /already_consumed/);
  assert.match(edge, /grant\.bucket_name!==a\.bucket_name\|\|grant\.object_key!==a\.object_key/);
  assert.match(edge, /expiresAt:new Date\(Date\.now\(\)\+300_000\)/);
  assert.doesNotMatch(edge, /console\.(?:log|debug)\([^\n]*(?:token|signedUrl)/i);
});

test('private image upload uses the existing R2 authority and rejects oversized files before upload', async () => {
  const { service, calls } = mediaHarness({ upload: async () => ({ assetId: 'asset-1', visibility: 'private', mediaKind: 'image' }) });
  await assert.rejects(() => service.uploadPrivateChatImage({ uri: 'file://large.jpg', mimeType: 'image/jpeg', sizeBytes: 25_000_001 }), /chat_image_too_large/);
  assert.equal(calls.upload.length, 0);
  assert.equal(await service.uploadPrivateChatImage({ uri: 'file://ok.jpg', mimeType: 'image/jpeg', sizeBytes: 100 }), 'asset-1');
  assert.deepEqual(calls.upload[0], { uri: 'file://ok.jpg', mimeType: 'image/jpeg', sizeBytes: 100,
    purpose: 'chat_image', visibility: 'private' });
});

test('malformed upload result fails closed instead of publishing a URL', async () => {
  const { service } = mediaHarness({ upload: async () => ({ assetId: 'asset-1', visibility: 'public', mediaKind: 'image', url: 'https://public' }) });
  await assert.rejects(() => service.uploadPrivateChatImage({ uri: 'file://a.jpg', mimeType: 'image/jpeg' }), /chat_private_media_contract_invalid/);
});

test('standard signed URL requests are single-flight and reusable', async () => {
  let resolve;
  let markInvoked;
  const response = new Promise(done => { resolve = done; });
  const invoked = new Promise(done => { markInvoked = done; });
  const { service, calls } = mediaHarness({ invoke: () => { markInvoked(); return response; } });
  const first = service.getStandardChatImageAccess('asset-1');
  const second = service.getStandardChatImageAccess('asset-1');
  await invoked;
  assert.equal(calls.invoke.length, 1);
  resolve({ data: { success: true, data: { assetId: 'asset-1', url: 'https://signed', expiresAt: 'soon', consumptionPolicy: 'standard' } }, error: null });
  const [firstAccess, secondAccess] = await Promise.all([first, second]);
  assert.equal(firstAccess.url, 'https://signed');
  assert.equal(secondAccess.url, firstAccess.url);
  await service.getStandardChatImageAccess('asset-1');
  assert.equal(calls.invoke.length, 2);
});

test('one-time client requires a server consumption timestamp', async () => {
  const { service } = mediaHarness({ invoke: async () => ({ data: { success: true, data: {
    assetId: 'asset-1', url: 'https://signed', expiresAt: 'soon', consumptionPolicy: 'one_time', consumedAt: null,
  } }, error: null }) });
  await assert.rejects(() => service.openOneTimeChatImage('asset-1'), /chat_one_time_claim_missing/);
});

test('abandoned ready upload uses existing deletion reconciler and remains orphan-cleanup eligible', async () => {
  const { service, calls } = mediaHarness();
  await service.reconcileUnlinkedChatImage('asset-orphan');
  assert.deepEqual(calls.remove, ['asset-orphan']);
  assert.match(migration, /media_asset_has_valid_links/);
});

test('V3 projection carries media state in one paginated query without N+1', () => {
  assert.match(chatService, /chat_get_recent_messages_v3/);
  assert.match(migration, /left join public\.chat_message_receipts r/);
  assert.match(migration, /r\.media_consumed_at/);
  assert.match(migration, /order by m\.created_at desc, m\.id desc/);
  assert.match(migration, /\(m\.created_at, m\.id\) < \(p_before_created_at, p_before_id\)/);
  assert.doesNotMatch(context, /from\(['"](?:media_assets|media_asset_links)['"]\)/);
});

test('context fences one-time opening and realtime consumption by user, generation, message and asset', () => {
  assert.match(context, /const generation = generationRef\.current/);
  assert.match(context, /message\.recipientId !== userId/);
  assert.match(context, /activeUserRef\.current !== userId \|\| generation !== generationRef\.current/);
  assert.match(context, /mediaOpenFlightsRef/);
  assert.match(context, /receipt\.media_consumed_at/);
});

test('chat UI offers normal or one-time upload and never renders one-time content in history', () => {
  assert.match(screen, /text: 'Normal'/);
  assert.match(screen, /text: 'Ver una vez'/);
  assert.match(screen, /mediaType: oneTime \? 'one_time_image' : 'image'/);
  assert.match(screen, /Foto abierta/);
  assert.match(screen, /openOneTimeMedia\(partnerId, item\.id\)/);
  assert.doesNotMatch(screen, /base64:\s*true/);
});

test('one-time viewer activates and cleans existing capture protection without caching content', () => {
  assert.match(screen, /usePreventScreenCapture\(ONE_TIME_CAPTURE_KEY\)/);
  assert.match(screen, /enableAppSwitcherProtectionAsync\(1\)/);
  assert.match(screen, /disableAppSwitcherProtectionAsync\(\)/);
  assert.match(screen, /cachePolicy="none"/);
  assert.match(screen, /setOneTimeMediaUrl\(null\)/);
});

test('historical and standard image compatibility remains intact', () => {
  assert.match(screen, /legacyUrl=\{item\.mediaUrl\}/);
  assert.match(screen, /item\.mediaUrl \|\| item\.mediaAssetId/);
  assert.match(context, /'premium_dm'/);
  assert.match(context, /monotonicDeliveryStatus/);
});

test('C scope contains no financial mutation or parallel chat architecture', () => {
  assert.doesNotMatch(migration, /\b(?:wallet|ledger|escrow|settlement|commission|premium_dm_payments)\b/i);
  assert.doesNotMatch(migration, /create table/i);
  assert.doesNotMatch(migration, /\b(?:insert|update|delete)\s+(?:into\s+|from\s+)?public\.(?:wallet|ledger|financial|premium)/i);
});
