/**
 * components/feature/studio/EffectsTab.tsx — v4
 *
 * Creator Studio: AR Camera + glass filter picker
 *
 * UI: segmented switch [Efectos | Filtros AR] + one circular carousel row
 *     Glass style — no heavy fills, gradient rings on active items
 */
import React, {
  useState, useCallback, useRef, useMemo,
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

let SkiaEffectsLayer: any = null;
try {
  SkiaEffectsLayer = require('@/components/feature/SkiaEffectsLayer').default ?? null;
} catch { /* reanimated not ready */ }
import { CameraCore, type CameraCoreHandle } from './camera/CameraCore';
import { Colors, FontSize, FontWeight, Radius } from '@/constants/theme';

const { width: W } = Dimensions.get('window');
const CAM_H = W * 1.05;

const AR_GRADIENT:     [string, string] = ['#FF2D78', '#7C5CFF'];
const NORMAL_GRADIENT: [string, string] = ['rgba(255,255,255,0.55)', 'rgba(255,255,255,0.18)'];

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

// ── Circular item — gradient ring when active, hairline border when not ────────
function CircItem({
  emoji, name, active, loading, gradient, nameStyle, onPress, disabled,
}: {
  emoji:      string;
  name:       string;
  active:     boolean;
  loading?:   boolean;
  gradient?:  [string, string];
  nameStyle?: any;
  onPress:    () => void;
  disabled?:  boolean;
}) {
  const inner = loading
    ? <ActivityIndicator size="small" color="#FF2D78" />
    : <Text style={s.circEmoji}>{emoji}</Text>;

  return (
    <Pressable style={s.circItem} onPress={onPress} disabled={disabled}>
      {active && gradient ? (
        <LinearGradient colors={gradient} style={s.circRing} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
          <View style={s.circIconInner}>{inner}</View>
        </LinearGradient>
      ) : (
        <View style={s.circIcon}>{inner}</View>
      )}
      <Text style={[s.circName, nameStyle]}>{name}</Text>
    </Pressable>
  );
}

// ── EffectsTab ────────────────────────────────────────────────────────────────
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

  const [activeTab,       setActiveTab]       = useState<'efectos' | 'ar'>('efectos');
  const [skiaEffectId,    setSkiaEffectId]    = useState<SkiaEffectId>('none');
  const [deepARFilterId,  setDeepARFilterId]  = useState<string | null>(null);
  const [filterLoadState, setFilterLoadState] = useState<Record<string, string>>({});
  const [mode,            setMode]            = useState<'camera' | 'preview'>('camera');
  const [capturedUri,     setCapturedUri]     = useState<string | null>(null);
  const [isCapturing,     setIsCapturing]     = useState(false);
  const [isRecording,     setIsRecording]     = useState(false);
  const [deepARCamReady,  setDeepARCamReady]  = useState(false);

  const shutterScale = useRef(new Animated.Value(1)).current;

  const handleDeepARFilter = useCallback(async (filter: DeepARFilter) => {
    console.log('[CreatorFilters] selected AR filter:', filter.id);
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
      setFilterLoadState(prev => ({ ...prev, [filter.id]: 'idle' }));
      return;
    }
    setSkiaEffectId('none');
    setDeepARFilterId(filter.id);
    await switchDeepAREffect(deepARRef, filter, (state, msg) => {
      setFilterLoadState(prev => ({ ...prev, [filter.id]: state }));
      if (state === 'error') {
        console.log('[CreatorFilters] error:', msg);
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

  // Skia overlay only — badge removed to keep camera area clean
  const cameraOverlay = useMemo(() => (
    skiaEffectId !== 'none' && SkiaEffectsLayer ? (
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 5 }} pointerEvents="none">
        <SkiaEffectsLayer effectId={skiaEffectId} width={W} height={CAM_H} />
      </View>
    ) : null
  ), [skiaEffectId]);

  // ── Preview ────────────────────────────────────────────────────────────────
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

  const isNormal = skiaEffectId === 'none' && !deepARFilterId;

  return (
    <View style={{ flex: 1 }}>
      <CameraCore
        ref={cameraRef}
        height={CAM_H}
        overlay={cameraOverlay}
        onDeepARReady={() => { setDeepARCamReady(true); log.deepar.info('Ready from CameraCore'); }}
        onScreenshot={uri => { setCapturedUri(uri); setMode('preview'); setIsCapturing(false); }}
        onVideoReady={uri  => { setCapturedUri(uri); setMode('preview'); setIsRecording(false); }}
        onError={msg => showAlert('Error de cámara', msg)}
      />

      {/* ── Filter picker panel ─────────────────────────────────────────────── */}
      <View style={s.panel}>

        {/* Segmented switch — gradient underline indicator, no fill */}
        <View style={s.segmented}>
          <Pressable style={s.segBtn} onPress={() => setActiveTab('efectos')}>
            <Text style={[s.segBtnText, activeTab === 'efectos' && s.segBtnTextActive]}>Efectos</Text>
            {activeTab === 'efectos'
              ? <LinearGradient colors={AR_GRADIENT} style={s.segIndicator} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} />
              : <View style={s.segIndicatorHidden} />}
          </Pressable>
          <Pressable style={s.segBtn} onPress={() => setActiveTab('ar')}>
            <Text style={[s.segBtnText, activeTab === 'ar' && s.segBtnTextActive]}>Filtros AR</Text>
            {activeTab === 'ar'
              ? <LinearGradient colors={AR_GRADIENT} style={s.segIndicator} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} />
              : <View style={s.segIndicatorHidden} />}
          </Pressable>
        </View>

        {/* Single circular carousel */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.carouselRow}>
          {activeTab === 'efectos' ? (
            <>
              <CircItem
                emoji="📷" name="Normal"
                active={isNormal} gradient={NORMAL_GRADIENT}
                nameStyle={isNormal ? s.circNameActive : undefined}
                onPress={clearAllEffects}
              />
              {SKIA_EFFECTS.map(e => {
                const active = skiaEffectId === e.id;
                return (
                  <CircItem key={e.id}
                    emoji={e.emoji} name={e.name}
                    active={active} gradient={e.gradient}
                    nameStyle={active ? s.circNameActive : undefined}
                    onPress={() => {
                      const deepARRef = cameraRef.current?.deepARRef;
                      if (deepARActive && deepARCamReady && deepARFilterId && deepARRef) {
                        clearDeepAREffect(deepARRef); setDeepARFilterId(null);
                      }
                      setSkiaEffectId(e.id);
                    }}
                  />
                );
              })}
            </>
          ) : (
            <>
              {DEEPAR_FILTERS.map(f => {
                const loadState = filterLoadState[f.id] ?? 'idle';
                const isActive  = deepARFilterId === f.id;
                const isLoading = loadState === 'downloading' || loadState === 'applying';
                return (
                  <CircItem key={f.id}
                    emoji={f.emoji} name={f.name}
                    active={isActive} loading={isLoading} gradient={AR_GRADIENT}
                    nameStyle={isActive ? s.circNameARActive : undefined}
                    onPress={() => handleDeepARFilter(f)}
                    disabled={isLoading}
                  />
                );
              })}
            </>
          )}
        </ScrollView>
      </View>

      {/* ── Capture controls ────────────────────────────────────────────────── */}
      <View style={s.captureRow}>
        <Pressable style={[s.sideBtn, isRecording && s.sideBtnActive]} onPress={toggleRecord}>
          <LinearGradient colors={isRecording ? ['#FF3B3B', '#CC1A1A'] : ['#333', '#222']} style={s.sideBtnInner}>
            <MaterialCommunityIcons name={isRecording ? 'stop' : 'video-outline'} size={22} color="#fff" />
          </LinearGradient>
        </Pressable>

        <Animated.View style={{ transform: [{ scale: shutterScale }] }}>
          <Pressable style={s.shutterOuter} onPress={capturePhoto} disabled={isCapturing || isRecording}>
            <LinearGradient colors={['#FF2D78', '#7C5CFF']} style={s.shutterInner}>
              {isCapturing
                ? <ActivityIndicator color="#fff" size="small" />
                : <MaterialCommunityIcons name="camera" size={32} color="#fff" />}
            </LinearGradient>
          </Pressable>
        </Animated.View>

        <Pressable style={s.sideBtn} onPress={pickFromGallery}>
          <LinearGradient colors={['#333', '#222']} style={s.sideBtnInner}>
            <MaterialCommunityIcons name="image-outline" size={22} color="#fff" />
          </LinearGradient>
        </Pressable>
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  // Filter picker panel
  panel:              { backgroundColor: Colors.bg, borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 8, paddingBottom: 8 },

  // Segmented switch — no fill, gradient underline indicator only
  segmented:          { flexDirection: 'row', marginHorizontal: 14, marginBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)' },
  segBtn:             { flex: 1, paddingVertical: 6, alignItems: 'center', gap: 4 },
  segBtnText:         { color: Colors.textSubtle, fontSize: 12, fontWeight: FontWeight.medium },
  segBtnTextActive:   { color: '#fff', fontWeight: FontWeight.semibold },
  segIndicator:       { width: 28, height: 2, borderRadius: 1 },
  segIndicatorHidden: { width: 28, height: 2 },

  // Circular carousel
  carouselRow:        { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingTop: 2, paddingBottom: 6, alignItems: 'flex-start' },
  circItem:           { alignItems: 'center', gap: 5, width: 62 },

  // Inactive: transparent + hairline border
  circIcon:           { width: 54, height: 54, borderRadius: 27, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },

  // Active: LinearGradient ring (54px) wrapping dark inner circle (50px)
  circRing:           { width: 54, height: 54, borderRadius: 27, padding: 2, alignItems: 'center', justifyContent: 'center' },
  circIconInner:      { width: 50, height: 50, borderRadius: 25, backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'center', justifyContent: 'center' },

  circEmoji:          { fontSize: 20 },
  circName:           { color: Colors.textSubtle, fontSize: 9, textAlign: 'center', fontWeight: FontWeight.medium },
  circNameActive:     { color: '#fff' },
  circNameARActive:   { color: '#FF2D78' },

  // Capture controls — unchanged
  captureRow:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingVertical: 10, backgroundColor: Colors.bg, paddingHorizontal: 16 },
  shutterOuter:       { width: 74, height: 74, borderRadius: 37, borderWidth: 3, borderColor: Colors.secondary + '66', alignItems: 'center', justifyContent: 'center' },
  shutterInner:       { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  sideBtn:            { width: 54, height: 54, borderRadius: 27, overflow: 'hidden' },
  sideBtnActive:      {},
  sideBtnInner:       { width: 54, height: 54, alignItems: 'center', justifyContent: 'center' },

  // Preview mode
  previewWrap:        { borderRadius: Radius.xl, overflow: 'hidden', position: 'relative', alignSelf: 'center' },
  previewGrad:        { position: 'absolute', bottom: 0, left: 0, right: 0, height: 80 },
  previewBadge:       { position: 'absolute', bottom: 12, left: 12, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  previewBadgeText:   { color: '#fff', fontSize: 12, fontWeight: FontWeight.semibold },
  actionRow:          { flexDirection: 'row', gap: 10 },
  actionBtn:          { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: Radius.lg, backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border },
  actionBtnText:      { color: Colors.textSecondary, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  publishBtn:         { flex: 2, borderRadius: Radius.lg, overflow: 'hidden' },
  publishBtnGrad:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  publishBtnText:     { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
});
