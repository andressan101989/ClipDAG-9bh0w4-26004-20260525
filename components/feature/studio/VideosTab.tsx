/**
 * components/feature/studio/VideosTab.tsx
 * Creator Studio — Tab 2: Video Editor
 *
 * Isolation contract:
 *  - No imports from other studio tabs
 *  - expo-video lazy-loaded (crashes on web/preview without native build)
 *  - expo-av used as fallback
 *  - Skia overlay safe here (no DeepAR surface in video editor)
 */
import React, {
  useState, useCallback, useRef, useEffect,
} from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView, FlatList,
  TextInput, ActivityIndicator, Dimensions, Modal,
} from 'react-native';
import { Image } from 'expo-image';
import { Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAlert } from '@/template';
import { useFeed } from '@/hooks/useFeed';
import { useRouter } from 'expo-router';
import { isFFmpegAvailable, exportFinal } from '@/services/ffmpegService';
import SkiaEffectsLayer, { type SkiaEffectId } from '@/components/feature/SkiaEffectsLayer';
import { Colors, FontSize, FontWeight, Radius } from '@/constants/theme';

// ── expo-video — lazy-loaded ───────────────────────────────────────────────
let VideoView: any = null;
let useVideoPlayer: any = (_src: any, _setup?: any): any => null;
try {
  const ev = require('expo-video');
  VideoView      = ev.VideoView      ?? null;
  useVideoPlayer = ev.useVideoPlayer ?? ((_src: any, _setup?: any) => null);
} catch { /* web / preview */ }

let AVVideo: any    = null;
let AVResizeMode: any = null;
try {
  const avMod  = require('expo-av');
  AVVideo      = avMod.Video      ?? null;
  AVResizeMode = avMod.ResizeMode ?? null;
} catch { /* not compiled */ }

const { width: W } = Dimensions.get('window');

// ── Types ──────────────────────────────────────────────────────────────────
interface Clip { id: string; uri: string; durationMs: number }
interface DeezerArtist { name: string }
interface DeezerAlbum  { cover_medium: string; title: string }
interface DeezerTrack  { id: number; title: string; preview: string; duration: number; artist: DeezerArtist; album: DeezerAlbum }

type ColorFilterName = 'vintage' | 'cine' | 'frio' | 'calido' | 'bn' | 'neon' | 'none';

// ── Constants ──────────────────────────────────────────────────────────────
const SPEED_PRESETS = [
  { label: '0.5×', value: 0.5 }, { label: '1×', value: 1.0 },
  { label: '2×',  value: 2.0 },  { label: '4×', value: 4.0 },
];

const VIDEO_COLOR_FILTERS: { id: ColorFilterName; name: string; emoji: string; gradient: [string, string] }[] = [
  { id: 'none',    name: 'Original', emoji: '🎬', gradient: ['#333', '#222'] },
  { id: 'vintage', name: 'Vintage',  emoji: '📷', gradient: ['#8B5E3C', '#C27540'] },
  { id: 'cine',    name: 'Cine',     emoji: '🎞️', gradient: ['#1A1A2E', '#333355'] },
  { id: 'frio',    name: 'Frío',     emoji: '🧊', gradient: ['#2D9EFF', '#7CC4FF'] },
  { id: 'calido',  name: 'Cálido',   emoji: '🌅', gradient: ['#FF9D00', '#FF5A00'] },
  { id: 'bn',      name: 'B&N',      emoji: '⬛', gradient: ['#555', '#999'] },
  { id: 'neon',    name: 'Neón',     emoji: '🌈', gradient: ['#FF2D78', '#7C5CFF'] },
];

