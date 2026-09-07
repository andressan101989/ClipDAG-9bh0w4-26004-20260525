import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { getStandardChatVoiceAccess, uploadPrivateVoiceNote } from '@/services/chatMediaService';

export const CHAT_VOICE_WAVEFORM_SAMPLES = 48;
export const CHAT_VOICE_MAX_DURATION_MS = 3_600_000;
export const CHAT_VOICE_SPEEDS = [1, 1.5, 2] as const;
export const CHAT_VOICE_STABILITY_MAX_ATTEMPTS = 10;
export const CHAT_VOICE_STABILITY_INTERVAL_MS = 100;

let stableVoiceFileSequence = 0;

export type ChatVoiceSpeed = typeof CHAT_VOICE_SPEEDS[number];
export type ChatVoiceDraft = {
  uri: string;
  mimeType: 'audio/mp4';
  durationMs: number;
  waveform: number[];
};

export type ChatVoiceMessageInput = {
  mediaAssetId: string;
  durationMs: number;
  waveform: number[];
};

export class ChatVoiceRecorderLifecycle {
  private generation = 0;
  private cleanupFlight: Promise<void> | null = null;

  constructor(private readonly cleanupResources: () => Promise<void>) {}

  begin(): number {
    this.generation += 1;
    return this.generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  snapshot(): number {
    return this.generation;
  }

  waitForCleanup(): Promise<void> {
    return this.cleanupFlight ?? Promise.resolve();
  }

  requestCleanup(): Promise<void> {
    if (this.cleanupFlight) return this.cleanupFlight;
    const flight = this.cleanupResources().finally(() => {
      if (this.cleanupFlight === flight) this.cleanupFlight = null;
    });
    this.cleanupFlight = flight;
    return flight;
  }

  invalidate(): { generation: number; cleanup: Promise<void> } {
    this.generation += 1;
    return { generation: this.generation, cleanup: this.requestCleanup() };
  }
}

export class ChatVoiceRecorderStopGate {
  private flight: Promise<void> | null = null;

  stop(
    shouldStop: () => boolean,
    stopRecorder: () => Promise<void>,
    options: { bestEffort?: boolean } = {},
  ): Promise<void> {
    if (this.flight) return options.bestEffort ? this.flight.catch(() => undefined) : this.flight;
    if (!shouldStop()) return Promise.resolve();
    const flight = stopRecorder().finally(() => {
      if (this.flight === flight) this.flight = null;
    });
    this.flight = flight;
    return options.bestEffort ? flight.catch(() => undefined) : flight;
  }
}

export async function startChatVoiceRecorder(input: {
  lifecycle: ChatVoiceRecorderLifecycle;
  ensurePermission: () => Promise<boolean>;
  enableRecordingMode: () => Promise<void>;
  prepare: () => Promise<void>;
  record: () => void;
}): Promise<'started' | 'denied' | 'stale'> {
  const generation = input.lifecycle.begin();
  const stale = async () => {
    if (input.lifecycle.isCurrent(generation)) return false;
    await input.lifecycle.requestCleanup();
    return true;
  };
  try {
    await input.lifecycle.waitForCleanup();
    if (await stale()) return 'stale';
    if (!(await input.ensurePermission())) {
      return input.lifecycle.isCurrent(generation) ? 'denied' : 'stale';
    }
    if (await stale()) return 'stale';
    await input.enableRecordingMode();
    if (await stale()) return 'stale';
    await input.prepare();
    if (await stale()) return 'stale';
    input.record();
    return input.lifecycle.isCurrent(generation) ? 'started' : 'stale';
  } catch (error) {
    await input.lifecycle.requestCleanup();
    if (!input.lifecycle.isCurrent(generation)) return 'stale';
    throw error;
  }
}

export class ChatVoiceDraftSender {
  private uploads = new Map<string, Promise<string>>();
  private generation = 0;

  constructor(private readonly upload: (draft: ChatVoiceDraft) => Promise<string> = uploadChatVoiceDraft) {}

  async handoff<T>(draft: ChatVoiceDraft, accept: (input: ChatVoiceMessageInput) => Promise<T>): Promise<T> {
    const generation = this.generation;
    let upload = this.uploads.get(draft.uri);
    if (!upload) {
      upload = this.upload(draft);
      this.uploads.set(draft.uri, upload);
    }
    let uploaded = false;
    try {
      const mediaAssetId = await upload;
      uploaded = true;
      if (generation !== this.generation) throw new Error('chat_voice_handoff_stale');
      const result = await accept({ mediaAssetId, durationMs: draft.durationMs, waveform: draft.waveform });
      this.uploads.delete(draft.uri);
      return result;
    } catch (error) {
      if (!uploaded) this.uploads.delete(draft.uri);
      throw error;
    }
  }

