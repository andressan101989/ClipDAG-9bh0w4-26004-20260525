/**
 * app/videocall/[userId].tsx — Full production video call screen
 *
 * Real WebRTC integration:
 *   - RTCPeer: real offer/answer/ICE via SignalingManager + Supabase
 *   - RTCView for remote stream rendering (react-native-webrtc)
 *   - Camera switch via peer.switchCamera()
 *   - Mute/unmute: setTrackEnabled() local + sender
 *   - Speaker routing via InCallManager
 *   - Background: video muted, audio alive
 *   - Foreground: video restored
 *   - Thermal → adaptive bitrate + video disable warning
 *   - Stats → quality badge, RTT display, packet loss warning
 *   - SessionOrchestrator conflict resolution
 *   - ResourceManager camera/mic leasing
 *   - GPUManager render slot
 *   - CrashIntelligence breadcrumbs
 *   - SecurityManager gate
 *   - Full guaranteed cleanup on unmount
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, Pressable, StyleSheet, Animated, AppState,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { getSupabaseClient } from '@/template';
import { useAuth } from '@/hooks/useAuth';

// Infrastructure
import { RTCManager }                from '@/modules/realtime/RTCManager';
import { SessionOrchestrator }       from '@/modules/sessions/SessionOrchestrator';
import { ResourceManager }           from '@/modules/core/ResourceManager';
import { AdaptiveQualityController } from '@/modules/core/AdaptiveQualityController';
import { ThermalMonitor }            from '@/modules/core/ThermalMonitor';
import { GPUManager }                from '@/modules/core/GPUManager';
import { TelemetryPipeline }         from '@/modules/core/TelemetryPipeline';
import { CrashIntelligence }         from '@/modules/core/CrashIntelligence';
import { SecurityManager }           from '@/modules/core/SecurityManager';
import { EventBus }                  from '@/modules/core/EventBus';
import type { RTCConnectionState, RTCPeerStats, RTCQualityLevel } from '@/modules/realtime/RTCManager';

// Lazy RTCView (only available with native WebRTC build)
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

  // ── UI state ──────────────────────────────────────────────────────────────
  const [callState,     setCallState]     = useState<RTCConnectionState>('new');
  const [isMuted,       setIsMuted]       = useState(false);
  const [isCameraOff,   setIsCameraOff]   = useState(false);
  const [isFrontCamera, setIsFrontCamera] = useState(true);
  const [isSpeaker,     setIsSpeaker]     = useState(true);
  const [duration,      setDuration]      = useState(0);
  const [partnerName,   setPartnerName]   = useState('Usuario');
  const [quality,       setQuality]       = useState<RTCPeerStats | null>(null);
  const [thermalWarn,   setThermalWarn]   = useState(false);
  const [remoteStream,  setRemoteStream]  = useState<any>(null);
  const [localStream,   setLocalStream]   = useState<any>(null);

  const pulseAnim  = useRef(new Animated.Value(1)).current;
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionId  = useRef<string>(`call_${user?.id}_${partnerId}_${Date.now()}`);
  const gpuSlot    = useRef<string | null>(null);
  const peerRef    = useRef<Awaited<ReturnType<typeof RTCManager.createPeer>> | null>(null);

  // ── Mount ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.id || !partnerId) return;

    CrashIntelligence.addBreadcrumb('navigation', 'VideoCall mounted', { partnerId });

    const allowed = SecurityManager.checkAction('stream_join', user.id);
    if (!allowed) {
      CrashIntelligence.addBreadcrumb('error', 'VideoCall blocked by SecurityManager');
      router.back();
      return;
    }

    let mounted = true;

    const init = async () => {
      try {
        // 1. GPU slot
        gpuSlot.current = await GPUManager.acquireSlot('VideoCallScreen', 'high');

        // 2. Resource leases
        ResourceManager.request('camera',     'VideoCallScreen');
        ResourceManager.request('microphone', 'VideoCallScreen');

        // 3. SessionOrchestrator
        SessionOrchestrator.registerSession('call', sessionId.current, {
          onPause:   async () => { peerRef.current?.setTrackEnabled('video', false); },
          onResume:  async () => { peerRef.current?.setTrackEnabled('video', !isCameraOff); },
          onEnd:     async () => { await peerRef.current?.close(); },
          onRecover: async () => {
            await peerRef.current?.reconnect();
            return peerRef.current?.state !== 'failed';
          },
        });

        // 4. Fetch partner profile
        const { data } = await supabase
          .from('user_profiles')
          .select('username')
          .eq('id', partnerId)
          .single();
        if (data && mounted) setPartnerName(data.username || 'Usuario');

        // 5. Create RTC peer
        const peer = await RTCManager.createPeer(
          `call:${user.id}:${partnerId}`,
          user.id,
          partnerId,
          { maxReconnects: 5, iceTimeoutMs: 15_000, statsIntervalMs: 2_000 },
        );
        peerRef.current = peer;

        // 6. State changes → UI
        peer.onStateChange((s) => {
          if (!mounted) return;
          setCallState(s);
          CrashIntelligence.addBreadcrumb('state', `RTC: ${s}`, { partnerId });
          if (s === 'connected') {
            timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
            // Expose local stream for local preview
            if (peer.localStream) setLocalStream(peer.localStream);
          }
          if (s === 'closed' || s === 'failed') {
            if (timerRef.current) clearInterval(timerRef.current);
            if (mounted) setTimeout(() => router.back(), 800);
          }
        });

        // 7. Remote track → RTCView
        peer.onRemoteTrack((track, stream) => {
          if (!mounted) return;
          if (stream) setRemoteStream(stream);
        });

        // 8. Stats → quality badge
        peer.onStats((stats) => {
          if (!mounted) return;
          setQuality(stats);
        });

        // 9. Errors
        peer.onError((err) => {
          CrashIntelligence.addBreadcrumb('error', `RTC error: ${err}`, { partnerId });
        });

        // 10. Thermal check
        const thermal = ThermalMonitor.currentState;
        if (thermal === 'serious' || thermal === 'critical') {
          if (mounted) { setThermalWarn(true); setIsCameraOff(true); }
          peer.setTrackEnabled('video', false);
        }

        // 11. Start negotiation
        await peer.negotiate('offer');

      } catch (e: any) {
        CrashIntelligence.addBreadcrumb('error', `VideoCall init error: ${e?.message}`);
        if (mounted) router.back();
      }
    };

    init();

    // Pulse animation
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,    duration: 700, useNativeDriver: true }),
      ]),
    );
    pulse.start();

    // Thermal event listener
    const thermalUnsub = EventBus.on('thermal:state_changed', (evt: any) => {
      const state = evt?.state ?? ThermalMonitor.currentState;
      if (!mounted) return;
      if (state === 'serious' || state === 'critical') {
        setThermalWarn(true);
        peerRef.current?.setTrackEnabled('video', false);
        setIsCameraOff(true);
      } else if (state === 'nominal' || state === 'fair') {
        setThermalWarn(false);
        if (!isCameraOff) peerRef.current?.setTrackEnabled('video', true);
      }
    });

    return () => {
      mounted = false;
      pulse.stop();
      thermalUnsub();
      if (timerRef.current) clearInterval(timerRef.current);

      const cleanup = async () => {
        CrashIntelligence.addBreadcrumb('lifecycle', 'VideoCall cleanup');
        await peerRef.current?.close();
        peerRef.current = null;
        await SessionOrchestrator.endSession(sessionId.current);
        ResourceManager.release('camera',     'VideoCallScreen');
        ResourceManager.release('microphone', 'VideoCallScreen');
        if (gpuSlot.current) {
          GPUManager.releaseSlot(gpuSlot.current);
          gpuSlot.current = null;
        }
      };
      cleanup();
    };
  }, [user?.id, partnerId]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleToggleMute = useCallback(() => {
    const next = !isMuted;
    peerRef.current?.setTrackEnabled('audio', !next);
    setIsMuted(next);
  }, [isMuted]);

  const handleToggleCamera = useCallback(() => {
    const next = !isCameraOff;
    peerRef.current?.setTrackEnabled('video', !next);
    setIsCameraOff(next);
  }, [isCameraOff]);

  const handleToggleSpeaker = useCallback(() => {
    const next = !isSpeaker;
    peerRef.current?.setAudioSpeaker(next);
    setIsSpeaker(next);
  }, [isSpeaker]);

  const handleFlipCamera = useCallback(async () => {
    setIsFrontCamera(f => !f);
    await peerRef.current?.switchCamera();
  }, []);

  const handleEndCall = useCallback(async () => {
    CrashIntelligence.addBreadcrumb('user_action', 'User ended call');
    await peerRef.current?.close();
    await SessionOrchestrator.endSession(sessionId.current);
    router.back();
  }, [router]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    return `${m}:${(s % 60).toString().padStart(2, '0')}`;
  };

  const isConnecting  = callState === 'new' || callState === 'connecting';
  const isReconnecting = callState === 'reconnecting';
  const isConnected   = callState === 'connected';
  const statusText = isConnecting    ? 'Conectando...'
                   : isReconnecting  ? 'Reconectando...'
                   : isConnected     ? formatDuration(duration)
                   : callState === 'failed' ? 'Error de conexión'
                   : 'Llamada terminada';

  const qualityColor = quality ? QUALITY_COLORS[quality.qualityLevel] : Colors.accent;

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Remote stream — shown when connected with real WebRTC */}
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

      {/* Partner info (shown when no remote stream) */}
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
            callState === 'failed' && { color: Colors.secondary },
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
        // Status overlay on remote stream
        <View style={[styles.streamStatusOverlay, { top: insets.top + 8 }]}>
          <Text style={styles.streamPartnerName}>@{partnerName}</Text>
          <Text style={styles.streamDuration}>{statusText}</Text>
          {quality ? (
            <View style={[styles.qualityDot, { backgroundColor: qualityColor, marginTop: 4 }]} />
          ) : null}
        </View>
      )}

      {/* Local preview (PiP) */}
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
          {/* Mute */}
          <Pressable style={[styles.controlBtn, isMuted && styles.controlBtnActive]} onPress={handleToggleMute} hitSlop={8}>
            <MaterialIcons name={isMuted ? 'mic-off' : 'mic'} size={24} color={isMuted ? '#000' : '#fff'} />
            <Text style={[styles.controlLabel, isMuted && { color: '#000' }]}>{isMuted ? 'Activar' : 'Silenciar'}</Text>
          </Pressable>

          {/* End call */}
          <Pressable style={styles.endCallBtn} onPress={handleEndCall} hitSlop={4}>
            <MaterialIcons name="call-end" size={30} color="#fff" />
          </Pressable>

          {/* Camera */}
          <Pressable style={[styles.controlBtn, isCameraOff && styles.controlBtnActive]} onPress={handleToggleCamera} hitSlop={8}>
            <MaterialIcons name={isCameraOff ? 'videocam-off' : 'videocam'} size={24} color={isCameraOff ? '#000' : '#fff'} />
            <Text style={[styles.controlLabel, isCameraOff && { color: '#000' }]}>{isCameraOff ? 'Activar' : 'Cámara'}</Text>
          </Pressable>
        </View>

        <View style={styles.controlRow2}>
          <Pressable style={styles.controlBtnSm} onPress={handleFlipCamera} hitSlop={8}>
            <MaterialIcons name="flip-camera-ios" size={20} color={Colors.textSecondary} />
            <Text style={styles.controlLabelSm}>Voltear</Text>
          </Pressable>

          <Pressable style={styles.controlBtnSm} onPress={handleToggleSpeaker} hitSlop={8}>
            <MaterialIcons name={isSpeaker ? 'volume-up' : 'hearing'} size={20} color={isSpeaker ? Colors.primary : Colors.textSecondary} />
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
  container:          { flex: 1, backgroundColor: '#0A0A14' },
  remoteStream:       { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  streamStatusOverlay:{ position: 'absolute', left: Spacing.md, alignItems: 'flex-start', zIndex: 10 },
  streamPartnerName:  { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold, textShadowColor: '#000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  streamDuration:     { color: 'rgba(255,255,255,0.8)', fontSize: FontSize.sm },
  thermalBanner:      { position: 'absolute', left: Spacing.md, right: Spacing.md, zIndex: 20, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,140,0,0.15)', borderRadius: Radius.sm, padding: Spacing.xs, borderWidth: 1, borderColor: 'rgba(255,140,0,0.4)' },
  thermalText:        { color: '#FF8C00', fontSize: 11, flex: 1 },
  reconnectBanner:    { position: 'absolute', left: Spacing.md, right: Spacing.md, zIndex: 20, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,184,0,0.15)', borderRadius: Radius.sm, padding: Spacing.xs, borderWidth: 1, borderColor: 'rgba(255,184,0,0.4)' },
  reconnectText:      { color: Colors.warning, fontSize: 11, flex: 1 },
  topArea:            { alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.xl },
  avatarRing:         { width: 130, height: 130, borderRadius: 65, borderWidth: 2, borderColor: Colors.primary + '55', alignItems: 'center', justifyContent: 'center' },
  avatarCircle:       { width: 110, height: 110, borderRadius: 55, backgroundColor: Colors.surfaceElevated, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Colors.primary },
  avatarInitial:      { color: Colors.primary, fontSize: 44, fontWeight: FontWeight.bold },
  partnerName:        { color: Colors.textPrimary, fontSize: FontSize.xxl, fontWeight: FontWeight.bold },
  callStatus:         { color: Colors.textSecondary, fontSize: FontSize.lg },
  qualityRow:         { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: Radius.sm, paddingHorizontal: 10, paddingVertical: 4 },
  qualityDot:         { width: 7, height: 7, borderRadius: 4 },
  qualityText:        { fontSize: FontSize.xs, fontWeight: FontWeight.medium },
  qualityRtt:         { color: Colors.textSubtle, fontSize: FontSize.xs },
  localPreview:       { position: 'absolute', top: 180, right: Spacing.lg, width: 90, height: 120, borderRadius: Radius.md, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border, zIndex: 10 },
  localPreviewFallback: { flex: 1, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  localPreviewLabel:  { position: 'absolute', bottom: 4, left: 0, right: 0, textAlign: 'center', color: '#fff', fontSize: 10, backgroundColor: 'rgba(0,0,0,0.5)' },
  controls:           { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', gap: Spacing.lg, paddingHorizontal: Spacing.xl },
  controlRow:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' },
  controlRow2:        { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: Spacing.xl },
  controlBtn:         { width: 70, height: 70, borderRadius: 35, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', gap: 4 },
  controlBtnActive:   { backgroundColor: Colors.textPrimary },
  controlLabel:       { color: Colors.textSecondary, fontSize: 11 },
  endCallBtn:         { width: 78, height: 78, borderRadius: 39, backgroundColor: Colors.secondary, alignItems: 'center', justifyContent: 'center' },
  controlBtnSm:       { alignItems: 'center', gap: 4, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md },
  controlLabelSm:     { color: Colors.textSubtle, fontSize: 11 },
  lossWarning:        { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,184,0,0.15)', borderRadius: Radius.sm, paddingHorizontal: 8, paddingVertical: 4 },
  lossText:           { color: Colors.warning, fontSize: 11 },
});
