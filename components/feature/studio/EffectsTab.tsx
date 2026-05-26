/**
 * components/feature/studio/EffectsTab.tsx  — v2
 *
 * Creator Studio Tab 1: AR Camera + Skia Effects + DeepAR
 *
 * Architecture v2:
 *   - Camera logic entirely delegated to <CameraCore>
 *   - This component only manages: effect selection, overlay rendering, publish
 *   - Zero camera lifecycle code here
 *
 * Module boundary:
 *   - No imports from other studio tabs
 *   - DeepAR filter switching via deeparService (not inline)
 *   - Skia overlay applied via SkiaEffectsLayer
 */
import React, {
  useState, useCallback, useRef, useEffect, useMemo,
} from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView,
  ActivityIndicator, Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useSharedValue, useAnimatedStyle, withSequence, withSpring } from 'react-native-reanimated';
import { useAlert } from '@/template';
import { useFeed } from '@/hooks/useFeed';
import { useRouter } from 'expo-router';
import {
  isDeepARAvailable, DEEPAR_FILTERS,
  switchDeepAREffect, clearDeepAREffect,
  type DeepARFilter,
} from '@/services/deeparService';
import { log } from '@/services/logger';
import SkiaEffectsLayer, { type SkiaEffectId } from '@/components/feature/SkiaEffectsLayer';
import { CameraCore, type CameraCoreHandle } from './camera/CameraCore';
import { Colors, FontSize, FontWeight, Radius } from '@/constants/theme';

const { width: W } = Dimensions.get('window');

// ── Skia effects catalog ───────────────────────────────────────────────────────
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

