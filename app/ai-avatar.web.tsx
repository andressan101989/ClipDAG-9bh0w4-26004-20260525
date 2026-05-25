/**
 * app/ai-avatar.web.tsx — AI Avatar Generator (Web stub)
 * expo-video is not compatible with web bundler. This stub replaces it on web.
 */
import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView,
  TextInput, ActivityIndicator, Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { useFeed } from '@/hooks/useFeed';
import { useAlert } from '@/template';
import { getSupabaseClient } from '@/template';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Colors, FontSize, FontWeight, Radius } from '@/constants/theme';

const { width: W } = Dimensions.get('window');
const PREVIEW_SIZE = Math.min(W - 64, 400);

const AVATAR_STYLES = [
  { id: 'cartoon',    label: 'Cartoon',    emoji: '🎨', gradient: ['#7C5CFF', '#B44FFF'] as [string, string] },
  { id: 'anime',      label: 'Anime',      emoji: '⛩️',  gradient: ['#FF2D78', '#A855F7'] as [string, string] },
  { id: 'realistic',  label: 'Realistic',  emoji: '📷',  gradient: ['#2D9EFF', '#7C5CFF'] as [string, string] },
  { id: 'cinematic',  label: 'Cinematic',  emoji: '🎬',  gradient: ['#FF9D00', '#FF2D78'] as [string, string] },
  { id: 'pixel',      label: 'Pixel Art',  emoji: '👾',  gradient: ['#A855F7', '#7C5CFF'] as [string, string] },
  { id: 'glass',      label: 'Glass',      emoji: '✨',  gradient: ['#00E5A0', '#2D9EFF'] as [string, string] },
  { id: 'watercolor', label: 'Acuarela',   emoji: '🎭',  gradient: ['#FFB800', '#FF5A00'] as [string, string] },
  { id: 'neon',       label: 'Neon',       emoji: '🌈',  gradient: ['#FF2D78', '#7C5CFF'] as [string, string] },
];

type Step = 'upload' | 'style' | 'script' | 'generating' | 'result';

function StepDot({ num, active, done }: { num: number; active: boolean; done: boolean }) {
  return (
    <LinearGradient
      colors={done ? ['#00E5A0', '#2D9EFF'] : active ? ['#7C5CFF', '#FF2D78'] : ['#2C2C3A', '#1E1E28']}
      style={sd.dot}
    >
      {done
        ? <MaterialIcons name="check" size={13} color="#fff" />
        : <Text style={sd.num}>{num}</Text>}
    </LinearGradient>
  );
}
const sd = StyleSheet.create({
  dot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  num: { color: '#fff', fontSize: 12, fontWeight: '700' },
});

