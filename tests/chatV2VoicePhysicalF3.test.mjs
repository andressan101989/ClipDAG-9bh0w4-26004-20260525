import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const voiceSource = readFileSync('services/chatVoiceService.ts', 'utf8');
const recorderSource = readFileSync('components/chat/VoiceRecorderBar.tsx', 'utf8');
const finalizeSource = readFileSync('supabase/functions/finalize-media-upload/index.ts', 'utf8');

function loadVoiceService({ detectedMimeType = 'audio/x-m4a', stableSize = 95_536 } = {}) {
  const uploaded = [];
  const deleted = [];
  class FakeFile {
    constructor(...parts) {
      this.uri = parts.length === 1 ? String(parts[0]) : `file:///cache/${parts.at(-1)}`;
      this.size = stableSize;
      this.type = '';
      this.exists = true;
    }
    copy(destination) {
      destination.size = stableSize;
      destination.type = detectedMimeType;
      destination.exists = true;
    }
    delete() {
      this.exists = false;
      deleted.push(this.uri);
    }
  }
  const module = { exports: {} };
  const output = ts.transpileModule(voiceSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
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
    'expo-file-system': { File: FakeFile, Paths: { cache: 'file:///cache' } },
    '@/services/chatMediaService': {
      uploadPrivateVoiceNote: async input => {
        uploaded.push(input);
        return 'voice-asset';
      },
      getStandardChatVoiceAccess: async () => ({ url: 'https://signed.example/audio' }),
    },
  };
  Function('require', 'module', 'exports', output)(name => imports[name], module, module.exports);
  return { api: module.exports, uploaded, deleted };
}

const draft = {
  uri: 'file:///recorder-source.m4a',
  mimeType: 'audio/mp4',
  durationMs: 2_883,
  waveform: Array(48).fill(50),
};

const stableOptions = {
  readSize: () => 95_536,
  sleep: async () => undefined,
};

test('stable File.type audio/x-m4a is the upload MIME authority', async () => {
  const harness = loadVoiceService({ detectedMimeType: 'audio/x-m4a' });
  await harness.api.uploadChatVoiceDraft(draft, undefined, { stabilization: stableOptions });
  assert.equal(harness.uploaded[0].mimeType, 'audio/x-m4a');
});

test('stable File.type audio/mp4 remains audio/mp4', async () => {
  const harness = loadVoiceService({ detectedMimeType: 'audio/mp4' });
  await harness.api.uploadChatVoiceDraft(draft, undefined, { stabilization: stableOptions });
  assert.equal(harness.uploaded[0].mimeType, 'audio/mp4');
});

test('stable size is preserved exactly in the upload contract', async () => {
  const harness = loadVoiceService({ stableSize: 100_339 });
  await harness.api.uploadChatVoiceDraft(draft, undefined, { stabilization: stableOptions });
  assert.equal(harness.uploaded[0].sizeBytes, 100_339);
});

test('the same stable URI is used by the upload contract', async () => {
  const harness = loadVoiceService();
  await harness.api.uploadChatVoiceDraft(draft, undefined, { stabilization: stableOptions });
  assert.match(harness.uploaded[0].uri, /^file:\/\/\/cache\/voice-/);
});

test('m4a extension is preserved for both allowed MIME values', async () => {
  for (const detectedMimeType of ['audio/mp4', 'audio/x-m4a']) {
    const harness = loadVoiceService({ detectedMimeType });
    await harness.api.uploadChatVoiceDraft(draft, undefined, { stabilization: stableOptions });
    assert.match(harness.uploaded[0].fileName, /\.m4a$/);
  }
});

test('unexpected stable MIME fails before create-media-upload', async () => {
  const harness = loadVoiceService({ detectedMimeType: 'application/octet-stream' });
  await assert.rejects(
    harness.api.uploadChatVoiceDraft(draft, undefined, { stabilization: stableOptions }),
    /chat_voice_mime_unexpected/,
  );
  assert.equal(harness.uploaded.length, 0);
});

test('empty File.type uses only the canonical draft MIME fallback', async () => {
  const harness = loadVoiceService({ detectedMimeType: '' });
  const xM4aDraft = { ...draft, mimeType: 'audio/x-m4a' };
  await harness.api.uploadChatVoiceDraft(xM4aDraft, undefined, { stabilization: stableOptions });
  assert.equal(harness.uploaded[0].mimeType, 'audio/x-m4a');
  assert.throws(
    () => harness.api.resolveChatVoiceMimeType('', 'application/octet-stream'),
    /chat_voice_mime_unexpected/,
  );
});

test('uploadChatVoiceDraft contains no universal audio/mp4 hardcode', () => {
  const uploadBlock = voiceSource.slice(
    voiceSource.indexOf('export async function uploadChatVoiceDraft'),
    voiceSource.indexOf('export function discardChatVoiceDraft'),
  );
  assert.doesNotMatch(uploadBlock, /mimeType:\s*'audio\/mp4'/);
  assert.match(uploadBlock, /mimeType:\s*stable\.mimeType/);
});

test('strict server object validation remains unchanged', () => {
  assert.match(finalizeSource, /Number\(head\.ContentLength\) !== Number\(a\.size_bytes\)/);
  assert.match(finalizeSource, /head\.ContentType !== a\.mime_type/);
});

test('F2 exact mismatch diagnostics remain present', () => {
  for (const token of [
    'classifyObjectMismatch',
    'object_size_mismatch',
    'object_content_type_mismatch',
    'object_size_and_content_type_mismatch',
  ]) assert.match(finalizeSource, new RegExp(token));
});

test('File.type authority preserves the 48-sample waveform contract', () => {
  assert.match(voiceSource, /CHAT_VOICE_WAVEFORM_SAMPLES = 48/);
  assert.equal(draft.waveform.length, 48);
});

test('F1 recorder lifecycle hardening remains intact', () => {
  assert.doesNotMatch(recorderSource, /recorder\.isRecording/);
  assert.match(recorderSource, /recorderActiveRef\.current/);
  assert.match(recorderSource, /lifecycle\.invalidate\(\)\.cleanup\.catch/);
});

test('owned stable file is cleaned after successful upload', async () => {
  const harness = loadVoiceService();
  await harness.api.uploadChatVoiceDraft(draft, undefined, { stabilization: stableOptions });
  assert.equal(harness.deleted.length, 1);
});

test('owned stable file is cleaned after upload failure', async () => {
  const harness = loadVoiceService();
  await assert.rejects(
    harness.api.uploadChatVoiceDraft(draft, undefined, {
      stabilization: stableOptions,
      upload: async () => { throw new Error('upload_failed'); },
    }),
    /upload_failed/,
  );
  assert.equal(harness.deleted.length, 1);
});

test('one draft produces one upload and abort remains fail-fast', async () => {
  const harness = loadVoiceService();
  await harness.api.uploadChatVoiceDraft(draft, undefined, { stabilization: stableOptions });
  assert.equal(harness.uploaded.length, 1);

  const abortedHarness = loadVoiceService();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    abortedHarness.api.uploadChatVoiceDraft(draft, controller.signal, { stabilization: stableOptions }),
    /chat_voice_upload_aborted/,
  );
  assert.equal(abortedHarness.uploaded.length, 0);
});
