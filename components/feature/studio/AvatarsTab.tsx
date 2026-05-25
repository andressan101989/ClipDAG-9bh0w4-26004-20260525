/**
 * components/feature/studio/AvatarsTab.tsx
 * Creator Studio — Tab 3: AI Avatar Generator
 *
 * Isolation contract:
 *  - No imports from other studio tabs
 *  - iOS ph:// URIs handled via expo-file-system (fetch() crashes on ph://)
 *  - Calls ai-avatar edge function via Supabase
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView,
  ActivityIndicator, Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAlert } from '@/template';
import { useFeed } from '@/hooks/useFeed';
import { useRouter } from 'expo-router';
import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Colors, FontSize, FontWeight, Radius } from '@/constants/theme';

const { width: W } = Dimensions.get('window');

// ── Avatar style catalog ───────────────────────────────────────────────────
const AVATAR_STYLES = [
  { id: 'cartoon',    label: 'Cartoon',   emoji: '🎨', g: ['#7C5CFF', '#B44FFF'] as [string, string] },
  { id: 'anime',      label: 'Anime',     emoji: '⛩️',  g: ['#FF2D78', '#A855F7'] as [string, string] },
  { id: 'cinematic',  label: 'Cinematic', emoji: '🎬', g: ['#FF9D00', '#FF2D78'] as [string, string] },
  { id: 'pixel',      label: 'Pixel Art', emoji: '👾', g: ['#A855F7', '#7C5CFF'] as [string, string] },
  { id: 'glass',      label: 'Glass',     emoji: '✨', g: ['#00E5A0', '#2D9EFF'] as [string, string] },
  { id: 'neon',       label: 'Neon',      emoji: '🌈', g: ['#FF2D78', '#7C5CFF'] as [string, string] },
  { id: 'realistic',  label: 'Realistic', emoji: '📷', g: ['#2D9EFF', '#7C5CFF'] as [string, string] },
  { id: 'watercolor', label: 'Acuarela',  emoji: '🎭', g: ['#FFB800', '#FF5A00'] as [string, string] },
];

// ── Main AvatarsTab ────────────────────────────────────────────────────────
export function AvatarsTab() {
  const { showAlert } = useAlert();
  const { addVideo }  = useFeed();
  const router        = useRouter();
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
   * iOS ph:// URIs from ImagePicker cannot be fetched with fetch().
   * Use expo-file-system readAsStringAsync with Base64 encoding.
   */
  const readUriAsBytes = useCallback(async (uri: string): Promise<Uint8Array> => {
    const FS = require('expo-file-system');
    if (uri.startsWith('ph://') || uri.startsWith('assets-library://') || uri.startsWith('content://')) {
      const b64    = await FS.readAsStringAsync(uri, { encoding: FS.EncodingType.Base64 });
      const binary = atob(b64);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }
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
      allowsEditing: true, aspect: [1, 1], quality: 0.85,
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
  }, [showAlert, uploadPhoto]);

  const takeSelfie = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { showAlert('Sin acceso', 'Necesitamos acceso a la cámara'); return; }
    const res = await ImagePicker.launchCameraAsync({
      cameraType: ImagePicker.CameraType.front,
      allowsEditing: true, aspect: [1, 1], quality: 0.85,
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
  }, [showAlert, uploadPhoto]);

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
        caption: `Mi nuevo avatar IA ${AVATAR_STYLES.find(s => s.id === selectedStyle)?.emoji ?? '✨'} #AIAvatar #ClipDAG`,
        music: 'Sin música', username: '', userAvatar: '',
      });
      showAlert('Publicado 🎉', 'Tu avatar fue publicado al feed', [
        { text: 'Ver feed', onPress: () => router.replace('/(tabs)') },
      ]);
      setStep('pick'); setPhotoUri(null); setUploadedUrl(null); setAvatarUrl(null);
    } catch (e: any) { showAlert('Error', e?.message ?? 'No se pudo publicar'); }
  }, [avatarUrl, selectedStyle, addVideo, showAlert, router]);

  // ── Step: pick ─────────────────────────────────────────────────────────
  if (step === 'pick') {
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, gap: 20 }}>
        <View style={a.heroCard}>
          <LinearGradient colors={['#7C5CFF', '#FF2D78', '#FF9D00']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={a.heroGrad}>
            <Text style={a.heroEmoji}>🤖</Text>
            <View style={{ flex: 1 }}>
              <Text style={a.heroTitle}>Avatar IA Generativo</Text>
              <Text style={a.heroSub}>Tu foto → avatar estilizado con Gemini 2.5</Text>
              <Text style={a.heroPowered}>Powered by OnSpace AI</Text>
            </View>
          </LinearGradient>
        </View>
        {isUploading ? (
          <View style={a.uploadingBox}>
            <ActivityIndicator color={Colors.primary} size="large" />
            <Text style={a.uploadingText}>Subiendo foto...</Text>
          </View>
        ) : (
          <>
            <Pressable style={a.pickBtn} onPress={pickPhoto}>
              <LinearGradient colors={['#7C5CFF', '#B44FFF']} style={a.pickBtnInner}>
                <MaterialCommunityIcons name="image-plus" size={22} color="#fff" />
                <Text style={a.pickBtnText}>Subir foto de galería</Text>
              </LinearGradient>
            </Pressable>
            <Pressable style={a.pickBtn} onPress={takeSelfie}>
              <LinearGradient colors={['#FF2D78', '#FF9D00']} style={a.pickBtnInner}>
                <MaterialCommunityIcons name="camera-front" size={22} color="#fff" />
                <Text style={a.pickBtnText}>Tomar selfie</Text>
              </LinearGradient>
            </Pressable>
          </>
        )}
        <View style={a.tipBox}>
          <Text style={a.tipTitle}>Tips para mejor resultado:</Text>
          {['Foto frontal con el rostro bien visible', 'Buena iluminación, sin sombras fuertes', 'Fondo neutro o claro'].map((tip, i) => (
            <View key={i} style={a.tipRow}>
              <MaterialCommunityIcons name="check-circle-outline" size={13} color={Colors.primary} />
              <Text style={a.tipText}>{tip}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    );
  }

  // ── Step: style ─────────────────────────────────────────────────────────
  if (step === 'style') {
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, gap: 16 }}>
        {photoUri ? (
          <View style={{ alignSelf: 'center' }}>
            <Image source={{ uri: photoUri }} style={a.photoPreview} contentFit="cover" transition={200} />
          </View>
        ) : null}
        <Text style={a.stepTitle}>Elige tu estilo</Text>
        <View style={a.grid}>
          {AVATAR_STYLES.map(s => (
            <Pressable key={s.id} style={[a.card, selectedStyle === s.id && a.cardActive]} onPress={() => setSelectedStyle(s.id)}>
              <LinearGradient colors={s.g} style={a.cardGrad} />
              <Text style={a.cardEmoji}>{s.emoji}</Text>
              <Text style={[a.cardLabel, selectedStyle === s.id && { color: Colors.primary }]}>{s.label}</Text>
              {selectedStyle === s.id ? <View style={a.cardCheck}><MaterialIcons name="check-circle" size={14} color={Colors.primary} /></View> : null}
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable style={a.backBtn} onPress={() => setStep('pick')}>
            <Text style={a.backBtnText}>← Volver</Text>
          </Pressable>
          <Pressable style={{ flex: 2, borderRadius: Radius.lg, overflow: 'hidden' }} onPress={generateAvatar}>
            <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 }}>
              <MaterialCommunityIcons name="magic-staff" size={18} color="#fff" />
              <Text style={{ color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold }}>Generar avatar</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  // ── Step: generating ────────────────────────────────────────────────────
  if (step === 'generating') {
    return (
      <View style={a.generatingWrap}>
        <LinearGradient colors={['#7C5CFF', '#FF2D78', '#00E5A0']} style={a.generatingOrb}>
          <MaterialCommunityIcons name="robot-excited-outline" size={52} color="#fff" />
        </LinearGradient>
        <Text style={a.generatingTitle}>Generando tu avatar IA</Text>
        <Text style={a.generatingStatus}>{generatingStatus}</Text>
        <ActivityIndicator color={Colors.primary} size="large" style={{ marginTop: 16 }} />
        <Text style={a.generatingHint}>Esto tarda ~30 segundos con Gemini 2.5</Text>
      </View>
    );
  }

  // ── Step: result ─────────────────────────────────────────────────────────
  if (step === 'result' && avatarUrl) {
    const styleDef = AVATAR_STYLES.find(s => s.id === selectedStyle);
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, gap: 16, alignItems: 'center' }}>
        <Text style={a.resultTitle}>{`✨ Avatar ${styleDef?.label ?? ''} listo!`}</Text>
        <Image source={{ uri: avatarUrl }} style={a.resultImg} contentFit="cover" transition={300} />
        {photoUri ? (
          <View style={a.compRow}>
            <View style={a.compItem}>
              <Image source={{ uri: photoUri }} style={a.compImg} contentFit="cover" transition={200} />
              <Text style={a.compLabel}>Original</Text>
            </View>
            <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={a.compArrow}>
              <MaterialCommunityIcons name="magic-staff" size={16} color="#fff" />
            </LinearGradient>
            <View style={a.compItem}>
              <Image source={{ uri: avatarUrl }} style={a.compImg} contentFit="cover" transition={200} />
              <Text style={[a.compLabel, { color: Colors.primary }]}>{styleDef?.label}</Text>
            </View>
          </View>
        ) : null}
        <Pressable style={{ width: '100%', borderRadius: Radius.lg, overflow: 'hidden' }} onPress={publishAvatar}>
          <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16 }}>
            <MaterialCommunityIcons name="send-circle-outline" size={18} color="#fff" />
            <Text style={{ color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold }}>Publicar al feed</Text>
          </LinearGradient>
        </Pressable>
        <Pressable style={a.resetBtn} onPress={() => { setStep('pick'); setPhotoUri(null); setUploadedUrl(null); setAvatarUrl(null); }}>
          <MaterialCommunityIcons name="refresh" size={16} color={Colors.textSubtle} />
          <Text style={a.resetBtnText}>Crear otro avatar</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return null;
}