const DEEZER_CATS = [
  { id: 'pop',        q: 'top pop 2025',        label: 'Pop',         emoji: '🎤' },
  { id: 'reggaeton',  q: 'reggaeton hits',       label: 'Reggaetón',   emoji: '🔥' },
  { id: 'hiphop',     q: 'hip hop rap',          label: 'Hip Hop',     emoji: '🎧' },
  { id: 'electronic', q: 'electronic edm',       label: 'Electrónica', emoji: '⚡' },
  { id: 'lofi',       q: 'lofi chill beats',     label: 'Lo-Fi',       emoji: '☕' },
  { id: 'latin',      q: 'latin hits',           label: 'Latino',      emoji: '🌶️' },
  { id: 'viral',      q: 'trending viral 2025',  label: 'Viral',       emoji: '📈' },
];

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtMs(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}

function PulsingDot({ color }: { color: string }) {
  const [scale, setScale] = React.useState(1);
  useEffect(() => {
    let up = true;
    const iv = setInterval(() => {
      setScale(s => { up = s >= 1.5 ? false : s <= 1 ? true : up; return up ? s + 0.05 : s - 0.05; });
    }, 30);
    return () => clearInterval(iv);
  }, []);
  return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, transform: [{ scale }] }} />;
}

// ── ClipVideoPlayer ────────────────────────────────────────────────────────
function ClipVideoPlayer({ uri, volume, rate, onDuration, onPosition, onPlayingChange, playerRef }: {
  uri: string; volume: number; rate: number;
  onDuration: (ms: number) => void;
  onPosition: (ms: number) => void;
  onPlayingChange: (p: boolean) => void;
  playerRef: React.MutableRefObject<any>;
}) {
  const avRef = React.useRef<any>(null);
  const player = useVideoPlayer(uri, (p: any) => {
    if (!p) return;
    try { p.volume = volume; p.playbackRate = rate; p.loop = false; } catch (_) {}
  });

  React.useEffect(() => { if (player) playerRef.current = player; }, [player]);
  React.useEffect(() => { try { if (player) player.volume = volume; } catch (_) {} }, [volume, player]);
  React.useEffect(() => { try { if (player) player.playbackRate = rate; } catch (_) {} }, [rate, player]);

  React.useEffect(() => {
    if (!player) return;
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

  if (VideoView && player) {
    return <VideoView player={player} style={v.player} contentFit="cover" nativeControls={false} />;
  }

  if (AVVideo) {
    return (
      <AVVideo ref={avRef} source={{ uri }} style={v.player}
        resizeMode={AVResizeMode?.COVER ?? 'cover'}
        shouldPlay={false} isLooping={false} volume={volume} rate={rate}
        progressUpdateIntervalMillis={250}
        onLoad={(status: any) => {
          if (status?.durationMillis) onDuration(status.durationMillis);
          playerRef.current = {
            play:  () => avRef.current?.playAsync?.(),
            pause: () => avRef.current?.pauseAsync?.(),
            get currentTime() { return 0; },
            set volume(val: number) { avRef.current?.setVolumeAsync?.(val); },
            set playbackRate(r: number) { avRef.current?.setRateAsync?.(r, true); },
          };
        }}
        onPlaybackStatusUpdate={(status: any) => {
          if (!status?.isLoaded) return;
          onPosition(status.positionMillis ?? 0);
          if (status.durationMillis) onDuration(status.durationMillis);
          onPlayingChange(status.isPlaying ?? false);
        }}
      />
    );
  }

  return (
    <View style={[v.player, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#0A0A14' }]}>
      <MaterialCommunityIcons name="video-outline" size={32} color="#333" />
      <Text style={{ color: '#555', fontSize: 11, marginTop: 6 }}>Video player</Text>
      <Text style={{ color: '#444', fontSize: 9, marginTop: 2 }}>Requiere EAS Build nativo</Text>
    </View>
  );
}

// ── VolumeSlider ───────────────────────────────────────────────────────────
function VolumeSlider({ label, value, onChange, color }: {
  label: string; value: number; onChange: (v: number) => void; color: string;
}) {
  const TRACK_W = W - 32 - 56 - 44;
  return (
    <View style={v.volRow}>
      <Text style={v.volLabel}>{label}</Text>
      <View style={[v.volTrack, { width: TRACK_W }]}>
        <View style={[v.volFill, { width: `${value * 100}%` as any }]}>
          <LinearGradient colors={[color + '88', color]} style={StyleSheet.absoluteFillObject} />
        </View>
        <Pressable
          style={[v.volThumb, { left: `${value * 100}%` as any, backgroundColor: color }]}
          onStartShouldSetResponder={() => true}
          onResponderMove={e => onChange(Math.max(0, Math.min(1, (e.nativeEvent.pageX - 16 - 56) / TRACK_W)))}
        />
      </View>
      <Text style={[v.volValue, { color }]}>{Math.round(value * 100)}%</Text>
    </View>
  );
}

// ── DeezerMusicModal ───────────────────────────────────────────────────────
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

  useEffect(() => {
    if (!visible) return;
    const cat = DEEZER_CATS.find(c => c.id === catId);
    if (cat) searchDeezer(cat.q);
  }, [catId, visible]);

  useEffect(() => {
    if (!search.trim()) {
      const cat = DEEZER_CATS.find(c => c.id === catId);
      if (cat) searchDeezer(cat.q);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchDeezer(search), 500);
  }, [search]);

  useEffect(() => {
    if (!visible) {
      soundRef.current?.stopAsync().catch(() => {});
      soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;
      setPreviewId(null);
    }
  }, [visible]);

  const handlePreview = useCallback(async (track: DeezerTrack) => {
    if (!track.preview) return;
    await soundRef.current?.stopAsync().catch(() => {});
    await soundRef.current?.unloadAsync().catch(() => {});
    soundRef.current = null;
    if (previewId === track.id) { setPreviewId(null); return; }
    setPreviewId(track.id);
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync({ uri: track.preview }, { shouldPlay: true, volume: 1.0 });
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((s: any) => { if (s.didJustFinish) setPreviewId(null); });
    } catch (_) { setPreviewId(null); }
  }, [previewId]);

  const fmtDur = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  return (
    <Modal visible={visible} transparent animationType="slide" presentationStyle="overFullScreen" onRequestClose={onClose}>
      <View style={dm.container}>
        <LinearGradient colors={['#0E0E18', '#12121C']} style={StyleSheet.absoluteFillObject} />
        <View style={dm.header}>
          <Text style={dm.headerTitle}>🎵 Deezer Music</Text>
          <Pressable onPress={onClose}><MaterialCommunityIcons name="close" size={22} color={Colors.textSecondary} /></Pressable>
        </View>
        <View style={dm.searchWrap}>
          <MaterialCommunityIcons name="magnify" size={18} color={Colors.textSubtle} style={{ position: 'absolute', left: 12, zIndex: 1 }} />
          <TextInput style={dm.search} value={search} onChangeText={setSearch}
            placeholder="Buscar canción o artista..." placeholderTextColor={Colors.textSubtle} />
          {search ? (
            <Pressable style={{ position: 'absolute', right: 12 }} onPress={() => setSearch('')}>
              <MaterialCommunityIcons name="close-circle" size={16} color={Colors.textSubtle} />
            </Pressable>
          ) : null}
        </View>
        {!search ? (
          <View style={{ height: 44 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 6 }}>
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
          : (
            <FlatList data={tracks} keyExtractor={t => String(t.id)}
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
                        onPress={() => handlePreview(item)}>
                        <MaterialCommunityIcons name={isPrev ? 'pause' : 'play'} size={16} color={isPrev ? '#fff' : Colors.warning} />
                      </Pressable>
                    ) : null}
                    {isSel ? <MaterialIcons name="check-circle" size={20} color={Colors.warning} style={{ marginLeft: 6 }} /> : null}
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <View style={dm.center}>
                  <MaterialCommunityIcons name="music-off" size={38} color={Colors.textSubtle} />
                  <Text style={dm.centerText}>Sin resultados</Text>
                </View>
              }
            />
          )
        }
      </View>
    </Modal>
  );
}

