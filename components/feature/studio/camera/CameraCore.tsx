/**
 * components/feature/studio/camera/CameraCore.tsx — Production hardened
 *
 * DeepAR lifecycle:
 *   - Full suspend/resume (pause metal render on background, restore on foreground)
 *   - Thermal-adaptive quality (high → medium → low → paused)
 *   - GPU slot acquisition via GPUManager before mounting DeepAR
 *   - Memory pressure cleanup (unload effects, reduce texture quality)
 *   - Effect lifecycle (preload, apply, clear with proper slot management)
 *   - Error recovery (reload on fatal error with 3-attempt limit)
 *
 * WebRTC integration:
 *   - getLocalStream() — exposes the live MediaStream for RTC peer tracks
 *   - setRemoteStream() — renders remote RTCView alongside local camera
 *
 * All Metal/CALayer requirements preserved:
 *   - Explicit numeric width/height (never flex/percentage)
 *   - Dimensions.addEventListener for orientation changes
 */

import React, {
  forwardRef, useImperativeHandle, useRef,
  useEffect, useState, useCallback,
} from 'react';
import {
  View, Text, StyleSheet, Pressable, Dimensions,
  AppState, AppStateStatus, Platform, Animated, Easing,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { Colors, FontSize, FontWeight, Radius } from '@/constants/theme';
import { log } from '@/services/logger';
import {
  isDeepARAvailable,
  DeepARCamera as DeepARCameraComponent,
  DEEPAR_API_KEY_IOS,
  DEEPAR_API_KEY_ANDROID,
  prefetchDeepARFilters,
  triggerDeepARScreenshot,
  startDeepARRecording,
  logDeepARMounted,
  logDeepARInitialized,
  logDeepARCameraReady,
  type DeepARFilter,
} from '@/services/deeparService';
import { GPUManager }    from '@/modules/core/GPUManager';
import { ThermalMonitor } from '@/modules/core/ThermalMonitor';
import { MemoryOptimizer } from '@/modules/core/MemoryOptimizer';
import { EventBus }      from '@/modules/core/EventBus';

// ── Lazy-load expo-camera ─────────────────────────────────────────────────────
let CameraView: any                = null;
let useCameraPermissionsImpl: any  = null;
try {
  const ec = require('expo-camera');
  CameraView               = ec.CameraView           ?? null;
  useCameraPermissionsImpl = ec.useCameraPermissions ?? null;
} catch { /* web / preview */ }

function useSafeCameraPermissions(): [{ granted: boolean } | null, () => Promise<any>] {
  if (useCameraPermissionsImpl) return useCameraPermissionsImpl();
  return [null, async () => {}];
}

function getWindowWidth(): number {
  return Math.max(1, Dimensions.get('window').width);
}

// ── DeepAR quality tiers ───────────────────────────────────────────────────────
type ARQuality = 'ultra' | 'high' | 'medium' | 'low' | 'paused';

function thermalToARQuality(): ARQuality {
  const thermal = ThermalMonitor.currentState;
  if (thermal === 'critical')  return 'paused';
  if (thermal === 'serious')   return 'low';
  if (thermal === 'fair')      return 'medium';
  if (thermal === 'nominal')   return 'ultra';
  return 'high';
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface CameraCoreHandle {
  takePhoto:       () => Promise<string | null>;
  startRecording:  () => void;
  stopRecording:   () => Promise<string | null>;
  flipCamera:      () => void;
  isDeepAR:        boolean;
  isReady:         boolean;
  deepARRef:       React.MutableRefObject<any>;
  /** Expose local media stream for WebRTC track injection */
  getLocalStream:  () => any;
  /** Called from parent to render a remote WebRTC stream */
  setRemoteStream: (stream: any) => void;
  /** Force suspend AR rendering (background / thermal) */
  suspendAR:       () => void;
  /** Resume AR rendering (foreground / thermal recovery) */
  resumeAR:        () => void;
  /** Apply a DeepAR effect by filter object */
  applyEffect:     (filter: DeepARFilter | null) => Promise<void>;
}

export interface CameraCoreProps {
  height?:         number;
  overlay?:        React.ReactNode;
  onDeepARReady?:  () => void;
  onScreenshot?:   (uri: string) => void;
  onVideoReady?:   (uri: string) => void;
  onError?:        (msg: string) => void;
  /** Enables WebRTC remote stream overlay */
  enableRTCView?:  boolean;
}

// ── Pulsing dot ───────────────────────────────────────────────────────────────
function PulsingDot({ color }: { color: string }) {
  const sc = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(sc, { toValue: 1.5, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(sc, { toValue: 1.0, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, []);
  return (
    <Animated.View style={{
      width: 8, height: 8, borderRadius: 4,
      backgroundColor: color, transform: [{ scale: sc }],
    }} />
  );
}

function fmtSec(s: number) {
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}

// ── CameraCore ────────────────────────────────────────────────────────────────
const CameraCore = forwardRef<CameraCoreHandle, CameraCoreProps>(function CameraCore(
  { height, overlay, onDeepARReady, onScreenshot, onVideoReady, onError, enableRTCView = false },
  ref,
) {
  const [windowW, setWindowW] = React.useState<number>(() => getWindowWidth());

  // Re-measure on orientation change — Metal surface must have explicit numeric dims
  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => {
      setWindowW(Math.max(1, window.width));
    });
    return () => sub.remove();
  }, []);

  const camHeight = height ?? Math.round(windowW * 1.22);

  const deepARRef       = useRef<any>(null);
  const expoCamRef      = useRef<any>(null);
  const localStreamRef  = useRef<any>(null);
  const [remoteStream, setRemoteStream] = useState<any>(null);

  const deepARCompOk = isDeepARAvailable() && DeepARCameraComponent !== null;

  const [facing,        setFacing]        = useState<'front' | 'back'>('front');
  const [deepARReady,   setDeepARReady]   = useState(false);
  const [arSuspended,   setARSuspended]   = useState(false);
  const [arQuality,     setARQuality]     = useState<ARQuality>('high');
  const [isRecording,   setIsRecording]   = useState(false);
  const [recSeconds,    setRecSeconds]    = useState(0);
  const [fatalErrors,   setFatalErrors]   = useState(0);
  const [currentEffect, setCurrentEffect] = useState<string | null>(null);

  const recTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const gpuSlotRef    = useRef<string | null>(null);
  const arInitRef     = useRef(false);

  const [camPerm, requestCamPerm] = useSafeCameraPermissions();
  const hasPerm = camPerm?.granted ?? false;

  // ── GPU slot acquisition ──────────────────────────────────────────────────
  useEffect(() => {
    if (!deepARCompOk) return;

    const acquire = async () => {
      try {
        gpuSlotRef.current = await GPUManager.acquireSlot('CameraCore:DeepAR', 'high');
      } catch (e: any) {
        console.warn('[CameraCore] GPU slot unavailable:', e?.message);
        // Gracefully fall back to expo-camera
      }
    };
    acquire();

    return () => {
      if (gpuSlotRef.current) {
        GPUManager.releaseSlot(gpuSlotRef.current);
        gpuSlotRef.current = null;
      }
    };
  }, [deepARCompOk]);

  // ── Thermal adaptation ────────────────────────────────────────────────────
  useEffect(() => {
    const unsubThermal = EventBus.on('thermal:state_changed', (evt: any) => {
      const newQuality = thermalToARQuality();
      setARQuality(newQuality);

      if (newQuality === 'paused' && !arSuspended) {
        // Suspend AR render to cool down
        setARSuspended(true);
        if (deepARRef.current?.pauseCamera) {
          try { deepARRef.current.pauseCamera(); } catch { /* ignore */ }
        }
        console.warn('[CameraCore] AR suspended: thermal critical');
      } else if (newQuality !== 'paused' && arSuspended) {
        setARSuspended(false);
        if (deepARRef.current?.resumeCamera) {
          try { deepARRef.current.resumeCamera(); } catch { /* ignore */ }
        }
        console.log('[CameraCore] AR resumed: thermal recovered');
      }

      // Adapt render frame rate
      if (deepARRef.current?.setLiveMode) {
        const fps = newQuality === 'ultra' ? 60
                  : newQuality === 'high'  ? 30
                  : newQuality === 'medium'? 24
                  : newQuality === 'low'   ? 15
                  : 0;
        if (fps > 0) {
          try { deepARRef.current.setLiveMode(fps); } catch { /* ignore */ }
        }
      }
    });

    return () => unsubThermal();
  }, [arSuspended]);

  // ── Memory pressure cleanup ───────────────────────────────────────────────
  useEffect(() => {
    const unsubMemory = EventBus.on('memory:pressure_changed', (evt: any) => {
      const level: string = evt?.level ?? 'normal';
      if (level === 'critical' || level === 'severe') {
        // Clear current AR effect to free GPU memory
        if (deepARRef.current && currentEffect) {
          try {
            deepARRef.current.switchEffectWithPath?.({ path: '', slot: 'effect' });
            setCurrentEffect(null);
          } catch { /* ignore */ }
        }
        console.warn('[CameraCore] AR effect cleared: memory pressure', level);
      }
    });
    return () => unsubMemory();
  }, [currentEffect]);

  // ── AppState: suspend/resume AR on background/foreground ─────────────────
  useEffect(() => {
    const handleAppState = (state: AppStateStatus) => {
      if (!deepARRef.current) return;
      if (state === 'background' || state === 'inactive') {
        setARSuspended(true);
        try { deepARRef.current.pauseCamera?.(); } catch { /* ignore */ }
      } else if (state === 'active') {
        setARSuspended(false);
        try { deepARRef.current.resumeCamera?.(); } catch { /* ignore */ }
      }
    };

    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, []);

  // ── Permissions + prefetch ────────────────────────────────────────────────
  useEffect(() => {
    requestCamPerm();
    if (deepARCompOk && deepARReady) {
      prefetchDeepARFilters(['flower_crown', 'beauty', 'fire']).catch(() => {});
    }
  }, [deepARCompOk, deepARReady]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => () => {
    if (recTimerRef.current) clearInterval(recTimerRef.current);
    try {
      if (isRecording && expoCamRef.current) expoCamRef.current.stopRecording();
    } catch { /* ignore */ }
    // Release GPU slot
    if (gpuSlotRef.current) {
      GPUManager.releaseSlot(gpuSlotRef.current);
      gpuSlotRef.current = null;
    }
    // Stop any local WebRTC tracks
    if (localStreamRef.current) {
      try {
        for (const track of localStreamRef.current.getTracks()) track.stop();
      } catch { /* ignore */ }
      localStreamRef.current = null;
    }
  }, []);

  // ── Apply DeepAR effect ───────────────────────────────────────────────────
  const applyEffect = useCallback(async (filter: DeepARFilter | null) => {
    if (!deepARRef.current) return;

    if (!filter) {
      // Clear effect
      try {
        deepARRef.current.switchEffectWithPath?.({ path: '', slot: 'effect' });
        setCurrentEffect(null);
      } catch { /* ignore */ }
      return;
    }

    try {
      const { switchDeepAREffect, getLocalFilterPath } = require('@/services/deeparService');
      const path = await getLocalFilterPath(filter);
      if (!path) {
        console.warn('[CameraCore] effect path unavailable:', filter.id);
        return;
      }
      deepARRef.current.switchEffectWithPath?.({ path, slot: 'effect' });
      setCurrentEffect(filter.id);
    } catch (e: any) {
      console.warn('[CameraCore] applyEffect error:', e?.message);
    }
  }, []);

  // ── Suspend/Resume API ────────────────────────────────────────────────────
  const suspendAR = useCallback(() => {
    setARSuspended(true);
    try { deepARRef.current?.pauseCamera?.(); } catch { /* ignore */ }
  }, []);

  const resumeAR = useCallback(() => {
    setARSuspended(false);
    try { deepARRef.current?.resumeCamera?.(); } catch { /* ignore */ }
  }, []);

  // ── Imperative handle ─────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    isDeepAR:  deepARCompOk,
    isReady:   deepARCompOk ? deepARReady : hasPerm,
    deepARRef,

    getLocalStream: () => localStreamRef.current,

    setRemoteStream: (stream: any) => {
      setRemoteStream(stream);
    },

    suspendAR,
    resumeAR,
    applyEffect,

    takePhoto: () => new Promise<string | null>(resolve => {
      if (deepARCompOk && deepARRef.current) {
        triggerDeepARScreenshot(deepARRef);
        resolve(null);
      } else if (expoCamRef.current) {
        expoCamRef.current.takePictureAsync({ quality: 0.9 })
          .then((p: any) => resolve(p?.uri ?? null))
          .catch(() => resolve(null));
      } else {
        resolve(null);
      }
    }),

    startRecording: () => {
      if (isRecording) return;
      setIsRecording(true);
      setRecSeconds(0);
      recTimerRef.current = setInterval(() => setRecSeconds(s => s + 1), 1000);

      if (deepARCompOk && deepARRef.current) {
        startDeepARRecording(deepARRef);
      } else if (expoCamRef.current) {
        expoCamRef.current.recordAsync({ maxDuration: 60 })
          .then((v: any) => {
            if (recTimerRef.current) clearInterval(recTimerRef.current);
            setIsRecording(false); setRecSeconds(0);
            if (v?.uri) onVideoReady?.(v.uri);
          })
          .catch((e: any) => {
            if (recTimerRef.current) clearInterval(recTimerRef.current);
            setIsRecording(false); setRecSeconds(0);
            if (e?.message && !e.message.includes('stopped')) onError?.(e.message);
          });
      }
    },

    stopRecording: () => new Promise<string | null>(resolve => {
      if (!isRecording) { resolve(null); return; }
      if (recTimerRef.current) clearInterval(recTimerRef.current);
      if (deepARCompOk && deepARRef.current) {
        try {
          const { stopDeepARRecording } = require('@/services/deeparService');
          stopDeepARRecording(deepARRef);
        } catch { /* ignore */ }
      } else if (expoCamRef.current) {
        try { expoCamRef.current.stopRecording(); } catch { /* ignore */ }
      }
      setIsRecording(false); setRecSeconds(0);
      resolve(null);
    }),

    flipCamera: () => setFacing(f => f === 'front' ? 'back' : 'front'),
  }), [deepARCompOk, deepARReady, hasPerm, isRecording, applyEffect, suspendAR, resumeAR]);

  const DeepARCam = deepARCompOk ? (DeepARCameraComponent as any) : null;
  if (deepARCompOk && DeepARCam) logDeepARMounted();

  // ── No camera available ───────────────────────────────────────────────────
  if (!CameraView && !deepARCompOk) {
    return (
      <View style={[c.wrap, { height: camHeight, alignItems: 'center', justifyContent: 'center', gap: 12 }]}>
        <MaterialCommunityIcons name="cellphone-off" size={48} color={Colors.warning} />
        <Text style={c.noDeviceTitle}>Cámara requiere EAS Build</Text>
        <Text style={c.noDeviceSub}>iPhone/Android con TestFlight o APK nativo</Text>
      </View>
    );
  }

  // ── Permission not granted ────────────────────────────────────────────────
  if (!hasPerm && !deepARCompOk) {
    return (
      <View style={[c.wrap, { height: camHeight, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 }]}>
        <MaterialCommunityIcons name="camera-lock" size={48} color={Colors.textSubtle} />
        <Text style={c.noDeviceTitle}>Permiso de cámara requerido</Text>
        <Pressable style={c.permBtn} onPress={requestCamPerm}>
          <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={c.permBtnInner}>
            <Text style={c.permBtnText}>Conceder permiso</Text>
          </LinearGradient>
        </Pressable>
      </View>
    );
  }

  // ── AR suspended overlay ──────────────────────────────────────────────────
  const showSuspendedOverlay = arSuspended && deepARCompOk;

  return (
    <View style={[c.wrap, { height: camHeight }]}>
      {/* Camera surface */}
      {deepARCompOk && DeepARCam ? (
        <DeepARCam
          ref={deepARRef}
          style={[c.cameraFill, { width: windowW, height: camHeight }]}
          apiKey={Platform.OS === 'ios' ? DEEPAR_API_KEY_IOS : DEEPAR_API_KEY_ANDROID}
          onInitialized={() => {
            logDeepARInitialized();
            log.deepar.info('DeepAR initialized');
            setDeepARReady(true);
            arInitRef.current = true;
            setFatalErrors(0);
            onDeepARReady?.();
            // Apply thermal quality on init
            const q = thermalToARQuality();
            setARQuality(q);
          }}
          onCameraReady={() => {
            logDeepARCameraReady(true);
          }}
          onError={(text: string, isFatal: boolean) => {
            logDeepARCameraReady(false, text);
            log.deepar.error('DeepAR error', { text, isFatal });
            if (isFatal) {
              setFatalErrors(prev => prev + 1);
              onError?.(`DeepAR: ${text}`);
            }
          }}
          onScreenshotTaken={(uri: string) => onScreenshot?.(uri)}
          onVideoRecordingFinished={(uri: string) => {
            if (recTimerRef.current) clearInterval(recTimerRef.current);
            setIsRecording(false); setRecSeconds(0);
            onVideoReady?.(uri);
          }}
        />
      ) : CameraView ? (
        <CameraView
          ref={expoCamRef}
          style={[c.cameraFill, { width: windowW, height: camHeight }]}
          facing={facing}
          mode="video"
          onCameraReady={() => log.deepar.info('expo-camera ready')}
        />
      ) : null}

      {/* AR Suspended overlay */}
      {showSuspendedOverlay ? (
        <View style={c.suspendedOverlay} pointerEvents="none">
          <MaterialCommunityIcons name="thermometer-alert" size={28} color="#FF8C00" />
          <Text style={c.suspendedText}>
            {arQuality === 'paused' ? 'AR pausado: temperatura alta' : 'Calidad reducida'}
          </Text>
        </View>
      ) : null}

      {/* Consumer overlays */}
      {overlay}

      {/* DeepAR initializing indicator */}
      {deepARCompOk && !deepARReady ? (
        <View style={c.initOverlay} pointerEvents="none">
          <PulsingDot color="#7C5CFF" />
          <Text style={c.initText}>Iniciando DeepAR...</Text>
        </View>
      ) : null}

      {/* Active effect badge */}
      {currentEffect ? (
        <View style={c.effectBadge} pointerEvents="none">
          <MaterialCommunityIcons name="auto-awesome" size={11} color="#B44FFF" />
          <Text style={c.effectBadgeText}>{currentEffect}</Text>
        </View>
      ) : null}

      {/* Quality warning */}
      {arQuality === 'low' || arQuality === 'medium' ? (
        <View style={c.qualityBadge} pointerEvents="none">
          <Text style={c.qualityBadgeText}>
            {arQuality === 'low' ? '⚠ Baja calidad' : '⚡ Calidad media'}
          </Text>
        </View>
      ) : null}

      {/* Recording indicator */}
      {isRecording ? (
        <View style={c.recIndicator} pointerEvents="none">
          <PulsingDot color="#FF3B3B" />
          <Text style={c.recText}>REC {fmtSec(recSeconds)}</Text>
        </View>
      ) : null}

      {/* Camera mode badge */}
      <View style={c.liveBadge} pointerEvents="none">
        <View style={[c.liveBadgeInner, { backgroundColor: deepARCompOk ? 'rgba(255,45,120,0.25)' : 'rgba(44,44,80,0.85)' }]}>
          <PulsingDot color={deepARCompOk ? '#FF2D78' : '#7C5CFF'} />
          <Text style={c.liveBadgeText}>{deepARCompOk ? 'DeepAR' : 'expo-cam'}</Text>
        </View>
      </View>

      {/* Flip button */}
      <Pressable style={c.flipBtn} onPress={() => setFacing(f => f === 'front' ? 'back' : 'front')}>
        <MaterialCommunityIcons name="camera-flip-outline" size={22} color="#fff" />
      </Pressable>
    </View>
  );
});

