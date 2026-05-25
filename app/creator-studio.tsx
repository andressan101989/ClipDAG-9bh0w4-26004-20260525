/**
 * app/creator-studio.tsx — Creator Studio v12
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  STACK                                                                    │
 * │                                                                            │
 * │  Tab AR      → DeepAR SDK (face tracking, masks, beauty, BG removal)      │
 * │                Fallback: expo-camera + SkiaEffectsLayer (GPU overlays)    │
 * │                                                                            │
 * │  Tab Videos  → ffmpegService (trim/merge/speed/color/audio export)        │
 * │                expo-video playback + seek preview + Skia color preview    │
 * │                Deezer music integration                                    │
 * │                                                                            │
 * │  Tab Avatares → AI Avatar generator (OnSpace AI / Gemini)                 │
 * │  Tab Música   → Deezer live search + 30s preview                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
import React, {
  useState, useCallback, useRef, useEffect, useMemo,
} from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView, FlatList,
  TextInput, ActivityIndicator, Dimensions, Modal, Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
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
import { Colors, FontSize, FontWeight, Radius } from '@/constants/theme';

// ── DeepAR diagnostic ───────────────────────────────────────────────────────
import { getDeepARStatus } from '@/services/deeparService';

// ── FFmpeg ────────────────────────────────────────────────────────────────────
import {
  isFFmpegAvailable, exportFinal, trimVideo, mergeClips,
  applyColorFilter, addAudioTrack, changeSpeed,
  type ExportParams,
} from '@/services/ffmpegService';

// ── Skia effects ──────────────────────────────────────────────────────────────
import SkiaEffectsLayer, { type SkiaEffectId } from '@/components/feature/SkiaEffectsLayer';

// ── DeepAR ────────────────────────────────────────────────────────────────────
import {
  isDeepARAvailable, DEEPAR_API_KEY, DEEPAR_FILTERS,
  switchDeepAREffect, clearDeepAREffect,
  triggerDeepARScreenshot, startDeepARRecording, stopDeepARRecording,
  requestDeepARPermissions,
  DeepARCamera as DeepARCameraComponent,
  type DeepARFilter,
} from '@/services/deeparService';

// ── expo-camera (fallback) ───────────────────────────────────────────────────
let CameraView: any = null;
let _useCameraPermissions: any = null;
try {
  const ec = require('expo-camera');
  CameraView              = ec.CameraView           ?? null;
  _useCameraPermissions   = ec.useCameraPermissions ?? null;
} catch { /* web */ }

