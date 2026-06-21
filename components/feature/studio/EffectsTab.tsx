/**
 * components/feature/studio/EffectsTab.tsx — v5
 *
 * Creator Studio: AR Camera + floating glass filter picker
 *
 * Layout: camera fills flex:1 above capture row.
 *         Picker floats as absolute overlay over the camera bottom.
 *         No separate solid black panel between camera and controls.
 */
import React, {
  useState, useCallback, useRef, useMemo, useEffect,
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

// ── expo-video — lazy-loaded (same pattern as VideoCard.native.tsx) ───────────
let _useVideoPlayer: any = (_src: any, _setup?: any): any => null;
let VideoView: any = null;
try {
  const ev = require('expo-video');
  VideoView       = ev.VideoView      ?? null;
  _useVideoPlayer = ev.useVideoPlayer ?? ((_src: any, _setup?: any): any => null);
} catch { /* no native build */ }

function isVideoUri(uri: string): boolean {
  if (!uri) return false;
  return /\.(mp4|mov|avi|mkv|webm|m4v)(\?|$)/i.test(uri);
}

// ── Video preview player (looping, muted by default, tap to unmute) ──────────
function VideoPreview({ uri }: { uri: string }) {
  const [isMuted, setIsMuted] = useState(true);

  const player = _useVideoPlayer(uri || '', (p: any) => {
    if (!p) return;
    p.loop  = true;
    p.muted = true;
  });

  useEffect(() => {
    console.log('[VideoPreview] uri:', uri);
    if (!player) return;
    try { player.play(); } catch (e: any) {
      console.log('[VideoPreview] error:', e?.message ?? String(e));
    }
  }, [uri]);  // player identity is stable for the same uri

  useEffect(() => {
    if (!player) return;
    try { player.muted = isMuted; } catch { /* ignore */ }
  }, [isMuted]);

  if (!VideoView || !player) return null;

  return (
    <>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFillObject}
        contentFit="cover"
        nativeControls={false}
        onError={(e: any) => console.log('[VideoPreview] error:', e?.message ?? JSON.stringify(e))}
      />
      <Pressable style={s.videoMuteBtn} onPress={() => setIsMuted(m => !m)}>
        <View style={s.videoMuteBtnInner}>
          <MaterialCommunityIcons
            name={isMuted ? 'volume-off' : 'volume-high'}
            size={18}
            color="rgba(255,255,255,0.9)"
          />
        </View>
      </Pressable>
    </>
  );
}

const { width: W } = Dimensions.get('window');
// Default camera height — overridden by onLayout so the camera fills flex:1
const DEFAULT_CAM_H = W * 1.05;

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
  { id: 'starfield', name: 'Estrellas',  emoji: '⭐', gradient: ['#1A1A2E', '#7C5CFF'] },
  { id: 'bokeh',     name: 'Bokeh',      emoji: '📸', gradient: ['#2C2C3A', '#555577'] },
];

