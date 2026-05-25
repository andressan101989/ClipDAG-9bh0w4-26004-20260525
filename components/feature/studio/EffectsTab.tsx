/**
 * components/feature/studio/EffectsTab.tsx
 * Creator Studio — Tab 1: AR Camera + Skia Effects + DeepAR
 *
 * Isolation contract:
 *  - No imports from other studio tabs
 *  - DeepAR and Skia are mutually exclusive (Metal surface conflict)
 *  - expo-camera loaded lazily (crashes on web without native build)
 *  - react-native-deepar loaded via deeparService (already stubbed in metro)
 */
import React, {
  useState, useCallback, useRef, useEffect,
} from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView,
  ActivityIndicator, Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withSequence,
  withTiming, withRepeat, Easing,
} from 'react-native-reanimated';
import { useAlert } from '@/template';
import { useFeed } from '@/hooks/useFeed';
import { useRouter } from 'expo-router';
import {
  isDeepARAvailable, DEEPAR_API_KEY, DEEPAR_FILTERS,
  switchDeepAREffect, clearDeepAREffect,
  prefetchDeepARFilters,
  triggerDeepARScreenshot, startDeepARRecording,
  requestDeepARPermissions,
  DeepARCamera as DeepARCameraComponent,
  type DeepARFilter,
} from '@/services/deeparService';
import SkiaEffectsLayer, { type SkiaEffectId } from '@/components/feature/SkiaEffectsLayer';
import { Colors, FontSize, FontWeight, Radius } from '@/constants/theme';

// ── expo-camera (fallback when DeepAR unavailable) ─────────────────────────
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

// ── Skia effects catalog ───────────────────────────────────────────────────
interface EffectDef { id: SkiaEffectId; name: string; emoji: string; gradient: [string, string] }

const SKIA_EFFECTS: EffectDef[] = [
  { id: 'vintage',   name: 'Vintage',    emoji: '📷', gradient: ['#8B5E3C', '#C27540'] },
  { id: 'cine',      name: 'Cine',       emoji: '🎬', gradient: ['#1A1A2E', '#333355'] },
  { id: 'frio',      name: 'Frío',       emoji: '🧊', gradient: ['#2D9EFF', '#7CC4FF'] },
  { id: 'calido',    name: 'Cálido',     emoji: '🌅', gradient: ['#FF9D00', '#FF5A00'] },
  { id: 'bn',        name: 'B&N',        emoji: '⬛', gradient: ['#555', '#999'] },
  { id: 'neon',      name: 'Neón',       emoji: '🌈', gradient: ['#FF2D78', '#7C5CFF'] },
  { id: 'chromatic', name: 'Cromático',  emoji: '🔴', gradient: ['#FF0044', '#00FFCC'] },
  { id: 'particles', name: 'Partículas', emoji: '✨', gradient: ['#FFD700', '#FF9D00'] },
  { id: 'glitch',    name: 'Glitch',     emoji: '📺', gradient: ['#00FFFF', '#FF00FF'] },
  { id: 'hearts',    name: 'Corazones',  emoji: '💕', gradient: ['#FF2D78', '#FF6BA8'] },
  { id: 'rain',      name: 'Lluvia',     emoji: '🌧️', gradient: ['#2D9EFF', '#0050AA'] },
  { id: 'glow',      name: 'Glow',       emoji: '💜', gradient: ['#7C5CFF', '#A855F7'] },
];

// ── Helpers ────────────────────────────────────────────────────────────────
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