// Safe hook wrapper — must be called unconditionally at component level
function useSafeCameraPermissions(): [{ granted: boolean } | null, () => Promise<any>] {
  // Always call the real hook if available, otherwise return a no-op pair.
  // This must be called at the TOP of every component that uses it — never conditionally.
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
// EFFECT CATALOG — Skia/Reanimated (used when DeepAR not available)
// ─────────────────────────────────────────────────────────────────────────────
interface EffectDef {
  id:          SkiaEffectId;
  name:        string;
  emoji:       string;
  gradient:    [string, string];
  category:    'color' | 'overlay' | 'gpu' | 'new';
  description: string;
}

const SKIA_EFFECTS: EffectDef[] = [
  { id: 'none',       name: 'Normal',     emoji: '✨', gradient: ['#444','#222'],        category: 'color',   description: 'Sin filtro' },
  { id: 'vintage',    name: 'Vintage',    emoji: '📷', gradient: ['#8B5E3C','#C27540'],  category: 'color',   description: 'Tono cálido retro' },
  { id: 'cine',       name: 'Cine',       emoji: '🎬', gradient: ['#1A1A2E','#333355'],  category: 'color',   description: 'Negro cinematográfico' },
  { id: 'frio',       name: 'Frío',       emoji: '🧊', gradient: ['#2D9EFF','#7CC4FF'],  category: 'color',   description: 'Tonos azules helados' },
  { id: 'calido',     name: 'Cálido',     emoji: '🌅', gradient: ['#FF9D00','#FF5A00'],  category: 'color',   description: 'Atardecer dorado' },
  { id: 'bn',         name: 'B&N',        emoji: '⬛', gradient: ['#555','#999'],         category: 'color',   description: 'Blanco y negro' },
  { id: 'neon',       name: 'Neón',       emoji: '🌈', gradient: ['#FF2D78','#7C5CFF'],  category: 'color',   description: 'Luces neón vibrantes' },
  { id: 'chromatic',  name: 'Cromático',  emoji: '🔴', gradient: ['#FF0044','#00FFCC'],  category: 'new',     description: 'RGB Split GPU' },
  { id: 'bokeh',      name: 'Bokeh',      emoji: '📸', gradient: ['#7C5CFF','#FF2D78'],  category: 'new',     description: 'Desenfoque artístico' },
  { id: 'beauty',     name: 'Beauty',     emoji: '💆', gradient: ['#FFB6C1','#FF69B4'],  category: 'new',     description: 'Suavizado piel GPU' },
  { id: 'particles',  name: 'Partículas', emoji: '✨', gradient: ['#FFD700','#FF9D00'],  category: 'gpu',     description: 'Partículas doradas' },
  { id: 'glitch',     name: 'Glitch',     emoji: '📺', gradient: ['#00FFFF','#FF00FF'],  category: 'gpu',     description: 'Efecto glitch RGB' },
  { id: 'starfield',  name: 'Estrellas',  emoji: '⭐', gradient: ['#7C5CFF','#A855F7'],  category: 'gpu',     description: 'Constelación giratoria' },
  { id: 'glow',       name: 'Glow',       emoji: '💜', gradient: ['#7C5CFF','#A855F7'],  category: 'gpu',     description: 'Aura neón GPU' },
  { id: 'rain',       name: 'Lluvia',     emoji: '🌧️', gradient: ['#2D9EFF','#0050AA'],  category: 'gpu',     description: 'Lluvia GPU' },
  { id: 'hearts',     name: 'Corazones',  emoji: '💕', gradient: ['#FF2D78','#FF6BA8'],  category: 'overlay', description: 'Corazones flotantes' },
];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// DEEPAR DIAGNOSTIC STRIP
// ─────────────────────────────────────────────────────────────────────────────
function DeepARDiagnosticStrip({ status }: {
  status: {
    ready: boolean; hasPackage: boolean; hasApiKey: boolean;
    isEnabled: boolean; instructions: string[];
  };
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Pressable
      style={diag.strip}
      onPress={() => setExpanded(e => !e)}
    >
      <LinearGradient
        colors={['#1A0A00', '#2A1200']}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={diag.row}>
        <MaterialCommunityIcons
          name={status.ready ? 'check-circle' : 'alert-circle-outline'}
          size={14}
          color={status.ready ? '#00E5A0' : '#FF9D00'}
        />
        <Text style={diag.title}>DeepAR SDK Status</Text>
        <View style={diag.checks}>
          <DiagCheck ok={status.isEnabled}  label="Enabled" />
          <DiagCheck ok={status.hasApiKey}  label="API Key" />
          <DiagCheck ok={status.hasPackage} label="Compiled" />
        </View>
        <MaterialCommunityIcons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={Colors.textSubtle}
        />
      </View>
      {expanded ? (
        <View style={diag.details}>
          <Text style={diag.detailTitle}>isDeepARAvailable() → {String(status.ready)}</Text>
          {status.instructions.map((inst, i) => (
            <View key={i} style={diag.step}>
              <Text style={diag.stepNum}>{i + 1}</Text>
              <Text style={diag.stepText}>{inst}</Text>
            </View>
          ))}
          {!status.hasPackage ? (
            <View style={diag.cmdBox}>
              <Text style={diag.cmdLabel}>Comando para instalar:</Text>
              <Text style={diag.cmd}>pnpm add react-native-deepar</Text>
            </View>
          ) : null}
          {status.hasPackage && !status.ready ? (
            <View style={diag.cmdBox}>
              <Text style={diag.cmdLabel}>Después de instalar, buildea:</Text>
              <Text style={diag.cmd}>eas build --profile development --platform android</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

function DiagCheck({ ok, label }: { ok: boolean; label: string }) {
  return (
    <View style={diag.check}>
      <MaterialCommunityIcons
        name={ok ? 'check' : 'close'}
        size={10}
        color={ok ? '#00E5A0' : '#FF6B6B'}
      />
      <Text style={[diag.checkLabel, { color: ok ? '#00E5A0' : '#FF6B6B' }]}>{label}</Text>
    </View>
  );
}

const diag = StyleSheet.create({
  strip:       { borderBottomWidth: 1, borderBottomColor: '#FF9D0033', overflow: 'hidden' },
  row:         { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 7 },
  title:       { color: Colors.warning, fontSize: 10, fontWeight: FontWeight.bold, flex: 1 },
  checks:      { flexDirection: 'row', gap: 6 },
  check:       { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 },
  checkLabel:  { fontSize: 9, fontWeight: FontWeight.semibold },
  details:     { paddingHorizontal: 14, paddingBottom: 12, gap: 6 },
  detailTitle: { color: Colors.textPrimary, fontSize: 11, fontWeight: FontWeight.bold, marginBottom: 4 },
  step:        { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  stepNum:     { color: Colors.warning, fontSize: 10, fontWeight: FontWeight.bold, width: 14 },
  stepText:    { color: Colors.textSubtle, fontSize: 10, flex: 1, lineHeight: 15 },
  cmdBox:      { backgroundColor: '#111', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#333', marginTop: 4 },
  cmdLabel:    { color: Colors.textSubtle, fontSize: 9, marginBottom: 4 },
  cmd:         { color: '#00E5A0', fontSize: 11, fontFamily: 'monospace', fontWeight: FontWeight.bold },
});

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

// Hearts effect moved to SkiaEffectsLayer (effectId: 'hearts')

function fmtMs(ms: number) {
  const s = Math.floor(ms / 1000);
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

  return (
    <View style={[root.container, { paddingTop: insets.top }]}>
      {/* ── DeepAR diagnostic strip — visible until SDK is confirmed active ── */}
      {!deepARStatus.ready ? (
        <DeepARDiagnosticStrip status={deepARStatus} />
      ) : null}
      <StatusBar style="light" />
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
          {isFFmpegAvailable() ? (
            <View style={root.badge}><Text style={root.badgeText}>FFmpeg</Text></View>
          ) : null}
          <View style={[root.badge, { backgroundColor: '#00E5A022', borderColor: '#00E5A044' }]}>
            <Text style={[root.badgeText, { color: '#00E5A0' }]}>Skia</Text>
          </View>
        </View>
        <View style={{ width: 36 }} />
      </View>

      <Animated.View style={[{ flex: 1 }, tabSty]}>
        {tab === 'ar'      ? <EffectsTab />  : null}
        {tab === 'videos'  ? <VideosTab />   : null}
        {tab === 'avatars' ? <AvatarsTab />  : null}
        {tab === 'music'   ? <MusicTab />    : null}
      </Animated.View>

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
// TAB 1 — EFFECTS  (DeepAR primary / Skia+Camera fallback)
// ═════════════════════════════════════════════════════════════════════════════
function EffectsTab() {
  const { addVideo }  = useFeed();
  const { showAlert } = useAlert();
  const router        = useRouter();

  // Camera refs — DeepAR or expo-camera
  const deepARRef  = useRef<any>(null);
  const cameraRef  = useRef<any>(null);

  const deepARActive = isDeepARAvailable();
  // Guard: only render when it is a valid callable React component
  const deepARCameraOk: boolean =
    deepARActive &&
    DeepARCameraComponent !== null &&
    DeepARCameraComponent !== undefined &&
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
  const [filterCategory,  setFilterCategory]  = useState<'deepar' | 'skia'>('deepar');

  const recTimerRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const deepARTimeoutRef = useRef<ReturnType<typeof setTimeout>  | null>(null);

  const [camPerm, requestCamPerm] = useSafeCameraPermissions();
  const hasPerm = camPerm?.granted ?? false;

  // Request permissions: DeepAR's own permission system + expo-camera as fallback
  useEffect(() => {
    async function initPerms() {
      console.log('[EffectsTab] initPerms — deepARActive:', deepARActive);
      if (deepARActive) {
        const ok = await requestDeepARPermissions();
        console.log('[EffectsTab] DeepAR perm result:', ok);
      }
      // Always also request via expo-camera (belt-and-suspenders for AVFoundation)
      await requestCamPerm();
    }
    initPerms();
  }, []);

  useEffect(() => () => {
    if (recTimerRef.current)    clearInterval(recTimerRef.current);
    if (deepARTimeoutRef.current) clearTimeout(deepARTimeoutRef.current);
  }, []);

  // Safety timeout: if onInitialized never fires within 8s, force ready state
  // (prevents infinite "Iniciando DeepAR..." spinner in case of a silent SDK issue)
  useEffect(() => {
    if (!deepARCameraOk) return;
    deepARTimeoutRef.current = setTimeout(() => {
      console.warn('[DeepAR] ⚠️ onInitialized timeout — forcing ready state after 8s');
      setDeepARReady(true);
    }, 8000);
    return () => { if (deepARTimeoutRef.current) clearTimeout(deepARTimeoutRef.current); };
  }, [deepARCameraOk]);

  const shutterScale = useSharedValue(1);
  const shutterSty   = useAnimatedStyle(() => ({ transform: [{ scale: shutterScale.value }] }));

  // ── DeepAR filter select ────────────────────────────────────────────────
  const handleDeepARFilter = useCallback((filter: DeepARFilter) => {
    if (deepARFilterId === filter.id) {
      clearDeepAREffect(deepARRef);
      setDeepARFilterId(null);
    } else {
      switchDeepAREffect(deepARRef, filter);
      setDeepARFilterId(filter.id);
    }
  }, [deepARFilterId]);

  // ── Capture photo ───────────────────────────────────────────────────────
  const capturePhoto = useCallback(async () => {
    if (isCapturing) return;
    setIsCapturing(true);
    shutterScale.value = withSequence(withSpring(0.82), withSpring(1));

    if (deepARActive && deepARRef.current) {
      // DeepAR capture — onScreenshotTaken fires the callback
      triggerDeepARScreenshot(deepARRef);
      // Give DeepAR time to process
      setTimeout(() => setIsCapturing(false), 1500);
    } else if (cameraRef.current) {
      try {
        const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
        setCapturedUri(photo.uri);
        setMode('preview');
      } catch { showAlert('Error', 'No se pudo capturar la foto'); }
      setIsCapturing(false);
    } else {
      setIsCapturing(false);
    }
  }, [isCapturing, deepARActive, showAlert]);

  // ── Record video ────────────────────────────────────────────────────────
  const toggleRecord = useCallback(async () => {
    if (isRecording) {
      if (deepARActive) {
        stopDeepARRecording(deepARRef);
      } else if (cameraRef.current) {
        try { await cameraRef.current.stopRecording(); } catch (_) {}
      }
      if (recTimerRef.current) clearInterval(recTimerRef.current);
      setIsRecording(false); setRecSeconds(0);
    } else {
      setIsRecording(true); setRecSeconds(0);
      recTimerRef.current = setInterval(() => setRecSeconds(s => s + 1), 1000);
      if (deepARActive) {
        startDeepARRecording(deepARRef);
      } else if (cameraRef.current) {
        try {
          const video = await cameraRef.current.recordAsync({ maxDuration: 60 });
          if (recTimerRef.current) clearInterval(recTimerRef.current);
          setIsRecording(false); setRecSeconds(0);
          if (video?.uri) { setCapturedUri(video.uri); setMode('preview'); }
        } catch (_) {
          if (recTimerRef.current) clearInterval(recTimerRef.current);
          setIsRecording(false); setRecSeconds(0);
        }
      }
    }
  }, [isRecording, deepARActive]);

  // ── Publish ─────────────────────────────────────────────────────────────
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

  const fmtSec = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  // ── Preview mode ──────────────────────────────────────────────────────────
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
          {deepARActive ? (
            <View style={ef.deepARLiveBadge}>
              <LinearGradient colors={['#FF2D78','#7C5CFF']} style={ef.deepARLiveBadgeInner}>
                <Text style={ef.deepARLiveBadgeText}>DeepAR</Text>
              </LinearGradient>
            </View>
          ) : null}
        </View>
        <View style={ef.actionRow}>
          <Pressable style={ef.retakeBtn} onPress={() => { setCapturedUri(null); setMode('camera'); }}>
            <MaterialCommunityIcons name="camera-retake" size={18} color={Colors.textSecondary} />
            <Text style={ef.retakeBtnText}>Volver</Text>
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

  // ── No camera (web) ───────────────────────────────────────────────────────
  if (!CameraView && !DeepARCameraComponent) {
    return (
      <View style={ef.noPerm}>
        <MaterialCommunityIcons name="alert-circle-outline" size={52} color={Colors.warning} />
        <Text style={ef.noPermTitle}>Requiere EAS Build</Text>
        <Text style={ef.noPermSub}>La cámara y efectos DeepAR/Skia requieren build nativo</Text>
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

  if (!hasPerm && !deepARActive) {
    return (
      <View style={ef.noPerm}>
        <MaterialIcons name="no-photography" size={52} color={Colors.textSubtle} />
        <Text style={ef.noPermTitle}>Permiso de cámara requerido</Text>
        <Pressable style={ef.permBtn} onPress={requestCamPerm}>
          <LinearGradient colors={['#7C5CFF','#FF2D78']} style={ef.permBtnInner}>
            <Text style={ef.permBtnText}>Conceder permiso</Text>
          </LinearGradient>
        </Pressable>
      </View>
    );
  }

  const camH           = W * 1.25;
  const deepARFilters  = DEEPAR_FILTERS;
  const faceFilters    = deepARFilters.filter(f => f.category === 'face');
  const beautyFilters  = deepARFilters.filter(f => f.category === 'beauty');
  const bgFilters      = deepARFilters.filter(f => f.category === 'background');
  const socialFilters  = deepARFilters.filter(f => f.category === 'social');
  const colorEffects   = SKIA_EFFECTS.filter(e => e.category === 'color' || e.category === 'new');
  const gpuEffects     = SKIA_EFFECTS.filter(e => e.category === 'gpu' || e.category === 'overlay');

  return (
    <View style={{ flex: 1 }}>
      {/* ── Camera area ───────────────────────────────────────────────── */}
      <View
        style={[ef.cameraWrap, { height: camH }]}
        onLayout={e => setCamLayout({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      >
        {/*
          DeepAR Camera — primary when available.
          Props (react-native-deepar v0.11 API):
            apiKey        — licence string
            cameraFacing  — "front" | "back"  ← correct prop name (NOT "facing")
            onInitialized — () => void  ← fires once SDK + AVFoundation are ready
            onScreenshotTaken — (path: string) => void
            onVideoRecordingFinished — (path: string) => void
            onError — (text: string, type: number) => void
        */}
        {deepARCameraOk ? (
          <DeepARCameraComponent
            ref={deepARRef}
            apiKey={DEEPAR_API_KEY}
            style={StyleSheet.absoluteFillObject}
            cameraFacing={facing}
            onInitialized={() => {
              console.log('[DeepAR] ✅ onInitialized fired — camera session ready');
              if (deepARTimeoutRef.current) clearTimeout(deepARTimeoutRef.current);
              setDeepARReady(true);
            }}
            onScreenshotTaken={(path: string) => {
              console.log('[DeepAR] Screenshot saved:', path);
              setCapturedUri(path);
              setMode('preview');
              setIsCapturing(false);
            }}
            onVideoRecordingFinished={(path: string) => {
              console.log('[DeepAR] Video saved:', path);
              if (recTimerRef.current) clearInterval(recTimerRef.current);
              setIsRecording(false); setRecSeconds(0);
              setCapturedUri(path); setMode('preview');
            }}
            onError={(text: string, type: number) => {
              console.error('[DeepAR] ❌ Error type', type, ':', text);
              // On error, clear timeout and mark ready to dismiss infinite spinner
              if (deepARTimeoutRef.current) clearTimeout(deepARTimeoutRef.current);
              setDeepARReady(true);
              showAlert('DeepAR Error', `[${type}] ${text}`);
            }}
          />
        ) : (
          /* expo-camera fallback */
          CameraView ? (
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFillObject}
              facing={facing}
              mode="video"
            />
          ) : null
        )}

        {/* Skia overlays — only when DeepAR not active */}
        {!deepARActive && skiaEffectId !== 'none' ? (
          <SkiaEffectsLayer effectId={skiaEffectId} width={camLayout.width} height={camLayout.height} />
        ) : null}

        {/* Status overlays */}
        {isRecording ? (
          <View style={ef.recIndicator}>
            <PulsingDot color="#FF3B3B" />
            <Text style={ef.recText}>REC {fmtSec(recSeconds)}</Text>
          </View>
        ) : null}

        {deepARActive && !deepARReady ? (
          <View style={ef.deepARLoading}>
            <ActivityIndicator color="#fff" size="small" />
            <Text style={ef.deepARLoadingText}>Iniciando DeepAR...</Text>
          </View>
        ) : null}

        {deepARFilterId ? (
          <View style={ef.effectBadge}>
            <Text style={ef.effectBadgeText}>
              {deepARFilters.find(f => f.id === deepARFilterId)?.emoji} {deepARFilters.find(f => f.id === deepARFilterId)?.name}
            </Text>
          </View>
        ) : skiaEffectId !== 'none' ? (
          <View style={ef.effectBadge}>
            <Text style={ef.effectBadgeText}>
              {SKIA_EFFECTS.find(e => e.id === skiaEffectId)?.emoji} {SKIA_EFFECTS.find(e => e.id === skiaEffectId)?.name}
            </Text>
          </View>
        ) : null}

        {/* DeepAR live badge */}
        {deepARActive && deepARReady ? (
          <View style={ef.deepARLiveBadge}>
            <LinearGradient colors={['#FF2D78','#7C5CFF']} style={ef.deepARLiveBadgeInner}>
              <PulsingDot color="#fff" />
              <Text style={ef.deepARLiveBadgeText}>DeepAR LIVE</Text>
            </LinearGradient>
          </View>
        ) : null}

        {/* Flip button */}
        <Pressable style={ef.flipBtn} onPress={() => setFacing(f => f === 'front' ? 'back' : 'front')}>
          <MaterialCommunityIcons name="camera-flip-outline" size={22} color="#fff" />
        </Pressable>
      </View>

      {/* ── Filter/Effect tabs ─────────────────────────────────────────── */}
      {deepARActive ? (
        <View style={ef.categoryTabRow}>
          <Pressable style={[ef.categoryTab, filterCategory === 'deepar' && ef.categoryTabActive]}
            onPress={() => setFilterCategory('deepar')}>
            <LinearGradient colors={filterCategory === 'deepar' ? ['#FF2D78','#7C5CFF'] : ['transparent','transparent']}
              style={StyleSheet.absoluteFillObject} />
            <MaterialCommunityIcons name="face-recognition" size={14} color={filterCategory === 'deepar' ? '#fff' : Colors.textSubtle} />
            <Text style={[ef.categoryTabText, filterCategory === 'deepar' && { color: '#fff' }]}>DeepAR</Text>
          </Pressable>
          <Pressable style={[ef.categoryTab, filterCategory === 'skia' && ef.categoryTabActive]}
            onPress={() => setFilterCategory('skia')}>
            <LinearGradient colors={filterCategory === 'skia' ? ['#00E5A0','#2D9EFF'] : ['transparent','transparent']}
              style={StyleSheet.absoluteFillObject} />
            <MaterialCommunityIcons name="palette-outline" size={14} color={filterCategory === 'skia' ? '#fff' : Colors.textSubtle} />
            <Text style={[ef.categoryTabText, filterCategory === 'skia' && { color: '#fff' }]}>Skia GPU</Text>
          </Pressable>
        </View>
      ) : null}

      {/* ── Effect strip ──────────────────────────────────────────────── */}
      {(!deepARActive || filterCategory === 'skia') ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          style={ef.filterScrollWrap}
          contentContainerStyle={ef.filterStrip}>
          <Text style={ef.sectionLabel}>COLOR</Text>
          {colorEffects.map(e => (
            <Pressable key={e.id}
              style={[ef.chip, skiaEffectId === e.id && ef.chipActive]}
              onPress={() => { setSkiaEffectId(e.id); setDeepARFilterId(null); }}>
              <LinearGradient colors={e.gradient} style={ef.chipGrad} />
              <Text style={ef.chipEmoji}>{e.emoji}</Text>
              <Text style={[ef.chipName, skiaEffectId === e.id && { color: '#fff' }]}>{e.name}</Text>
              {e.category === 'new' ? <View style={ef.newBadge}><Text style={ef.newBadgeText}>GPU</Text></View> : null}
              {skiaEffectId === e.id ? <View style={ef.chipDot} /> : null}
            </Pressable>
          ))}
          <View style={ef.divider} />
          <Text style={ef.sectionLabel}>ANIMADOS</Text>
          {gpuEffects.map(e => (
            <Pressable key={e.id}
              style={[ef.chip, skiaEffectId === e.id && ef.chipActive]}
              onPress={() => { setSkiaEffectId(e.id); setDeepARFilterId(null); }}>
              <LinearGradient colors={e.gradient} style={ef.chipGrad} />
              <Text style={ef.chipEmoji}>{e.emoji}</Text>
              <Text style={[ef.chipName, skiaEffectId === e.id && { color: '#fff' }]}>{e.name}</Text>
              {skiaEffectId === e.id ? <View style={ef.chipDot} /> : null}
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {/* ── DeepAR filter grid ────────────────────────────────────────── */}
      {deepARActive && filterCategory === 'deepar' ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          style={ef.filterScrollWrap}
          contentContainerStyle={ef.filterStrip}>
          <Text style={ef.sectionLabel}>CARA</Text>
          {faceFilters.map(f => (
            <Pressable key={f.id}
              style={[ef.chip, deepARFilterId === f.id && ef.chipDeepARActive]}
              onPress={() => handleDeepARFilter(f)}>
              <LinearGradient colors={['#FF2D7844','#7C5CFF44']} style={ef.chipGrad} />
              <Text style={ef.chipEmoji}>{f.emoji}</Text>
              <Text style={[ef.chipName, deepARFilterId === f.id && { color: '#FF2D78' }]}>{f.name}</Text>
              {deepARFilterId === f.id ? <View style={[ef.chipDot, { backgroundColor: '#FF2D78' }]} /> : null}
            </Pressable>
          ))}
          <View style={ef.divider} />
          <Text style={ef.sectionLabel}>BEAUTY</Text>
          {beautyFilters.map(f => (
            <Pressable key={f.id}
              style={[ef.chip, deepARFilterId === f.id && ef.chipDeepARActive]}
              onPress={() => handleDeepARFilter(f)}>
              <LinearGradient colors={['#FF9D0044','#FF2D7844']} style={ef.chipGrad} />
              <Text style={ef.chipEmoji}>{f.emoji}</Text>
              <Text style={[ef.chipName, deepARFilterId === f.id && { color: '#FF2D78' }]}>{f.name}</Text>
              {deepARFilterId === f.id ? <View style={[ef.chipDot, { backgroundColor: '#FF9D00' }]} /> : null}
            </Pressable>
          ))}
          <View style={ef.divider} />
          <Text style={ef.sectionLabel}>FONDO</Text>
          {bgFilters.map(f => (
            <Pressable key={f.id}
              style={[ef.chip, deepARFilterId === f.id && ef.chipDeepARActive]}
              onPress={() => handleDeepARFilter(f)}>
              <LinearGradient colors={['#7C5CFF44','#00E5A044']} style={ef.chipGrad} />
              <Text style={ef.chipEmoji}>{f.emoji}</Text>
              <Text style={[ef.chipName, deepARFilterId === f.id && { color: '#00E5A0' }]}>{f.name}</Text>
              {deepARFilterId === f.id ? <View style={[ef.chipDot, { backgroundColor: '#00E5A0' }]} /> : null}
            </Pressable>
          ))}
          <View style={ef.divider} />
          <Text style={ef.sectionLabel}>SOCIAL</Text>
          {socialFilters.map(f => (
            <Pressable key={f.id}
              style={[ef.chip, deepARFilterId === f.id && ef.chipDeepARActive]}
              onPress={() => handleDeepARFilter(f)}>
              <LinearGradient colors={['#FF9D0044','#FF5A0044']} style={ef.chipGrad} />
              <Text style={ef.chipEmoji}>{f.emoji}</Text>
              <Text style={[ef.chipName, deepARFilterId === f.id && { color: '#FF9D00' }]}>{f.name}</Text>
              {deepARFilterId === f.id ? <View style={[ef.chipDot, { backgroundColor: '#FF9D00' }]} /> : null}
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {/* ── Capture row ─────────────────────────────────────────────────── */}
      <View style={ef.captureRow}>
        <Pressable style={[ef.recordBtn, isRecording && ef.recordBtnActive]} onPress={toggleRecord}>
          <LinearGradient colors={isRecording ? ['#FF3B3B','#CC1A1A'] : ['#333','#222']} style={ef.recordBtnInner}>
            <MaterialCommunityIcons name={isRecording ? 'stop' : 'video-outline'} size={22} color="#fff" />
          </LinearGradient>
        </Pressable>

        <Animated.View style={shutterSty}>
          <Pressable style={ef.shutterOuter} onPress={capturePhoto} disabled={isCapturing || isRecording}>
            <LinearGradient colors={['#FF2D78','#7C5CFF']} style={ef.shutterInner}>
              {isCapturing
                ? <ActivityIndicator color="#fff" size="small" />
                : <MaterialCommunityIcons name="camera" size={32} color="#fff" />}
            </LinearGradient>
          </Pressable>
        </Animated.View>

        <Pressable style={ef.recordBtn} onPress={async () => {
          const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!p.granted) return;
          const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [3,4], quality: 0.9 });
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
  categoryTabRow:      { flexDirection: 'row', backgroundColor: Colors.bg, borderBottomWidth: 1, borderBottomColor: Colors.border },
  categoryTab:         { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, position: 'relative', overflow: 'hidden', borderRadius: 0 },
  categoryTabActive:   {},
  categoryTabText:     { color: Colors.textSubtle, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  filterScrollWrap:    { backgroundColor: Colors.bg, maxHeight: 90 },
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
  newBadge:            { position: 'absolute', top: 3, left: 3, backgroundColor: '#00E5A0', borderRadius: 4, paddingHorizontal: 3, paddingVertical: 1 },
  newBadgeText:        { color: '#000', fontSize: 7, fontWeight: FontWeight.bold },
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
  actionRow:           { flexDirection: 'row', gap: 12 },
  retakeBtn:           { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: Radius.lg, backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border },
  retakeBtnText:       { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  publishBtn:          { flex: 2, borderRadius: Radius.lg, overflow: 'hidden' },
  publishBtnGrad:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  publishBtnText:      { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
});

// ═════════════════════════════════════════════════════════════════════════════
// VIDEO PLAYER COMPONENT
// ═════════════════════════════════════════════════════════════════════════════
function ClipVideoPlayer({ uri, volume, rate, onDuration, onPosition, onPlayingChange, playerRef }: {
  uri: string; volume: number; rate: number;
  onDuration: (ms: number) => void; onPosition: (ms: number) => void;
  onPlayingChange: (p: boolean) => void; playerRef: React.MutableRefObject<any>;
}) {
  const player = useVideoPlayer({ uri }, p => {
    p.volume = volume; p.playbackRate = rate; p.loop = false;
  });
  React.useEffect(() => { playerRef.current = player; }, [player]);
  React.useEffect(() => { try { player.volume = volume; } catch (_) {} }, [volume]);
  React.useEffect(() => { try { player.playbackRate = rate; } catch (_) {} }, [rate]);
  React.useEffect(() => {
    const iv = setInterval(() => {
      try {
        onPosition(((player as any).currentTime ?? 0) * 1000);
        const dur = (player as any).duration ?? 0;
        if (dur > 0) onDuration(dur * 1000);
        onPlayingChange((player as any).playing ?? false);
      } catch (_) {}
    }, 250);
    return () => clearInterval(iv);
  }, [player]);
  return <VideoView player={player} style={vid.player} contentFit="cover" nativeControls={false} />;
}

// ═════════════════════════════════════════════════════════════════════════════
// TAB 2 — VIDEOS  (FFmpeg + seek preview + Skia color preview)
// ═════════════════════════════════════════════════════════════════════════════
const SPEED_PRESETS = [
  { label: '0.3×', value: 0.3 }, { label: '0.5×', value: 0.5 },
  { label: '1×',   value: 1.0 }, { label: '2×',   value: 2.0 },
  { label: '3×',   value: 3.0 }, { label: '4×',   value: 4.0 },
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
  { id: 'pop',        q: 'top pop 2025',       label: 'Pop',         emoji: '🎤' },
  { id: 'reggaeton',  q: 'reggaeton hits',      label: 'Reggaetón',   emoji: '🔥' },
  { id: 'hiphop',     q: 'hip hop rap',         label: 'Hip Hop',     emoji: '🎧' },
  { id: 'electronic', q: 'electronic edm',      label: 'Electrónica', emoji: '⚡' },
  { id: 'lofi',       q: 'lofi chill beats',    label: 'Lo-Fi',       emoji: '☕' },
  { id: 'latin',      q: 'latin hits',          label: 'Latino',      emoji: '🌶️' },
  { id: 'viral',      q: 'trending viral 2025', label: 'Viral',       emoji: '📈' },
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

  // Skia color preview over video player
  const skiaPreviewId = colorFilter !== 'none' ? colorFilter as SkiaEffectId : 'none';

  useEffect(() => () => { soundRef.current?.unloadAsync().catch(() => {}); }, []);

  const pickClip = useCallback(async () => {
    if (clips.length >= 5) { showAlert('Máximo 5 clips', 'Ya tienes el máximo'); return; }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
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
      if (isPlaying) { p.pause?.(); setIsPlaying(false); }
      else           { p.play?.();  setIsPlaying(true);  }
    } catch (_) {}
  }, [isPlaying]);

  // ── Seek by tapping on timeline ──────────────────────────────────────────
  const seekTo = useCallback((fraction: number) => {
    if (!playerRef.current || durationMs <= 0) return;
    try {
      const seekMs = fraction * durationMs;
      playerRef.current.currentTime = seekMs / 1000;
    } catch (_) {}
  }, [durationMs]);

  const handleSetSpeed = useCallback((v: number) => {
    setSpeed(v);
    try { if (playerRef.current) playerRef.current.playbackRate = v; } catch (_) {}
  }, []);

  // ── FFmpeg Export + Publish ───────────────────────────────────────────────
  const handleExportAndPublish = useCallback(async () => {
    if (!activeClip) return;
    setIsPublishing(true); setIsExporting(true); setExportProgress('Iniciando...');
    try {
      const result = await exportFinal({
        clips: clips.map(c => ({
          uri:        c.uri,
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
        videoUrl:     finalUri,
        thumbnailUrl: '',
        caption:      caption.trim() || `🎬 ${colorFilter !== 'none' ? `#${colorFilter} ` : ''}${speed !== 1 ? `${speed}× ` : ''}#ClipDAG`,
        music:        selectedTrack ? `${selectedTrack.title} — ${selectedTrack.artist.name}` : 'Sin música',
        username: '', userAvatar: '',
      });

      showAlert('Publicado 🎉', isFFmpegAvailable() ? 'Video exportado con FFmpeg y publicado' : 'Clip publicado al feed', [
        { text: 'Ver feed', onPress: () => router.replace('/(tabs)') },
      ]);
      setCaptionModal(false);
    } catch (e: any) {
      showAlert('Error', e?.message || 'No se pudo publicar');
    } finally {
      setIsPublishing(false); setIsExporting(false); setExportProgress(null);
    }
  }, [activeClip, clips, trimStart, trimEnd, speed, colorFilter, selectedTrack, musicVol, videoVol, caption, addVideo, showAlert, router]);

  const TRACK_W     = W - 32;
  const trimDurSec  = durationMs > 0 ? Math.round((trimEnd - trimStart) * durationMs / 1000) : 0;
  const exportedDur = trimDurSec > 0 ? (speed !== 1 ? Math.round(trimDurSec / speed) : trimDurSec) : 0;

  if (clips.length === 0) {
    return (
      <View style={vid.empty}>
        <LinearGradient colors={['#1A1228','#0E0E18']} style={StyleSheet.absoluteFillObject} />
        <MaterialCommunityIcons name="video-plus-outline" size={60} color={Colors.primary} />
        <Text style={vid.emptyTitle}>Importa clips para editar</Text>
        <Text style={vid.emptySub}>Trim, merge, filtros FFmpeg, Skia preview, música Deezer</Text>
        {isFFmpegAvailable() ? (
          <View style={vid.ffmpegBadge}>
            <MaterialCommunityIcons name="check-circle" size={14} color="#00E5A0" />
            <Text style={vid.ffmpegBadgeText}>FFmpeg activo — edición real</Text>
          </View>
        ) : (
          <View style={vid.ffmpegBadge}>
            <MaterialCommunityIcons name="information" size={14} color={Colors.warning} />
            <Text style={[vid.ffmpegBadgeText, { color: Colors.warning }]}>FFmpeg disponible en EAS Build</Text>
          </View>
        )}
        <Pressable style={vid.emptyBtn} onPress={pickClip}>
          <LinearGradient colors={['#7C5CFF','#FF2D78']} style={vid.emptyBtnInner}>
            <MaterialCommunityIcons name="plus" size={22} color="#fff" />
            <Text style={vid.emptyBtnText}>Importar primer clip</Text>
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

      {/* Video player with Skia color preview overlay */}
      {activeClip ? (
        <View style={vid.playerWrap}>
          <ClipVideoPlayer key={activeClip.id} uri={activeClip.uri} volume={videoVol} rate={speed}
            onDuration={setDurationMs} onPosition={setPositionMs} onPlayingChange={setIsPlaying}
            playerRef={playerRef} />
          {/* Skia ColorMatrix preview over video */}
          {skiaPreviewId !== 'none' ? (
            <SkiaEffectsLayer effectId={skiaPreviewId} width={W} height={W * 0.62} />
          ) : null}
          <Pressable style={vid.playOverlay} onPress={togglePlay}>
            {!isPlaying
              ? <View style={vid.playBtn}><MaterialIcons name="play-arrow" size={42} color="#fff" /></View>
              : <View style={vid.pauseBtn}><MaterialIcons name="pause" size={26} color="#fff" /></View>}
          </Pressable>
          {speed !== 1 ? (
            <View style={vid.speedBadge}>
              <PulsingDot color="#FF9D00" /><Text style={vid.speedBadgeText}>{speed}×</Text>
            </View>
          ) : null}
          {selectedTrack ? (
            <View style={vid.musicBadge}>
              <MaterialCommunityIcons name="music-note" size={11} color="#fff" />
              <Text style={vid.musicBadgeText} numberOfLines={1}>{selectedTrack.title}</Text>
            </View>
          ) : null}
          {colorFilter !== 'none' ? (
            <View style={vid.filterBadge}>
              <MaterialCommunityIcons name="palette" size={11} color="#fff" />
              <Text style={vid.musicBadgeText}>{colorFilter}</Text>
              {isFFmpegAvailable() ? <Text style={{ color: '#00E5A0', fontSize: 8 }}> FFmpeg</Text> : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Timeline — tap to seek */}
      {durationMs > 0 ? (
        <>
          <View style={vid.timeRow}>
            <Text style={vid.timeText}>{fmtMs(positionMs)}</Text>
            {trimDurSec > 0 ? (
              <View style={{ alignItems: 'center' }}>
                <Text style={[vid.timeText, { color: Colors.primary }]}>{trimDurSec}s selec.</Text>
                {exportedDur !== trimDurSec ? (
                  <Text style={{ color: Colors.warning, fontSize: 10 }}>→ {exportedDur}s exportado ({speed}×)</Text>
                ) : null}
              </View>
            ) : null}
            <Text style={vid.timeText}>{fmtMs(durationMs)}</Text>
          </View>
          {/* Seek bar — tap to jump */}
          <View style={[vid.seekBar, { width: TRACK_W, marginHorizontal: 16 }]}>
            <LinearGradient colors={['#7C5CFF44','#FF2D7844']} start={{ x:0,y:0 }} end={{ x:1,y:0 }} style={StyleSheet.absoluteFillObject} />
            <Pressable
              style={StyleSheet.absoluteFillObject}
              onStartShouldSetResponder={() => true}
              onResponderMove={e => {
                const x = e.nativeEvent.pageX - 16;
                seekTo(Math.max(0, Math.min(1, x / TRACK_W)));
              }}
              onPress={e => {
                const x = e.nativeEvent.pageX - 16;
                seekTo(Math.max(0, Math.min(1, x / TRACK_W)));
              }}
            />
            {/* Playhead */}
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
            onResponderMove={e => {
              const x = e.nativeEvent.pageX - 16;
              setTrimStart(Math.max(0, Math.min(trimEnd - 0.05, x / TRACK_W)));
            }}>
            <LinearGradient colors={['#7C5CFF','#FF2D78']} style={vid.handle}>
              <Text style={vid.handleIcon}>◂</Text>
            </LinearGradient>
          </Pressable>
          <Pressable style={[vid.handleTouch, { left: Math.min(TRACK_W - 36, trimEnd * TRACK_W - 18) }]}
            onStartShouldSetResponder={() => true}
            onResponderMove={e => {
              const x = e.nativeEvent.pageX - 16;
              setTrimEnd(Math.min(1, Math.max(trimStart + 0.05, x / TRACK_W)));
            }}>
            <LinearGradient colors={['#FF2D78','#7C5CFF']} style={vid.handle}>
              <Text style={vid.handleIcon}>▸</Text>
            </LinearGradient>
          </Pressable>
        </View>
        {isFFmpegAvailable()
          ? <Text style={vid.ffmpegHint}>✅ FFmpeg activo — trim aplicado al exportar</Text>
          : <Text style={vid.trimHint}>Arrastra los marcadores — trim real en EAS Build</Text>}
      </View>

      {/* Speed */}
      <View style={vid.section}>
        <Text style={vid.sectionTitle}>⚡ Velocidad</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ flexDirection: 'row', gap: 8 }}>
          {SPEED_PRESETS.map(sp => (
            <Pressable key={sp.value}
              style={[vid.speedChip, speed === sp.value && vid.speedChipActive]}
              onPress={() => handleSetSpeed(sp.value)}>
              <Text style={[vid.speedLabel, speed === sp.value && { color: '#fff' }]}>{sp.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {speed !== 1 && exportedDur > 0 ? (
          <Text style={{ color: Colors.warning, fontSize: 11, marginTop: 4 }}>
            Duración exportada: ~{exportedDur}s (de {trimDurSec}s a {speed}×)
          </Text>
        ) : null}
      </View>

      {/* Color filter — Skia live preview + FFmpeg export */}
      <View style={vid.section}>
        <View style={vid.sectionRow}>
          <Text style={vid.sectionTitle}>🎨 Filtro de video</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <View style={vid.previewLabel}><Text style={vid.previewLabelText}>Skia preview</Text></View>
            {isFFmpegAvailable() ? <View style={[vid.previewLabel, { backgroundColor: '#00E5A022', borderColor: '#00E5A044' }]}><Text style={[vid.previewLabelText, { color: '#00E5A0' }]}>FFmpeg export</Text></View> : null}
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ flexDirection: 'row', gap: 8 }}>
          {VIDEO_COLOR_FILTERS.map(f => (
            <Pressable key={f.id}
              style={[vid.filterChip, colorFilter === f.id && vid.filterChipActive]}
              onPress={() => setColorFilter(f.id)}>
              <LinearGradient colors={f.gradient} style={vid.filterChipGrad} />
              <Text style={vid.filterChipEmoji}>{f.emoji}</Text>
              <Text style={[vid.filterChipName, colorFilter === f.id && { color: '#fff' }]}>{f.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {colorFilter !== 'none' ? (
          <Text style={{ color: Colors.textSubtle, fontSize: 10, marginTop: 4 }}>
            Vista previa activa en el player — se aplicará como LUT real al exportar
          </Text>
        ) : null}
      </View>

      {/* Music */}
      <View style={vid.section}>
        <View style={vid.sectionRow}>
          <Text style={vid.sectionTitle}>🎵 Música</Text>
          {selectedTrack ? (
            <Pressable onPress={async () => {
              await soundRef.current?.stopAsync().catch(() => {});
              await soundRef.current?.unloadAsync().catch(() => {});
              soundRef.current = null;
              setSelectedTrack(null);
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
            <Text style={vid.addMusicBtnText}>{selectedTrack ? 'Cambiar música' : 'Añadir música de Deezer'}</Text>
          </LinearGradient>
        </Pressable>
      </View>

      {/* Volume mix */}
      {selectedTrack ? (
        <View style={vid.section}>
          <Text style={vid.sectionTitle}>🔊 Mezcla de audio</Text>
          <VolumeSlider label="Video" value={videoVol} onChange={setVideoVol} color={Colors.primary} />
          <VolumeSlider label="Música" value={musicVol} onChange={setMusicVol} color={Colors.warning} />
        </View>
      ) : null}

      {/* Publish */}
      <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
        <Pressable style={vid.publishBtn} onPress={() => setCaptionModal(true)} disabled={isExporting}>
          <LinearGradient colors={['#7C5CFF','#FF2D78']} style={vid.publishBtnInner}>
            <MaterialCommunityIcons name="send-circle-outline" size={20} color="#fff" />
            <Text style={vid.publishBtnText}>
              {isFFmpegAvailable() ? 'Exportar y publicar' : 'Publicar video'}
            </Text>
          </LinearGradient>
        </Pressable>
      </View>

      {/* Caption modal */}
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
          ) : (
            <View style={cm.pipelineWrap}>
              {[
                { label: `${clips.length} clip${clips.length > 1 ? 's' : ''}`, active: true },
                { label: trimDurSec > 0 ? `${trimDurSec}s recortado` : null, active: trimEnd - trimStart < 0.99 },
                { label: speed !== 1 ? `${speed}× → ${exportedDur}s` : null, active: speed !== 1 },
                { label: colorFilter !== 'none' ? colorFilter : null, active: colorFilter !== 'none' },
                { label: selectedTrack ? 'Música Deezer' : null, active: !!selectedTrack },
              ].filter(s => s.active && s.label).map((s, i) => (
                <View key={i} style={cm.pipelineChip}>
                  <Text style={cm.pipelineChipText}>{s.label}</Text>
                </View>
              ))}
            </View>
          )}
          <TextInput style={cm.input} value={caption} onChangeText={setCaption}
            placeholder="Escribe algo..." placeholderTextColor={Colors.textSubtle}
            multiline maxLength={200} autoFocus={!isExporting} />
          <Text style={cm.count}>{caption.length}/200</Text>
          <Pressable style={[cm.pubBtn, isPublishing && { opacity: 0.6 }]}
            onPress={handleExportAndPublish} disabled={isPublishing}>
            <LinearGradient colors={['#7C5CFF','#FF2D78']} style={cm.pubBtnInner}>
              {isPublishing ? <ActivityIndicator color="#fff" size="small" /> : null}
              <Text style={cm.pubBtnText}>
                {isPublishing ? (exportProgress ?? 'Procesando...') : (isFFmpegAvailable() ? '🚀 Exportar y publicar' : '🚀 Publicar')}
              </Text>
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
          onResponderMove={e => {
            const x = e.nativeEvent.pageX - 16 - 56;
            onChange(Math.max(0, Math.min(1, x / TRACK_W)));
          }} />
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
  filterBadge:      { position: 'absolute', bottom: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 5 },
  seekBar:          { height: 6, borderRadius: 3, backgroundColor: Colors.surface, overflow: 'hidden', position: 'relative', marginBottom: 4 },
  seekPlayhead:     { position: 'absolute', top: 0, bottom: 0, width: 3, backgroundColor: '#fff', borderRadius: 2 },
  timeRow:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 6 },
  timeText:         { color: Colors.textSubtle, fontSize: 11 },
  section:          { paddingHorizontal: 16, paddingTop: 18, gap: 10 },
  sectionRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 },
  sectionTitle:     { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  ffmpegHint:       { color: '#00E5A0', fontSize: 10 },
  previewLabel:     { backgroundColor: Colors.primary + '22', borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: Colors.primary + '44' },
  previewLabelText: { color: Colors.primary, fontSize: 9, fontWeight: FontWeight.semibold },
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
  trimHint:         { color: Colors.textSubtle, fontSize: 10, textAlign: 'center' },
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
  backdrop:         { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)' },
  sheet:            { backgroundColor: Colors.surfaceElevated, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 14, borderTopWidth: 1, borderColor: Colors.border },
  handle:           { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center' },
  title:            { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  progressWrap:     { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.primary + '22', borderRadius: Radius.md, padding: 12 },
  progressText:     { color: Colors.primary, fontSize: FontSize.sm, flex: 1 },
  pipelineWrap:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pipelineChip:     { backgroundColor: Colors.surface, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: Colors.border },
  pipelineChipText: { color: Colors.textSubtle, fontSize: 11 },
  input:            { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 12, color: Colors.textPrimary, fontSize: FontSize.md, minHeight: 80, textAlignVertical: 'top' },
  count:            { color: Colors.textSubtle, fontSize: 11, textAlign: 'right' },
  pubBtn:           { borderRadius: Radius.lg, overflow: 'hidden' },
  pubBtnInner:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  pubBtnText:       { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
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

  useEffect(() => { if (!visible) return; const cat = DEEZER_CATS.find(c => c.id === catId); if (cat) searchDeezer(cat.q); }, [catId, visible]);
  useEffect(() => {
    if (!search.trim()) { const cat = DEEZER_CATS.find(c => c.id === catId); if (cat) searchDeezer(cat.q); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchDeezer(search), 500);
  }, [search]);
  useEffect(() => {
    if (!visible) { soundRef.current?.stopAsync().catch(() => {}); soundRef.current?.unloadAsync().catch(() => {}); soundRef.current = null; setPreviewId(null); }
  }, [visible]);

  const handlePreview = useCallback(async (track: DeezerTrack) => {
    if (!track.preview) return;
    await soundRef.current?.stopAsync().catch(() => {}); await soundRef.current?.unloadAsync().catch(() => {}); soundRef.current = null;
    if (previewId === track.id) { setPreviewId(null); return; }
    setPreviewId(track.id);
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync({ uri: track.preview }, { shouldPlay: true, volume: 1.0, isLooping: false });
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
          <TextInput style={dm.search} value={search} onChangeText={setSearch} placeholder="Buscar canción o artista..." placeholderTextColor={Colors.textSubtle} />
          {search ? <Pressable style={{ position: 'absolute', right: 12 }} onPress={() => setSearch('')}><MaterialCommunityIcons name="close-circle" size={16} color={Colors.textSubtle} /></Pressable> : null}
        </View>
        {!search ? (
          <View style={{ height: 44 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 6 }}>
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
                        onPress={() => { handlePreview(item); }}>
                        <MaterialCommunityIcons name={isPrev ? 'pause' : 'play'} size={16} color={isPrev ? '#fff' : Colors.warning} />
                      </Pressable>
                    ) : null}
                    {isSel ? <MaterialIcons name="check-circle" size={20} color={Colors.warning} style={{ marginLeft: 6 }} /> : null}
                  </Pressable>
                );
              }}
              ListEmptyComponent={<View style={dm.center}><MaterialCommunityIcons name="music-off" size={38} color={Colors.textSubtle} /><Text style={dm.centerText}>Sin resultados</Text></View>}
            />}
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
// TAB 3 — AVATARS
// ═════════════════════════════════════════════════════════════════════════════
function AvatarsTab() {
  const router = useRouter();
  const STYLES = [
    { id: 'cartoon',   label: 'Cartoon',   emoji: '🎨', g: ['#7C5CFF','#B44FFF'] as [string,string] },
    { id: 'anime',     label: 'Anime',     emoji: '⛩️',  g: ['#FF2D78','#A855F7'] as [string,string] },
    { id: 'cinematic', label: 'Cinematic', emoji: '🎬', g: ['#FF9D00','#FF2D78'] as [string,string] },
    { id: 'pixel',     label: 'Pixel Art', emoji: '👾', g: ['#A855F7','#7C5CFF'] as [string,string] },
    { id: 'glass',     label: 'Glass',     emoji: '✨', g: ['#00E5A0','#2D9EFF'] as [string,string] },
    { id: 'neon',      label: 'Neon',      emoji: '🌈', g: ['#FF2D78','#7C5CFF'] as [string,string] },
  ];
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 20 }}>
      <Pressable style={av.hero} onPress={() => router.push('/ai-avatar')}>
        <LinearGradient colors={['#7C5CFF','#FF2D78','#FF9D00']} start={{ x:0,y:0 }} end={{ x:1,y:1 }} style={av.heroGrad}>
          <Text style={av.heroEmoji}>🤖</Text>
          <View style={{ flex: 1 }}>
            <Text style={av.heroTitle}>Generador de Avatares IA</Text>
            <Text style={av.heroSub}>Foto → Avatar estilizado → Video hablando</Text>
            <Text style={av.heroPowered}>Powered by Gemini + Sora-2 via OnSpace AI</Text>
          </View>
          <MaterialCommunityIcons name="arrow-right-circle" size={28} color="rgba(255,255,255,0.85)" />
        </LinearGradient>
      </Pressable>
      {isDeepARAvailable() ? (
        <View style={av.deepARCard}>
          <LinearGradient colors={['#FF2D7822','#7C5CFF22']} style={StyleSheet.absoluteFillObject} />
          <MaterialCommunityIcons name="face-recognition" size={24} color="#FF2D78" />
          <View style={{ flex: 1 }}>
            <Text style={av.deepARCardTitle}>DeepAR Avatar AR</Text>
            <Text style={av.deepARCardSub}>Face tracking activo — usa el tab Efectos para AR facial en vivo</Text>
          </View>
          <View style={av.deepARCardBadge}><Text style={av.deepARCardBadgeText}>LIVE</Text></View>
        </View>
      ) : null}
      <Text style={av.sectionLabel}>Estilos disponibles</Text>
      <View style={av.grid}>
        {STYLES.map(s => (
          <Pressable key={s.id} style={av.card} onPress={() => router.push('/ai-avatar')}>
            <LinearGradient colors={s.g} style={av.cardGrad} />
            <Text style={av.cardEmoji}>{s.emoji}</Text>
            <Text style={av.cardLabel}>{s.label}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable style={av.cta} onPress={() => router.push('/ai-avatar')}>
        <LinearGradient colors={['#7C5CFF','#FF2D78']} style={av.ctaInner}>
          <MaterialCommunityIcons name="magic-staff" size={20} color="#fff" />
          <Text style={av.ctaText}>Crear mi avatar ahora</Text>
        </LinearGradient>
      </Pressable>
    </ScrollView>
  );
}

const av = StyleSheet.create({
  hero:              { borderRadius: Radius.xl, overflow: 'hidden' },
  heroGrad:          { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18 },
  heroEmoji:         { fontSize: 38 },
  heroTitle:         { color: '#fff', fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  heroSub:           { color: 'rgba(255,255,255,0.75)', fontSize: FontSize.xs, marginTop: 2, lineHeight: 18 },
  heroPowered:       { color: 'rgba(255,255,255,0.5)', fontSize: 10, marginTop: 4 },
  deepARCard:        { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: Radius.lg, borderWidth: 1, borderColor: '#FF2D7844', overflow: 'hidden', position: 'relative' },
  deepARCardTitle:   { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  deepARCardSub:     { color: Colors.textSubtle, fontSize: FontSize.xs, marginTop: 2, lineHeight: 16 },
  deepARCardBadge:   { backgroundColor: '#FF2D78', borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  deepARCardBadgeText: { color: '#fff', fontSize: 10, fontWeight: FontWeight.bold },
  sectionLabel:      { color: Colors.textSubtle, fontSize: 10, fontWeight: FontWeight.bold, textTransform: 'uppercase', letterSpacing: 1 },
  grid:              { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card:              { width: (W - 42) / 3, alignItems: 'center', gap: 8, padding: 14, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.surface, position: 'relative' },
  cardGrad:          { width: 52, height: 52, borderRadius: 26 },
  cardEmoji:         { position: 'absolute', top: 20, fontSize: 22 },
  cardLabel:         { color: Colors.textSubtle, fontSize: 11, fontWeight: FontWeight.semibold },
  cta:               { borderRadius: Radius.xl, overflow: 'hidden' },
  ctaInner:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 18 },
  ctaText:           { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
});

// ═════════════════════════════════════════════════════════════════════════════
// TAB 4 — MUSIC
// ═════════════════════════════════════════════════════════════════════════════
function MusicTab() {
  const { showAlert } = useAlert();
  const soundRef      = useRef<Audio.Sound | null>(null);
  const [search,         setSearch]         = useState('');
  const [catId,          setCatId]          = useState('viral');
  const [tracks,         setTracks]         = useState<DeezerTrack[]>([]);
  const [loading,        setLoading]        = useState(false);
  const [previewId,      setPreviewId]      = useState<number | null>(null);
  const [selectedTrack,  setSelectedTrack]  = useState<DeezerTrack | null>(null);
  const [error,          setError]          = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { soundRef.current?.stopAsync().catch(() => {}); soundRef.current?.unloadAsync().catch(() => {}); }, []);

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

  useEffect(() => { const cat = DEEZER_CATS.find(c => c.id === catId); if (cat) searchDeezer(cat.q); }, [catId]);
  useEffect(() => {
    if (!search.trim()) { const cat = DEEZER_CATS.find(c => c.id === catId); if (cat) searchDeezer(cat.q); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchDeezer(search), 500);
  }, [search]);

  const handlePreview = useCallback(async (track: DeezerTrack) => {
    if (!track.preview) { showAlert('Sin preview', 'Esta canción no tiene preview'); return; }
    await soundRef.current?.stopAsync().catch(() => {}); await soundRef.current?.unloadAsync().catch(() => {}); soundRef.current = null;
    if (previewId === track.id) { setPreviewId(null); return; }
    setPreviewId(track.id);
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync({ uri: track.preview }, { shouldPlay: true, volume: 1.0, isLooping: false });
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
        {search ? <Pressable style={{ position: 'absolute', right: 14 }} onPress={() => setSearch('')}><MaterialCommunityIcons name="close-circle" size={16} color={Colors.textSubtle} /></Pressable> : null}
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
        <Pressable style={mu.nowPlaying} onPress={() => { soundRef.current?.stopAsync().catch(() => {}); soundRef.current?.unloadAsync().catch(() => {}); soundRef.current = null; setPreviewId(null); }}>
          <PulsingDot color={Colors.warning} />
          <Text style={mu.nowPlayingText} numberOfLines={1}>{tracks.find(t => t.id === previewId)?.title ?? 'Reproduciendo...'}</Text>
          <MaterialCommunityIcons name="stop-circle-outline" size={18} color={Colors.warning} />
        </Pressable>
      ) : null}
      {loading
        ? <View style={mu.center}><ActivityIndicator color={Colors.warning} size="large" /><Text style={mu.centerText}>Cargando desde Deezer...</Text></View>
        : error
        ? <View style={mu.center}><MaterialCommunityIcons name="wifi-off" size={44} color={Colors.textSubtle} /><Text style={mu.centerText}>{error}</Text><Pressable style={mu.retryBtn} onPress={() => { const c = DEEZER_CATS.find(x => x.id === catId); if (c) searchDeezer(c.q); }}><Text style={mu.retryBtnText}>Reintentar</Text></Pressable></View>
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
                        onPress={() => { handlePreview(item); }}>
                        <MaterialCommunityIcons name={isPrev ? 'pause' : 'play'} size={16} color={isPrev ? '#fff' : Colors.warning} />
                      </Pressable>
                    ) : null}
                    {isSel ? <MaterialIcons name="check-circle" size={20} color={Colors.warning} /> : null}
                  </View>
                </Pressable>
              );
            }}
            ListEmptyComponent={<View style={mu.center}><MaterialCommunityIcons name="music-off" size={40} color={Colors.textSubtle} /><Text style={mu.centerText}>Sin resultados</Text></View>}
          />}
      {selectedTrack ? (
        <View style={mu.actionBar}>
          <LinearGradient colors={['rgba(18,18,28,0.98)','#12121C']} style={StyleSheet.absoluteFillObject} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
            <PulsingDot color={Colors.warning} />
            <Text style={mu.selectedTitle} numberOfLines={1}>{selectedTrack.title} — {selectedTrack.artist.name}</Text>
          </View>
          <Pressable style={mu.useBtn} onPress={() => showAlert('Canción seleccionada', `"${selectedTrack.title}" lista. Ve al tab Videos para añadirla a tu clip.`)}>
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
  container:      { flex: 1, backgroundColor: Colors.bg },
  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border },
  backBtn:        { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surfaceElevated, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
  titleRow:       { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title:          { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  deepARBadge:    { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  deepARBadgeText:{ color: '#fff', fontSize: 9, fontWeight: FontWeight.bold },
  badge:          { backgroundColor: '#7C5CFF22', borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: '#7C5CFF44' },
  badgeText:      { color: '#7C5CFF', fontSize: 9, fontWeight: FontWeight.bold },
  tabBar:         { flexDirection: 'row', borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.bg },
  tabItem:        { flex: 1, alignItems: 'center', paddingVertical: 10, gap: 3, position: 'relative', overflow: 'hidden' },
  tabActiveGrad:  { ...StyleSheet.absoluteFillObject },
  tabLabel:       { color: Colors.textSubtle, fontSize: 9, fontWeight: FontWeight.medium },
  tabDot:         { position: 'absolute', top: 0, left: '20%', right: '20%', height: 2, borderRadius: 1 },
});
