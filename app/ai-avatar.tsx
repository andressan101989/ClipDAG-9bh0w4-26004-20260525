/**
 * app/ai-avatar.tsx — AI Avatar Generator
 *
 * User uploads a photo → chooses style → AI generates a styled avatar image.
 * Optional: enter a script → AI generates a talking avatar video (Sora-2).
 * Result can be applied to profile or published to feed.
 *
 * Uses OnSpace AI (image: gemini-2.5-flash-image, video: sora-2)
 * via the ai-avatar Edge Function.
 */
import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView,
  TextInput, ActivityIndicator, Dimensions, Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
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
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';

const { width: W } = Dimensions.get('window');
const PREVIEW_SIZE = W - 64;

// ── Avatar style definitions ──────────────────────────────────────────────────
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

// ── Step definitions ──────────────────────────────────────────────────────────
type Step = 'upload' | 'style' | 'script' | 'generating' | 'result';

// ── Step indicator ────────────────────────────────────────────────────────────
function StepDot({ num, active, done }: { num: number; active: boolean; done: boolean }) {
  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <LinearGradient
        colors={done ? ['#00E5A0', '#2D9EFF'] : active ? ['#7C5CFF', '#FF2D78'] : ['#2C2C3A', '#1E1E28']}
        style={sd.dot}
      >
        {done
          ? <MaterialIcons name="check" size={13} color="#fff" />
          : <Text style={sd.num}>{num}</Text>
        }
      </LinearGradient>
    </View>
  );
}
const sd = StyleSheet.create({
  dot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  num: { color: '#fff', fontSize: 12, fontWeight: '700' },
});

