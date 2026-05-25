import React, { useState, useCallback } from 'react';
import {
  View, Text, Pressable, StyleSheet, TextInput,
  ScrollView, KeyboardAvoidingView, Platform,
  ActivityIndicator, Dimensions, Switch,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { useFeed } from '@/hooks/useFeed';
import { LiveCameraPreview } from '@/components/feature/LiveCameraPreview';
import { MusicPicker } from '@/components/feature/MusicPicker';
import { useAlert } from '@/template';
import { getSupabaseClient } from '@/template';
import { CyberButton } from '@/components/ui/CyberButton';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { uploadFileFromUri, detectMimeType } from '@/contexts/FeedContext';
import { getTrackById, type MusicTrack } from '@/services/musicLibrary';
import { createExclusiveContent } from '@/services/economyService';

const HASHTAG_SUGGESTIONS = [
  '#BlockDAG', '#Web3', '#ClipDAG', '#NFT', '#DeFi', '#CryptoCreator',
  '#EarnCrypto', '#DAG', '#BlockchainLife', '#Crypto',
];

const { width: SCREEN_W } = Dimensions.get('window');

type Mode = 'video' | 'photo' | 'carousel' | 'camera' | 'live';

interface SelectedMedia {
  uri: string;
  base64?: string | null;
  type: 'image' | 'video';
  mimeType?: string;
  filterId?: string;
}

// ── Exclusive Content Toggle Card ─────────────────────────────────────────────
function ExclusiveToggle({
  enabled, price, onToggle, onPriceChange,
}: {
  enabled: boolean;
  price: string;
  onToggle: (v: boolean) => void;
  onPriceChange: (v: string) => void;
}) {
  const QUICK_PRICES = ['50', '100', '500', '1000', '2500'];
  return (
    <View style={exc.wrap}>
      <LinearGradient
        colors={enabled ? ['rgba(168,85,247,0.18)', 'rgba(124,92,255,0.10)'] : ['rgba(255,255,255,0.04)', 'rgba(255,255,255,0.02)']}
        style={exc.card}
      >
        {/* Toggle row */}
        <View style={exc.row}>
          <View style={exc.left}>
            <LinearGradient
              colors={enabled ? ['#A855F7', '#7C5CFF'] : ['#2A2A42', '#1C1C32']}
              style={exc.iconBg}
            >
              <MaterialIcons name={enabled ? 'lock' : 'lock-open'} size={18} color={enabled ? '#fff' : Colors.textSubtle} />
            </LinearGradient>
            <View>
              <Text style={[exc.label, enabled && { color: '#A855F7' }]}>Contenido Exclusivo</Text>
              <Text style={exc.sub}>
                {enabled ? 'Solo accesible con pago o suscripción' : 'Toca para bloquear este contenido'}
              </Text>
            </View>
          </View>
          <Switch
            value={enabled}
            onValueChange={onToggle}
            trackColor={{ false: Colors.border, true: '#A855F733' }}
            thumbColor={enabled ? '#A855F7' : Colors.textSubtle}
            ios_backgroundColor={Colors.border}
          />
        </View>

        {/* Price section */}
        {enabled ? (
          <View style={exc.priceSection}>
            <View style={exc.priceDivider} />
            <Text style={exc.priceLabel}>Precio de desbloqueo</Text>

            {/* Quick price chips */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={exc.quickRow}>
              {QUICK_PRICES.map(v => (
                <Pressable
                  key={v}
                  style={[exc.quickChip, price === v && exc.quickChipActive]}
                  onPress={() => onPriceChange(v)}
                >
                  <Text style={[exc.quickChipText, price === v && exc.quickChipTextActive]}>
                    {v} BDAG
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            {/* Custom price input */}
            <View style={exc.priceInputRow}>
              <MaterialCommunityIcons name="hexagon-multiple" size={16} color="#A855F7" />
              <TextInput
                style={exc.priceInput}
                value={price}
                onChangeText={onPriceChange}
                placeholder="Precio personalizado"
                placeholderTextColor={Colors.textSubtle}
                keyboardType="decimal-pad"
              />
              <Text style={exc.bdagUnit}>BDAG</Text>
            </View>

            {parseFloat(price) > 0 ? (
              <View style={exc.feeRow}>
                <MaterialCommunityIcons name="information-outline" size={11} color={Colors.textSubtle} />
                <Text style={exc.feeText}>
                  Tú recibes {(parseFloat(price) * 0.9).toFixed(0)} BDAG · Plataforma {(parseFloat(price) * 0.1).toFixed(0)} BDAG (10%)
                </Text>
              </View>
            ) : null}

            {/* Benefits explainer */}
            <View style={exc.benefitsWrap}>
              {[
                { icon: 'lock', text: 'Preview borroso para no suscriptores' },
                { icon: 'star', text: 'Acceso automático para tus suscriptores' },
                { icon: 'bolt', text: 'Desbloqueo instantáneo con BDAG' },
                { icon: 'library-books', text: 'Biblioteca de contenido comprado' },
              ].map(b => (
                <View key={b.text} style={exc.benefitRow}>
                  <MaterialIcons name={b.icon as any} size={12} color="#A855F7" />
                  <Text style={exc.benefitText}>{b.text}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </LinearGradient>
    </View>
  );
}

const exc = StyleSheet.create({
  wrap:       { borderRadius: Radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  card:       { padding: Spacing.md, gap: Spacing.sm },
  row:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  left:       { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  iconBg:     { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  label:      { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  sub:        { color: Colors.textSubtle, fontSize: FontSize.xs, marginTop: 1 },
  priceSection: { gap: Spacing.sm },
  priceDivider: { height: 1, backgroundColor: 'rgba(168,85,247,0.2)' },
  priceLabel: { color: Colors.textSecondary, fontSize: FontSize.xs, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.5 },
  quickRow:   { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  quickChip:  { paddingHorizontal: 12, paddingVertical: 7, borderRadius: Radius.full, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: Colors.border },
  quickChipActive: { backgroundColor: '#A855F7', borderColor: '#A855F7' },
  quickChipText: { color: Colors.textSubtle, fontSize: 11, fontWeight: FontWeight.semibold },
  quickChipTextActive: { color: '#fff' },
  priceInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(168,85,247,0.1)', borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(168,85,247,0.3)', paddingHorizontal: 12, paddingVertical: 10 },
  priceInput: { flex: 1, color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  bdagUnit:   { color: '#A855F7', fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  feeRow:     { flexDirection: 'row', alignItems: 'center', gap: 5 },
  feeText:    { color: Colors.textSubtle, fontSize: 10 },
  benefitsWrap: { backgroundColor: 'rgba(168,85,247,0.08)', borderRadius: Radius.md, padding: 10, gap: 6 },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  benefitText:{ color: Colors.textSecondary, fontSize: 11 },
});

export default function UploadScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { addVideo } = useFeed();
  const { showAlert } = useAlert();
  const router = useRouter();
  const supabase = getSupabaseClient();

  const [mode, setMode] = useState<Mode>('video');
  const [caption, setCaption] = useState('');
  const [selectedMusic, setSelectedMusic] = useState<MusicTrack | null>(null);
  const [musicPickerVisible, setMusicPickerVisible] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');

  // Single media (video / photo)
  const [selectedMedia, setSelectedMedia] = useState<SelectedMedia | null>(null);
  // Carousel: multiple photos
  const [carouselMedias, setCarouselMedias] = useState<SelectedMedia[]>([]);

  // ── Exclusive content state ───────────────────────────────────────────────
  const [isExclusive, setIsExclusive] = useState(false);
  const [exclusivePrice, setExclusivePrice] = useState('100');

  const [liveTitle, setLiveTitle] = useState('');
  const [liveCameraVisible, setLiveCameraVisible] = useState(false);
  const hostUser = user ? { id: user.id, username: user.username || user.email?.split('@')[0] || 'user', avatar: user.avatar } : null;

  // ── Handle camera capture ─────────────────────────────────────────────────
  const handleCameraCapture = useCallback((uri: string, type: 'photo' | 'video', filterId: string) => {
    setCameraVisible(false);
    const mimeType = type === 'video' ? 'video/mp4' : 'image/jpeg';
    if (mode === 'carousel' && type === 'image') {
      setCarouselMedias(prev => [...prev, { uri, type: 'image', mimeType, filterId }]);
    } else {
      setSelectedMedia({ uri, type, mimeType, filterId });
      if (type === 'video') setMode('video');
      else setMode('photo');
    }
  }, [mode]);

  const openCamera = useCallback(async (captureMode: 'photo' | 'video') => {
    setCameraMode(captureMode);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      showAlert('Permiso requerido', 'Habilita la cámara en los ajustes del dispositivo');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: captureMode === 'photo'
        ? ImagePicker.MediaTypeOptions.Images
        : ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: captureMode === 'photo',
      quality: 0.85,
      videoMaxDuration: 60,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const mimeType = asset.mimeType || detectMimeType(asset.uri, captureMode === 'photo' ? 'image/jpeg' : 'video/mp4');
      handleCameraCapture(asset.uri, captureMode === 'video' ? 'video' : 'image', 'normal');
    }
  }, [showAlert, handleCameraCapture]);

  // ── Pick single media ─────────────────────────────────────────────────────
  const pickSingleMedia = useCallback(async (fromCamera: boolean) => {
    const isPhoto = mode === 'photo';
    const permFn = fromCamera
      ? ImagePicker.requestCameraPermissionsAsync
      : ImagePicker.requestMediaLibraryPermissionsAsync;
    const { status } = await permFn();
    if (status !== 'granted') {
      showAlert('Permiso requerido', 'Habilita el acceso en los ajustes del dispositivo');
      return;
    }
    const launchFn = fromCamera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
    const result = await launchFn({
      mediaTypes: isPhoto ? ImagePicker.MediaTypeOptions.Images : ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: isPhoto,
      quality: 0.85,
      videoMaxDuration: 60,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const mimeType = asset.mimeType || detectMimeType(asset.uri, asset.type === 'video' ? 'video/mp4' : 'image/jpeg');
      setSelectedMedia({ uri: asset.uri, base64: asset.base64, type: asset.type === 'video' ? 'video' : 'image', mimeType });
    }
  }, [mode, showAlert]);

  // ── Pick carousel (multiple images) ──────────────────────────────────────
  const pickCarouselImages = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      showAlert('Permiso requerido', 'Habilita el acceso a la galería en ajustes');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: 10,
      quality: 0.85,
      base64: true,
    });
    if (!result.canceled && result.assets.length > 0) {
      const items: SelectedMedia[] = result.assets.map(a => ({
        uri: a.uri,
        base64: a.base64,
        type: 'image',
        mimeType: a.mimeType || detectMimeType(a.uri, 'image/jpeg'),
      }));
      setCarouselMedias(items);
    }
  }, [showAlert]);

  const removeCarouselItem = useCallback((idx: number) => {
    setCarouselMedias(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const handleAddHashtag = useCallback((tag: string) => {
    setCaption(prev => (prev.includes(tag) ? prev : prev ? `${prev} ${tag}` : tag));
  }, []);

  // ── Music selection ───────────────────────────────────────────────────────
  const handleMusicSelect = useCallback((track: MusicTrack) => {
    setSelectedMusic(track.isOriginalSound ? null : track);
  }, []);

  // ── Upload single media ───────────────────────────────────────────────────
  const uploadMediaToStorage = useCallback(async (media: SelectedMedia, index?: number): Promise<string | null> => {
    if (!user) return null;
    const isVideo = media.type === 'video';
    const bucket = isVideo ? 'videos' : 'images';
    const ext = isVideo ? 'mp4' : 'jpg';
    const suffix = index !== undefined ? `_${index}` : '';
    const fileName = `${user.id}/${Date.now()}${suffix}.${ext}`;
    const mimeType = media.mimeType || (isVideo ? 'video/mp4' : 'image/jpeg');
    return await uploadFileFromUri(supabase, media.uri, bucket, fileName, mimeType, media.base64);
  }, [user, supabase]);

  // ── Register exclusive content in DB ──────────────────────────────────────
  const registerExclusiveContent = useCallback(async (opts: {
    title: string; contentType: string;
    previewUrl: string; contentUrl: string;
    priceBdag: number; videoId?: string;
  }): Promise<string | undefined> => {
    const result = await createExclusiveContent({
      title: opts.title,
      description: opts.title,
      contentType: opts.contentType,
      previewText: opts.title.slice(0, 80),
      previewUrl: opts.previewUrl,
      contentUrl: opts.contentUrl,
      priceBdag: opts.priceBdag,
    });
    return result.content_id;
  }, []);

  // ── Start Live ────────────────────────────────────────────────────────────
  const handleStartLive = useCallback(() => {
    if (!liveTitle.trim()) { showAlert('Sin título', 'Escribe el título de tu live'); return; }
    setLiveCameraVisible(true);
  }, [liveTitle, showAlert]);

  // ── Publish single video/photo ────────────────────────────────────────────
  const handleUploadSingle = useCallback(async () => {
    if (!selectedMedia) { showAlert('Sin contenido', `Selecciona ${mode === 'photo' ? 'una foto' : 'un video'}`); return; }
    if (!caption.trim()) { showAlert('Sin descripción', 'Agrega una descripción'); return; }
    if (isExclusive) {
      const price = parseFloat(exclusivePrice);
      if (isNaN(price) || price < 10) { showAlert('Precio inválido', 'El precio mínimo es 10 BDAG'); return; }
    }
    if (!user) return;

    setIsUploading(true);
    setUploadProgress('Subiendo media...');
    try {
      const url = await uploadMediaToStorage(selectedMedia);
      const finalUrl = url || selectedMedia.uri;
      setUploadProgress('Guardando en el feed...');
      const musicName = selectedMusic ? `${selectedMusic.title} - ${selectedMusic.artist}` : 'Sin musica';

      let exclusiveContentId: string | undefined;
      if (isExclusive) {
        setUploadProgress('Registrando contenido exclusivo...');
        exclusiveContentId = await registerExclusiveContent({
          title: caption.trim().slice(0, 80),
          contentType: selectedMedia.type === 'video' ? 'video' : 'image',
          previewUrl: finalUrl,
          contentUrl: finalUrl,
          priceBdag: parseFloat(exclusivePrice),
        });
      }

      await addVideo({
        userId: user.id,
        username: user.username || user.email?.split('@')[0] || 'user',
        userAvatar: user.avatar || '',
        videoUrl: finalUrl,
        thumbnailUrl: selectedMedia.type === 'image' ? finalUrl : '',
        caption: caption.trim(),
        music: musicName,
        ...(isExclusive ? { isExclusive: true, exclusivePrice: parseFloat(exclusivePrice), exclusiveContentId } : {}),
      } as any);

      setCaption('');
      setSelectedMedia(null);
      setSelectedMusic(null);
      setIsExclusive(false);
      setExclusivePrice('100');
      setUploadProgress('');
      showAlert(
        isExclusive ? '¡Contenido exclusivo publicado!' : (mode === 'photo' ? 'Foto publicada!' : 'Video publicado!'),
        isExclusive ? `Precio: ${exclusivePrice} BDAG · Tus suscriptores acceden gratis` : 'Tu contenido ya está en el feed',
        [{ text: 'Ver Feed', onPress: () => router.push('/(tabs)') }, { text: 'Crear otro' }]
      );
    } catch (_) {
      showAlert('Error', 'No se pudo publicar. Intenta de nuevo.');
    }
    setIsUploading(false);
    setUploadProgress('');
  }, [selectedMedia, caption, mode, selectedMusic, isExclusive, exclusivePrice, user, uploadMediaToStorage, addVideo, registerExclusiveContent, router, showAlert]);

  // ── Publish carousel ──────────────────────────────────────────────────────
  const handleUploadCarousel = useCallback(async () => {
    if (carouselMedias.length < 2) { showAlert('Carrusel requerido', 'Selecciona al menos 2 fotos'); return; }
    if (!caption.trim()) { showAlert('Sin descripción', 'Agrega una descripción'); return; }
    if (isExclusive) {
      const price = parseFloat(exclusivePrice);
      if (isNaN(price) || price < 10) { showAlert('Precio inválido', 'El precio mínimo es 10 BDAG'); return; }
    }
    if (!user) return;

    setIsUploading(true);
    setUploadProgress(`Subiendo ${carouselMedias.length} fotos...`);

    try {
      const urls = await Promise.all(carouselMedias.map((m, i) => uploadMediaToStorage(m, i)));
      const validUrls = urls.filter(Boolean) as string[];
      if (validUrls.length === 0) throw new Error('No se pudieron subir las imágenes');

      setUploadProgress('Guardando carrusel...');

      let exclusiveContentId: string | undefined;
      if (isExclusive) {
        setUploadProgress('Registrando contenido exclusivo...');
        exclusiveContentId = await registerExclusiveContent({
          title: caption.trim().slice(0, 80),
          contentType: 'image',
          previewUrl: validUrls[0],
          contentUrl: validUrls[0],
          priceBdag: parseFloat(exclusivePrice),
        });
      }

      await (addVideo as any)({
        userId: user.id,
        username: user.username || user.email?.split('@')[0] || 'user',
        userAvatar: user.avatar || '',
        videoUrl: validUrls[0],
        thumbnailUrl: validUrls[0],
        caption: caption.trim(),
        music: 'Sin musica',
        mediaUrls: validUrls,
        ...(isExclusive ? { isExclusive: true, exclusivePrice: parseFloat(exclusivePrice), exclusiveContentId } : {}),
      });

      setCaption('');
      setCarouselMedias([]);
      setSelectedMusic(null);
      setIsExclusive(false);
      setExclusivePrice('100');
      showAlert(
        isExclusive ? '¡Carrusel exclusivo publicado!' : 'Carrusel publicado!',
        isExclusive ? `${validUrls.length} fotos · Precio: ${exclusivePrice} BDAG` : `${validUrls.length} fotos publicadas`,
        [{ text: 'Ver Feed', onPress: () => router.push('/(tabs)') }, { text: 'Crear otro' }]
      );
    } catch (_) {
      showAlert('Error', 'No se pudo publicar el carrusel.');
    }
    setIsUploading(false);
    setUploadProgress('');
  }, [carouselMedias, caption, isExclusive, exclusivePrice, user, uploadMediaToStorage, addVideo, registerExclusiveContent, router, showAlert]);

  const MODES: { key: Mode; icon: string; label: string; color?: string }[] = [
    { key: 'video',    icon: 'videocam',      label: 'Video' },
    { key: 'photo',    icon: 'photo-camera',  label: 'Foto' },
    { key: 'carousel', icon: 'view-carousel', label: 'Carrusel' },
    { key: 'camera',   icon: 'auto-awesome',  label: 'Cámara',  color: '#B44FFF' },
    { key: 'live',     icon: 'live-tv',       label: 'En Vivo' },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <LiveCameraPreview visible={liveCameraVisible} title={liveTitle} hostUser={hostUser} onClose={() => setLiveCameraVisible(false)} onStreamStarted={() => {}} />

      <MusicPicker
        visible={musicPickerVisible}
        selectedTrackId={selectedMusic?.id}
        onClose={() => setMusicPickerVisible(false)}
        onSelect={handleMusicSelect}
      />

      <StatusBar style="light" />

      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Crear Contenido</Text>
          <Text style={styles.headerSub}>◈ Gana $DAG con cada like</Text>
        </View>
      </View>

      {/* Mode selector */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modeSelectorContent} style={styles.modeSelector}>
        {MODES.map(m => {
          const isActive = mode === m.key;
          const bgColor = m.key === 'live' ? Colors.secondary
            : m.key === 'carousel' ? Colors.blue
            : m.key === 'camera' ? '#B44FFF'
            : Colors.primary;
          return (
            <Pressable
              key={m.key}
              style={[styles.modeBtn, isActive && { backgroundColor: bgColor, borderColor: bgColor }]}
              onPress={() => {
                if (m.key === 'camera') {
                  showAlert('Cámara con Filtros AR', '¿Qué quieres capturar?', [
                    { text: 'Abrir Creator Studio', onPress: () => router.push('/creator-studio') },
                    { text: 'Foto estándar', onPress: () => openCamera('photo') },
                    { text: 'Video estándar', onPress: () => openCamera('video') },
                    { text: 'Cancelar', style: 'cancel' },
                  ]);
                } else {
                  setMode(m.key);
                  setSelectedMedia(null);
                  setCarouselMedias([]);
                  setUploadProgress('');
                  setIsExclusive(false);
                }
              }}
            >
              {m.key === 'live' && isActive ? <View style={styles.livePulse} /> : null}
              <MaterialIcons name={m.icon as any} size={16} color={isActive ? '#fff' : Colors.textSubtle} />
              <Text style={[styles.modeBtnText, isActive && styles.modeBtnTextActive]}>{m.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: 100 + insets.bottom }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* ── LIVE MODE ─────────────────────────────────────────────────── */}
          {mode === 'live' ? (
            <>
              <LinearGradient colors={['rgba(255,45,85,0.14)', 'rgba(255,45,85,0.05)']} style={styles.livePreview}>
                <View style={styles.liveIconWrap}><View style={styles.liveRedDot} /><MaterialIcons name="live-tv" size={46} color={Colors.secondary} /></View>
                <Text style={styles.livePreviewTitle}>Transmisión en Vivo</Text>
                <Text style={styles.livePreviewSub}>Gana $DAG por tips de tus fans en tiempo real</Text>
              </LinearGradient>
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Título del Live *</Text>
                <TextInput style={styles.captionInput} value={liveTitle} onChangeText={setLiveTitle} placeholder="ej: Tutorial BlockDAG en vivo" placeholderTextColor={Colors.textSubtle} maxLength={100} />
              </View>
              <CyberButton label="Abrir Cámara y Transmitir" onPress={handleStartLive} variant="secondary" size="lg" fullWidth />
            </>

          /* ── CAROUSEL MODE ──────────────────────────────────────────── */
          ) : mode === 'carousel' ? (
            <>
              <View style={styles.carouselHeader}>
                <LinearGradient colors={['rgba(45,158,255,0.15)', 'rgba(45,158,255,0.05)']} style={styles.carouselInfo}>
                  <MaterialCommunityIcons name="image-multiple-outline" size={28} color={Colors.blue} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.infoCardTitle, { color: Colors.blue }]}>Carrusel Instagram</Text>
                    <Text style={styles.infoCardText}>Sube 2–10 fotos. Deslizables horizontalmente.</Text>
                  </View>
                </LinearGradient>
              </View>

              {carouselMedias.length === 0 ? (
                <View style={styles.pickerBtnsRow}>
                  <Pressable onPress={pickCarouselImages} style={[styles.pickerHalf, { flex: 1 }]}>
                    <LinearGradient colors={['rgba(45,158,255,0.12)', 'rgba(45,158,255,0.05)']} style={styles.pickerHalfInner}>
                      <MaterialCommunityIcons name="image-multiple-outline" size={36} color={Colors.blue} />
                      <Text style={[styles.pickerHalfTitle, { color: Colors.blue }]}>Galería</Text>
                      <Text style={styles.pickerHalfSub}>Selecciona 2–10 fotos</Text>
                    </LinearGradient>
                  </Pressable>
                  <Pressable onPress={() => openCamera('photo')} style={[styles.pickerHalf, { flex: 1 }]}>
                    <LinearGradient colors={['rgba(180,79,255,0.12)', 'rgba(180,79,255,0.05)']} style={styles.pickerHalfInner}>
                      <MaterialCommunityIcons name="camera-plus-outline" size={36} color="#B44FFF" />
                      <Text style={[styles.pickerHalfTitle, { color: '#B44FFF' }]}>Con Filtro</Text>
                      <Text style={styles.pickerHalfSub}>Foto con efectos</Text>
                    </LinearGradient>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.carouselGrid}>
                  {carouselMedias.map((m, i) => (
                    <View key={i} style={styles.carouselThumbWrap}>
                      <Image source={{ uri: m.uri }} style={styles.carouselThumb} contentFit="cover" transition={150} />
                      {m.filterId && m.filterId !== 'normal' ? (
                        <View style={styles.filterIndicator}>
                          <MaterialCommunityIcons name="auto-awesome" size={10} color="#fff" />
                        </View>
                      ) : null}
                      <Pressable onPress={() => removeCarouselItem(i)} style={styles.carouselRemoveBtn} hitSlop={4}>
                        <MaterialIcons name="close" size={14} color="#fff" />
                      </Pressable>
                      <View style={styles.carouselIndexBadge}>
                        <Text style={styles.carouselIndexText}>{i + 1}</Text>
                      </View>
                    </View>
                  ))}
                  {carouselMedias.length < 10 ? (
                    <Pressable onPress={pickCarouselImages} style={[styles.carouselThumbWrap, styles.carouselAddMoreBtn]}>
                      <MaterialCommunityIcons name="plus" size={28} color={Colors.blue} />
                      <Text style={styles.carouselAddMoreText}>Agregar</Text>
                    </Pressable>
                  ) : null}
                </View>
              )}

              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Descripción *</Text>
                <TextInput style={styles.captionInput} value={caption} onChangeText={setCaption} placeholder="Describe tu carrusel..." placeholderTextColor={Colors.textSubtle} multiline maxLength={300} />
                <Text style={styles.charCount}>{caption.length}/300</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hashtagRow}>
                  {HASHTAG_SUGGESTIONS.map(tag => (
                    <Pressable key={tag} style={styles.hashtagChip} onPress={() => handleAddHashtag(tag)}>
                      <Text style={styles.hashtagText}>{tag}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>

              {/* Exclusive toggle */}
              <ExclusiveToggle
                enabled={isExclusive}
                price={exclusivePrice}
                onToggle={setIsExclusive}
                onPriceChange={setExclusivePrice}
              />

              {isUploading && uploadProgress ? (
                <View style={styles.progressRow}>
                  <ActivityIndicator color={Colors.blue} size="small" />
                  <Text style={[styles.progressText, { color: Colors.blue }]}>{uploadProgress}</Text>
                </View>
              ) : null}

              <CyberButton
                label={isUploading ? (uploadProgress || 'Publicando...') : `Publicar Carrusel (${carouselMedias.length} fotos)`}
                onPress={handleUploadCarousel}
                loading={isUploading}
                size="lg"
                fullWidth
              />
            </>

          /* ── VIDEO / PHOTO MODE ──────────────────────────────────────── */
          ) : (
            <>
              {selectedMedia === null ? (
                <View style={styles.pickerArea}>
                  <View style={styles.pickerBtnsRow}>
                    <Pressable onPress={() => pickSingleMedia(false)} style={({ pressed }) => [styles.pickerHalf, pressed && { opacity: 0.8 }]}>
                      <LinearGradient colors={['rgba(0,212,255,0.12)', 'rgba(0,102,255,0.07)']} style={styles.pickerHalfInner}>
                        <MaterialIcons name={mode === 'photo' ? 'photo-library' : 'video-library'} size={36} color={Colors.primary} />
                        <Text style={styles.pickerHalfTitle}>Galería</Text>
                        <Text style={styles.pickerHalfSub}>{mode === 'photo' ? 'Fotos del dispositivo' : 'Videos del dispositivo'}</Text>
                      </LinearGradient>
                    </Pressable>
                    <Pressable onPress={() => openCamera(mode === 'photo' ? 'photo' : 'video')} style={({ pressed }) => [styles.pickerHalf, pressed && { opacity: 0.8 }]}>
                      <LinearGradient colors={['rgba(180,79,255,0.12)', 'rgba(180,79,255,0.06)']} style={styles.pickerHalfInner}>
                        <MaterialCommunityIcons name="auto-awesome" size={36} color="#B44FFF" />
                        <Text style={[styles.pickerHalfTitle, { color: '#B44FFF' }]}>Con Filtros</Text>
                        <Text style={styles.pickerHalfSub}>Cámara con efectos AR</Text>
                      </LinearGradient>
                    </Pressable>
                  </View>
                  <Pressable onPress={() => pickSingleMedia(true)} style={styles.standardCameraBtn}>
                    <MaterialIcons name={mode === 'photo' ? 'photo-camera' : 'videocam'} size={18} color={Colors.textSecondary} />
                    <Text style={styles.standardCameraBtnText}>Cámara estándar</Text>
                  </Pressable>
                  <Text style={styles.pickerHint}>{mode === 'photo' ? 'JPG, PNG, WEBP · Max 10MB' : 'MP4, MOV · Max 60 seg'}</Text>
                </View>
              ) : (
                <View style={styles.selectedCard}>
                  <Image source={{ uri: selectedMedia.uri }} style={styles.selectedThumbImg} contentFit="cover" transition={200} />
                  <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.75)']} style={styles.selectedOverlay}>
                    <View style={styles.selectedRow}>
                      <MaterialIcons name="check-circle" size={22} color={Colors.accent} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.selectedTitle}>{selectedMedia.type === 'image' ? 'Foto lista' : 'Video listo'}</Text>
                        {selectedMedia.filterId && selectedMedia.filterId !== 'normal' ? (
                          <Text style={styles.selectedFilter}>✨ Filtro: {selectedMedia.filterId}</Text>
                        ) : null}
                      </View>
                      <Pressable onPress={() => setSelectedMedia(null)} hitSlop={8} style={styles.removeBtn}>
                        <MaterialIcons name="close" size={18} color="#fff" />
                      </Pressable>
                    </View>
                  </LinearGradient>
                </View>
              )}

              {/* Caption */}
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Descripción *</Text>
                <TextInput style={styles.captionInput} value={caption} onChangeText={setCaption} placeholder="De qué trata tu contenido..." placeholderTextColor={Colors.textSubtle} multiline maxLength={300} />
                <Text style={styles.charCount}>{caption.length}/300</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hashtagRow}>
                  {HASHTAG_SUGGESTIONS.map(tag => (
                    <Pressable key={tag} style={styles.hashtagChip} onPress={() => handleAddHashtag(tag)}>
                      <Text style={styles.hashtagText}>{tag}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>

              {/* Music picker */}
              <Pressable style={styles.musicPickerBtn} onPress={() => setMusicPickerVisible(true)}>
                <LinearGradient
                  colors={selectedMusic ? ['rgba(124,92,255,0.15)', 'rgba(255,45,120,0.1)'] : ['rgba(255,255,255,0.04)', 'rgba(255,255,255,0.02)']}
                  style={styles.musicPickerInner}
                >
                  <LinearGradient colors={selectedMusic ? ['#7C5CFF', '#FF2D78'] : [Colors.surfaceHighlight, Colors.surfaceHighlight]} style={styles.musicPickerIconWrap}>
                    <MaterialCommunityIcons name="music-note" size={18} color={selectedMusic ? '#fff' : Colors.textSubtle} />
                  </LinearGradient>
                  <View style={styles.musicPickerMeta}>
                    <Text style={[styles.musicPickerLabel, selectedMusic && { color: Colors.primary }]}>
                      {selectedMusic ? selectedMusic.title : 'Agregar Música'}
                    </Text>
                    <Text style={styles.musicPickerArtist}>
                      {selectedMusic ? selectedMusic.artist : 'Toca para explorar la biblioteca'}
                    </Text>
                  </View>
                  <MaterialCommunityIcons
                    name={selectedMusic ? 'close-circle' : 'chevron-right'}
                    size={20}
                    color={Colors.textSubtle}
                    onPress={selectedMusic ? (e) => { e.stopPropagation?.(); setSelectedMusic(null); } : undefined}
                  />
                </LinearGradient>
              </Pressable>

              {/* ── EXCLUSIVE CONTENT TOGGLE ── */}
              <ExclusiveToggle
                enabled={isExclusive}
                price={exclusivePrice}
                onToggle={setIsExclusive}
                onPriceChange={setExclusivePrice}
              />

              {isUploading && uploadProgress ? (
                <View style={styles.progressRow}>
                  <ActivityIndicator color={Colors.primary} size="small" />
                  <Text style={styles.progressText}>{uploadProgress}</Text>
                </View>
              ) : null}

              {!isExclusive ? (
                <LinearGradient colors={['rgba(0,212,255,0.08)', 'rgba(0,102,255,0.04)']} style={styles.infoCard}>
                  <Text style={styles.dagInfoIcon}>◈</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.infoCardTitle}>Gana $DAG con este contenido</Text>
                    <Text style={styles.infoCardText}>Cada like genera 0.01 $DAG automáticamente.</Text>
                  </View>
                </LinearGradient>
              ) : null}

              <CyberButton
                label={isUploading
                  ? (uploadProgress || 'Publicando...')
                  : isExclusive
                    ? `Publicar exclusivo · ${exclusivePrice} BDAG`
                    : mode === 'photo' ? 'Publicar Foto' : 'Publicar Video'}
                onPress={handleUploadSingle}
                loading={isUploading}
                size="lg"
                fullWidth
              />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const THUMB_SIZE = (SCREEN_W - Spacing.md * 2 - Spacing.sm * 2) / 3;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: { paddingHorizontal: Spacing.md, paddingBottom: Spacing.xs },
  headerTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  headerSub: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: FontWeight.medium, marginTop: 1 },

  modeSelector: { marginHorizontal: Spacing.md, marginBottom: Spacing.md, maxHeight: 48 },
  modeSelectorContent: { flexDirection: 'row', gap: Spacing.sm, paddingVertical: 2 },
  modeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md,
    borderRadius: Radius.full, backgroundColor: Colors.surfaceElevated,
    borderWidth: 1, borderColor: Colors.border,
  },
  modeBtnText: { color: Colors.textSubtle, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  modeBtnTextActive: { color: '#fff' },
  livePulse: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#fff' },

  scrollContent: { padding: Spacing.md, gap: Spacing.lg },
  section: { gap: Spacing.sm },
  sectionLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.textSecondary },

  pickerArea: { gap: Spacing.md },
  pickerBtnsRow: { flexDirection: 'row', gap: Spacing.md },
  pickerHalf: { flex: 1, borderRadius: Radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  pickerHalfInner: { alignItems: 'center', paddingVertical: Spacing.xl, gap: Spacing.sm },
  pickerHalfTitle: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  pickerHalfSub: { color: Colors.textSubtle, fontSize: 11, textAlign: 'center' },
  standardCameraBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md, paddingVertical: 10,
    borderWidth: 1, borderColor: Colors.border,
  },
  standardCameraBtnText: { color: Colors.textSecondary, fontSize: FontSize.sm },
  pickerHint: { color: Colors.textSubtle, fontSize: FontSize.xs, textAlign: 'center' },

  selectedCard: { height: 220, borderRadius: Radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: Colors.accentDim },
  selectedThumbImg: { width: '100%', height: '100%' },
  selectedOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', padding: Spacing.md },
  selectedRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  selectedTitle: { color: Colors.accent, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  selectedFilter: { color: '#B44FFF', fontSize: FontSize.xs },
  removeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },

  carouselHeader: { gap: Spacing.sm },
  carouselInfo: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(45,158,255,0.25)' },
  carouselGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  carouselThumbWrap: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: Radius.md, overflow: 'hidden', backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border, position: 'relative' },
  carouselThumb: { width: '100%', height: '100%' },
  filterIndicator: { position: 'absolute', top: 4, left: 4, width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(124,92,255,0.85)', alignItems: 'center', justifyContent: 'center' },
  carouselRemoveBtn: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  carouselIndexBadge: { position: 'absolute', bottom: 4, left: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  carouselIndexText: { color: '#fff', fontSize: 11, fontWeight: FontWeight.bold },
  carouselAddMoreBtn: { alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed', borderColor: Colors.blue + '88', backgroundColor: Colors.blueDim },
  carouselAddMoreText: { color: Colors.blue, fontSize: 10, fontWeight: FontWeight.semibold, marginTop: 2 },

  captionInput: { backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, color: Colors.textPrimary, fontSize: FontSize.md, minHeight: 100, textAlignVertical: 'top' },
  charCount: { color: Colors.textSubtle, fontSize: FontSize.xs, textAlign: 'right' },
  hashtagRow: { flexDirection: 'row', gap: Spacing.sm, paddingVertical: 2 },
  hashtagChip: { backgroundColor: Colors.primaryDim, borderWidth: 1, borderColor: 'rgba(0,212,255,0.3)', borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 5 },
  hashtagText: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: FontWeight.medium },

  musicPickerBtn: { borderRadius: Radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  musicPickerInner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  musicPickerIconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  musicPickerMeta: { flex: 1 },
  musicPickerLabel: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  musicPickerArtist: { color: Colors.textSubtle, fontSize: FontSize.xs, marginTop: 2 },

  progressRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.primaryDim },
  progressText: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },

  infoCard: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(0,212,255,0.2)' },
  dagInfoIcon: { fontSize: 22, color: Colors.primary },
  infoCardTitle: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, marginBottom: 3 },
  infoCardText: { color: Colors.textSecondary, fontSize: FontSize.xs, lineHeight: 16 },

  livePreview: { alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.xxl, borderRadius: Radius.lg, borderWidth: 1, borderColor: 'rgba(255,45,85,0.3)' },
  liveIconWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  liveRedDot: { position: 'absolute', top: 0, right: 0, width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.secondary },
  livePreviewTitle: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  livePreviewSub: { color: Colors.textSecondary, fontSize: FontSize.sm, textAlign: 'center', paddingHorizontal: Spacing.lg },
});