export default function AIAvatarScreen() {
  const insets   = useSafeAreaInsets();
  const router   = useRouter();
  const { user, updateProfile } = useAuth();
  const { addVideo } = useFeed();
  const { showAlert } = useAlert();
  const supabase = getSupabaseClient();

  const [step,          setStep]          = useState<Step>('upload');
  const [photoUri,      setPhotoUri]      = useState<string | null>(null);
  const [uploadedUrl,   setUploadedUrl]   = useState<string | null>(null);
  const [selectedStyle, setSelectedStyle] = useState('cartoon');
  const [script,        setScript]        = useState('');
  const [generateVideo, setGenerateVideo] = useState(false);
  const [avatarUrl,     setAvatarUrl]     = useState<string | null>(null);
  const [videoUrl,      setVideoUrl]      = useState<string | null>(null);
  const [predictionId,  setPredictionId]  = useState<string | null>(null);

  const [uploadingPhoto,   setUploadingPhoto]   = useState(false);
  const [generatingImage,  setGeneratingImage]  = useState(false);
  const [generatingVideo,  setGeneratingVideo]  = useState(false);
  const [videoProgress,    setVideoProgress]    = useState(0);
  const [pollingStatus,    setPollingStatus]    = useState('');
  const [applyingAvatar,   setApplyingAvatar]   = useState(false);
  const [publishingToFeed, setPublishingToFeed] = useState(false);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepIndex = { upload: 0, style: 1, script: 2, generating: 3, result: 4 }[step];

  const handlePickPhoto = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { showAlert('Sin acceso', 'Habilita la galería'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1,1], quality: 0.85 });
    if (res.canceled || !res.assets[0]) return;
    const uri = res.assets[0].uri;
    setPhotoUri(uri);
    setUploadingPhoto(true);
    try {
      const resp = await fetch(uri); const blob = await resp.blob(); const ab = await blob.arrayBuffer(); const bytes = new Uint8Array(ab);
      const fileName = `${user?.id ?? 'anon'}/avatar_src_${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage.from('images').upload(fileName, bytes, { contentType: 'image/jpeg', upsert: true });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from('images').getPublicUrl(fileName);
      setUploadedUrl(publicUrl);
    } catch (e: any) { showAlert('Error', e?.message || 'Intenta de nuevo'); setPhotoUri(null); setUploadingPhoto(false); return; }
    setUploadingPhoto(false); setStep('style');
  }, [user, supabase, showAlert]);

  const callEdgeFn = useCallback(async (body: object) => {
    const { data, error } = await supabase.functions.invoke('ai-avatar', { body });
    if (error) {
      let msg = error.message;
      if (error instanceof FunctionsHttpError) {
        try { const txt = await (error as any).context?.text(); msg = `[${(error as any).context?.status ?? 500}] ${txt || msg}`; } catch { /* ignore */ }
      }
      throw new Error(msg);
    }
    return data;
  }, [supabase]);

  const startVideoPolling = useCallback((predId: string) => {
    let done = false;
    pollIntervalRef.current = setInterval(async () => {
      if (done) return;
      try {
        const result = await callEdgeFn({ action: 'check-video', predictionId: predId });
        if (result.status === 'starting' || result.status === 'processing') {
          const pct = result.progress ?? 0; setVideoProgress(pct); setPollingStatus(pct > 0 ? `Generando video... ${pct}%` : 'Procesando...'); return;
        }
        done = true;
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        if (result.status === 'succeeded') { setVideoUrl(result.videoUrl); setGeneratingVideo(false); setVideoProgress(100); setStep('result'); }
        else { setGeneratingVideo(false); showAlert('Video fallido', 'Solo imagen disponible.'); setStep('result'); }
      } catch (err: any) { console.warn('[ai-avatar poll]', err?.message); }
    }, 5000);
  }, [callEdgeFn, showAlert]);

  const handleGenerateImage = useCallback(async () => {
    if (!uploadedUrl) { showAlert('Sin foto', 'Sube una foto primero'); return; }
    setStep('generating'); setGeneratingImage(true); setPollingStatus('Generando avatar con IA...');
    try {
      const result = await callEdgeFn({ action: 'generate-image', photoUrl: uploadedUrl, style: selectedStyle });
      setAvatarUrl(result.imageUrl);
      if (generateVideo && script.trim()) {
        setGeneratingImage(false); setGeneratingVideo(true); setPollingStatus('Iniciando generación de video...');
        const videoResult = await callEdgeFn({ action: 'generate-video', avatarUrl: result.imageUrl, script: script.trim(), duration: 5, aspectRatio: 'portrait' });
        setPredictionId(videoResult.predictionId); startVideoPolling(videoResult.predictionId);
      } else { setGeneratingImage(false); setStep('result'); }
    } catch (e: any) { setGeneratingImage(false); setGeneratingVideo(false); showAlert('Error de generación', e?.message || 'Intenta de nuevo'); setStep('script'); }
  }, [uploadedUrl, selectedStyle, generateVideo, script, callEdgeFn, showAlert, startVideoPolling]);

  const handleApplyToProfile = useCallback(async () => {
    if (!avatarUrl) return; setApplyingAvatar(true);
    try { await updateProfile({ avatar: avatarUrl } as any); showAlert('Avatar actualizado ✨', 'Tu avatar fue aplicado', [{ text: 'Ver perfil', onPress: () => router.replace('/(tabs)/profile') }]); }
    catch (e: any) { showAlert('Error', e?.message || 'No se pudo actualizar'); }
    setApplyingAvatar(false);
  }, [avatarUrl, updateProfile, showAlert, router]);

  const handlePublishToFeed = useCallback(async () => {
    const mediaUrl = videoUrl || avatarUrl; if (!mediaUrl) return; setPublishingToFeed(true);
    try {
      await addVideo({ videoUrl: mediaUrl, thumbnailUrl: avatarUrl || '', caption: `Mi nuevo avatar IA ${AVATAR_STYLES.find(s => s.id === selectedStyle)?.emoji || '✨'} #AIAvatar #ClipDAG`, music: 'Sin música', username: user?.username || '', userAvatar: user?.avatar || '' });
      showAlert('Publicado 🎉', 'Tu avatar fue publicado', [{ text: 'Ver feed', onPress: () => router.replace('/(tabs)') }]);
    } catch (e: any) { showAlert('Error', e?.message || 'No se pudo publicar'); }
    setPublishingToFeed(false);
  }, [videoUrl, avatarUrl, selectedStyle, addVideo, user, showAlert, router]);

  const handleReset = useCallback(() => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    setPhotoUri(null); setUploadedUrl(null); setAvatarUrl(null); setVideoUrl(null);
    setPredictionId(null); setScript(''); setGenerateVideo(false); setVideoProgress(0); setStep('upload');
  }, []);

  return (
    <View style={[root.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={root.header}>
        <Pressable style={root.backBtn} onPress={() => router.back()} hitSlop={10}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={Colors.textPrimary} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
          <Text style={root.headerTitle}>AI Avatar</Text>
          <Text style={root.headerSub}>Powered by OnSpace AI</Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      <View style={root.stepBar}>
        {['Foto', 'Estilo', 'Script', 'Generando', 'Resultado'].map((label, i) => (
          <React.Fragment key={i}>
            <View style={{ alignItems: 'center', gap: 4 }}>
              <StepDot num={i + 1} active={stepIndex === i} done={stepIndex > i} />
              <Text style={[root.stepLabel, stepIndex === i && { color: Colors.primary }]}>{label}</Text>
            </View>
            {i < 4 ? <View style={[root.stepLine, stepIndex > i && { backgroundColor: Colors.primary }]} /> : null}
          </React.Fragment>
        ))}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[root.scroll, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">

        {step === 'upload' ? (
          <View style={s1.wrap}>
            <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={s1.heroIconGrad}>
              <MaterialCommunityIcons name="robot-excited-outline" size={44} color="#fff" />
            </LinearGradient>
            <Text style={s1.title}>Crea tu avatar con IA</Text>
            <Text style={s1.sub}>Sube tu foto. La IA la transformará en un avatar profesional con el estilo que elijas.</Text>
            {uploadingPhoto ? (
              <View style={s1.uploading}><ActivityIndicator color={Colors.primary} size="large" /><Text style={s1.uploadingText}>Subiendo foto...</Text></View>
            ) : (
              <Pressable style={s1.btn} onPress={handlePickPhoto}>
                <LinearGradient colors={['#7C5CFF', '#B44FFF']} style={s1.btnInner}>
                  <MaterialCommunityIcons name="image-plus" size={22} color="#fff" />
                  <Text style={s1.btnText}>Subir foto</Text>
                </LinearGradient>
              </Pressable>
            )}
          </View>
        ) : null}

        {step === 'style' ? (
          <View style={s2.wrap}>
            {photoUri ? <Image source={{ uri: photoUri }} style={s2.photo} contentFit="cover" transition={200} /> : null}
            <Text style={s2.title}>Elige tu estilo</Text>
            <View style={s2.grid}>
              {AVATAR_STYLES.map(style => (
                <Pressable key={style.id} style={[s2.card, selectedStyle === style.id && { borderColor: Colors.primary, backgroundColor: Colors.primaryDim }]} onPress={() => setSelectedStyle(style.id)}>
                  <LinearGradient colors={style.gradient} style={s2.cardGrad} />
                  <Text style={s2.cardEmoji}>{style.emoji}</Text>
                  <Text style={[s2.cardLabel, selectedStyle === style.id && { color: Colors.primary }]}>{style.label}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable style={s2.nextBtn} onPress={() => setStep('script')}>
              <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={s2.nextBtnInner}><Text style={s2.nextBtnText}>Continuar →</Text></LinearGradient>
            </Pressable>
          </View>
        ) : null}

        {step === 'script' ? (
          <View style={s3.wrap}>
            <Text style={s3.title}>Script (Opcional)</Text>
            <Pressable style={[s3.toggle, generateVideo && s3.toggleActive]} onPress={() => setGenerateVideo(v => !v)}>
              <LinearGradient colors={generateVideo ? ['#7C5CFF', '#FF2D78'] : ['transparent', 'transparent']} style={s3.toggleGrad}>
                <MaterialCommunityIcons name={generateVideo ? 'video' : 'video-off-outline'} size={18} color={generateVideo ? '#fff' : Colors.textSubtle} />
                <Text style={[s3.toggleText, generateVideo && { color: '#fff' }]}>{generateVideo ? 'Generar video hablando' : 'Solo imagen'}</Text>
              </LinearGradient>
            </Pressable>
            {generateVideo ? (
              <TextInput style={s3.input} value={script} onChangeText={t => { if (t.length <= 200) setScript(t); }} placeholder="Hola, soy tu nombre..." placeholderTextColor={Colors.textSubtle} multiline numberOfLines={4} maxLength={200} />
            ) : null}
            <View style={s3.btnRow}>
              <Pressable style={s3.backBtn} onPress={() => setStep('style')}><Text style={s3.backBtnText}>← Atrás</Text></Pressable>
              <Pressable style={s3.genBtn} onPress={handleGenerateImage}>
                <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={s3.genBtnInner}>
                  <MaterialCommunityIcons name="magic-staff" size={16} color="#fff" />
                  <Text style={s3.genBtnText}>Generar avatar</Text>
                </LinearGradient>
              </Pressable>
            </View>
          </View>
        ) : null}

        {step === 'generating' ? (
          <View style={sg.wrap}>
            <LinearGradient colors={['#7C5CFF', '#FF2D78', '#00E5A0']} style={sg.orbGrad}>
              <MaterialCommunityIcons name="robot-excited-outline" size={52} color="#fff" />
            </LinearGradient>
            <Text style={sg.title}>Generando avatar IA</Text>
            <Text style={sg.sub}>{pollingStatus}</Text>
            <ActivityIndicator color={Colors.primary} size="large" style={{ marginTop: 16 }} />
          </View>
        ) : null}

        {step === 'result' ? (
          <View style={sr.wrap}>
            <Text style={sr.title}>{videoUrl ? '🎬 Video Listo!' : '✨ Avatar Listo!'}</Text>
            {/* On web, show video as <video> tag via Image or just show avatar image */}
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={sr.media} contentFit="cover" transition={300} />
            ) : null}
            {videoUrl ? (
              <View style={sr.videoBanner}>
                <MaterialCommunityIcons name="video-check" size={20} color={Colors.primary} />
                <Text style={sr.videoBannerText}>Video generado. Disponible en la app móvil.</Text>
              </View>
            ) : null}
            <View style={sr.actions}>
              <Pressable style={[sr.actionBtn, { backgroundColor: Colors.accentDim, borderColor: Colors.accent }]} onPress={handleApplyToProfile} disabled={applyingAvatar}>
                {applyingAvatar ? <ActivityIndicator color={Colors.accent} size="small" /> : <MaterialCommunityIcons name="account-circle-outline" size={18} color={Colors.accent} />}
                <Text style={[sr.actionBtnText, { color: Colors.accent }]}>{applyingAvatar ? 'Aplicando...' : 'Usar como avatar'}</Text>
              </Pressable>
              <Pressable style={sr.publishBigBtn} onPress={handlePublishToFeed} disabled={publishingToFeed}>
                <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={sr.publishBigBtnInner}>
                  {publishingToFeed ? <ActivityIndicator color="#fff" size="small" /> : <MaterialCommunityIcons name="send-circle-outline" size={18} color="#fff" />}
                  <Text style={sr.publishBigBtnText}>{publishingToFeed ? 'Publicando...' : 'Publicar al feed'}</Text>
                </LinearGradient>
              </Pressable>
            </View>
            <Pressable style={sr.resetBtn} onPress={handleReset}>
              <MaterialCommunityIcons name="refresh" size={16} color={Colors.textSubtle} />
              <Text style={sr.resetText}>Crear otro avatar</Text>
            </Pressable>
          </View>
        ) : null}

      </ScrollView>
    </View>
  );
}

const root = StyleSheet.create({
  container:   { flex: 1, backgroundColor: Colors.bg },
  header:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border },
  backBtn:     { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surfaceElevated, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
  headerTitle: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  headerSub:   { color: Colors.primary, fontSize: 10, fontWeight: FontWeight.medium },
  stepBar:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, paddingHorizontal: 12 },
  stepLabel:   { color: Colors.textSubtle, fontSize: 9, fontWeight: '600', textAlign: 'center' },
  stepLine:    { flex: 1, height: 2, backgroundColor: Colors.border, marginHorizontal: 2, marginBottom: 14, maxWidth: 24 },
  scroll:      { padding: 20 },
});
const s1 = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 20, paddingVertical: 16 },
  heroIconGrad: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  title: { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold, textAlign: 'center' },
  sub: { color: Colors.textSubtle, fontSize: FontSize.sm, textAlign: 'center', lineHeight: 20 },
  uploading: { alignItems: 'center', gap: 12, padding: 24 },
  uploadingText: { color: Colors.textSubtle, fontSize: FontSize.sm },
  btn: { borderRadius: Radius.lg, overflow: 'hidden', width: '100%' },
  btnInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16 },
  btnText: { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
});
const s2 = StyleSheet.create({
  wrap: { gap: 16, paddingVertical: 8 },
  photo: { width: 90, height: 90, borderRadius: 45, alignSelf: 'center', borderWidth: 3, borderColor: Colors.primary },
  title: { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: { width: (Math.min(W - 40, 480) - 30) / 4, alignItems: 'center', gap: 6, padding: 10, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.surface, position: 'relative' },
  cardGrad: { width: 44, height: 44, borderRadius: 22 },
  cardEmoji: { position: 'absolute', top: 15, fontSize: 18 },
  cardLabel: { color: Colors.textSubtle, fontSize: 10, fontWeight: '600', textAlign: 'center' },
  nextBtn: { borderRadius: Radius.lg, overflow: 'hidden', marginTop: 4 },
  nextBtnInner: { paddingVertical: 16, alignItems: 'center' },
  nextBtnText: { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
});
const s3 = StyleSheet.create({
  wrap: { gap: 16, paddingVertical: 8 },
  title: { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  toggle: { borderRadius: Radius.lg, overflow: 'hidden', borderWidth: 1.5, borderColor: Colors.border },
  toggleActive: { borderColor: Colors.primary },
  toggleGrad: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, paddingHorizontal: 16 },
  toggleText: { color: Colors.textSubtle, fontSize: FontSize.sm, fontWeight: FontWeight.medium, flex: 1 },
  input: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 12, color: Colors.textPrimary, fontSize: FontSize.md, minHeight: 100, textAlignVertical: 'top' },
  btnRow: { flexDirection: 'row', gap: 12 },
  backBtn: { flex: 1, backgroundColor: Colors.surfaceElevated, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderWidth: 1, borderColor: Colors.border },
  backBtnText: { color: Colors.textSubtle, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  genBtn: { flex: 2, borderRadius: Radius.lg, overflow: 'hidden' },
  genBtnInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  genBtnText: { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
});
const sg = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 20, paddingVertical: 24 },
  orbGrad: { width: 110, height: 110, borderRadius: 55, alignItems: 'center', justifyContent: 'center' },
  title: { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold, textAlign: 'center' },
  sub: { color: Colors.textSubtle, fontSize: FontSize.sm, textAlign: 'center' },
});
const sr = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 20, paddingVertical: 8 },
  title: { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold, textAlign: 'center' },
  media: { width: PREVIEW_SIZE, height: PREVIEW_SIZE, borderRadius: Radius.xl, borderWidth: 2, borderColor: Colors.primary },
  videoBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.primaryDim, borderRadius: Radius.md, padding: 12, borderWidth: 1, borderColor: Colors.primary + '44', width: '100%' },
  videoBannerText: { flex: 1, color: Colors.primary, fontSize: FontSize.xs, lineHeight: 18 },
  actions: { gap: 10, width: '100%' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 14, borderRadius: Radius.lg, borderWidth: 1.5 },
  actionBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  publishBigBtn: { width: '100%', borderRadius: Radius.lg, overflow: 'hidden' },
  publishBigBtnInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16 },
  publishBigBtnText: { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
  resetBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  resetText: { color: Colors.textSubtle, fontSize: FontSize.sm },
});
