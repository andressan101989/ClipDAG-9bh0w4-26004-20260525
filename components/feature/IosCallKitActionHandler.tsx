import NetInfo from '@react-native-community/netinfo';
import { usePathname, useRouter, useRootNavigationState } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';
import { useAgoraCallSignaling } from '@/contexts/AgoraCallContext';
import { useAuth } from '@/hooks/useAuth';
import {
  consumePendingEventStrict,
  ensureIosCallKitStarted,
  getPendingEvents,
  getPendingEventsStrict,
  markCallKitHandoffCompleted,
  markCallKitHandoffStarted,
  onAnswerCall,
  onEndCall,
  onMuteCall,
  reportCallConnected,
  type CallKitAnswerEvent,
  type CallKitEndEvent,
  type CallKitEndReason,
  type CallKitPendingEvent,
} from '@/services/iosCallKitService';
import { getCurrentCallDeviceId } from '@/services/callDeviceService';
import { dismissPresentedCallNotifications } from '@/services/callNotificationService';
import { stopAllCallSounds } from '@/services/callRingtoneService';
import { setActiveAgoraCallMuted } from '@/services/callAudioControlService';
import {
  navigateToAcceptedCall as navigateAcceptedCallRoute,
  replaceCallWithHome,
} from '@/services/callNavigationService';
import {
  reconcileAnswerCallKitEvent,
  reconcileEndCallKitEvent,
  reconcileIncomingCallAcceptance,
  type CallKitReconcileResult,
} from '@/services/callKitActionService';
import {
  closeNativeCallIfMatching,
  getReportedNativeCallId,
  reconcileNativeCallLifecycle,
  type NativeLifecycleResult,
} from '@/services/callKitLifecycleService';
import { getSupabaseClient } from '@/template';

type ActionEvent = CallKitAnswerEvent | CallKitEndEvent;

export const CALLKIT_FAST_RETRY_DELAYS_MS = [1500, 5000, 15000] as const;
export const CALLKIT_SLOW_RETRY_DELAY_MS = 30_000;
export const CALLKIT_PENDING_EVENT_TTL_MS = 24 * 60 * 60 * 1000;
export const LAUNCH_GATE_INITIAL_TIMEOUT_MS = 15_000;
const RETRY_DELAYS_MS = CALLKIT_FAST_RETRY_DELAYS_MS;

export function callKitRetryDelay(attempt: number): number {
  return CALLKIT_FAST_RETRY_DELAYS_MS[attempt] ?? CALLKIT_SLOW_RETRY_DELAY_MS;
}

export function isCallKitPendingEventExpired(
  event: Pick<CallKitPendingEvent, 'timestamp'>,
  now = Date.now(),
): boolean {
  return !Number.isFinite(event.timestamp)
    || event.timestamp <= 0
    || now - event.timestamp >= CALLKIT_PENDING_EVENT_TTL_MS;
}

function isActionEvent(event: CallKitPendingEvent): event is ActionEvent {
  return event.name === 'answerCall' || event.name === 'endCall';
}

function actionKey(event: ActionEvent): string {
  return `${event.name}:${event.callId}`;
}

