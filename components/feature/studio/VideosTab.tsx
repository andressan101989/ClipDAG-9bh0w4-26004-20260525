/**
 * components/feature/studio/VideosTab.tsx — v2
 *
 * Creator Studio Tab 2: Video Editor
 *
 * Architecture v2:
 *   - ALL state and business logic delegated to useVideoEditor hook
 *   - This component is pure UI — layout, controls, modals
 *   - expo-video lazy-loaded inside ClipVideoPlayer sub-component only
 *
 * Module boundary:
 *   - No imports from other studio tabs
 *   - No direct ffmpegService calls (all via useVideoEditor.exportAndPublish)
 */
import React, { useState, useCallback, useRef, useMemo, memo } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView, FlatList,
  TextInput, ActivityIndicator, Dimensions, Modal,
} from 'react-native';
import { Image } from 'expo-image';
import { Audio } from 'expo-av';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAlert } from '@/template';
import { useFeed } from '@/hooks/useFeed';
import { useRouter } from 'expo-router';
import { isFFmpegAvailable } from '@/services/ffmpegService';
import SkiaEffectsLayer from '@/components/feature/SkiaEffectsLayer';
import { useVideoEditor, type DeezerTrack } from '@/hooks/video/useVideoEditor';
import { Colors, FontSize, FontWeight, Radius } from '@/constants/theme';

// ── Lazy expo-video / expo-av ────────────────────────────────────────────────
let VideoView: any      = null;
let useVideoPlayer: any = (_src: any, _s?: any): any => null;
let AVVideo: any        = null;
let AVResizeMode: any   = null;
try {
  const ev = require('expo-video');
  VideoView      = ev.VideoView      ?? null;
  useVideoPlayer = ev.useVideoPlayer ?? ((_s: any) => null);
} catch { /* web */ }
try {
  const av = require('expo-av');
  AVVideo      = av.Video      ?? null;
  AVResizeMode = av.ResizeMode ?? null;
} catch { /* web */ }

const { width: W } = Dimensions.get('window');

// ── Constants ─────────────────────────────────────────────────────────────────
const SPEED_PRESETS = [
  { label: '0.5×', value: 0.5 }, { label: '1×', value: 1.0 },
  { label: '2×',  value: 2.0 },  { label: '4×', value: 4.0 },
];

