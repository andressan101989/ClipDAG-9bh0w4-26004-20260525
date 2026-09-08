import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const serviceSource = readFileSync('services/chatVoiceService.ts', 'utf8');
const recorderSource = readFileSync('components/chat/VoiceRecorderBar.tsx', 'utf8');
const mediaSource = readFileSync('services/mediaService.ts', 'utf8');
const finalizeSource = readFileSync('supabase/functions/finalize-media-upload/index.ts', 'utf8');

function loadService() {
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
      getRecordingPermissionsAsync: async () => ({ granted: true }),
      requestRecordingPermissionsAsync: async () => ({ granted: true }),
      setAudioModeAsync: async () => undefined,
    },
    'expo-file-system': { File: class {}, Paths: { cache: 'file:///cache' } },
    '@/services/chatMediaService': {
      uploadPrivateVoiceNote: async () => 'asset-default',
      getStandardChatVoiceAccess: async () => ({ url: 'https://signed.example/audio' }),
    },
  };
  Function('require', 'module', 'exports', output)(name => imports[name], module, module.exports);
  return module.exports;
}

const draft = {
  uri: 'file:///mutable-recorder.m4a', mimeType: 'audio/mp4', durationMs: 2100,
  waveform: Array(48).fill(42),
};

test('cleanup owns recorder state in JS and never reads a destroyed recording getter', () => {
  assert.doesNotMatch(recorderSource, /recorder\.isRecording/);
  const cleanup = recorderSource.slice(recorderSource.indexOf('const cleanupResources'), recorderSource.indexOf('const cleanupResourcesRef'));
  assert.doesNotMatch(cleanup, /recorder\.uri/);
  assert.match(recorderSource, /recorderActiveRef\.current/);
  assert.match(recorderSource, /readRecorderUriSafely[\s\S]*try[\s\S]*recorder\.uri[\s\S]*catch/);
});

test('best-effort cleanup contains a destroyed shared-object stop while normal stop reports it', async () => {
  const { ChatVoiceRecorderStopGate } = loadService();
  const nativeFailure = new Error('NativeSharedObjectNotFoundException');
  const cleanupGate = new ChatVoiceRecorderStopGate();
  await cleanupGate.stop(() => true, async () => { throw nativeFailure; }, { bestEffort: true });
  const normalGate = new ChatVoiceRecorderStopGate();
  await assert.rejects(normalGate.stop(() => true, async () => { throw nativeFailure; }), /NativeSharedObjectNotFoundException/);
});

test('concurrent invalidation and cleanup remain idempotent', async () => {
  const { ChatVoiceRecorderLifecycle } = loadService();
  let cleanups = 0;
  const lifecycle = new ChatVoiceRecorderLifecycle(async () => { cleanups += 1; await Promise.resolve(); });
  const first = lifecycle.invalidate(); const second = lifecycle.invalidate();
  await Promise.all([first.cleanup, second.cleanup]);
  assert.equal(cleanups, 1); assert.equal(second.generation, first.generation + 1);
});

test('double stop remains single-flight', async () => {
  const { ChatVoiceRecorderStopGate } = loadService();
  let stops = 0; let release;
  const pending = new Promise(resolve => { release = resolve; });
  const gate = new ChatVoiceRecorderStopGate();
  const first = gate.stop(() => true, async () => { stops += 1; await pending; });
  const second = gate.stop(() => true, async () => { stops += 1; });
  release(); await Promise.all([first, second]); assert.equal(stops, 1);
});

test('mutable voice size must become positive and repeat before creating the stable copy', async () => {
  const { prepareStableChatVoiceDraft } = loadService();
  const sizes = [0, 120, 240, 240]; let copied = 0; const sleeps = [];
  const stable = await prepareStableChatVoiceDraft(draft, {
    readSize: () => sizes.shift() ?? 240,
    sleep: async ms => { sleeps.push(ms); },
    copyToStableFile: (_uri, fileName) => {
      copied += 1;
      return { uri: 'file:///cache/stable.m4a', mimeType: 'audio/mp4', detectedMimeType: 'audio/mp4', fileName, sizeBytes: 240, cleanup() {} };
    },
  });
  assert.equal(copied, 1); assert.equal(stable.sizeBytes, 240); assert.equal(sleeps.length, 3);
});

test('stabilization timeout fails before media upload is created', async () => {
  const { uploadChatVoiceDraft } = loadService(); let uploads = 0;
  await assert.rejects(uploadChatVoiceDraft(draft, undefined, {
    stabilization: { maxAttempts: 3, intervalMs: 1, readSize: () => 0, sleep: async () => undefined },
    upload: async () => { uploads += 1; return 'never'; },
  }), /chat_voice_file_not_stable/);
  assert.equal(uploads, 0);
});

test('stable URI and its exact size drive create-upload and the same File drives PUT', async () => {
  const { uploadChatVoiceDraft } = loadService(); let uploadInput; let cleaned = 0;
  const result = await uploadChatVoiceDraft(draft, undefined, {
    stabilization: {
      readSize: () => 512, sleep: async () => undefined,
      copyToStableFile: (_uri, fileName) => ({
        uri: 'file:///cache/immutable-voice.m4a', mimeType: 'audio/mp4', detectedMimeType: 'audio/mp4', fileName,
        sizeBytes: 512, cleanup: () => { cleaned += 1; },
      }),
    },
    upload: async input => { uploadInput = input; return 'asset-stable'; },
  });
  assert.equal(result, 'asset-stable'); assert.equal(uploadInput.uri, 'file:///cache/immutable-voice.m4a');
  assert.equal(uploadInput.sizeBytes, 512); assert.equal(uploadInput.mimeType, 'audio/mp4');
  assert.match(uploadInput.fileName, /\.m4a$/); assert.equal(cleaned, 1);
  assert.match(mediaSource, /const \{ file, contract \} = await createMediaUpload[\s\S]*putFileToR2WithRetry\(\{[\s\S]*file,/);
});

test('failed or cancelled upload cleans only its owned stable temp', async () => {
  const { uploadChatVoiceDraft } = loadService(); let cleaned = 0;
  await assert.rejects(uploadChatVoiceDraft(draft, undefined, {
    stabilization: {
      readSize: () => 64, sleep: async () => undefined,
      copyToStableFile: (_uri, fileName) => ({
        uri: 'file:///cache/owned.m4a', mimeType: 'audio/mp4', detectedMimeType: 'audio/mp4', fileName,
        sizeBytes: 64, cleanup: () => { cleaned += 1; },
      }),
    },
    upload: async () => { throw new Error('upload_cancelled'); },
  }), /upload_cancelled/);
  assert.equal(cleaned, 1);
});

test('voice contract keeps both M4A MIME values, m4a, 48 samples and strict server validation', () => {
  assert.match(serviceSource, /'audio\/mp4' \| 'audio\/x-m4a'/);
  assert.match(serviceSource, /mimeType:\s*stable\.mimeType/);
  assert.match(serviceSource, /`\$\{operationId\}\.m4a`/);
  assert.match(serviceSource, /CHAT_VOICE_WAVEFORM_SAMPLES = 48/);
  assert.match(mediaSource, /headers:\s*input\.headers[\s\S]*body:\s*input\.file/);
  assert.match(finalizeSource, /object_mismatch/);
});

test('unmount cleanup has an explicit terminal rejection handler', () => {
  assert.match(recorderSource, /lifecycle\.invalidate\(\)\.cleanup\.catch\(\(\) => undefined\)/);
});