export function IosCallKitActionHandler() {
  const router = useRouter();
  const pathname = usePathname();
  const rootNavigationState = useRootNavigationState();
  const { user, isAuthReady } = useAuth();
  const { dismissIncomingCall } = useAgoraCallSignaling();
  const [nativeCallId, setNativeCallId] = useState<string | null>(null);
  const [launchGate, setLaunchGate] = useState<{
    callId: string;
    eventId: string;
    screen: 'call' | 'video-call';
    targetPath?: string;
    failed: boolean;
  } | null>(null);

  const readyRef = useRef(false);
  const mountedRef = useRef(true);
  const userIdRef = useRef<string | null>(null);
  const completedEventIdsRef = useRef<Set<string>>(new Set());
  const processingEventIdsRef = useRef<Set<string>>(new Set());
  const inFlightActionsRef = useRef<Map<string, Promise<void>>>(new Map());
  const retryCountsRef = useRef<Map<string, number>>(new Map());
  const retryTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const scheduleRetryRef = useRef<(event: ActionEvent, enqueue: (nextEvent: ActionEvent) => void) => void>(() => {});
  const navigatedCallIdsRef = useRef<Set<string>>(new Set());
  const navigationFlightsRef = useRef<Map<string, Promise<void>>>(new Map());
  const launchGateRef = useRef(launchGate);
  const pathnameRef = useRef(pathname);
  const launchGateRetryCountRef = useRef(0);
  const launchGateRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconcileLaunchGateRef = useRef<(callId: string) => void>(() => {});
  const lifecycleInFlightRef = useRef<Set<string>>(new Set());
  const lifecycleProcessedRef = useRef<Set<string>>(new Set());
  const lifecycleRetryCountsRef = useRef<Map<string, number>>(new Map());
  const lifecycleRetryTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const nativeStateRetryCountRef = useRef(0);
  const nativeStateRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshNativeCallRef = useRef<() => void>(() => {});

  launchGateRef.current = launchGate;
  pathnameRef.current = pathname;

  const clearRetryTimer = useCallback((eventId: string) => {
    const timer = retryTimersRef.current.get(eventId);
    if (timer) clearTimeout(timer);
    retryTimersRef.current.delete(eventId);
  }, []);

  const clearLaunchGateRetry = useCallback(() => {
    if (launchGateRetryTimerRef.current) clearTimeout(launchGateRetryTimerRef.current);
    launchGateRetryTimerRef.current = null;
    launchGateRetryCountRef.current = 0;
  }, []);

  const markCompleted = useCallback(async (eventId: string) => {
    await consumePendingEventStrict(eventId);
    completedEventIdsRef.current.add(eventId);
    retryCountsRef.current.delete(eventId);
    clearRetryTimer(eventId);
  }, [clearRetryTimer]);

  const completeAnswerHandoff = useCallback(async (callId: string, eventId: string) => {
    const acknowledged = await markCallKitHandoffCompleted(callId, eventId);
    if (!acknowledged) return false;
    completedEventIdsRef.current.add(eventId);
    retryCountsRef.current.delete(eventId);
    clearRetryTimer(eventId);
    return true;
  }, [clearRetryTimer]);

  const cleanupVisualState = useCallback(async (callId?: string) => {
    // This handler only reconciles iOS CallKit calls. Unload sounds without
    // asking expo-av to replace the session owned by CallKit.
    await stopAllCallSounds({ preserveCallKitAudioSession: true });
    if (callId) {
      dismissIncomingCall(callId);
      await dismissPresentedCallNotifications(callId);
    }
  }, [dismissIncomingCall]);

  const consumeInvalidatedAnswerEvents = useCallback(async (callId: string) => {
    const events = await getPendingEvents();
    await Promise.all(events
      .filter((event): event is CallKitAnswerEvent => event.name === 'answerCall' && event.callId === callId)
      .map(event => markCompleted(event.eventId)));
  }, [markCompleted]);

  const navigateToAcceptedCall = useCallback((
    result: Extract<CallKitReconcileResult, { kind: 'accepted' }>,
    eventId: string,
    retry = false,
  ): Promise<void> => {
    const callId = result.accepted.callId;
    const existing = navigationFlightsRef.current.get(callId);
    if (existing) return existing;
    if (!retry && navigatedCallIdsRef.current.has(callId)) return Promise.resolve();
    navigatedCallIdsRef.current.add(callId);

    const screen = result.accepted.callType === 'audio' ? 'call' : 'video-call';
    const targetPath = `/${screen}/${result.call.callerId}`;
    setLaunchGate(current => current?.callId === callId
      ? { ...current, screen, targetPath }
      : { callId, eventId, screen, targetPath, failed: false });
    const flight = Promise.resolve().then(() => {
      navigateAcceptedCallRoute(router, {
        callId,
        callerId: result.call.callerId,
        channelName: result.accepted.channelName,
        callerName: result.caller.displayName,
        callerAvatar: result.caller.avatarUrl,
        callType: result.accepted.callType,
      }, 'callkit');
    });
    navigationFlightsRef.current.set(callId, flight);
    void flight.then(
      () => { if (navigationFlightsRef.current.get(callId) === flight) navigationFlightsRef.current.delete(callId); },
      () => { if (navigationFlightsRef.current.get(callId) === flight) navigationFlightsRef.current.delete(callId); },
    );
    return flight;
  }, [router]);

  const scheduleRetry = useCallback((event: ActionEvent, enqueue: (nextEvent: ActionEvent) => void) => {
    if (completedEventIdsRef.current.has(event.eventId)) return;
    if (isCallKitPendingEventExpired(event)) {
      retryCountsRef.current.delete(event.eventId);
      clearRetryTimer(event.eventId);
      return;
    }
    if (retryTimersRef.current.has(event.eventId)) return;
    const current = retryCountsRef.current.get(event.eventId) ?? 0;
    const delay = callKitRetryDelay(current);
    retryCountsRef.current.set(event.eventId, current + 1);
    const timer = setTimeout(() => {
      retryTimersRef.current.delete(event.eventId);
      if (!mountedRef.current || completedEventIdsRef.current.has(event.eventId)) return;
      if (!readyRef.current) {
        scheduleRetryRef.current(event, enqueue);
        return;
      }
      getPendingEventsStrict()
        .then(events => {
          const persisted = events.find(candidate => candidate.eventId === event.eventId);
          if (!persisted || !isActionEvent(persisted) || isCallKitPendingEventExpired(persisted)) {
            retryCountsRef.current.delete(event.eventId);
            completedEventIdsRef.current.add(event.eventId);
            return;
          }
          enqueue(persisted);
        })
        .catch(() => scheduleRetryRef.current(event, enqueue));
    }, delay);
    retryTimersRef.current.set(event.eventId, timer);
  }, [clearRetryTimer]);

  scheduleRetryRef.current = scheduleRetry;

  const handleResult = useCallback(async (event: ActionEvent, result: CallKitReconcileResult) => {
    if (result.kind === 'accepted') {
      await cleanupVisualState(result.accepted.callId);
      const connected = await reportCallConnected(result.accepted.callId);
      if (!connected && __DEV__) {
        console.warn('[IosCallKitActionHandler] reportCallConnected did not match native state', {
          callId: result.accepted.callId,
        });
      }
      const handoffStarted = await markCallKitHandoffStarted(result.accepted.callId, event.eventId);
      if (!handoffStarted) {
        throw new Error('native_handoff_start_failed');
      }
      void navigateToAcceptedCall(result, event.eventId).catch(() => {
        if (launchGateRef.current?.callId === result.accepted.callId) {
          reconcileLaunchGateRef.current(result.accepted.callId);
        }
      });
      return;
    }

    if (result.kind === 'terminal') {
      if (launchGateRef.current?.callId === result.callId) clearLaunchGateRetry();
      setLaunchGate(current => current?.callId === result.callId ? null : current);
      console.log('[CallNavigation] terminal_before_mount', { callId: `${result.callId.slice(0, 8)}…`, reason: result.reportReason ?? 'terminal' });
      if (event.name === 'answerCall' && result.reportReason) {
        await closeNativeCallIfMatching(result.callId, result.reportReason).catch(() => false);
      }
      await cleanupVisualState(result.callId);
      await markCompleted(event.eventId);
      return;
    }

    if (result.kind === 'invalid') {
      if (result.callId && launchGateRef.current?.callId === result.callId) clearLaunchGateRetry();
      if (result.callId) setLaunchGate(current => current?.callId === result.callId ? null : current);
      if (event.name === 'answerCall' && result.callId && result.reportReason) {
        await closeNativeCallIfMatching(result.callId, result.reportReason).catch(() => false);
      }
      await cleanupVisualState(result.callId);
      await markCompleted(event.eventId);
    }
  }, [cleanupVisualState, clearLaunchGateRetry, markCompleted, navigateToAcceptedCall]);

  const processEvent = useCallback(async (
    event: ActionEvent,
    enqueue: (nextEvent: ActionEvent) => void,
  ) => {
    if (!readyRef.current || !userIdRef.current) {
      scheduleRetry(event, enqueue);
      return;
    }
    if (completedEventIdsRef.current.has(event.eventId)) return;
    if (processingEventIdsRef.current.has(event.eventId)) return;

    const key = actionKey(event);
    const existing = inFlightActionsRef.current.get(key);
    if (existing) {
      const onSettled = () => {
        if (!completedEventIdsRef.current.has(event.eventId)) enqueue(event);
      };
      void existing.then(onSettled, onSettled);
      return;
    }

    processingEventIdsRef.current.add(event.eventId);
    const promise = (async () => {
      try {
        if (event.name === 'answerCall') {
          const deviceId = await getCurrentCallDeviceId();
          if (!deviceId) {
            scheduleRetry(event, enqueue);
            return;
          }
          const result = await reconcileAnswerCallKitEvent({
            event,
            userId: userIdRef.current as string,
            deviceId,
          });
          if (result.kind === 'retry') {
            scheduleRetry(event, enqueue);
            return;
          }
          await handleResult(event, result);
          return;
        }

        const result = await reconcileEndCallKitEvent({
          event,
          userId: userIdRef.current as string,
        });
        if (result.kind === 'retry') {
          scheduleRetry(event, enqueue);
          return;
        }
        await handleResult(event, result);
      } finally {
        processingEventIdsRef.current.delete(event.eventId);
        inFlightActionsRef.current.delete(key);
      }
    })();
    inFlightActionsRef.current.set(key, promise);
    await promise;
  }, [handleResult, scheduleRetry]);

  const enqueueEvent = useCallback((event: ActionEvent) => {
    if (event.name === 'answerCall') {
      console.log('[CallNavigation] answer_received', { callId: `${event.callId.slice(0, 8)}…` });
      console.log('[CallNavigation] queued', { callId: `${event.callId.slice(0, 8)}…` });
      if (launchGateRef.current && launchGateRef.current.callId !== event.callId) clearLaunchGateRetry();
      setLaunchGate(current => current?.callId === event.callId
        ? current
        : { callId: event.callId, eventId: event.eventId, screen: 'call', failed: false });
    }
    processEvent(event, enqueueEvent).catch(() => {
      scheduleRetry(event, enqueueEvent);
    });
  }, [clearLaunchGateRetry, processEvent, scheduleRetry]);

  const scheduleLaunchGateRetry = useCallback((callId: string) => {
    if (!mountedRef.current || launchGateRetryTimerRef.current || launchGateRef.current?.callId !== callId) return;
    const attempt = launchGateRetryCountRef.current;
    launchGateRetryCountRef.current = attempt + 1;
    launchGateRetryTimerRef.current = setTimeout(() => {
      launchGateRetryTimerRef.current = null;
      if (mountedRef.current && launchGateRef.current?.callId === callId) reconcileLaunchGateRef.current(callId);
    }, callKitRetryDelay(attempt));
  }, []);

  const reconcileLaunchGate = useCallback((callId: string) => {
    const gate = launchGateRef.current;
    if (gate?.callId !== callId) return;
    if (!readyRef.current || !userIdRef.current) {
      scheduleLaunchGateRetry(callId);
      return;
    }
    if (gate.targetPath ? pathnameRef.current === gate.targetPath : pathnameRef.current.startsWith(`/${gate.screen}/`)) {
      return;
    }
    if (navigationFlightsRef.current.has(callId)) {
      scheduleLaunchGateRetry(callId);
      return;
    }

    const resultFlight = (async () => {
      const deviceId = await getCurrentCallDeviceId();
      if (!deviceId) return { kind: 'retry' as const };
      return reconcileIncomingCallAcceptance({
        eventId: `launch-gate:${callId}`,
        callId,
        userId: userIdRef.current as string,
        deviceId,
      });
    })();
    const navigationFlight = resultFlight.then(() => undefined);
    navigationFlightsRef.current.set(callId, navigationFlight);
    void resultFlight.then(async result => {
      const currentGate = launchGateRef.current;
      if (currentGate?.callId !== callId) return;
      if (currentGate.targetPath
        ? pathnameRef.current === currentGate.targetPath
        : pathnameRef.current.startsWith(`/${currentGate.screen}/`)) {
        return;
      }
      if (result.kind === 'accepted') {
        navigationFlightsRef.current.delete(callId);
        await navigateToAcceptedCall(result, currentGate.eventId, true);
        scheduleLaunchGateRetry(callId);
        return;
      }
      if (result.kind === 'terminal' || result.kind === 'invalid') {
        clearLaunchGateRetry();
        if (result.callId && result.reportReason) {
          await closeNativeCallIfMatching(result.callId, result.reportReason).catch(() => false);
        }
        await cleanupVisualState(result.callId);
        if (launchGateRef.current?.callId !== callId) return;
        setLaunchGate(null);
        replaceCallWithHome(router);
        return;
      }
      scheduleLaunchGateRetry(callId);
    }, () => scheduleLaunchGateRetry(callId)).then(
      () => { if (navigationFlightsRef.current.get(callId) === navigationFlight) navigationFlightsRef.current.delete(callId); },
      () => {
        if (navigationFlightsRef.current.get(callId) === navigationFlight) navigationFlightsRef.current.delete(callId);
        scheduleLaunchGateRetry(callId);
      },
    );
  }, [cleanupVisualState, clearLaunchGateRetry, navigateToAcceptedCall, router, scheduleLaunchGateRetry]);

  reconcileLaunchGateRef.current = reconcileLaunchGate;

  useEffect(() => {
    if (!launchGate) return;
    const isExpectedScreen = launchGate.targetPath
      ? pathname === launchGate.targetPath
      : pathname.startsWith(`/${launchGate.screen}/`);
    if (isExpectedScreen) {
      console.log('[CallNavigation] screen_mounted', { callId: `${launchGate.callId.slice(0, 8)}…` });
      void completeAnswerHandoff(launchGate.callId, launchGate.eventId).then(completed => {
        if (!completed || launchGateRef.current?.callId !== launchGate.callId) {
          scheduleLaunchGateRetry(launchGate.callId);
          return;
        }
        console.log('[CallNavigation] gate_hidden', { callId: `${launchGate.callId.slice(0, 8)}…` });
        clearLaunchGateRetry();
        setLaunchGate(current => current?.callId === launchGate.callId ? null : current);
      });
    }
  }, [clearLaunchGateRetry, completeAnswerHandoff, launchGate, pathname, scheduleLaunchGateRetry]);

  const launchGateCallId = launchGate?.callId;
  useEffect(() => {
    if (!launchGateCallId) return;
    const timer = setTimeout(() => {
      console.warn('[CallNavigation] terminal_before_mount', { callId: `${launchGateCallId.slice(0, 8)}…`, reason: 'navigation_timeout' });
      setLaunchGate(current => current?.callId === launchGateCallId ? { ...current, failed: true } : current);
      reconcileLaunchGateRef.current(launchGateCallId);
    }, LAUNCH_GATE_INITIAL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [launchGateCallId]);

  const drainPendingEvents = useCallback(() => {
    if (!readyRef.current) return;
    getPendingEvents()
      .then(events => {
        events.filter(isActionEvent).forEach(enqueueEvent);
      })
      .catch(() => {});
  }, [enqueueEvent]);

  const clearLifecycleRetry = useCallback((callId: string) => {
    const timer = lifecycleRetryTimersRef.current.get(callId);
    if (timer) clearTimeout(timer);
    lifecycleRetryTimersRef.current.delete(callId);
  }, []);

  const scheduleLifecycleRetry = useCallback((callId: string, retry: (nextCallId: string) => void) => {
    const current = lifecycleRetryCountsRef.current.get(callId) ?? 0;
    if (current >= RETRY_DELAYS_MS.length) return;

    const delay = RETRY_DELAYS_MS[current];
    lifecycleRetryCountsRef.current.set(callId, current + 1);
    clearLifecycleRetry(callId);
    const timer = setTimeout(() => {
      lifecycleRetryTimersRef.current.delete(callId);
      retry(callId);
    }, delay);
    lifecycleRetryTimersRef.current.set(callId, timer);
  }, [clearLifecycleRetry]);

  const clearNativeStateRetry = useCallback(() => {
    if (nativeStateRetryTimerRef.current) clearTimeout(nativeStateRetryTimerRef.current);
    nativeStateRetryTimerRef.current = null;
  }, []);

  const refreshNativeCall = useCallback(() => {
    if (!readyRef.current) return;
    getReportedNativeCallId()
      .then(callId => {
        nativeStateRetryCountRef.current = 0;
        clearNativeStateRetry();
        setNativeCallId(callId);
      })
      .catch(() => {
        const attempt = nativeStateRetryCountRef.current;
        if (attempt >= RETRY_DELAYS_MS.length || nativeStateRetryTimerRef.current) return;
        nativeStateRetryCountRef.current = attempt + 1;
        nativeStateRetryTimerRef.current = setTimeout(() => {
          nativeStateRetryTimerRef.current = null;
          if (readyRef.current) refreshNativeCallRef.current();
        }, RETRY_DELAYS_MS[attempt]);
      });
  }, [clearNativeStateRetry]);

  refreshNativeCallRef.current = refreshNativeCall;

  useEffect(() => {
    mountedRef.current = true;
    const retryTimers = retryTimersRef.current;
    const navigationFlights = navigationFlightsRef.current;
    return () => {
      mountedRef.current = false;
      clearNativeStateRetry();
      clearLaunchGateRetry();
      retryTimers.forEach(timer => clearTimeout(timer));
      retryTimers.clear();
      navigationFlights.clear();
    };
  }, [clearLaunchGateRetry, clearNativeStateRetry]);

  const handleLifecycleResult = useCallback(async (result: NativeLifecycleResult) => {
    if (result.kind === 'connected') {
      console.log('[CallLifecycle] native_reconciled', { callId: `${result.callId.slice(0, 8)}…`, status: 'accepted' });
      await cleanupVisualState(result.callId);
      lifecycleProcessedRef.current.add(`${result.callId}:connected`);
      lifecycleRetryCountsRef.current.delete(result.callId);
      clearLifecycleRetry(result.callId);
      return;
    }

    if (result.kind === 'terminal') {
      console.log('[CallLifecycle] stale_native_call_cleared', { callId: `${result.callId.slice(0, 8)}…`, reason: result.reason });
      const key = `${result.callId}:terminal:${result.reason}`;
      await cleanupVisualState(result.callId);
      await consumeInvalidatedAnswerEvents(result.callId);
      lifecycleProcessedRef.current.add(key);
      lifecycleRetryCountsRef.current.delete(result.callId);
      clearLifecycleRetry(result.callId);
    }
  }, [cleanupVisualState, clearLifecycleRetry, consumeInvalidatedAnswerEvents]);

  const processNativeLifecycle = useCallback((callId: string) => {
    if (!readyRef.current) return;
    if (lifecycleInFlightRef.current.has(callId)) return;

    lifecycleInFlightRef.current.add(callId);
    const terminalReasons = Array.from(lifecycleProcessedRef.current)
      .filter(key => key.startsWith(`${callId}:terminal:`))
      .map(key => key.replace(`${callId}:terminal:`, '') as Exclude<CallKitEndReason, 'localEnded'>);
    reconcileNativeCallLifecycle(callId, {
      connected: lifecycleProcessedRef.current.has(`${callId}:connected`),
      terminalReasons,
    })
      .then(async result => {
        if (result.kind === 'retry') {
          scheduleLifecycleRetry(callId, processNativeLifecycle);
          return;
        }
        if (result.kind === 'connected' && lifecycleProcessedRef.current.has(`${result.callId}:connected`)) return;
        if (result.kind === 'terminal' && lifecycleProcessedRef.current.has(`${result.callId}:terminal:${result.reason}`)) return;
        await handleLifecycleResult(result);
        refreshNativeCall();
      })
      .catch(() => {
        scheduleLifecycleRetry(callId, processNativeLifecycle);
      })
      .finally(() => {
        lifecycleInFlightRef.current.delete(callId);
      });
  }, [handleLifecycleResult, refreshNativeCall, scheduleLifecycleRetry]);

  useEffect(() => {
    readyRef.current = Platform.OS === 'ios' && isAuthReady && Boolean(user?.id) && Boolean(rootNavigationState?.key);
    userIdRef.current = user?.id ?? null;
    if (isAuthReady) console.log('[CallNavigation] auth_ready');
    if (rootNavigationState?.key) console.log('[CallNavigation] router_ready');
    if (readyRef.current) drainPendingEvents();
    if (readyRef.current) refreshNativeCall();
  }, [drainPendingEvents, isAuthReady, refreshNativeCall, rootNavigationState?.key, user?.id]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    if (!isAuthReady || !user?.id || !rootNavigationState?.key) return;

    ensureIosCallKitStarted();
    const answerSub = onAnswerCall(enqueueEvent);
    const endSub = onEndCall(enqueueEvent);
    const muteSub = onMuteCall(event => {
      setActiveAgoraCallMuted(event.callId, event.payload.muted);
    });
    drainPendingEvents();
    const retryTimers = retryTimersRef.current;
    const lifecycleRetryTimers = lifecycleRetryTimersRef.current;

    const appStateSub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        drainPendingEvents();
        refreshNativeCall();
        if (nativeCallId) processNativeLifecycle(nativeCallId);
      }
    });
    const netInfoSub = NetInfo.addEventListener(state => {
      if (state.isConnected) {
        drainPendingEvents();
        refreshNativeCall();
        if (nativeCallId) processNativeLifecycle(nativeCallId);
      }
    });

    return () => {
      answerSub.remove();
      endSub.remove();
      muteSub.remove();
      appStateSub.remove();
      netInfoSub();
      retryTimers.forEach(timer => clearTimeout(timer));
      retryTimers.clear();
      lifecycleRetryTimers.forEach(timer => clearTimeout(timer));
      lifecycleRetryTimers.clear();
    };
  }, [
    drainPendingEvents,
    enqueueEvent,
    isAuthReady,
    nativeCallId,
    processNativeLifecycle,
    refreshNativeCall,
    rootNavigationState?.key,
    user?.id,
  ]);

  useEffect(() => {
    if (!readyRef.current || !nativeCallId) return;
    processNativeLifecycle(nativeCallId);
  }, [nativeCallId, processNativeLifecycle]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    if (!isAuthReady || !user?.id || !rootNavigationState?.key || !nativeCallId) return;

    const supabase = getSupabaseClient();
    const channel = supabase.channel(`callkit:lifecycle:${nativeCallId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'calls',
        filter: `id=eq.${nativeCallId}`,
      }, () => {
        processNativeLifecycle(nativeCallId);
      })
      .subscribe();

    processNativeLifecycle(nativeCallId);

    return () => {
      channel.unsubscribe();
    };
  }, [isAuthReady, nativeCallId, processNativeLifecycle, rootNavigationState?.key, user?.id]);

  if (!launchGate) return null;
  return (
    <View style={styles.launchGate} pointerEvents="auto">
      <Text style={styles.brand}>OnSpace</Text>
      <Text style={styles.message}>
        {launchGate.failed ? 'No se pudo abrir la llamada. Finalízala desde CallKit o inténtalo nuevamente.' : 'Conectando llamada…'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  launchGate: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10_000,
    elevation: 10_000,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0A0A0F',
    paddingHorizontal: 32,
  },
  brand: { color: '#FFFFFF', fontSize: 34, fontWeight: '700', letterSpacing: 0.5 },
  message: { color: '#B8B8C7', fontSize: 16, marginTop: 18, textAlign: 'center' },
});