// ── Main component ─────────────────────────────────────────────────────────
export function EffectsTab() {
  const { addVideo }  = useFeed();
  const { showAlert } = useAlert();
  const router        = useRouter();

  const deepARRef  = useRef<any>(null);
  const cameraRef  = useRef<any>(null);

  const deepARActive   = isDeepARAvailable();
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
  const deepARTimeoutRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captureTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Safety timeout: force deepARReady=true after 2s
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

  // ── DeepAR filter select ─────────────────────────────────────────────────
  const handleDeepARFilter = useCallback(async (filter: DeepARFilter) => {
    if (deepARFilterId === filter.id) {
      clearDeepAREffect(deepARRef);
      setDeepARFilterId(null);
      setFilterLoadState(s => ({ ...s, [filter.id]: 'idle' }));
      return;
    }
    setSkiaEffectId('none'); // Metal surface conflict: disable Skia
    setDeepARFilterId(filter.id);
    await switchDeepAREffect(deepARRef, filter, (state, msg) => {
      setFilterLoadState(s => ({ ...s, [filter.id]: state }));
      if (state === 'error') {
        showAlert('Error de filtro', msg ?? 'No se pudo cargar el filtro');
        setDeepARFilterId(prev => prev === filter.id ? null : prev);
      }
    });
  }, [deepARFilterId, showAlert]);

  const clearAllEffects = useCallback(() => {
    setSkiaEffectId('none');
    if (deepARFilterId) { clearDeepAREffect(deepARRef); setDeepARFilterId(null); }
  }, [deepARFilterId]);

  // ── Photo capture ────────────────────────────────────────────────────────
  const capturePhoto = useCallback(async () => {
    if (isCapturing || isRecording) return;
    setIsCapturing(true);
    shutterScale.value = withSequence(withSpring(0.82), withSpring(1));

    if (deepARCameraOk && deepARReady && deepARRef.current) {
      captureTimeoutRef.current = setTimeout(async () => {
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
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [3, 4], quality: 0.9 });
      if (!result.canceled && result.assets[0]) { setCapturedUri(result.assets[0].uri); setMode('preview'); }
    }
    setIsCapturing(false);
  }, [isCapturing, isRecording, deepARCameraOk, deepARReady, showAlert]);

  // ── Video recording ──────────────────────────────────────────────────────
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

  // ── Preview mode ─────────────────────────────────────────────────────────
  if (mode === 'preview' && capturedUri) {
    const activeFilter = deepARFilterId
      ? DEEPAR_FILTERS.find(f => f.id === deepARFilterId)
      : SKIA_EFFECTS.find(e => e.id === skiaEffectId);
    return (
      <ScrollView showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 16 }}>
        <View style={[s.previewWrap, { width: W - 32, height: (W - 32) * 1.2 }]}>
          <Image source={{ uri: capturedUri }} style={StyleSheet.absoluteFillObject} contentFit="cover" transition={200} />
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.5)']} style={s.previewGrad} />
          {activeFilter ? (
            <View style={s.previewBadge}>
              <Text style={s.previewBadgeText}>{(activeFilter as any).emoji} {activeFilter.name}</Text>
            </View>
          ) : null}
        </View>
        <View style={s.actionRow}>
          <Pressable style={s.retakeBtn} onPress={() => { setCapturedUri(null); setMode('camera'); }}>
            <MaterialCommunityIcons name="camera-retake" size={18} color={Colors.textSecondary} />
            <Text style={s.retakeBtnText}>Volver</Text>
          </Pressable>
          <Pressable style={s.saveBtn} onPress={() => saveToGallery(capturedUri)}>
            <MaterialCommunityIcons name="download" size={18} color={Colors.textSecondary} />
            <Text style={s.retakeBtnText}>Guardar</Text>
          </Pressable>
          <Pressable style={s.publishBtn} onPress={handlePublish}>
            <LinearGradient colors={['#FF2D78', '#7C5CFF']} style={s.publishBtnGrad}>
              <MaterialCommunityIcons name="send" size={18} color="#fff" />
              <Text style={s.publishBtnText}>Publicar</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  const camH = W * 1.22;

  if (!CameraView && !DeepARCameraComponent) {
    return (
      <View style={s.noPerm}>
        <MaterialCommunityIcons name="cellphone-off" size={52} color={Colors.warning} />
        <Text style={s.noPermTitle}>Requiere dispositivo físico</Text>
        <Text style={s.noPermSub}>La cámara solo funciona en iPhone/Android con EAS Build o TestFlight</Text>
        <Pressable style={s.permBtn} onPress={async () => {
          const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!p.granted) return;
          const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [3, 4], quality: 0.9 });
          if (!r.canceled && r.assets[0]) { setCapturedUri(r.assets[0].uri); setMode('preview'); }
        }}>
          <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={s.permBtnInner}>
            <Text style={s.permBtnText}>Abrir galería</Text>
          </LinearGradient>
        </Pressable>
      </View>
    );
  }

  if (!hasPerm && !deepARCameraOk) {
    return (
      <View style={s.noPerm}>
        <MaterialIcons name="no-photography" size={52} color={Colors.textSubtle} />
        <Text style={s.noPermTitle}>Permiso de cámara requerido</Text>
        <Text style={s.noPermSub}>Necesitamos acceso a tu cámara para los efectos AR</Text>
        <Pressable style={s.permBtn} onPress={requestCamPerm}>
          <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={s.permBtnInner}>
            <Text style={s.permBtnText}>Conceder permiso</Text>
          </LinearGradient>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Camera viewport */}
      <View
        style={[s.cameraWrap, { height: camH }]}
        onLayout={e => setCamLayout({
          width: e.nativeEvent.layout.width,
          height: e.nativeEvent.layout.height,
        })}
      >
        {deepARCameraOk ? (
          <DeepARCameraComponent
            ref={deepARRef}
            apiKey={DEEPAR_API_KEY}
            style={StyleSheet.absoluteFillObject}
            position={facing}
            onEventSent={({ nativeEvent }: any) => {
              if (nativeEvent.type === 'initialized') {
                if (deepARTimeoutRef.current) clearTimeout(deepARTimeoutRef.current);
                setDeepARReady(true);
                prefetchDeepARFilters(['flower_crown', 'lion', 'aviators', 'beauty', 'fire']);
              }
              if (nativeEvent.type === 'screenshotTaken') {
                if (captureTimeoutRef.current) clearTimeout(captureTimeoutRef.current);
                setCapturedUri(nativeEvent.value); setMode('preview'); setIsCapturing(false);
              }
              if (nativeEvent.type === 'videoRecordingFinished') {
                if (recTimerRef.current) clearInterval(recTimerRef.current);
                setIsRecording(false); setRecSeconds(0);
                if (nativeEvent.value) { setCapturedUri(nativeEvent.value); setMode('preview'); }
              }
              if (nativeEvent.type === 'error') {
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
              if (deepARTimeoutRef.current) clearTimeout(deepARTimeoutRef.current);
              setDeepARReady(true);
              console.error('[DeepAR] Error:', text);
            }}
          />
        ) : CameraView ? (
          <CameraView ref={cameraRef} style={StyleSheet.absoluteFillObject} facing={facing} mode="video" />
        ) : null}

        {/* Skia overlay — ONLY when DeepAR is NOT active (Metal surface conflict) */}
        {skiaEffectId !== 'none' && !deepARCameraOk ? (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 5 }} pointerEvents="none">
            <SkiaEffectsLayer effectId={skiaEffectId} width={camLayout.width} height={camLayout.height} />
          </View>
        ) : null}

        {isRecording ? (
          <View style={[s.recIndicator, { zIndex: 20 }]}>
            <PulsingDot color="#FF3B3B" />
            <Text style={s.recText}>REC {fmtSec(recSeconds)}</Text>
          </View>
        ) : null}
        {deepARCameraOk && !deepARReady ? (
          <View style={[s.deepARLoading, { zIndex: 20 }]}>
            <ActivityIndicator color="#fff" size="small" />
            <Text style={s.deepARLoadingText}>Iniciando DeepAR...</Text>
          </View>
        ) : null}
        {deepARCameraOk && deepARReady ? (
          <View style={[s.deepARLiveBadge, { zIndex: 20 }]}>
            <LinearGradient colors={['#FF2D78', '#7C5CFF']} style={s.deepARLiveBadgeInner}>
              <PulsingDot color="#fff" />
              <Text style={s.deepARLiveBadgeText}>DeepAR LIVE</Text>
            </LinearGradient>
          </View>
        ) : null}
        {deepARFilterId ? (
          <View style={[s.effectBadge, { zIndex: 20 }]}>
            <Text style={s.effectBadgeText}>
              {DEEPAR_FILTERS.find(f => f.id === deepARFilterId)?.emoji}{' '}
              {DEEPAR_FILTERS.find(f => f.id === deepARFilterId)?.name}
            </Text>
          </View>
        ) : skiaEffectId !== 'none' ? (
          <View style={[s.effectBadge, { zIndex: 20 }]}>
            <Text style={s.effectBadgeText}>
              {SKIA_EFFECTS.find(e => e.id === skiaEffectId)?.emoji}{' '}
              {SKIA_EFFECTS.find(e => e.id === skiaEffectId)?.name}
            </Text>
          </View>
        ) : null}
        <Pressable style={[s.flipBtn, { zIndex: 20 }]} onPress={() => setFacing(f => f === 'front' ? 'back' : 'front')}>
          <MaterialCommunityIcons name="camera-flip-outline" size={22} color="#fff" />
        </Pressable>
      </View>

      {/* Effects selector */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterScrollWrap} contentContainerStyle={s.filterStrip}>
        <Pressable style={[s.chip, (skiaEffectId === 'none' && !deepARFilterId) && s.chipActive]} onPress={clearAllEffects}>
          <View style={[s.chipGrad, { backgroundColor: '#1A1A2E', borderRadius: 21 }]} />
          <Text style={s.chipEmoji}>📷</Text>
          <Text style={[s.chipName, (skiaEffectId === 'none' && !deepARFilterId) && { color: '#fff' }]}>Normal</Text>
          {(skiaEffectId === 'none' && !deepARFilterId) ? <View style={s.chipDot} /> : null}
        </Pressable>

        <Text style={s.sectionLabel}>SKIA GPU{deepARCameraOk ? ' (desactiva DeepAR)' : ''}</Text>
        {SKIA_EFFECTS.map(e => (
          <Pressable key={e.id} style={[s.chip, skiaEffectId === e.id && s.chipActive]}
            onPress={() => {
              if (deepARCameraOk && deepARFilterId) { clearDeepAREffect(deepARRef); setDeepARFilterId(null); }
              setSkiaEffectId(e.id);
            }}>
            <LinearGradient colors={e.gradient} style={s.chipGrad} />
            <Text style={s.chipEmoji}>{e.emoji}</Text>
            <Text style={[s.chipName, skiaEffectId === e.id && { color: '#fff' }]}>{e.name}</Text>
            {skiaEffectId === e.id ? <View style={s.chipDot} /> : null}
          </Pressable>
        ))}

        {deepARCameraOk ? (
          <>
            <View style={s.divider} />
            <Text style={s.sectionLabel}>DEEPAR AR</Text>
            {DEEPAR_FILTERS.map(f => {
              const loadState = filterLoadState[f.id] ?? 'idle';
              const isActive  = deepARFilterId === f.id;
              const isLoading = loadState === 'downloading' || loadState === 'applying';
              return (
                <Pressable key={f.id} style={[s.chip, isActive && s.chipDeepARActive]} onPress={() => handleDeepARFilter(f)} disabled={isLoading}>
                  <LinearGradient colors={['#FF2D7844', '#7C5CFF44']} style={s.chipGrad} />
                  {isLoading
                    ? <ActivityIndicator size="small" color="#FF2D78" style={{ position: 'absolute', top: 12 }} />
                    : <Text style={s.chipEmoji}>{f.emoji}</Text>}
                  <Text style={[s.chipName, isActive && { color: '#FF2D78' }]}>{f.name}</Text>
                  {isLoading ? <Text style={[s.chipDownloadLabel, { color: '#FF2D78' }]}>↓</Text> : null}
                  {isActive && !isLoading ? <View style={[s.chipDot, { backgroundColor: '#FF2D78' }]} /> : null}
                </Pressable>
              );
            })}
          </>
        ) : null}
      </ScrollView>

      {/* Capture controls */}
      <View style={s.captureRow}>
        <Pressable style={[s.recordBtn, isRecording && s.recordBtnActive]} onPress={toggleRecord}>
          <LinearGradient colors={isRecording ? ['#FF3B3B', '#CC1A1A'] : ['#333', '#222']} style={s.recordBtnInner}>
            <MaterialCommunityIcons name={isRecording ? 'stop' : 'video-outline'} size={22} color="#fff" />
          </LinearGradient>
        </Pressable>
        <Animated.View style={shutterSty}>
          <Pressable style={s.shutterOuter} onPress={capturePhoto} disabled={isCapturing || isRecording}>
            <LinearGradient colors={['#FF2D78', '#7C5CFF']} style={s.shutterInner}>
              {isCapturing ? <ActivityIndicator color="#fff" size="small" /> : <MaterialCommunityIcons name="camera" size={32} color="#fff" />}
            </LinearGradient>
          </Pressable>
        </Animated.View>
        <Pressable style={s.recordBtn} onPress={async () => {
          const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!p.granted) return;
          const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.All, allowsEditing: true, aspect: [3, 4], quality: 0.9 });
          if (!r.canceled && r.assets[0]) { setCapturedUri(r.assets[0].uri); setMode('preview'); }
        }}>
          <LinearGradient colors={['#333', '#222']} style={s.recordBtnInner}>
            <MaterialCommunityIcons name="image-outline" size={22} color="#fff" />
          </LinearGradient>
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
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