const VIDEO_COLOR_FILTERS = [
  { id: 'none',    name: 'Original', emoji: '🎬', gradient: ['#333', '#222'] as [string, string] },
  { id: 'vintage', name: 'Vintage',  emoji: '📷', gradient: ['#8B5E3C', '#C27540'] as [string, string] },
  { id: 'cine',    name: 'Cine',     emoji: '🎞️', gradient: ['#1A1A2E', '#333355'] as [string, string] },
  { id: 'frio',    name: 'Frío',     emoji: '🧊', gradient: ['#2D9EFF', '#7CC4FF'] as [string, string] },
  { id: 'calido',  name: 'Cálido',   emoji: '🌅', gradient: ['#FF9D00', '#FF5A00'] as [string, string] },
  { id: 'bn',      name: 'B&N',      emoji: '⬛', gradient: ['#555', '#999'] as [string, string] },
  { id: 'neon',    name: 'Neón',     emoji: '🌈', gradient: ['#FF2D78', '#7C5CFF'] as [string, string] },
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

function fmtMs(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}

// ── ClipVideoPlayer — memoized ────────────────────────────────────────────────
const ClipVideoPlayer = memo(function ClipVideoPlayer({ uri, volume, rate, onDuration, onPosition, onPlayingChange, playerRef }: {
  uri: string; volume: number; rate: number;
  onDuration: (ms: number) => void; onPosition: (ms: number) => void;
  onPlayingChange: (p: boolean) => void; playerRef: React.MutableRefObject<any>;
}) {
  const avRef = useRef<any>(null);
  const player = useVideoPlayer(uri, (p: any) => {
    if (!p) return;
    try { p.volume = volume; p.playbackRate = rate; p.loop = false; } catch { /* ignore */ }
  });

  React.useEffect(() => { if (player) playerRef.current = player; }, [player]);
  React.useEffect(() => { try { if (player) player.volume = volume; } catch { /* ignore */ } }, [volume, player]);
  React.useEffect(() => { try { if (player) player.playbackRate = rate; } catch { /* ignore */ } }, [rate, player]);

  React.useEffect(() => {
    if (!player) return;
    const iv = setInterval(() => {
      try {
        onPosition(((player as any).currentTime ?? 0) * 1000);
        const dur = (player as any).duration ?? 0;
        if (dur > 0) onDuration(dur * 1000);
        onPlayingChange((player as any).playing ?? false);
      } catch { /* ignore */ }
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
        onLoad={(s: any) => {
          if (s?.durationMillis) onDuration(s.durationMillis);
          playerRef.current = {
            play:  () => avRef.current?.playAsync?.(),
            pause: () => avRef.current?.pauseAsync?.(),
            get currentTime() { return 0; },
            set volume(val: number) { avRef.current?.setVolumeAsync?.(val); },
            set playbackRate(r: number) { avRef.current?.setRateAsync?.(r, true); },
          };
        }}
        onPlaybackStatusUpdate={(s: any) => {
          if (!s?.isLoaded) return;
          onPosition(s.positionMillis ?? 0);
          if (s.durationMillis) onDuration(s.durationMillis);
          onPlayingChange(s.isPlaying ?? false);
        }}
      />
    );
  }

  return (
    <View style={[v.player, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#0A0A14' }]}>
      <MaterialCommunityIcons name="video-outline" size={32} color="#333" />
      <Text style={{ color: '#555', fontSize: 11, marginTop: 6 }}>Video player (EAS Build)</Text>
    </View>
  );
});

// ── VolumeSlider — memoized ───────────────────────────────────────────────────
const TRACK_W = W - 32 - 56 - 44;

const VolumeSlider = memo(function VolumeSlider({ label, value, onChange, color }: {
  label: string; value: number; onChange: (v: number) => void; color: string;
}) {
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
});

// ── DeezerMusicModal ──────────────────────────────────────────────────────────
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

  React.useEffect(() => {
    if (!visible) return;
    const cat = DEEZER_CATS.find(c => c.id === catId);
    if (cat) searchDeezer(cat.q);
  }, [catId, visible]);

  React.useEffect(() => {
    if (!search.trim()) {
      const cat = DEEZER_CATS.find(c => c.id === catId);
      if (cat) searchDeezer(cat.q);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchDeezer(search), 500);
  }, [search]);

  React.useEffect(() => {
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
    } catch { setPreviewId(null); }
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
          ? <View style={dm.center}><ActivityIndicator color={Colors.warning} size="large" /></View>
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
              ListEmptyComponent={<View style={dm.center}><MaterialCommunityIcons name="music-off" size={38} color={Colors.textSubtle} /><Text style={dm.centerText}>Sin resultados</Text></View>}
            />
          )
        }
      </View>
    </Modal>
  );
}

// ── Main VideosTab ────────────────────────────────────────────────────────────
export function VideosTab() {
  const { addVideo }  = useFeed();
  const { showAlert } = useAlert();
  const router        = useRouter();

  const editor = useVideoEditor();
  const [captionModal, setCaptionModal] = useState(false);
  const [caption,      setCaption]      = useState('');
  const [musicModal,   setMusicModal]   = useState(false);

  const TRACK_W_FULL = W - 32;

  const handleExportAndPublish = useCallback(async () => {
    const { uri, ok, error } = await editor.exportAndPublish(caption);
    if (!ok || !uri) { showAlert('Error', error ?? 'No se pudo exportar'); return; }
    try {
      await addVideo({
        videoUrl: uri, thumbnailUrl: '',
        caption: caption.trim() || `🎬 ${editor.colorFilter !== 'none' ? `#${editor.colorFilter} ` : ''}${editor.speed !== 1 ? `${editor.speed}× ` : ''}#ClipDAG`,
        music: editor.selectedTrack
          ? `${editor.selectedTrack.title} — ${editor.selectedTrack.artist.name}`
          : 'Sin música',
        username: '', userAvatar: '',
      });
      showAlert('Publicado 🎉', isFFmpegAvailable() ? 'Video exportado y publicado' : 'Clip publicado', [
        { text: 'Ver feed', onPress: () => router.replace('/(tabs)') },
      ]);
      setCaptionModal(false);
      editor.reset();
    } catch (e: any) { showAlert('Error', e?.message || 'No se pudo publicar'); }
  }, [editor, caption, addVideo, showAlert, router]);

  const trimDurSec = editor.durationMs > 0
    ? Math.round((editor.trimEnd - editor.trimStart) * editor.durationMs / 1000)
    : 0;

  // ── Empty state ────────────────────────────────────────────────────────────
  if (editor.clips.length === 0) {
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
        <Pressable style={v.emptyBtn} onPress={editor.pickClip}>
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
          {editor.clips.map((clip, i) => (
            <Pressable key={clip.id}
              style={[v.clipThumb, editor.activeIdx === i && v.clipThumbActive]}
              onPress={() => editor.setActiveIdx(i)}>
              <Text style={v.clipThumbNum}>{i + 1}</Text>
              <Text style={v.clipThumbDur}>{Math.round(clip.durationMs / 1000)}s</Text>
              {editor.activeIdx === i ? <LinearGradient colors={['#7C5CFF44', 'transparent']} style={StyleSheet.absoluteFillObject} /> : null}
              <Pressable style={v.clipRemove} onPress={() => editor.removeClip(clip.id)}>
                <MaterialIcons name="close" size={12} color="#fff" />
              </Pressable>
            </Pressable>
          ))}
          {editor.clips.length < 5 ? (
            <Pressable style={v.clipAdd} onPress={editor.pickClip}>
              <MaterialCommunityIcons name="plus" size={22} color={Colors.primary} />
              <Text style={v.clipAddText}>Añadir</Text>
            </Pressable>
          ) : null}
        </ScrollView>
        <Text style={v.clipCount}>{editor.clips.length}/5 clips</Text>
      </View>

      {/* Video player */}
      {editor.activeClip ? (
        <View style={v.playerWrap}>
          <ClipVideoPlayer
            key={editor.activeClip.id}
            uri={editor.activeClip.uri}
            volume={editor.videoVol}
            rate={editor.speed}
            onDuration={editor.setDurationMs}
            onPosition={editor.setPositionMs}
            onPlayingChange={editor.setIsPlaying}
            playerRef={editor.playerRef}
          />
          {editor.colorFilter !== 'none' ? (
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 5 }} pointerEvents="none">
              <SkiaEffectsLayer effectId={editor.colorFilter as any} width={W} height={W * 0.62} />
            </View>
          ) : null}
          <Pressable style={[v.playOverlay, { zIndex: 10 }]} onPress={editor.togglePlay}>
            {!editor.isPlaying
              ? <View style={v.playBtn}><MaterialIcons name="play-arrow" size={42} color="#fff" /></View>
              : <View style={v.pauseBtn}><MaterialIcons name="pause" size={26} color="#fff" /></View>}
          </Pressable>
          {editor.speed !== 1 ? (
            <View style={[v.speedBadge, { zIndex: 10 }]}>
              <Text style={v.speedBadgeText}>{editor.speed}×</Text>
            </View>
          ) : null}
          {editor.selectedTrack ? (
            <View style={[v.musicBadge, { zIndex: 10 }]}>
              <MaterialCommunityIcons name="music-note" size={11} color="#fff" />
              <Text style={v.musicBadgeText} numberOfLines={1}>{editor.selectedTrack.title}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Timeline */}
      {editor.durationMs > 0 ? (
        <>
          <View style={v.timeRow}>
            <Text style={v.timeText}>{fmtMs(editor.positionMs)}</Text>
            {trimDurSec > 0 ? <Text style={[v.timeText, { color: Colors.primary }]}>{trimDurSec}s selec.</Text> : null}
            <Text style={v.timeText}>{fmtMs(editor.durationMs)}</Text>
          </View>
          <View style={[v.seekBar, { width: TRACK_W_FULL, marginHorizontal: 16 }]}>
            <LinearGradient colors={['#7C5CFF44', '#FF2D7844']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFillObject} />
            <Pressable style={StyleSheet.absoluteFillObject}
              onStartShouldSetResponder={() => true}
              onResponderMove={e => editor.seekTo(Math.max(0, Math.min(1, (e.nativeEvent.pageX - 16) / TRACK_W_FULL)))}
              onPress={e => editor.seekTo(Math.max(0, Math.min(1, (e.nativeEvent.pageX - 16) / TRACK_W_FULL)))}
            />
            <View style={[v.seekPlayhead, { left: (editor.positionMs / editor.durationMs) * TRACK_W_FULL }]} />
          </View>
        </>
      ) : null}

      {/* Trim */}
      <View style={v.section}>
        <Text style={v.sectionTitle}>✂️ Recortar</Text>
        <View style={[v.track, { width: TRACK_W_FULL }]}>
          <LinearGradient colors={['#7C5CFF44', '#FF2D7844']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFillObject} />
          <View style={[v.trimDark, { left: 0, width: editor.trimStart * TRACK_W_FULL }]} />
          <View style={[v.trimDark, { left: editor.trimEnd * TRACK_W_FULL, right: 0 }]} />
          <View style={[v.trimBracket, { left: editor.trimStart * TRACK_W_FULL, width: (editor.trimEnd - editor.trimStart) * TRACK_W_FULL }]}>
            <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={v.trimTop} />
            <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={v.trimBottom} />
            <View style={v.trimLeft} /><View style={v.trimRight} />
          </View>
          {editor.durationMs > 0 ? <View style={[v.playhead, { left: (editor.positionMs / editor.durationMs) * TRACK_W_FULL }]} /> : null}
        </View>
        <View style={[v.handleZone, { width: TRACK_W_FULL }]}>
          <Pressable style={[v.handleTouch, { left: Math.max(0, editor.trimStart * TRACK_W_FULL - 18) }]}
            onStartShouldSetResponder={() => true}
            onResponderMove={e => editor.setTrimStart(Math.max(0, Math.min(editor.trimEnd - 0.05, (e.nativeEvent.pageX - 16) / TRACK_W_FULL)))}>
            <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={v.handle}><Text style={v.handleIcon}>◂</Text></LinearGradient>
          </Pressable>
          <Pressable style={[v.handleTouch, { left: Math.min(TRACK_W_FULL - 36, editor.trimEnd * TRACK_W_FULL - 18) }]}
            onStartShouldSetResponder={() => true}
            onResponderMove={e => editor.setTrimEnd(Math.min(1, Math.max(editor.trimStart + 0.05, (e.nativeEvent.pageX - 16) / TRACK_W_FULL)))}>
            <LinearGradient colors={['#FF2D78', '#7C5CFF']} style={v.handle}><Text style={v.handleIcon}>▸</Text></LinearGradient>
          </Pressable>
        </View>
      </View>

      {/* Speed */}
      <View style={v.section}>
        <Text style={v.sectionTitle}>⚡ Velocidad</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', gap: 8 }}>
          {SPEED_PRESETS.map(sp => (
            <Pressable key={sp.value} style={[v.speedChip, editor.speed === sp.value && v.speedChipActive]} onPress={() => editor.setSpeed(sp.value)}>
              <Text style={[v.speedLabel, editor.speed === sp.value && { color: '#fff' }]}>{sp.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Color filter */}
      <View style={v.section}>
        <Text style={v.sectionTitle}>🎨 Filtro de color</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', gap: 8 }}>
          {VIDEO_COLOR_FILTERS.map(f => (
            <Pressable key={f.id} style={[v.filterChip, editor.colorFilter === f.id && v.filterChipActive]} onPress={() => editor.setColorFilter(f.id as any)}>
              <LinearGradient colors={f.gradient} style={v.filterChipGrad} />
              <Text style={v.filterChipEmoji}>{f.emoji}</Text>
              <Text style={[v.filterChipName, editor.colorFilter === f.id && { color: '#fff' }]}>{f.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Music */}
      <View style={v.section}>
        <View style={v.sectionRow}>
          <Text style={v.sectionTitle}>🎵 Música</Text>
          {editor.selectedTrack ? (
            <Pressable onPress={() => {
              editor.soundRef.current?.stopAsync().catch(() => {});
              editor.soundRef.current?.unloadAsync().catch(() => {});
              editor.soundRef.current = null;
              editor.setSelectedTrack(null);
            }}>
              <Text style={{ color: Colors.error, fontSize: FontSize.xs, fontWeight: FontWeight.semibold }}>Quitar</Text>
            </Pressable>
          ) : null}
        </View>
        {editor.selectedTrack ? (
          <View style={v.trackRow}>
            <Image source={{ uri: editor.selectedTrack.album.cover_medium }} style={v.trackCover} contentFit="cover" transition={150} />
            <View style={{ flex: 1 }}>
              <Text style={v.trackName} numberOfLines={1}>{editor.selectedTrack.title}</Text>
              <Text style={v.trackArtist} numberOfLines={1}>{editor.selectedTrack.artist.name}</Text>
            </View>
          </View>
        ) : null}
        <Pressable style={v.addMusicBtn} onPress={() => setMusicModal(true)}>
          <LinearGradient colors={['#FF9D00', '#FF5A00']} style={v.addMusicBtnInner}>
            <MaterialCommunityIcons name="music-note-plus" size={18} color="#fff" />
            <Text style={v.addMusicBtnText}>{editor.selectedTrack ? 'Cambiar música' : 'Añadir música Deezer'}</Text>
          </LinearGradient>
        </Pressable>
      </View>

      {editor.selectedTrack ? (
        <View style={v.section}>
          <Text style={v.sectionTitle}>🔊 Mezcla de audio</Text>
          <VolumeSlider label="Video"  value={editor.videoVol} onChange={editor.setVideoVol} color={Colors.primary} />
          <VolumeSlider label="Música" value={editor.musicVol} onChange={editor.setMusicVol} color={Colors.warning} />
        </View>
      ) : null}

      <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
        <Pressable style={v.publishBtn} onPress={() => setCaptionModal(true)} disabled={editor.isExporting}>
          <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={v.publishBtnInner}>
            <MaterialCommunityIcons name="send-circle-outline" size={20} color="#fff" />
            <Text style={v.publishBtnText}>{isFFmpegAvailable() ? 'Exportar y publicar' : 'Publicar video'}</Text>
          </LinearGradient>
        </Pressable>
      </View>

      {/* Caption modal */}
      <Modal visible={captionModal} transparent animationType="slide" presentationStyle="overFullScreen"
        onRequestClose={() => !editor.isPublishing && setCaptionModal(false)}>
        <Pressable style={cm.backdrop} onPress={() => !editor.isPublishing && setCaptionModal(false)} />
        <View style={cm.sheet}>
          <View style={cm.handle} />
          <Text style={cm.title}>Caption del video</Text>
          {editor.isExporting && editor.exportProgress ? (
            <View style={cm.progressWrap}>
              <ActivityIndicator color={Colors.primary} size="small" />
              <Text style={cm.progressText}>{editor.exportProgress}</Text>
            </View>
          ) : null}
          <TextInput style={cm.input} value={caption} onChangeText={setCaption}
            placeholder="Escribe algo..." placeholderTextColor={Colors.textSubtle}
            multiline maxLength={200} />
          <Text style={cm.count}>{caption.length}/200</Text>
          <Pressable style={[cm.pubBtn, editor.isPublishing && { opacity: 0.6 }]}
            onPress={handleExportAndPublish} disabled={editor.isPublishing}>
            <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={cm.pubBtnInner}>
              {editor.isPublishing ? <ActivityIndicator color="#fff" size="small" /> : null}
              <Text style={cm.pubBtnText}>{editor.isPublishing ? (editor.exportProgress ?? 'Procesando...') : '🚀 Publicar'}</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </Modal>

      <DeezerMusicModal
        visible={musicModal}
        onClose={() => setMusicModal(false)}
        onSelect={track => { editor.setSelectedTrack(track); setMusicModal(false); }}
        selectedId={editor.selectedTrack?.id ?? null}
        soundRef={editor.soundRef}
      />
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
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
  speedBadge:       { position: 'absolute', top: 10, left: 10, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 5 },
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
  previewBtn:   { width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.warningDim, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.warning + '55' },
});