// ════════════════════════════════════════════════════════════════════════════
// MAIN SCREEN
// ════════════════════════════════════════════════════════════════════════════
export default function AIAvatarScreen() {
  const insets   = useSafeAreaInsets();
  const router   = useRouter();
  const { user, updateProfile } = useAuth();
  const { addVideo } = useFeed();
  const { showAlert } = useAlert();
  const supabase = getSupabaseClient();

  // State
  const [step,          setStep]          = useState<Step>('upload');
  const [photoUri,      setPhotoUri]      = useState<string | null>(null);
  const [uploadedUrl,   setUploadedUrl]   = useState<string | null>(null); // URL after Supabase upload
  const [selectedStyle, setSelectedStyle] = useState('cartoon');
  const [script,        setScript]        = useState('');
  const [generateVideo, setGenerateVideo] = useState(false);

  // Results
  const [avatarUrl,    setAvatarUrl]    = useState<string | null>(null);
  const [videoUrl,     setVideoUrl]     = useState<string | null>(null);
  const [predictionId, setPredictionId] = useState<string | null>(null);

  // expo-video player for result video
  const resultPlayer = useVideoPlayer(
    videoUrl ? { uri: videoUrl } : null,
    p => { if (p && videoUrl) { p.loop = true; p.play(); } }
  );

  // Loading states
  const [uploadingPhoto,    setUploadingPhoto]    = useState(false);
  const [generatingImage,   setGeneratingImage]   = useState(false);
  const [generatingVideo,   setGeneratingVideo]   = useState(false);
  const [videoProgress,     setVideoProgress]     = useState(0);
  const [pollingStatus,     setPollingStatus]     = useState('');
  const [applyingAvatar,    setApplyingAvatar]    = useState(false);
  const [publishingToFeed,  setPublishingToFeed]  = useState(false);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Step helpers ──────────────────────────────────────────────────────────
  const stepIndex = { upload: 0, style: 1, script: 2, generating: 3, result: 4 }[step];

  // ── Pick photo from gallery ────────────────────────────────────────────────
  const handlePickPhoto = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      showAlert('Sin acceso', 'Habilita la galería en Ajustes del dispositivo');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (res.canceled || !res.assets[0]) return;

    const uri = res.assets[0].uri;
    setPhotoUri(uri);

    // Upload photo to Supabase Storage so Edge Function can access it via public URL
    setUploadingPhoto(true);
    try {
      const resp      = await fetch(uri);
      const blob      = await resp.blob();
      const ab        = await blob.arrayBuffer();
      const bytes     = new Uint8Array(ab);
      const fileName  = `${user?.id ?? 'anon'}/avatar_src_${Date.now()}.jpg`;

      const { error: upErr } = await supabase.storage
        .from('images').upload(fileName, bytes, { contentType: 'image/jpeg', upsert: true });

      if (upErr) throw upErr;

      const { data: { publicUrl } } = supabase.storage.from('images').getPublicUrl(fileName);
      setUploadedUrl(publicUrl);
    } catch (e: any) {
      showAlert('Error al subir foto', e?.message || 'Intenta de nuevo');
      setPhotoUri(null);
      setUploadingPhoto(false);
      return;
    }
    setUploadingPhoto(false);
    setStep('style');
  }, [user, supabase, showAlert]);

  // ── Take selfie ────────────────────────────────────────────────────────────
  const handleTakeSelfie = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      showAlert('Sin acceso', 'Habilita la cámara en Ajustes del dispositivo');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({
      cameraType: ImagePicker.CameraType.front,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (res.canceled || !res.assets[0]) return;
    const uri = res.assets[0].uri;
    setPhotoUri(uri);

    setUploadingPhoto(true);
    try {
      const resp     = await fetch(uri);
      const blob     = await resp.blob();
      const ab       = await blob.arrayBuffer();
      const bytes    = new Uint8Array(ab);
      const fileName = `${user?.id ?? 'anon'}/selfie_${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage
        .from('images').upload(fileName, bytes, { contentType: 'image/jpeg', upsert: true });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from('images').getPublicUrl(fileName);
      setUploadedUrl(publicUrl);
    } catch (e: any) {
      showAlert('Error', e?.message || 'Intenta de nuevo');
      setPhotoUri(null);
      setUploadingPhoto(false);
      return;
    }
    setUploadingPhoto(false);
    setStep('style');
  }, [user, supabase, showAlert]);

  // ── Call Edge Function ─────────────────────────────────────────────────────
  const callEdgeFn = useCallback(async (body: object) => {
    const { data, error } = await supabase.functions.invoke('ai-avatar', { body });
    if (error) {
      let msg = error.message;
      if (error instanceof FunctionsHttpError) {
        try {
          const txt = await (error as any).context?.text();
          msg = `[${(error as any).context?.status ?? 500}] ${txt || msg}`;
        } catch { /* ignore */ }
      }
      throw new Error(msg);
    }
    return data;
  }, [supabase]);

  // ── Generate avatar image ─────────────────────────────────────────────────
  const handleGenerateImage = useCallback(async () => {
    if (!uploadedUrl) { showAlert('Sin foto', 'Sube una foto primero'); return; }
    setStep('generating');
    setGeneratingImage(true);
    setPollingStatus('Generando avatar con IA...');
    try {
      const result = await callEdgeFn({
        action:   'generate-image',
        photoUrl: uploadedUrl,
        style:    selectedStyle,
      });
      setAvatarUrl(result.imageUrl);

      if (generateVideo && script.trim()) {
        setGeneratingImage(false);
        setGeneratingVideo(true);
        setPollingStatus('Iniciando generación de video...');

        const videoResult = await callEdgeFn({
          action:      'generate-video',
          avatarUrl:   result.imageUrl,
          script:      script.trim(),
          duration:    5,
          aspectRatio: 'portrait',
        });

        setPredictionId(videoResult.predictionId);
        startVideoPolling(videoResult.predictionId);
      } else {
        setGeneratingImage(false);
        setStep('result');
      }
    } catch (e: any) {
      setGeneratingImage(false);
      setGeneratingVideo(false);
      showAlert('Error de generación', e?.message || 'Intenta de nuevo');
      setStep('script');
    }
  }, [uploadedUrl, selectedStyle, generateVideo, script, callEdgeFn, showAlert]);

  // ── Poll video status ──────────────────────────────────────────────────────
  const startVideoPolling = useCallback((predId: string) => {
    let videoUploaded = false;

    pollIntervalRef.current = setInterval(async () => {
      if (videoUploaded) return;
      try {
        const result = await callEdgeFn({ action: 'check-video', predictionId: predId });

        if (result.status === 'starting' || result.status === 'processing') {
          const pct = result.progress ?? 0;
          setVideoProgress(pct);
          setPollingStatus(pct > 0 ? `Generando video... ${pct}%` : 'Procesando video...');
          return;
        }

        if (result.status === 'succeeded') {
          videoUploaded = true;
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          setVideoUrl(result.videoUrl);
          setGeneratingVideo(false);
          setVideoProgress(100);
          setStep('result');
          return;
        }

        // Failed
        videoUploaded = true;
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        setGeneratingVideo(false);
        showAlert('Video fallido', 'No se pudo generar el video. Se muestra solo la imagen.');
        setStep('result');
      } catch (err: any) {
        console.warn('[ai-avatar poll]', err?.message);
      }
    }, 5000);
  }, [callEdgeFn, showAlert]);

  // ── Apply avatar to profile ────────────────────────────────────────────────
  const handleApplyToProfile = useCallback(async () => {
    if (!avatarUrl) return;
    setApplyingAvatar(true);
    try {
      await updateProfile({ avatar: avatarUrl } as any);
      showAlert('Avatar actualizado ✨', 'Tu avatar fue aplicado al perfil', [
        { text: 'Ver perfil', onPress: () => router.replace('/(tabs)/profile') },
      ]);
    } catch (e: any) {
      showAlert('Error', e?.message || 'No se pudo actualizar');
    }
    setApplyingAvatar(false);
  }, [avatarUrl, updateProfile, showAlert, router]);

  // ── Publish video/image to feed ────────────────────────────────────────────
  const handlePublishToFeed = useCallback(async () => {
    const mediaUrl = videoUrl || avatarUrl;
    if (!mediaUrl) return;
    setPublishingToFeed(true);
    try {
      await addVideo({
        videoUrl:   mediaUrl,
        thumbnailUrl: avatarUrl || '',
        caption:    `Mi nuevo avatar IA ${AVATAR_STYLES.find(s => s.id === selectedStyle)?.emoji || '✨'} #AIAvatar #ClipDAG #Creator`,
        music:      'Sin música',
        username:   user?.username || '',
        userAvatar: user?.avatar || '',
      });
      showAlert('Publicado 🎉', 'Tu avatar fue publicado al feed', [
        { text: 'Ver feed', onPress: () => router.replace('/(tabs)') },
      ]);
    } catch (e: any) {
      showAlert('Error', e?.message || 'No se pudo publicar');
    }
    setPublishingToFeed(false);
  }, [videoUrl, avatarUrl, selectedStyle, addVideo, user, showAlert, router]);

  // ── Reset ──────────────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    setPhotoUri(null);
    setUploadedUrl(null);
    setAvatarUrl(null);
    setVideoUrl(null);
    setPredictionId(null);
    setScript('');
    setGenerateVideo(false);
    setVideoProgress(0);
    setStep('upload');
  }, []);

  // ════════════════════════════════════════════════════════════════════════════
  return (
    <View style={[root.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* ── Header ──────────────────────────────────────────────────────── */}
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

      {/* ── Step indicator ───────────────────────────────────────────────── */}
      <View style={root.stepBar}>
        {['Foto', 'Estilo', 'Script', 'Generando', 'Resultado'].map((label, i) => (
          <React.Fragment key={i}>
            <View style={{ alignItems: 'center', gap: 4 }}>
              <StepDot num={i + 1} active={stepIndex === i} done={stepIndex > i} />
              <Text style={[root.stepLabel, stepIndex === i && { color: Colors.primary }]}>
                {label}
              </Text>
            </View>
            {i < 4 ? (
              <View style={[root.stepLine, stepIndex > i && { backgroundColor: Colors.primary }]} />
            ) : null}
          </React.Fragment>
        ))}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[root.scroll, { paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
      >

        {/* ════════════════════════════════════════════════════════════════
            STEP 1: UPLOAD PHOTO
        ════════════════════════════════════════════════════════════════ */}
        {step === 'upload' ? (
          <View style={step1.wrap}>
            <View style={step1.heroIcon}>
              <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={step1.heroIconGrad}>
                <MaterialCommunityIcons name="robot-excited-outline" size={44} color="#fff" />
              </LinearGradient>
            </View>
            <Text style={step1.title}>Crea tu avatar con IA</Text>
            <Text style={step1.sub}>
              Sube tu foto o tómate una selfie. La IA transformará tu imagen en un avatar profesional con el estilo que elijas.
            </Text>

            {uploadingPhoto ? (
              <View style={step1.uploading}>
                <ActivityIndicator color={Colors.primary} size="large" />
                <Text style={step1.uploadingText}>Subiendo foto...</Text>
              </View>
            ) : (
              <View style={step1.btnGroup}>
                <Pressable style={step1.btn} onPress={handlePickPhoto}>
                  <LinearGradient colors={['#7C5CFF', '#B44FFF']} style={step1.btnInner}>
                    <MaterialCommunityIcons name="image-plus" size={22} color="#fff" />
                    <Text style={step1.btnText}>Subir foto</Text>
                  </LinearGradient>
                </Pressable>

                <Pressable style={step1.btn} onPress={handleTakeSelfie}>
                  <LinearGradient colors={['#FF2D78', '#FF9D00']} style={step1.btnInner}>
                    <MaterialCommunityIcons name="camera-outline" size={22} color="#fff" />
                    <Text style={step1.btnText}>Tomar selfie</Text>
                  </LinearGradient>
                </Pressable>
              </View>
            )}

            {/* Tips */}
            <View style={step1.tips}>
              {[
                { icon: 'face-man', text: 'Usa una foto con el rostro visible y bien iluminado' },
                { icon: 'image-filter-center-focus', text: 'Mejor resultado con fondo claro y neutro' },
                { icon: 'crop-free', text: 'Foto cuadrada o retrato funciona mejor' },
              ].map((tip, i) => (
                <View key={i} style={step1.tip}>
                  <MaterialCommunityIcons name={tip.icon as any} size={14} color={Colors.primary} />
                  <Text style={step1.tipText}>{tip.text}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* ════════════════════════════════════════════════════════════════
            STEP 2: CHOOSE STYLE
        ════════════════════════════════════════════════════════════════ */}
        {step === 'style' ? (
          <View style={step2.wrap}>
            {/* Source photo preview */}
            {photoUri ? (
              <View style={step2.photoPreview}>
                <Image source={{ uri: photoUri }} style={step2.photo} contentFit="cover" transition={200} />
                <View style={step2.photoOverlay}>
                  <Text style={step2.photoLabel}>Tu foto</Text>
                </View>
              </View>
            ) : null}

            <Text style={step2.title}>Elige tu estilo</Text>
            <Text style={step2.sub}>Selecciona cómo quieres que se vea tu avatar</Text>

            <View style={step2.grid}>
              {AVATAR_STYLES.map(style => (
                <Pressable key={style.id}
                  style={[step2.card, selectedStyle === style.id && { borderColor: Colors.primary, backgroundColor: Colors.primaryDim }]}
                  onPress={() => setSelectedStyle(style.id)}>
                  <LinearGradient colors={style.gradient} style={step2.cardGrad} />
                  <Text style={step2.cardEmoji}>{style.emoji}</Text>
                  <Text style={[step2.cardLabel, selectedStyle === style.id && { color: Colors.primary }]}>
                    {style.label}
                  </Text>
                  {selectedStyle === style.id ? (
                    <View style={step2.checkmark}>
                      <MaterialIcons name="check-circle" size={16} color={Colors.primary} />
                    </View>
                  ) : null}
                </Pressable>
              ))}
            </View>

            <Pressable style={step2.nextBtn} onPress={() => setStep('script')}>
              <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={step2.nextBtnInner}>
                <Text style={step2.nextBtnText}>Continuar →</Text>
              </LinearGradient>
            </Pressable>
          </View>
        ) : null}

        {/* ════════════════════════════════════════════════════════════════
            STEP 3: SCRIPT (OPTIONAL VIDEO)
        ════════════════════════════════════════════════════════════════ */}
        {step === 'script' ? (
          <View style={step3.wrap}>
            {/* Selected style preview */}
            <View style={step3.stylePreview}>
              {(() => {
                const s = AVATAR_STYLES.find(x => x.id === selectedStyle);
                return s ? (
                  <LinearGradient colors={s.gradient} style={step3.stylePreviewGrad}>
                    <Text style={{ fontSize: 28 }}>{s.emoji}</Text>
                  </LinearGradient>
                ) : null;
              })()}
              <Text style={step3.styleLabel}>
                Estilo: {AVATAR_STYLES.find(x => x.id === selectedStyle)?.label}
              </Text>
            </View>

            <Text style={step3.title}>Avatar con voz (Opcional)</Text>
            <Text style={step3.sub}>
              Escribe un mensaje y la IA generará un video de tu avatar hablando. Si no quieres video, puedes omitir este paso.
            </Text>

            {/* Video toggle */}
            <Pressable
              style={[step3.toggle, generateVideo && step3.toggleActive]}
              onPress={() => setGenerateVideo(v => !v)}
            >
              <LinearGradient
                colors={generateVideo ? ['#7C5CFF', '#FF2D78'] : ['transparent', 'transparent']}
                style={step3.toggleGrad}
              >
                <MaterialCommunityIcons
                  name={generateVideo ? 'video' : 'video-off-outline'}
                  size={18}
                  color={generateVideo ? '#fff' : Colors.textSubtle}
                />
                <Text style={[step3.toggleText, generateVideo && { color: '#fff' }]}>
                  {generateVideo ? 'Generar video de avatar hablando' : 'Solo imagen (más rápido)'}
                </Text>
              </LinearGradient>
            </Pressable>

            {generateVideo ? (
              <>
                <Text style={step3.fieldLabel}>Script para el avatar ({script.length}/200)</Text>
                <TextInput
                  style={step3.input}
                  value={script}
                  onChangeText={t => { if (t.length <= 200) setScript(t); }}
                  placeholder="Hola, soy [tu nombre]. Bienvenidos a mi canal de ClipDAG..."
                  placeholderTextColor={Colors.textSubtle}
                  multiline
                  numberOfLines={4}
                  maxLength={200}
                />

                {/* Quick scripts */}
                <Text style={step3.quickLabel}>Guiones rápidos</Text>
                {[
                  `Hola! Soy ${user?.username || 'tu nombre'} y bienvenidos a mi canal. ¡Sígueme para más contenido!`,
                  'Nuevo video disponible. No te lo pierdas y compártelo con tus amigos.',
                  '¡Gracias por llegar a este video! Déjame un comentario con lo que quieres ver.',
                ].map((qs, i) => (
                  <Pressable key={i} style={step3.quickItem} onPress={() => setScript(qs)}>
                    <MaterialCommunityIcons name="text-box-outline" size={14} color={Colors.primary} />
                    <Text style={step3.quickText} numberOfLines={2}>{qs}</Text>
                  </Pressable>
                ))}

                <View style={step3.warningBox}>
                  <MaterialCommunityIcons name="clock-outline" size={14} color={Colors.warning} />
                  <Text style={step3.warningText}>
                    La generación de video puede tardar 2–5 minutos. La imagen estará lista en ~30 segundos.
                  </Text>
                </View>
              </>
            ) : null}

            <View style={step3.btnRow}>
              <Pressable style={step3.backBtn} onPress={() => setStep('style')}>
                <Text style={step3.backBtnText}>← Atrás</Text>
              </Pressable>
              <Pressable style={step3.genBtn} onPress={handleGenerateImage}>
                <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={step3.genBtnInner}>
                  <MaterialCommunityIcons name="magic-staff" size={16} color="#fff" />
                  <Text style={step3.genBtnText}>Generar avatar</Text>
                </LinearGradient>
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* ════════════════════════════════════════════════════════════════
            STEP 4: GENERATING
        ════════════════════════════════════════════════════════════════ */}
        {step === 'generating' ? (
          <View style={gen.wrap}>
            {/* Animated gradient orb */}
            <View style={gen.orb}>
              <LinearGradient colors={['#7C5CFF', '#FF2D78', '#00E5A0']} style={gen.orbGrad}>
                <MaterialCommunityIcons
                  name={generatingVideo ? 'video-box' : 'robot-excited-outline'}
                  size={52}
                  color="#fff"
                />
              </LinearGradient>
            </View>

            <Text style={gen.title}>
              {generatingVideo ? 'Generando video avatar' : 'Generando avatar IA'}
            </Text>
            <Text style={gen.sub}>{pollingStatus}</Text>

            {/* Progress bar */}
            {generatingVideo ? (
              <View style={gen.progressWrap}>
                <View style={gen.progressTrack}>
                  <LinearGradient
                    colors={['#7C5CFF', '#FF2D78']}
                    style={[gen.progressFill, { width: `${Math.max(5, videoProgress)}%` }]}
                  />
                </View>
                <Text style={gen.progressPct}>{videoProgress}%</Text>
              </View>
            ) : (
              <ActivityIndicator color={Colors.primary} size="large" style={{ marginTop: 16 }} />
            )}

            {/* Preview of source photo while waiting */}
            {photoUri ? (
              <View style={gen.sourcePreview}>
                <Image source={{ uri: photoUri }} style={gen.sourceImg} contentFit="cover" transition={200} />
                <MaterialCommunityIcons name="arrow-right-bold" size={20} color={Colors.primary} style={{ marginHorizontal: 12 }} />
                <View style={[gen.resultPlaceholder, { borderColor: Colors.border }]}>
                  <ActivityIndicator color={Colors.primary} />
                </View>
              </View>
            ) : null}

            <Text style={gen.disclaimer}>
              {generatingVideo
                ? 'Sora-2 está animando tu avatar. Esto puede tomar 2–5 minutos.'
                : 'Gemini está procesando tu foto. Esto tarda ~30 segundos.'}
            </Text>
          </View>
        ) : null}

        {/* ════════════════════════════════════════════════════════════════
            STEP 5: RESULT
        ════════════════════════════════════════════════════════════════ */}
        {step === 'result' ? (
          <View style={res.wrap}>
            <Text style={res.title}>
              {videoUrl ? '🎬 Video Avatar Listo!' : '✨ Avatar Listo!'}
            </Text>

            {/* Result media */}
            {videoUrl ? (
              <VideoView
                player={resultPlayer}
                style={res.media}
                contentFit="cover"
                nativeControls={false}
              />
            ) : avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={res.media} contentFit="cover" transition={300} />
            ) : null}

            {/* Comparison */}
            {photoUri && avatarUrl ? (
              <View style={res.comparison}>
                <View style={res.compItem}>
                  <Image source={{ uri: photoUri }} style={res.compImg} contentFit="cover" transition={200} />
                  <Text style={res.compLabel}>Original</Text>
                </View>
                <View style={res.compArrow}>
                  <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={res.compArrowGrad}>
                    <MaterialCommunityIcons name="magic-staff" size={18} color="#fff" />
                  </LinearGradient>
                </View>
                <View style={res.compItem}>
                  <Image source={{ uri: avatarUrl }} style={res.compImg} contentFit="cover" transition={200} />
                  <Text style={[res.compLabel, { color: Colors.primary }]}>
                    {AVATAR_STYLES.find(s => s.id === selectedStyle)?.label}
                  </Text>
                </View>
              </View>
            ) : null}

            {/* Action buttons */}
            <View style={res.actions}>
              <Pressable
                style={[res.actionBtn, { backgroundColor: Colors.accentDim, borderColor: Colors.accent }]}
                onPress={handleApplyToProfile}
                disabled={applyingAvatar}
              >
                {applyingAvatar
                  ? <ActivityIndicator color={Colors.accent} size="small" />
                  : <MaterialCommunityIcons name="account-circle-outline" size={18} color={Colors.accent} />
                }
                <Text style={[res.actionBtnText, { color: Colors.accent }]}>
                  {applyingAvatar ? 'Aplicando...' : 'Usar como avatar'}
                </Text>
              </Pressable>

              <Pressable
                style={res.publishBigBtn}
                onPress={handlePublishToFeed}
                disabled={publishingToFeed}
              >
                <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={res.publishBigBtnInner}>
                  {publishingToFeed
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <MaterialCommunityIcons name="send-circle-outline" size={18} color="#fff" />
                  }
                  <Text style={res.publishBigBtnText}>
                    {publishingToFeed ? 'Publicando...' : 'Publicar al feed'}
                  </Text>
                </LinearGradient>
              </Pressable>
            </View>

            {!videoUrl && generateVideo && predictionId ? (
              <View style={res.videoStillGenerating}>
                <ActivityIndicator color={Colors.warning} size="small" />
                <Text style={res.videoStillText}>
                  El video aún se está generando. Puedes usar la imagen mientras tanto.
                </Text>
              </View>
            ) : null}

            <Pressable style={res.resetBtn} onPress={handleReset}>
              <MaterialCommunityIcons name="refresh" size={16} color={Colors.textSubtle} />
              <Text style={res.resetText}>Crear otro avatar</Text>
            </Pressable>
          </View>
        ) : null}

      </ScrollView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const root = StyleSheet.create({
  container:   { flex: 1, backgroundColor: Colors.bg },
  header:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border },
  backBtn:     { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: Colors.surfaceElevated, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
  headerTitle: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  headerSub:   { color: Colors.primary, fontSize: 10, fontWeight: FontWeight.medium },
  stepBar:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, paddingHorizontal: 12, gap: 0 },
  stepLabel:   { color: Colors.textSubtle, fontSize: 9, fontWeight: '600', textAlign: 'center' },
  stepLine:    { flex: 1, height: 2, backgroundColor: Colors.border, marginHorizontal: 2, marginBottom: 14, maxWidth: 24 },
  scroll:      { padding: 20, gap: 0 },
});

const step1 = StyleSheet.create({
  wrap:          { alignItems: 'center', gap: 20, paddingVertical: 16 },
  heroIcon:      { },
  heroIconGrad:  { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  title:         { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold, textAlign: 'center' },
  sub:           { color: Colors.textSubtle, fontSize: FontSize.sm, textAlign: 'center', lineHeight: 20, maxWidth: W - 80 },
  uploading:     { alignItems: 'center', gap: 12, padding: 24 },
  uploadingText: { color: Colors.textSubtle, fontSize: FontSize.sm },
  btnGroup:      { gap: 12, width: '100%' },
  btn:           { borderRadius: Radius.lg, overflow: 'hidden' },
  btnInner:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16 },
  btnText:       { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
  tips:          { gap: 10, width: '100%', backgroundColor: Colors.surfaceElevated, borderRadius: Radius.lg, padding: 16, borderWidth: 1, borderColor: Colors.border },
  tip:           { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  tipText:       { color: Colors.textSubtle, fontSize: FontSize.xs, flex: 1, lineHeight: 18 },
});

const step2 = StyleSheet.create({
  wrap:         { gap: 16, paddingVertical: 8 },
  photoPreview: { alignSelf: 'center', position: 'relative' },
  photo:        { width: 90, height: 90, borderRadius: 45, borderWidth: 3, borderColor: Colors.primary },
  photoOverlay: { position: 'absolute', bottom: -6, alignSelf: 'center', backgroundColor: Colors.primary, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  photoLabel:   { color: '#fff', fontSize: 9, fontWeight: '700' },
  title:        { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  sub:          { color: Colors.textSubtle, fontSize: FontSize.sm },
  grid:         { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card:         { width: (W - 40 - 30) / 4, alignItems: 'center', gap: 6, padding: 10, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.surface, position: 'relative' },
  cardGrad:     { width: 44, height: 44, borderRadius: 22 },
  cardEmoji:    { position: 'absolute', top: 15, fontSize: 18 },
  cardLabel:    { color: Colors.textSubtle, fontSize: 10, fontWeight: '600', textAlign: 'center' },
  checkmark:    { position: 'absolute', top: 6, right: 6 },
  nextBtn:      { borderRadius: Radius.lg, overflow: 'hidden', marginTop: 4 },
  nextBtnInner: { paddingVertical: 16, alignItems: 'center' },
  nextBtnText:  { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
});

const step3 = StyleSheet.create({
  wrap:         { gap: 16, paddingVertical: 8 },
  stylePreview: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.surfaceElevated, borderRadius: Radius.lg, padding: 12, borderWidth: 1, borderColor: Colors.border },
  stylePreviewGrad: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  styleLabel:   { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  title:        { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  sub:          { color: Colors.textSubtle, fontSize: FontSize.sm, lineHeight: 20 },
  toggle:       { borderRadius: Radius.lg, overflow: 'hidden', borderWidth: 1.5, borderColor: Colors.border },
  toggleActive: { borderColor: Colors.primary },
  toggleGrad:   { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, paddingHorizontal: 16 },
  toggleText:   { color: Colors.textSubtle, fontSize: FontSize.sm, fontWeight: FontWeight.medium, flex: 1 },
  fieldLabel:   { color: Colors.textSubtle, fontSize: 10, fontWeight: FontWeight.bold, textTransform: 'uppercase', letterSpacing: 0.8 },
  input:        { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 12, color: Colors.textPrimary, fontSize: FontSize.md, minHeight: 100, textAlignVertical: 'top' },
  quickLabel:   { color: Colors.textSubtle, fontSize: 10, fontWeight: FontWeight.bold, textTransform: 'uppercase', letterSpacing: 0.8 },
  quickItem:    { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: Colors.surface, borderRadius: Radius.md, padding: 12, borderWidth: 1, borderColor: Colors.border },
  quickText:    { flex: 1, color: Colors.textSecondary, fontSize: FontSize.xs, lineHeight: 18 },
  warningBox:   { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: Colors.warningDim, borderRadius: Radius.md, padding: 12, borderWidth: 1, borderColor: Colors.warning + '44' },
  warningText:  { flex: 1, color: Colors.warning, fontSize: FontSize.xs, lineHeight: 18 },
  btnRow:       { flexDirection: 'row', gap: 12 },
  backBtn:      { flex: 1, backgroundColor: Colors.surfaceElevated, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderWidth: 1, borderColor: Colors.border },
  backBtnText:  { color: Colors.textSubtle, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  genBtn:       { flex: 2, borderRadius: Radius.lg, overflow: 'hidden' },
  genBtnInner:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  genBtnText:   { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
});

const gen = StyleSheet.create({
  wrap:          { alignItems: 'center', gap: 20, paddingVertical: 24 },
  orb:           { },
  orbGrad:       { width: 110, height: 110, borderRadius: 55, alignItems: 'center', justifyContent: 'center' },
  title:         { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold, textAlign: 'center' },
  sub:           { color: Colors.textSubtle, fontSize: FontSize.sm, textAlign: 'center' },
  progressWrap:  { width: '100%', gap: 8 },
  progressTrack: { height: 6, backgroundColor: Colors.border, borderRadius: 3, overflow: 'hidden' },
  progressFill:  { height: '100%', borderRadius: 3 },
  progressPct:   { color: Colors.primary, fontSize: FontSize.sm, fontWeight: FontWeight.bold, textAlign: 'center' },
  sourcePreview: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  sourceImg:     { width: 80, height: 80, borderRadius: 40, borderWidth: 2, borderColor: Colors.border },
  resultPlaceholder: { width: 80, height: 80, borderRadius: 40, borderWidth: 2, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  disclaimer:    { color: Colors.textSubtle, fontSize: 11, textAlign: 'center', maxWidth: W - 80, lineHeight: 18 },
});

const res = StyleSheet.create({
  wrap:                { alignItems: 'center', gap: 20, paddingVertical: 8 },
  title:               { color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold, textAlign: 'center' },
  media:               { width: PREVIEW_SIZE, height: PREVIEW_SIZE, borderRadius: Radius.xl, borderWidth: 2, borderColor: Colors.primary },
  comparison:          { flexDirection: 'row', alignItems: 'center', gap: 0, width: '100%' },
  compItem:            { flex: 1, alignItems: 'center', gap: 6 },
  compImg:             { width: 80, height: 80, borderRadius: 40, borderWidth: 2, borderColor: Colors.border },
  compLabel:           { color: Colors.textSubtle, fontSize: 11, fontWeight: '600' },
  compArrow:           { alignItems: 'center' },
  compArrowGrad:       { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  actions:             { gap: 10, width: '100%' },
  actionBtn:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 14, borderRadius: Radius.lg, borderWidth: 1.5 },
  actionBtnText:       { fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  publishBigBtn:       { width: '100%', borderRadius: Radius.lg, overflow: 'hidden' },
  publishBigBtnInner:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16 },
  publishBigBtnText:   { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
  videoStillGenerating:{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.warningDim, borderRadius: Radius.md, padding: 12, borderWidth: 1, borderColor: Colors.warning + '44', width: '100%' },
  videoStillText:      { flex: 1, color: Colors.warning, fontSize: 11, lineHeight: 16 },
  resetBtn:            { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  resetText:           { color: Colors.textSubtle, fontSize: FontSize.sm },
});
