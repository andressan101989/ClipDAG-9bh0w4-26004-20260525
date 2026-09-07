import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { getStandardChatVoiceAccess, uploadPrivateVoiceNote } from '@/services/chatMediaService';

export const CHAT_VOICE_WAVEFORM_SAMPLES = 48;
export const CHAT_VOICE_MAX_DURATION_MS = 3_600_000;
export const CHAT_VOICE_SPEEDS = [1, 1.5, 2] as const;

export type ChatVoiceSpeed = typeof CHAT_VOICE_SPEEDS[number];
export type ChatVoiceDraft = {
  uri: string;
  mimeType: 'audio/mp4';
  durationMs: number;
  waveform: number[];
};

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

export async function uploadChatVoiceDraft(draft: ChatVoiceDraft, signal?: AbortSignal): Promise<string> {
  return uploadPrivateVoiceNote({
    uri: draft.uri,
    mimeType: draft.mimeType,
    fileName: `voice-${Date.now()}.m4a`,
    durationMs: draft.durationMs,
    signal,
  });
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
