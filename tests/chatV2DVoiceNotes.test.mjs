import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const migration = readFileSync('supabase/migrations/20260907030000_chat_v2_d_voice_notes.sql', 'utf8');
const serviceSource = readFileSync('services/chatVoiceService.ts', 'utf8');
const mediaSource = readFileSync('services/chatMediaService.ts', 'utf8');
const chatService = readFileSync('services/chatService.ts', 'utf8');
const context = readFileSync('contexts/MessagesContext.tsx', 'utf8');
const screen = readFileSync('app/chat/[userId].tsx', 'utf8');
const recorder = readFileSync('components/chat/VoiceRecorderBar.tsx', 'utf8');
const bubble = readFileSync('components/chat/VoiceMessageBubble.tsx', 'utf8');
const edge = readFileSync('supabase/functions/get-media-url/index.ts', 'utf8');

function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function loadReliability() {
  const source = readFileSync('services/chatReliability.ts', 'utf8');
  const module = { exports: {} };
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  Function('require', 'module', 'exports', output)(() => ({}), module, module.exports);
  return module.exports;
}

function loadService({ permission = { granted: true, canAskAgain: true }, requested = { granted: true }, upload, access } = {}) {
  const modes = []; let requestCount = 0; const deleted = [];
  const fileSizes = new Map();
  class MockFile {
    constructor(...parts) {
      this.uri = parts.join('/').replace('file:///cache/', 'file:///cache/');
      this.exists = true;
      this.type = '';
    }
    get size() { return fileSizes.get(this.uri) ?? 256; }
    copy(destination) { fileSizes.set(destination.uri, this.size); }
    delete() { deleted.push(this.uri); this.exists = false; fileSizes.delete(this.uri); }
  }
  const module = { exports: {} };
  const output = ts.transpileModule(serviceSource, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const imports = {
    'expo-audio': {
      RecordingPresets: { HIGH_QUALITY: {
        extension: '.m4a', sampleRate: 44100, numberOfChannels: 2, bitRate: 128000,
        android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
        ios: { outputFormat: 'aac ' }, web: { mimeType: 'audio/webm', bitsPerSecond: 128000 },
      } },
      getRecordingPermissionsAsync: async () => permission,
      requestRecordingPermissionsAsync: async () => { requestCount += 1; return requested; },
      setAudioModeAsync: async mode => { modes.push(mode); },
    },
    'expo-file-system': { File: MockFile, Paths: { cache: 'file:///cache' } },
    '@/services/chatMediaService': {
      uploadPrivateVoiceNote: upload ?? (async input => { loadService.lastUpload = input; return 'asset-1'; }),
      getStandardChatVoiceAccess: access ?? (async () => ({ url: 'https://signed.example/audio' })),
    },
  };
  Function('require', 'module', 'exports', output)(name => imports[name], module, module.exports);
  return { api: module.exports, modes, deleted, get requestCount() { return requestCount; } };
}

test('metering normalizes silence and peak into the canonical 0..100 range', () => {
  const { api } = loadService();
  assert.equal(api.meteringToVoiceLevel(-60), 0);
  assert.equal(api.meteringToVoiceLevel(-30), 50);
  assert.equal(api.meteringToVoiceLevel(0), 100);
  assert.equal(api.meteringToVoiceLevel(undefined), 0);
});

test('waveform is deterministic, exactly 48 samples and bounded', () => {
  const { api } = loadService();
  const result = api.normalizeVoiceWaveform([-10, 25.6, 140, 50]);
  assert.equal(result.length, 48);
  assert.ok(result.every(value => Number.isInteger(value) && value >= 0 && value <= 100));
  assert.deepEqual(result, api.normalizeVoiceWaveform([-10, 25.6, 140, 50]));
});

test('permission already granted does not prompt again', async () => {
  const h = loadService(); assert.equal(await h.api.ensureChatVoicePermission(), true); assert.equal(h.requestCount, 0);
});

test('permission denial prompts once only when the OS allows it', async () => {
  const h = loadService({ permission: { granted: false, canAskAgain: true }, requested: { granted: false } });
  assert.equal(await h.api.ensureChatVoicePermission(), false); assert.equal(h.requestCount, 1);
  const blocked = loadService({ permission: { granted: false, canAskAgain: false } });
  assert.equal(await blocked.api.ensureChatVoicePermission(), false); assert.equal(blocked.requestCount, 0);
});

test('recording mode and playback restoration explicitly clear microphone routing', async () => {
  const h = loadService(); await h.api.enableChatVoiceRecordingMode(); await h.api.restoreChatVoicePlaybackMode();
  assert.equal(h.modes[0].allowsRecording, true);
  assert.equal(h.modes[1].allowsRecording, false);
  assert.equal(h.modes[1].shouldRouteThroughEarpiece, false);
  assert.equal(h.modes[1].shouldPlayInBackground, false);
});

test('speed sequence is 1x, 1.5x, 2x and wraps to 1x', () => {
  const { api } = loadService();
  assert.equal(api.nextVoiceSpeed(1), 1.5); assert.equal(api.nextVoiceSpeed(1.5), 2); assert.equal(api.nextVoiceSpeed(2), 1);
});

test('voice draft uploads through private voice_note authority', async () => {
  let input; const h = loadService({ upload: async value => { input = value; return 'voice-asset'; } });
  const id = await h.api.uploadChatVoiceDraft({ uri: 'file:///voice.m4a', mimeType: 'audio/mp4', durationMs: 1200, waveform: Array(48).fill(50) });
  assert.equal(id, 'voice-asset'); assert.equal(input.mimeType, 'audio/mp4'); assert.equal(input.durationMs, 1200);
  assert.equal(input.sizeBytes, 256); assert.match(input.fileName, /\.m4a$/); assert.equal(input.uri.startsWith('file:\/\/\/cache\/'), true);
});

test('private voice helper rejects public or malformed upload results and invalid MIME', () => {
  assert.match(mediaSource, /purpose:\s*'voice_note'[\s\S]*visibility:\s*'private'/);
  assert.match(mediaSource, /asset\.visibility !== 'private'[\s\S]*asset\.mediaKind !== 'audio'[\s\S]*asset\.purpose !== 'voice_note'[\s\S]*asset\.url/);
  assert.match(mediaSource, /CHAT_VOICE_MIME_TYPES\.includes/);
  assert.match(mediaSource, /CHAT_VOICE_MAX_BYTES = 100_000_000/);
});

test('signed voice playback reuses the CHAT media authorization endpoint', async () => {
  const h = loadService(); assert.equal(await h.api.getChatVoicePlaybackUrl('asset-1'), 'https://signed.example/audio');
  assert.match(edge, /a\.purpose==='chat_image'\|\|a\.purpose==='chat_video'\|\|a\.purpose==='voice_note'/);
  assert.match(edge, /caller\.rpc\('chat_authorize_media_access'/);
});

test('cancel discards only the local cache file without creating an asset', () => {
  const h = loadService(); h.api.discardChatVoiceDraft('file:///draft.m4a'); assert.deepEqual(h.deleted, ['file:///draft.m4a']);
  assert.match(recorder, /cleanupResources[\s\S]*stopRecorder\(\)[\s\S]*discardChatVoiceDraft/);
  assert.match(recorder, /const cancel[\s\S]*lifecycle\.invalidate\(\)/);
});

test('recorder uses one expo-audio recorder with metering and bounded duration', () => {
  assert.equal((recorder.match(/useAudioRecorder\(/g) || []).length, 1);
  assert.match(recorder, /isMeteringEnabled:\s*true/);
  assert.match(recorder, /durationMillis >= CHAT_VOICE_MAX_DURATION_MS[\s\S]*stopToDraft/);
  assert.doesNotMatch(recorder, /expo-av/);
});

test('recorder cleanup covers background, identity changes and unmount', () => {
  assert.match(recorder, /AppLifecycle\.onBackground\([\s\S]*cancel/);
  assert.match(recorder, /lifecycle\.invalidate\(\)/);
  assert.doesNotMatch(recorder, /const cancel[\s\S]{0,150}operationRef\.current\) return/);
  assert.match(recorder, /restoreChatVoicePlaybackMode/);
});

test('voice bubble supports play pause resume seek and completion reset', () => {
  assert.match(bubble, /player\.play\(\)/); assert.match(bubble, /player\.pause\(\)/);
  assert.match(bubble, /player\.seekTo/); assert.match(bubble, /didJustFinish[\s\S]*seekSafely\(0, false\)/);
  assert.match(bubble, /runPlayerCallSafely/);
  assert.match(bubble, /activeMessageId === messageId/);
});

test('playback rate uses high pitch correction for every supported speed', () => {
  assert.match(bubble, /setPlaybackRate\(next, 'high'\)/);
  assert.match(bubble, /setPlaybackRateSafely\(speed\)/);
});

test('CHAT context carries voice metadata through optimistic send and retry', () => {
  assert.match(context, /sendVoiceMessage/);
  assert.match(context, /mediaType:\s*'voice'[\s\S]*audioDurationMs:\s*input\.durationMs[\s\S]*audioWaveform:\s*input\.waveform/);
  assert.match(context, /audioDurationMs:\s*message\.audioDurationMs[\s\S]*audioWaveform:\s*message\.audioWaveform/);
  assert.match(context, /ChatRetryCoordinator/);
});

test('canonical client sends voice through the single chat_send_message authority', () => {
  assert.match(chatService, /messageType: Extract<ChatMessageType,[^\n]*'voice'/);
  assert.match(chatService, /p_audio_duration_ms:/); assert.match(chatService, /p_audio_waveform:/);
  assert.match(chatService, /chat_get_recent_messages_v3/);
  assert.match(migration, /drop function public\.chat_get_recent_messages_v3/);
  assert.doesNotMatch(chatService, /chat_send_voice/);
});

test('server validates duration and every one of 48 bounded samples', () => {
  assert.match(migration, /array_length\(p_audio_waveform, 1\) is distinct from 48/);
  assert.match(migration, /array_position\(p_audio_waveform, null\) is not null/);
  assert.match(migration, /0 <= all\(p_audio_waveform\)[\s\S]*100 >= all\(p_audio_waveform\)/);
  assert.match(migration, /p_audio_duration_ms not between 1 and 3600000/);
});

test('server requires owned ready private R2 voice_note audio with no public URL', () => {
  assert.match(migration, /v_asset\.owner_id <> v_actor[\s\S]*v_asset\.visibility <> 'private'[\s\S]*v_asset\.provider <> 'r2'[\s\S]*v_asset\.public_url is not null/);
  assert.match(migration, /v_asset\.media_kind <> 'audio' or v_asset\.purpose <> 'voice_note'/);
  assert.match(migration, /p_media_url is not null[\s\S]*chat_private_media_contract_invalid/);
});

test('voice authorization is member-only, block-aware and does not consume receipts', () => {
  const voiceBranch = migration.slice(migration.indexOf("if v_message.message_type = 'voice'"), migration.indexOf("elsif v_asset.media_kind"));
  assert.match(migration, /chat_conversation_members[\s\S]*cm\.user_id = v_actor and cm\.is_active/);
  assert.match(migration, /blocked_users/);
  assert.match(voiceBranch, /consumption_policy <> 'standard'/);
  assert.doesNotMatch(voiceBranch, /media_consumed_at/);
});

test('anon and PUBLIC cannot execute voice-capable RPCs', () => {
  assert.match(migration, /revoke all on function public\.chat_send_message[\s\S]*from public, anon/);
  assert.match(migration, /revoke all on function public\.chat_authorize_media_access\(uuid\)[\s\S]*from public, anon/);
  assert.match(migration, /set search_path = pg_catalog, public/g);
});

test('old named chat_send_message calls remain valid through defaulted audio parameters', () => {
  assert.match(migration, /p_reply_to_message_id uuid default null,\s*p_audio_duration_ms integer default null,\s*p_audio_waveform smallint\[\] default null/);
  assert.match(migration, /p_message_type <> 'voice' and \(p_audio_duration_ms is not null or p_audio_waveform is not null\)/);
});

test('idempotency compares voice duration waveform asset and message type', () => {
  assert.match(migration, /v_existing\.message_type <> p_message_type/);
  assert.match(migration, /v_existing\.media_asset_id is distinct from p_media_asset_id/);
  assert.match(migration, /v_existing\.audio_duration_ms is distinct from p_audio_duration_ms/);
  assert.match(migration, /v_existing\.audio_waveform is distinct from p_audio_waveform/);
});

test('UI uses compact recorder and voice bubble without changing calls or Premium DM', () => {
  assert.match(screen, /VoiceRecorderBar/); assert.match(screen, /VoiceMessageBubble/);
  assert.match(screen, /handleSendVoice[\s\S]*voiceDraftSenderRef\.current![\s\S]*sendVoiceMessage/);
  assert.ok(screen.includes('router.push(`/call/${partnerId}`)'));
  assert.ok(screen.includes('router.push(`/video-call/${partnerId}`)'));
  assert.match(screen, /send_premium_dm/);
});

test('D migration changes no financial, marketplace, LIVE, Battle or Agora object', () => {
  assert.doesNotMatch(migration, /\b(wallet|ledger|escrow|gift|marketplace|live_battle|agora|premium_dm_payments)\b/i);
});

test('transport failure transfers the uploaded voice to one failed optimistic message', async () => {
  const { api } = loadService();
  let uploads = 0; let ids = 0; const logical = [];
  const draft = { uri: 'file:///retry.m4a', mimeType: 'audio/mp4', durationMs: 1800, waveform: Array(48).fill(42) };
  const sender = new api.ChatVoiceDraftSender(async () => { uploads += 1; return 'asset-stable'; });
  const outcome = await sender.handoff(draft, async input => {
    const message = { clientMessageId: `client-${++ids}`, ...input, deliveryStatus: 'pending' };
    logical.push(message);
    return api.acceptChatVoiceRetryOwnership(message, async current => {
      current.deliveryStatus = 'failed';
      throw new Error('network_lost');
    });
  });
  assert.equal(outcome.transportFailed, true);
  assert.equal(uploads, 1); assert.equal(ids, 1); assert.equal(logical.length, 1);
  assert.equal(logical[0].deliveryStatus, 'failed');
  assert.equal(logical[0].mediaAssetId, 'asset-stable');
});

test('canonical retry reuses client id asset duration waveform and performs no second upload', async () => {
  const { api } = loadService(); const { ChatRetryCoordinator } = loadReliability();
  let uploads = 0; let attempts = 0; const draft = {
    uri: 'file:///same.m4a', mimeType: 'audio/mp4', durationMs: 2300, waveform: Array.from({ length: 48 }, (_, i) => i),
  };
  const sender = new api.ChatVoiceDraftSender(async () => { uploads += 1; return 'asset-one'; });
  let failed;
  await sender.handoff(draft, async input => {
    failed = { clientMessageId: 'client-one', ...input, deliveryStatus: 'pending' };
    return api.acceptChatVoiceRetryOwnership(failed, async current => {
      attempts += 1; current.deliveryStatus = 'failed'; throw new Error('offline');
    });
  });
  const original = structuredClone(failed); const retry = new ChatRetryCoordinator();
  await retry.run(`user:partner:${failed.clientMessageId}`, async () => {
    attempts += 1; failed.deliveryStatus = 'sent';
  });
  assert.equal(uploads, 1); assert.equal(attempts, 2);
  assert.equal(failed.clientMessageId, original.clientMessageId);
  assert.equal(failed.mediaAssetId, original.mediaAssetId);
  assert.equal(failed.durationMs, original.durationMs);
  assert.deepEqual(failed.waveform, original.waveform);
});

test('lost server response and retry converge on one canonical logical message', async () => {
  const { api } = loadService(); const server = new Map(); let calls = 0;
  const operation = { clientMessageId: 'client-lost-response', mediaAssetId: 'asset-lost-response',
    durationMs: 3100, waveform: Array(48).fill(61), deliveryStatus: 'pending' };
  const persist = async message => {
    calls += 1;
    if (!server.has(message.clientMessageId)) server.set(message.clientMessageId, 'message-canonical');
    if (calls === 1) { message.deliveryStatus = 'failed'; throw new Error('response_lost'); }
    message.id = server.get(message.clientMessageId); message.deliveryStatus = 'sent';
  };
  const first = await api.acceptChatVoiceRetryOwnership(operation, persist);
  assert.equal(first.transportFailed, true); await persist(operation);
  assert.equal(server.size, 1); assert.equal(operation.id, 'message-canonical'); assert.equal(operation.deliveryStatus, 'sent');
});

test('background while permission is pending fences startup and restores audio mode', async () => {
  const { api } = loadService(); const permission = deferred(); let records = 0; let restores = 0;
  const lifecycle = new api.ChatVoiceRecorderLifecycle(async () => { restores += 1; });
  const startup = api.startChatVoiceRecorder({ lifecycle, ensurePermission: () => permission.promise,
    enableRecordingMode: async () => undefined, prepare: async () => undefined, record: () => { records += 1; } });
  const background = lifecycle.invalidate(); await background.cleanup; permission.resolve(true);
  assert.equal(await startup, 'stale'); assert.equal(records, 0); assert.ok(restores >= 1);
});

test('background while prepare is pending never calls record', async () => {
  const { api } = loadService(); const preparing = deferred(); let records = 0; let restores = 0; let prepareStarted = false;
  const lifecycle = new api.ChatVoiceRecorderLifecycle(async () => { restores += 1; });
  const startup = api.startChatVoiceRecorder({ lifecycle, ensurePermission: async () => true,
    enableRecordingMode: async () => undefined, prepare: () => { prepareStarted = true; return preparing.promise; },
    record: () => { records += 1; } });
  while (!prepareStarted) await Promise.resolve();
  const background = lifecycle.invalidate(); await background.cleanup; preparing.resolve();
  assert.equal(await startup, 'stale'); assert.equal(records, 0); assert.ok(restores >= 1);
});

test('identity switch and unmount invalidate startup without stale state callbacks', async () => {
  const { api } = loadService(); const permission = deferred(); let startedCallbacks = 0; let restores = 0;
  const lifecycle = new api.ChatVoiceRecorderLifecycle(async () => { restores += 1; });
  const startup = api.startChatVoiceRecorder({ lifecycle, ensurePermission: () => permission.promise,
    enableRecordingMode: async () => undefined, prepare: async () => undefined, record: () => { startedCallbacks += 1; } });
  const accountSwitch = lifecycle.invalidate(); const unmount = lifecycle.invalidate();
  permission.resolve(true); await Promise.all([accountSwitch.cleanup, unmount.cleanup]);
  assert.equal(await startup, 'stale'); assert.equal(startedCallbacks, 0); assert.ok(restores >= 1);
});

test('background during active recording stops exactly once and cleanup is single-flight', async () => {
  const { api } = loadService(); let recording = false; let stops = 0; let restores = 0;
  const stopDeferred = deferred(); const stopGate = new api.ChatVoiceRecorderStopGate();
  const cleanup = async () => {
    await stopGate.stop(() => recording, async () => { stops += 1; await stopDeferred.promise; recording = false; });
    restores += 1;
  };
  const lifecycle = new api.ChatVoiceRecorderLifecycle(cleanup);
  assert.equal(await api.startChatVoiceRecorder({ lifecycle, ensurePermission: async () => true,
    enableRecordingMode: async () => undefined, prepare: async () => undefined, record: () => { recording = true; } }), 'started');
  const background = lifecycle.invalidate(); const unmount = lifecycle.invalidate();
  stopDeferred.resolve(); await Promise.all([background.cleanup, unmount.cleanup]);
  assert.equal(stops, 1); assert.equal(recording, false); assert.equal(restores, 1);
});
