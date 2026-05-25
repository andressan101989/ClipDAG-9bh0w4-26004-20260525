import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, Pressable, StyleSheet, TextInput, FlatList,
  Modal, ActivityIndicator, ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import {
  MUSIC_LIBRARY, MUSIC_CATEGORIES, getTrendingTracks,
  getTracksByCategory, searchTracks, formatDuration, formatUsageCount,
  type MusicTrack,
} from '@/services/musicLibrary';

interface MusicPickerProps {
  visible: boolean;
  selectedTrackId?: string;
  onClose: () => void;
  onSelect: (track: MusicTrack) => void;
}

export function MusicPicker({ visible, selectedTrackId, onClose, onSelect }: MusicPickerProps) {
  const insets = useSafeAreaInsets();
  const [activeCategory, setActiveCategory] = useState('trending');
  const [searchQuery, setSearchQuery] = useState('');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);

  // Derived tracks list
  const tracks = searchQuery.trim()
    ? searchTracks(searchQuery)
    : getTracksByCategory(activeCategory);

  // Stop audio on close
  useEffect(() => {
    if (!visible) stopAudio();
  }, [visible]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { stopAudio(); };
  }, []);

  const stopAudio = useCallback(async () => {
    setPlayingId(null);
    if (soundRef.current) {
      try {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
      } catch (_) {}
      soundRef.current = null;
    }
  }, []);

  const handlePlayPreview = useCallback(async (track: MusicTrack) => {
    if (!track.previewUrl || track.isOriginalSound) return;

    if (playingId === track.id) {
      await stopAudio();
      return;
    }

    await stopAudio();
    setPlayingId(track.id);
    setIsLoadingAudio(true);

    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync(
        { uri: track.previewUrl },
        { shouldPlay: true, isLooping: false },
        (status) => {
          if (!status.isLoaded) return;
          if (status.didJustFinish) {
            setPlayingId(null);
            soundRef.current = null;
          }
        }
      );
      soundRef.current = sound;
    } catch (_) {
      setPlayingId(null);
    }
    setIsLoadingAudio(false);
  }, [playingId, stopAudio]);

  const handleSelectTrack = useCallback((track: MusicTrack) => {
    stopAudio();
    onSelect(track);
    onClose();
  }, [onSelect, onClose, stopAudio]);

  const renderTrack = useCallback(({ item }: { item: MusicTrack }) => {
    const isPlaying = playingId === item.id;
    const isSelected = selectedTrackId === item.id;
    const isOriginal = item.isOriginalSound;

    return (
      <Pressable
        style={[styles.trackRow, isSelected && styles.trackRowSelected]}
        onPress={() => handleSelectTrack(item)}
      >
        {/* Cover / Icon */}
        <View style={styles.trackCoverWrap}>
          {isOriginal ? (
            <LinearGradient
              colors={['#7C5CFF33', '#FF2D7822']}
              style={styles.trackCover}
            >
              <MaterialCommunityIcons name="music-off" size={20} color={Colors.textSubtle} />
            </LinearGradient>
          ) : (
            <View style={styles.trackCover}>
              {item.coverUrl ? (
                <Image source={{ uri: item.coverUrl }} style={StyleSheet.absoluteFillObject} contentFit="cover" transition={150} />
              ) : (
                <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={StyleSheet.absoluteFillObject} />
              )}
              {/* Vinyl spin overlay when playing */}
              {isPlaying ? (
                <View style={styles.vinylOverlay}>
                  <View style={styles.vinylCenter} />
                </View>
              ) : null}
            </View>
          )}
        </View>

        {/* Info */}
        <View style={styles.trackInfo}>
          <View style={styles.trackTitleRow}>
            <Text style={[styles.trackTitle, isSelected && { color: Colors.primary }]} numberOfLines={1}>
              {item.title}
            </Text>
            {item.trending ? (
              <LinearGradient colors={['#FF2D78', '#FFB800']} style={styles.trendBadge}>
                <Text style={styles.trendBadgeText}>🔥</Text>
              </LinearGradient>
            ) : null}
          </View>
          <Text style={styles.trackArtist} numberOfLines={1}>{item.artist}</Text>
          <View style={styles.trackMeta}>
            {item.duration > 0 ? (
              <Text style={styles.trackDuration}>{formatDuration(item.duration)}</Text>
            ) : null}
            {(item.usageCount || 0) > 0 ? (
              <>
                <View style={styles.metaDot} />
                <MaterialCommunityIcons name="play-circle-outline" size={11} color={Colors.textSubtle} />
                <Text style={styles.trackUsage}>{formatUsageCount(item.usageCount || 0)}</Text>
              </>
            ) : null}
          </View>
        </View>

        {/* Actions */}
        <View style={styles.trackActions}>
          {/* Play preview */}
          {!isOriginal ? (
            <Pressable
              style={[styles.playBtn, isPlaying && styles.playBtnActive]}
              onPress={() => handlePlayPreview(item)}
              hitSlop={8}
            >
              {isLoadingAudio && isPlaying ? (
                <ActivityIndicator color={Colors.primary} size="small" />
              ) : (
                <MaterialCommunityIcons
                  name={isPlaying ? 'pause' : 'play'}
                  size={16}
                  color={isPlaying ? Colors.primary : Colors.textSecondary}
                />
              )}
            </Pressable>
          ) : null}

          {/* Select check */}
          {isSelected ? (
            <View style={styles.selectedCheck}>
              <LinearGradient colors={['#7C5CFF', '#FF2D78']} style={styles.selectedCheckGrad}>
                <MaterialIcons name="check" size={14} color="#fff" />
              </LinearGradient>
            </View>
          ) : (
            <View style={styles.selectCircle} />
          )}
        </View>
      </Pressable>
    );
  }, [playingId, selectedTrackId, isLoadingAudio, handleSelectTrack, handlePlayPreview]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          {/* Handle */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Agregar Musica</Text>
            <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
              <MaterialIcons name="close" size={22} color={Colors.textSecondary} />
            </Pressable>
          </View>

          {/* Search */}
          <View style={styles.searchBar}>
            <MaterialIcons name="search" size={18} color={Colors.textSubtle} />
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Buscar canciones o artistas..."
              placeholderTextColor={Colors.textSubtle}
              autoCorrect={false}
            />
            {searchQuery ? (
              <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
                <MaterialIcons name="close" size={16} color={Colors.textSubtle} />
              </Pressable>
            ) : null}
          </View>

          {/* Categories */}
          {!searchQuery ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.catsRow}
              style={styles.catsScroll}
            >
              {MUSIC_CATEGORIES.map(cat => (
                <Pressable
                  key={cat.id}
                  style={[styles.catChip, activeCategory === cat.id && styles.catChipActive]}
                  onPress={() => setActiveCategory(cat.id)}
                >
                  <Text style={styles.catEmoji}>{cat.emoji}</Text>
                  <Text style={[styles.catLabel, activeCategory === cat.id && styles.catLabelActive]}>
                    {cat.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          {/* Track list */}
          <FlatList
            data={tracks}
            keyExtractor={item => item.id}
            renderItem={renderTrack}
            style={styles.list}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={
              <View style={styles.empty}>
                <MaterialCommunityIcons name="music-off" size={36} color={Colors.textSubtle} />
                <Text style={styles.emptyText}>No se encontraron canciones</Text>
              </View>
            }
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.bg,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '85%',
    borderTopWidth: 1, borderColor: Colors.border,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: Colors.border, alignSelf: 'center', marginTop: 12, marginBottom: 4,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
  },
  headerTitle: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  closeBtn: { padding: 4 },

  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.border, height: 44,
  },
  searchInput: { flex: 1, color: Colors.textPrimary, fontSize: FontSize.sm },

  catsScroll: { maxHeight: 48, marginBottom: Spacing.sm },
  catsRow: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: 2 },
  catChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: Radius.full, borderWidth: 1,
    backgroundColor: Colors.surfaceElevated, borderColor: Colors.border,
  },
  catChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  catEmoji: { fontSize: 13 },
  catLabel: { color: Colors.textSecondary, fontSize: FontSize.xs, fontWeight: FontWeight.medium },
  catLabelActive: { color: '#fff' },

  list: { flex: 1 },
  separator: { height: 1, backgroundColor: Colors.borderSubtle, marginLeft: 72 },

  trackRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.lg, paddingVertical: 10,
  },
  trackRowSelected: { backgroundColor: Colors.primaryDim + '18' },

  trackCoverWrap: { flexShrink: 0 },
  trackCover: {
    width: 48, height: 48, borderRadius: 8,
    overflow: 'hidden', backgroundColor: Colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  vinylOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  vinylCenter: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary },

  trackInfo: { flex: 1 },
  trackTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  trackTitle: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, flex: 1 },
  trendBadge: { borderRadius: Radius.xs, paddingHorizontal: 4, paddingVertical: 1 },
  trendBadgeText: { fontSize: 9 },
  trackArtist: { color: Colors.textSubtle, fontSize: FontSize.xs, marginBottom: 3 },
  trackMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  trackDuration: { color: Colors.textSubtle, fontSize: 10 },
  metaDot: { width: 2, height: 2, borderRadius: 1, backgroundColor: Colors.textSubtle },
  trackUsage: { color: Colors.textSubtle, fontSize: 10 },

  trackActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  playBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  playBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryDim },

  selectedCheck: { borderRadius: 12 },
  selectedCheckGrad: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  selectCircle: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.border },

  empty: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xxl },
  emptyText: { color: Colors.textSubtle, fontSize: FontSize.sm },
});