// ── EffectsTab ────────────────────────────────────────────────────────────────
export function EffectsTab() {
  const { addVideo }  = useFeed();
  const { showAlert } = useAlert();
  const router        = useRouter();

  const cameraRef = useRef<CameraCoreHandle>(null);

  const deepARActive = isDeepARAvailable();

  const [skiaEffectId,    setSkiaEffectId]    = useState<SkiaEffectId>('none');
  const [deepARFilterId,  setDeepARFilterId]  = useState<string | null>(null);
  const [filterLoadState, setFilterLoadState] = useState<Record<string, string>>({});
  const [camSize,         setCamSize]         = useState({ width: W, height: W * 1.22 });
  const [mode,            setMode]            = useState<'camera' | 'preview'>('camera');
  const [capturedUri,     setCapturedUri]     = useState<string | null>(null);
  const [isCapturing,     setIsCapturing]     = useState(false);
  const [isRecording,     setIsRecording]     = useState(false);

  const shutterScale = useSharedValue(1);
  const shutterSty   = useAnimatedStyle(() => ({ transform: [{ scale: shutterScale.value }] }));

  // ── Deep AR filter apply ─────────────────────────────────────────────────────
  const handleDeepARFilter = useCallback(async (filter: DeepARFilter) => {
    const deepARRef = cameraRef.current?.deepARRef;
    if (!deepARRef) return;

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
  }, [deepARFilterId, showAlert]);

  const clearAllEffects = useCallback(() => {
    const deepARRef = cameraRef.current?.deepARRef;
    setSkiaEffectId('none');
    if (deepARFilterId && deepARRef) { clearDeepAREffect(deepARRef); setDeepARFilterId(null); }
  }, [deepARFilterId]);

  // ── Capture ──────────────────────────────────────────────────────────────────
  const capturePhoto = useCallback(async () => {
    if (isCapturing || isRecording || !cameraRef.current) return;
    setIsCapturing(true);
    shutterScale.value = withSequence(withSpring(0.82), withSpring(1));
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

  // ── Camera overlay (Skia + effect badge — only UIKit views, no GPU overlap) ──
  const cameraOverlay = useMemo(() => (
    <>
      {skiaEffectId !== 'none' && !deepARActive ? (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 5 }} pointerEvents="none">
          <SkiaEffectsLayer effectId={skiaEffectId} width={camSize.width} height={camSize.height} />
        </View>
      ) : null}
      {(deepARFilterId || skiaEffectId !== 'none') ? (
        <View style={s.effectBadge} pointerEvents="none">
          <Text style={s.effectBadgeText}>
            {deepARFilterId
              ? `${DEEPAR_FILTERS.find(f => f.id === deepARFilterId)?.emoji} ${DEEPAR_FILTERS.find(f => f.id === deepARFilterId)?.name}`
              : `${SKIA_EFFECTS.find(e => e.id === skiaEffectId)?.emoji} ${SKIA_EFFECTS.find(e => e.id === skiaEffectId)?.name}`}
          </Text>
        </View>
      ) : null}
    </>
  ), [skiaEffectId, deepARFilterId, deepARActive, camSize]);

  // ── Preview mode ─────────────────────────────────────────────────────────────
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

  const camH = W * 1.22;

  return (
    <View style={{ flex: 1 }}>
      {/* Isolated CameraCore — no camera logic above this line */}
      <CameraCore
        ref={cameraRef}
        height={camH}
        overlay={cameraOverlay}
        onDeepARReady={() => log.deepar.info('Ready from CameraCore')}
        onScreenshot={uri => { setCapturedUri(uri); setMode('preview'); setIsCapturing(false); }}
        onVideoReady={uri  => { setCapturedUri(uri); setMode('preview'); setIsRecording(false); }}
        onError={msg => showAlert('Error de cámara', msg)}
      />

      {/* Effects selector */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={s.filterScrollWrap}
        contentContainerStyle={s.filterStrip}>

        {/* None */}
        <Pressable style={[s.chip, (skiaEffectId === 'none' && !deepARFilterId) && s.chipActive]}
          onPress={clearAllEffects}>
          <View style={[s.chipGrad, { backgroundColor: '#1A1A2E', borderRadius: 21 }]} />
          <Text style={s.chipEmoji}>📷</Text>
          <Text style={[s.chipName, (skiaEffectId === 'none' && !deepARFilterId) && { color: '#fff' }]}>Normal</Text>
          {(skiaEffectId === 'none' && !deepARFilterId) ? <View style={s.chipDot} /> : null}
        </Pressable>

        {/* Skia effects */}
        <Text style={s.sectionLabel}>SKIA GPU{deepARActive ? ' (desactiva DeepAR)' : ''}</Text>
        {SKIA_EFFECTS.map(e => (
          <Pressable key={e.id} style={[s.chip, skiaEffectId === e.id && s.chipActive]}
            onPress={() => {
              const deepARRef = cameraRef.current?.deepARRef;
              if (deepARActive && deepARFilterId && deepARRef) {
                clearDeepAREffect(deepARRef); setDeepARFilterId(null);
              }
              setSkiaEffectId(e.id);
            }}>
            <LinearGradient colors={e.gradient} style={s.chipGrad} />
            <Text style={s.chipEmoji}>{e.emoji}</Text>
            <Text style={[s.chipName, skiaEffectId === e.id && { color: '#fff' }]}>{e.name}</Text>
            {skiaEffectId === e.id ? <View style={s.chipDot} /> : null}
          </Pressable>
        ))}

        {/* DeepAR filters */}
        {deepARActive ? (
          <>
            <View style={s.divider} />
            <Text style={s.sectionLabel}>DEEPAR AR</Text>
            {DEEPAR_FILTERS.map(f => {
              const loadState = filterLoadState[f.id] ?? 'idle';
              const isActive  = deepARFilterId === f.id;
              const isLoading = loadState === 'downloading' || loadState === 'applying';
              return (
                <Pressable key={f.id}
                  style={[s.chip, isActive && s.chipDeepARActive]}
                  onPress={() => handleDeepARFilter(f)}
                  disabled={isLoading}>
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
        {/* Record */}
        <Pressable style={[s.sideBtn, isRecording && s.sideBtnActive]} onPress={toggleRecord}>
          <LinearGradient colors={isRecording ? ['#FF3B3B', '#CC1A1A'] : ['#333', '#222']} style={s.sideBtnInner}>
            <MaterialCommunityIcons name={isRecording ? 'stop' : 'video-outline'} size={22} color="#fff" />
          </LinearGradient>
        </Pressable>

        {/* Shutter */}
        <Animated.View style={shutterSty}>
          <Pressable style={s.shutterOuter} onPress={capturePhoto} disabled={isCapturing || isRecording}>
            <LinearGradient colors={['#FF2D78', '#7C5CFF']} style={s.shutterInner}>
              {isCapturing
                ? <ActivityIndicator color="#fff" size="small" />
                : <MaterialCommunityIcons name="camera" size={32} color="#fff" />}
            </LinearGradient>
          </Pressable>
        </Animated.View>

        {/* Gallery */}
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
  effectBadge:      { position: 'absolute', top: 14, left: 12, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5, zIndex: 10 },
  effectBadgeText:  { color: '#fff', fontSize: 12, fontWeight: FontWeight.semibold },
  filterScrollWrap: { backgroundColor: Colors.bg, maxHeight: 88 },
  filterStrip:      { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 10, alignItems: 'center' },
  sectionLabel:     { color: Colors.textSubtle, fontSize: 8, fontWeight: FontWeight.bold, letterSpacing: 1.2, textTransform: 'uppercase', alignSelf: 'center', paddingHorizontal: 4 },
  divider:          { width: 1, height: 44, backgroundColor: Colors.border, marginHorizontal: 4, alignSelf: 'center' },
  chip:             { alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 6, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.border, minWidth: 62, position: 'relative' },
  chipActive:       { borderColor: Colors.secondary, backgroundColor: Colors.secondaryDim },
  chipDeepARActive: { borderColor: '#FF2D78', backgroundColor: '#FF2D7822' },
  chipGrad:         { width: 42, height: 42, borderRadius: 21 },
  chipEmoji:        { position: 'absolute', top: 14, fontSize: 18 },
  chipName:         { color: Colors.textSubtle, fontSize: 9, fontWeight: FontWeight.medium },
  chipDot:          { width: 5, height: 5, borderRadius: 3, backgroundColor: Colors.secondary, position: 'absolute', top: 4, right: 4 },
  chipDownloadLabel:{ position: 'absolute', top: 3, right: 3, fontSize: 8, fontWeight: FontWeight.bold },
  captureRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingVertical: 10, backgroundColor: Colors.bg, paddingHorizontal: 16 },
  shutterOuter:     { width: 74, height: 74, borderRadius: 37, borderWidth: 3, borderColor: Colors.secondary + '66', alignItems: 'center', justifyContent: 'center' },
  shutterInner:     { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  sideBtn:          { width: 54, height: 54, borderRadius: 27, overflow: 'hidden' },
  sideBtnActive:    {},
  sideBtnInner:     { width: 54, height: 54, alignItems: 'center', justifyContent: 'center' },
  previewWrap:      { borderRadius: Radius.xl, overflow: 'hidden', position: 'relative', alignSelf: 'center' },
  previewGrad:      { position: 'absolute', bottom: 0, left: 0, right: 0, height: 80 },
  previewBadge:     { position: 'absolute', bottom: 12, left: 12, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  previewBadgeText: { color: '#fff', fontSize: 12, fontWeight: FontWeight.semibold },
  actionRow:        { flexDirection: 'row', gap: 10 },
  actionBtn:        { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: Radius.lg, backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border },
  actionBtnText:    { color: Colors.textSecondary, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  publishBtn:       { flex: 2, borderRadius: Radius.lg, overflow: 'hidden' },
  publishBtnGrad:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  publishBtnText:   { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
});
