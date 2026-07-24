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
export type CallKitEndReason =
  | 'remoteEnded'
  | 'localEnded'
  | 'rejected'
  | 'unanswered'
  | 'cancelled'
  | 'expired'
  | 'answeredElsewhere'
  | 'failed';

export interface VoipTokenUpdatedEvent {
  token: string;
}

export interface CallKitEventEnvelope<Name extends string, Payload extends object> {
  eventId: string;
  name: Name;
  type: Name;
  callId: string;
  callUuid: string;
  timestamp: number;
  payload: Payload;
}

export interface CallKitNullableIdentityEventEnvelope<Name extends string, Payload extends object> {
  eventId: string;
  name: Name;
  type: Name;
  callId: string | null;
  callUuid: string | null;
  timestamp: number;
  payload: Payload;
}

export interface IncomingCallPayload {
  callerName: string;
  callType: OnSpaceCallType;
  hasVideo: boolean;
  nativeOrigin: 'foreground' | 'background' | 'cold_start';
  wasAppVisibleBeforeVoipPush: boolean;
}

export interface CallKitAnswerPayload {
  callType?: OnSpaceCallType;
  nativeOrigin?: 'foreground' | 'background' | 'cold_start';
}

export interface CallKitEndPayload {
  wasAnswered: boolean;
}

export interface CallKitMutePayload {
  muted: boolean;
}

export interface CallKitAudioSessionPayload {
  active: boolean;
}

export type CallKitProviderResetPayload = Record<string, never>;

export type IncomingCallEvent = CallKitEventEnvelope<'incomingCall', IncomingCallPayload>;
export type CallKitAnswerEvent = CallKitEventEnvelope<'answerCall', CallKitAnswerPayload>;
export type CallKitEndEvent = CallKitEventEnvelope<'endCall', CallKitEndPayload>;
export type CallKitMuteEvent = CallKitEventEnvelope<'muteCall', CallKitMutePayload>;
export type CallKitAudioSessionActivatedEvent = CallKitNullableIdentityEventEnvelope<'audioSessionActivated', CallKitAudioSessionPayload>;
export type CallKitAudioSessionDeactivatedEvent = CallKitNullableIdentityEventEnvelope<'audioSessionDeactivated', CallKitAudioSessionPayload>;
export type CallKitAudioSessionEvent =
  | CallKitAudioSessionActivatedEvent
  | CallKitAudioSessionDeactivatedEvent;
export type CallKitProviderResetEvent = CallKitNullableIdentityEventEnvelope<'providerReset', CallKitProviderResetPayload>;
export type CallKitPendingEvent = CallKitAnswerEvent | CallKitEndEvent;

export interface RequestEndCallResult {
  success: boolean;
  error?: string;
}

export interface CallSpeakerRouteResult {
  applied: boolean;
  requestedSpeaker: boolean;
  beforeOutputs: string[];
  afterOutputs: string[];
  callMatches: boolean;
  audioSessionActive: boolean;
  errorCode?: string;
}

export interface OnSpaceCallKitEventMap {
  voipTokenUpdated: VoipTokenUpdatedEvent;
  voipTokenInvalidated: Record<string, never>;
  incomingCall: IncomingCallEvent;
  answerCall: CallKitAnswerEvent;
  endCall: CallKitEndEvent;
  muteCall: CallKitMuteEvent;
  audioSessionActivated: CallKitAudioSessionActivatedEvent;
  audioSessionDeactivated: CallKitAudioSessionDeactivatedEvent;
  providerReset: CallKitProviderResetEvent;
}

export type OnSpaceCallKitPendingEvent = CallKitPendingEvent;

export interface NativeCallKitState {
  currentCallId: string | null;
  currentCallUuid: string | null;
  hasReportedCall: boolean;
  wasAnswered: boolean;
  audioSessionActive: boolean;
  pendingEventCount: number;
  handoffStarted: boolean;
  handoffCompleted: boolean;
  nativeOrigin: 'foreground' | 'background' | 'cold_start' | null;
  wasAppVisibleBeforeVoipPush: boolean;
}

export type OnSpaceCallKitNativeState = NativeCallKitState;

interface OnSpaceCallKitNativeModule {
  isAvailable: boolean;
  getVoipToken(): Promise<string | null>;
  ensureStarted(): void;
  start?(): void;
  getPendingEvents?(): Promise<CallKitPendingEvent[]>;
  consumePendingEvent?(eventId: string): Promise<boolean>;
  markCallHandoffStarted?(callId: string, eventId: string): Promise<boolean>;
  markCallHandoffCompleted?(callId: string, eventId: string): Promise<boolean>;
  reportCallConnected?(callId: string): Promise<boolean>;
  reportCallEnded?(callId: string, reason: CallKitEndReason): Promise<boolean> | boolean;
  setCallSpeakerEnabled?(callId: string, enabled: boolean): Promise<CallSpeakerRouteResult> | CallSpeakerRouteResult;
  requestEndCall?(callId: string): Promise<RequestEndCallResult>;
  getNativeState?(): Promise<NativeCallKitState>;
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
