/**
 * app/video-call/[userId].tsx — 1:1 Agora video call screen
 *
 * Two entry modes, driven by query params:
 *  - Caller:  no `mode` param. Generates a deterministic channel name from
 *             the two user ids, broadcasts an "incoming_call" signal to the
 *             partner (via AgoraCallContext), and joins the Agora channel
 *             immediately so media is already flowing the instant the
 *             callee accepts. Shows a "Llamando..." ringing UI.
 *  - Callee:  mode=answer, with channel/callId/callerName/callerAvatar
 *             params supplied by the global incoming-call modal (accepted
 *             there). Joins the given channel directly.
 *
 * "Connected" is detected implicitly: once the other party's uid appears in
 * remoteUids, the call is live — no separate accept ack needed over Agora.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { getSupabaseClient } from '@/template';
import { useAuth } from '@/hooks/useAuth';
import { useAgoraEngine } from '@/hooks/useAgoraEngine';
import { useAgoraCallSignaling } from '@/contexts/AgoraCallContext';
import { RtcSurfaceView, useridToAgoraUid, generateUUID, isAgoraAvailable } from '@/services/agoraService';

const RING_TIMEOUT_MS = 30_000;

type CallPhase = 'starting' | 'ringing' | 'connecting' | 'active' | 'rejected' | 'ended' | 'failed';

export default function VideoCallScreen() {
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

  const callIdRef      = useRef<string>(paramCallId ?? '');
  const timerRef        = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringTimeoutRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef      = useRef(true);
  const endedRef        = useRef(false);

  const myUid = user?.id ? useridToAgoraUid(user.id) : 0;

  const {
    engineReady, remoteUids, isMuted, isCameraOff, localVideoReady, error,
    join, leave, toggleMute, toggleCamera, switchCamera,
  } = useAgoraEngine({ channelName, uid: myUid, role: 'publisher', profile: 'communication' });

  // ── Mount / unmount ──────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── No session, bail ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.id || !partnerId) router.back();
  }, [user?.id, partnerId]);

  // ── Caller setup: generate channel, ring partner ────────────────────────
  useEffect(() => {
    if (isCallee || !user?.id || !partnerId) return;

    const newChannel = `1v1_${[user.id, partnerId].sort().join('_')}`;
    const newCallId  = generateUUID();
    callIdRef.current = newCallId;
    setChannelName(newChannel);
    setPhase('ringing');

    supabase.from('user_profiles').select('username, avatar_url').eq('id', partnerId).single()
      .then(({ data }) => {
        if (data && mountedRef.current) {
          setPartnerName(data.username || 'Usuario');
          setPartnerAvatar(data.avatar_url || '');
        }
      });

    broadcastIncomingCall(partnerId, {
      callId:       newCallId,
      callerId:     user.id,
      callerName:   user.username || user.email?.split('@')[0] || 'Usuario',
      callerAvatar: user.avatar || '',
      channelName:  newChannel,
      callType:     'video',
    });

    ringTimeoutRef.current = setTimeout(() => {
      markCallMissed(newCallId);
      if (!mountedRef.current) return;
      setPhase(prev => (prev === 'ringing' ? 'ended' : prev));
    }, RING_TIMEOUT_MS);

    return () => { if (ringTimeoutRef.current) clearTimeout(ringTimeoutRef.current); };
  }, [isCallee, user?.id, partnerId]);

  // ── Join Agora as soon as the channel name is known ─────────────────────
  useEffect(() => {
    if (channelName && engineReady) join();
  }, [channelName, engineReady]);

  // ── Listen for rejection (caller only) ───────────────────────────────────
  useEffect(() => {
    if (isCallee || !callIdRef.current) return;
    const unsub = onCallRejected(callIdRef.current, () => {
      if (mountedRef.current) setPhase('rejected');
    });
    return unsub;
  }, [isCallee, channelName]);

  // ── Listen for acceptance (caller only) ──────────────────────────────────
  // Agora itself has no "the callee tapped accept" event — the `calls` row
  // flipping to 'accepted' (written by acceptIncomingCall before it
  // navigates) is that signal. This just gives the caller earlier visual
  // feedback ("Conectando..." instead of "Llamando...") between the callee
  // accepting and the media actually connecting (remoteUids populating,
  // which already independently drives phase → 'active').
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
      leave();
      const t = setTimeout(() => { if (mountedRef.current) router.back(); }, 900);
      return () => clearTimeout(t);
    }
  }, [phase]);

  const handleEndCall = useCallback(() => setPhase('ended'), []);

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  const statusText =
    phase === 'starting'   ? 'Iniciando...' :
    phase === 'ringing'    ? '🔔 Llamando...' :
    phase === 'connecting' ? 'Conectando...' :
    phase === 'active'     ? fmt(duration) :
    phase === 'rejected'   ? 'Llamada rechazada' :
    phase === 'failed'     ? 'Error de conexión' :
                              'Llamada finalizada';

  const remoteConnected = phase === 'active' && remoteUids.length > 0;

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {remoteConnected && RtcSurfaceView ? (
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
            <Text style={styles.errorText}>Las videollamadas no están disponibles en este dispositivo</Text>
          ) : error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : null}
        </View>
      )}

      {phase === 'active' && localVideoReady && !isCameraOff && RtcSurfaceView ? (
        <View style={styles.localPreview}>
          <RtcSurfaceView canvas={{ uid: 0 }} style={{ flex: 1 }} zOrderMediaOverlay />
          <Text style={styles.localPreviewLabel}>Tú</Text>
        </View>
      ) : null}

      <View style={[styles.controls, { paddingBottom: insets.bottom + Spacing.xl }]}>
        <View style={styles.controlRow}>
          <Pressable style={[styles.controlBtn, isMuted && styles.controlBtnActive]} onPress={toggleMute} hitSlop={8}>
            <MaterialIcons name={isMuted ? 'mic-off' : 'mic'} size={24} color={isMuted ? '#000' : '#fff'} />
            <Text style={[styles.controlLabel, isMuted && { color: '#000' }]}>
              {isMuted ? 'Activar' : 'Silenciar'}
            </Text>
          </Pressable>

          <Pressable style={styles.endCallBtn} onPress={handleEndCall} hitSlop={4}>
            <MaterialIcons name="call-end" size={30} color="#fff" />
          </Pressable>

          <Pressable style={[styles.controlBtn, isCameraOff && styles.controlBtnActive]} onPress={toggleCamera} hitSlop={8}>
            <MaterialIcons name={isCameraOff ? 'videocam-off' : 'videocam'} size={24} color={isCameraOff ? '#000' : '#fff'} />
            <Text style={[styles.controlLabel, isCameraOff && { color: '#000' }]}>
              {isCameraOff ? 'Activar' : 'Cámara'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.controlRow2}>
          <Pressable style={styles.controlBtnSm} onPress={switchCamera} hitSlop={8}>
            <MaterialIcons name="flip-camera-ios" size={20} color={Colors.textSecondary} />
            <Text style={styles.controlLabelSm}>Voltear</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container:            { flex: 1, backgroundColor: '#0A0A14' },
  remoteStream:         { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  topArea:              { alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.xl },
  avatarRing:           { width: 130, height: 130, borderRadius: 65, borderWidth: 2, borderColor: Colors.primary + '55', alignItems: 'center', justifyContent: 'center' },
  avatarImg:            { width: 110, height: 110, borderRadius: 55 },
  avatarCircle:         { width: 110, height: 110, borderRadius: 55, backgroundColor: Colors.surfaceElevated, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Colors.primary },
  avatarInitial:        { color: Colors.primary, fontSize: 44, fontWeight: FontWeight.bold },
  partnerName:          { color: Colors.textPrimary, fontSize: FontSize.xxl, fontWeight: FontWeight.bold },
  callStatus:           { color: Colors.textSecondary, fontSize: FontSize.lg },
  errorText:            { color: Colors.secondary, fontSize: FontSize.xs, textAlign: 'center', paddingHorizontal: Spacing.lg },
  localPreview:         { position: 'absolute', top: 180, right: Spacing.lg, width: 90, height: 120, borderRadius: Radius.md, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border, zIndex: 10 },
  localPreviewLabel:    { position: 'absolute', bottom: 4, left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: 10, backgroundColor: 'rgba(0,0,0,0.5)' },
  controls:             { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', gap: Spacing.lg, paddingHorizontal: Spacing.xl },
  controlRow:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' },
  controlRow2:          { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: Spacing.xl },
  controlBtn:           { width: 70, height: 70, borderRadius: 35, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', gap: 4 },
  controlBtnActive:     { backgroundColor: Colors.textPrimary },
  controlLabel:         { color: Colors.textSecondary, fontSize: 11 },
  endCallBtn:           { width: 78, height: 78, borderRadius: 39, backgroundColor: Colors.secondary, alignItems: 'center', justifyContent: 'center' },
  controlBtnSm:         { alignItems: 'center', gap: 4, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md },
  controlLabelSm:       { color: Colors.textSubtle, fontSize: 11 },
});
