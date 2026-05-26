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
import {
  isDeepARAvailable, DEEPAR_API_KEY,
  requestDeepARPermissions,
  prefetchDeepARFilters,
  triggerDeepARScreenshot,
  startDeepARRecording,
  DeepARCamera as DeepARCameraComponent,
} from '@/services/deeparService';

// ── Lazy-load expo-camera ────────────────────────────────────────────────────
let CameraView: any                 = null;
let useCameraPermissionsImpl: any   = null;
try {
  const ec = require('expo-camera');
  CameraView                = ec.CameraView           ?? null;
  useCameraPermissionsImpl  = ec.useCameraPermissions ?? null;
} catch { /* web / preview */ }

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

  const deepARActive  = isDeepARAvailable();
  const deepARCompOk  =
    deepARActive &&
    DeepARCameraComponent !== null &&
    typeof (DeepARCameraComponent as any) === 'function';

  const [facing,       setFacing]       = useState<'front' | 'back'>('front');
  const [deepARReady,  setDeepARReady]  = useState(false);
  const [isRecording,  setIsRecording]  = useState(false);
  const [recSeconds,   setRecSeconds]   = useState(0);

  const recTimerRef       = useRef<ReturnType<typeof setInterval>  | null>(null);
  const deepARTimeoutRef  = useRef<ReturnType<typeof setTimeout>   | null>(null);
  const screenshotCbRef   = useRef<((uri: string) => void) | null>(null);
  const videoCbRef        = useRef<((uri: string) => void) | null>(null);

  const [camPerm, requestCamPerm] = useSafeCameraPermissions();
  const hasPerm = camPerm?.granted ?? false;

  // ── Permissions + DeepAR init ───────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      if (deepARCompOk) {
        const ok = await requestDeepARPermissions();
        log.camera.info('DeepAR permissions', { granted: ok });
      } else {
        await requestCamPerm();
      }
    }
    init();
  }, []);

  // Safety timeout: mark DeepAR ready after 2 s even without init event
  useEffect(() => {
    if (!deepARCompOk) return;
    deepARTimeoutRef.current = setTimeout(() => {
      log.deepar.warn('Init timeout — forcing ready');
      setDeepARReady(true);
      prefetchDeepARFilters(['flower_crown', 'lion', 'aviators', 'beauty', 'fire']);
      onDeepARReady?.();
    }, 2000);
    return () => { if (deepARTimeoutRef.current) clearTimeout(deepARTimeoutRef.current); };
  }, [deepARCompOk]);

  // Cleanup on unmount
  useEffect(() => () => {
    if (recTimerRef.current)      clearInterval(recTimerRef.current);
    if (deepARTimeoutRef.current) clearTimeout(deepARTimeoutRef.current);
    try { if (isRecording && deepARRef.current) deepARRef.current.finishRecording(); } catch { /* ignore */ }
    try { if (isRecording && expoCamRef.current) expoCamRef.current.stopRecording(); } catch { /* ignore */ }
  }, []);

  // ── Imperative handle ───────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    isDeepAR:  deepARCompOk,
    isReady:   deepARCompOk ? deepARReady : hasPerm,
    deepARRef,

    takePhoto: () => new Promise<string | null>(resolve => {
      if (deepARCompOk && deepARReady && deepARRef.current) {
        screenshotCbRef.current = uri => { screenshotCbRef.current = null; resolve(uri); };
        const timeout = setTimeout(() => { screenshotCbRef.current = null; resolve(null); }, 5000);
        screenshotCbRef.current = uri => { clearTimeout(timeout); resolve(uri); };
        triggerDeepARScreenshot(deepARRef);
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
      if (deepARCompOk && deepARReady && deepARRef.current) {
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
      if (deepARCompOk && deepARReady && deepARRef.current) {
        videoCbRef.current = uri => { videoCbRef.current = null; resolve(uri); };
        const timeout = setTimeout(() => { videoCbRef.current = null; resolve(null); }, 8000);
        videoCbRef.current = uri => { clearTimeout(timeout); resolve(uri); };
        try { deepARRef.current.finishRecording(); } catch { resolve(null); }
        setTimeout(() => { setIsRecording(false); setRecSeconds(0); }, 3000);
      } else if (expoCamRef.current) {
        try { expoCamRef.current.stopRecording(); } catch { /* ignore */ }
        setIsRecording(false); setRecSeconds(0);
        resolve(null);
      } else {
        setIsRecording(false); setRecSeconds(0);
        resolve(null);
      }
    }),

    flipCamera: () => setFacing(f => f === 'front' ? 'back' : 'front'),
  }), [deepARCompOk, deepARReady, hasPerm, isRecording]);

  // ── DeepAR event handler ────────────────────────────────────────────────────
  const handleDeepAREvent = useCallback(({ nativeEvent }: any) => {
    log.deepar.native(nativeEvent.type, nativeEvent.value);
    switch (nativeEvent.type) {
      case 'initialized':
        if (deepARTimeoutRef.current) clearTimeout(deepARTimeoutRef.current);
        setDeepARReady(true);
        prefetchDeepARFilters(['flower_crown', 'lion', 'aviators', 'beauty', 'fire']);
        onDeepARReady?.();
        break;
      case 'screenshotTaken':
        if (screenshotCbRef.current) { screenshotCbRef.current(nativeEvent.value); }
        else { onScreenshot?.(nativeEvent.value); }
        break;
      case 'videoRecordingFinished':
        if (recTimerRef.current) clearInterval(recTimerRef.current);
        setIsRecording(false); setRecSeconds(0);
        if (videoCbRef.current) { videoCbRef.current(nativeEvent.value); }
        else if (nativeEvent.value) { onVideoReady?.(nativeEvent.value); }
        break;
      case 'error':
        if (deepARTimeoutRef.current) clearTimeout(deepARTimeoutRef.current);
        setDeepARReady(true);
        log.deepar.error('Native error', nativeEvent.value);
        onError?.(nativeEvent.value ?? 'DeepAR error');
        break;
    }
  }, [onDeepARReady, onScreenshot, onVideoReady, onError]);

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
      {/* Camera surface */}
      {deepARCompOk ? (
        <DeepARCameraComponent
          ref={deepARRef}
          apiKey={DEEPAR_API_KEY}
          style={StyleSheet.absoluteFillObject}
          position={facing}
          onEventSent={handleDeepAREvent}
          onInitialized={() => {
            if (deepARTimeoutRef.current) clearTimeout(deepARTimeoutRef.current);
            setDeepARReady(true);
            prefetchDeepARFilters(['flower_crown', 'lion', 'aviators', 'beauty', 'fire']);
            onDeepARReady?.();
          }}
          onScreenshotTaken={(path: string) => {
            if (screenshotCbRef.current) screenshotCbRef.current(path);
            else onScreenshot?.(path);
          }}
          onVideoRecordingFinished={(path: string) => {
            if (recTimerRef.current) clearInterval(recTimerRef.current);
            setIsRecording(false); setRecSeconds(0);
            if (videoCbRef.current) videoCbRef.current(path);
            else if (path) onVideoReady?.(path);
          }}
          onError={(text: string) => {
            if (deepARTimeoutRef.current) clearTimeout(deepARTimeoutRef.current);
            setDeepARReady(true);
            onError?.(text);
          }}
        />
      ) : CameraView ? (
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

      {/* DeepAR init spinner */}
      {deepARCompOk && !deepARReady ? (
        <View style={c.initOverlay} pointerEvents="none">
          <ActivityIndicator color="#fff" size="small" />
          <Text style={c.initText}>Iniciando DeepAR...</Text>
        </View>
      ) : null}

      {/* DeepAR live badge */}
      {deepARCompOk && deepARReady ? (
        <View style={c.liveBadge} pointerEvents="none">
          <LinearGradient colors={['#FF2D78', '#7C5CFF']} style={c.liveBadgeInner}>
            <PulsingDot color="#fff" />
            <Text style={c.liveBadgeText}>DeepAR LIVE</Text>
          </LinearGradient>
        </View>
      ) : null}

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
