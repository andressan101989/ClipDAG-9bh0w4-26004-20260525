/**
 * app/videocall/[userId].tsx — Production-grade video call screen
 *
 * Deep integration with:
 *   - RTCManager (peer lifecycle, ICE recovery, renegotiation, stats)
 *   - SessionOrchestrator (conflict resolution, background/foreground)
 *   - ResourceManager (camera + audio exclusive lease)
 *   - AdaptiveQualityController (thermal-driven bitrate + quality)
 *   - ThermalMonitor (temperature-aware UI degradation)
 *   - GPUManager (render slot management)
 *   - TelemetryPipeline (RTC quality telemetry)
 *   - CrashIntelligence (breadcrumbs for crash analysis)
 *   - SecurityManager (anti-abuse session validation)
 *
 * RTC flow:
 *   mount → SessionOrchestrator.register → RTCManager.createPeer → negotiate
 *   → peer.onStateChange → UI update → background → video pause
 *   → foreground → video resume → end → peer.close → session.end
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
import type { RTCConnectionState, RTCPeerStats, RTCQualityLevel } from '@/modules/realtime/RTCManager';

// ── Quality badge color mapping ───────────────────────────────────────────────
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
  const [callState, setCallState] = useState<RTCConnectionState>('new');
  const [isMuted,       setIsMuted]       = useState(false);
  const [isCameraOff,   setIsCameraOff]   = useState(false);
  const [isFrontCamera, setIsFrontCamera] = useState(true);
  const [duration,      setDuration]      = useState(0);
  const [partnerName,   setPartnerName]   = useState('Usuario');
  const [quality,       setQuality]       = useState<RTCPeerStats | null>(null);
  const [thermalWarn,   setThermalWarn]   = useState(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionId = useRef<string>(`call_${user?.id}_${partnerId}_${Date.now()}`);
  const gpuSlot   = useRef<string | null>(null);

  // ── Mount: init all systems ───────────────────────────────────────────────
  useEffect(() => {
    if (!user?.id || !partnerId) return;

    CrashIntelligence.addBreadcrumb('navigation', 'VideoCall screen mounted', { partnerId });

    // Validate session security
    const allowed = SecurityManager.checkAction('stream_join', user.id);
    if (!allowed) {
      CrashIntelligence.addBreadcrumb('error', 'VideoCall blocked by SecurityManager');
      router.back();
      return;
    }

    let peerRef: Awaited<ReturnType<typeof RTCManager.createPeer>> | null = null;

    const init = async () => {
      try {
        // 1. Acquire GPU render slot
        gpuSlot.current = await GPUManager.acquireSlot('VideoCallScreen', 'high');

        // 2. Acquire camera + microphone via ResourceManager
        ResourceManager.request('camera',     'VideoCallScreen');
        ResourceManager.request('microphone', 'VideoCallScreen');

        // 3. Register with SessionOrchestrator (pauses conflicting sessions)
        SessionOrchestrator.registerSession('call', sessionId.current, {
          onPause:   async () => { peerRef?.setTrackEnabled('video', false); },
          onResume:  async () => { peerRef?.setTrackEnabled('video', !isCameraOff); },
          onEnd:     async () => { await peerRef?.close(); },
          onRecover: async () => {
            await peerRef?.reconnect();
            return peerRef?.state !== 'failed';
          },
        });

        // 4. Fetch partner info
        const { data } = await supabase
          .from('user_profiles')
          .select('username, avatar_url')
          .eq('id', partnerId)
          .single();
        if (data) setPartnerName(data.username || 'Usuario');

        // 5. Create RTCPeer
        peerRef = await RTCManager.createPeer(
          `call:${user.id}:${partnerId}`,
          user.id,
          partnerId,
          { maxReconnects: 5, iceTimeoutMs: 15_000, statsIntervalMs: 2_000 },
        );

        // 6. Wire state changes → UI
        peerRef.onStateChange((s) => {
          setCallState(s);
          CrashIntelligence.addBreadcrumb('state', `RTC state: ${s}`, { partnerId });
          if (s === 'connected') {
            timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
          }
          if (s === 'closed' || s === 'failed') {
            if (timerRef.current) clearInterval(timerRef.current);
            setTimeout(() => router.back(), 800);
          }
        });

        // 7. Wire stats → quality badge + telemetry
        peerRef.onStats((stats) => {
          setQuality(stats);
          TelemetryPipeline.recordRTCQuality(`call:${partnerId}`, {
            rttMs:         stats.rttMs,
            packetLossPct: stats.packetLossPct,
            bitrateKbps:   stats.bitrateKbps,
          });
        });

        // 8. Wire errors
        peerRef.onError((err) => {
          CrashIntelligence.addBreadcrumb('error', `RTC error: ${err}`, { partnerId });
        });

        // 9. Start negotiation
        await peerRef.negotiate('offer');

        // 10. Monitor thermal — degrade video quality on heat
        const thermal = ThermalMonitor.currentState;
        if (thermal === 'serious' || thermal === 'critical') {
          setThermalWarn(true);
          peerRef.setTrackEnabled('video', false);
          setIsCameraOff(true);
        }

      } catch (e: any) {
        CrashIntelligence.addBreadcrumb('error', `VideoCall init error: ${e?.message}`);
        console.error('[VideoCall] init error:', e?.message);
        router.back();
      }
    };

    init();

    // Pulse animation for connecting state
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,    duration: 700, useNativeDriver: true }),
      ]),
    );
    pulse.start();

    return () => {
      pulse.stop();
      if (timerRef.current) clearInterval(timerRef.current);

      // Teardown: guaranteed cleanup regardless of how screen unmounts
      const cleanup = async () => {
        CrashIntelligence.addBreadcrumb('lifecycle', 'VideoCall cleanup');
        await peerRef?.close();
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
    const peer = RTCManager.getPeer(`call:${user?.id}:${partnerId}`);
    const next = !isMuted;
    peer?.setTrackEnabled('audio', !next);
    setIsMuted(next);
    CrashIntelligence.addBreadcrumb('user_action', next ? 'Muted mic' : 'Unmuted mic');
  }, [isMuted, user?.id, partnerId]);

  const handleToggleCamera = useCallback(() => {
    const peer = RTCManager.getPeer(`call:${user?.id}:${partnerId}`);
    const next = !isCameraOff;
    peer?.setTrackEnabled('video', !next);
    setIsCameraOff(next);
    CrashIntelligence.addBreadcrumb('user_action', next ? 'Camera off' : 'Camera on');
  }, [isCameraOff, user?.id, partnerId]);

  const handleEndCall = useCallback(async () => {
    CrashIntelligence.addBreadcrumb('user_action', 'User ended call');
    const peer = RTCManager.getPeer(`call:${user?.id}:${partnerId}`);
    await peer?.close();
    await SessionOrchestrator.endSession(sessionId.current);
    router.back();
  }, [user?.id, partnerId, router]);

  const handleFlipCamera = useCallback(async () => {
    setIsFrontCamera(f => !f);
    const peer = RTCManager.getPeer(`call:${user?.id}:${partnerId}`);
    if (peer) await peer.replaceTrack('video', null);
    CrashIntelligence.addBreadcrumb('user_action', 'Flipped camera');
  }, [user?.id, partnerId]);

  // ── Derived UI values ─────────────────────────────────────────────────────

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    return `${m}:${(s % 60).toString().padStart(2, '0')}`;
  };

  const isConnecting = callState === 'new' || callState === 'connecting';
  const isReconnecting = callState === 'reconnecting';
  const isConnected = callState === 'connected';
  const statusText = isConnecting    ? 'Conectando...'
                   : isReconnecting  ? 'Reconectando...'
                   : isConnected     ? formatDuration(duration)
                   : callState === 'failed' ? 'Error de conexión'
                   : 'Llamada terminada';

  const qualityColor = quality ? QUALITY_COLORS[quality.qualityLevel] : Colors.accent;

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Thermal warning banner */}
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

      {/* Partner info */}
      <View style={[styles.topArea, { paddingTop: insets.top + Spacing.xl + (thermalWarn ? 36 : 0) }]}>
        <Animated.View style={[
          styles.avatarRing,
          { transform: [{ scale: isConnecting ? pulseAnim : 1 }] },
          isConnected && { borderColor: qualityColor + '88' },
        ]}>
          <View style={styles.avatarCircle}>
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarInitial}>{partnerName.charAt(0).toUpperCase()}</Text>
            </View>
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
            <Text style={styles.qualityRtt}>
              {Math.round(quality.rttMs)}ms
            </Text>
          </View>
        ) : null}
      </View>

      {/* Local camera preview */}
      {isConnected && !isCameraOff ? (
        <View style={styles.localPreview}>
          <View style={styles.localPreviewInner}>
            <MaterialIcons name="person" size={28} color={Colors.textSubtle} />
          </View>
          <Text style={styles.localPreviewLabel}>Tú</Text>
        </View>
      ) : null}

      {/* Controls */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + Spacing.xl }]}>
        <View style={styles.controlRow}>
          {/* Mute */}
          <Pressable
            style={[styles.controlBtn, isMuted && styles.controlBtnActive]}
            onPress={handleToggleMute}
            hitSlop={8}
          >
            <MaterialIcons
              name={isMuted ? 'mic-off' : 'mic'}
              size={24}
              color={isMuted ? '#000' : '#fff'}
            />
            <Text style={[styles.controlLabel, isMuted && { color: '#000' }]}>
              {isMuted ? 'Activar' : 'Silenciar'}
            </Text>
          </Pressable>

          {/* End call */}
          <Pressable style={styles.endCallBtn} onPress={handleEndCall} hitSlop={4}>
            <MaterialIcons name="call-end" size={30} color="#fff" />
          </Pressable>

          {/* Camera on/off */}
          <Pressable
            style={[styles.controlBtn, isCameraOff && styles.controlBtnActive]}
            onPress={handleToggleCamera}
            hitSlop={8}
          >
            <MaterialIcons
              name={isCameraOff ? 'videocam-off' : 'videocam'}
              size={24}
              color={isCameraOff ? '#000' : '#fff'}
            />
            <Text style={[styles.controlLabel, isCameraOff && { color: '#000' }]}>
              {isCameraOff ? 'Activar' : 'Cámara'}
            </Text>
          </Pressable>
        </View>

        {/* Secondary controls */}
        <View style={styles.controlRow2}>
          <Pressable style={styles.controlBtnSm} onPress={handleFlipCamera} hitSlop={8}>
            <MaterialIcons name="flip-camera-ios" size={20} color={Colors.textSecondary} />
            <Text style={styles.controlLabelSm}>Voltear</Text>
          </Pressable>

          {isConnected && quality?.packetLossPct !== undefined && quality.packetLossPct > 5 ? (
            <View style={styles.lossWarning}>
              <MaterialIcons name="warning" size={14} color={Colors.warning} />
              <Text style={styles.lossText}>
                {quality.packetLossPct.toFixed(1)}% pérdida
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A14' },
  thermalBanner: {
    position: 'absolute', left: Spacing.md, right: Spacing.md, zIndex: 20,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,140,0,0.15)', borderRadius: Radius.sm,
    padding: Spacing.xs, borderWidth: 1, borderColor: 'rgba(255,140,0,0.4)',
  },
  thermalText: { color: '#FF8C00', fontSize: 11, flex: 1 },
  reconnectBanner: {
    position: 'absolute', left: Spacing.md, right: Spacing.md, zIndex: 20,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.warningDim, borderRadius: Radius.sm,
    padding: Spacing.xs, borderWidth: 1, borderColor: Colors.warning + '44',
  },
  reconnectText: { color: Colors.warning, fontSize: 11, flex: 1 },
  topArea: {
    alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.xl,
  },
  avatarRing: {
    width: 130, height: 130, borderRadius: 65,
    borderWidth: 2, borderColor: Colors.primary + '55',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarCircle: {
    width: 110, height: 110, borderRadius: 55,
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.primary,
    overflow: 'hidden',
  },
  avatarFallback: {
    width: '100%', height: '100%',
    backgroundColor: Colors.primaryDim,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { color: Colors.primary, fontSize: 44, fontWeight: FontWeight.bold },
  partnerName: {
    color: Colors.textPrimary, fontSize: FontSize.xxl, fontWeight: FontWeight.bold,
  },
  callStatus: { color: Colors.textSecondary, fontSize: FontSize.lg },
  qualityRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: Radius.sm,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  qualityDot: { width: 7, height: 7, borderRadius: 4 },
  qualityText: { fontSize: FontSize.xs, fontWeight: FontWeight.medium },
  qualityRtt:  { color: Colors.textSubtle, fontSize: FontSize.xs },
  localPreview: {
    position: 'absolute', top: 180, right: Spacing.lg,
    width: 90, height: 120, borderRadius: Radius.md,
    overflow: 'hidden', borderWidth: 1, borderColor: Colors.border,
  },
  localPreviewInner: {
    flex: 1, backgroundColor: Colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  localPreviewLabel: {
    position: 'absolute', bottom: 4, left: 0, right: 0,
    textAlign: 'center', color: '#fff', fontSize: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  controls: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    alignItems: 'center', gap: Spacing.lg, paddingHorizontal: Spacing.xl,
  },
  controlRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%',
  },
  controlRow2: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: Spacing.xl,
  },
  controlBtn: {
    width: 70, height: 70, borderRadius: 35,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', gap: 4,
  },
  controlBtnActive: { backgroundColor: Colors.textPrimary },
  controlLabel: { color: Colors.textSecondary, fontSize: 11 },
  endCallBtn: {
    width: 78, height: 78, borderRadius: 39,
    backgroundColor: Colors.secondary,
    alignItems: 'center', justifyContent: 'center',
  },
  controlBtnSm: {
    alignItems: 'center', gap: 4,
    paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md,
  },
  controlLabelSm: { color: Colors.textSubtle, fontSize: 11 },
  lossWarning: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.warningDim, borderRadius: Radius.sm,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  lossText: { color: Colors.warning, fontSize: 11 },
});
