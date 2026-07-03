/**
 * contexts/AgoraCallContext.tsx
 *
 * Lightweight, ephemeral signaling for 1:1 Agora video calls. Agora RTC only
 * transports media — it has no concept of "ringing" or "reject", so this
 * context pairs it with Supabase Realtime broadcast (no DB table needed,
 * nothing persisted) to notify a callee of an incoming call and to let them
 * accept (→ navigate into the shared Agora channel) or reject (→ notify the
 * caller). "Accepted" is implicit: the callee joining the Agora channel is
 * itself the acceptance signal the caller's screen listens for.
 */
import React, {
  createContext, useContext, useCallback, useEffect, useRef, useState, ReactNode,
} from 'react';
import { View, Text, Pressable, StyleSheet, Modal } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { getSupabaseClient } from '@/template';
import { useAuth } from '@/hooks/useAuth';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';

export interface IncomingCall {
  callId:       string;
  callerId:     string;
  callerName:   string;
  callerAvatar: string;
  channelName:  string;
}

interface AgoraCallContextType {
  broadcastIncomingCall: (targetUserId: string, call: IncomingCall) => Promise<void>;
  broadcastCallRejected: (targetUserId: string, callId: string) => Promise<void>;
  onCallRejected:        (callId: string, cb: () => void) => () => void;
}

const AgoraCallContext = createContext<AgoraCallContextType | undefined>(undefined);

const NOOP_CTX: AgoraCallContextType = {
  broadcastIncomingCall: async () => {},
  broadcastCallRejected: async () => {},
  onCallRejected: () => () => {},
};

export function useAgoraCallSignaling(): AgoraCallContextType {
  const ctx = useContext(AgoraCallContext);
  return ctx ?? NOOP_CTX;
}

export function AgoraCallProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const router = useRouter();

  const supabaseRef = useRef<ReturnType<typeof getSupabaseClient> | null>(null);
  if (!supabaseRef.current) {
    try { supabaseRef.current = getSupabaseClient(); } catch { /* backend unavailable */ }
  }

  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const rejectListenersRef = useRef<Map<string, () => void>>(new Map());

  // ── Listen on my own personal call channel ─────────────────────────────────
  useEffect(() => {
    const supabase = supabaseRef.current;
    if (!user?.id || !supabase) return;

    const channel = supabase.channel(`agora-calls:${user.id}`, {
      config: { broadcast: { self: false } },
    });

    channel.on('broadcast', { event: 'incoming_call' }, ({ payload }: any) => {
      setIncomingCall(payload as IncomingCall);
    });
    channel.on('broadcast', { event: 'call_rejected' }, ({ payload }: any) => {
      const cb = rejectListenersRef.current.get(payload?.callId);
      if (cb) cb();
    });
    channel.subscribe();

    return () => { channel.unsubscribe(); };
  }, [user?.id]);

  // ── Send helpers (ephemeral one-shot channels) ──────────────────────────────
  const sendBroadcast = useCallback(async (
    targetUserId: string, event: string, payload: Record<string, unknown>,
  ) => {
    const supabase = supabaseRef.current;
    if (!supabase) return;
    const channel = supabase.channel(`agora-calls:${targetUserId}`);
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      channel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          channel.send({ type: 'broadcast', event, payload })
            .finally(() => { setTimeout(() => channel.unsubscribe(), 500); finish(); });
        }
      });
      setTimeout(finish, 2500);
    });
  }, []);

  const broadcastIncomingCall = useCallback(
    (targetUserId: string, call: IncomingCall) => sendBroadcast(targetUserId, 'incoming_call', call as any),
    [sendBroadcast],
  );
  const broadcastCallRejected = useCallback(
    (targetUserId: string, callId: string) => sendBroadcast(targetUserId, 'call_rejected', { callId }),
    [sendBroadcast],
  );
  const onCallRejected = useCallback((callId: string, cb: () => void) => {
    rejectListenersRef.current.set(callId, cb);
    return () => { rejectListenersRef.current.delete(callId); };
  }, []);

  // ── Accept / reject the incoming-call modal ─────────────────────────────────
  const handleAccept = useCallback(() => {
    if (!incomingCall) return;
    const call = incomingCall;
    setIncomingCall(null);
    const qs = new URLSearchParams({
      mode:         'answer',
      channel:      call.channelName,
      callId:       call.callId,
      callerName:   call.callerName,
      callerAvatar: call.callerAvatar || '',
    }).toString();
    router.push(`/video-call/${call.callerId}?${qs}` as any);
  }, [incomingCall, router]);

  const handleReject = useCallback(() => {
    if (!incomingCall) return;
    const call = incomingCall;
    setIncomingCall(null);
    broadcastCallRejected(call.callerId, call.callId);
  }, [incomingCall, broadcastCallRejected]);

  return (
    <AgoraCallContext.Provider value={{ broadcastIncomingCall, broadcastCallRejected, onCallRejected }}>
      {children}
      <Modal visible={!!incomingCall} transparent animationType="fade" statusBarTranslucent>
        {incomingCall ? (
          <View style={styles.overlay}>
            <LinearGradient colors={['#18181F', '#0A0A0F']} style={styles.card}>
              <View style={styles.avatarRing}>
                <Text style={styles.avatarInitial}>
                  {(incomingCall.callerName || 'U').charAt(0).toUpperCase()}
                </Text>
              </View>
              <Text style={styles.callerName}>@{incomingCall.callerName}</Text>
              <Text style={styles.subtitle}>Videollamada entrante...</Text>
              <View style={styles.actionsRow}>
                <View style={styles.actionCol}>
                  <Pressable style={[styles.actionBtn, styles.rejectBtn]} onPress={handleReject}>
                    <MaterialIcons name="call-end" size={26} color="#fff" />
                  </Pressable>
                  <Text style={styles.actionLabel}>Rechazar</Text>
                </View>
                <View style={styles.actionCol}>
                  <Pressable style={[styles.actionBtn, styles.acceptBtn]} onPress={handleAccept}>
                    <MaterialIcons name="videocam" size={26} color="#fff" />
                  </Pressable>
                  <Text style={styles.actionLabel}>Aceptar</Text>
                </View>
              </View>
            </LinearGradient>
          </View>
        ) : null}
      </Modal>
    </AgoraCallContext.Provider>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center', justifyContent: 'center', padding: Spacing.xl,
  },
  card: {
    width: '100%', maxWidth: 340, borderRadius: Radius.xl, padding: Spacing.xl,
    alignItems: 'center', gap: Spacing.md, borderWidth: 1, borderColor: Colors.border,
  },
  avatarRing: {
    width: 84, height: 84, borderRadius: 42, borderWidth: 2, borderColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceElevated,
  },
  avatarInitial: { color: Colors.primary, fontSize: 32, fontWeight: FontWeight.bold },
  callerName:    { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  subtitle:      { color: Colors.textSecondary, fontSize: FontSize.sm },
  actionsRow:    { flexDirection: 'row', gap: Spacing.xxl, marginTop: Spacing.md },
  actionCol:     { alignItems: 'center', gap: Spacing.xs },
  actionBtn:     { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  rejectBtn:     { backgroundColor: Colors.secondary },
  acceptBtn:     { backgroundColor: Colors.accent },
  actionLabel:   { color: Colors.textSubtle, fontSize: FontSize.xs },
});