  clear(): void {
    this.generation += 1;
    this.uploads.clear();
  }
}

export async function acceptChatVoiceRetryOwnership<T>(
  message: T,
  transmit: (message: T) => Promise<void>,
): Promise<{ message: T; transportFailed: boolean }> {
  try {
    await transmit(message);
    return { message, transportFailed: false };
  } catch {
    return { message, transportFailed: true };
  }
}

export function meteringToVoiceLevel(metering?: number): number {
  if (!Number.isFinite(metering)) return 0;
  const db = Math.max(-60, Math.min(0, Number(metering)));
  return Math.round(((db + 60) / 60) * 100);
}

export function normalizeVoiceWaveform(samples: readonly number[]): number[] {
  const source = samples.length ? samples.map(value => Math.max(0, Math.min(100, Math.round(value)))) : [0];
  return Array.from({ length: CHAT_VOICE_WAVEFORM_SAMPLES }, (_, index) => {
    const start = Math.floor((index * source.length) / CHAT_VOICE_WAVEFORM_SAMPLES);
    const end = Math.max(start + 1, Math.ceil(((index + 1) * source.length) / CHAT_VOICE_WAVEFORM_SAMPLES));
    const bucket = source.slice(start, Math.min(source.length, end));
    return Math.round(bucket.reduce((sum, value) => sum + value, 0) / bucket.length);
  });
}

export function nextVoiceSpeed(speed: ChatVoiceSpeed): ChatVoiceSpeed {
  const index = CHAT_VOICE_SPEEDS.indexOf(speed);
  return CHAT_VOICE_SPEEDS[(index + 1) % CHAT_VOICE_SPEEDS.length];
}

export function formatVoiceDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.floor(durationMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export async function ensureChatVoicePermission(): Promise<boolean> {
  const current = await getRecordingPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await requestRecordingPermissionsAsync()).granted;
}

export async function enableChatVoiceRecordingMode(): Promise<void> {
  await setAudioModeAsync({
    allowsRecording: true,
    playsInSilentMode: true,
    shouldPlayInBackground: false,
    allowsBackgroundRecording: false,
    shouldRouteThroughEarpiece: false,
  });
}

export async function restoreChatVoicePlaybackMode(): Promise<void> {
  await setAudioModeAsync({
    allowsRecording: false,
    playsInSilentMode: true,
    shouldPlayInBackground: false,
    allowsBackgroundRecording: false,
    shouldRouteThroughEarpiece: false,
  });
}

export type StableChatVoiceFile = {
  uri: string;
  mimeType: 'audio/mp4';
  fileName: string;
  sizeBytes: number;
  cleanup: () => void;
};

type ChatVoiceStabilizationOptions = {
  maxAttempts?: number;
  intervalMs?: number;
  signal?: AbortSignal;
  readSize?: (uri: string) => number;
  sleep?: (milliseconds: number) => Promise<void>;
  copyToStableFile?: (sourceUri: string, fileName: string) => StableChatVoiceFile;
};

type ChatVoiceUploadOptions = {
  stabilization?: ChatVoiceStabilizationOptions;
  upload?: typeof uploadPrivateVoiceNote;
};

function throwIfVoiceUploadAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('chat_voice_upload_aborted');
}

function createStableVoiceCopy(sourceUri: string, fileName: string): StableChatVoiceFile {
  const source = new File(sourceUri);
  const stableFile = new File(Paths.cache, fileName);
  const cleanup = () => {
    try { if (stableFile.exists) stableFile.delete(); } catch { /* Best-effort owned cache cleanup. */ }
  };
  let sizeBytes = 0;
  try {
    source.copy(stableFile);
    sizeBytes = stableFile.size;
  } catch (error) {
    cleanup();
    throw error;
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes < 1) {
    cleanup();
    throw new Error('chat_voice_file_not_stable');
  }
  return {
    uri: stableFile.uri,
    mimeType: 'audio/mp4',
    fileName,
    sizeBytes,
    cleanup,
  };
}

export async function prepareStableChatVoiceDraft(
  draft: ChatVoiceDraft,
  options: ChatVoiceStabilizationOptions = {},
): Promise<StableChatVoiceFile> {
  const maxAttempts = options.maxAttempts ?? CHAT_VOICE_STABILITY_MAX_ATTEMPTS;
  const intervalMs = options.intervalMs ?? CHAT_VOICE_STABILITY_INTERVAL_MS;
  const readSize = options.readSize ?? ((uri: string) => new File(uri).size);
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const copyToStableFile = options.copyToStableFile ?? createStableVoiceCopy;
  let previousPositiveSize: number | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfVoiceUploadAborted(options.signal);
    let size = 0;
    try { size = readSize(draft.uri); } catch { size = 0; }
    if (Number.isFinite(size) && size > 0 && size === previousPositiveSize) {
      const operationId = `voice-${Date.now()}-${++stableVoiceFileSequence}`;
      const stable = copyToStableFile(draft.uri, `${operationId}.m4a`);
      if (stable.sizeBytes < 1) {
        stable.cleanup();
        throw new Error('chat_voice_file_not_stable');
      }
      console.info('[ChatVoice]', {
        stage: 'VOICE_FILE_STABLE', operationId, durationMs: draft.durationMs,
        stableSize: stable.sizeBytes, mimeType: stable.mimeType, attempt,
      });
      return stable;
    }
    previousPositiveSize = Number.isFinite(size) && size > 0 ? size : null;
    if (attempt < maxAttempts) await sleep(intervalMs);
  }
  throw new Error('chat_voice_file_not_stable');
}

export async function uploadChatVoiceDraft(
  draft: ChatVoiceDraft,
  signal?: AbortSignal,
  options: ChatVoiceUploadOptions = {},
): Promise<string> {
  const stable = await prepareStableChatVoiceDraft(draft, { ...options.stabilization, signal });
  try {
    throwIfVoiceUploadAborted(signal);
    return await (options.upload ?? uploadPrivateVoiceNote)({
      uri: stable.uri,
      mimeType: 'audio/mp4',
      fileName: stable.fileName,
      sizeBytes: stable.sizeBytes,
      durationMs: draft.durationMs,
      signal,
    });
  } finally {
    stable.cleanup();
  }
}

export function discardChatVoiceDraft(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Cache cleanup is best-effort; the authoritative asset is never created on cancel.
  }
}

export async function getChatVoicePlaybackUrl(assetId: string): Promise<string> {
  const access = await getStandardChatVoiceAccess(assetId);
  return access.url;
}
