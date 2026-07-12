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
  type OnSpaceCallKitEventMap,
  type OnSpaceCallKitNativeState,
  type OnSpaceCallKitPendingEvent,
} from 'onspace-callkit';

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

export async function getIosCallKitNativeState(): Promise<OnSpaceCallKitNativeState | null> {
  const native = getNativeModule();
  if (!native?.getNativeState) return null;
  try {
    if (native.start) native.start();
    else native.ensureStarted();
    const state = await native.getNativeState();
    debug('[iosCallKitService] native state', {
      started: state.started,
      registryConfigured: state.registryConfigured,
      hasVoipToken: state.hasVoipToken,
      voipTokenLength: state.voipTokenLength,
      pendingEventCount: state.pendingEventCount,
      lastVoipTokenUpdatedAt: state.lastVoipTokenUpdatedAt,
    });
    return state;
  } catch (error) {
    warn('[iosCallKitService] getNativeState failed', error);
    return null;
  }
}

export async function getIosCallKitPendingEvents(): Promise<OnSpaceCallKitPendingEvent[]> {
  const native = getNativeModule();
  if (!native?.getPendingEvents) return [];
  try {
    return await native.getPendingEvents();
  } catch (error) {
    warn('[iosCallKitService] getPendingEvents failed', error);
    return [];
  }
}

export async function consumeIosCallKitPendingEvents(): Promise<OnSpaceCallKitPendingEvent[]> {
  const native = getNativeModule();
  if (!native?.consumePendingEvents) return [];
  try {
    return await native.consumePendingEvents();
  } catch (error) {
    warn('[iosCallKitService] consumePendingEvents failed', error);
    return [];
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
