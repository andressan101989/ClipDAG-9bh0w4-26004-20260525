/**
 * components/feature/studio/camera/CameraCore.tsx
 *
 * Isolated camera abstraction layer for Creator Studio.
 *
 * Responsibilities (all centralized here, nowhere else):
 *   - Permission request and state
 *   - DeepAR vs expo-camera lifecycle selection
 *   - Recording start / stop + timer
 *   - Screenshot capture
 *   - Camera facing toggle
 *   - Cleanup on unmount
 *   - Exposes typed ref handle so parent tabs are camera-agnostic
 *
 * Consumers receive a <CameraCore ref={ref} /> and call:
 *   ref.current.takePhoto()
 *   ref.current.startRecording()
 *   ref.current.stopRecording()
 *   ref.current.flipCamera()
 *
 * No business logic, no feed/router/alert — pure camera layer.
 */

import React, {
  forwardRef, useImperativeHandle, useRef,
  useEffect, useState, useCallback,
} from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, Pressable, Dimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue, useAnimatedStyle, withSequence,
  withTiming, withRepeat, Easing,
} from 'react-native-reanimated';
import { Colors, FontSize, FontWeight, Radius } from '@/constants/theme';
import { log } from '@/services/logger';
// DeepAR fully removed — crash isolation build
// import { ... } from '@/services/deeparService';

// ── Lazy-load expo-camera ────────────────────────────────────────────────────
let CameraView: any                = null;
let useCameraPermissionsImpl: any  = null;
try {
  const ec = require('expo-camera');
  CameraView               = ec.CameraView           ?? null;
  useCameraPermissionsImpl = ec.useCameraPermissions ?? null;
} catch { /* web / preview */ }

// ── DeepAR stubs (disabled) ──────────────────────────────────────────────────
const isDeepARAvailable      = () => false;
const DeepARCameraComponent  = null;
const prefetchDeepARFilters  = async (_ids?: string[]) => {};
const triggerDeepARScreenshot = (_ref: any) => {};
const startDeepARRecording   = (_ref: any) => {};

function useSafeCameraPermissions(): [{ granted: boolean } | null, () => Promise<any>] {
  if (useCameraPermissionsImpl) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useCameraPermissionsImpl();
  }
  return [null, async () => {}];
}

const { width: W } = Dimensions.get('window');

// ── Types ─────────────────────────────────────────────────────────────────────
export interface CameraCoreHandle {
  /** Returns the local URI of the taken photo, or null on failure */
  takePhoto:      () => Promise<string | null>;
  startRecording: () => void;
  stopRecording:  () => Promise<string | null>;
  flipCamera:     () => void;
  isDeepAR:       boolean;
  isReady:        boolean;
  /** Raw DeepAR ref — needed by EffectsTab to call switchEffect */
  deepARRef:      React.MutableRefObject<any>;
}

export interface CameraCoreProps {
  /** Height in pixels for the camera viewport */
  height?: number;
  /** Overlay content (filter badges, recording indicators etc.) — rendered above camera */
  overlay?: React.ReactNode;
  /** Called when DeepAR finishes initializing */
  onDeepARReady?: () => void;
  /** Called with a screenshot URI when DeepAR captures */
  onScreenshot?:  (uri: string) => void;
  /** Called with a recorded video URI when recording finishes */
  onVideoReady?:  (uri: string) => void;
  /** Called when any camera error occurs */
  onError?:       (msg: string) => void;
}

// ── Pulsing dot (recording indicator) ────────────────────────────────────────
function PulsingDot({ color }: { color: string }) {
  const sc = useSharedValue(1);
  useEffect(() => {
    sc.value = withRepeat(
      withSequence(
        withTiming(1.5, { duration: 600, easing: Easing.inOut(Easing.ease) }),
        withTiming(1.0, { duration: 600, easing: Easing.inOut(Easing.ease) }),
      ), -1, false,
    );
  }, []);
  const sty = useAnimatedStyle(() => ({
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: color, transform: [{ scale: sc.value }],
  }));
  return <Animated.View style={sty} />;
}

function fmtSec(s: number) {
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}

