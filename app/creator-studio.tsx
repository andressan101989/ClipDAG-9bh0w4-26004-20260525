/**
 * app/creator-studio.tsx — Creator Studio v14
 *
 * FIXES v14:
 * 1. expo-video lazy-loaded (was crashing on web/preview — static import removed)
 * 2. useVideoPlayer called with plain string URI (was passing {uri:string} object)
 * 3. Skia overlay uses explicit zIndex:5 wrapper so DeepAR render surface stays visible
 * 4. UI badges/buttons use zIndex:20 to stay above Skia overlay
 * 5. Avatar photo upload: iOS ph:// URIs read via expo-file-system (fetch() crashes on ph://)
 * 6. "Normal" chip added to clear all effects
 */
import React, {
  useState, useCallback, useRef, useEffect, useMemo,
} from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView, FlatList,
  TextInput, ActivityIndicator, Dimensions, Modal, Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming,
  withSequence, withRepeat, Easing,
} from 'react-native-reanimated';
import { useAlert } from '@/template';
import { useFeed } from '@/hooks/useFeed';
import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Colors, FontSize, FontWeight, Radius } from '@/constants/theme';

// ── expo-video — lazy-load: crashes on web/Expo Go without native build ───────
let VideoView: any = null;
let useVideoPlayer: any = (_src: any, _setup?: any): any => null;
try {
  const ev = require('expo-video');
  VideoView      = ev.VideoView      ?? null;
  useVideoPlayer = ev.useVideoPlayer ?? ((_src: any, _setup?: any) => null);
} catch { /* web / preview */ }

// ── expo-av Video — fallback when expo-video stub returns null ───────────────
let AVVideo: any     = null;
let AVResizeMode: any = null;
try {
  const avMod  = require('expo-av');
  AVVideo      = avMod.Video      ?? null;
  AVResizeMode = avMod.ResizeMode ?? null;
} catch { /* not compiled */ }

// ── DeepAR ────────────────────────────────────────────────────────────────────
import {
  isDeepARAvailable, DEEPAR_API_KEY, DEEPAR_FILTERS,
  switchDeepAREffect, clearDeepAREffect,
  prefetchDeepARFilters, getDeepARStatus,
  triggerDeepARScreenshot, startDeepARRecording,
  requestDeepARPermissions,
  DeepARCamera as DeepARCameraComponent,
  type DeepARFilter,
} from '@/services/deeparService';

// ── Isolated tab modules (new architecture) ──────────────────────────────────
// EffectsTab now lives in components/feature/studio/EffectsTab.tsx
// It will progressively replace the inline EffectsTab below as validation completes.
import { EffectsTab as EffectsTabIsolated } from '@/components/feature/studio';

// ── FFmpeg ────────────────────────────────────────────────────────────────────
import {
  isFFmpegAvailable, exportFinal,
} from '@/services/ffmpegService';

// ── Skia effects ──────────────────────────────────────────────────────────────
import SkiaEffectsLayer, { type SkiaEffectId } from '@/components/feature/SkiaEffectsLayer';

// ── expo-camera (fallback when DeepAR unavailable) ────────────────────────────
let CameraView: any = null;
let _useCameraPermissions: any = null;
try {
  const ec = require('expo-camera');
  CameraView            = ec.CameraView            ?? null;
  _useCameraPermissions = ec.useCameraPermissions  ?? null;
} catch { /* web */ }

function useSafeCameraPermissions(): [{ granted: boolean } | null, () => Promise<any>] {
  if (_useCameraPermissions) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return _useCameraPermissions();
  }
  return [{ granted: false }, async () => {}];
}

const { width: W } = Dimensions.get('window');

// ─────────────────────────────────────────────────────────────────────────────
// TABS
// ─────────────────────────────────────────────────────────────────────────────
type StudioTab = 'ar' | 'videos' | 'avatars' | 'music';

const TABS: { key: StudioTab; icon: string; label: string; color: string }[] = [
  { key: 'ar',      icon: 'magic-staff',          label: 'Efectos',  color: '#FF2D78' },
  { key: 'videos',  icon: 'video-outline',         label: 'Videos',   color: '#7C5CFF' },
  { key: 'avatars', icon: 'robot-excited-outline', label: 'Avatares', color: '#00E5A0' },
  { key: 'music',   icon: 'music-note-outline',    label: 'Música',   color: '#FF9D00' },
];

// ─────────────────────────────────────────────────────────────────────────────
// SKIA EFFECTS CATALOG  (id:'none' excluded — handled by "Normal" chip)
// ─────────────────────────────────────────────────────────────────────────────
interface EffectDef { id: SkiaEffectId; name: string; emoji: string; gradient: [string,string] }

const SKIA_EFFECTS: EffectDef[] = [
  { id: 'vintage',   name: 'Vintage',    emoji: '📷', gradient: ['#8B5E3C','#C27540'] },
  { id: 'cine',      name: 'Cine',       emoji: '🎬', gradient: ['#1A1A2E','#333355'] },
  { id: 'frio',      name: 'Frío',       emoji: '🧊', gradient: ['#2D9EFF','#7CC4FF'] },
  { id: 'calido',    name: 'Cálido',     emoji: '🌅', gradient: ['#FF9D00','#FF5A00'] },
  { id: 'bn',        name: 'B&N',        emoji: '⬛', gradient: ['#555','#999'] },
  { id: 'neon',      name: 'Neón',       emoji: '🌈', gradient: ['#FF2D78','#7C5CFF'] },
  { id: 'chromatic', name: 'Cromático',  emoji: '🔴', gradient: ['#FF0044','#00FFCC'] },
  { id: 'particles', name: 'Partículas', emoji: '✨', gradient: ['#FFD700','#FF9D00'] },
  { id: 'glitch',    name: 'Glitch',     emoji: '📺', gradient: ['#00FFFF','#FF00FF'] },
  { id: 'hearts',    name: 'Corazones',  emoji: '💕', gradient: ['#FF2D78','#FF6BA8'] },
  { id: 'rain',      name: 'Lluvia',     emoji: '🌧️', gradient: ['#2D9EFF','#0050AA'] },
  { id: 'glow',      name: 'Glow',       emoji: '💜', gradient: ['#7C5CFF','#A855F7'] },
];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
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

