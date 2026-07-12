/**
 * app/call/[userId].tsx — 1:1 Agora AUDIO call screen
 *
 * Same signaling/media architecture as app/video-call/[userId].tsx (real
 * `calls` table row + Realtime + push via send-notification + Agora
 * 'communication' channel profile) — this file was previously a fully fake
 * simulation (Vibration.vibrate() + a setTimeout that "connected" after 3s,
 * no broadcastIncomingCall, no calls row, no Agora join at all), so the
 * callee never received anything: no push, no realtime signal, no media.
 *
 * Two entry modes, driven by query params:
 *  - Caller:  no `mode` param. Generates the same deterministic channel name
 *             convention as video-call, broadcasts an "incoming_call" signal
 *             (callType: 'audio') to the partner, and joins the Agora
 *             channel immediately.
 *  - Callee:  mode=answer, with channel/callId/callerName/callerAvatar
 *             params supplied by the global incoming-call modal
 *             (AgoraCallContext routes here for callType === 'audio').
 *
 * Audio-only: useAgoraEngine is called with enableVideo: false, so the
 * camera is never touched (no permission prompt, no capture pipeline) and
 * no RtcSurfaceView is rendered. The "Activar cámara" control lets either
 * side upgrade to video mid-call by re-enabling the local video pipeline —
 * at that point local/remote RtcSurfaceView are shown, same as the video
 * call screen.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Colors, FontSize, FontWeight, Spacing } from '@/constants/theme';
import { CallControlBar } from '@/components/feature/CallControlBar';
import { getSupabaseClient } from '@/template';
import { useAuth } from '@/hooks/useAuth';
import { useAgoraEngine } from '@/hooks/useAgoraEngine';
import { useAgoraCallSignaling } from '@/contexts/AgoraCallContext';
import { RtcSurfaceView, useridToAgoraUid, generateUUID, isAgoraAvailable } from '@/services/agoraService';
import { cancelCall, endCall } from '@/services/callSessionService';
import { startOutgoingRingback, stopAllCallSounds, stopOutgoingRingback } from '@/services/callRingtoneService';

const RING_TIMEOUT_MS = 30_000;
const TIMEOUT_GRACE_MS = 500;

type CallPhase = 'starting' | 'ringing' | 'connecting' | 'active' | 'rejected' | 'ended' | 'failed';

export default function AudioCallScreen() {
  const {
    userId: partnerId, mode, channel,
    callId: paramCallId, callerName: paramCallerName, callerAvatar: paramCallerAvatar,
  } = useLocalSearchParams<{
    userId: string; mode?: string; channel?: string;
    callId?: string; callerName?: string; callerAvatar?: string;
  }>();

  const insets   = useSafeAreaInsets();
  const router   = useRouter();
  const { user } = useAuth();
  const supabase = getSupabaseClient();
  const { broadcastIncomingCall, onCallRejected, onCallAccepted, markCallMissed } = useAgoraCallSignaling();

  const isCallee = mode === 'answer';

  const [partnerName,   setPartnerName]   = useState(isCallee ? (paramCallerName || 'Usuario') : 'Usuario');
  const [partnerAvatar, setPartnerAvatar] = useState(isCallee ? (paramCallerAvatar || '') : '');
  const [phase, setPhase]                 = useState<CallPhase>(isCallee ? 'connecting' : 'starting');
  const [duration, setDuration]           = useState(0);
  const [channelName, setChannelName]     = useState<string | null>(isCallee ? (channel ?? null) : null);
  const [callRecordId, setCallRecordId]   = useState<string>(paramCallId ?? '');

  const callIdRef      = useRef<string>(paramCallId ?? '');
  const timerRef        = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringTimeoutRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef      = useRef(true);
  const endedRef        = useRef(false);
  const startInProgressRef = useRef(false);
  const idempotencyKeyRef = useRef<string>(paramCallId || generateUUID());

  const myUid = user?.id ? useridToAgoraUid(user.id) : 0;

  const {
    engineReady, remoteUids, isMuted, isCameraOff, localVideoReady, error, speakerOn,
    join, leave, toggleMute, toggleSpeaker,
  } = useAgoraEngine({ channelName, uid: myUid, role: 'publisher', profile: 'communication', enableVideo: false });

  // Once either side has enabled the camera, treat this as an upgraded video call.
  const videoActive = !isCameraOff;

  // ── Mount / unmount ──────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopAllCallSounds().catch(() => {});
    };
  }, []);

  // ── No session, bail ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.id || !partnerId) router.back();
  }, [user?.id, partnerId]);

  // ── Caller setup: generate channel, ring partner ────────────────────────
  useEffect(() => {
    if (isCallee || !user?.id || !partnerId) return;
    if (startInProgressRef.current || callIdRef.current) return;

    let cancelled = false;
    const idempotencyKey = idempotencyKeyRef.current;
    startInProgressRef.current = true;
    setPhase('starting');

    supabase.from('user_profiles').select('username, avatar_url').eq('id', partnerId).single()
      .then(({ data }) => {
        if (data && mountedRef.current) {
          setPartnerName(data.username || 'Usuario');
          setPartnerAvatar(data.avatar_url || '');
        }
      });

    (async () => {
      const started = await broadcastIncomingCall(partnerId, {
        callId:       idempotencyKey,
        callerId:     user.id,
        callerName:   user.username || user.email?.split('@')[0] || 'Usuario',
        callerAvatar: user.avatar || '',
        channelName:  '',
        callType:     'audio',
      });
      startInProgressRef.current = false;
      if (cancelled || !mountedRef.current) return;
      if (!started) {
        setPhase('failed');
        return;
      }
      console.log('[AGORA-CALL] backend channelName length', {
        channelName: started.channelName,
        length: started.channelName.length,
      });
      callIdRef.current = started.callId;
      setCallRecordId(started.callId);
      setChannelName(started.channelName);
      setPhase('ringing');

      const timeoutMs = Math.max(0, new Date(started.expiresAt ?? '').getTime() - Date.now() + TIMEOUT_GRACE_MS);
      ringTimeoutRef.current = setTimeout(() => {
        markCallMissed(started.callId).catch(() => {});
        if (!mountedRef.current) return;
        setPhase(prev => (prev === 'ringing' ? 'ended' : prev));
      }, Number.isFinite(timeoutMs) ? timeoutMs : RING_TIMEOUT_MS);
    })();

    return () => {
      cancelled = true;
      startInProgressRef.current = false;
      if (ringTimeoutRef.current) clearTimeout(ringTimeoutRef.current);
    };
  }, [isCallee, user?.id, partnerId]);

  // ── Join Agora as soon as the channel name is known ─────────────────────
  useEffect(() => {
    if (channelName && engineReady) {
      stopAllCallSounds().finally(() => { join(); });
    }
  }, [channelName, engineReady]);

  useEffect(() => {
    if (isCallee || phase !== 'ringing' || !callRecordId) {
      stopOutgoingRingback(callRecordId || undefined).catch(() => {});
      return;
    }

    const startRingback = () => {
      startOutgoingRingback(callRecordId).catch(() => {});
    };
    const stopRingback = () => {
      stopOutgoingRingback(callRecordId).catch(() => {});
    };

    if (AppState.currentState === 'active') {
      startRingback();
    }

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        startRingback();
      } else {
        stopRingback();
      }
    });

    return () => {
      subscription.remove();
      stopRingback();
    };
  }, [isCallee, phase, callRecordId, engineReady]);

  // ── Listen for rejection (caller only) ───────────────────────────────────
  useEffect(() => {
    if (isCallee || !callIdRef.current) return;
    const unsub = onCallRejected(callIdRef.current, () => {
      if (mountedRef.current) setPhase('rejected');
    });
    return unsub;
  }, [isCallee, channelName]);

  // ── Any participant ended the call ───────────────────────────────────────
  useEffect(() => {
    if (!callRecordId) return;
    const channel = supabase.channel(`calls:status:${callRecordId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'calls', filter: `id=eq.${callRecordId}`,
      }, (payload: any) => {
        const row = payload.new as { status?: string };
        if (row.status === 'ended' && mountedRef.current) setPhase('ended');
      })
      .subscribe();

    return () => { channel.unsubscribe(); };
  }, [callRecordId, supabase]);

  // ── Listen for acceptance (caller only) ──────────────────────────────────
  useEffect(() => {
    if (isCallee || !callIdRef.current) return;
    const unsub = onCallAccepted(callIdRef.current, () => {
      if (mountedRef.current) setPhase(prev => (prev === 'ringing' ? 'connecting' : prev));
    });
    return unsub;
  }, [isCallee, channelName]);

  // ── Remote joined → active ───────────────────────────────────────────────
  useEffect(() => {
    if (remoteUids.length > 0) {
      stopAllCallSounds().catch(() => {});
      setPhase(prev => (prev === 'active' ? prev : 'active'));
      if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null; }
    }
  }, [remoteUids.length]);

  // ── Engine error → failed ────────────────────────────────────────────────
  useEffect(() => {
    if (error) setPhase(prev => (prev === 'active' ? prev : 'failed'));
  }, [error]);

  // ── Duration timer ───────────────────────────────────────────────────────
  useEffect(() => {
    if (phase === 'active') {
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    }
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [phase]);

  // ── Terminal phases → cleanup + navigate back ────────────────────────────
  useEffect(() => {
    if ((phase === 'ended' || phase === 'rejected' || phase === 'failed') && !endedRef.current) {
      endedRef.current = true;
      stopAllCallSounds().catch(() => {});
      leave();
      const t = setTimeout(() => { if (mountedRef.current) router.back(); }, 900);
      return () => clearTimeout(t);
    }
  }, [phase]);

  const handleEndCall = useCallback(async () => {
    await stopAllCallSounds();
    if (callRecordId) {
      if (phase === 'ringing' || phase === 'starting') {
        await cancelCall(callRecordId).catch(() => {});
      } else {
        await endCall(callRecordId, 'user_ended').catch(() => {});
      }
    }
    setPhase('ended');
  }, [callRecordId, phase]);

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  const statusText =
    phase === 'starting'   ? 'Iniciando...' :
    phase === 'ringing'    ? '🔔 Llamando...' :
    phase === 'connecting' ? 'Llamando...' :
    phase === 'active'     ? fmt(duration) :
    phase === 'rejected'   ? 'Llamada rechazada' :
    phase === 'failed'     ? 'Error de conexión' :
                              'Llamada finalizada';

  const remoteVideoActive = phase === 'active' && remoteUids.length > 0 && videoActive;

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {remoteVideoActive && RtcSurfaceView ? (
        <RtcSurfaceView canvas={{ uid: remoteUids[0] }} style={styles.remoteStream} />
      ) : (
        <View style={[styles.topArea, { paddingTop: insets.top + Spacing.xxl }]}>
          <View style={styles.avatarRing}>
            {partnerAvatar ? (
              <Image source={{ uri: partnerAvatar }} style={styles.avatarImg} contentFit="cover" />
            ) : (
              <View style={styles.avatarCircle}>
                <Text style={styles.avatarInitial}>{partnerName.charAt(0).toUpperCase()}</Text>
              </View>
            )}
          </View>
          <Text style={styles.partnerName}>@{partnerName}</Text>
          <Text style={styles.callStatus}>{statusText}</Text>
          {!isAgoraAvailable() ? (
            <Text style={styles.errorText}>Las llamadas no están disponibles en este dispositivo</Text>
          ) : error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : null}
        </View>
      )}

      {phase === 'active' && videoActive && localVideoReady && RtcSurfaceView ? (
        <View style={styles.localPreview}>
          <RtcSurfaceView canvas={{ uid: 0 }} style={{ flex: 1 }} zOrderMediaOverlay />
          <Text style={styles.localPreviewLabel}>Tú</Text>
        </View>
      ) : null}

      <View style={[styles.controls, { paddingBottom: insets.bottom + Spacing.xl }]}>
        <CallControlBar
          isMuted={isMuted}
          onToggleMute={toggleMute}
          speakerOn={speakerOn}
          onToggleSpeaker={toggleSpeaker}
          onHangup={handleEndCall}
          showCamera={false}
          showSwitchCamera={false}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container:            { flex: 1, backgroundColor: '#080814' },
  remoteStream:         { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  topArea:              { flex: 1, alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.xl },
  avatarRing:           { width: 130, height: 130, borderRadius: 65, borderWidth: 2, borderColor: Colors.primary + '55', alignItems: 'center', justifyContent: 'center', marginTop: Spacing.xxl },
  avatarImg:            { width: 110, height: 110, borderRadius: 55 },
  avatarCircle:         { width: 110, height: 110, borderRadius: 55, backgroundColor: Colors.primaryDim, alignItems: 'center', justifyContent: 'center' },
  avatarInitial:        { color: Colors.primary, fontSize: 44, fontWeight: FontWeight.bold },
  partnerName:          { color: Colors.textPrimary, fontSize: FontSize.xxl, fontWeight: FontWeight.bold },
  callStatus:           { color: Colors.textSecondary, fontSize: FontSize.lg },
  errorText:            { color: Colors.secondary, fontSize: FontSize.xs, textAlign: 'center', paddingHorizontal: Spacing.lg },
  localPreview:         { position: 'absolute', top: 180, right: Spacing.lg, width: 90, height: 120, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border, zIndex: 10 },
  localPreviewLabel:    { position: 'absolute', bottom: 4, left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: 10, backgroundColor: 'rgba(0,0,0,0.5)' },
  controls:             { paddingHorizontal: Spacing.md },
});
