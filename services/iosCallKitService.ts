/**
 * services/iosCallKitService.ts
 *
 * IOS-A: app-level facade over the local `onspace-callkit` native module
 * (PushKit VoIP token + a bare CXProvider). iOS-only; a safe no-op on
 * Android/web and on an iOS build that doesn't have the native module
 * compiled in yet (before the IOS-A development build exists).
 *
 * Does not connect to Agora, does not configure AVAudioSession, does not
 * talk to Supabase — this only exposes the native VoIP token and raw
 * CallKit action events for callDeviceService.ts (and future IOS-B/C work)
 * to consume.
 */
import {
  getNativeModule,
  type CallKitAnswerEvent,
  type CallKitAudioSessionEvent,
  type CallKitEndEvent,
  type CallKitEndReason,
  type IncomingCallEvent,
  type CallKitMuteEvent,
  type CallKitPendingEvent,
  type CallKitProviderResetEvent,
  type CallSpeakerRouteResult,
  type NativeCallKitState,
  type OnSpaceCallKitEventMap,
  type RequestEndCallResult,
} from 'onspace-callkit';

export type {
  CallKitAnswerEvent,
  CallKitAudioSessionEvent,
  CallKitEndEvent,
  CallKitEndReason,
  IncomingCallEvent,
  CallKitMuteEvent,
  CallKitPendingEvent,
  CallKitProviderResetEvent,
  CallSpeakerRouteResult,
  NativeCallKitState,
  RequestEndCallResult,
};

function warn(message: string, error?: unknown) {
  if (__DEV__) console.warn(message, error);
}

function debug(message: string, data?: Record<string, unknown>) {
  if (__DEV__) console.log(message, data ?? {});
}

export function isIosCallKitAvailable(): boolean {
  const available = getNativeModule() !== null;
  debug('[iosCallKitService] native module available', { available });
  return available;
}

/**
 * Idempotent on the native side (OnSpaceCallCoordinator.start() no-ops
 * after the first call). The coordinator is already started before JS
 * loads via the app-delegate subscriber — this is only a safety net.
 */
export function ensureIosCallKitStarted(): void {
  try {
    const native = getNativeModule();
    debug('[iosCallKitService] ensureStarted requested', {
      available: Boolean(native),
    });
    if (native?.start) native.start();
    else native?.ensureStarted();
  } catch (error) {
    warn('[iosCallKitService] ensureStarted failed', error);
  }
}