function fmtMs(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}
function fmtSec(s: number) {
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────
export default function CreatorStudioScreen() {
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const [tab, setTab] = useState<StudioTab>('ar');
  const tabAnim = useSharedValue(1);
  const tabSty  = useAnimatedStyle(() => ({ opacity: tabAnim.value }));

  const switchTab = useCallback((t: StudioTab) => {
    tabAnim.value = withTiming(0, { duration: 120 }, () => {
      tabAnim.value = withTiming(1, { duration: 180 });
    });
    setTab(t);
  }, []);

  const deepARActive = isDeepARAvailable();
  const deepARStatus = getDeepARStatus();
  const router2 = router; // alias for deepar-test link

  return (
    <View style={[root.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={root.header}>
        <Pressable style={root.backBtn} onPress={() => router.back()} hitSlop={10}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={Colors.textPrimary} />
        </Pressable>
        <View style={root.titleRow}>
          <Text style={root.title}>Creator Studio</Text>
          {deepARActive ? (
            <LinearGradient colors={['#FF2D78','#7C5CFF']} style={root.deepARBadge}>
              <Text style={root.deepARBadgeText}>DeepAR</Text>
            </LinearGradient>
          ) : null}
          <View style={[root.badge, { backgroundColor: '#00E5A022', borderColor: '#00E5A044' }]}>
            <Text style={[root.badgeText, { color: '#00E5A0' }]}>Skia</Text>
          </View>
          {isFFmpegAvailable() ? (
            <View style={root.badge}><Text style={root.badgeText}>FFmpeg</Text></View>
          ) : null}
        </View>
        <View style={{ width: 36 }} />
      </View>

      {!deepARStatus.ready ? (
        <View style={root.statusBar}>
          <MaterialCommunityIcons name="information-outline" size={12} color={Colors.warning} />
          <Text style={root.statusBarText}>
            Skia activo. DeepAR disponible en EAS Build.
          </Text>
          <Pressable onPress={() => router2.push('/deepar-test' as any)}>
            <Text style={[root.statusBarText, { color: '#2D9EFF', textDecorationLine: 'underline' }]}>Test</Text>
          </Pressable>
        </View>
      ) : (
        <View style={[root.statusBar, { backgroundColor: '#00E5A022', borderBottomColor: '#00E5A033' }]}>
          <MaterialCommunityIcons name="check-circle-outline" size={12} color="#00E5A0" />
          <Text style={[root.statusBarText, { color: '#00E5A0' }]}>
            DeepAR listo. {!deepARStatus.hasFetchBlob ? 'Instala rn-fetch-blob para filtros remotos.' : 'Filtros remotos activos.'}
          </Text>
          <Pressable onPress={() => router2.push('/deepar-test' as any)}>
            <Text style={[root.statusBarText, { color: '#2D9EFF', textDecorationLine: 'underline' }]}>Sandbox</Text>
          </Pressable>
        </View>
      )}

      <Animated.View style={[{ flex: 1 }, tabSty]}>
        {tab === 'ar'      ? <EffectsTabIsolated />  : null}
        {tab === 'videos'  ? <VideosTab />   : null}
        {tab === 'avatars' ? <AvatarsTab />  : null}
        {tab === 'music'   ? <MusicTab />    : null}
      </Animated.View>

      {/* Bottom tab bar */}
      <View style={[root.tabBar, { paddingBottom: insets.bottom + 4 }]}>
        {TABS.map(t => {
          const active = tab === t.key;
          return (
            <Pressable key={t.key} style={root.tabItem} onPress={() => switchTab(t.key)}>
              {active ? <LinearGradient colors={[t.color + '33', t.color + '11']} style={root.tabActiveGrad} /> : null}
              <MaterialCommunityIcons name={t.icon as any} size={22} color={active ? t.color : Colors.textSubtle} />
              <Text style={[root.tabLabel, active && { color: t.color, fontWeight: FontWeight.bold }]}>{t.label}</Text>
              {active ? <View style={[root.tabDot, { backgroundColor: t.color }]} /> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// TAB 1 — EFFECTS (Camera + Skia + DeepAR)
// ═════════════════════════════════════════════════════════════════════════════
function EffectsTab() {
  const { addVideo }  = useFeed();
  const { showAlert } = useAlert();
  const router        = useRouter();

  const deepARRef  = useRef<any>(null);
  const cameraRef  = useRef<any>(null);

  const deepARActive  = isDeepARAvailable();
  const deepARCameraOk =
    deepARActive &&
    DeepARCameraComponent !== null &&
    typeof (DeepARCameraComponent as any) === 'function';

  const [skiaEffectId,    setSkiaEffectId]    = useState<SkiaEffectId>('none');
  const [deepARFilterId,  setDeepARFilterId]  = useState<string | null>(null);
  const [camLayout,       setCamLayout]       = useState({ width: W, height: W * 1.25 });
  const [isCapturing,     setIsCapturing]     = useState(false);
  const [capturedUri,     setCapturedUri]     = useState<string | null>(null);
  const [mode,            setMode]            = useState<'camera' | 'preview'>('camera');
  const [isRecording,     setIsRecording]     = useState(false);
  const [recSeconds,      setRecSeconds]      = useState(0);
  const [facing,          setFacing]          = useState<'front' | 'back'>('front');
  const [deepARReady,     setDeepARReady]     = useState(false);
  const [filterLoadState, setFilterLoadState] = useState<Record<string, string>>({});

  const recTimerRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const deepARTimeoutRef  = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const captureTimeoutRef = useRef<ReturnType<typeof setTimeout>  | null>(null);

  const [camPerm, requestCamPerm] = useSafeCameraPermissions();
  const hasPerm = camPerm?.granted ?? false;

  useEffect(() => {
    async function initPerms() {
      if (deepARActive) await requestDeepARPermissions();
      await requestCamPerm();
    }
    initPerms();
  }, []);

  useEffect(() => () => {
    if (recTimerRef.current)       clearInterval(recTimerRef.current);
    if (deepARTimeoutRef.current)  clearTimeout(deepARTimeoutRef.current);
    if (captureTimeoutRef.current) clearTimeout(captureTimeoutRef.current);
  }, []);

  // Safety timeout: force deepARReady=true after 2s if onInitialized never fires
  useEffect(() => {
    if (!deepARCameraOk) return;
    deepARTimeoutRef.current = setTimeout(() => {
      setDeepARReady(true);
      prefetchDeepARFilters(['flower_crown', 'lion', 'aviators', 'beauty', 'fire']);
    }, 2000);
    return () => { if (deepARTimeoutRef.current) clearTimeout(deepARTimeoutRef.current); };
  }, [deepARCameraOk]);

  const shutterScale = useSharedValue(1);
  const shutterSty   = useAnimatedStyle(() => ({ transform: [{ scale: shutterScale.value }] }));

  // ── DeepAR filter select ──────────────────────────────────────────────────
  const handleDeepARFilter = useCallback(async (filter: DeepARFilter) => {
    if (deepARFilterId === filter.id) {
      clearDeepAREffect(deepARRef);
      setDeepARFilterId(null);
      setFilterLoadState(s => ({ ...s, [filter.id]: 'idle' }));
      return;
    }
    // Disable Skia when activating a DeepAR filter (Metal surface conflict)
    setSkiaEffectId('none');
    setDeepARFilterId(filter.id);
    await switchDeepAREffect(deepARRef, filter, (state, msg) => {
      setFilterLoadState(s => ({ ...s, [filter.id]: state }));
      if (state === 'error') {
        showAlert('Error de filtro', msg ?? 'No se pudo cargar el filtro');
        setDeepARFilterId(prev => prev === filter.id ? null : prev);
      }
    });
  }, [deepARFilterId, showAlert]);

  // ── Clear all effects ─────────────────────────────────────────────────────
  const clearAllEffects = useCallback(() => {
    setSkiaEffectId('none');
    if (deepARFilterId) { clearDeepAREffect(deepARRef); setDeepARFilterId(null); }
  }, [deepARFilterId]);

  // When a DeepAR filter is activated, disable Skia (they cannot share Metal surface)
  // This is enforced in handleDeepARFilter below.

  // ── PHOTO CAPTURE ─────────────────────────────────────────────────────────
  const capturePhoto = useCallback(async () => {
    if (isCapturing || isRecording) return;
    setIsCapturing(true);
    shutterScale.value = withSequence(withSpring(0.82), withSpring(1));

    if (deepARCameraOk && deepARReady && deepARRef.current) {
      captureTimeoutRef.current = setTimeout(async () => {
        console.warn('[Capture] DeepAR screenshot timeout — falling back');
        if (cameraRef.current) {
          try {
            const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
            setCapturedUri(photo.uri); setMode('preview');
          } catch { showAlert('Error', 'No se pudo tomar la foto.'); }
        } else { showAlert('Error', 'Cámara no disponible'); }
        setIsCapturing(false);
      }, 4000);
      try { triggerDeepARScreenshot(deepARRef); }
      catch { clearTimeout(captureTimeoutRef.current!); setIsCapturing(false); showAlert('Error', 'No se pudo capturar'); }
      return;
    }

    if (cameraRef.current) {
      try {
        const photo = await cameraRef.current.takePictureAsync({ quality: 0.9, skipProcessing: false });
        setCapturedUri(photo.uri); setMode('preview');
      } catch (e: any) { showAlert('Error de cámara', e?.message ?? 'No se pudo tomar la foto'); }
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { showAlert('Permiso requerido', 'Necesitamos acceso a la galería'); setIsCapturing(false); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [3,4], quality: 0.9 });
      if (!result.canceled && result.assets[0]) { setCapturedUri(result.assets[0].uri); setMode('preview'); }
    }
    setIsCapturing(false);
  }, [isCapturing, isRecording, deepARCameraOk, deepARReady, showAlert]);

  // ── VIDEO RECORDING ───────────────────────────────────────────────────────
  const toggleRecord = useCallback(async () => {
    if (isRecording) {
      if (recTimerRef.current) clearInterval(recTimerRef.current);
      if (deepARCameraOk && deepARReady && deepARRef.current) {
        try { deepARRef.current.finishRecording(); } catch (_) {}
        setTimeout(() => setIsRecording(false), 3000);
      } else if (cameraRef.current) {
        try { await cameraRef.current.stopRecording(); } catch (_) {}
        setIsRecording(false); setRecSeconds(0);
      } else { setIsRecording(false); setRecSeconds(0); }
    } else {
      if (!deepARCameraOk && !cameraRef.current) {
        showAlert('Sin cámara', 'La grabación requiere EAS Build nativo'); return;
      }
      setIsRecording(true); setRecSeconds(0);
      recTimerRef.current = setInterval(() => setRecSeconds(s => s + 1), 1000);
      if (deepARCameraOk && deepARReady && deepARRef.current) {
        startDeepARRecording(deepARRef);
      } else if (cameraRef.current) {
        try {
          const video = await cameraRef.current.recordAsync({ maxDuration: 60 });
          if (recTimerRef.current) clearInterval(recTimerRef.current);
          setIsRecording(false); setRecSeconds(0);
          if (video?.uri) { setCapturedUri(video.uri); setMode('preview'); }
        } catch (e: any) {
          if (recTimerRef.current) clearInterval(recTimerRef.current);
          setIsRecording(false); setRecSeconds(0);
          if (e?.message && !e.message.includes('stopped')) showAlert('Error de grabación', e.message);
        }
      }
    }
  }, [isRecording, deepARCameraOk, deepARReady, showAlert]);

  const saveToGallery = useCallback(async (uri: string) => {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status === 'granted') { await MediaLibrary.saveToLibraryAsync(uri); showAlert('Guardado', 'Guardado en tu galería'); }
    } catch { /* ignore */ }
  }, [showAlert]);

  const handlePublish = useCallback(async () => {
    if (!capturedUri) return;
    const activeFilter = deepARFilterId
      ? DEEPAR_FILTERS.find(f => f.id === deepARFilterId)
      : SKIA_EFFECTS.find(e => e.id === skiaEffectId);
    try {
      await addVideo({
        videoUrl: capturedUri, thumbnailUrl: capturedUri,
        caption: `${activeFilter ? `${(activeFilter as any).emoji} ${activeFilter.name} ` : ''}#ClipDAG #CreatorStudio`,
        music: 'Sin música', username: '', userAvatar: '',
      });
      showAlert('Publicado 🎉', 'Publicado al feed', [
        { text: 'Ver feed', onPress: () => router.replace('/(tabs)') },
      ]);
      setCapturedUri(null); setMode('camera');
    } catch (e: any) { showAlert('Error', e?.message || 'No se pudo publicar'); }
  }, [capturedUri, deepARFilterId, skiaEffectId, addVideo, showAlert, router]);

  // ── PREVIEW mode ──────────────────────────────────────────────────────────
  if (mode === 'preview' && capturedUri) {
    const activeFilter = deepARFilterId
      ? DEEPAR_FILTERS.find(f => f.id === deepARFilterId)
      : SKIA_EFFECTS.find(e => e.id === skiaEffectId);
    return (
      <ScrollView showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 16 }}>
        <View style={[ef.previewWrap, { width: W - 32, height: (W - 32) * 1.2 }]}>
          <Image source={{ uri: capturedUri }} style={StyleSheet.absoluteFillObject} contentFit="cover" transition={200} />
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.5)']} style={ef.previewGrad} />
          {activeFilter ? (
            <View style={ef.previewBadge}>
              <Text style={ef.previewBadgeText}>{(activeFilter as any).emoji} {activeFilter.name}</Text>
            </View>
          ) : null}
        </View>
        <View style={ef.actionRow}>
          <Pressable style={ef.retakeBtn} onPress={() => { setCapturedUri(null); setMode('camera'); }}>
            <MaterialCommunityIcons name="camera-retake" size={18} color={Colors.textSecondary} />
            <Text style={ef.retakeBtnText}>Volver</Text>
          </Pressable>
          <Pressable style={ef.saveBtn} onPress={() => saveToGallery(capturedUri)}>
            <MaterialCommunityIcons name="download" size={18} color={Colors.textSecondary} />
            <Text style={ef.retakeBtnText}>Guardar</Text>
          </Pressable>
          <Pressable style={ef.publishBtn} onPress={handlePublish}>
            <LinearGradient colors={['#FF2D78','#7C5CFF']} style={ef.publishBtnGrad}>
              <MaterialCommunityIcons name="send" size={18} color="#fff" />
              <Text style={ef.publishBtnText}>Publicar</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  const camH = W * 1.22;

  if (!CameraView && !DeepARCameraComponent) {
    return (
      <View style={ef.noPerm}>
        <MaterialCommunityIcons name="cellphone-off" size={52} color={Colors.warning} />
        <Text style={ef.noPermTitle}>Requiere dispositivo físico</Text>
        <Text style={ef.noPermSub}>La cámara solo funciona en iPhone/Android con EAS Build o TestFlight</Text>
        <Pressable style={ef.permBtn} onPress={async () => {
          const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!p.granted) return;
          const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [3,4], quality: 0.9 });
          if (!r.canceled && r.assets[0]) { setCapturedUri(r.assets[0].uri); setMode('preview'); }
        }}>
          <LinearGradient colors={['#7C5CFF','#FF2D78']} style={ef.permBtnInner}>
            <Text style={ef.permBtnText}>Abrir galería</Text>
          </LinearGradient>
        </Pressable>
      </View>
    );
  }

  if (!hasPerm && !deepARCameraOk) {
    return (
      <View style={ef.noPerm}>
        <MaterialIcons name="no-photography" size={52} color={Colors.textSubtle} />
        <Text style={ef.noPermTitle}>Permiso de cámara requerido</Text>
        <Text style={ef.noPermSub}>Necesitamos acceso a tu cámara para los efectos AR</Text>
        <Pressable style={ef.permBtn} onPress={requestCamPerm}>
          <LinearGradient colors={['#7C5CFF','#FF2D78']} style={ef.permBtnInner}>
            <Text style={ef.permBtnText}>Conceder permiso</Text>
          </LinearGradient>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* ── Camera viewport ─────────────────────────────────────────────── */}
      <View
        style={[ef.cameraWrap, { height: camH }]}
        onLayout={e => setCamLayout({
          width: e.nativeEvent.layout.width,
          height: e.nativeEvent.layout.height,
        })}
      >
        {/* DeepAR Camera — zIndex 0 (base layer) */}
        {deepARCameraOk ? (
          <DeepARCameraComponent
            ref={deepARRef}
            apiKey={DEEPAR_API_KEY}
            style={StyleSheet.absoluteFillObject}
            position={facing}
            onEventSent={({ nativeEvent }: any) => {
              console.log('[DeepAR] event:', nativeEvent.type);
              if (nativeEvent.type === 'initialized') {
                if (deepARTimeoutRef.current) clearTimeout(deepARTimeoutRef.current);
                setDeepARReady(true);
                prefetchDeepARFilters(['flower_crown', 'lion', 'aviators', 'beauty', 'fire']);
              }
              if (nativeEvent.type === 'screenshotTaken') {
                if (captureTimeoutRef.current) clearTimeout(captureTimeoutRef.current);
                setCapturedUri(nativeEvent.value);
                setMode('preview');
                setIsCapturing(false);
              }
              if (nativeEvent.type === 'videoRecordingFinished') {
                if (recTimerRef.current) clearInterval(recTimerRef.current);
                setIsRecording(false); setRecSeconds(0);
                if (nativeEvent.value) { setCapturedUri(nativeEvent.value); setMode('preview'); }
              }
              if (nativeEvent.type === 'error') {
                console.error('[DeepAR] error:', nativeEvent.value);
                if (deepARTimeoutRef.current) clearTimeout(deepARTimeoutRef.current);
                setDeepARReady(true);
              }
            }}
            onInitialized={() => {
              if (deepARTimeoutRef.current) clearTimeout(deepARTimeoutRef.current);
              setDeepARReady(true);
              prefetchDeepARFilters(['flower_crown', 'lion', 'aviators', 'beauty', 'fire']);
            }}
            onScreenshotTaken={(path: string) => {
              if (captureTimeoutRef.current) clearTimeout(captureTimeoutRef.current);
              setCapturedUri(path); setMode('preview'); setIsCapturing(false);
            }}
            onVideoRecordingFinished={(path: string) => {
              if (recTimerRef.current) clearInterval(recTimerRef.current);
              setIsRecording(false); setRecSeconds(0);
              if (path) { setCapturedUri(path); setMode('preview'); }
            }}
            onError={(text: string) => {
              console.error('[DeepAR] Error:', text);
              if (deepARTimeoutRef.current) clearTimeout(deepARTimeoutRef.current);
              setDeepARReady(true);
            }}
          />
        ) : CameraView ? (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFillObject}
            facing={facing}
            mode="video"
          />
        ) : null}

        {/*
          Skia overlay — ONLY shown when DeepAR is NOT active.
          DeepAR uses a Metal/CAEAGLLayer render surface. Placing any GPU-
          composited View (Skia Canvas, etc.) on top of it destroys the Metal
          pipeline → black camera. UIKit-backed Views (badges, buttons) are
          safe because they don't composite on the same GPU surface.
          Rule: deepARCameraOk active → no Skia. Skia active → no DeepAR.
        */}
        {skiaEffectId !== 'none' && !deepARCameraOk ? (
          <View
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 5 }}
            pointerEvents="none"
          >
            <SkiaEffectsLayer
              effectId={skiaEffectId}
              width={camLayout.width}
              height={camLayout.height}
            />
          </View>
        ) : null}

        {/* UI controls — zIndex 20: always on top */}
        {isRecording ? (
          <View style={[ef.recIndicator, { zIndex: 20 }]}>
            <PulsingDot color="#FF3B3B" />
            <Text style={ef.recText}>REC {fmtSec(recSeconds)}</Text>
          </View>
        ) : null}

        {deepARCameraOk && !deepARReady ? (
          <View style={[ef.deepARLoading, { zIndex: 20 }]}>
            <ActivityIndicator color="#fff" size="small" />
            <Text style={ef.deepARLoadingText}>Iniciando DeepAR...</Text>
          </View>
        ) : null}

        {deepARFilterId ? (
          <View style={[ef.effectBadge, { zIndex: 20 }]}>
            <Text style={ef.effectBadgeText}>
              {DEEPAR_FILTERS.find(f => f.id === deepARFilterId)?.emoji}{' '}
              {DEEPAR_FILTERS.find(f => f.id === deepARFilterId)?.name}
            </Text>
          </View>
        ) : skiaEffectId !== 'none' ? (
          <View style={[ef.effectBadge, { zIndex: 20 }]}>
            <Text style={ef.effectBadgeText}>
              {SKIA_EFFECTS.find(e => e.id === skiaEffectId)?.emoji}{' '}
              {SKIA_EFFECTS.find(e => e.id === skiaEffectId)?.name}
            </Text>
          </View>
        ) : null}

        {deepARCameraOk && deepARReady ? (
          <View style={[ef.deepARLiveBadge, { zIndex: 20 }]}>
            <LinearGradient colors={['#FF2D78','#7C5CFF']} style={ef.deepARLiveBadgeInner}>
              <PulsingDot color="#fff" />
              <Text style={ef.deepARLiveBadgeText}>DeepAR LIVE</Text>
            </LinearGradient>
          </View>
        ) : null}

        <Pressable style={[ef.flipBtn, { zIndex: 20 }]} onPress={() => setFacing(f => f === 'front' ? 'back' : 'front')}>
          <MaterialCommunityIcons name="camera-flip-outline" size={22} color="#fff" />
        </Pressable>
      </View>

      {/* ── Effects selector ────────────────────────────────────────────── */}
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        style={ef.filterScrollWrap}
        contentContainerStyle={ef.filterStrip}
      >
        {/* Normal chip — clears all effects */}
        <Pressable
          style={[ef.chip, (skiaEffectId === 'none' && !deepARFilterId) && ef.chipActive]}
          onPress={clearAllEffects}
        >
          <View style={[ef.chipGrad, { backgroundColor: '#1A1A2E', borderRadius: 21 }]} />
          <Text style={ef.chipEmoji}>📷</Text>
          <Text style={[ef.chipName, (skiaEffectId === 'none' && !deepARFilterId) && { color: '#fff' }]}>Normal</Text>
          {(skiaEffectId === 'none' && !deepARFilterId) ? <View style={ef.chipDot} /> : null}
        </Pressable>

        <Text style={ef.sectionLabel}>SKIA GPU{deepARCameraOk ? ' (desactiva DeepAR)' : ''}</Text>
        {SKIA_EFFECTS.map(e => (
          <Pressable
            key={e.id}
            style={[ef.chip, skiaEffectId === e.id && ef.chipActive]}
            onPress={() => {
              // Skia and DeepAR cannot run simultaneously (Metal surface conflict)
              if (deepARCameraOk && deepARFilterId) {
                clearDeepAREffect(deepARRef);
                setDeepARFilterId(null);
              }
              setSkiaEffectId(e.id);
            }}
          >
            <LinearGradient colors={e.gradient} style={ef.chipGrad} />
            <Text style={ef.chipEmoji}>{e.emoji}</Text>
            <Text style={[ef.chipName, skiaEffectId === e.id && { color: '#fff' }]}>{e.name}</Text>
            {skiaEffectId === e.id ? <View style={ef.chipDot} /> : null}
          </Pressable>
        ))}

        {deepARCameraOk ? (
          <>
            <View style={ef.divider} />
            <Text style={ef.sectionLabel}>DEEPAR AR</Text>
            {DEEPAR_FILTERS.map(f => {
              const loadState = filterLoadState[f.id] ?? 'idle';
              const isActive  = deepARFilterId === f.id;
              const isLoading = loadState === 'downloading' || loadState === 'applying';
              return (
                <Pressable
                  key={f.id}
                  style={[ef.chip, isActive && ef.chipDeepARActive]}
                  onPress={() => handleDeepARFilter(f)}
                  disabled={isLoading}
                >
                  <LinearGradient colors={['#FF2D7844','#7C5CFF44']} style={ef.chipGrad} />
                  {isLoading
                    ? <ActivityIndicator size="small" color="#FF2D78" style={{ position: 'absolute', top: 12 }} />
                    : <Text style={ef.chipEmoji}>{f.emoji}</Text>
                  }
                  <Text style={[ef.chipName, isActive && { color: '#FF2D78' }]}>{f.name}</Text>
                  {isLoading ? <Text style={[ef.chipDownloadLabel, { color: '#FF2D78' }]}>↓</Text> : null}
                  {isActive && !isLoading ? <View style={[ef.chipDot, { backgroundColor: '#FF2D78' }]} /> : null}
                </Pressable>
              );
            })}
          </>
        ) : null}
      </ScrollView>

      {/* ── Capture controls ────────────────────────────────────────────── */}
      <View style={ef.captureRow}>
        <Pressable style={[ef.recordBtn, isRecording && ef.recordBtnActive]} onPress={toggleRecord}>
          <LinearGradient
            colors={isRecording ? ['#FF3B3B','#CC1A1A'] : ['#333','#222']}
            style={ef.recordBtnInner}
          >
            <MaterialCommunityIcons name={isRecording ? 'stop' : 'video-outline'} size={22} color="#fff" />
          </LinearGradient>
        </Pressable>

        <Animated.View style={shutterSty}>
          <Pressable
            style={ef.shutterOuter}
            onPress={capturePhoto}
            disabled={isCapturing || isRecording}
          >
            <LinearGradient colors={['#FF2D78','#7C5CFF']} style={ef.shutterInner}>
              {isCapturing
                ? <ActivityIndicator color="#fff" size="small" />
                : <MaterialCommunityIcons name="camera" size={32} color="#fff" />
              }
            </LinearGradient>
          </Pressable>
        </Animated.View>

        <Pressable style={ef.recordBtn} onPress={async () => {
          const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!p.granted) return;
          const r = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.All,
            allowsEditing: true, aspect: [3,4], quality: 0.9,
          });
          if (!r.canceled && r.assets[0]) { setCapturedUri(r.assets[0].uri); setMode('preview'); }
        }}>
          <LinearGradient colors={['#333','#222']} style={ef.recordBtnInner}>
            <MaterialCommunityIcons name="image-outline" size={22} color="#fff" />
          </LinearGradient>
        </Pressable>
      </View>
    </View>
  );
}

