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
 * also fired through the send-notification Edge Function so the callee is
 * reachable while backgrounded.
 *
 * "Accepted" is implicit: the callee joining the Agora channel is itself the
 * acceptance signal the caller's screen listens for.
 */
import React, {
  createContext, useContext, useCallback, useEffect, useRef, useState, ReactNode,
} from 'react';
import { AppState, Vibration } from 'react-native';
import { useRouter } from 'expo-router';
import { getSupabaseClient, useAlert } from '@/template';
import { useAuth } from '@/hooks/useAuth';
import { acceptCall, rejectCall, startCall, timeoutCall } from '@/services/callSessionService';
import {
  startIncomingRingtone,
  stopAllCallSounds,
  stopIncomingRingtone,
} from '@/services/callRingtoneService';

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
  incomingCall:          IncomingCall | null;
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
  incomingCall:          null,
  acceptIncomingCall:    async () => {},
  rejectIncomingCall:    () => {},
};

export function useAgoraCallSignaling(): AgoraCallContextType {
  const ctx = useContext(AgoraCallContext);
  return ctx ?? NOOP_CTX;
}

const RING_TIMEOUT_MS = 30_000;
const TIMEOUT_GRACE_MS = 500;

export function AgoraCallProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const router = useRouter();
  const { showAlert } = useAlert();

  const supabaseRef = useRef<ReturnType<typeof getSupabaseClient> | null>(null);
  if (!supabaseRef.current) {
    try { supabaseRef.current = getSupabaseClient(); } catch { /* backend unavailable */ }
  }

  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const rejectListenersRef  = useRef<Map<string, () => void>>(new Map());
  const acceptListenersRef  = useRef<Map<string, () => void>>(new Map());
  const ringTimeoutRef      = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRingTimeout = useCallback(() => {
    if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null; }
  }, []);

  const stopIncomingAlerts = useCallback((callId?: string) => {
    Vibration.cancel();
    stopIncomingRingtone(callId).catch(() => {});
  }, []);

  const updateCallStatus = useCallback(async (callId: string, status: string) => {
    if (status === 'rejected') {
      await rejectCall(callId, 'user_rejected');
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
    if (!supabase || row.status !== 'ringing') return;

    const { data: caller } = await supabase
      .from('user_profiles').select('username, avatar_url').eq('id', row.caller_id).single();

    setIncomingCall({
      callId:       row.id,
      callerId:     row.caller_id,
      callerName:   caller?.username || 'Usuario',
      callerAvatar: caller?.avatar_url || '',
      channelName:  row.channel_name,
      callType:     row.call_type === 'audio' ? 'audio' : 'video',
      expiresAt:    row.expires_at ?? undefined,
    });

    clearRingTimeout();
    ringTimeoutRef.current = setTimeout(() => {
      updateCallStatus(row.id, 'missed').catch(() => {});
      setIncomingCall(prev => (prev?.callId === row.id ? null : prev));
    }, getRingTimeoutMs(row.expires_at));
  }, [clearRingTimeout, getRingTimeoutMs, updateCallStatus]);

  // ── Callee: subscribe to new/updated rows addressed to me ─────────────────
  useEffect(() => {
    const supabase = supabaseRef.current;
    if (!user?.id || !supabase) return;

    const channel = supabase.channel(`calls:callee:${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'calls', filter: `callee_id=eq.${user.id}`,
      }, (payload: any) => { handleIncomingCallRow(payload.new); })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'calls', filter: `callee_id=eq.${user.id}`,
      }, (payload: any) => {
        const row = payload.new as { id: string; status: string };
        // Caller cancelled before I answered — dismiss the modal.
        if (row.status !== 'ringing') {
          clearRingTimeout();
          setIncomingCall(prev => (prev?.callId === row.id ? null : prev));
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

    return () => { clearRingTimeout(); channel.unsubscribe(); };
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
          const cb = rejectListenersRef.current.get(row.id);
          if (cb) cb();
        } else if (row.status === 'accepted') {
          const cb = acceptListenersRef.current.get(row.id);
          if (cb) cb();
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

    supabase.functions.invoke('send-notification', {
      body: {
        to_user_id: targetUserId,
        title:      `${call.callerName} te está llamando`,
        body:       startedCall.callType === 'audio' ? 'Llamada de audio entrante' : 'Videollamada entrante',
        data:       {
          type: 'incoming_call',
          callId: startedCall.callId,
          channelName: startedCall.channelName,
          callType: startedCall.callType,
        },
      },
    }).catch(() => { /* best-effort - realtime is the primary channel */ });

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

    let accepted;
    try {
      accepted = await acceptCall(call.callId);
    } catch (err: any) {
      console.error('[Call] Failed to mark call accepted:', err?.message ?? err);
      showAlert('Error', 'No se pudo aceptar la llamada. Intenta de nuevo.');
      return; // keep the modal up so the user can retry
    }

    clearRingTimeout();
    await stopAllCallSounds();
    Vibration.cancel();
    setIncomingCall(null);
    const qs = new URLSearchParams({
      mode:         'answer',
      channel:      accepted.channelName,
      callId:       accepted.callId,
      callerName:   call.callerName,
      callerAvatar: call.callerAvatar || '',
    }).toString();
    const screen = accepted.callType === 'audio' ? 'call' : 'video-call';
    router.push(`/${screen}/${call.callerId}?${qs}` as any);
  }, [incomingCall, router, clearRingTimeout, showAlert]);
  const rejectIncomingCall = useCallback(() => {
    if (!incomingCall) return;
    const call = incomingCall;
    clearRingTimeout();
    stopIncomingAlerts(call.callId);
    setIncomingCall(null);
    rejectCall(call.callId, 'user_rejected').catch(() => {});
  }, [incomingCall, clearRingTimeout, stopIncomingAlerts]);

  return (
    <AgoraCallContext.Provider value={{
      broadcastIncomingCall, broadcastCallRejected, onCallRejected, onCallAccepted, markCallMissed,
      incomingCall, acceptIncomingCall, rejectIncomingCall,
    }}>
      {children}
    </AgoraCallContext.Provider>
  );
}
