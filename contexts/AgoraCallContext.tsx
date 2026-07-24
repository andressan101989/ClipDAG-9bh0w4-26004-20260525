/**
 * contexts/AgoraCallContext.tsx
 *
 * Signaling for 1:1 Agora video calls. Agora RTC only transports media — it
 * has no concept of "ringing" or "reject", so this context pairs it with a
 * persisted `calls` table + Supabase Realtime postgres_changes to notify a
 * callee of an incoming call. Unlike the ephemeral broadcast approach this
 * replaces, a row in `calls` survives the callee's realtime channel not
 * being subscribed yet (cold start, reconnect) — postgres_changes replays
 * against the row once the subscription is live. A push notification is
 * also fired through the send-call-notification Edge Function so the callee is
 * reachable while backgrounded.
 *
 * "Accepted" is implicit: the callee joining the Agora channel is itself the
 * acceptance signal the caller's screen listens for.
 */
import React, {
  createContext, useContext, useCallback, useEffect, useRef, useState, ReactNode,
} from 'react';
import { AppState, Platform, Vibration } from 'react-native';
import { useRootNavigationState, useRouter } from 'expo-router';
import { getSupabaseClient, useAlert } from '@/template';
import { useAuth } from '@/hooks/useAuth';
import { startCall, timeoutCall } from '@/services/callSessionService';
import {
  startIncomingRingtone,
  stopAllCallSounds,
  stopIncomingRingtone,
} from '@/services/callRingtoneService';
import {
  dismissPresentedCallNotifications,
  sendCallNotification,
} from '@/services/callNotificationService';
import {
  getCurrentCallDeviceId,
  getForegroundPresentationReadiness,
} from '@/services/callDeviceService';
import { reconcileIncomingCallAcceptance, rejectCallSingleFlight } from '@/services/callKitActionService';
import { navigateToAcceptedCall } from '@/services/callNavigationService';
import {
  classifyForegroundClaim,
  shouldSuppressForegroundModal,
} from '@/services/callPresentationPolicy';
import {
  getNativeStateStrict,
  isIosCallKitAvailable,
  onIncomingCall,
} from '@/services/iosCallKitService';

export type CallType = 'audio' | 'video';

export interface IncomingCall {
  callId:       string;
  callerId:     string;
  callerName:   string;
  callerAvatar: string;
  channelName:  string;
  callType:     CallType;
  expiresAt?:    string;
}

interface AgoraCallContextType {
  broadcastIncomingCall: (targetUserId: string, call: IncomingCall) => Promise<IncomingCall | null>;
  broadcastCallRejected: (targetUserId: string, callId: string) => Promise<void>;
  onCallRejected:        (callId: string, cb: () => void) => () => void;
  onCallAccepted:        (callId: string, cb: () => void) => () => void;
  markCallMissed:        (callId: string) => Promise<void>;
  presentIncomingCall:   (call: IncomingCall) => void;
  incomingCall:          IncomingCall | null;
  dismissIncomingCall:   (callId?: string) => void;
  acceptIncomingCall:    () => Promise<void>;
  rejectIncomingCall:    () => void;
}

const AgoraCallContext = createContext<AgoraCallContextType | undefined>(undefined);

const NOOP_CTX: AgoraCallContextType = {
  broadcastIncomingCall: async () => null,
  broadcastCallRejected: async () => {},
  onCallRejected:        () => () => {},
  onCallAccepted:        () => () => {},
  markCallMissed:        async () => {},
  presentIncomingCall:   () => {},
  incomingCall:          null,
  dismissIncomingCall:   () => {},
  acceptIncomingCall:    async () => {},
  rejectIncomingCall:    () => {},
};

export function useAgoraCallSignaling(): AgoraCallContextType {
  const ctx = useContext(AgoraCallContext);
  return ctx ?? NOOP_CTX;
}

const RING_TIMEOUT_MS = 30_000;
const TIMEOUT_GRACE_MS = 500;
const HANDOFF_RETRY_DELAYS_MS = [250, 750, 1500] as const;