export async function getIosVoipPushToken(): Promise<string | null> {
  const native = getNativeModule();
  debug('[iosCallKitService] getVoipToken requested', {
    available: Boolean(native),
  });
  if (!native) return null;
  try {
    if (native.start) native.start();
    else native.ensureStarted();
    const token = await native.getVoipToken();
    debug('[iosCallKitService] getVoipToken returned', {
      present: typeof token === 'string' && token.length > 0,
      length: typeof token === 'string' ? token.length : 0,
    });
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch (error) {
    warn('[iosCallKitService] getVoipToken failed', error);
    return null;
  }
}

export async function getNativeState(): Promise<NativeCallKitState | null> {
  const native = getNativeModule();
  if (!native?.getNativeState) return null;
  try {
    if (native.start) native.start();
    else native.ensureStarted();
    const state = await native.getNativeState();
    debug('[iosCallKitService] native state', {
      currentCallId: state.currentCallId,
      currentCallUuid: state.currentCallUuid,
      hasReportedCall: state.hasReportedCall,
      wasAnswered: state.wasAnswered,
      audioSessionActive: state.audioSessionActive,
      pendingEventCount: state.pendingEventCount,
      nativeOrigin: state.nativeOrigin,
      wasAppVisibleBeforeVoipPush: state.wasAppVisibleBeforeVoipPush,
    });
    return state;
  } catch (error) {
    warn('[iosCallKitService] getNativeState failed', error);
    return null;
  }
}

export async function getNativeStateStrict(): Promise<NativeCallKitState> {
  const native = getNativeModule();
  if (!native) throw new Error('native_module_unavailable');
  if (!native.getNativeState) throw new Error('get_native_state_unavailable');
  if (native.start) native.start();
  else native.ensureStarted();
  return await native.getNativeState();
}

export const getIosCallKitNativeState = getNativeState;

export async function getPendingEvents(): Promise<CallKitPendingEvent[]> {
  const native = getNativeModule();
  if (!native?.getPendingEvents) return [];
  try {
    return await native.getPendingEvents();
  } catch (error) {
    warn('[iosCallKitService] getPendingEvents failed', error);
    return [];
  }
}

export async function getPendingEventsStrict(): Promise<CallKitPendingEvent[]> {
  const native = getNativeModule();
  if (!native) throw new Error('native_module_unavailable');
  if (!native.getPendingEvents) throw new Error('get_pending_events_unavailable');
  return await native.getPendingEvents();
}

export const getIosCallKitPendingEvents = getPendingEvents;

export async function consumePendingEvent(eventId: string): Promise<boolean> {
  const native = getNativeModule();
  if (!native?.consumePendingEvent) return false;
  try {
    return await native.consumePendingEvent(eventId);
  } catch (error) {
    warn('[iosCallKitService] consumePendingEvent failed', error);
    return false;
  }
}

export async function consumePendingEventStrict(eventId: string): Promise<boolean> {
  const native = getNativeModule();
  if (!native) throw new Error('native_module_unavailable');
  if (!native.consumePendingEvent) throw new Error('consume_pending_event_unavailable');
  return native.consumePendingEvent(eventId);
}

export async function markCallKitHandoffStarted(callId: string, eventId: string): Promise<boolean> {
  const native = getNativeModule();
  if (!native?.markCallHandoffStarted) return false;
  return await native.markCallHandoffStarted(callId, eventId);
}

export async function markCallKitHandoffCompleted(callId: string, eventId: string): Promise<boolean> {
  const native = getNativeModule();
  if (!native?.markCallHandoffCompleted) return false;
  return await native.markCallHandoffCompleted(callId, eventId);
}

export async function reportCallConnected(callId: string): Promise<boolean> {
  const native = getNativeModule();
  if (!native?.reportCallConnected) return false;
  try {
    return await native.reportCallConnected(callId);
  } catch (error) {
    warn('[iosCallKitService] reportCallConnected failed', error);
    return false;
  }
}

/**
 * Backend/remote authoritative call end notification. Do not use this for a
 * local hangup; call requestEndCall() so CallKit drives CXEndCallAction.
 * Passing "localEnded" is accepted by the type for shared reason vocabulary,
 * but native intentionally does not fake it as a remote CallKit end.
 */
export async function reportCallEnded(callId: string, reason: CallKitEndReason): Promise<void> {
  try {
    await reportCallEndedStrict(callId, reason);
  } catch (error) {
    warn('[iosCallKitService] reportCallEnded failed', error);
  }
}

export async function reportCallEndedStrict(callId: string, reason: CallKitEndReason): Promise<boolean> {
  const native = getNativeModule();
  if (!native) throw new Error('native_module_unavailable');
  if (!native.reportCallEnded) throw new Error('report_call_ended_unavailable');
  return await native.reportCallEnded(callId, reason);
}

/**
 * Local user initiated hangup. Native sends a CXEndCallAction through
 * CXCallController; the provider delegate persists the resulting endCall
 * event before fulfilling the action.
 */
export async function requestEndCall(callId: string): Promise<RequestEndCallResult> {
  const native = getNativeModule();
  if (!native?.requestEndCall) return { success: false, error: 'native_module_unavailable' };
  try {
    return await native.requestEndCall(callId);
  } catch (error) {
    warn('[iosCallKitService] requestEndCall failed', error);
    return { success: false, error: error instanceof Error ? error.message : 'request_failed' };
  }
}

export async function requestEndCallIfManagedByCallKit(callId: string): Promise<boolean> {
  const state = await getNativeState();
  if (!state?.hasReportedCall || state.currentCallId !== callId) return false;
  const result = await requestEndCall(callId);
  return result.success;
}

export async function setCallKitSpeakerEnabled(
  callId: string,
  enabled: boolean,
): Promise<CallSpeakerRouteResult> {
  const native = getNativeModule();
  if (!native?.setCallSpeakerEnabled) {
    return {
      applied: false,
      requestedSpeaker: enabled,
      beforeOutputs: [],
      afterOutputs: [],
      callMatches: false,
      audioSessionActive: false,
      errorCode: 'native_method_unavailable',
    };
  }
  try {
    return await native.setCallSpeakerEnabled(callId, enabled);
  } catch {
    return {
      applied: false,
      requestedSpeaker: enabled,
      beforeOutputs: [],
      afterOutputs: [],
      callMatches: true,
      audioSessionActive: false,
      errorCode: 'native_call_failed',
    };
  }
}

/**
 * Generic typed subscription for any OnSpaceCallKit event. Callers own
 * de-duplication for these — see onIosVoipTokenUpdated()/
 * stopIosVoipTokenListener() below for the one flow this file manages
 * internally (used by callDeviceService.ts).
 */
export function addOnSpaceCallKitListener<K extends keyof OnSpaceCallKitEventMap>(
  eventName: K,
  callback: (event: OnSpaceCallKitEventMap[K]) => void
): { remove: () => void } {
  const native = getNativeModule();
  if (!native) return { remove: () => {} };

  try {
    const subscription = native.addListener(eventName, callback);
    return { remove: () => subscription.remove() };
  } catch (error) {
    warn('[iosCallKitService] addListener failed', error);
    return { remove: () => {} };
  }
}

export function onAnswerCall(callback: (event: CallKitAnswerEvent) => void): { remove: () => void } {
  return addOnSpaceCallKitListener('answerCall', callback);
}

export function onIncomingCall(callback: (event: IncomingCallEvent) => void): { remove: () => void } {
  return addOnSpaceCallKitListener('incomingCall', callback);
}

export function onEndCall(callback: (event: CallKitEndEvent) => void): { remove: () => void } {
  return addOnSpaceCallKitListener('endCall', callback);
}

export function onMuteCall(callback: (event: CallKitMuteEvent) => void): { remove: () => void } {
  return addOnSpaceCallKitListener('muteCall', callback);
}

export function onAudioSessionActivated(callback: (event: CallKitAudioSessionEvent) => void): { remove: () => void } {
  return addOnSpaceCallKitListener('audioSessionActivated', callback);
}

export function onAudioSessionDeactivated(callback: (event: CallKitAudioSessionEvent) => void): { remove: () => void } {
  return addOnSpaceCallKitListener('audioSessionDeactivated', callback);
}

export function onProviderReset(callback: (event: CallKitProviderResetEvent) => void): { remove: () => void } {
  return addOnSpaceCallKitListener('providerReset', callback);
}

let voipTokenSubscription: { remove: () => void } | null = null;

/**
 * Subscribes to voip token rotation. Calling this again without a prior
 * stopIosVoipTokenListener() replaces the previous listener instead of
 * stacking a duplicate.
 */
export function onIosVoipTokenUpdated(callback: (token: string) => void): void {
  voipTokenSubscription?.remove();
  debug('[iosCallKitService] voip token listener registered');
  voipTokenSubscription = addOnSpaceCallKitListener('voipTokenUpdated', event => {
    debug('[iosCallKitService] voip token event received', {
      present: typeof event?.token === 'string' && event.token.length > 0,
      length: typeof event?.token === 'string' ? event.token.length : 0,
    });
    if (event?.token) callback(event.token);
  });
}

export function stopIosVoipTokenListener(): void {
  debug('[iosCallKitService] voip token listener stopped');
  voipTokenSubscription?.remove();
  voipTokenSubscription = null;
}
