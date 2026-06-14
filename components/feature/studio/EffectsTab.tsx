/**
 * components/feature/studio/EffectsTab.tsx  — v3
 *
 * Instagram-style camera UI: full-screen camera, two circular carousels
 * overlaid at the bottom, clean centered capture bar.
 *
 * Architecture unchanged from v2:
 *   - Camera logic entirely delegated to <CameraCore>
 *   - Effect selection, Skia overlay, DeepAR switching handled here
 *   - No imports from other studio tabs
 */
import React, {
  useState, useCallback, useRef, useEffect, useMemo,
} from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView,
  ActivityIndicator, Dimensions, Animated,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { useAlert } from '@/template';
import { useFeed } from '@/hooks/useFeed';
import { useRouter } from 'expo-router';
import {
  isDeepARAvailable, DEEPAR_FILTERS,
  DeepARCamera as DeepARCameraComponent,
  switchDeepAREffect, clearDeepAREffect,
  type DeepARFilter,
} from '@/services/deeparService';
import { log } from '@/services/logger';
import type { SkiaEffectId } from '@/components/feature/SkiaEffectsLayer';

// Lazy-load to keep react-native-reanimated out of the static module chain.
let SkiaEffectsLayer: any = null;
try {
  SkiaEffectsLayer = require('@/components/feature/SkiaEffectsLayer').default ?? null;
} catch { /* reanimated not ready — effects degrade gracefully */ }
import { CameraCore, type CameraCoreHandle } from './camera/CameraCore';
import { Colors, FontSize, FontWeight, Radius } from '@/constants/theme';

const { width: W } = Dimensions.get('window');

// Circular item dimensions
const CIRCLE = 50;
const RING   = CIRCLE + 6; // 56 — ring adds 3px gradient border on each side

// ── Skia effects catalog ───────────────────────────────────────────────────────
interface EffectDef { id: SkiaEffectId; name: string; emoji: string; gradient: [string, string] }

const SKIA_EFFECTS: EffectDef[] = [
  { id: 'vintage',   name: 'Vintage',    emoji: '📷', gradient: ['#8B5E3C', '#C27540'] },
  { id: 'cine',      name: 'Cine',       emoji: '🎬', gradient: ['#1A1A2E', '#333355'] },
  { id: 'frio',      name: 'Frío',       emoji: '🧊', gradient: ['#2D9EFF', '#7CC4FF'] },
  { id: 'calido',    name: 'Cálido',     emoji: '🌅', gradient: ['#FF9D00', '#FF5A00'] },
  { id: 'bn',        name: 'B&N',        emoji: '⬛', gradient: ['#555',    '#999'    ] },
  { id: 'neon',      name: 'Neón',       emoji: '🌈', gradient: ['#FF2D78', '#7C5CFF'] },
  { id: 'chromatic', name: 'Cromático',  emoji: '🔴', gradient: ['#FF0044', '#00FFCC'] },
  { id: 'particles', name: 'Partículas', emoji: '✨', gradient: ['#FFD700', '#FF9D00'] },
  { id: 'glitch',    name: 'Glitch',     emoji: '📺', gradient: ['#00FFFF', '#FF00FF'] },
  { id: 'hearts',    name: 'Corazones',  emoji: '💕', gradient: ['#FF2D78', '#FF6BA8'] },
  { id: 'rain',      name: 'Lluvia',     emoji: '🌧️', gradient: ['#2D9EFF', '#0050AA'] },
  { id: 'glow',      name: 'Glow',       emoji: '💜', gradient: ['#7C5CFF', '#A855F7'] },
];

// ── CircleItem ─────────────────────────────────────────────────────────────────
interface CircleItemProps {
  emoji:      string;
  name:       string;
  isActive:   boolean;
  isLoading?: boolean;
  gradient?:  [string, string];
  onPress:    () => void;
}

