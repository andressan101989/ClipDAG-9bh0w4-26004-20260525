/**
 * components/feature/studio/MusicTab.tsx
 * Creator Studio — Tab 4: Deezer Music Library
 *
 * Isolation contract:
 *  - No imports from other studio tabs
 *  - expo-av for audio preview only (no video)
 *  - Real-time Deezer API search with category filters
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView, FlatList,
  TextInput, ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { Audio } from 'expo-av';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAlert } from '@/template';
import { Colors, FontSize, FontWeight, Radius } from '@/constants/theme';

// ── Types ──────────────────────────────────────────────────────────────────
interface DeezerArtist { name: string }
interface DeezerAlbum  { cover_medium: string; title: string }
interface DeezerTrack  {
  id: number;
  title: string;
  preview: string;
  duration: number;
  artist: DeezerArtist;
  album: DeezerAlbum;
}

// ── Categories ─────────────────────────────────────────────────────────────
const DEEZER_CATS = [
  { id: 'viral',      q: 'trending viral 2025', label: 'Viral',       emoji: '📈' },
  { id: 'pop',        q: 'top pop 2025',        label: 'Pop',         emoji: '🎤' },
  { id: 'reggaeton',  q: 'reggaeton hits',      label: 'Reggaetón',   emoji: '🔥' },
  { id: 'hiphop',     q: 'hip hop rap',         label: 'Hip Hop',     emoji: '🎧' },
  { id: 'electronic', q: 'electronic edm',      label: 'Electrónica', emoji: '⚡' },
  { id: 'lofi',       q: 'lofi chill beats',    label: 'Lo-Fi',       emoji: '☕' },
  { id: 'latin',      q: 'latin hits',          label: 'Latino',      emoji: '🌶️' },
];

// ── Pulsing dot ────────────────────────────────────────────────────────────
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

// ── Main MusicTab ──────────────────────────────────────────────────────────
export function MusicTab() {
  const { showAlert } = useAlert();
  const soundRef      = useRef<Audio.Sound | null>(null);

  const [search,        setSearch]        = useState('');
  const [catId,         setCatId]         = useState('viral');
  const [tracks,        setTracks]        = useState<DeezerTrack[]>([]);
  const [loading,       setLoading]       = useState(false);
  const [previewId,     setPreviewId]     = useState<number | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<DeezerTrack | null>(null);
  const [error,         setError]         = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    soundRef.current?.stopAsync().catch(() => {});
    soundRef.current?.unloadAsync().catch(() => {});
  }, []);

  const searchDeezer = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLoading(true); setError('');
    try {
      const res  = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=30&output=json`);
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      setTracks((json.data ?? []) as DeezerTrack[]);
    } catch { setError('Sin conexión a Deezer.'); setTracks([]); }
    setLoading(false);
  }, []);

  useEffect(() => {
    const cat = DEEZER_CATS.find(c => c.id === catId);
    if (cat) searchDeezer(cat.q);
  }, [catId]);

  useEffect(() => {
    if (!search.trim()) {
      const cat = DEEZER_CATS.find(c => c.id === catId);
      if (cat) searchDeezer(cat.q);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchDeezer(search), 500);
  }, [search]);

  const handlePreview = useCallback(async (track: DeezerTrack) => {
    if (!track.preview) { showAlert('Sin preview', 'Esta canción no tiene preview disponible'); return; }
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
    } catch (_) { setPreviewId(null); showAlert('Error', 'No se pudo reproducir'); }
  }, [previewId, showAlert]);

  const fmtDur = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  return (
    <View style={{ flex: 1 }}>
      {/* Search */}
      <View style={m.searchWrap}>
        <MaterialCommunityIcons name="magnify" size={18} color={Colors.textSubtle}
          style={{ position: 'absolute', left: 14, zIndex: 1 }} />
        <TextInput style={m.search} value={search} onChangeText={setSearch}
          placeholder="Buscar en Deezer: artista, canción..." placeholderTextColor={Colors.textSubtle} />
        {search ? (
          <Pressable style={{ position: 'absolute', right: 14 }} onPress={() => setSearch('')}>
            <MaterialCommunityIcons name="close-circle" size={16} color={Colors.textSubtle} />
          </Pressable>
        ) : null}
      </View>

      {/* Deezer attribution */}
      <View style={m.deezerBadge}>
        <Text style={m.deezerText}>🎵 Resultados en tiempo real de </Text>
        <Text style={[m.deezerText, { color: '#FF6F42', fontWeight: FontWeight.bold }]}>Deezer</Text>
      </View>

      {/* Category chips */}
      {!search ? (
        <View style={{ height: 44 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 6 }}>
            {DEEZER_CATS.map(cat => (
              <Pressable key={cat.id} style={[m.catChip, catId === cat.id && m.catChipActive]} onPress={() => setCatId(cat.id)}>
                <Text style={m.catEmoji}>{cat.emoji}</Text>
                <Text style={[m.catLabel, catId === cat.id && { color: '#fff' }]}>{cat.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* Now playing */}
      {previewId ? (
        <Pressable style={m.nowPlaying} onPress={() => {
          soundRef.current?.stopAsync().catch(() => {});
          soundRef.current?.unloadAsync().catch(() => {});
          soundRef.current = null; setPreviewId(null);
        }}>
          <PulsingDot color={Colors.warning} />
          <Text style={m.nowPlayingText} numberOfLines={1}>
            {tracks.find(t => t.id === previewId)?.title ?? 'Reproduciendo...'}
          </Text>
          <MaterialCommunityIcons name="stop-circle-outline" size={18} color={Colors.warning} />
        </Pressable>
      ) : null}

      {/* Track list */}
      {loading ? (
        <View style={m.center}>
          <ActivityIndicator color={Colors.warning} size="large" />
          <Text style={m.centerText}>Cargando desde Deezer...</Text>
        </View>
      ) : error ? (
        <View style={m.center}>
          <MaterialCommunityIcons name="wifi-off" size={44} color={Colors.textSubtle} />
          <Text style={m.centerText}>{error}</Text>
          <Pressable style={m.retryBtn} onPress={() => {
            const c = DEEZER_CATS.find(x => x.id === catId);
            if (c) searchDeezer(c.q);
          }}>
            <Text style={m.retryBtnText}>Reintentar</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={tracks}
          keyExtractor={t => String(t.id)}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: selectedTrack ? 90 : 120, gap: 8, paddingTop: 8 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const isPrev = previewId === item.id;
            const isSel  = selectedTrack?.id === item.id;
            return (
              <Pressable style={[m.trackRow, isSel && m.trackRowSel]} onPress={() => setSelectedTrack(isSel ? null : item)}>
                <Image source={{ uri: item.album.cover_medium }} style={m.cover} contentFit="cover" transition={150} />
                <View style={{ flex: 1 }}>
                  <Text style={[m.trackTitle, isSel && { color: Colors.warning }]} numberOfLines={1}>{item.title}</Text>
                  <Text style={m.trackArtist} numberOfLines={1}>{item.artist.name}</Text>
                  <Text style={m.trackDur}>{fmtDur(item.duration)}</Text>
                </View>
                <View style={{ alignItems: 'center', gap: 6 }}>
                  {item.preview ? (
                    <Pressable
                      style={[m.previewBtn, isPrev && { backgroundColor: Colors.warning, borderColor: Colors.warning }]}
                      onPress={() => handlePreview(item)}>
                      <MaterialCommunityIcons name={isPrev ? 'pause' : 'play'} size={16} color={isPrev ? '#fff' : Colors.warning} />
                    </Pressable>
                  ) : null}
                  {isSel ? <MaterialIcons name="check-circle" size={20} color={Colors.warning} /> : null}
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <View style={m.center}>
              <MaterialCommunityIcons name="music-off" size={40} color={Colors.textSubtle} />
              <Text style={m.centerText}>Sin resultados</Text>
            </View>
          }
        />
      )}

      {/* Selected track action bar */}
      {selectedTrack ? (
        <View style={m.actionBar}>
          <LinearGradient colors={['rgba(18,18,28,0.98)', '#12121C']} style={StyleSheet.absoluteFillObject} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
            <PulsingDot color={Colors.warning} />
            <Text style={m.selectedTitle} numberOfLines={1}>
              {`${selectedTrack.title} — ${selectedTrack.artist.name}`}
            </Text>
          </View>
          <Pressable style={m.useBtn} onPress={() => showAlert(
            'Canción seleccionada',
            `"${selectedTrack.title}" lista. Ve al tab Videos para añadirla.`,
          )}>
            <LinearGradient colors={['#FF9D00', '#FF5A00']} style={m.useBtnInner}>
              <Text style={m.useBtnText}>Usar en video</Text>
            </LinearGradient>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const m = StyleSheet.create({
  searchWrap:    { marginHorizontal: 16, marginVertical: 10, position: 'relative', justifyContent: 'center' },
  search:        { backgroundColor: Colors.surfaceElevated, borderRadius: Radius.xl, paddingVertical: 11, paddingLeft: 40, paddingRight: 36, color: Colors.textPrimary, fontSize: FontSize.sm, borderWidth: 1, borderColor: Colors.border },
  deezerBadge:   { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 4 },
  deezerText:    { color: Colors.textSubtle, fontSize: 10 },
  catChip:       { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full, backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border },
  catChipActive: { backgroundColor: Colors.warning, borderColor: Colors.warning },
  catEmoji:      { fontSize: 14 },
  catLabel:      { color: Colors.textSubtle, fontSize: FontSize.xs, fontWeight: FontWeight.medium },
  nowPlaying:    { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginBottom: 6, backgroundColor: Colors.warningDim, borderRadius: Radius.lg, padding: 12, borderWidth: 1, borderColor: Colors.warning + '44' },
  nowPlayingText:{ color: Colors.warning, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, flex: 1 },
  center:        { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 60 },
  centerText:    { color: Colors.textSubtle, fontSize: FontSize.sm, textAlign: 'center' },
  retryBtn:      { backgroundColor: Colors.primary, borderRadius: Radius.md, paddingHorizontal: 20, paddingVertical: 10 },
  retryBtnText:  { color: '#fff', fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  trackRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: 12, borderWidth: 1, borderColor: Colors.border },
  trackRowSel:   { borderColor: Colors.warning, backgroundColor: Colors.warning + '0D' },
  cover:         { width: 50, height: 50, borderRadius: 10 },
  trackTitle:    { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  trackArtist:   { color: Colors.textSubtle, fontSize: 11, marginTop: 2 },
  trackDur:      { color: Colors.textSubtle, fontSize: 10, marginTop: 2 },
  previewBtn:    { width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.warningDim, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.warning + '66' },
  actionBar:     { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: Colors.border },
  selectedTitle: { color: Colors.warning, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  useBtn:        { borderRadius: Radius.lg, overflow: 'hidden' },
  useBtnInner:   { paddingHorizontal: 16, paddingVertical: 10 },
  useBtnText:    { color: '#fff', fontSize: FontSize.xs, fontWeight: FontWeight.bold },
});