// ── Circular item ─────────────────────────────────────────────────────────────
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
  const [capturedType,    setCapturedType]    = useState<'photo' | 'video' | null>(null);
  const [isCapturing,     setIsCapturing]     = useState(false);
  const [isRecording,     setIsRecording]     = useState(false);
  const [deepARCamReady,  setDeepARCamReady]  = useState(false);
  // Tracks actual available height for the camera container (updated via onLayout)
  const [cameraAreaH,     setCameraAreaH]     = useState(DEFAULT_CAM_H);

  const shutterScale = useRef(new Animated.Value(1)).current;

  const handleDeepARFilter = useCallback(async (filter: DeepARFilter) => {
    if (filter.disabled) return;
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
    if (uri) { setCapturedUri(uri); setCapturedType('photo'); setMode('preview'); }
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
    if (!r.canceled && r.assets[0]) {
      const asset = r.assets[0];
      setCapturedUri(asset.uri);
      setCapturedType(isVideoUri(asset.uri) || asset.type === 'video' ? 'video' : 'photo');
      setMode('preview');
    }
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
      setCapturedUri(null); setCapturedType(null); setMode('camera');
    } catch (e: any) { showAlert('Error', e?.message || 'No se pudo publicar'); }
  }, [capturedUri, deepARFilterId, skiaEffectId, addVideo, showAlert, router]);

  // Skia overlay passed into CameraCore — minimal, rarely changes
  const cameraOverlay = useMemo(() => (
    skiaEffectId !== 'none' && SkiaEffectsLayer ? (
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 5 }} pointerEvents="none">
        <SkiaEffectsLayer effectId={skiaEffectId} width={W} height={cameraAreaH} />
      </View>
    ) : null
  ), [skiaEffectId, cameraAreaH]);

  // ── Preview ────────────────────────────────────────────────────────────────
  if (mode === 'preview' && capturedUri) {
    const activeFilter = deepARFilterId
      ? DEEPAR_FILTERS.find(f => f.id === deepARFilterId)
      : SKIA_EFFECTS.find(e => e.id === skiaEffectId);
    return (
      <ScrollView showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 16 }}>
        <View style={[s.previewWrap, { width: W - 32, height: (W - 32) * 1.2 }]}>
          {capturedType === 'video' ? (
            <VideoPreview uri={capturedUri} />
          ) : (
            <Image source={{ uri: capturedUri }} style={StyleSheet.absoluteFillObject} contentFit="cover" transition={200} />
          )}
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.5)']} style={s.previewGrad} />
          {activeFilter ? (
            <View style={s.previewBadge}>
              <Text style={s.previewBadgeText}>{(activeFilter as any).emoji} {activeFilter.name}</Text>
            </View>
          ) : null}
        </View>
        <View style={s.actionRow}>
          <Pressable style={s.actionBtn} onPress={() => { setCapturedUri(null); setCapturedType(null); setMode('camera'); }}>
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
    <View style={s.root}>

      {/* ── Camera area — fills all space above capture row ─────────────────── */}
      <View
        style={s.cameraWrap}
        onLayout={e => setCameraAreaH(e.nativeEvent.layout.height)}>

        <CameraCore
          ref={cameraRef}
          height={cameraAreaH}
          overlay={cameraOverlay}
          onDeepARReady={() => { setDeepARCamReady(true); log.deepar.info('Ready from CameraCore'); }}
          onScreenshot={uri => { setCapturedUri(uri); setCapturedType('photo'); setMode('preview'); setIsCapturing(false); }}
          onVideoReady={uri => {
            console.log('[VideoPreview] uri:', uri);
            setCapturedUri(uri); setCapturedType('video'); setMode('preview'); setIsRecording(false);
          }}
          onError={msg => showAlert('Error de cámara', msg)}
        />

        {/* ── Floating picker — absolute over camera bottom ────────────────── */}
        <View style={s.floatingPicker} pointerEvents="box-none">

          {/* Readability scrim */}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.82)']}
            style={StyleSheet.absoluteFillObject}
            pointerEvents="none"
          />

          <View style={s.pickerContent}>

            {/* Compact pill segmented switch */}
            <View style={s.segPillWrap}>
              <View style={s.segPill}>
                <Pressable
                  style={[s.segPillBtn, activeTab === 'efectos' && s.segPillBtnActive]}
                  onPress={() => setActiveTab('efectos')}>
                  <Text style={[s.segPillText, activeTab === 'efectos' && s.segPillTextActive]}>
                    Efectos
                  </Text>
                </Pressable>
                <Pressable
                  style={[s.segPillBtn, activeTab === 'ar' && s.segPillBtnActive]}
                  onPress={() => setActiveTab('ar')}>
                  <Text style={[s.segPillText, activeTab === 'ar' && s.segPillTextActive]}>
                    Filtros AR
                  </Text>
                </Pressable>
              </View>
            </View>

            {/* Circular carousel */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
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
                    const loadState  = filterLoadState[f.id] ?? 'idle';
                    const isActive   = deepARFilterId === f.id;
                    const isLoading  = loadState === 'downloading' || loadState === 'applying';
                    const isDisabled = isLoading || f.disabled === true;
                    return (
                      <CircItem key={f.id}
                        emoji={f.emoji} name={f.name}
                        active={isActive} loading={isLoading} gradient={AR_GRADIENT}
                        nameStyle={isActive ? s.circNameARActive : undefined}
                        onPress={() => handleDeepARFilter(f)}
                        disabled={isDisabled}
                      />
                    );
                  })}
                </>
              )}
            </ScrollView>

          </View>
        </View>
      </View>

      {/* ── Capture controls — black lower area ─────────────────────────────── */}
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
  root:               { flex: 1, backgroundColor: Colors.bg },

  // Camera container — fills all space above capture row
  cameraWrap:         { flex: 1 },

  // Floating picker — absolute over camera bottom
  floatingPicker:     { position: 'absolute', left: 0, right: 0, bottom: 0, height: 152 },
  pickerContent:      { paddingTop: 20 },

  // Compact pill segmented switch
  segPillWrap:        { alignItems: 'center', marginBottom: 10 },
  segPill:            { flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.52)', borderRadius: 22, padding: 3, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.2)' },
  segPillBtn:         { paddingHorizontal: 20, paddingVertical: 7, borderRadius: 19 },
  segPillBtnActive:   { backgroundColor: '#fff' },
  segPillText:        { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: FontWeight.medium },
  segPillTextActive:  { color: '#111', fontWeight: FontWeight.semibold },

  // Circular carousel
  carouselRow:        { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 6, alignItems: 'flex-start' },
  circItem:           { alignItems: 'center', gap: 4, width: 60 },

  // Inactive: glass circle — slightly dark so readable over live camera
  circIcon:           { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(0,0,0,0.35)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },

  // Active: gradient ring wrapping dark inner circle
  circRing:           { width: 52, height: 52, borderRadius: 26, padding: 2, alignItems: 'center', justifyContent: 'center' },
  circIconInner:      { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },

  circEmoji:          { fontSize: 19 },
  circName:           { color: 'rgba(255,255,255,0.7)', fontSize: 9, textAlign: 'center', fontWeight: FontWeight.medium },
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
  videoMuteBtn:       { position: 'absolute', top: 10, right: 10, zIndex: 10 },
  videoMuteBtnInner:  { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(10,10,15,0.6)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
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
