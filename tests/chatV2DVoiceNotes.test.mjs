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

function loadService({ permission = { granted: true, canAskAgain: true }, requested = { granted: true }, upload, access } = {}) {
  const modes = []; let requestCount = 0; const deleted = [];
  const module = { exports: {} };
  const output = ts.transpileModule(serviceSource, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const imports = {
    'expo-audio': {
      getRecordingPermissionsAsync: async () => permission,
      requestRecordingPermissionsAsync: async () => { requestCount += 1; return requested; },
      setAudioModeAsync: async mode => { modes.push(mode); },
    },
    'expo-file-system': { File: class { constructor(uri) { this.uri = uri; this.exists = true; } delete() { deleted.push(this.uri); } } },
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
});

test('private voice helper rejects public or malformed upload results and invalid MIME', () => {
  assert.match(mediaSource, /purpose:\s*'voice_note'[\s\S]*visibility:\s*'private'/);
  assert.match(mediaSource, /asset\.visibility !== 'private'[\s\S]*asset\.mediaKind !== 'audio'[\s\S]*asset\.purpose !== 'voice_note'[\s\S]*asset\.url/);
  assert.match(mediaSource, /CHAT_VOICE_MIME_TYPES\.includes/);
  assert.match(mediaSource, /CHAT_VOICE_MAX_BYTES = 100_000_000/);
});

test('signed voice playback reuses the CHAT media authorization endpoint', async () => {
  const h = loadService(); assert.equal(await h.api.getChatVoicePlaybackUrl('asset-1'), 'https://signed.example/audio');
  assert.match(edge, /a\.purpose==='chat_image'\|\|a\.purpose==='voice_note'/);
  assert.match(edge, /caller\.rpc\('chat_authorize_media_access'/);
});

test('cancel discards only the local cache file without creating an asset', () => {
  const h = loadService(); h.api.discardChatVoiceDraft('file:///draft.m4a'); assert.deepEqual(h.deleted, ['file:///draft.m4a']);
  assert.match(recorder, /cancel[\s\S]*recorder\.stop\(\)[\s\S]*discardChatVoiceDraft/);
});

test('recorder uses one expo-audio recorder with metering and bounded duration', () => {
  assert.equal((recorder.match(/useAudioRecorder\(/g) || []).length, 1);
  assert.match(recorder, /isMeteringEnabled:\s*true/);
  assert.match(recorder, /durationMillis >= CHAT_VOICE_MAX_DURATION_MS[\s\S]*stopToDraft/);
  assert.doesNotMatch(recorder, /expo-av/);
});

test('recorder cleanup covers background, identity changes and unmount', () => {
  assert.match(recorder, /AppLifecycle\.onBackground\([\s\S]*cancel/);
  assert.match(recorder, /generationRef\.current \+= 1[\s\S]*cancelRef\.current/);
  assert.match(recorder, /restoreChatVoicePlaybackMode/);
});

test('voice bubble supports play pause resume seek and completion reset', () => {
  assert.match(bubble, /player\.play\(\)/); assert.match(bubble, /player\.pause\(\)/);
  assert.match(bubble, /player\.seekTo/); assert.match(bubble, /didJustFinish[\s\S]*seekTo\(0\)/);
  assert.match(bubble, /activeMessageId === messageId/);
});

test('playback rate uses high pitch correction for every supported speed', () => {
  assert.match(bubble, /setPlaybackRate\(speed, 'high'\)/);
  assert.match(bubble, /setPlaybackRate\(next, 'high'\)/);
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
  assert.match(screen, /handleSendVoice[\s\S]*uploadChatVoiceDraft[\s\S]*sendVoiceMessage/);
  assert.ok(screen.includes('router.push(`/call/${partnerId}`)'));
  assert.ok(screen.includes('router.push(`/video-call/${partnerId}`)'));
  assert.match(screen, /send_premium_dm/);
});

test('D migration changes no financial, marketplace, LIVE, Battle or Agora object', () => {
  assert.doesNotMatch(migration, /\b(wallet|ledger|escrow|gift|marketplace|live_battle|agora|premium_dm_payments)\b/i);
});