// ── CameraCore ────────────────────────────────────────────────────────────────
const CameraCore = forwardRef<CameraCoreHandle, CameraCoreProps>(function CameraCore(
  { height, overlay, onDeepARReady, onScreenshot, onVideoReady, onError },
  ref,
) {
  const camHeight = height ?? W * 1.22;

  const deepARRef     = useRef<any>(null);
  const expoCamRef    = useRef<any>(null);

  // DeepAR fully disabled — always use expo-camera
  const deepARCompOk  = false;

  const [facing,      setFacing]      = useState<'front' | 'back'>('front');
  const [isRecording, setIsRecording] = useState(false);
  const [recSeconds,  setRecSeconds]  = useState(0);

  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [camPerm, requestCamPerm] = useSafeCameraPermissions();
  const hasPerm = camPerm?.granted ?? false;

  // ── Permissions — expo-camera only ───────────────────────────────────────────
  useEffect(() => {
    requestCamPerm();
  }, []);

  // Cleanup on unmount
  useEffect(() => () => {
    if (recTimerRef.current) clearInterval(recTimerRef.current);
    try { if (isRecording && expoCamRef.current) expoCamRef.current.stopRecording(); } catch { /* ignore */ }
  }, []);

  // ── Imperative handle ───────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    isDeepAR:  false,
    isReady:   hasPerm,
    deepARRef,

    takePhoto: () => new Promise<string | null>(resolve => {
      if (expoCamRef.current) {
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
      if (expoCamRef.current) {
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
      if (expoCamRef.current) {
        try { expoCamRef.current.stopRecording(); } catch { /* ignore */ }
      }
      setIsRecording(false); setRecSeconds(0);
      resolve(null);
    }),

    flipCamera: () => setFacing(f => f === 'front' ? 'back' : 'front'),
  }), [deepARCompOk, deepARReady, hasPerm, isRecording]);

  // ── No camera available ─────────────────────────────────────────────────────
  if (!CameraView && !deepARCompOk) {
    return (
      <View style={[c.wrap, { height: camHeight, alignItems: 'center', justifyContent: 'center', gap: 12 }]}>
        <MaterialCommunityIcons name="cellphone-off" size={48} color={Colors.warning} />
        <Text style={c.noDeviceTitle}>Cámara requiere EAS Build</Text>
        <Text style={c.noDeviceSub}>iPhone/Android con TestFlight o APK nativo</Text>
      </View>
    );
  }

  // ── Permission not granted ──────────────────────────────────────────────────
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

  // ── Camera viewport ─────────────────────────────────────────────────────────
  return (
    <View style={[c.wrap, { height: camHeight }]}>
      {/* Camera surface — expo-camera only (DeepAR disabled) */}
      {CameraView ? (
        <CameraView
          ref={expoCamRef}
          style={StyleSheet.absoluteFillObject}
          facing={facing}
          mode="video"
        />
      ) : null}

      {/* Consumer overlays (filters, badges, Skia) */}
      {overlay}

      {/* Recording indicator — always rendered here, not in consumer */}
      {isRecording ? (
        <View style={c.recIndicator} pointerEvents="none">
          <PulsingDot color="#FF3B3B" />
          <Text style={c.recText}>REC {fmtSec(recSeconds)}</Text>
        </View>
      ) : null}

      {/* expo-camera badge */}
      <View style={c.liveBadge} pointerEvents="none">
        <View style={[c.liveBadgeInner, { backgroundColor: 'rgba(44,44,80,0.85)' }]}>
          <PulsingDot color="#7C5CFF" />
          <Text style={c.liveBadgeText}>expo-camera</Text>
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

// ── Styles ─────────────────────────────────────────────────────────────────────
const c = StyleSheet.create({
  wrap:           { width: W, backgroundColor: '#000', position: 'relative', overflow: 'hidden' },
  noDeviceTitle:  { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold, textAlign: 'center' },
  noDeviceSub:    { color: Colors.textSubtle, fontSize: FontSize.sm, textAlign: 'center', lineHeight: 20 },
  permBtn:        { borderRadius: Radius.lg, overflow: 'hidden', marginTop: 8 },
  permBtnInner:   { paddingHorizontal: 28, paddingVertical: 14 },
  permBtnText:    { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
  recIndicator:   { position: 'absolute', top: 14, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(200,0,0,0.75)', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6, zIndex: 20 },
  recText:        { color: '#fff', fontSize: 13, fontWeight: FontWeight.bold },
  initOverlay:    { position: 'absolute', top: 14, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8, zIndex: 20 },
  initText:       { color: '#fff', fontSize: 12 },
  liveBadge:      { position: 'absolute', bottom: 12, right: 12, borderRadius: 10, overflow: 'hidden', zIndex: 20 },
  liveBadgeInner: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5 },
  liveBadgeText:  { color: '#fff', fontSize: 10, fontWeight: FontWeight.bold },
  flipBtn:        { position: 'absolute', top: 14, right: 12, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', zIndex: 20 },
});