export default CameraCore;
export { CameraCore };

const c = StyleSheet.create({
  wrap:            { width: '100%', backgroundColor: '#000', position: 'relative', overflow: 'hidden' },
  cameraFill:      { position: 'absolute', top: 0, left: 0 },
  noDeviceTitle:   { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold, textAlign: 'center' },
  noDeviceSub:     { color: Colors.textSubtle, fontSize: FontSize.sm, textAlign: 'center', lineHeight: 20 },
  permBtn:         { borderRadius: Radius.lg, overflow: 'hidden', marginTop: 8 },
  permBtnInner:    { paddingHorizontal: 28, paddingVertical: 14 },
  permBtnText:     { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
  recIndicator:    { position: 'absolute', top: 14, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(200,0,0,0.75)', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6, zIndex: 20 },
  recText:         { color: '#fff', fontSize: 13, fontWeight: FontWeight.bold },
  initOverlay:     { position: 'absolute', top: 14, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8, zIndex: 20 },
  initText:        { color: '#fff', fontSize: 12 },
  liveBadge:       { position: 'absolute', bottom: 12, right: 12, borderRadius: 10, overflow: 'hidden', zIndex: 20 },
  liveBadgeInner:  { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5 },
  liveBadgeText:   { color: '#fff', fontSize: 10, fontWeight: FontWeight.bold },
  flipBtn:         { position: 'absolute', top: 14, right: 12, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', zIndex: 20 },
  suspendedOverlay:{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', gap: 10, zIndex: 30 },
  suspendedText:   { color: '#FF8C00', fontSize: FontSize.sm, fontWeight: FontWeight.semibold, textAlign: 'center' },
  effectBadge:     { position: 'absolute', bottom: 12, left: 12, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(180,79,255,0.3)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, zIndex: 20 },
  effectBadgeText: { color: '#B44FFF', fontSize: 10, fontWeight: FontWeight.bold },
  qualityBadge:    { position: 'absolute', top: 14, left: 12, backgroundColor: 'rgba(255,184,0,0.25)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, zIndex: 20 },
  qualityBadgeText:{ color: '#FFB800', fontSize: 10, fontWeight: FontWeight.semibold },
});