// ── Styles ─────────────────────────────────────────────────────────────────
const a = StyleSheet.create({
  heroCard:         { borderRadius: Radius.xl, overflow: 'hidden' },
  heroGrad:         { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18 },
  heroEmoji:        { fontSize: 38 },
  heroTitle:        { color: '#fff', fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  heroSub:          { color: 'rgba(255,255,255,0.75)', fontSize: FontSize.xs, marginTop: 2 },
  heroPowered:      { color: 'rgba(255,255,255,0.5)', fontSize: 10, marginTop: 4 },
  uploadingBox:     { alignItems: 'center', gap: 12, padding: 40 },
  uploadingText:    { color: Colors.textSubtle, fontSize: FontSize.sm },
  pickBtn:          { borderRadius: Radius.lg, overflow: 'hidden' },
  pickBtnInner:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16 },
  pickBtnText:      { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
  tipBox:           { backgroundColor: Colors.surfaceElevated, borderRadius: Radius.lg, padding: 16, gap: 8, borderWidth: 1, borderColor: Colors.border },
  tipTitle:         { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, marginBottom: 4 },
  tipRow:           { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  tipText:          { color: Colors.textSubtle, fontSize: FontSize.xs, flex: 1, lineHeight: 18 },
  photoPreview:     { width: 100, height: 100, borderRadius: 50, borderWidth: 3, borderColor: Colors.primary },
  stepTitle:        { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  grid:             { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card:             { width: (W - 42) / 4, alignItems: 'center', gap: 6, padding: 10, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.surface, position: 'relative' },
  cardActive:       { borderColor: Colors.primary, backgroundColor: Colors.primaryDim },
  cardGrad:         { width: 44, height: 44, borderRadius: 22 },
  cardEmoji:        { position: 'absolute', top: 15, fontSize: 20 },
  cardLabel:        { color: Colors.textSubtle, fontSize: 10, fontWeight: '600', textAlign: 'center' },
  cardCheck:        { position: 'absolute', top: 5, right: 5 },
  backBtn:          { flex: 1, backgroundColor: Colors.surfaceElevated, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderWidth: 1, borderColor: Colors.border },
  backBtnText:      { color: Colors.textSubtle, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  generatingWrap:   { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },
  generatingOrb:    { width: 110, height: 110, borderRadius: 55, alignItems: 'center', justifyContent: 'center' },
  generatingTitle:  { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold, textAlign: 'center' },
  generatingStatus: { color: Colors.textSubtle, fontSize: FontSize.sm, textAlign: 'center' },
  generatingHint:   { color: Colors.textSubtle, fontSize: 11, textAlign: 'center', lineHeight: 18 },
  resultTitle:      { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold, textAlign: 'center' },
  resultImg:        { width: W - 64, height: W - 64, borderRadius: Radius.xl, borderWidth: 2, borderColor: Colors.primary },
  compRow:          { flexDirection: 'row', alignItems: 'center', width: '100%' },
  compItem:         { flex: 1, alignItems: 'center', gap: 6 },
  compImg:          { width: 80, height: 80, borderRadius: 40, borderWidth: 2, borderColor: Colors.border },
  compLabel:        { color: Colors.textSubtle, fontSize: 11, fontWeight: '600' },
  compArrow:        { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  resetBtn:         { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  resetBtnText:     { color: Colors.textSubtle, fontSize: FontSize.sm },
});