// ── Main VideosTab ─────────────────────────────────────────────────────────
export function VideosTab() {
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

  const skiaPreviewId = colorFilter !== 'none' ? colorFilter as SkiaEffectId : 'none';

  useEffect(() => () => { soundRef.current?.unloadAsync().catch(() => {}); }, []);

  const pickClip = useCallback(async () => {
    if (clips.length >= 5) { showAlert('Máximo 5 clips', 'Elimina uno para agregar otro'); return; }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { showAlert('Permiso requerido', 'Necesitamos acceso a tu galería'); return; }
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
      if (isPlaying) {
        if (typeof p.pause === 'function') p.pause();
        setIsPlaying(false);
      } else {
        if (typeof p.play === 'function') p.play();
        setIsPlaying(true);
      }
    } catch (_) {}
  }, [isPlaying]);

  const seekTo = useCallback((fraction: number) => {
    if (!playerRef.current || durationMs <= 0) return;
    const targetSec = (fraction * durationMs) / 1000;
    try {
      if (typeof playerRef.current.currentTime !== 'undefined') {
        playerRef.current.currentTime = targetSec; return;
      }
      const avRef = playerRef.current._avRef ?? null;
      if (avRef?.setPositionAsync) { avRef.setPositionAsync(targetSec * 1000); return; }
    } catch (_) {}
  }, [durationMs]);

  const handleSetSpeed = useCallback((val: number) => {
    setSpeed(val);
    try { if (playerRef.current) playerRef.current.playbackRate = val; } catch (_) {}
  }, []);

  const handleExportAndPublish = useCallback(async () => {
    if (!activeClip) return;
    setIsPublishing(true); setIsExporting(true); setExportProgress('Preparando...');
    try {
      const result = await exportFinal({
        clips: clips.map(c => ({
          uri: c.uri,
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
        videoUrl: finalUri, thumbnailUrl: '',
        caption: caption.trim() || `🎬 ${colorFilter !== 'none' ? `#${colorFilter} ` : ''}${speed !== 1 ? `${speed}× ` : ''}#ClipDAG`,
        music: selectedTrack ? `${selectedTrack.title} — ${selectedTrack.artist.name}` : 'Sin música',
        username: '', userAvatar: '',
      });
      showAlert('Publicado 🎉', isFFmpegAvailable() ? 'Video exportado con FFmpeg y publicado' : 'Clip publicado al feed', [
        { text: 'Ver feed', onPress: () => router.replace('/(tabs)') },
      ]);
      setCaptionModal(false);
    } catch (e: any) { showAlert('Error', e?.message || 'No se pudo publicar'); }
    finally { setIsPublishing(false); setIsExporting(false); setExportProgress(null); }
  }, [activeClip, clips, trimStart, trimEnd, speed, colorFilter, selectedTrack, musicVol, videoVol, caption, addVideo, showAlert, router]);

  const TRACK_W    = W - 32;
  const trimDurSec = durationMs > 0 ? Math.round((trimEnd - trimStart) * durationMs / 1000) : 0;

  if (clips.length === 0) {
    return (
      <View style={v.empty}>
        <LinearGradient colors={['#1A1228', '#0E0E18']} style={StyleSheet.absoluteFillObject} />
        <MaterialCommunityIcons name="video-plus-outline" size={60} color={Colors.primary} />
        <Text style={v.emptyTitle}>Importa un video de tu galería</Text>
        <Text style={v.emptySub}>Aplica filtros, cambia velocidad, añade música y publica</Text>
        {isFFmpegAvailable() ? (
          <View style={v.ffmpegBadge}>
            <MaterialCommunityIcons name="check-circle" size={14} color="#00E5A0" />
            <Text style={v.ffmpegBadgeText}>FFmpeg activo — edición real</Text>
          </View>
        ) : (
          <View style={v.ffmpegBadge}>
            <MaterialCommunityIcons name="information" size={14} color={Colors.warning} />
            <Text style={[v.ffmpegBadgeText, { color: Colors.warning }]}>FFmpeg disponible en EAS Build nativo</Text>
          </View>
        )}
        <Pressable style={v.emptyBtn} onPress={pickClip}>
          <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={v.emptyBtnInner}>
            <MaterialCommunityIcons name="folder-open-outline" size={22} color="#fff" />
            <Text style={v.emptyBtnText}>Seleccionar video</Text>
          </LinearGradient>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
      {/* Clip rail */}
      <View style={v.clipRail}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ flexDirection: 'row', gap: 8, padding: 12, alignItems: 'center' }}>
          {clips.map((clip, i) => (
            <Pressable key={clip.id}
              style={[v.clipThumb, activeClipIdx === i && v.clipThumbActive]}
              onPress={() => setActiveClipIdx(i)}>
              <Text style={v.clipThumbNum}>{i + 1}</Text>
              <Text style={v.clipThumbDur}>{Math.round(clip.durationMs / 1000)}s</Text>
              {activeClipIdx === i ? <LinearGradient colors={['#7C5CFF44', 'transparent']} style={StyleSheet.absoluteFillObject} /> : null}
              <Pressable style={v.clipRemove} onPress={() => removeClip(clip.id)}>
                <MaterialIcons name="close" size={12} color="#fff" />
              </Pressable>
            </Pressable>
          ))}
          {clips.length < 5 ? (
            <Pressable style={v.clipAdd} onPress={pickClip}>
              <MaterialCommunityIcons name="plus" size={22} color={Colors.primary} />
              <Text style={v.clipAddText}>Añadir</Text>
            </Pressable>
          ) : null}
        </ScrollView>
        <Text style={v.clipCount}>{clips.length}/5 clips</Text>
      </View>

      {/* Video player */}
      {activeClip ? (
        <View style={v.playerWrap}>
          <ClipVideoPlayer
            key={activeClip.id} uri={activeClip.uri} volume={videoVol} rate={speed}
            onDuration={setDurationMs} onPosition={setPositionMs} onPlayingChange={setIsPlaying}
            playerRef={playerRef}
          />
          {skiaPreviewId !== 'none' ? (
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 5 }} pointerEvents="none">
              <SkiaEffectsLayer effectId={skiaPreviewId} width={W} height={W * 0.62} />
            </View>
          ) : null}
          <Pressable style={[v.playOverlay, { zIndex: 10 }]} onPress={togglePlay}>
            {!isPlaying
              ? <View style={v.playBtn}><MaterialIcons name="play-arrow" size={42} color="#fff" /></View>
              : <View style={v.pauseBtn}><MaterialIcons name="pause" size={26} color="#fff" /></View>}
          </Pressable>
          {speed !== 1 ? (
            <View style={[v.speedBadge, { zIndex: 10 }]}>
              <PulsingDot color="#FF9D00" />
              <Text style={v.speedBadgeText}>{speed}×</Text>
            </View>
          ) : null}
          {selectedTrack ? (
            <View style={[v.musicBadge, { zIndex: 10 }]}>
              <MaterialCommunityIcons name="music-note" size={11} color="#fff" />
              <Text style={v.musicBadgeText} numberOfLines={1}>{selectedTrack.title}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Timeline */}
      {durationMs > 0 ? (
        <>
          <View style={v.timeRow}>
            <Text style={v.timeText}>{fmtMs(positionMs)}</Text>
            {trimDurSec > 0 ? <Text style={[v.timeText, { color: Colors.primary }]}>{trimDurSec}s selec.</Text> : null}
            <Text style={v.timeText}>{fmtMs(durationMs)}</Text>
          </View>
          <View style={[v.seekBar, { width: TRACK_W, marginHorizontal: 16 }]}>
            <LinearGradient colors={['#7C5CFF44', '#FF2D7844']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFillObject} />
            <Pressable style={StyleSheet.absoluteFillObject}
              onStartShouldSetResponder={() => true}
              onResponderMove={e => seekTo(Math.max(0, Math.min(1, (e.nativeEvent.pageX - 16) / TRACK_W)))}
              onPress={e => seekTo(Math.max(0, Math.min(1, (e.nativeEvent.pageX - 16) / TRACK_W)))}
            />
            <View style={[v.seekPlayhead, { left: (positionMs / durationMs) * TRACK_W }]} />
          </View>
        </>
      ) : null}

      {/* Trim */}
      <View style={v.section}>
        <Text style={v.sectionTitle}>✂️ Recortar</Text>
        <View style={[v.track, { width: TRACK_W }]}>
          <LinearGradient colors={['#7C5CFF44', '#FF2D7844']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFillObject} />
          <View style={[v.trimDark, { left: 0, width: trimStart * TRACK_W }]} />
          <View style={[v.trimDark, { left: trimEnd * TRACK_W, right: 0 }]} />
          <View style={[v.trimBracket, { left: trimStart * TRACK_W, width: (trimEnd - trimStart) * TRACK_W }]}>
            <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={v.trimTop} />
            <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={v.trimBottom} />
            <View style={v.trimLeft} /><View style={v.trimRight} />
          </View>
          {durationMs > 0 ? <View style={[v.playhead, { left: (positionMs / durationMs) * TRACK_W }]} /> : null}
        </View>
        <View style={[v.handleZone, { width: TRACK_W }]}>
          <Pressable style={[v.handleTouch, { left: Math.max(0, trimStart * TRACK_W - 18) }]}
            onStartShouldSetResponder={() => true}
            onResponderMove={e => setTrimStart(Math.max(0, Math.min(trimEnd - 0.05, (e.nativeEvent.pageX - 16) / TRACK_W)))}>
            <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={v.handle}><Text style={v.handleIcon}>◂</Text></LinearGradient>
          </Pressable>
          <Pressable style={[v.handleTouch, { left: Math.min(TRACK_W - 36, trimEnd * TRACK_W - 18) }]}
            onStartShouldSetResponder={() => true}
            onResponderMove={e => setTrimEnd(Math.min(1, Math.max(trimStart + 0.05, (e.nativeEvent.pageX - 16) / TRACK_W)))}>
            <LinearGradient colors={['#FF2D78', '#7C5CFF']} style={v.handle}><Text style={v.handleIcon}>▸</Text></LinearGradient>
          </Pressable>
        </View>
      </View>

      {/* Speed */}
      <View style={v.section}>
        <Text style={v.sectionTitle}>⚡ Velocidad</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', gap: 8 }}>
          {SPEED_PRESETS.map(sp => (
            <Pressable key={sp.value} style={[v.speedChip, speed === sp.value && v.speedChipActive]} onPress={() => handleSetSpeed(sp.value)}>
              <Text style={[v.speedLabel, speed === sp.value && { color: '#fff' }]}>{sp.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Color filter */}
      <View style={v.section}>
        <Text style={v.sectionTitle}>🎨 Filtro de color</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', gap: 8 }}>
          {VIDEO_COLOR_FILTERS.map(f => (
            <Pressable key={f.id} style={[v.filterChip, colorFilter === f.id && v.filterChipActive]} onPress={() => setColorFilter(f.id)}>
              <LinearGradient colors={f.gradient} style={v.filterChipGrad} />
              <Text style={v.filterChipEmoji}>{f.emoji}</Text>
              <Text style={[v.filterChipName, colorFilter === f.id && { color: '#fff' }]}>{f.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Music */}
      <View style={v.section}>
        <View style={v.sectionRow}>
          <Text style={v.sectionTitle}>🎵 Música</Text>
          {selectedTrack ? (
            <Pressable onPress={async () => {
              await soundRef.current?.stopAsync().catch(() => {});
              await soundRef.current?.unloadAsync().catch(() => {});
              soundRef.current = null; setSelectedTrack(null);
            }}>
              <Text style={{ color: Colors.error, fontSize: FontSize.xs, fontWeight: FontWeight.semibold }}>Quitar</Text>
            </Pressable>
          ) : null}
        </View>
        {selectedTrack ? (
          <View style={v.trackRow}>
            <Image source={{ uri: selectedTrack.album.cover_medium }} style={v.trackCover} contentFit="cover" transition={150} />
            <View style={{ flex: 1 }}>
              <Text style={v.trackName} numberOfLines={1}>{selectedTrack.title}</Text>
              <Text style={v.trackArtist} numberOfLines={1}>{selectedTrack.artist.name}</Text>
            </View>
            <PulsingDot color={Colors.warning} />
          </View>
        ) : null}
        <Pressable style={v.addMusicBtn} onPress={() => setMusicModal(true)}>
          <LinearGradient colors={['#FF9D00', '#FF5A00']} style={v.addMusicBtnInner}>
            <MaterialCommunityIcons name="music-note-plus" size={18} color="#fff" />
            <Text style={v.addMusicBtnText}>{selectedTrack ? 'Cambiar música' : 'Añadir música Deezer'}</Text>
          </LinearGradient>
        </Pressable>
      </View>

      {selectedTrack ? (
        <View style={v.section}>
          <Text style={v.sectionTitle}>🔊 Mezcla de audio</Text>
          <VolumeSlider label="Video"  value={videoVol} onChange={setVideoVol} color={Colors.primary} />
          <VolumeSlider label="Música" value={musicVol} onChange={setMusicVol} color={Colors.warning} />
        </View>
      ) : null}

      <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
        <Pressable style={v.publishBtn} onPress={() => setCaptionModal(true)} disabled={isExporting}>
          <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={v.publishBtnInner}>
            <MaterialCommunityIcons name="send-circle-outline" size={20} color="#fff" />
            <Text style={v.publishBtnText}>{isFFmpegAvailable() ? 'Exportar y publicar' : 'Publicar video'}</Text>
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
          ) : null}
          <TextInput style={cm.input} value={caption} onChangeText={setCaption}
            placeholder="Escribe algo..." placeholderTextColor={Colors.textSubtle}
            multiline maxLength={200} />
          <Text style={cm.count}>{caption.length}/200</Text>
          <Pressable style={[cm.pubBtn, isPublishing && { opacity: 0.6 }]}
            onPress={handleExportAndPublish} disabled={isPublishing}>
            <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={cm.pubBtnInner}>
              {isPublishing ? <ActivityIndicator color="#fff" size="small" /> : null}
              <Text style={cm.pubBtnText}>{isPublishing ? (exportProgress ?? 'Procesando...') : '🚀 Publicar'}</Text>
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

// ── Styles ─────────────────────────────────────────────────────────────────
const v = StyleSheet.create({
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
  seekBar:          { height: 6, borderRadius: 3, backgroundColor: Colors.surface, overflow: 'hidden', position: 'relative', marginBottom: 4 },
  seekPlayhead:     { position: 'absolute', top: 0, bottom: 0, width: 3, backgroundColor: '#fff', borderRadius: 2 },
  timeRow:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 6 },
  timeText:         { color: Colors.textSubtle, fontSize: 11 },
  section:          { paddingHorizontal: 16, paddingTop: 18, gap: 10 },
  sectionRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle:     { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold },
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
  backdrop:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)' },
  sheet:        { backgroundColor: Colors.surfaceElevated, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 14, borderTopWidth: 1, borderColor: Colors.border },
  handle:       { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center' },
  title:        { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  progressWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.primary + '22', borderRadius: Radius.md, padding: 12 },
  progressText: { color: Colors.primary, fontSize: FontSize.sm, flex: 1 },
  input:        { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 12, color: Colors.textPrimary, fontSize: FontSize.md, minHeight: 80, textAlignVertical: 'top' },
  count:        { color: Colors.textSubtle, fontSize: 11, textAlign: 'right' },
  pubBtn:       { borderRadius: Radius.lg, overflow: 'hidden' },
  pubBtnInner:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  pubBtnText:   { color: '#fff', fontSize: FontSize.md, fontWeight: FontWeight.bold },
});

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