const ef = StyleSheet.create({
  noPerm:              { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32 },
  noPermTitle:         { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold, textAlign: 'center' },
  noPermSub:           { color: Colors.textSubtle, fontSize: FontSize.sm, textAlign: 'center', lineHeight: 20 },
  permBtn:             { borderRadius: Radius.lg, overflow: 'hidden', marginTop: 8 },
  permBtnInner:        { paddingHorizontal: 28, paddingVertical: 14 },
  permBtnText:         { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
  cameraWrap:          { width: W, backgroundColor: '#000', position: 'relative', overflow: 'hidden' },
  recIndicator:        { position: 'absolute', top: 14, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(200,0,0,0.75)', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6 },
  recText:             { color: '#fff', fontSize: 13, fontWeight: FontWeight.bold },
  deepARLoading:       { position: 'absolute', top: 14, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8 },
  deepARLoadingText:   { color: '#fff', fontSize: 12 },
  effectBadge:         { position: 'absolute', top: 14, left: 12, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 },
  effectBadgeText:     { color: '#fff', fontSize: 12, fontWeight: FontWeight.semibold },
  deepARLiveBadge:     { position: 'absolute', bottom: 12, right: 12, borderRadius: 10, overflow: 'hidden' },
  deepARLiveBadgeInner:{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5 },
  deepARLiveBadgeText: { color: '#fff', fontSize: 10, fontWeight: FontWeight.bold },
  flipBtn:             { position: 'absolute', top: 14, right: 12, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  filterScrollWrap:    { backgroundColor: Colors.bg, maxHeight: 88 },
  filterStrip:         { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 10, alignItems: 'center' },
  sectionLabel:        { color: Colors.textSubtle, fontSize: 8, fontWeight: FontWeight.bold, letterSpacing: 1.2, textTransform: 'uppercase', alignSelf: 'center', paddingHorizontal: 4 },
  divider:             { width: 1, height: 44, backgroundColor: Colors.border, marginHorizontal: 4, alignSelf: 'center' },
  chip:                { alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 6, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.border, minWidth: 62, position: 'relative' },
  chipActive:          { borderColor: Colors.secondary, backgroundColor: Colors.secondaryDim },
  chipDeepARActive:    { borderColor: '#FF2D78', backgroundColor: '#FF2D7822' },
  chipGrad:            { width: 42, height: 42, borderRadius: 21 },
  chipEmoji:           { position: 'absolute', top: 14, fontSize: 18 },
  chipName:            { color: Colors.textSubtle, fontSize: 9, fontWeight: FontWeight.medium },
  chipDot:             { width: 5, height: 5, borderRadius: 3, backgroundColor: Colors.secondary, position: 'absolute', top: 4, right: 4 },
  chipDownloadLabel:   { position: 'absolute', top: 3, right: 3, fontSize: 8, fontWeight: FontWeight.bold },
  captureRow:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingVertical: 10, backgroundColor: Colors.bg, paddingHorizontal: 16 },
  shutterOuter:        { width: 74, height: 74, borderRadius: 37, borderWidth: 3, borderColor: Colors.secondary + '66', alignItems: 'center', justifyContent: 'center' },
  shutterInner:        { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  recordBtn:           { width: 54, height: 54, borderRadius: 27, overflow: 'hidden' },
  recordBtnActive:     {},
  recordBtnInner:      { width: 54, height: 54, alignItems: 'center', justifyContent: 'center' },
  previewWrap:         { borderRadius: Radius.xl, overflow: 'hidden', position: 'relative', alignSelf: 'center' },
  previewGrad:         { position: 'absolute', bottom: 0, left: 0, right: 0, height: 80 },
  previewBadge:        { position: 'absolute', bottom: 12, left: 12, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  previewBadgeText:    { color: '#fff', fontSize: 12, fontWeight: FontWeight.semibold },
  actionRow:           { flexDirection: 'row', gap: 10 },
  retakeBtn:           { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: Radius.lg, backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border },
  saveBtn:             { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: Radius.lg, backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border },
  retakeBtnText:       { color: Colors.textSecondary, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  publishBtn:          { flex: 2, borderRadius: Radius.lg, overflow: 'hidden' },
  publishBtnGrad:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  publishBtnText:      { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
});

// ═════════════════════════════════════════════════════════════════════════════
// VIDEO PLAYER COMPONENT — expo-video primary, expo-av fallback
//
// Rendering strategy:
//  1. expo-video (VideoView + useVideoPlayer) — preferred, hardware accelerated
//  2. expo-av  (Video) — fallback when expo-video stub returns null
//  3. Static placeholder — no native build available
//
// Parent interface (playerRef.current):
//  .play()   .pause()   .currentTime (seconds)   .duration   .playing
// ═════════════════════════════════════════════════════════════════════════════
function ClipVideoPlayer({ uri, volume, rate, onDuration, onPosition, onPlayingChange, playerRef }: {
  uri: string; volume: number; rate: number;
  onDuration: (ms: number) => void;
  onPosition: (ms: number) => void;
  onPlayingChange: (p: boolean) => void;
  playerRef: React.MutableRefObject<any>;
}) {
  const avRef = React.useRef<any>(null);

  // ── expo-video path ────────────────────────────────────────────────────────
  // useVideoPlayer is always called (hooks rules) — stub returns null
  const player = useVideoPlayer(uri, (p: any) => {
    if (!p) return;
    try { p.volume = volume; p.playbackRate = rate; p.loop = false; } catch (_) {}
  });

  // Expose expo-video player via ref
  React.useEffect(() => {
    if (player) playerRef.current = player;
  }, [player]);

  React.useEffect(() => { try { if (player) player.volume = volume; } catch (_) {} }, [volume, player]);
  React.useEffect(() => { try { if (player) player.playbackRate = rate; } catch (_) {} }, [rate, player]);

  // Poll expo-video status
  React.useEffect(() => {
    if (!player) return;
    const iv = setInterval(() => {
      try {
        if (!player) return;
        onPosition(((player as any).currentTime ?? 0) * 1000);
        const dur = (player as any).duration ?? 0;
        if (dur > 0) onDuration(dur * 1000);
        onPlayingChange((player as any).playing ?? false);
      } catch (_) {}
    }, 250);
    return () => clearInterval(iv);
  }, [player]);

  // ── Render: expo-video ─────────────────────────────────────────────────────
  if (VideoView && player) {
    return <VideoView player={player} style={vid.player} contentFit="cover" nativeControls={false} />;
  }

  // ── Render: expo-av fallback ───────────────────────────────────────────────
  if (AVVideo) {
    return (
      <AVVideo
        ref={avRef}
        source={{ uri }}
        style={vid.player}
        resizeMode={AVResizeMode?.COVER ?? 'cover'}
        shouldPlay={false}
        isLooping={false}
        volume={volume}
        rate={rate}
        progressUpdateIntervalMillis={250}
        onLoad={(status: any) => {
          if (status?.durationMillis) onDuration(status.durationMillis);
          // Expose expo-av adapter as playerRef so parent .play()/.pause() work
          playerRef.current = {
            play:    () => avRef.current?.playAsync?.(),
            pause:   () => avRef.current?.pauseAsync?.(),
            get currentTime() {
              // read via latest status — best-effort
              return 0;
            },
            set volume(v: number) { avRef.current?.setVolumeAsync?.(v); },
            set playbackRate(r: number) { avRef.current?.setRateAsync?.(r, true); },
          };
        }}
        onPlaybackStatusUpdate={(status: any) => {
          if (!status?.isLoaded) return;
          onPosition(status.positionMillis ?? 0);
          if (status.durationMillis) onDuration(status.durationMillis);
          onPlayingChange(status.isPlaying ?? false);
          // Keep playerRef current so parent seekTo works
          if (avRef.current && playerRef.current) {
            (playerRef.current as any)._avRef = avRef.current;
          }
        }}
      />
    );
  }

  // ── Render: no native player available ────────────────────────────────────
  return (
    <View style={[vid.player, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#0A0A14' }]}>
      <MaterialCommunityIcons name="video-outline" size={32} color="#333" />
      <Text style={{ color: '#555', fontSize: 11, marginTop: 6 }}>Video player</Text>
      <Text style={{ color: '#444', fontSize: 9, marginTop: 2 }}>Requiere EAS Build nativo</Text>
    </View>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// TAB 2 — VIDEOS
// ═════════════════════════════════════════════════════════════════════════════
const SPEED_PRESETS = [
  { label: '0.5×', value: 0.5 }, { label: '1×', value: 1.0 },
  { label: '2×', value: 2.0 },  { label: '4×', value: 4.0 },
];

type ColorFilterName = 'vintage' | 'cine' | 'frio' | 'calido' | 'bn' | 'neon' | 'none';
const VIDEO_COLOR_FILTERS: { id: ColorFilterName; name: string; emoji: string; gradient: [string,string] }[] = [
  { id: 'none',    name: 'Original', emoji: '🎬', gradient: ['#333','#222'] },
  { id: 'vintage', name: 'Vintage',  emoji: '📷', gradient: ['#8B5E3C','#C27540'] },
  { id: 'cine',    name: 'Cine',     emoji: '🎞️', gradient: ['#1A1A2E','#333355'] },
  { id: 'frio',    name: 'Frío',     emoji: '🧊', gradient: ['#2D9EFF','#7CC4FF'] },
  { id: 'calido',  name: 'Cálido',   emoji: '🌅', gradient: ['#FF9D00','#FF5A00'] },
  { id: 'bn',      name: 'B&N',      emoji: '⬛', gradient: ['#555','#999'] },
  { id: 'neon',    name: 'Neón',     emoji: '🌈', gradient: ['#FF2D78','#7C5CFF'] },
];

interface Clip { id: string; uri: string; durationMs: number }
interface DeezerArtist { name: string }
interface DeezerAlbum  { cover_medium: string; title: string }
interface DeezerTrack  { id: number; title: string; preview: string; duration: number; artist: DeezerArtist; album: DeezerAlbum }

const DEEZER_CATS = [
  { id: 'pop',        q: 'top pop 2025',        label: 'Pop',        emoji: '🎤' },
  { id: 'reggaeton',  q: 'reggaeton hits',       label: 'Reggaetón',  emoji: '🔥' },
  { id: 'hiphop',     q: 'hip hop rap',          label: 'Hip Hop',    emoji: '🎧' },
  { id: 'electronic', q: 'electronic edm',       label: 'Electrónica',emoji: '⚡' },
  { id: 'lofi',       q: 'lofi chill beats',     label: 'Lo-Fi',      emoji: '☕' },
  { id: 'latin',      q: 'latin hits',           label: 'Latino',     emoji: '🌶️' },
  { id: 'viral',      q: 'trending viral 2025',  label: 'Viral',      emoji: '📈' },
];

function VideosTab() {
  const { addVideo }  = useFeed();
  const { showAlert } = useAlert();
  const router        = useRouter();
  const playerRef     = useRef<any>(null);
  const soundRef      = useRef<Audio.Sound | null>(null);

  const [clips,          setClips]          = useState<Clip[]>([]);
  const [activeClipIdx,  setActiveClipIdx]  = useState(0);
  const [isPlaying,      setIsPlaying]      = useState(false);
  const [speed,          setSpeed]          = useState(1.0);
  const [trimStart,      setTrimStart]      = useState(0.0);
  const [trimEnd,        setTrimEnd]        = useState(1.0);
  const [durationMs,     setDurationMs]     = useState(0);
  const [positionMs,     setPositionMs]     = useState(0);
  const [selectedTrack,  setSelectedTrack]  = useState<DeezerTrack | null>(null);
  const [videoVol,       setVideoVol]       = useState(0.8);
  const [musicVol,       setMusicVol]       = useState(0.6);
  const [caption,        setCaption]        = useState('');
  const [captionModal,   setCaptionModal]   = useState(false);
  const [isPublishing,   setIsPublishing]   = useState(false);
  const [musicModal,     setMusicModal]     = useState(false);
  const [colorFilter,    setColorFilter]    = useState<ColorFilterName>('none');
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const [isExporting,    setIsExporting]    = useState(false);

  const skiaPreviewId = colorFilter !== 'none' ? colorFilter as SkiaEffectId : 'none';

  useEffect(() => () => { soundRef.current?.unloadAsync().catch(() => {}); }, []);

  const pickClip = useCallback(async () => {
    if (clips.length >= 5) { showAlert('Máximo 5 clips', 'Elimina uno para agregar otro'); return; }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { showAlert('Permiso requerido', 'Necesitamos acceso a tu galería'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Videos, quality: 1 });
    if (!res.canceled && res.assets[0]) {
      const clip: Clip = {
        id: `c_${Date.now()}`, uri: res.assets[0].uri,
        durationMs: (res.assets[0].duration ?? 30) * 1000,
      };
      setClips(prev => [...prev, clip]);
      setActiveClipIdx(clips.length);
      setTrimStart(0); setTrimEnd(1);
    }
  }, [clips.length, showAlert]);

  const removeClip = useCallback((id: string) => {
    setClips(prev => {
      const n = prev.filter(c => c.id !== id);
      setActiveClipIdx(i => Math.min(i, Math.max(0, n.length - 1)));
      return n;
    });
  }, []);

  const activeClip = clips[activeClipIdx];

  const togglePlay = useCallback(() => {
    const p = playerRef.current; if (!p) return;
    try {
      if (isPlaying) {
        // expo-video  
        if (typeof p.pause === 'function') p.pause();
        setIsPlaying(false);
      } else {
        // expo-video
        if (typeof p.play === 'function') p.play();
        setIsPlaying(true);
      }
    } catch (_) {}
  }, [isPlaying]);

  const seekTo = useCallback((fraction: number) => {
    if (!playerRef.current || durationMs <= 0) return;
    const targetSec = (fraction * durationMs) / 1000;
    try {
      // expo-video interface
      if (typeof playerRef.current.currentTime !== 'undefined') {
        playerRef.current.currentTime = targetSec;
        return;
      }
      // expo-av adapter
      const avRef = playerRef.current._avRef ?? null;
      if (avRef?.setPositionAsync) {
        avRef.setPositionAsync(targetSec * 1000);
        return;
      }
    } catch (_) {}
  }, [durationMs]);

  const handleSetSpeed = useCallback((v: number) => {
    setSpeed(v);
    try { if (playerRef.current) playerRef.current.playbackRate = v; } catch (_) {}
  }, []);

  const handleExportAndPublish = useCallback(async () => {
    if (!activeClip) return;
    setIsPublishing(true); setIsExporting(true); setExportProgress('Preparando...');
    try {
      const result = await exportFinal({
        clips: clips.map(c => ({
          uri: c.uri,
          trimStart:  c.id === activeClip.id ? trimStart : 0,
          trimEnd:    c.id === activeClip.id ? trimEnd   : 1,
          durationMs: c.durationMs,
        })),
        speed, colorFilter, musicUri: selectedTrack?.preview,
        musicVol, videoVol,
        onProgress: (step, pct) => setExportProgress(`${step} (${pct}%)`),
      });
      setExportProgress('Publicando...');
      const finalUri = result.uri || activeClip.uri;
      await addVideo({
        videoUrl: finalUri, thumbnailUrl: '',
        caption: caption.trim() || `🎬 ${colorFilter !== 'none' ? `#${colorFilter} ` : ''}${speed !== 1 ? `${speed}× ` : ''}#ClipDAG`,
        music: selectedTrack ? `${selectedTrack.title} — ${selectedTrack.artist.name}` : 'Sin música',
        username: '', userAvatar: '',
      });
      showAlert('Publicado 🎉', isFFmpegAvailable() ? 'Video exportado con FFmpeg y publicado' : 'Clip publicado al feed', [
        { text: 'Ver feed', onPress: () => router.replace('/(tabs)') },
      ]);
      setCaptionModal(false);
    } catch (e: any) { showAlert('Error', e?.message || 'No se pudo publicar'); }
    finally { setIsPublishing(false); setIsExporting(false); setExportProgress(null); }
  }, [activeClip, clips, trimStart, trimEnd, speed, colorFilter, selectedTrack, musicVol, videoVol, caption, addVideo, showAlert, router]);

  const TRACK_W    = W - 32;
  const trimDurSec = durationMs > 0 ? Math.round((trimEnd - trimStart) * durationMs / 1000) : 0;

  if (clips.length === 0) {
    return (
      <View style={vid.empty}>
        <LinearGradient colors={['#1A1228','#0E0E18']} style={StyleSheet.absoluteFillObject} />
        <MaterialCommunityIcons name="video-plus-outline" size={60} color={Colors.primary} />
        <Text style={vid.emptyTitle}>Importa un video de tu galería</Text>
        <Text style={vid.emptySub}>Aplica filtros, cambia velocidad, añade música y publica</Text>
        {isFFmpegAvailable() ? (
          <View style={vid.ffmpegBadge}>
            <MaterialCommunityIcons name="check-circle" size={14} color="#00E5A0" />
            <Text style={vid.ffmpegBadgeText}>FFmpeg activo — edición real</Text>
          </View>
        ) : (
          <View style={vid.ffmpegBadge}>
            <MaterialCommunityIcons name="information" size={14} color={Colors.warning} />
            <Text style={[vid.ffmpegBadgeText, { color: Colors.warning }]}>
              Tip: El video se publica tal cual (FFmpeg en EAS Build nativo)
            </Text>
          </View>
        )}
        <Pressable style={vid.emptyBtn} onPress={pickClip}>
          <LinearGradient colors={['#7C5CFF','#FF2D78']} style={vid.emptyBtnInner}>
            <MaterialCommunityIcons name="folder-open-outline" size={22} color="#fff" />
            <Text style={vid.emptyBtnText}>Seleccionar video</Text>
          </LinearGradient>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
      {/* Clip rail */}
      <View style={vid.clipRail}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ flexDirection: 'row', gap: 8, padding: 12, alignItems: 'center' }}>
          {clips.map((clip, i) => (
            <Pressable key={clip.id}
              style={[vid.clipThumb, activeClipIdx === i && vid.clipThumbActive]}
              onPress={() => setActiveClipIdx(i)}>
              <Text style={vid.clipThumbNum}>{i + 1}</Text>
              <Text style={vid.clipThumbDur}>{Math.round(clip.durationMs / 1000)}s</Text>
              {activeClipIdx === i ? <LinearGradient colors={['#7C5CFF44','transparent']} style={StyleSheet.absoluteFillObject} /> : null}
              <Pressable style={vid.clipRemove} onPress={() => removeClip(clip.id)}>
                <MaterialIcons name="close" size={12} color="#fff" />
              </Pressable>
            </Pressable>
          ))}
          {clips.length < 5 ? (
            <Pressable style={vid.clipAdd} onPress={pickClip}>
              <MaterialCommunityIcons name="plus" size={22} color={Colors.primary} />
              <Text style={vid.clipAddText}>Añadir</Text>
            </Pressable>
          ) : null}
        </ScrollView>
        <Text style={vid.clipCount}>{clips.length}/5 clips</Text>
      </View>

      {/* Video player */}
      {activeClip ? (
        <View style={vid.playerWrap}>
          <ClipVideoPlayer
            key={activeClip.id} uri={activeClip.uri} volume={videoVol} rate={speed}
            onDuration={setDurationMs} onPosition={setPositionMs} onPlayingChange={setIsPlaying}
            playerRef={playerRef}
          />
          {/* Video editor Skia overlay — safe here because no DeepAR surface in video editor */}
          {skiaPreviewId !== 'none' ? (
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 5 }} pointerEvents="none">
              <SkiaEffectsLayer effectId={skiaPreviewId} width={W} height={W * 0.62} />
            </View>
          ) : null}
          <Pressable style={[vid.playOverlay, { zIndex: 10 }]} onPress={togglePlay}>
            {!isPlaying
              ? <View style={vid.playBtn}><MaterialIcons name="play-arrow" size={42} color="#fff" /></View>
              : <View style={vid.pauseBtn}><MaterialIcons name="pause" size={26} color="#fff" /></View>}
          </Pressable>
          {speed !== 1 ? (
            <View style={[vid.speedBadge, { zIndex: 10 }]}>
              <PulsingDot color="#FF9D00" /><Text style={vid.speedBadgeText}>{speed}×</Text>
            </View>
          ) : null}
          {selectedTrack ? (
            <View style={[vid.musicBadge, { zIndex: 10 }]}>
              <MaterialCommunityIcons name="music-note" size={11} color="#fff" />
              <Text style={vid.musicBadgeText} numberOfLines={1}>{selectedTrack.title}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Timeline */}
      {durationMs > 0 ? (
        <>
          <View style={vid.timeRow}>
            <Text style={vid.timeText}>{fmtMs(positionMs)}</Text>
            {trimDurSec > 0 ? <Text style={[vid.timeText, { color: Colors.primary }]}>{trimDurSec}s selec.</Text> : null}
            <Text style={vid.timeText}>{fmtMs(durationMs)}</Text>
          </View>
          <View style={[vid.seekBar, { width: TRACK_W, marginHorizontal: 16 }]}>
            <LinearGradient colors={['#7C5CFF44','#FF2D7844']} start={{ x:0,y:0 }} end={{ x:1,y:0 }} style={StyleSheet.absoluteFillObject} />
            <Pressable style={StyleSheet.absoluteFillObject}
              onStartShouldSetResponder={() => true}
              onResponderMove={e => seekTo(Math.max(0, Math.min(1, (e.nativeEvent.pageX - 16) / TRACK_W)))}
              onPress={e => seekTo(Math.max(0, Math.min(1, (e.nativeEvent.pageX - 16) / TRACK_W)))}
            />
            <View style={[vid.seekPlayhead, { left: (positionMs / durationMs) * TRACK_W }]} />
          </View>
        </>
      ) : null}

      {/* Trim */}
      <View style={vid.section}>
        <Text style={vid.sectionTitle}>✂️ Recortar</Text>
        <View style={[vid.track, { width: TRACK_W }]}>
          <LinearGradient colors={['#7C5CFF44','#FF2D7844']} start={{ x:0,y:0 }} end={{ x:1,y:0 }} style={StyleSheet.absoluteFillObject} />
          <View style={[vid.trimDark, { left: 0, width: trimStart * TRACK_W }]} />
          <View style={[vid.trimDark, { left: trimEnd * TRACK_W, right: 0 }]} />
          <View style={[vid.trimBracket, { left: trimStart * TRACK_W, width: (trimEnd - trimStart) * TRACK_W }]}>
            <LinearGradient colors={['#7C5CFF','#FF2D78']} style={vid.trimTop} />
            <LinearGradient colors={['#7C5CFF','#FF2D78']} style={vid.trimBottom} />
            <View style={vid.trimLeft} /><View style={vid.trimRight} />
          </View>
          {durationMs > 0 ? <View style={[vid.playhead, { left: (positionMs / durationMs) * TRACK_W }]} /> : null}
        </View>
        <View style={[vid.handleZone, { width: TRACK_W }]}>
          <Pressable style={[vid.handleTouch, { left: Math.max(0, trimStart * TRACK_W - 18) }]}
            onStartShouldSetResponder={() => true}
            onResponderMove={e => setTrimStart(Math.max(0, Math.min(trimEnd - 0.05, (e.nativeEvent.pageX - 16) / TRACK_W)))}>
            <LinearGradient colors={['#7C5CFF','#FF2D78']} style={vid.handle}><Text style={vid.handleIcon}>◂</Text></LinearGradient>
          </Pressable>
          <Pressable style={[vid.handleTouch, { left: Math.min(TRACK_W - 36, trimEnd * TRACK_W - 18) }]}
            onStartShouldSetResponder={() => true}
            onResponderMove={e => setTrimEnd(Math.min(1, Math.max(trimStart + 0.05, (e.nativeEvent.pageX - 16) / TRACK_W)))}>
            <LinearGradient colors={['#FF2D78','#7C5CFF']} style={vid.handle}><Text style={vid.handleIcon}>▸</Text></LinearGradient>
          </Pressable>
        </View>
      </View>

      {/* Speed */}
      <View style={vid.section}>
        <Text style={vid.sectionTitle}>⚡ Velocidad</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', gap: 8 }}>
          {SPEED_PRESETS.map(sp => (
            <Pressable key={sp.value} style={[vid.speedChip, speed === sp.value && vid.speedChipActive]} onPress={() => handleSetSpeed(sp.value)}>
              <Text style={[vid.speedLabel, speed === sp.value && { color: '#fff' }]}>{sp.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Color filter */}
      <View style={vid.section}>
        <Text style={vid.sectionTitle}>🎨 Filtro de color</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', gap: 8 }}>
          {VIDEO_COLOR_FILTERS.map(f => (
            <Pressable key={f.id} style={[vid.filterChip, colorFilter === f.id && vid.filterChipActive]} onPress={() => setColorFilter(f.id)}>
              <LinearGradient colors={f.gradient} style={vid.filterChipGrad} />
              <Text style={vid.filterChipEmoji}>{f.emoji}</Text>
              <Text style={[vid.filterChipName, colorFilter === f.id && { color: '#fff' }]}>{f.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Music */}
      <View style={vid.section}>
        <View style={vid.sectionRow}>
          <Text style={vid.sectionTitle}>🎵 Música</Text>
          {selectedTrack ? (
            <Pressable onPress={async () => {
              await soundRef.current?.stopAsync().catch(() => {});
              await soundRef.current?.unloadAsync().catch(() => {});
              soundRef.current = null; setSelectedTrack(null);
            }}>
              <Text style={{ color: Colors.error, fontSize: FontSize.xs, fontWeight: FontWeight.semibold }}>Quitar</Text>
            </Pressable>
          ) : null}
        </View>
        {selectedTrack ? (
          <View style={vid.trackRow}>
            <Image source={{ uri: selectedTrack.album.cover_medium }} style={vid.trackCover} contentFit="cover" transition={150} />
            <View style={{ flex: 1 }}>
              <Text style={vid.trackName} numberOfLines={1}>{selectedTrack.title}</Text>
              <Text style={vid.trackArtist} numberOfLines={1}>{selectedTrack.artist.name}</Text>
            </View>
            <PulsingDot color={Colors.warning} />
          </View>
        ) : null}
        <Pressable style={vid.addMusicBtn} onPress={() => setMusicModal(true)}>
          <LinearGradient colors={['#FF9D00','#FF5A00']} style={vid.addMusicBtnInner}>
            <MaterialCommunityIcons name="music-note-plus" size={18} color="#fff" />
            <Text style={vid.addMusicBtnText}>{selectedTrack ? 'Cambiar música' : 'Añadir música Deezer'}</Text>
          </LinearGradient>
        </Pressable>
      </View>

      {selectedTrack ? (
        <View style={vid.section}>
          <Text style={vid.sectionTitle}>🔊 Mezcla de audio</Text>
          <VolumeSlider label="Video"  value={videoVol} onChange={setVideoVol} color={Colors.primary} />
          <VolumeSlider label="Música" value={musicVol} onChange={setMusicVol} color={Colors.warning} />
        </View>
      ) : null}

      <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
        <Pressable style={vid.publishBtn} onPress={() => setCaptionModal(true)} disabled={isExporting}>
          <LinearGradient colors={['#7C5CFF','#FF2D78']} style={vid.publishBtnInner}>
            <MaterialCommunityIcons name="send-circle-outline" size={20} color="#fff" />
            <Text style={vid.publishBtnText}>{isFFmpegAvailable() ? 'Exportar y publicar' : 'Publicar video'}</Text>
          </LinearGradient>
        </Pressable>
      </View>

      <Modal visible={captionModal} transparent animationType="slide" presentationStyle="overFullScreen"
        onRequestClose={() => !isPublishing && setCaptionModal(false)}>
        <Pressable style={cm.backdrop} onPress={() => !isPublishing && setCaptionModal(false)} />
        <View style={cm.sheet}>
          <View style={cm.handle} />
          <Text style={cm.title}>Caption del video</Text>
          {isExporting && exportProgress ? (
            <View style={cm.progressWrap}>
              <ActivityIndicator color={Colors.primary} size="small" />
              <Text style={cm.progressText}>{exportProgress}</Text>
            </View>
          ) : null}
          <TextInput style={cm.input} value={caption} onChangeText={setCaption}
            placeholder="Escribe algo..." placeholderTextColor={Colors.textSubtle}
            multiline maxLength={200} />
          <Text style={cm.count}>{caption.length}/200</Text>
          <Pressable style={[cm.pubBtn, isPublishing && { opacity: 0.6 }]}
            onPress={handleExportAndPublish} disabled={isPublishing}>
            <LinearGradient colors={['#7C5CFF','#FF2D78']} style={cm.pubBtnInner}>
              {isPublishing ? <ActivityIndicator color="#fff" size="small" /> : null}
              <Text style={cm.pubBtnText}>{isPublishing ? (exportProgress ?? 'Procesando...') : '🚀 Publicar'}</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </Modal>

      <DeezerMusicModal visible={musicModal} onClose={() => setMusicModal(false)}
        onSelect={track => { setSelectedTrack(track); setMusicModal(false); }}
        selectedId={selectedTrack?.id ?? null} soundRef={soundRef} />
    </ScrollView>
  );
}

function VolumeSlider({ label, value, onChange, color }: { label: string; value: number; onChange: (v: number) => void; color: string }) {
  const TRACK_W = W - 32 - 56 - 44;
  return (
    <View style={vid.volRow}>
      <Text style={vid.volLabel}>{label}</Text>
      <View style={[vid.volTrack, { width: TRACK_W }]}>
        <View style={[vid.volFill, { width: `${value * 100}%` as any }]}>
          <LinearGradient colors={[color + '88', color]} style={StyleSheet.absoluteFillObject} />
        </View>
        <Pressable style={[vid.volThumb, { left: `${value * 100}%` as any, backgroundColor: color }]}
          onStartShouldSetResponder={() => true}
          onResponderMove={e => onChange(Math.max(0, Math.min(1, (e.nativeEvent.pageX - 16 - 56) / TRACK_W)))} />
      </View>
      <Text style={[vid.volValue, { color }]}>{Math.round(value * 100)}%</Text>
    </View>
  );
}

const vid = StyleSheet.create({
  empty:            { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },
  emptyTitle:       { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold, textAlign: 'center' },
  emptySub:         { color: Colors.textSubtle, fontSize: FontSize.sm, textAlign: 'center' },
  ffmpegBadge:      { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.surfaceElevated, borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: Colors.border },
  ffmpegBadgeText:  { color: '#00E5A0', fontSize: 11, fontWeight: FontWeight.semibold },
  emptyBtn:         { borderRadius: Radius.lg, overflow: 'hidden', marginTop: 8 },
  emptyBtnInner:    { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 24 },
  emptyBtnText:     { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
  clipRail:         { backgroundColor: Colors.surfaceElevated, borderBottomWidth: 1, borderBottomColor: Colors.border },
  clipThumb:        { width: 72, height: 72, borderRadius: Radius.md, backgroundColor: Colors.surface, borderWidth: 2, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative', gap: 2 },
  clipThumbActive:  { borderColor: Colors.primary },
  clipThumbNum:     { color: Colors.textPrimary, fontSize: 18, fontWeight: FontWeight.bold },
  clipThumbDur:     { color: Colors.textSubtle, fontSize: 9 },
  clipRemove:       { position: 'absolute', top: 4, right: 4, width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  clipAdd:          { width: 72, height: 72, borderRadius: Radius.md, borderWidth: 2, borderColor: Colors.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 4 },
  clipAddText:      { color: Colors.primary, fontSize: 9, fontWeight: FontWeight.semibold },
  clipCount:        { color: Colors.textSubtle, fontSize: 10, textAlign: 'right', paddingHorizontal: 14, paddingBottom: 6 },
  playerWrap:       { width: W, height: W * 0.62, backgroundColor: '#000', position: 'relative', overflow: 'hidden' },
  player:           { width: '100%', height: '100%' },
  playOverlay:      { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  playBtn:          { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  pauseBtn:         { position: 'absolute', top: 12, right: 12, width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  speedBadge:       { position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 5 },
  speedBadgeText:   { color: '#fff', fontSize: 12, fontWeight: FontWeight.bold },
  musicBadge:       { position: 'absolute', bottom: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 5, maxWidth: W * 0.5 },
  musicBadgeText:   { color: '#fff', fontSize: 11 },
  seekBar:          { height: 6, borderRadius: 3, backgroundColor: Colors.surface, overflow: 'hidden', position: 'relative', marginBottom: 4 },
  seekPlayhead:     { position: 'absolute', top: 0, bottom: 0, width: 3, backgroundColor: '#fff', borderRadius: 2 },
  timeRow:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 6 },
  timeText:         { color: Colors.textSubtle, fontSize: 11 },
  section:          { paddingHorizontal: 16, paddingTop: 18, gap: 10 },
  sectionRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle:     { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  track:            { height: 44, borderRadius: 8, overflow: 'hidden', position: 'relative', backgroundColor: Colors.surface },
  trimDark:         { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.62)', zIndex: 2 },
  trimBracket:      { position: 'absolute', top: 0, bottom: 0, zIndex: 3 },
  trimTop:          { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  trimBottom:       { position: 'absolute', bottom: 0, left: 0, right: 0, height: 3 },
  trimLeft:         { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: '#7C5CFF' },
  trimRight:        { position: 'absolute', right: 0, top: 0, bottom: 0, width: 4, backgroundColor: '#FF2D78' },
  playhead:         { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: '#fff', zIndex: 4 },
  handleZone:       { height: 32, position: 'relative' },
  handleTouch:      { position: 'absolute', top: 0, width: 36, height: 32, alignItems: 'center', justifyContent: 'center' },
  handle:           { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  handleIcon:       { color: '#fff', fontSize: 14, fontWeight: FontWeight.bold },
  speedChip:        { paddingHorizontal: 16, paddingVertical: 11, borderRadius: Radius.lg, backgroundColor: Colors.surfaceElevated, borderWidth: 1.5, borderColor: Colors.border },
  speedChipActive:  { backgroundColor: Colors.primary, borderColor: Colors.primary },
  speedLabel:       { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  filterChip:       { alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 6, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.border, minWidth: 66 },
  filterChipActive: { borderColor: '#FF2D78', backgroundColor: '#FF2D7822' },
  filterChipGrad:   { width: 44, height: 44, borderRadius: 22 },
  filterChipEmoji:  { position: 'absolute', top: 14, fontSize: 18 },
  filterChipName:   { color: Colors.textSubtle, fontSize: 9, fontWeight: FontWeight.medium },
  trackRow:         { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.surfaceElevated, borderRadius: Radius.lg, padding: 12, borderWidth: 1, borderColor: Colors.warning + '44' },
  trackCover:       { width: 44, height: 44, borderRadius: 8 },
  trackName:        { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  trackArtist:      { color: Colors.textSubtle, fontSize: FontSize.xs },
  addMusicBtn:      { borderRadius: Radius.lg, overflow: 'hidden' },
  addMusicBtnInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  addMusicBtnText:  { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
  volRow:           { flexDirection: 'row', alignItems: 'center', gap: 10 },
  volLabel:         { color: Colors.textSubtle, fontSize: FontSize.xs, width: 52 },
  volTrack:         { height: 4, backgroundColor: Colors.border, borderRadius: 2, position: 'relative', overflow: 'visible' },
  volFill:          { height: '100%', borderRadius: 2, overflow: 'hidden', position: 'absolute', top: 0, left: 0, right: 0 },
  volThumb:         { position: 'absolute', top: -7, width: 16, height: 16, borderRadius: 8, marginLeft: -8, elevation: 4 },
  volValue:         { fontSize: 10, width: 34, textAlign: 'right' },
  publishBtn:       { borderRadius: Radius.xl, overflow: 'hidden' },
  publishBtnInner:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16 },
  publishBtnText:   { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
});

const cm = StyleSheet.create({
  backdrop:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)' },
  sheet:        { backgroundColor: Colors.surfaceElevated, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 14, borderTopWidth: 1, borderColor: Colors.border },
  handle:       { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center' },
  title:        { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  progressWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.primary + '22', borderRadius: Radius.md, padding: 12 },
  progressText: { color: Colors.primary, fontSize: FontSize.sm, flex: 1 },
  input:        { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 12, color: Colors.textPrimary, fontSize: FontSize.md, minHeight: 80, textAlignVertical: 'top' },
  count:        { color: Colors.textSubtle, fontSize: 11, textAlign: 'right' },
  pubBtn:       { borderRadius: Radius.lg, overflow: 'hidden' },
  pubBtnInner:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  pubBtnText:   { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
});

// ═════════════════════════════════════════════════════════════════════════════
// DEEZER MUSIC MODAL
// ═════════════════════════════════════════════════════════════════════════════
function DeezerMusicModal({ visible, onClose, onSelect, selectedId, soundRef }: {
  visible: boolean; onClose: () => void; onSelect: (t: DeezerTrack) => void;
  selectedId: number | null; soundRef: React.MutableRefObject<Audio.Sound | null>;
}) {
  const [search,    setSearch]    = useState('');
  const [catId,     setCatId]     = useState('pop');
  const [tracks,    setTracks]    = useState<DeezerTrack[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [error,     setError]     = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchDeezer = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLoading(true); setError('');
    try {
      const res  = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=25&output=json`);
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      setTracks((json.data ?? []) as DeezerTrack[]);
    } catch { setError('Sin conexión a Deezer.'); setTracks([]); }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const cat = DEEZER_CATS.find(c => c.id === catId);
    if (cat) searchDeezer(cat.q);
  }, [catId, visible]);

  useEffect(() => {
    if (!search.trim()) {
      const cat = DEEZER_CATS.find(c => c.id === catId);
      if (cat) searchDeezer(cat.q);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchDeezer(search), 500);
  }, [search]);

  useEffect(() => {
    if (!visible) {
      soundRef.current?.stopAsync().catch(() => {});
      soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;
      setPreviewId(null);
    }
  }, [visible]);

  const handlePreview = useCallback(async (track: DeezerTrack) => {
    if (!track.preview) return;
    await soundRef.current?.stopAsync().catch(() => {});
    await soundRef.current?.unloadAsync().catch(() => {});
    soundRef.current = null;
    if (previewId === track.id) { setPreviewId(null); return; }
    setPreviewId(track.id);
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync({ uri: track.preview }, { shouldPlay: true, volume: 1.0 });
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((s: any) => { if (s.didJustFinish) setPreviewId(null); });
    } catch (_) { setPreviewId(null); }
  }, [previewId]);

  const fmtDur = (s: number) => `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`;

  return (
    <Modal visible={visible} transparent animationType="slide" presentationStyle="overFullScreen" onRequestClose={onClose}>
      <View style={dm.container}>
        <LinearGradient colors={['#0E0E18','#12121C']} style={StyleSheet.absoluteFillObject} />
        <View style={dm.header}>
          <Text style={dm.headerTitle}>🎵 Deezer Music</Text>
          <Pressable onPress={onClose}><MaterialCommunityIcons name="close" size={22} color={Colors.textSecondary} /></Pressable>
        </View>
        <View style={dm.searchWrap}>
          <MaterialCommunityIcons name="magnify" size={18} color={Colors.textSubtle} style={{ position: 'absolute', left: 12, zIndex: 1 }} />
          <TextInput style={dm.search} value={search} onChangeText={setSearch}
            placeholder="Buscar canción o artista..." placeholderTextColor={Colors.textSubtle} />
          {search ? <Pressable style={{ position: 'absolute', right: 12 }} onPress={() => setSearch('')}>
            <MaterialCommunityIcons name="close-circle" size={16} color={Colors.textSubtle} />
          </Pressable> : null}
        </View>
        {!search ? (
          <View style={{ height: 44 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 6 }}>
              {DEEZER_CATS.map(cat => (
                <Pressable key={cat.id} style={[dm.catChip, catId === cat.id && dm.catChipActive]} onPress={() => setCatId(cat.id)}>
                  <Text style={dm.catEmoji}>{cat.emoji}</Text>
                  <Text style={[dm.catLabel, catId === cat.id && { color: '#fff' }]}>{cat.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}
        {loading
          ? <View style={dm.center}><ActivityIndicator color={Colors.warning} size="large" /><Text style={dm.centerText}>Buscando...</Text></View>
          : error
          ? <View style={dm.center}><MaterialCommunityIcons name="wifi-off" size={38} color={Colors.textSubtle} /><Text style={dm.centerText}>{error}</Text></View>
          : <FlatList data={tracks} keyExtractor={t => String(t.id)}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 8 }}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const isPrev = previewId === item.id;
                const isSel  = selectedId === item.id;
                return (
                  <Pressable style={[dm.trackRow, isSel && dm.trackRowSel]} onPress={() => onSelect(item)}>
                    <Image source={{ uri: item.album.cover_medium }} style={dm.cover} contentFit="cover" transition={150} />
                    <View style={{ flex: 1 }}>
                      <Text style={[dm.trackTitle, isSel && { color: Colors.warning }]} numberOfLines={1}>{item.title}</Text>
                      <Text style={dm.trackArtist} numberOfLines={1}>{item.artist.name}</Text>
                      <Text style={dm.trackDur}>{fmtDur(item.duration)}</Text>
                    </View>
                    {item.preview ? (
                      <Pressable style={[dm.previewBtn, isPrev && { backgroundColor: Colors.warning }]}
                        onPress={() => handlePreview(item)}>
                        <MaterialCommunityIcons name={isPrev ? 'pause' : 'play'} size={16} color={isPrev ? '#fff' : Colors.warning} />
                      </Pressable>
                    ) : null}
                    {isSel ? <MaterialIcons name="check-circle" size={20} color={Colors.warning} style={{ marginLeft: 6 }} /> : null}
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <View style={dm.center}>
                  <MaterialCommunityIcons name="music-off" size={38} color={Colors.textSubtle} />
                  <Text style={dm.centerText}>Sin resultados</Text>
                </View>
              }
            />
        }
      </View>
    </Modal>
  );
}

const dm = StyleSheet.create({
  container:    { flex: 1, paddingTop: 56 },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12 },
  headerTitle:  { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  searchWrap:   { marginHorizontal: 16, marginBottom: 8, position: 'relative', justifyContent: 'center' },
  search:       { backgroundColor: Colors.surfaceElevated, borderRadius: Radius.xl, paddingVertical: 10, paddingLeft: 38, paddingRight: 36, color: Colors.textPrimary, fontSize: FontSize.sm, borderWidth: 1, borderColor: Colors.border },
  catChip:      { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full, backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border },
  catChipActive:{ backgroundColor: Colors.warning, borderColor: Colors.warning },
  catEmoji:     { fontSize: 14 },
  catLabel:     { color: Colors.textSubtle, fontSize: FontSize.xs, fontWeight: FontWeight.medium },
  center:       { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 60 },
  centerText:   { color: Colors.textSubtle, fontSize: FontSize.sm, textAlign: 'center' },
  trackRow:     { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: 12, borderWidth: 1, borderColor: Colors.border },
  trackRowSel:  { borderColor: Colors.warning, backgroundColor: Colors.warning + '0D' },
  cover:        { width: 50, height: 50, borderRadius: 8 },
  trackTitle:   { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  trackArtist:  { color: Colors.textSubtle, fontSize: 11, marginTop: 1 },
  trackDur:     { color: Colors.textSubtle, fontSize: 10, marginTop: 2 },
  previewBtn:   { width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.warningDim, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.warning + '55' },
});

// ═════════════════════════════════════════════════════════════════════════════
// TAB 3 — AVATARS (AI via OnSpace AI)
// FIX: iOS ph:// URIs read via expo-file-system (fetch() crashes on ph://)
// ═════════════════════════════════════════════════════════════════════════════
const AVATAR_STYLES_LIST = [
  { id: 'cartoon',    label: 'Cartoon',   emoji: '🎨', g: ['#7C5CFF','#B44FFF'] as [string,string] },
  { id: 'anime',      label: 'Anime',     emoji: '⛩️',  g: ['#FF2D78','#A855F7'] as [string,string] },
  { id: 'cinematic',  label: 'Cinematic', emoji: '🎬', g: ['#FF9D00','#FF2D78'] as [string,string] },
  { id: 'pixel',      label: 'Pixel Art', emoji: '👾', g: ['#A855F7','#7C5CFF'] as [string,string] },
  { id: 'glass',      label: 'Glass',     emoji: '✨', g: ['#00E5A0','#2D9EFF'] as [string,string] },
  { id: 'neon',       label: 'Neon',      emoji: '🌈', g: ['#FF2D78','#7C5CFF'] as [string,string] },
  { id: 'realistic',  label: 'Realistic', emoji: '📷', g: ['#2D9EFF','#7C5CFF'] as [string,string] },
  { id: 'watercolor', label: 'Acuarela',  emoji: '🎭', g: ['#FFB800','#FF5A00'] as [string,string] },
];

function AvatarsTab() {
  const { showAlert } = useAlert();
  const { addVideo }  = useFeed();
  const supabase      = getSupabaseClient();

  const [step,             setStep]             = useState<'pick' | 'style' | 'generating' | 'result'>('pick');
  const [photoUri,         setPhotoUri]         = useState<string | null>(null);
  const [uploadedUrl,      setUploadedUrl]      = useState<string | null>(null);
  const [selectedStyle,    setSelectedStyle]    = useState('cartoon');
  const [avatarUrl,        setAvatarUrl]        = useState<string | null>(null);
  const [isUploading,      setIsUploading]      = useState(false);
  const [isGenerating,     setIsGenerating]     = useState(false);
  const [generatingStatus, setGeneratingStatus] = useState('');

  /**
   * FIX: iOS ph:// URIs from ImagePicker cannot be fetched with fetch().
   * Must use expo-file-system readAsStringAsync with Base64 encoding.
   */
  const readUriAsBytes = useCallback(async (uri: string): Promise<Uint8Array> => {
    const FS = require('expo-file-system');
    if (uri.startsWith('ph://') || uri.startsWith('assets-library://')) {
      const b64    = await FS.readAsStringAsync(uri, { encoding: FS.EncodingType.Base64 });
      const binary = atob(b64);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }
    // file:// URIs work fine with fetch
    const resp = await fetch(uri);
    const ab   = await resp.arrayBuffer();
    return new Uint8Array(ab);
  }, []);

  const uploadPhoto = useCallback(async (uri: string, prefix: string): Promise<string> => {
    const bytes    = await readUriAsBytes(uri);
    const fileName = `${prefix}_${Date.now()}.jpg`;
    const { error: upErr } = await supabase.storage
      .from('images').upload(fileName, bytes, { contentType: 'image/jpeg', upsert: true });
    if (upErr) throw upErr;
    const { data: { publicUrl } } = supabase.storage.from('images').getPublicUrl(fileName);
    return publicUrl;
  }, [supabase, readUriAsBytes]);

  const pickPhoto = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { showAlert('Sin acceso', 'Necesitamos acceso a tu galería'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [1,1], quality: 0.85,
    });
    if (res.canceled || !res.assets[0]) return;
    const uri = res.assets[0].uri;
    setPhotoUri(uri);
    setIsUploading(true);
    try {
      const publicUrl = await uploadPhoto(uri, 'avatar_src');
      setUploadedUrl(publicUrl);
      setStep('style');
    } catch (e: any) {
      showAlert('Error al subir foto', e?.message ?? 'Intenta de nuevo');
      setPhotoUri(null);
    }
    setIsUploading(false);
  }, [supabase, showAlert, uploadPhoto]);

  const takeSelfie = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { showAlert('Sin acceso', 'Necesitamos acceso a la cámara'); return; }
    const res = await ImagePicker.launchCameraAsync({
      cameraType: ImagePicker.CameraType.front,
      allowsEditing: true, aspect: [1,1], quality: 0.85,
    });
    if (res.canceled || !res.assets[0]) return;
    const uri = res.assets[0].uri;
    setPhotoUri(uri);
    setIsUploading(true);
    try {
      const publicUrl = await uploadPhoto(uri, 'selfie');
      setUploadedUrl(publicUrl);
      setStep('style');
    } catch (e: any) {
      showAlert('Error', e?.message ?? 'Intenta de nuevo');
      setPhotoUri(null);
    }
    setIsUploading(false);
  }, [supabase, showAlert, uploadPhoto]);

  const generateAvatar = useCallback(async () => {
    if (!uploadedUrl) { showAlert('Sin foto', 'Primero sube una foto'); return; }
    setStep('generating'); setIsGenerating(true);
    setGeneratingStatus('Generando tu avatar con IA...');
    try {
      const { data, error } = await supabase.functions.invoke('ai-avatar', {
        body: { action: 'generate-image', photoUrl: uploadedUrl, style: selectedStyle },
      });
      if (error) {
        let msg = error.message;
        if (error instanceof FunctionsHttpError) {
          try { const txt = await (error as any).context?.text(); msg = txt || msg; } catch { /* ignore */ }
        }
        throw new Error(msg);
      }
      if (!data?.imageUrl) throw new Error('No se recibió imagen del servidor');
      setAvatarUrl(data.imageUrl);
      setStep('result');
    } catch (e: any) {
      showAlert('Error de generación', e?.message ?? 'No se pudo generar el avatar.');
      setStep('style');
    }
    setIsGenerating(false);
  }, [uploadedUrl, selectedStyle, supabase, showAlert]);

  const publishAvatar = useCallback(async () => {
    if (!avatarUrl) return;
    try {
      await addVideo({
        videoUrl: avatarUrl, thumbnailUrl: avatarUrl,
        caption: `Mi nuevo avatar IA ${AVATAR_STYLES_LIST.find(s => s.id === selectedStyle)?.emoji ?? '✨'} #AIAvatar #ClipDAG`,
        music: 'Sin música', username: '', userAvatar: '',
      });
      showAlert('Publicado 🎉', 'Tu avatar fue publicado al feed');
      setStep('pick'); setPhotoUri(null); setUploadedUrl(null); setAvatarUrl(null);
    } catch (e: any) { showAlert('Error', e?.message ?? 'No se pudo publicar'); }
  }, [avatarUrl, selectedStyle, addVideo, showAlert]);

  if (step === 'pick') {
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, gap: 20 }}>
        <View style={av.heroCard}>
          <LinearGradient colors={['#7C5CFF','#FF2D78','#FF9D00']} start={{ x:0,y:0 }} end={{ x:1,y:1 }} style={av.heroGrad}>
            <Text style={av.heroEmoji}>🤖</Text>
            <View style={{ flex: 1 }}>
              <Text style={av.heroTitle}>Avatar IA Generativo</Text>
              <Text style={av.heroSub}>Tu foto → avatar estilizado con Gemini 2.5</Text>
              <Text style={av.heroPowered}>Powered by OnSpace AI</Text>
            </View>
          </LinearGradient>
        </View>
        {isUploading ? (
          <View style={av.uploadingBox}>
            <ActivityIndicator color={Colors.primary} size="large" />
            <Text style={av.uploadingText}>Subiendo foto...</Text>
          </View>
        ) : (
          <>
            <Pressable style={av.pickBtn} onPress={pickPhoto}>
              <LinearGradient colors={['#7C5CFF','#B44FFF']} style={av.pickBtnInner}>
                <MaterialCommunityIcons name="image-plus" size={22} color="#fff" />
                <Text style={av.pickBtnText}>Subir foto de galería</Text>
              </LinearGradient>
            </Pressable>
            <Pressable style={av.pickBtn} onPress={takeSelfie}>
              <LinearGradient colors={['#FF2D78','#FF9D00']} style={av.pickBtnInner}>
                <MaterialCommunityIcons name="camera-front" size={22} color="#fff" />
                <Text style={av.pickBtnText}>Tomar selfie</Text>
              </LinearGradient>
            </Pressable>
          </>
        )}
        <View style={av.tipBox}>
          <Text style={av.tipTitle}>Tips para mejor resultado:</Text>
          {['Foto frontal con el rostro bien visible','Buena iluminación, sin sombras fuertes','Fondo neutro o claro'].map((tip, i) => (
            <View key={i} style={av.tipRow}>
              <MaterialCommunityIcons name="check-circle-outline" size={13} color={Colors.primary} />
              <Text style={av.tipText}>{tip}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    );
  }

  if (step === 'style') {
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, gap: 16 }}>
        {photoUri ? (
          <View style={{ alignSelf: 'center' }}>
            <Image source={{ uri: photoUri }} style={av.photoPreview} contentFit="cover" transition={200} />
          </View>
        ) : null}
        <Text style={av.stepTitle}>Elige tu estilo</Text>
        <View style={av.grid}>
          {AVATAR_STYLES_LIST.map(s => (
            <Pressable key={s.id} style={[av.card, selectedStyle === s.id && av.cardActive]} onPress={() => setSelectedStyle(s.id)}>
              <LinearGradient colors={s.g} style={av.cardGrad} />
              <Text style={av.cardEmoji}>{s.emoji}</Text>
              <Text style={[av.cardLabel, selectedStyle === s.id && { color: Colors.primary }]}>{s.label}</Text>
              {selectedStyle === s.id ? <View style={av.cardCheck}><MaterialIcons name="check-circle" size={14} color={Colors.primary} /></View> : null}
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable style={av.backBtn} onPress={() => setStep('pick')}>
            <Text style={av.backBtnText}>← Volver</Text>
          </Pressable>
          <Pressable style={{ flex: 2, borderRadius: Radius.lg, overflow: 'hidden' }} onPress={generateAvatar}>
            <LinearGradient colors={['#7C5CFF','#FF2D78']} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 }}>
              <MaterialCommunityIcons name="magic-staff" size={18} color="#fff" />
              <Text style={{ color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold }}>Generar avatar</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  if (step === 'generating') {
    return (
      <View style={av.generatingWrap}>
        <LinearGradient colors={['#7C5CFF','#FF2D78','#00E5A0']} style={av.generatingOrb}>
          <MaterialCommunityIcons name="robot-excited-outline" size={52} color="#fff" />
        </LinearGradient>
        <Text style={av.generatingTitle}>Generando tu avatar IA</Text>
        <Text style={av.generatingStatus}>{generatingStatus}</Text>
        <ActivityIndicator color={Colors.primary} size="large" style={{ marginTop: 16 }} />
        <Text style={av.generatingHint}>Esto tarda ~30 segundos con Gemini 2.5</Text>
      </View>
    );
  }

  if (step === 'result' && avatarUrl) {
    const styleDef = AVATAR_STYLES_LIST.find(s => s.id === selectedStyle);
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, gap: 16, alignItems: 'center' }}>
        <Text style={av.resultTitle}>✨ Avatar {styleDef?.label} listo!</Text>
        <Image source={{ uri: avatarUrl }} style={av.resultImg} contentFit="cover" transition={300} />
        {photoUri ? (
          <View style={av.compRow}>
            <View style={av.compItem}>
              <Image source={{ uri: photoUri }} style={av.compImg} contentFit="cover" transition={200} />
              <Text style={av.compLabel}>Original</Text>
            </View>
            <LinearGradient colors={['#7C5CFF','#FF2D78']} style={av.compArrow}>
              <MaterialCommunityIcons name="magic-staff" size={16} color="#fff" />
            </LinearGradient>
            <View style={av.compItem}>
              <Image source={{ uri: avatarUrl }} style={av.compImg} contentFit="cover" transition={200} />
              <Text style={[av.compLabel, { color: Colors.primary }]}>{styleDef?.label}</Text>
            </View>
          </View>
        ) : null}
        <Pressable style={{ width: '100%', borderRadius: Radius.lg, overflow: 'hidden' }} onPress={publishAvatar}>
          <LinearGradient colors={['#7C5CFF','#FF2D78']} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16 }}>
            <MaterialCommunityIcons name="send-circle-outline" size={18} color="#fff" />
            <Text style={{ color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold }}>Publicar al feed</Text>
          </LinearGradient>
        </Pressable>
        <Pressable style={av.resetBtn} onPress={() => { setStep('pick'); setPhotoUri(null); setUploadedUrl(null); setAvatarUrl(null); }}>
          <MaterialCommunityIcons name="refresh" size={16} color={Colors.textSubtle} />
          <Text style={av.resetBtnText}>Crear otro avatar</Text>
        </Pressable>
      </ScrollView>
    );
  }
  return null;
}

const av = StyleSheet.create({
  heroCard:        { borderRadius: Radius.xl, overflow: 'hidden' },
  heroGrad:        { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18 },
  heroEmoji:       { fontSize: 38 },
  heroTitle:       { color: '#fff', fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  heroSub:         { color: 'rgba(255,255,255,0.75)', fontSize: FontSize.xs, marginTop: 2 },
  heroPowered:     { color: 'rgba(255,255,255,0.5)', fontSize: 10, marginTop: 4 },
  uploadingBox:    { alignItems: 'center', gap: 12, padding: 40 },
  uploadingText:   { color: Colors.textSubtle, fontSize: FontSize.sm },
  pickBtn:         { borderRadius: Radius.lg, overflow: 'hidden' },
  pickBtnInner:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16 },
  pickBtnText:     { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
  tipBox:          { backgroundColor: Colors.surfaceElevated, borderRadius: Radius.lg, padding: 16, gap: 8, borderWidth: 1, borderColor: Colors.border },
  tipTitle:        { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, marginBottom: 4 },
  tipRow:          { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  tipText:         { color: Colors.textSubtle, fontSize: FontSize.xs, flex: 1, lineHeight: 18 },
  photoPreview:    { width: 100, height: 100, borderRadius: 50, borderWidth: 3, borderColor: Colors.primary },
  stepTitle:       { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  grid:            { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card:            { width: (W - 42) / 4, alignItems: 'center', gap: 6, padding: 10, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.surface, position: 'relative' },
  cardActive:      { borderColor: Colors.primary, backgroundColor: Colors.primaryDim },
  cardGrad:        { width: 44, height: 44, borderRadius: 22 },
  cardEmoji:       { position: 'absolute', top: 15, fontSize: 20 },
  cardLabel:       { color: Colors.textSubtle, fontSize: 10, fontWeight: '600', textAlign: 'center' },
  cardCheck:       { position: 'absolute', top: 5, right: 5 },
  backBtn:         { flex: 1, backgroundColor: Colors.surfaceElevated, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderWidth: 1, borderColor: Colors.border },
  backBtnText:     { color: Colors.textSubtle, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  generatingWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },
  generatingOrb:   { width: 110, height: 110, borderRadius: 55, alignItems: 'center', justifyContent: 'center' },
  generatingTitle: { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold, textAlign: 'center' },
  generatingStatus:{ color: Colors.textSubtle, fontSize: FontSize.sm, textAlign: 'center' },
  generatingHint:  { color: Colors.textSubtle, fontSize: 11, textAlign: 'center', lineHeight: 18 },
  resultTitle:     { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold, textAlign: 'center' },
  resultImg:       { width: W - 64, height: W - 64, borderRadius: Radius.xl, borderWidth: 2, borderColor: Colors.primary },
  compRow:         { flexDirection: 'row', alignItems: 'center', width: '100%' },
  compItem:        { flex: 1, alignItems: 'center', gap: 6 },
  compImg:         { width: 80, height: 80, borderRadius: 40, borderWidth: 2, borderColor: Colors.border },
  compLabel:       { color: Colors.textSubtle, fontSize: 11, fontWeight: '600' },
  compArrow:       { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  resetBtn:        { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  resetBtnText:    { color: Colors.textSubtle, fontSize: FontSize.sm },
});

// ═════════════════════════════════════════════════════════════════════════════
// TAB 4 — MUSIC (Deezer)
// ═════════════════════════════════════════════════════════════════════════════
function MusicTab() {
  const { showAlert } = useAlert();
  const soundRef      = useRef<Audio.Sound | null>(null);
  const [search,        setSearch]        = useState('');
  const [catId,         setCatId]         = useState('viral');
  const [tracks,        setTracks]        = useState<DeezerTrack[]>([]);
  const [loading,       setLoading]       = useState(false);
  const [previewId,     setPreviewId]     = useState<number | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<DeezerTrack | null>(null);
  const [error,         setError]         = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    soundRef.current?.stopAsync().catch(() => {});
    soundRef.current?.unloadAsync().catch(() => {});
  }, []);

  const searchDeezer = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLoading(true); setError('');
    try {
      const res  = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=30&output=json`);
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      setTracks((json.data ?? []) as DeezerTrack[]);
    } catch { setError('Sin conexión a Deezer.'); setTracks([]); }
    setLoading(false);
  }, []);

  useEffect(() => {
    const cat = DEEZER_CATS.find(c => c.id === catId);
    if (cat) searchDeezer(cat.q);
  }, [catId]);

  useEffect(() => {
    if (!search.trim()) {
      const cat = DEEZER_CATS.find(c => c.id === catId);
      if (cat) searchDeezer(cat.q);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchDeezer(search), 500);
  }, [search]);

  const handlePreview = useCallback(async (track: DeezerTrack) => {
    if (!track.preview) { showAlert('Sin preview', 'Esta canción no tiene preview disponible'); return; }
    await soundRef.current?.stopAsync().catch(() => {});
    await soundRef.current?.unloadAsync().catch(() => {});
    soundRef.current = null;
    if (previewId === track.id) { setPreviewId(null); return; }
    setPreviewId(track.id);
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync({ uri: track.preview }, { shouldPlay: true, volume: 1.0 });
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((s: any) => { if (s.didJustFinish) setPreviewId(null); });
    } catch (_) { setPreviewId(null); showAlert('Error', 'No se pudo reproducir'); }
  }, [previewId, showAlert]);

  const fmtDur = (s: number) => `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`;

  return (
    <View style={{ flex: 1 }}>
      <View style={mu.searchWrap}>
        <MaterialCommunityIcons name="magnify" size={18} color={Colors.textSubtle} style={{ position: 'absolute', left: 14, zIndex: 1 }} />
        <TextInput style={mu.search} value={search} onChangeText={setSearch}
          placeholder="Buscar en Deezer: artista, canción..." placeholderTextColor={Colors.textSubtle} />
        {search ? <Pressable style={{ position: 'absolute', right: 14 }} onPress={() => setSearch('')}>
          <MaterialCommunityIcons name="close-circle" size={16} color={Colors.textSubtle} />
        </Pressable> : null}
      </View>
      <View style={mu.deezerBadge}>
        <Text style={mu.deezerText}>🎵 Resultados en tiempo real de </Text>
        <Text style={[mu.deezerText, { color: '#FF6F42', fontWeight: FontWeight.bold }]}>Deezer</Text>
      </View>
      {!search ? (
        <View style={{ height: 44 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 6 }}>
            {DEEZER_CATS.map(cat => (
              <Pressable key={cat.id} style={[mu.catChip, catId === cat.id && mu.catChipActive]} onPress={() => setCatId(cat.id)}>
                <Text style={mu.catEmoji}>{cat.emoji}</Text>
                <Text style={[mu.catLabel, catId === cat.id && { color: '#fff' }]}>{cat.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
      {previewId ? (
        <Pressable style={mu.nowPlaying} onPress={() => {
          soundRef.current?.stopAsync().catch(() => {});
          soundRef.current?.unloadAsync().catch(() => {});
          soundRef.current = null; setPreviewId(null);
        }}>
          <PulsingDot color={Colors.warning} />
          <Text style={mu.nowPlayingText} numberOfLines={1}>{tracks.find(t => t.id === previewId)?.title ?? 'Reproduciendo...'}</Text>
          <MaterialCommunityIcons name="stop-circle-outline" size={18} color={Colors.warning} />
        </Pressable>
      ) : null}
      {loading
        ? <View style={mu.center}><ActivityIndicator color={Colors.warning} size="large" /><Text style={mu.centerText}>Cargando desde Deezer...</Text></View>
        : error
        ? <View style={mu.center}>
            <MaterialCommunityIcons name="wifi-off" size={44} color={Colors.textSubtle} />
            <Text style={mu.centerText}>{error}</Text>
            <Pressable style={mu.retryBtn} onPress={() => { const c = DEEZER_CATS.find(x => x.id === catId); if (c) searchDeezer(c.q); }}>
              <Text style={mu.retryBtnText}>Reintentar</Text>
            </Pressable>
          </View>
        : <FlatList data={tracks} keyExtractor={t => String(t.id)}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: selectedTrack ? 90 : 120, gap: 8, paddingTop: 8 }}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => {
              const isPrev = previewId === item.id;
              const isSel  = selectedTrack?.id === item.id;
              return (
                <Pressable style={[mu.trackRow, isSel && mu.trackRowSel]} onPress={() => setSelectedTrack(isSel ? null : item)}>
                  <Image source={{ uri: item.album.cover_medium }} style={mu.cover} contentFit="cover" transition={150} />
                  <View style={{ flex: 1 }}>
                    <Text style={[mu.trackTitle, isSel && { color: Colors.warning }]} numberOfLines={1}>{item.title}</Text>
                    <Text style={mu.trackArtist} numberOfLines={1}>{item.artist.name}</Text>
                    <Text style={mu.trackDur}>{fmtDur(item.duration)}</Text>
                  </View>
                  <View style={{ alignItems: 'center', gap: 6 }}>
                    {item.preview ? (
                      <Pressable style={[mu.previewBtn, isPrev && { backgroundColor: Colors.warning, borderColor: Colors.warning }]}
                        onPress={() => handlePreview(item)}>
                        <MaterialCommunityIcons name={isPrev ? 'pause' : 'play'} size={16} color={isPrev ? '#fff' : Colors.warning} />
                      </Pressable>
                    ) : null}
                    {isSel ? <MaterialIcons name="check-circle" size={20} color={Colors.warning} /> : null}
                  </View>
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <View style={mu.center}>
                <MaterialCommunityIcons name="music-off" size={40} color={Colors.textSubtle} />
                <Text style={mu.centerText}>Sin resultados</Text>
              </View>
            }
          />
      }
      {selectedTrack ? (
        <View style={mu.actionBar}>
          <LinearGradient colors={['rgba(18,18,28,0.98)','#12121C']} style={StyleSheet.absoluteFillObject} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
            <PulsingDot color={Colors.warning} />
            <Text style={mu.selectedTitle} numberOfLines={1}>{selectedTrack.title} — {selectedTrack.artist.name}</Text>
          </View>
          <Pressable style={mu.useBtn} onPress={() => showAlert('Canción seleccionada', `"${selectedTrack.title}" lista. Ve al tab Videos para añadirla.`)}>
            <LinearGradient colors={['#FF9D00','#FF5A00']} style={mu.useBtnInner}>
              <Text style={mu.useBtnText}>Usar en video</Text>
            </LinearGradient>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const mu = StyleSheet.create({
  searchWrap:    { marginHorizontal: 16, marginVertical: 10, position: 'relative', justifyContent: 'center' },
  search:        { backgroundColor: Colors.surfaceElevated, borderRadius: Radius.xl, paddingVertical: 11, paddingLeft: 40, paddingRight: 36, color: Colors.textPrimary, fontSize: FontSize.sm, borderWidth: 1, borderColor: Colors.border },
  deezerBadge:   { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 4 },
  deezerText:    { color: Colors.textSubtle, fontSize: 10 },
  catChip:       { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full, backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border },
  catChipActive: { backgroundColor: Colors.warning, borderColor: Colors.warning },
  catEmoji:      { fontSize: 14 },
  catLabel:      { color: Colors.textSubtle, fontSize: FontSize.xs, fontWeight: FontWeight.medium },
  nowPlaying:    { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginBottom: 6, backgroundColor: Colors.warningDim, borderRadius: Radius.lg, padding: 12, borderWidth: 1, borderColor: Colors.warning + '44' },
  nowPlayingText:{ color: Colors.warning, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, flex: 1 },
  center:        { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 60 },
  centerText:    { color: Colors.textSubtle, fontSize: FontSize.sm, textAlign: 'center' },
  retryBtn:      { backgroundColor: Colors.primary, borderRadius: Radius.md, paddingHorizontal: 20, paddingVertical: 10 },
  retryBtnText:  { color: '#fff', fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  trackRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: 12, borderWidth: 1, borderColor: Colors.border },
  trackRowSel:   { borderColor: Colors.warning, backgroundColor: Colors.warning + '0D' },
  cover:         { width: 50, height: 50, borderRadius: 10 },
  trackTitle:    { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  trackArtist:   { color: Colors.textSubtle, fontSize: 11, marginTop: 2 },
  trackDur:      { color: Colors.textSubtle, fontSize: 10, marginTop: 2 },
  previewBtn:    { width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.warningDim, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.warning + '66' },
  actionBar:     { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: Colors.border },
  selectedTitle: { color: Colors.warning, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  useBtn:        { borderRadius: Radius.lg, overflow: 'hidden' },
  useBtnInner:   { paddingHorizontal: 16, paddingVertical: 10 },
  useBtnText:    { color: '#fff', fontSize: FontSize.xs, fontWeight: FontWeight.bold },
});

// ─────────────────────────────────────────────────────────────────────────────
// ROOT STYLES
// ─────────────────────────────────────────────────────────────────────────────
const root = StyleSheet.create({
  container:       { flex: 1, backgroundColor: Colors.bg },
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border },
  backBtn:         { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surfaceElevated, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
  titleRow:        { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title:           { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  deepARBadge:     { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  deepARBadgeText: { color: '#fff', fontSize: 9, fontWeight: FontWeight.bold },
  badge:           { backgroundColor: '#7C5CFF22', borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: '#7C5CFF44' },
  badgeText:       { color: '#7C5CFF', fontSize: 9, fontWeight: FontWeight.bold },
  statusBar:       { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: Colors.warningDim, borderBottomWidth: 1, borderBottomColor: Colors.warning + '33' },
  statusBarText:   { color: Colors.warning, fontSize: 10, flex: 1 },
  tabBar:          { flexDirection: 'row', borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.bg },
  tabItem:         { flex: 1, alignItems: 'center', paddingVertical: 10, gap: 3, position: 'relative', overflow: 'hidden' },
  tabActiveGrad:   { ...StyleSheet.absoluteFillObject },
  tabLabel:        { color: Colors.textSubtle, fontSize: 9, fontWeight: FontWeight.medium },
  tabDot:          { position: 'absolute', top: 0, left: '20%', right: '20%', height: 2, borderRadius: 1 },
});
