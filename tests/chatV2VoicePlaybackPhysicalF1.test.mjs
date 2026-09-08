import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const bubbleSource = readFileSync('components/chat/VoiceMessageBubble.tsx', 'utf8');
const recorderSource = readFileSync('components/chat/VoiceRecorderBar.tsx', 'utf8');
const voiceSource = readFileSync('services/chatVoiceService.ts', 'utf8');
const chatMediaSource = readFileSync('services/chatMediaService.ts', 'utf8');
const messagesSource = readFileSync('app/(tabs)/messages.tsx', 'utf8');
const tabsSource = readFileSync('app/(tabs)/_layout.tsx', 'utf8');
const finalizeSource = readFileSync('supabase/functions/finalize-media-upload/index.ts', 'utf8');
const expoAudioSource = readFileSync('node_modules/expo-audio/src/ExpoAudio.ts', 'utf8');
const recordingPresetsSource = readFileSync('node_modules/expo-audio/src/RecordingConstants.ts', 'utf8');

function loadChatMediaService(invoke, initialUserId = 'user-a') {
  let calls = 0;
  let sessionUserId = initialUserId;
  const module = { exports: {} };
  const output = ts.transpileModule(chatMediaSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const imports = {
    '@/template': {
      getSupabaseClient: () => ({
        auth: {
          getSession: async () => ({
            data: { session: sessionUserId ? { user: { id: sessionUserId } } : null },
            error: null,
          }),
        },
        functions: { invoke: async (...args) => { calls += 1; return invoke(...args); } },
      }),
    },
    '@/services/mediaService': {
      deleteMediaAsset: async () => undefined,
      uploadMediaFromUri: async () => ({}),
    },
  };
  Function('require', 'module', 'exports', output)(name => imports[name], module, module.exports);
  return {
    api: module.exports,
    get calls() { return calls; },
    setSessionUserId(userId) { sessionUserId = userId; },
  };
}

function accessResponse(assetId, options = {}) {
  return {
    data: {
      success: true,
      data: {
        assetId,
        url: options.url ?? `https://signed.example/${assetId}`,
        expiresAt: options.expiresAt ?? new Date(Date.now() + 120_000).toISOString(),
        consumptionPolicy: options.consumptionPolicy ?? 'standard',
        consumedAt: options.consumedAt ?? null,
      },
    },
    error: null,
  };
}

test('useAudioPlayer remains the sole native player disposal authority', () => {
  assert.match(bubbleSource, /useAudioPlayer\(null, \{ updateInterval: 100 \}\)/);
  assert.doesNotMatch(bubbleSource, /createAudioPlayer|player\.(?:remove|release)\(/);
  assert.match(expoAudioSource, /automatically releases when the component unmounts/);
});

test('unmount cleanup contains no direct player pause call', () => {
  const lifecycle = bubbleSource.slice(
    bubbleSource.indexOf('useEffect(() => {\n    mountedRef.current = true'),
    bubbleSource.indexOf('const isCurrentLifecycle'),
  );
  assert.match(lifecycle, /mountedRef\.current = false/);
  assert.doesNotMatch(lifecycle, /player\.pause\(\)/);
  assert.doesNotMatch(bubbleSource, /useEffect\(\(\) => \(\) => \{ player\.pause\(\); \}/);
});

test('a playback URL resolved after unmount cannot touch the player', () => {
  const urlWait = bubbleSource.indexOf('await getChatVoicePlaybackUrl(assetId)');
  const lifecycleGate = bubbleSource.indexOf('!isCurrentLifecycle(generation)', urlWait);
  const replacement = bubbleSource.indexOf('replaceSafely(url)', urlWait);
  assert.ok(urlWait >= 0 && lifecycleGate > urlWait && replacement > lifecycleGate);
});

test('audio mode restoration completion is lifecycle-gated before play', () => {
  const restore = bubbleSource.indexOf('await restoreChatVoicePlaybackMode()');
  const gate = bubbleSource.indexOf('!isCurrentLifecycle(generation)', restore);
  const play = bubbleSource.indexOf('playSafely()', restore);
  assert.ok(restore >= 0 && gate > restore && play > gate);
});

test('pause uses the mounted best-effort native call gate', () => {
  assert.match(bubbleSource, /const pauseSafely[\s\S]*runPlayerCallSafely\(\(\) => player\.pause\(\)/);
});

test('didJustFinish pause and rewind are safe operations', () => {
  const finish = bubbleSource.slice(
    bubbleSource.indexOf('if (!status.didJustFinish)'),
    bubbleSource.indexOf('const toggle'),
  );
  assert.match(finish, /pauseSafely\(false\)/);
  assert.match(finish, /seekSafely\(0, false\)/);
  assert.doesNotMatch(finish, /player\.(?:pause|seekTo)\(/);
});

test('waveform seek is guarded and catches native rejection', () => {
  assert.match(bubbleSource, /const seekSafely[\s\S]*try[\s\S]*await player\.seekTo\(seconds\)[\s\S]*catch/);
  assert.match(bubbleSource, /void seekSafely\(\(event\.nativeEvent\.locationX/);
});

test('replace is guarded and recoverable', () => {
  assert.match(bubbleSource, /const replaceSafely[\s\S]*player\.replace\(\{ uri \}\)/);
  assert.match(bubbleSource, /if \(!replaceSafely\(url\)\) return/);
});

test('play is guarded and recoverable', () => {
  assert.match(bubbleSource, /const playSafely[\s\S]*player\.play\(\)/);
  assert.match(bubbleSource, /playSafely\(\)/);
});

test('playback rate changes use the guarded native call', () => {
  assert.match(bubbleSource, /const setPlaybackRateSafely[\s\S]*player\.setPlaybackRate\(next, 'high'\)/);
  assert.doesNotMatch(bubbleSource, /(?<!=> )player\.setPlaybackRate\(/);
});

test('native SharedObject failures cannot escape unmount cleanup', () => {
  const cleanup = bubbleSource.slice(
    bubbleSource.indexOf('return () => {'),
    bubbleSource.indexOf('const isCurrentLifecycle'),
  );
  assert.doesNotMatch(cleanup, /player\./);
  assert.match(bubbleSource, /try \{[\s\S]*operation\(\)[\s\S]*\} catch \{/);
});

test('user playback failures remain recoverable in bubble state', () => {
  assert.match(bubbleSource, /const \[failed, setFailed\] = useState\(false\)/);
  assert.match(bubbleSource, /failed \? 'reload'/);
  assert.match(bubbleSource, /if \(reportFailure && mountedRef\.current\) setFailed\(true\)/);
});

test('1x playback remains visible and supported', () => {
  assert.match(bubbleSource, /\(\[1, 1\.5, 2\] as ChatVoiceSpeed\[\]\)/);
});

test('1.5x playback remains visible and supported', () => {
  assert.match(voiceSource, /CHAT_VOICE_SPEEDS = \[1, 1\.5, 2\]/);
});

test('2x playback remains visible and supported', () => {
  assert.match(bubbleSource, /accessibilityLabel=\{`Velocidad \$\{option\}x`\}/);
});

test('the loaded asset is reused without replacing its source again', () => {
  assert.match(bubbleSource, /if \(loadedAsset !== assetId\)/);
  assert.match(bubbleSource, /setLoadedAsset\(assetId\)/);
});

test('standard voice cache is isolated by authenticated user', async () => {
  let activeUserId = 'user-a';
  const harness = loadChatMediaService(async (_name, { body }) => accessResponse(body.asset_id, {
    url: `https://signed.example/${activeUserId}/${body.asset_id}`,
  }));

  const firstA = await harness.api.getStandardChatVoiceAccess('shared-voice');
  const secondA = await harness.api.getStandardChatVoiceAccess('shared-voice');
  assert.equal(harness.calls, 1);
  assert.equal(secondA.url, firstA.url);

  activeUserId = 'user-b';
  harness.setSessionUserId(activeUserId);
  const firstB = await harness.api.getStandardChatVoiceAccess('shared-voice');
  const secondB = await harness.api.getStandardChatVoiceAccess('shared-voice');
  assert.equal(harness.calls, 2);
  assert.equal(firstB.url, 'https://signed.example/user-b/shared-voice');
  assert.notEqual(firstB.url, firstA.url);
  assert.equal(secondB.url, firstB.url);
});

test('logout never reuses or populates an authenticated voice cache entry', async () => {
  let requestScope = 'user-a';
  const harness = loadChatMediaService(async (_name, { body }) => accessResponse(body.asset_id, {
    url: `https://signed.example/${requestScope}/${body.asset_id}`,
  }));
  const authenticated = await harness.api.getStandardChatVoiceAccess('logout-voice');

  requestScope = 'logged-out';
  harness.setSessionUserId(null);
  const firstLoggedOut = await harness.api.getStandardChatVoiceAccess('logout-voice');
  const secondLoggedOut = await harness.api.getStandardChatVoiceAccess('logout-voice');
  assert.equal(harness.calls, 3);
  assert.notEqual(firstLoggedOut.url, authenticated.url);
  assert.equal(secondLoggedOut.url, firstLoggedOut.url);
});

test('in-flight standard access is isolated by authenticated user', async () => {
  let activeUserId = 'user-a';
  const pending = new Map();
  const started = new Map();
  const harness = loadChatMediaService((_name, { body }) => new Promise(resolve => {
    const requestUserId = activeUserId;
    pending.set(requestUserId, () => resolve(accessResponse(body.asset_id, {
      url: `https://signed.example/${requestUserId}/${body.asset_id}`,
    })));
    started.get(requestUserId)?.();
  }));

  const startedA = new Promise(resolve => started.set('user-a', resolve));
  const accessA = harness.api.getStandardChatVoiceAccess('in-flight-voice');
  await startedA;

  activeUserId = 'user-b';
  harness.setSessionUserId(activeUserId);
  const startedB = new Promise(resolve => started.set('user-b', resolve));
  const accessB = harness.api.getStandardChatVoiceAccess('in-flight-voice');
  await startedB;
  assert.equal(harness.calls, 2);

  pending.get('user-b')();
  const resultB = await accessB;
  pending.get('user-a')();
  const resultA = await accessA;
  assert.equal(resultA.url, 'https://signed.example/user-a/in-flight-voice');
  assert.equal(resultB.url, 'https://signed.example/user-b/in-flight-voice');
  assert.notEqual(resultA.url, resultB.url);
});

test('standard voice access cache respects URL expiry', async () => {
  const harness = loadChatMediaService(async (_name, { body }) => (
    accessResponse(body.asset_id, { expiresAt: new Date(Date.now() + 20_000).toISOString() })
  ));
  await harness.api.getStandardChatVoiceAccess('voice-expiring');
  await harness.api.getStandardChatVoiceAccess('voice-expiring');
  assert.equal(harness.calls, 2);
});

test('standard voice access cache applies a 30-second safety margin', () => {
  assert.equal(chatMediaSource.includes('CHAT_STANDARD_VOICE_ACCESS_CACHE_SAFETY_MS = 30_000'), true);
  assert.match(chatMediaSource, /expiresAt - now <= CHAT_STANDARD_VOICE_ACCESS_CACHE_SAFETY_MS/);
});

test('standard voice access cache is bounded to 64 LRU entries', async () => {
  const harness = loadChatMediaService(async (_name, { body }) => accessResponse(body.asset_id));
  for (let index = 0; index < 65; index += 1) {
    await harness.api.getStandardChatVoiceAccess(`voice-${index}`);
  }
  await harness.api.getStandardChatVoiceAccess('voice-0');
  assert.equal(harness.calls, 66);
  assert.match(chatMediaSource, /standardVoiceAccessCache\.delete\(cacheKey\);[\s\S]*standardVoiceAccessCache\.set\(cacheKey, cached\)/);
});

test('failed access requests are never cached', async () => {
  const harness = loadChatMediaService(async () => ({ data: { success: false }, error: { message: 'denied' } }));
  await assert.rejects(harness.api.getStandardChatVoiceAccess('voice-failed'), /denied/);
  await assert.rejects(harness.api.getStandardChatVoiceAccess('voice-failed'), /denied/);
  assert.equal(harness.calls, 2);
});

test('one-time media bypasses the standard voice cache', async () => {
  const harness = loadChatMediaService(async (_name, { body }) => accessResponse(body.asset_id, {
    consumptionPolicy: 'one_time', consumedAt: new Date().toISOString(),
  }));
  await harness.api.openOneTimeChatImage('one-time-asset');
  await harness.api.openOneTimeChatImage('one-time-asset');
  assert.equal(harness.calls, 2);
});

test('voice access remains on-demand without mass prefetch', async () => {
  const harness = loadChatMediaService(async (_name, { body }) => accessResponse(body.asset_id));
  assert.equal(harness.calls, 0);
  await harness.api.getStandardChatVoiceAccess('one-voice');
  assert.equal(harness.calls, 1);
  assert.doesNotMatch(chatMediaSource, /prefetch/i);
});

test('F3 stable-file MIME authority remains intact', () => {
  assert.match(voiceSource, /detectedMimeType = stableFile\.type/);
  assert.match(voiceSource, /mimeType: stable\.mimeType/);
  assert.match(voiceSource, /'audio\/mp4' \| 'audio\/x-m4a'/);
});

test('the F1 stable cache copy remains mandatory', () => {
  assert.match(voiceSource, /source\.copy\(stableFile\)/);
  assert.match(voiceSource, /uri: stable\.uri/);
  assert.match(voiceSource, /sizeBytes: stable\.sizeBytes/);
});

test('stabilization still requires two equal positive size reads', () => {
  assert.match(voiceSource, /size > 0 && size === previousPositiveSize/);
});

test('the proven 100ms stabilization interval is unchanged', () => {
  assert.match(voiceSource, /CHAT_VOICE_STABILITY_INTERVAL_MS = 100/);
});

test('optimized voice recording preserves the m4a extension', () => {
  assert.match(voiceSource, /CHAT_VOICE_RECORDING_OPTIONS[\s\S]*extension: '\.m4a'/);
  assert.match(recorderSource, /CHAT_VOICE_RECORDING_OPTIONS/);
});

test('optimized native recording preserves MPEG4 and AAC', () => {
  assert.match(voiceSource, /outputFormat: 'mpeg4', audioEncoder: 'aac'/);
  assert.match(recordingPresetsSource, /outputFormat: IOSOutputFormat\.MPEG4AAC/);
});

test('optimized voice recording uses one channel', () => {
  assert.match(voiceSource, /numberOfChannels: 1/);
});

test('optimized voice recording uses 64 kbps', () => {
  assert.match(voiceSource, /bitRate: 64_000/);
  assert.match(voiceSource, /bitsPerSecond: 64_000/);
});

test('voice waveform remains exactly 48 samples', () => {
  assert.match(voiceSource, /CHAT_VOICE_WAVEFORM_SAMPLES = 48/);
});

test('the Inbox FAB clears the exported tab-bar height', () => {
  assert.match(tabsSource, /export const TAB_BAR_HEIGHT = Platform\.select/);
  assert.match(messagesSource, /import \{ TAB_BAR_HEIGHT \} from '\.\/_layout'/);
  assert.match(messagesSource, /bottom: TAB_BAR_HEIGHT \+ 14/);
  assert.doesNotMatch(messagesSource, /style=\{\[styles\.fab, \{ bottom: 18 \+ insets\.bottom \}\]\}/);
});

test('the Inbox FAB still navigates to new-message', () => {
  assert.match(messagesSource, /accessibilityLabel="Nuevo mensaje"[\s\S]*router\.push\('\/new-message'\)[\s\S]*bottom: TAB_BAR_HEIGHT \+ 14/);
});

test('the Inbox header action remains unchanged', () => {
  const header = messagesSource.slice(0, messagesSource.indexOf('// Search'));
  assert.match(header, /accessibilityLabel="Nuevo mensaje"/);
  assert.match(header, /style=\{styles\.headerAction\}/);
});

test('safe timing logs expose only bounded stage measurements', () => {
  assert.match(recorderSource, /stop_to_draft_ms/);
  assert.match(voiceSource, /stabilize_ms/);
  assert.match(voiceSource, /upload_total_ms/);
  assert.match(voiceSource, /handoff_total_ms/);
  assert.doesNotMatch(voiceSource, /uploadUrl|Authorization|JWT|owner_id/);
});

test('strict F2 object validation and ready-before-message contract remain unchanged', () => {
  assert.match(finalizeSource, /Number\(head\.ContentLength\)/);
  assert.match(finalizeSource, /head\.ContentType !== a\.mime_type/);
  assert.match(finalizeSource, /status: "ready"/);
  assert.ok(voiceSource.indexOf('uploadPrivateVoiceNote') < voiceSource.indexOf('ChatVoiceMessageInput'));
});
