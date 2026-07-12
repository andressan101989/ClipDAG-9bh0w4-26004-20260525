/**
 * modules/onspace-callkit/src/index.ts
 *
 * Thin wrapper over the native OnSpaceCallKit Expo module (iOS-only,
 * IOS-A scope: PushKit VoIP token + bare CXProvider — no Agora, no
 * AVAudioSession, no Supabase calls from here).
 *
 * Safe to import on any platform / any build: `getNativeModule()` returns
 * null instead of throwing when not on iOS, or when the native module isn't
 * compiled into the current build yet (e.g. before the IOS-A dev build).
 */
import { Platform } from 'react-native';
import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

export type OnSpaceCallType = 'audio' | 'video';

export interface VoipTokenUpdatedEvent {
  token: string;
}

export interface IncomingCallEvent {
  callId: string;
  callerName: string;
  callType: OnSpaceCallType;
  hasVideo: boolean;
}

export interface AnswerCallEvent {
  callId: string;
}

export interface EndCallEvent {
  callId: string;
}

export interface MuteCallEvent {
  callId: string;
  muted: boolean;
}

export interface OnSpaceCallKitEventMap {
  voipTokenUpdated: VoipTokenUpdatedEvent;
  voipTokenInvalidated: Record<string, never>;
  incomingCall: IncomingCallEvent;
  answerCall: AnswerCallEvent;
  endCall: EndCallEvent;
  muteCall: MuteCallEvent;
  audioSessionActivated: Record<string, never>;
  audioSessionDeactivated: Record<string, never>;
  providerReset: Record<string, never>;
}

export interface OnSpaceCallKitPendingEvent {
  name: keyof OnSpaceCallKitEventMap;
  body: Record<string, unknown>;
}

export interface OnSpaceCallKitNativeState {
  started: boolean;
  registryConfigured: boolean;
  hasVoipToken: boolean;
  voipTokenLength: number;
  pendingEventCount: number;
  lastVoipTokenUpdatedAt: number | null;
}

interface OnSpaceCallKitNativeModule {
  isAvailable: boolean;
  getVoipToken(): Promise<string | null>;
  ensureStarted(): void;
  start?(): void;
  getPendingEvents?(): Promise<OnSpaceCallKitPendingEvent[]>;
  consumePendingEvents?(): Promise<OnSpaceCallKitPendingEvent[]>;
  getNativeState?(): Promise<OnSpaceCallKitNativeState>;
  addListener<K extends keyof OnSpaceCallKitEventMap>(
    eventName: K,
    listener: (event: OnSpaceCallKitEventMap[K]) => void
  ): EventSubscription;
  removeAllListeners(eventName: keyof OnSpaceCallKitEventMap): void;
}

let cachedModule: OnSpaceCallKitNativeModule | null | undefined;

/**
 * Resolves the native module once and caches the result (including the
 * "not available" case) — never throws, on any platform or build.
 */
export function getNativeModule(): OnSpaceCallKitNativeModule | null {
  if (cachedModule !== undefined) return cachedModule;

  if (Platform.OS !== 'ios') {
    cachedModule = null;
    return cachedModule;
  }

  try {
    cachedModule = requireOptionalNativeModule<OnSpaceCallKitNativeModule>('OnSpaceCallKit');
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

export function isOnSpaceCallKitAvailable(): boolean {
  return getNativeModule() !== null;
}