type ForegroundHandoffResult =
  | 'released'
  | 'already_callkit'
  | 'terminal'
  | 'not_releasable'
  | 'not_found'
  | 'unknown';

const redactCallId = (callId: string) => `${callId.slice(0, 8)}…`;
const logPresentation = (
  event: string,
  callId: string,
  details: Record<string, unknown> = {},
) => console.log(`[CallPresentation] ${event}`, { callId: redactCallId(callId), ...details });

export function AgoraCallProvider({ children }: { children: ReactNode }) {
  const { user, isAuthReady } = useAuth();
  const router = useRouter();
  const rootNavigationState = useRootNavigationState();
  const { showAlert } = useAlert();

  const supabaseRef = useRef<ReturnType<typeof getSupabaseClient> | null>(null);
  if (!supabaseRef.current) {
    try { supabaseRef.current = getSupabaseClient(); } catch { /* backend unavailable */ }
  }

  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const rejectListenersRef  = useRef<Map<string, () => void>>(new Map());
  const acceptListenersRef  = useRef<Map<string, () => void>>(new Map());
  const ringTimeoutRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presentationClaimFlightsRef = useRef<Map<string, Promise<void>>>(new Map());
  const presentationHandoffFlightsRef = useRef<Map<string, Promise<ForegroundHandoffResult>>>(new Map());
  const handoffRequestedIdsRef = useRef<Set<string>>(new Set());
  const callKitSuppressedIdsRef = useRef<Set<string>>(new Set());
  const onspaceOwnedIdsRef = useRef<Set<string>>(new Set());
  const incomingActionFlightRef = useRef<Set<string>>(new Set());
  const modalGenerationRef = useRef(0);
  const providerMountedRef = useRef(true);

  useEffect(() => {
    providerMountedRef.current = true;
    return () => { providerMountedRef.current = false; };
  }, []);

  const clearRingTimeout = useCallback(() => {
    if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null; }
  }, []);

  const releaseForegroundPresentation = useCallback((
    callId: string,
    deviceId: string,
  ): Promise<ForegroundHandoffResult> => {
    const key = `${callId}:${deviceId}`;
    const existing = presentationHandoffFlightsRef.current.get(key);
    if (existing) return existing;

    handoffRequestedIdsRef.current.add(callId);
    const flight = (async (): Promise<ForegroundHandoffResult> => {
      for (let attempt = 0; attempt <= HANDOFF_RETRY_DELAYS_MS.length; attempt += 1) {
        const supabase = supabaseRef.current;
        if (supabase) {
          try {
            const { data, error } = await supabase.rpc(
              'release_foreground_call_presentation_to_callkit',
              { p_call_id: callId, p_device_id: deviceId },
            );
            if (!error) {
              const row = Array.isArray(data) ? data[0] : data;
              const result = row && typeof row === 'object'
                ? (row as { result?: unknown }).result
                : null;
              if (result === 'released' || result === 'already_callkit' || result === 'terminal' ||
                  result === 'not_releasable' || result === 'not_found') {
                return result;
              }
            }
          } catch {
            // Bounded retry below. Unknown ownership must never show a modal.
          }
        }
        if (attempt < HANDOFF_RETRY_DELAYS_MS.length) {
          await new Promise<void>(resolve => setTimeout(resolve, HANDOFF_RETRY_DELAYS_MS[attempt]));
        }
      }
      return 'unknown';
    })();

    presentationHandoffFlightsRef.current.set(key, flight);
    const clearFlight = () => {
      if (presentationHandoffFlightsRef.current.get(key) === flight) {
        presentationHandoffFlightsRef.current.delete(key);
      }
    };
    void flight.then(clearFlight, clearFlight);
    return flight;
  }, []);

  const stopIncomingAlerts = useCallback((callId?: string) => {
    Vibration.cancel();
    stopIncomingRingtone(callId).catch(() => {});
  }, []);

  const presentIncomingCall = useCallback((call: IncomingCall) => {
    setIncomingCall(prev => {
      if (prev?.callId === call.callId) return prev;
      if (!prev) logPresentation('modal_shown', call.callId, { appState: AppState.currentState });
      return prev ? prev : call;
    });
  }, []);

  const suppressModalForCallKit = useCallback((callId: string, reason = 'callkit_received') => {
    if (onspaceOwnedIdsRef.current.has(callId)) {
      logPresentation('callkit_suppressed', callId, { reason: 'owner_onspace_sticky' });
      return;
    }
    logPresentation('modal_suppressed', callId, { appState: AppState.currentState, reason });
    callKitSuppressedIdsRef.current.add(callId);
    setIncomingCall(prev => (prev?.callId === callId ? null : prev));
  }, []);

  const dismissIncomingCall = useCallback((callId?: string) => {
    clearRingTimeout();
    stopIncomingAlerts(callId);
    if (callId) dismissPresentedCallNotifications(callId).catch(() => {});
    setIncomingCall(prev => (!callId || prev?.callId === callId ? null : prev));
  }, [clearRingTimeout, stopIncomingAlerts]);

  const updateCallStatus = useCallback(async (callId: string, status: string) => {
    if (status === 'rejected') {
      await rejectCallSingleFlight(callId, 'user_rejected');
      return;
    }
    if (status === 'missed') {
      await timeoutCall(callId);
    }
  }, []);

  const getRingTimeoutMs = useCallback((expiresAt?: string | null) => {
    if (!expiresAt) return RING_TIMEOUT_MS;
    const timeoutMs = new Date(expiresAt).getTime() - Date.now() + TIMEOUT_GRACE_MS;
    return Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : RING_TIMEOUT_MS;
  }, []);
  // Shared by the realtime INSERT handler and the cold-start fetch below —
  // both need to turn a `calls` row into the incomingCall modal state the
  // same way.
  const handleIncomingCallRow = useCallback(async (row: {
    id: string; caller_id: string; channel_name: string; status: string; call_type?: string; expires_at?: string | null;
  }) => {
    const supabase = supabaseRef.current;
    if (!supabase || row.status !== 'ringing' || !isAuthReady || !user?.id || !rootNavigationState?.key) return;
    logPresentation('start', row.id, {
      appState: AppState.currentState,
      authReady: isAuthReady,
      routerReady: Boolean(rootNavigationState?.key),
    });

    const callerProfile = supabase
      .from('user_profiles').select('username, avatar_url').eq('id', row.caller_id).single();
    const presentFallback = async (resolvedCaller?: { username?: string | null; avatar_url?: string | null } | null) => {
      if (callKitSuppressedIdsRef.current.has(row.id)) return;
      const caller = resolvedCaller === undefined ? (await callerProfile).data : resolvedCaller;
      if (!providerMountedRef.current || callKitSuppressedIdsRef.current.has(row.id)) return;
      const call: IncomingCall = {
        callId:       row.id,
        callerId:     row.caller_id,
        callerName:   caller?.username || 'Usuario',
        callerAvatar: caller?.avatar_url || '',
        channelName:  row.channel_name,
        callType:     row.call_type === 'audio' ? 'audio' : 'video',
        expiresAt:    row.expires_at ?? undefined,
      };
      logPresentation('fallback_started', row.id, { appState: AppState.currentState });
      presentIncomingCall(call);
      clearRingTimeout();
      ringTimeoutRef.current = setTimeout(() => {
        void updateCallStatus(row.id, 'missed')
          .then(() => {
            setIncomingCall(prev => (prev?.callId === row.id ? null : prev));
          })
          .catch(() => {
            // Keep the authoritative ringing presentation available for retry.
          });
      }, getRingTimeoutMs(row.expires_at));
    };

    if (Platform.OS !== 'ios' || !isIosCallKitAvailable()) {
      await presentFallback();
      return;
    }

    const existingClaim = presentationClaimFlightsRef.current.get(row.id);
    if (existingClaim) {
      await existingClaim;
      return;
    }
    const generation = modalGenerationRef.current;
    const claimFlight = (async () => {
      if (!providerMountedRef.current || generation !== modalGenerationRef.current ||
          callKitSuppressedIdsRef.current.has(row.id) || handoffRequestedIdsRef.current.has(row.id)) return;

      if (!isAuthReady || !user?.id || !rootNavigationState?.key) return;

      const readiness = await getForegroundPresentationReadiness(user.id);
      if (!providerMountedRef.current || generation !== modalGenerationRef.current ||
          callKitSuppressedIdsRef.current.has(row.id) || handoffRequestedIdsRef.current.has(row.id)) return;

      // Non-D4D clients retain the established IOS-B fallback. A locally
      // eligible device with an existing identity but an unconfirmed server
      // capability fails closed below because it may already own a v1 row.
      if (readiness.localVersion < 1) {
        await presentFallback();
        return;
      }
      if (!readiness.deviceId) {
        // Registration has not produced an identity, so this device cannot
        // have been selected into the authoritative outbox yet.
        await presentFallback();
        return;
      }
      if (!readiness.capabilityConfirmed || AppState.currentState !== 'active') return;

      const [{ data: beforeClaim }, nativeBeforeClaim] = await Promise.all([
        supabase.from('calls').select('status').eq('id', row.id).maybeSingle<{ status: string }>(),
        getNativeStateStrict().catch(() => null),
      ]);
      if (!providerMountedRef.current || generation !== modalGenerationRef.current ||
          AppState.currentState !== 'active' || beforeClaim?.status !== 'ringing' ||
          callKitSuppressedIdsRef.current.has(row.id)) return;
      if (nativeBeforeClaim?.hasReportedCall && nativeBeforeClaim.currentCallId === row.id) {
        suppressModalForCallKit(row.id, 'callkit_arrived_before_claim');
        return;
      }

      const { data: claimRows, error: claimError } = await supabase.rpc(
        'claim_foreground_call_presentation',
        { p_call_id: row.id, p_device_id: readiness.deviceId },
      );
      // Unknown/error is fail-closed toward CallKit. A network failure must
      // never be interpreted as proof that no authoritative delivery exists.
      if (claimError) {
        logPresentation('claim_result', row.id, {
          appState: AppState.currentState,
          presentationVersion: readiness.localVersion,
          claimResult: 'retryable_error',
        });
        return;
      }
      const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
      const owner = claim && typeof claim === 'object'
        ? (claim as { owner?: unknown }).owner
        : null;
      const presentationStatus = claim && typeof claim === 'object'
        ? (claim as { presentation_status?: unknown }).presentation_status
        : null;
      const claimResult = classifyForegroundClaim(owner, presentationStatus);
      logPresentation('claim_result', row.id, {
        appState: AppState.currentState,
        presentationVersion: readiness.localVersion,
        owner,
        claimResult,
        presentationStatus,
      });

      // deadline_elapsed describes the time boundary, not a persisted owner.
      // Fail closed while the dispatcher performs the authoritative claim,
      // but do not poison this call's sticky suppression set prematurely.
      if (owner === 'callkit' && presentationStatus === 'deadline_elapsed') {
        logPresentation('modal_suppressed', row.id, {
          reason: 'deadline_elapsed_waiting_for_authoritative_callkit_owner',
        });
        return;
      }
      if (shouldSuppressForegroundModal(claimResult)) {
        suppressModalForCallKit(row.id, String(presentationStatus ?? owner));
        return;
      }
      if (owner !== 'onspace' && !(owner === 'not_found' && presentationStatus === 'not_found')) {
        return;
      }

      const [{ data: afterClaim }, nativeAfterClaim, { data: callerAfterClaim }] = await Promise.all([
        supabase.from('calls').select('status').eq('id', row.id).maybeSingle<{ status: string }>(),
        getNativeStateStrict().catch(() => null),
        callerProfile,
      ]);
      const callBecameTerminal = Boolean(afterClaim?.status && afterClaim.status !== 'ringing');
      if (callBecameTerminal) {
        logPresentation('terminal', row.id, { deliveryStatus: afterClaim?.status, reason: 'terminal_after_claim' });
        dismissIncomingCall(row.id);
        return;
      }
      const nativeCallKitOwnsCall = Boolean(
        nativeAfterClaim?.hasReportedCall && nativeAfterClaim.currentCallId === row.id,
      );
      const postClaimInvalid = !providerMountedRef.current ||
        generation !== modalGenerationRef.current ||
        AppState.currentState !== 'active' ||
        afterClaim?.status !== 'ringing' ||
        callKitSuppressedIdsRef.current.has(row.id) ||
        nativeCallKitOwnsCall;

      if (postClaimInvalid) {
        if (owner === 'onspace') {
          const handoffResult = await releaseForegroundPresentation(row.id, readiness.deviceId);
          logPresentation('modal_suppressed', row.id, {
            appState: AppState.currentState,
            reason: `foreground_handoff_${handoffResult}`,
          });
          if (handoffResult === 'released' || handoffResult === 'already_callkit' ||
              handoffResult === 'not_releasable' || handoffResult === 'unknown') {
            callKitSuppressedIdsRef.current.add(row.id);
          }
          if (handoffResult === 'terminal') dismissIncomingCall(row.id);
        }
        return;
      }

      // `not_found/not_found` is the RPC's explicit legacy/no-authoritative-
      // delivery result. `onspace/claimed` is sticky and uses the same modal,
      // ringtone and vibration flow only after ownership is confirmed.
      if (owner === 'onspace') {
        onspaceOwnedIdsRef.current.add(row.id);
        logPresentation('callkit_suppressed', row.id, { owner, reason: presentationStatus });
      }
      await presentFallback(callerAfterClaim);
    })();
    presentationClaimFlightsRef.current.set(row.id, claimFlight);
    const clearClaimFlight = () => {
      if (presentationClaimFlightsRef.current.get(row.id) === claimFlight) {
        presentationClaimFlightsRef.current.delete(row.id);
      }
    };
    void claimFlight.then(clearClaimFlight, clearClaimFlight);
    await claimFlight;
  }, [clearRingTimeout, dismissIncomingCall, getRingTimeoutMs, isAuthReady, presentIncomingCall, releaseForegroundPresentation, rootNavigationState?.key, suppressModalForCallKit, updateCallStatus, user?.id]);

  useEffect(() => {
    if (Platform.OS !== 'ios' || !isIosCallKitAvailable()) return;
    const subscription = onIncomingCall(event => {
      logPresentation('native_origin', event.callId, {
        nativeOrigin: event.payload.nativeOrigin,
        appStateNow: AppState.currentState,
        wasVisibleBeforePush: event.payload.wasAppVisibleBeforeVoipPush,
      });
      logPresentation('callkit_received', event.callId, { appState: AppState.currentState });
      suppressModalForCallKit(event.callId, 'callkit_received');
    });
    return () => subscription.remove();
  }, [suppressModalForCallKit]);

  // ── Callee: subscribe to new/updated rows addressed to me ─────────────────
  useEffect(() => {
    const supabase = supabaseRef.current;
    if (!user?.id || !supabase) return;
    const presentationClaimFlights = presentationClaimFlightsRef.current;
    const presentationHandoffFlights = presentationHandoffFlightsRef.current;
    const handoffRequestedIds = handoffRequestedIdsRef.current;
    const callKitSuppressedIds = callKitSuppressedIdsRef.current;
    const onspaceOwnedIds = onspaceOwnedIdsRef.current;

    const channel = supabase.channel(`calls:callee:${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'calls', filter: `callee_id=eq.${user.id}`,
      }, (payload: any) => {
        const row = payload.new as { id: string };
        logPresentation('realtime_received', row.id, { appState: AppState.currentState });
        handleIncomingCallRow(payload.new);
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'calls', filter: `callee_id=eq.${user.id}`,
      }, (payload: any) => {
        const row = payload.new as { id: string; status: string };
        // Caller cancelled before I answered — dismiss the modal.
        if (row.status !== 'ringing') {
          logPresentation('terminal', row.id, { deliveryStatus: row.status, reason: 'realtime_terminal' });
          clearRingTimeout();
          dismissPresentedCallNotifications(row.id).catch(() => {});
          setIncomingCall(prev => (prev?.callId === row.id ? null : prev));
          callKitSuppressedIds.delete(row.id);
          onspaceOwnedIds.delete(row.id);
          handoffRequestedIds.delete(row.id);
          for (const key of presentationHandoffFlights.keys()) {
            if (key.startsWith(`${row.id}:`)) presentationHandoffFlights.delete(key);
          }
        }
      })
      .subscribe();

    // Cold start: a call may have started ringing before this subscription
    // went live (app launch, background→foreground reconnect, killed-and-
    // relaunched app). postgres_changes only streams changes from the point
    // `.subscribe()` resolves, so without this check a pending incoming call
    // would never surface until the caller's next INSERT/UPDATE — which for
    // a one-shot "ringing" row may never come. Bounded to the same ring
    // window so a long-stale ringing row (crashed caller, never expired)
    // doesn't pop up as if it were live.
    (async () => {
      const cutoff = new Date(Date.now() - RING_TIMEOUT_MS).toISOString();
      const { data } = await supabase
        .from('calls')
        .select('id, caller_id, channel_name, status, call_type, created_at, expires_at')
        .eq('callee_id', user.id)
        .eq('status', 'ringing')
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) handleIncomingCallRow(data);
    })();

    return () => {
      modalGenerationRef.current += 1;
      clearRingTimeout();
      presentationClaimFlights.clear();
      presentationHandoffFlights.clear();
      handoffRequestedIds.clear();
      callKitSuppressedIds.clear();
      onspaceOwnedIds.clear();
      channel.unsubscribe();
    };
  }, [user?.id, clearRingTimeout, updateCallStatus, handleIncomingCallRow]);

  // ── Caller: watch my own outgoing calls for a reject ──────────────────────
  useEffect(() => {
    const supabase = supabaseRef.current;
    if (!user?.id || !supabase) return;

    const channel = supabase.channel(`calls:caller:${user.id}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'calls', filter: `caller_id=eq.${user.id}`,
      }, (payload: any) => {
        const row = payload.new as { id: string; status: string };
        if (row.status === 'rejected') {
          dismissPresentedCallNotifications(row.id).catch(() => {});
          const cb = rejectListenersRef.current.get(row.id);
          if (cb) cb();
        } else if (row.status === 'accepted') {
          dismissPresentedCallNotifications(row.id).catch(() => {});
          const cb = acceptListenersRef.current.get(row.id);
          if (cb) cb();
        } else if (['cancelled', 'expired', 'missed', 'ended'].includes(row.status)) {
          dismissPresentedCallNotifications(row.id).catch(() => {});
        }
      })
      .subscribe();

    return () => { channel.unsubscribe(); };
  }, [user?.id]);

  const incomingCallId = incomingCall?.callId;
  const incomingCallExpiresAt = incomingCall?.expiresAt;

  useEffect(() => {
    if (!incomingCallId) {
      stopIncomingAlerts();
      return;
    }

    const isStillRinging = () => !incomingCallExpiresAt || new Date(incomingCallExpiresAt).getTime() > Date.now();
    const startAlerts = () => {
      if (!isStillRinging()) return;
      startIncomingRingtone(incomingCallId).catch(() => {});
      Vibration.vibrate([0, 700, 900], true);
    };
    const stopAlerts = () => stopIncomingAlerts(incomingCallId);

    if (AppState.currentState === 'active') {
      startAlerts();
    } else {
      stopAlerts();
    }

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        startAlerts();
      } else {
        stopAlerts();
      }
    });

    return () => {
      subscription.remove();
      stopAlerts();
    };
  }, [incomingCallId, incomingCallExpiresAt, stopIncomingAlerts]);

  // ── Send helpers ──────────────────────────────────────────────────────────
  const broadcastIncomingCall = useCallback(async (targetUserId: string, call: IncomingCall) => {
    const supabase = supabaseRef.current;
    if (!supabase) return null;

    let startedCall: IncomingCall;
    try {
      const started = await startCall({
        calleeId: targetUserId,
        callType: call.callType,
        idempotencyKey: call.callId,
        callerDeviceId: await getCurrentCallDeviceId(),
      });
      startedCall = {
        ...call,
        callId: started.callId,
        channelName: started.channelName,
        callType: started.callType,
        expiresAt: started.expiresAt,
      };
    } catch (err: any) {
      console.error('[Call] Failed to start call:', err?.message ?? err);
      showAlert('Error', 'No se pudo iniciar la llamada. Intenta de nuevo.');
      return null;
    }

    sendCallNotification(startedCall.callId, 'incoming_call')
      .catch(() => { /* best-effort - realtime is the primary channel */ });

    return startedCall;
  }, [showAlert]);
  const broadcastCallRejected = useCallback(
    (_targetUserId: string, callId: string) => updateCallStatus(callId, 'rejected'),
    [updateCallStatus],
  );

  const markCallMissed = useCallback(
    (callId: string) => updateCallStatus(callId, 'missed'),
    [updateCallStatus],
  );

  const onCallRejected = useCallback((callId: string, cb: () => void) => {
    rejectListenersRef.current.set(callId, cb);
    return () => { rejectListenersRef.current.delete(callId); };
  }, []);

  const onCallAccepted = useCallback((callId: string, cb: () => void) => {
    acceptListenersRef.current.set(callId, cb);
    return () => { acceptListenersRef.current.delete(callId); };
  }, []);

  // ── Accept / reject the incoming-call modal ───────────────────────────────
  const acceptIncomingCall = useCallback(async () => {
    if (!incomingCall) return;
    const call = incomingCall;
    if (incomingActionFlightRef.current.has(call.callId)) return;
    incomingActionFlightRef.current.add(call.callId);

    try {
      const result = await reconcileIncomingCallAcceptance({
        eventId: `modal:${call.callId}`,
        callId: call.callId,
        userId: user?.id ?? '',
        deviceId: await getCurrentCallDeviceId(),
      });

      if (result.kind === 'retry') {
        showAlert('Error', 'No se pudo aceptar la llamada. Intenta de nuevo.');
        return; // keep the modal up so the user can retry
      }

      if (result.kind !== 'accepted') {
        clearRingTimeout();
        await stopAllCallSounds();
        Vibration.cancel();
        dismissPresentedCallNotifications(call.callId).catch(() => {});
        setIncomingCall(null);
        showAlert('Llamada', 'Esta llamada ya termino.');
        return;
      }

      clearRingTimeout();
      await stopAllCallSounds();
      Vibration.cancel();
      dismissPresentedCallNotifications(call.callId).catch(() => {});
      setIncomingCall(null);
      navigateToAcceptedCall(router, {
        callId: result.accepted.callId,
        callerId: result.call.callerId,
        channelName: result.accepted.channelName,
        callerName: result.caller.displayName,
        callerAvatar: result.caller.avatarUrl || '',
        callType: result.accepted.callType,
      }, 'onspace');
    } finally {
      incomingActionFlightRef.current.delete(call.callId);
    }
  }, [incomingCall, router, user?.id, clearRingTimeout, showAlert]);
  const rejectIncomingCall = useCallback(async () => {
    if (!incomingCall) return;
    const call = incomingCall;
    if (incomingActionFlightRef.current.has(call.callId)) return;
    incomingActionFlightRef.current.add(call.callId);
    try {
      await rejectCallSingleFlight(call.callId, 'user_rejected');
      clearRingTimeout();
      stopIncomingAlerts(call.callId);
      dismissPresentedCallNotifications(call.callId).catch(() => {});
      setIncomingCall(null);
    } catch {
      showAlert('Error', 'No se pudo rechazar la llamada. Intenta de nuevo.');
    } finally {
      incomingActionFlightRef.current.delete(call.callId);
    }
  }, [incomingCall, clearRingTimeout, stopIncomingAlerts, showAlert]);

  return (
    <AgoraCallContext.Provider value={{
      broadcastIncomingCall, broadcastCallRejected, onCallRejected, onCallAccepted, markCallMissed,
      presentIncomingCall,
      incomingCall, dismissIncomingCall, acceptIncomingCall, rejectIncomingCall,
    }}>
      {children}
    </AgoraCallContext.Provider>
  );
}
