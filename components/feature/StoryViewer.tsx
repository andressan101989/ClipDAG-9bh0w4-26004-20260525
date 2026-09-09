/**
 * StoryViewer.tsx — Web stub (no expo-video, not available on web bundler)
 * The real implementation is in StoryViewer.native.tsx for iOS/Android.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, Modal, Pressable, StyleSheet, Dimensions,
  ActivityIndicator, Animated, PanResponder,
} from 'react-native';
import { Image } from '@/components/ui/SafeImage';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/Avatar';
import { Colors, FontSize, FontWeight, Spacing, Radius } from '@/constants/theme';
import type { StoryGroup, StoryItem } from './StoriesBar';
import { useStoryMediaUrl } from './useStoryMediaUrl';
import { StoryViewersSheet } from './StoryViewersSheet';
import type {
  StoryViewerCursor,
  StoryDeleteResult,
  StoryViewerRecord,
  StoryViewersPage,
} from '@/contexts/StoriesContext';

const { width: W, height: H } = Dimensions.get('window');
const STORY_DURATION = 15000;

interface StoryViewerProps {
  visible: boolean;
  storyGroup: StoryGroup | null;
  currentUserId?: string;
  onClose: () => void;
  onMarkViewed?: (storyId: string) => Promise<void>;
  onGetViewers?: (
    storyId: string,
    cursor?: StoryViewerCursor,
    limit?: number,
  ) => Promise<StoryViewersPage>;
  onDeleteStory?: (storyId: string) => Promise<StoryDeleteResult>;
}

function StoryPhotoMedia({ story, isActive }: { story: StoryItem; isActive: boolean }) {
  const { url, isLoading, hasError, retry, fail } = useStoryMediaUrl(story, isActive);
  if (isLoading) {
    return <View style={[styles.media, styles.mediaState]}><ActivityIndicator color="#fff" /></View>;
  }
  if (hasError || !url) {
    return (
      <View style={[styles.media, styles.mediaState]}>
        <Text style={styles.mediaStateText}>Historia no disponible.</Text>
        <Pressable accessibilityRole="button" onPress={retry} style={styles.retryButton}>
          <Text style={styles.retryText}>Reintentar</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <Image
      source={{ uri: url }}
      style={styles.media}
      contentFit="contain"
      transition={150}
      onError={fail}
    />
  );
}

// Web: render image only (videos show as image placeholder).
// Do not request a signed URL until web video playback is implemented.
function StoryMedia({ story, isActive }: { story: StoryItem; isActive: boolean }) {
  if (story.mediaType === 'video') {
    return (
      <View style={[styles.media, { backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' }]}>
        <MaterialIcons name="videocam" size={52} color="rgba(255,255,255,0.4)" />
        <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 8 }}>Video (solo móvil)</Text>
      </View>
    );
  }
  return <StoryPhotoMedia story={story} isActive={isActive} />;
}

export function StoryViewer({
  visible,
  storyGroup,
  currentUserId,
  onClose,
  onMarkViewed,
  onGetViewers,
  onDeleteStory,
}: StoryViewerProps) {
  const insets = useSafeAreaInsets();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [viewersVisible, setViewersVisible] = useState(false);
  const [viewers, setViewers] = useState<StoryViewerRecord[]>([]);
  const [viewerCount, setViewerCount] = useState(0);
  const [viewersLoading, setViewersLoading] = useState(false);
  const [viewersLoadingMore, setViewersLoadingMore] = useState(false);
  const [viewersError, setViewersError] = useState(false);
  const [viewerCursor, setViewerCursor] = useState<StoryViewerCursor | null>(null);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const viewerRequestGeneration = useRef(0);

  const stories = storyGroup?.stories || [];
  const currentStory = stories[currentIndex] || null;
  const isOwnStory = Boolean(currentStory && currentStory.userId === currentUserId);

  const loadViewers = useCallback(async (
    storyId: string,
    cursor?: StoryViewerCursor,
    append = false,
  ) => {
    if (!onGetViewers) return;
    const generation = ++viewerRequestGeneration.current;
    if (append) setViewersLoadingMore(true);
    else setViewersLoading(true);
    setViewersError(false);
    setDeleteConfirmVisible(false);
    setDeletePending(false);
    setDeleteError(false);
    try {
      const page = await onGetViewers(storyId, cursor, 50);
      if (viewerRequestGeneration.current !== generation) return;
      setViewerCount(page.totalCount);
      setViewerCursor(page.nextCursor);
      setViewers(previous => {
        if (!append) return page.viewers;
        const merged = new Map(previous.map(viewer => [viewer.viewerId, viewer]));
        for (const viewer of page.viewers) merged.set(viewer.viewerId, viewer);
        return Array.from(merged.values());
      });
    } catch (_) {
      if (viewerRequestGeneration.current === generation) setViewersError(true);
    } finally {
      if (viewerRequestGeneration.current === generation) {
        setViewersLoading(false);
        setViewersLoadingMore(false);
      }
    }
  }, [onGetViewers]);

  useEffect(() => {
    viewerRequestGeneration.current += 1;
    setViewersVisible(false);
    setViewers([]);
    setViewerCount(0);
    setViewerCursor(null);
    setViewersError(false);
    if (visible && currentStory && isOwnStory && onGetViewers) {
      void loadViewers(currentStory.id);
    }
  }, [visible, currentStory?.id, isOwnStory, onGetViewers, loadViewers]);

  const startProgress = useCallback(() => {
    progressAnim.setValue(0);
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: STORY_DURATION,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) goNext();
    });
  }, [currentIndex, stories.length]);

  const stopProgress = useCallback(() => {
    progressAnim.stopAnimation();
  }, []);

  useEffect(() => {
    if (visible && currentStory) {
      startProgress();
      if (onMarkViewed) void onMarkViewed(currentStory.id);
    }
    return () => stopProgress();
  }, [visible, currentIndex]);

  useEffect(() => {
    if (!visible) { setCurrentIndex(0); stopProgress(); }
  }, [visible]);

  const goNext = useCallback(() => {
    stopProgress();
    if (currentIndex < stories.length - 1) setCurrentIndex(i => i + 1);
    else onClose();
  }, [currentIndex, stories.length]);

  const goPrev = useCallback(() => {
    stopProgress();
    if (currentIndex > 0) setCurrentIndex(i => i - 1);
  }, [currentIndex]);

  const requestDelete = useCallback(() => {
    if (!isOwnStory || !onDeleteStory || deletePending) return;
    stopProgress();
    setDeleteError(false);
    setDeleteConfirmVisible(true);
  }, [isOwnStory, onDeleteStory, deletePending, stopProgress]);

  const cancelDelete = useCallback(() => {
    if (deletePending) return;
    setDeleteConfirmVisible(false);
    setDeleteError(false);
    startProgress();
  }, [deletePending, startProgress]);

  const confirmDelete = useCallback(async () => {
    if (!currentStory || !isOwnStory || !onDeleteStory || deletePending) return;
    setDeletePending(true);
    setDeleteError(false);
    try {
      await onDeleteStory(currentStory.id);
      setDeleteConfirmVisible(false);
      onClose();
    } catch {
      setDeleteError(true);
    } finally {
      setDeletePending(false);
    }
  }, [currentStory, isOwnStory, onDeleteStory, deletePending, onClose]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 10 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => { if (g.dy > 0) translateY.setValue(g.dy); },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 100) {
          Animated.timing(translateY, { toValue: H, duration: 200, useNativeDriver: true }).start(onClose);
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  if (!storyGroup || !currentStory) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <Animated.View
        style={[styles.container, { transform: [{ translateY }] }]}
        {...panResponder.panHandlers}
      >
        <StoryMedia story={currentStory} isActive={true} />

        <LinearGradient colors={['rgba(0,0,0,0.6)', 'transparent']} style={styles.topGrad} pointerEvents="none" />
        <LinearGradient colors={['transparent', 'rgba(0,0,0,0.45)']} style={styles.botGrad} pointerEvents="none" />

        <View style={[styles.progressRow, { paddingTop: insets.top + 8 }]}>
          {stories.map((_, i) => (
            <View key={i} style={styles.progressTrack}>
              <Animated.View style={[styles.progressFill, {
                width: i < currentIndex ? '100%' : i === currentIndex
                  ? progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) : '0%',
              }]} />
            </View>
          ))}
        </View>

        <View style={[styles.header, { paddingTop: insets.top + 20 }]}>
          <Avatar uri={storyGroup.avatar} username={storyGroup.username} size={38} showBorder />
          <View style={styles.headerInfo}>
            <Text style={styles.headerUsername}>@{storyGroup.username}</Text>
            <Text style={styles.headerTime}>{timeAgo(currentStory.createdAt)}</Text>
          </View>
          {isOwnStory && onDeleteStory ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Eliminar historia"
              disabled={deletePending}
              onPress={requestDelete}
              hitSlop={10}
              style={styles.iconBtn}
            >
              <MaterialIcons name="delete-outline" size={22} color="rgba(255,255,255,0.9)" />
            </Pressable>
          ) : null}
          <Pressable onPress={onClose} hitSlop={10} style={styles.iconBtn}>
            <MaterialIcons name="close" size={24} color="#fff" />
          </Pressable>
        </View>

        <View style={styles.tapZones} pointerEvents={deleteConfirmVisible ? 'none' : 'box-none'}>
          <Pressable style={styles.tapLeft} onPress={goPrev} />
          <Pressable style={styles.tapRight} onPress={goNext} />
        </View>

        <View style={[styles.bottomRow, { paddingBottom: insets.bottom + Spacing.md }]}>
          <View style={styles.bottomLeft}>
            {isOwnStory && onGetViewers ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Ver visualizaciones: ${viewerCount}`}
                hitSlop={8}
                style={styles.viewerCountButton}
                onPress={() => setViewersVisible(true)}
              >
                <MaterialIcons name="visibility" size={18} color="rgba(255,255,255,0.9)" />
                <Text style={styles.viewerCountText}>{viewersLoading ? '…' : viewerCount}</Text>
              </Pressable>
            ) : null}
            <Text style={styles.storyCounter}>{currentIndex + 1} / {stories.length}</Text>
          </View>
          <Text style={styles.swipeHint}>Desliza para cerrar</Text>
        </View>

        <StoryViewersSheet
          visible={viewersVisible && isOwnStory}
          viewers={viewers}
          totalCount={viewerCount}
          isLoading={viewersLoading}
          isLoadingMore={viewersLoadingMore}
          hasMore={Boolean(viewerCursor) && viewers.length < viewerCount}
          error={viewersError}
          onClose={() => setViewersVisible(false)}
          onRetry={() => {
            if (currentStory) void loadViewers(currentStory.id);
          }}
          onLoadMore={() => {
            if (currentStory && viewerCursor) void loadViewers(currentStory.id, viewerCursor, true);
          }}
        />

        {deleteConfirmVisible && isOwnStory ? (
          <View style={styles.deleteOverlay}>
            <View accessibilityRole="alert" style={styles.deleteCard}>
              <Text style={styles.deleteTitle}>¿Eliminar esta historia?</Text>
              <Text style={styles.deleteMessage}>Se eliminará para todos.</Text>
              {deleteError ? (
                <Text style={styles.deleteError}>No se pudo eliminar. Inténtalo de nuevo.</Text>
              ) : null}
              <View style={styles.deleteActions}>
                <Pressable accessibilityRole="button" disabled={deletePending} onPress={cancelDelete} style={styles.deleteCancelButton}>
                  <Text style={styles.deleteCancelText}>Cancelar</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={deletePending}
                  onPress={() => void confirmDelete()}
                  style={[styles.deleteConfirmButton, deletePending && styles.deleteButtonDisabled]}
                >
                  {deletePending ? <ActivityIndicator size="small" color="#fff" /> : null}
                  <Text style={styles.deleteConfirmText}>{deletePending ? 'Eliminando…' : 'Eliminar'}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}
      </Animated.View>
    </Modal>
  );
}

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  media: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: W, height: H },
  mediaState: { alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, zIndex: 6 },
  mediaStateText: { color: 'rgba(255,255,255,0.8)', fontSize: FontSize.sm },
  retryButton: {
    borderRadius: Radius.full,
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  retryText: { color: '#fff', fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  topGrad: { position: 'absolute', top: 0, left: 0, right: 0, height: 160 },
  botGrad: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 100 },
  progressRow: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', paddingHorizontal: Spacing.sm, gap: 4, zIndex: 10,
  },
  progressTrack: {
    flex: 1, height: 2.5, backgroundColor: 'rgba(255,255,255,0.35)',
    borderRadius: 2, overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: '#fff', borderRadius: 2 },
  header: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm, gap: Spacing.sm, zIndex: 10,
  },
  headerInfo: { flex: 1 },
  headerUsername: { color: '#fff', fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  headerTime: { color: 'rgba(255,255,255,0.7)', fontSize: FontSize.xs },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  tapZones: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row', zIndex: 5 },
  tapLeft: { flex: 1 },
  tapRight: { flex: 2 },
  bottomRow: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, zIndex: 10,
  },
  bottomLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  viewerCountButton: {
    minWidth: 46,
    height: 34,
    paddingHorizontal: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  viewerCountText: { color: '#fff', fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  storyCounter: { color: 'rgba(255,255,255,0.7)', fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  swipeHint: { color: 'rgba(255,255,255,0.4)', fontSize: FontSize.xs },
  deleteOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    backgroundColor: 'rgba(0,0,0,0.66)',
  },
  deleteCard: { width: '100%', maxWidth: 340, borderRadius: Radius.lg, backgroundColor: '#1B1B20', padding: Spacing.lg },
  deleteTitle: { color: '#fff', fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  deleteMessage: { color: 'rgba(255,255,255,0.72)', fontSize: FontSize.sm, marginTop: Spacing.sm },
  deleteError: { color: '#FF6B7A', fontSize: FontSize.xs, marginTop: Spacing.sm },
  deleteActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.sm, marginTop: Spacing.lg },
  deleteCancelButton: { paddingHorizontal: Spacing.md, height: 40, justifyContent: 'center' },
  deleteCancelText: { color: 'rgba(255,255,255,0.84)', fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  deleteConfirmButton: {
    minWidth: 102,
    height: 40,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    backgroundColor: '#E5484D',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  deleteButtonDisabled: { opacity: 0.65 },
  deleteConfirmText: { color: '#fff', fontSize: FontSize.sm, fontWeight: FontWeight.bold },
});