function CircleItem({ emoji, name, isActive, isLoading = false, gradient, onPress }: CircleItemProps) {
  const ringColors: [string, string] = gradient ?? ['#FF2D78', '#7C5CFF'];
  return (
    <Pressable onPress={onPress} style={s.circleWrap}>
      {isActive ? (
        <LinearGradient colors={ringColors} style={s.ring}>
          <View style={s.circleInner}>
            {isLoading
              ? <ActivityIndicator size="small" color="#FF2D78" />
              : <Text style={s.circleEmoji}>{emoji}</Text>}
          </View>
        </LinearGradient>
      ) : (
        <View style={s.circleOuter}>
          {isLoading
            ? <ActivityIndicator size="small" color="#FF2D78" />
            : <Text style={s.circleEmoji}>{emoji}</Text>}
        </View>
      )}
      <Text style={[s.circleLabel, isActive && s.circleLabelOn]} numberOfLines={1}>
        {name}
      </Text>
    </Pressable>
  );
}

// ── EffectsTab ─────────────────────────────────────────────────────────────────
export function EffectsTab() {
  const { addVideo }  = useFeed();
  const { showAlert } = useAlert();
  const router        = useRouter();

  const cameraRef = useRef<CameraCoreHandle>(null);

  const rawDeepARComponent = isDeepARAvailable() && DeepARCameraComponent
    ? (DeepARCameraComponent as any).default ?? DeepARCameraComponent
    : null;
  const deepARActive =
    typeof rawDeepARComponent === 'function' ||
    (
      rawDeepARComponent !== null &&
      typeof rawDeepARComponent === 'object' &&
      typeof (rawDeepARComponent as any).render === 'function'
    );

  const [skiaEffectId,    setSkiaEffectId]    = useState<SkiaEffectId>('none');
  const [deepARFilterId,  setDeepARFilterId]  = useState<string | null>(null);
  const [filterLoadState, setFilterLoadState] = useState<Record<string, string>>({});
  const [camSize,         setCamSize]         = useState({ width: W, height: W * 1.2 });
  const [mode,            setMode]            = useState<'camera' | 'preview'>('camera');
  const [capturedUri,     setCapturedUri]     = useState<string | null>(null);
  const [isCapturing,     setIsCapturing]     = useState(false);
  const [isRecording,     setIsRecording]     = useState(false);
  const [deepARCamReady,  setDeepARCamReady]  = useState(false);

  const shutterScale = useRef(new Animated.Value(1)).current;

  const handleContainerLayout = useCallback((e: any) => {
    const { width, height } = e.nativeEvent.layout;
    setCamSize(prev =>
      prev.width === width && prev.height === height ? prev : { width, height }
    );
  }, []);

  useEffect(() => {
    if (skiaEffectId !== 'none') {
      console.log('[Skia] effect selected:', skiaEffectId);
    }
  }, [skiaEffectId]);

  // ── DeepAR filter apply ───────────────────────────────────────────────────────
  const handleDeepARFilter = useCallback(async (filter: DeepARFilter) => {
    const deepARRef = cameraRef.current?.deepARRef;
    if (!deepARActive) {
      showAlert('DeepAR no disponible', 'Los filtros AR no están disponibles en este dispositivo.');
      return;
    }
    if (!deepARRef?.current) {
      console.log('[DeepAR] filter skipped — deepARRef missing');
      return;
    }
    if (deepARFilterId === filter.id) {
      clearDeepAREffect(deepARRef);
      setDeepARFilterId(null);
      setFilterLoadState(s => ({ ...s, [filter.id]: 'idle' }));
      return;
    }
    setSkiaEffectId('none'); // Metal surface conflict
    setDeepARFilterId(filter.id);
    await switchDeepAREffect(deepARRef, filter, (state, msg) => {
      setFilterLoadState(s => ({ ...s, [filter.id]: state }));
      if (state === 'error') {
        showAlert('Error de filtro', msg ?? 'No se pudo cargar el filtro');
        setDeepARFilterId(prev => prev === filter.id ? null : prev);
      }
    });
  }, [deepARActive, deepARFilterId, showAlert]);

  const clearAllEffects = useCallback(() => {
    const deepARRef = cameraRef.current?.deepARRef;
    setSkiaEffectId('none');
    if (deepARFilterId && deepARRef) { clearDeepAREffect(deepARRef); setDeepARFilterId(null); }
  }, [deepARFilterId]);

  // ── Capture ───────────────────────────────────────────────────────────────────
  const capturePhoto = useCallback(async () => {
    if (isCapturing || isRecording || !cameraRef.current) return;
    setIsCapturing(true);
    Animated.sequence([
      Animated.spring(shutterScale, { toValue: 0.82, useNativeDriver: true }),
      Animated.spring(shutterScale, { toValue: 1,    useNativeDriver: true }),
    ]).start();
    const uri = await cameraRef.current.takePhoto();
    if (uri) { setCapturedUri(uri); setMode('preview'); }
    else { showAlert('Error', 'No se pudo capturar la foto'); }
    setIsCapturing(false);
  }, [isCapturing, isRecording, showAlert]);

  const toggleRecord = useCallback(async () => {
    if (!cameraRef.current) return;
    if (isRecording) {
      setIsRecording(false);
      const uri = await cameraRef.current.stopRecording();
      if (uri) { setCapturedUri(uri); setMode('preview'); }
    } else {
      setIsRecording(true);
      cameraRef.current.startRecording();
    }
  }, [isRecording]);

  const pickFromGallery = useCallback(async () => {
    const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!p.granted) return;
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsEditing: true, aspect: [3, 4], quality: 0.9,
    });
    if (!r.canceled && r.assets[0]) { setCapturedUri(r.assets[0].uri); setMode('preview'); }
  }, []);

  const saveToGallery = useCallback(async (uri: string) => {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status === 'granted') {
        await MediaLibrary.saveToLibraryAsync(uri);
        showAlert('Guardado', 'Guardado en tu galería');
      }
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

  // Skia overlay — only renders when DeepAR is not active on Metal
  const cameraOverlay = useMemo(() => (
    skiaEffectId !== 'none' && (!deepARActive || !deepARCamReady) && SkiaEffectsLayer ? (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <SkiaEffectsLayer effectId={skiaEffectId} width={camSize.width} height={camSize.height} />
      </View>
    ) : null
  ), [skiaEffectId, deepARActive, deepARCamReady, camSize]);

  // ── Preview mode ──────────────────────────────────────────────────────────────
  if (mode === 'preview' && capturedUri) {
    const activeFilter = deepARFilterId
      ? DEEPAR_FILTERS.find(f => f.id === deepARFilterId)
      : SKIA_EFFECTS.find(e => e.id === skiaEffectId);
    return (
      <ScrollView showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 16 }}>
        <View style={[s.previewWrap, { width: W - 32, height: (W - 32) * 1.2 }]}>
          <Image source={{ uri: capturedUri }} style={StyleSheet.absoluteFillObject}
            contentFit="cover" transition={200} />
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.5)']} style={s.previewGrad} />
          {activeFilter ? (
            <View style={s.previewBadge}>
              <Text style={s.previewBadgeText}>{(activeFilter as any).emoji} {activeFilter.name}</Text>
            </View>
          ) : null}
        </View>
        <View style={s.actionRow}>
          <Pressable style={s.actionBtn} onPress={() => { setCapturedUri(null); setMode('camera'); }}>
            <MaterialCommunityIcons name="camera-retake" size={18} color={Colors.textSecondary} />
            <Text style={s.actionBtnText}>Volver</Text>
          </Pressable>
          <Pressable style={s.actionBtn} onPress={() => saveToGallery(capturedUri)}>
            <MaterialCommunityIcons name="download" size={18} color={Colors.textSecondary} />
            <Text style={s.actionBtnText}>Guardar</Text>
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

  // ── Camera view ───────────────────────────────────────────────────────────────
  return (
    <View style={s.root}>

      {/* Camera + carousel overlays ─────────────────────────────────────────── */}
      <View style={s.cameraContainer} onLayout={handleContainerLayout}>

        <CameraCore
          ref={cameraRef}
          height={camSize.height}
          overlay={cameraOverlay}
          onDeepARReady={() => { setDeepARCamReady(true); log.deepar.info('Ready from CameraCore'); }}
          onScreenshot={uri => { setCapturedUri(uri); setMode('preview'); setIsCapturing(false); }}
          onVideoReady={uri  => { setCapturedUri(uri); setMode('preview'); setIsRecording(false); }}
          onError={msg => showAlert('Error de cámara', msg)}
        />

        {/* Dark gradient at the bottom for carousel readability */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.92)']}
          locations={[0.25, 0.65, 1]}
          style={s.scrim}
          pointerEvents="none"
        />

        {/* ── Two carousels stacked above capture bar ──────────────────────── */}
        <View style={s.carousels}>

          {/* Efectos (Skia GPU filters) */}
          <View style={s.carouselBlock}>
            <Text style={s.carouselLabel}>Efectos</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.carouselContent}
            >
              {/* "Normal" clears all effects */}
              <CircleItem
                emoji="📷"
                name="Normal"
                isActive={skiaEffectId === 'none' && !deepARFilterId}
                onPress={clearAllEffects}
              />
              {SKIA_EFFECTS.map(e => (
                <CircleItem
                  key={e.id}
                  emoji={e.emoji}
                  name={e.name}
                  isActive={skiaEffectId === e.id}
                  gradient={e.gradient as [string, string]}
                  onPress={() => {
                    const ref = cameraRef.current?.deepARRef;
                    if (deepARActive && deepARCamReady && deepARFilterId && ref) {
                      clearDeepAREffect(ref);
                      setDeepARFilterId(null);
                    }
                    setSkiaEffectId(e.id);
                  }}
                />
              ))}
            </ScrollView>
          </View>

          {/* Filtros AR (DeepAR) */}
          <View style={s.carouselBlock}>
            <Text style={s.carouselLabel}>Filtros AR</Text>
            {deepARActive ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.carouselContent}
              >
                {DEEPAR_FILTERS.map(f => {
                  const st        = filterLoadState[f.id] ?? 'idle';
                  const isActive  = deepARFilterId === f.id;
                  const isLoading = st === 'downloading' || st === 'applying';
                  return (
                    <CircleItem
                      key={f.id}
                      emoji={f.emoji}
                      name={f.name}
                      isActive={isActive}
                      isLoading={isLoading}
                      onPress={() => { if (!isLoading) handleDeepARFilter(f); }}
                    />
                  );
                })}
              </ScrollView>
            ) : (
              <View style={s.carouselContent}>
                <Text style={s.unavailableText}>No disponible en este dispositivo</Text>
              </View>
            )}
          </View>

        </View>
      </View>

      {/* ── Capture bar ─────────────────────────────────────────────────────── */}
      <View style={s.captureBar}>

        {/* Record */}
        <Pressable onPress={toggleRecord} style={s.sideBtn}>
          <LinearGradient
            colors={isRecording ? ['#FF3B3B', '#CC1A1A'] : ['#2a2a2a', '#1a1a1a']}
            style={s.sideBtnInner}
          >
            <MaterialCommunityIcons
              name={isRecording ? 'stop' : 'video-outline'}
              size={22} color="#fff"
            />
          </LinearGradient>
        </Pressable>

        {/* Shutter */}
        <Animated.View style={{ transform: [{ scale: shutterScale }] }}>
          <Pressable
            style={s.shutterOuter}
            onPress={capturePhoto}
            disabled={isCapturing || isRecording}
          >
            <LinearGradient colors={['#FF2D78', '#7C5CFF']} style={s.shutterInner}>
              {isCapturing
                ? <ActivityIndicator color="#fff" size="small" />
                : <MaterialCommunityIcons name="camera" size={32} color="#fff" />}
            </LinearGradient>
          </Pressable>
        </Animated.View>

        {/* Gallery */}
        <Pressable onPress={pickFromGallery} style={s.sideBtn}>
          <LinearGradient colors={['#2a2a2a', '#1a1a1a']} style={s.sideBtnInner}>
            <MaterialCommunityIcons name="image-outline" size={22} color="#fff" />
          </LinearGradient>
        </Pressable>

      </View>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({

  // ── Root layout ──────────────────────────────────────────────────────────────
  root:            { flex: 1, backgroundColor: '#000' },
  cameraContainer: { flex: 1, overflow: 'hidden', backgroundColor: '#000' },

  // ── Gradient scrim (bottom 200px of camera) ───────────────────────────────
  scrim:           { position: 'absolute', left: 0, right: 0, bottom: 0, height: 200 },

  // ── Carousel overlays ────────────────────────────────────────────────────────
  carousels:       { position: 'absolute', left: 0, right: 0, bottom: 0 },
  carouselBlock:   { paddingTop: 2, paddingBottom: 2 },
  carouselLabel:   {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 9,
    fontWeight: FontWeight.bold,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  carouselContent: { paddingHorizontal: 10, paddingBottom: 4 },
  unavailableText: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 11,
    fontStyle: 'italic',
    paddingVertical: 10,
  },

  // ── Circular items ────────────────────────────────────────────────────────────
  circleWrap:      { alignItems: 'center', marginHorizontal: 4, width: RING + 4 },
  ring:            {
    width: RING, height: RING, borderRadius: RING / 2,
    padding: 3, alignItems: 'center', justifyContent: 'center',
  },
  circleInner:     {
    width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2,
    backgroundColor: '#0d0d0d',
    alignItems: 'center', justifyContent: 'center',
  },
  circleOuter:     {
    width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  circleEmoji:     { fontSize: 20 },
  circleLabel:     {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
    fontWeight: FontWeight.medium,
    marginTop: 3,
    textAlign: 'center',
  },
  circleLabelOn:   { color: '#fff', fontWeight: FontWeight.semibold },

  // ── Capture bar ───────────────────────────────────────────────────────────────
  captureBar:      {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 16,
    paddingHorizontal: 32,
    backgroundColor: '#000',
  },
  shutterOuter:    {
    width: 74, height: 74, borderRadius: 37,
    borderWidth: 3, borderColor: 'rgba(255,45,120,0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
  shutterInner:    {
    width: 64, height: 64, borderRadius: 32,
    alignItems: 'center', justifyContent: 'center',
  },
  sideBtn:         { width: 52, height: 52, borderRadius: 26, overflow: 'hidden' },
  sideBtnInner:    { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },

  // ── Preview mode ──────────────────────────────────────────────────────────────
  previewWrap:     { borderRadius: Radius.xl, overflow: 'hidden', position: 'relative', alignSelf: 'center' },
  previewGrad:     { position: 'absolute', bottom: 0, left: 0, right: 0, height: 80 },
  previewBadge:    {
    position: 'absolute', bottom: 12, left: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5,
  },
  previewBadgeText:{ color: '#fff', fontSize: 12, fontWeight: FontWeight.semibold },
  actionRow:       { flexDirection: 'row', gap: 10 },
  actionBtn:       {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14, borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border,
  },
  actionBtnText:   { color: Colors.textSecondary, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  publishBtn:      { flex: 2, borderRadius: Radius.lg, overflow: 'hidden' },
  publishBtnGrad:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  publishBtnText:  { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
});
