/**
 * app/videocall/[userId].tsx — v2 Production video call screen
 *
 * Integrates CallManager v2:
 *   - Real WebRTC via RTCManager + SignalingManager
 *   - Mute, camera toggle, speaker, camera flip
 *   - Reconnect banner + quality indicator
 *   - Thermal warning → auto camera-off
 *   - RTCView for remote + local PiP streams
 *   - Full cleanup on unmount via CallManager.endCall
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, Pressable, StyleSheet, Animated,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { getSupabaseClient } from '@/template';
import { useAuth } from '@/hooks/useAuth';

import { CallManager }    from '@/modules/calls/CallManager';
import { ThermalMonitor } from '@/modules/core/ThermalMonitor';
import { EventBus }       from '@/modules/core/EventBus';
import type { RTCQualityLevel, RTCPeerStats } from '@/modules/realtime/RTCManager';

let RTCView: any = null;
try { RTCView = require('react-native-webrtc').RTCView; } catch { /* expo go / web */ }

const QUALITY_COLORS: Record<RTCQualityLevel, string> = {
  excellent: '#00D4AA',
  good:      '#7C5CFF',
  fair:      '#FFB800',
  poor:      '#FF8C00',
  critical:  '#FF2D78',
};

export default function VideoCallScreen() {
  const { userId: partnerId } = useLocalSearchParams<{ userId: string }>();
  const insets   = useSafeAreaInsets();
  const router   = useRouter();
  const { user } = useAuth();
  const supabase = getSupabaseClient();

  const [partnerName,  setPartnerName]  = useState('Usuario');
  const [thermalWarn,  setThermalWarn]  = useState(false);
  const [duration,     setDuration]     = useState(0);
  const [callStatus,   setCallStatus]   = useState(CallManager.currentCall?.status ?? 'new' as any);
  const [isMuted,      setIsMuted]      = useState(false);
  const [isCameraOff,  setIsCameraOff]  = useState(false);
  const [isSpeaker,    setIsSpeaker]    = useState(true);
  const [remoteStream, setRemoteStream] = useState<any>(null);
  const [localStream,  setLocalStream]  = useState<any>(null);
  const [quality,      setQuality]      = useState<RTCPeerStats | null>(null);

  const pulseAnim  = useRef(new Animated.Value(1)).current;
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // ── Mount ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.id || !partnerId) return;
    mountedRef.current = true;

    // Fetch partner name
    supabase.from('user_profiles').select('username').eq('id', partnerId).single()
      .then(({ data }) => { if (data && mountedRef.current) setPartnerName(data.username || 'Usuario'); })
      .catch(() => {});

    // Subscribe to call state changes
    const unsub = CallManager.onCallChange(call => {
      if (!mountedRef.current || !call) return;
      setCallStatus(call.status);
      setIsMuted(call.isMuted);
      setIsCameraOff(!call.isCameraOn);
      setIsSpeaker(call.isSpeaker);
      if (call.remoteStream) setRemoteStream(call.remoteStream);
      if (call.localStream)  setLocalStream(call.localStream);
      if (call.stats)        setQuality(call.stats);

      if (call.status === 'active' && !timerRef.current) {
        timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
      }
      if (call.status === 'ended' || call.status === 'failed' || call.status === 'rejected') {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        if (mountedRef.current) setTimeout(() => router.back(), 800);
      }
    });

    // Check thermal
    const thermal = ThermalMonitor.currentState;
    if (thermal === 'serious' || thermal === 'critical') {
      setThermalWarn(true);
      setIsCameraOff(true);
    }

    // Thermal event
    const thermalUnsub = EventBus.on('thermal:state_changed', (evt: any) => {
      const state = evt?.state ?? ThermalMonitor.currentState;
      if (!mountedRef.current) return;
      if (state === 'serious' || state === 'critical') {
        setThermalWarn(true);
        setIsCameraOff(true);
      } else {
        setThermalWarn(false);
      }
    });

    // Initiate outgoing call
    CallManager.startCall(user.id, partnerId, 'video').then(result => {
      if (!mountedRef.current) return;
      if ('error' in result) {
        console.warn('[VideoCall] startCall failed:', result.error);
        router.back();
      }
    });

    // Pulse animation
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,    duration: 700, useNativeDriver: true }),
      ]),
    );
    pulse.start();

    return () => {
      mountedRef.current = false;
      pulse.stop();
      unsub();
      thermalUnsub();
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      // Guaranteed cleanup
      CallManager.endCall(user.id).catch(() => {});
    };
  }, [user?.id, partnerId]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleToggleMute    = useCallback(() => { const next = CallManager.toggleMute();    setIsMuted(!next);    }, []);
  const handleToggleCamera  = useCallback(() => { const next = CallManager.toggleCamera();  setIsCameraOff(!next);}, []);
  const handleToggleSpeaker = useCallback(() => { const next = CallManager.toggleSpeaker(); setIsSpeaker(next);   }, []);
  const handleFlipCamera    = useCallback(() => { CallManager.switchCamera(); }, []);

  const handleEndCall = useCallback(async () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    await CallManager.endCall(user?.id ?? '');
    router.back();
  }, [user?.id, router]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  const isConnecting   = callStatus === 'new' || callStatus === 'connecting' || callStatus === 'ringing_out';
  const isReconnecting = callStatus === 'reconnecting';
  const isConnected    = callStatus === 'active';

  const statusText = isConnecting    ? 'Conectando...'
                   : isReconnecting  ? 'Reconectando...'
                   : isConnected     ? fmt(duration)
                   : callStatus === 'failed' ? 'Error de conexión'
                   : 'Llamada terminada';

  const qualityColor = quality ? QUALITY_COLORS[quality.qualityLevel] : Colors.accent;

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Remote stream */}
      {RTCView && remoteStream ? (
        <RTCView
          streamURL={remoteStream.toURL?.() ?? ''}
          style={styles.remoteStream}
          objectFit="cover"
          mirror={false}
        />
      ) : null}

      {/* Thermal warning */}
      {thermalWarn ? (
        <View style={[styles.thermalBanner, { top: insets.top + 4 }]}>
          <MaterialIcons name="thermostat" size={14} color="#FF8C00" />
          <Text style={styles.thermalText}>Temperatura alta — video reducido</Text>
        </View>
      ) : null}

      {/* Reconnecting banner */}
      {isReconnecting ? (
        <View style={[styles.reconnectBanner, { top: insets.top + (thermalWarn ? 36 : 4) }]}>
          <MaterialIcons name="wifi-off" size={14} color={Colors.warning} />
          <Text style={styles.reconnectText}>Reconectando automáticamente...</Text>
        </View>
      ) : null}

      {/* Partner info (when no remote stream) */}
      {!remoteStream ? (
        <View style={[styles.topArea, { paddingTop: insets.top + Spacing.xl + (thermalWarn ? 36 : 0) }]}>
          <Animated.View style={[
            styles.avatarRing,
            { transform: [{ scale: isConnecting ? pulseAnim : 1 }] },
            isConnected && { borderColor: qualityColor + '88' },
          ]}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarInitial}>{partnerName.charAt(0).toUpperCase()}</Text>
            </View>
          </Animated.View>
          <Text style={styles.partnerName}>@{partnerName}</Text>
          <Text style={[
            styles.callStatus,
            isReconnecting && { color: Colors.warning },
            callStatus === 'failed' && { color: Colors.secondary },
          ]}>
            {statusText}
          </Text>
          {isConnected && quality ? (
            <View style={styles.qualityRow}>
              <View style={[styles.qualityDot, { backgroundColor: qualityColor }]} />
              <Text style={[styles.qualityText, { color: qualityColor }]}>
                {quality.qualityLevel.toUpperCase()} · {Math.round(quality.bitrateKbps)}kbps
              </Text>
              <Text style={styles.qualityRtt}>{Math.round(quality.rttMs)}ms</Text>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={[styles.streamStatusOverlay, { top: insets.top + 8 }]}>
          <Text style={styles.streamPartnerName}>@{partnerName}</Text>
          <Text style={styles.streamDuration}>{statusText}</Text>
          {quality ? (
            <View style={[styles.qualityDot, { backgroundColor: qualityColor, marginTop: 4 }]} />
          ) : null}
        </View>
      )}

      {/* Local PiP */}
      {isConnected && !isCameraOff ? (
        <View style={styles.localPreview}>
          {RTCView && localStream ? (
            <RTCView
              streamURL={localStream.toURL?.() ?? ''}
              style={{ flex: 1 }}
              objectFit="cover"
              mirror={true}
            />
          ) : (
            <View style={styles.localPreviewFallback}>
              <MaterialIcons name="person" size={28} color={Colors.textSubtle} />
            </View>
          )}
          <Text style={styles.localPreviewLabel}>Tú</Text>
        </View>
      ) : null}

      {/* Controls */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + Spacing.xl }]}>
        <View style={styles.controlRow}>
          <Pressable style={[styles.controlBtn, isMuted && styles.controlBtnActive]}
            onPress={handleToggleMute} hitSlop={8}>
            <MaterialIcons name={isMuted ? 'mic-off' : 'mic'} size={24} color={isMuted ? '#000' : '#fff'} />
            <Text style={[styles.controlLabel, isMuted && { color: '#000' }]}>
              {isMuted ? 'Activar' : 'Silenciar'}
            </Text>
          </Pressable>

          <Pressable style={styles.endCallBtn} onPress={handleEndCall} hitSlop={4}>
            <MaterialIcons name="call-end" size={30} color="#fff" />
          </Pressable>

          <Pressable style={[styles.controlBtn, isCameraOff && styles.controlBtnActive]}
            onPress={handleToggleCamera} hitSlop={8}>
            <MaterialIcons name={isCameraOff ? 'videocam-off' : 'videocam'} size={24}
              color={isCameraOff ? '#000' : '#fff'} />
            <Text style={[styles.controlLabel, isCameraOff && { color: '#000' }]}>
              {isCameraOff ? 'Activar' : 'Cámara'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.controlRow2}>
          <Pressable style={styles.controlBtnSm} onPress={handleFlipCamera} hitSlop={8}>
            <MaterialIcons name="flip-camera-ios" size={20} color={Colors.textSecondary} />
            <Text style={styles.controlLabelSm}>Voltear</Text>
          </Pressable>

          <Pressable style={styles.controlBtnSm} onPress={handleToggleSpeaker} hitSlop={8}>
            <MaterialIcons name={isSpeaker ? 'volume-up' : 'hearing'} size={20}
              color={isSpeaker ? Colors.primary : Colors.textSecondary} />
            <Text style={[styles.controlLabelSm, isSpeaker && { color: Colors.primary }]}>
              {isSpeaker ? 'Altavoz' : 'Auricular'}
            </Text>
          </Pressable>

          {quality?.packetLossPct !== undefined && quality.packetLossPct > 5 ? (
            <View style={styles.lossWarning}>
              <MaterialIcons name="warning" size={14} color={Colors.warning} />
              <Text style={styles.lossText}>{quality.packetLossPct.toFixed(1)}% pérdida</Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container:            { flex: 1, backgroundColor: '#0A0A14' },
  remoteStream:         { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  streamStatusOverlay:  { position: 'absolute', left: Spacing.md, alignItems: 'flex-start', zIndex: 10 },
  streamPartnerName:    { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold, textShadowColor: '#000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  streamDuration:       { color: 'rgba(255,255,255,0.8)', fontSize: FontSize.sm },
  thermalBanner:        { position: 'absolute', left: Spacing.md, right: Spacing.md, zIndex: 20, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,140,0,0.15)', borderRadius: Radius.sm, padding: Spacing.xs, borderWidth: 1, borderColor: 'rgba(255,140,0,0.4)' },
  thermalText:          { color: '#FF8C00', fontSize: 11, flex: 1 },
  reconnectBanner:      { position: 'absolute', left: Spacing.md, right: Spacing.md, zIndex: 20, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,184,0,0.15)', borderRadius: Radius.sm, padding: Spacing.xs, borderWidth: 1, borderColor: 'rgba(255,184,0,0.4)' },
  reconnectText:        { color: Colors.warning, fontSize: 11, flex: 1 },
  topArea:              { alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.xl },
  avatarRing:           { width: 130, height: 130, borderRadius: 65, borderWidth: 2, borderColor: Colors.primary + '55', alignItems: 'center', justifyContent: 'center' },
  avatarCircle:         { width: 110, height: 110, borderRadius: 55, backgroundColor: Colors.surfaceElevated, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Colors.primary },
  avatarInitial:        { color: Colors.primary, fontSize: 44, fontWeight: FontWeight.bold },
  partnerName:          { color: Colors.textPrimary, fontSize: FontSize.xxl, fontWeight: FontWeight.bold },
  callStatus:           { color: Colors.textSecondary, fontSize: FontSize.lg },
  qualityRow:           { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: Radius.sm, paddingHorizontal: 10, paddingVertical: 4 },
  qualityDot:           { width: 7, height: 7, borderRadius: 4 },
  qualityText:          { fontSize: FontSize.xs, fontWeight: FontWeight.medium },
  qualityRtt:           { color: Colors.textSubtle, fontSize: FontSize.xs },
  localPreview:         { position: 'absolute', top: 180, right: Spacing.lg, width: 90, height: 120, borderRadius: Radius.md, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border, zIndex: 10 },
  localPreviewFallback: { flex: 1, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
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
  lossWarning:          { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,184,0,0.15)', borderRadius: Radius.sm, paddingHorizontal: 8, paddingVertical: 4 },
  lossText:             { color: Colors.warning, fontSize: 11 },
});
