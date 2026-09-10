import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import {
  View, Text, Modal, Pressable, StyleSheet, useWindowDimensions,
  ActivityIndicator, Animated, PanResponder, AppState, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Image } from 'expo-image';
// expo-video — lazy-loaded to prevent Hermes crash from dynamic import() syntax
// bundled into main.jsbundle. Static import of expo-video causes:
//   "Invalid expression encountered" at line ~110k in main.jsbundle
let VideoView: any = null;
let _useVideoPlayer: any = (_src: any, _setup?: any): any => null;
try {
  const ev = require('expo-video');
  VideoView       = ev.VideoView      ?? null;
  _useVideoPlayer = ev.useVideoPlayer ?? ((_src: any, _setup?: any) => null);
} catch { /* web / preview */ }
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Avatar } from '@/components/ui/Avatar';
import { Colors, FontSize, FontWeight, Spacing, Radius } from '@/constants/theme';
import type { StoryGroup, StoryItem } from './StoriesBar';
import { useStoryMediaUrl } from './useStoryMediaUrl';
import { StoryViewersSheet } from './StoryViewersSheet';
import { StoryInteractions } from './StoryInteractions';
import { StoryCompositionOverlay } from './storyComposition';
import { StorySharedContentCard } from './StorySharedContentCard';
import { StoryReactionEffect } from './StoryReactionEffect';
import type { StoryReactionKey } from './storyReactions';
import type {
  StoryReactionCursor,
  StoryReactionRecord,
  StoryReactionsPage,
  StoryViewerCursor,
  StoryDeleteResult,
  StoryViewerRecord,
  StoryViewersPage,
  StorySharedContent,
} from '@/contexts/StoriesContext';

const PHOTO_DURATION_MS = 15000;
const HOLD_DELAY_MS = 220;

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
  onSetReaction?: (storyId: string, reaction: StoryReactionKey | null) => Promise<void>;
  onGetReactions?: (
    storyId: string,
    cursor?: StoryReactionCursor,
    limit?: number,
  ) => Promise<StoryReactionsPage>;
  onReplyToStory?: (storyId: string, text: string, clientMessageId: string) => Promise<void>;
  onGetSharedContent?: (storyId: string) => Promise<StorySharedContent>;
}

interface ReadyStoryVideoProps {
  url: string;
  storyId: string;
  isActive: boolean;
  shouldPause: boolean;
  isMuted: boolean;
  restartToken: number;
  onReadyChange: (ready: boolean) => void;
  onProgress: (progress: number) => void;
  onEnd: (storyId: string) => void;
  onError: () => void;
}

function ReadyStoryVideo({
  url,
  storyId,
  isActive,
  shouldPause,
  isMuted,
  restartToken,
  onReadyChange,
  onProgress,
  onEnd,
  onError,
}: ReadyStoryVideoProps) {
  const [isReady, setIsReady] = useState(false);
  const durationRef = useRef(0);
  const player = _useVideoPlayer(url, (p: any) => {
    p.loop = false;
    p.muted = isMuted;
    p.staysActiveInBackground = false;
    p.timeUpdateEventInterval = 0.25;
  });

  useEffect(() => {
    try {
      player.muted = isMuted;
    } catch {}
  }, [isMuted, player]);

  useEffect(() => {
    try {
      if (isActive && isReady && !shouldPause) {
        player.play();
      } else {
        player.pause();
      }
    } catch {}
  }, [isActive, isReady, player, shouldPause]);

  useEffect(() => {
    const statusSubscription = player?.addListener?.('statusChange', ({ status }: { status?: string }) => {
      const ready = status === 'readyToPlay';
      setIsReady(ready);
      onReadyChange(ready);
      if (status === 'error') onError();
    });
    const sourceSubscription = player?.addListener?.('sourceLoad', ({ duration }: { duration?: number }) => {
      durationRef.current = Number.isFinite(duration) && Number(duration) > 0
        ? Number(duration)
        : Number(player?.duration ?? 0);
    });
    const timeSubscription = player?.addListener?.('timeUpdate', ({ currentTime }: { currentTime?: number }) => {
      const duration = durationRef.current || Number(player?.duration ?? 0);
      if (duration > 0 && Number.isFinite(currentTime)) {
        onProgress(Math.max(0, Math.min(1, Number(currentTime) / duration)));
      }
    });
    const endSubscription = player?.addListener?.('playToEnd', () => onEnd(storyId));
    const ready = player?.status === 'readyToPlay';
    durationRef.current = Number(player?.duration ?? 0);
    setIsReady(ready);
    onReadyChange(ready);
    return () => {
      statusSubscription?.remove?.();
      sourceSubscription?.remove?.();
      timeSubscription?.remove?.();
      endSubscription?.remove?.();
      try { player?.pause?.(); } catch {}
      onReadyChange(false);
    };
  }, [onEnd, onError, onProgress, onReadyChange, player, storyId]);

  useEffect(() => {
    try {
      player.currentTime = 0;
      onProgress(0);
      if (isActive && isReady && !shouldPause) player.play();
    } catch {}
    // restartToken is the only restart authority; playback state changes must not seek to zero.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restartToken]);

  return (
    <VideoView
      player={player}
      style={styles.media}
      contentFit="contain"
      nativeControls={false}
    />
  );
}

interface StoryMediaProps {
  story: StoryItem;
  isActive: boolean;
  shouldPause: boolean;
  isMuted: boolean;
  restartToken: number;
  onReadyChange: (storyId: string, ready: boolean) => void;
  onProgress: (storyId: string, progress: number) => void;
  onVideoEnd: (storyId: string) => void;
  onReset: () => void;
}

function StoryMedia({
  story,
  isActive,
  shouldPause,
  isMuted,
  restartToken,
  onReadyChange,
  onProgress,
  onVideoEnd,
  onReset,
}: StoryMediaProps) {
  const { url, isLoading, hasError, retry, fail } = useStoryMediaUrl(story, isActive);

  const failMedia = useCallback(() => {
    onReadyChange(story.id, false);
    fail();
  }, [fail, onReadyChange, story.id]);

  const retryMedia = useCallback(() => {
    onReset();
    onReadyChange(story.id, false);
    retry();
  }, [onReadyChange, onReset, retry, story.id]);

  const handleVideoReadyChange = useCallback((ready: boolean) => {
    onReadyChange(story.id, ready);
  }, [onReadyChange, story.id]);

  const handleVideoProgress = useCallback((progress: number) => {
    onProgress(story.id, progress);
  }, [onProgress, story.id]);

  if (isLoading) {
    return <View style={[styles.media, styles.mediaState]}><ActivityIndicator color="#fff" /></View>;
  }

  if (hasError || !url) {
    return (
      <View style={[styles.media, styles.mediaState]}>
        <Text style={styles.mediaStateText}>Historia no disponible.</Text>
        <Pressable accessibilityRole="button" onPress={retryMedia} style={styles.retryButton}>
          <Text style={styles.retryText}>Reintentar</Text>
        </Pressable>
      </View>
    );
  }

  if (story.mediaType === 'video') {
    return (
      <ReadyStoryVideo
        key={url}
        url={url}
        storyId={story.id}
        isActive={isActive}
        shouldPause={shouldPause}
        isMuted={isMuted}
        restartToken={restartToken}
        onReadyChange={handleVideoReadyChange}
        onProgress={handleVideoProgress}
        onEnd={onVideoEnd}
        onError={failMedia}
      />
    );
  }
  return (
    <Image
      source={{ uri: url }}
      style={styles.media}
      contentFit="contain"
      transition={150}
      onLoad={() => onReadyChange(story.id, true)}
      onError={failMedia}
    />
  );
}

export function StoryViewer({
  visible,
  storyGroup,
  currentUserId,
  onClose,
  onMarkViewed,
  onGetViewers,
  onDeleteStory,
  onSetReaction,
  onGetReactions,
  onReplyToStory,
  onGetSharedContent,
}: StoryViewerProps) {
  const insets = useSafeAreaInsets();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const router = useRouter();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);
  const [manualHold, setManualHold] = useState(false);
  const [restartToken, setRestartToken] = useState(0);
  const [appState, setAppState] = useState(AppState.currentState);
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
  const [interactionFocused, setInteractionFocused] = useState(false);
  const [reactionPending, setReactionPending] = useState(false);
  const [reactions, setReactions] = useState<StoryReactionRecord[]>([]);
  const [reactionCount, setReactionCount] = useState(0);
  const [reactionsLoading, setReactionsLoading] = useState(false);
  const [reactionsLoadingMore, setReactionsLoadingMore] = useState(false);
  const [reactionsError, setReactionsError] = useState(false);
  const [reactionCursor, setReactionCursor] = useState<StoryReactionCursor | null>(null);
  const [reactionEffect, setReactionEffect] = useState<{
    reaction: StoryReactionKey | null;
    token: number;
  }>({ reaction: null, token: 0 });
  const progressAnim = useRef(new Animated.Value(0)).current;
  const photoProgressRef = useRef(0);
  const translateY = useRef(new Animated.Value(0)).current;
  const viewerRequestGeneration = useRef(0);
  const reactionRequestGeneration = useRef(0);
  const playbackGeneration = useRef(0);
  const transitionLock = useRef(false);
  const holdTriggered = useRef(false);
  const viewportHeightRef = useRef(viewportHeight);
  viewportHeightRef.current = viewportHeight;

  const stories = storyGroup?.stories || [];
  const currentStory = stories[currentIndex] || null;
  const currentStoryId = currentStory?.id;
  const currentMediaType = currentStory?.mediaType;
  const isOwnStory = Boolean(currentStory && currentStory.userId === currentUserId);
  const currentStoryIdRef = useRef<string | null>(null);
  currentStoryIdRef.current = currentStoryId ?? null;
  const shouldPausePlayback = !visible
    || manualHold
    || viewersVisible
    || deleteConfirmVisible
    || deletePending
    || interactionFocused
    || reactionPending
    || appState !== 'active'
    || !mediaReady;

  useEffect(() => {
    if (visible && storyGroup && currentIndex >= stories.length) onClose();
  }, [currentIndex, onClose, stories.length, storyGroup, visible]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

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
    } catch {
      if (viewerRequestGeneration.current === generation) setViewersError(true);
    } finally {
      if (viewerRequestGeneration.current === generation) {
        setViewersLoading(false);
        setViewersLoadingMore(false);
      }
    }
  }, [onGetViewers]);

  const loadReactions = useCallback(async (
    storyId: string,
    cursor?: StoryReactionCursor,
    append = false,
  ) => {
    if (!onGetReactions) return;
    const generation = ++reactionRequestGeneration.current;
    if (append) setReactionsLoadingMore(true);
    else setReactionsLoading(true);
    setReactionsError(false);
    try {
      const page = await onGetReactions(storyId, cursor, 50);
      if (reactionRequestGeneration.current !== generation) return;
      setReactionCount(page.totalCount);
      setReactionCursor(page.nextCursor);
      setReactions(previous => {
        if (!append) return page.reactions;
        const merged = new Map(previous.map(reaction => [reaction.reactorId, reaction]));
        for (const reaction of page.reactions) merged.set(reaction.reactorId, reaction);
        return Array.from(merged.values());
      });
    } catch {
      if (reactionRequestGeneration.current === generation) setReactionsError(true);
    } finally {
      if (reactionRequestGeneration.current === generation) {
        setReactionsLoading(false);
        setReactionsLoadingMore(false);
      }
    }
  }, [onGetReactions]);

  useEffect(() => {
    viewerRequestGeneration.current += 1;
    setViewersVisible(false);
    setViewers([]);
    setViewerCount(0);
    setViewerCursor(null);
    setViewersError(false);
    reactionRequestGeneration.current += 1;
    setReactions([]);
    setReactionCount(0);
    setReactionCursor(null);
    setReactionsError(false);
    if (visible && currentStoryId && isOwnStory && onGetViewers) {
      void loadViewers(currentStoryId);
    }
    if (visible && currentStoryId && isOwnStory && onGetReactions) {
      void loadReactions(currentStoryId);
    }
  }, [visible, currentStoryId, isOwnStory, onGetViewers, onGetReactions, loadViewers, loadReactions]);

  const stopPhotoProgress = useCallback((capture = true) => {
    progressAnim.stopAnimation(value => {
      if (capture && Number.isFinite(value)) {
        photoProgressRef.current = Math.max(0, Math.min(1, value));
      }
    });
  }, [progressAnim]);

  const resetProgress = useCallback(() => {
    stopPhotoProgress(false);
    photoProgressRef.current = 0;
    progressAnim.setValue(0);
  }, [progressAnim, stopPhotoProgress]);

  const closeViewer = useCallback(() => {
    if (transitionLock.current) return;
    transitionLock.current = true;
    stopPhotoProgress();
    onClose();
  }, [onClose, stopPhotoProgress]);

  const goNext = useCallback((sourceStoryId?: string, sourceGeneration?: number) => {
    if (sourceStoryId && sourceStoryId !== currentStoryIdRef.current) return;
    if (sourceGeneration !== undefined && sourceGeneration !== playbackGeneration.current) return;
    if (transitionLock.current) return;
    transitionLock.current = true;
    resetProgress();
    if (currentIndex < stories.length - 1) {
      setCurrentIndex(index => index + 1);
    } else {
      onClose();
    }
  }, [currentIndex, onClose, resetProgress, stories.length]);

  const restartCurrentStory = useCallback(() => {
    resetProgress();
    setRestartToken(token => token + 1);
    transitionLock.current = false;
  }, [resetProgress]);

  const goPrev = useCallback(() => {
    if (transitionLock.current) return;
    transitionLock.current = true;
    resetProgress();
    if (currentIndex > 0) {
      setCurrentIndex(index => index - 1);
    } else {
      restartCurrentStory();
    }
  }, [currentIndex, resetProgress, restartCurrentStory]);

  const handleMediaReadyChange = useCallback((storyId: string, ready: boolean) => {
    if (currentStoryIdRef.current === storyId) setMediaReady(ready);
  }, []);

  const handleVideoProgress = useCallback((storyId: string, progress: number) => {
    if (currentStoryIdRef.current !== storyId) return;
    progressAnim.setValue(Math.max(0, Math.min(1, progress)));
  }, [progressAnim]);

  const handleVideoEnd = useCallback((storyId: string) => {
    goNext(storyId, playbackGeneration.current);
  }, [goNext]);

  const handleMediaReset = useCallback(() => {
    resetProgress();
    setMediaReady(false);
  }, [resetProgress]);

  const handleSharedReadyChange = useCallback((ready: boolean) => {
    if (currentStoryId) handleMediaReadyChange(currentStoryId, ready);
  }, [currentStoryId, handleMediaReadyChange]);

  const openSharedContent = useCallback((videoId: string) => {
    if (transitionLock.current) return;
    transitionLock.current = true;
    stopPhotoProgress();
    onClose();
    router.push(`/video/${videoId}` as never);
  }, [onClose, router, stopPhotoProgress]);

  useLayoutEffect(() => {
    playbackGeneration.current += 1;
    transitionLock.current = false;
    setManualHold(false);
    setInteractionFocused(false);
    setMediaReady(false);
    setReactionEffect(current => ({ reaction: null, token: current.token + 1 }));
    resetProgress();
    return () => stopPhotoProgress(false);
  }, [currentStoryId, resetProgress, stopPhotoProgress, visible]);

  useEffect(() => {
    if (visible && currentStoryId && onMarkViewed) void onMarkViewed(currentStoryId);
  }, [currentStoryId, onMarkViewed, visible]);

  useEffect(() => {
    if (!currentStoryId || currentMediaType !== 'photo' || shouldPausePlayback) {
      stopPhotoProgress();
      return;
    }
    const storyId = currentStoryId;
    const generation = playbackGeneration.current;
    const currentProgress = photoProgressRef.current;
    progressAnim.setValue(currentProgress);
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: Math.max(0, PHOTO_DURATION_MS * (1 - currentProgress)),
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) goNext(storyId, generation);
    });
    return () => stopPhotoProgress();
  }, [currentMediaType, currentStoryId, goNext, progressAnim, restartToken, shouldPausePlayback, stopPhotoProgress]);

  useEffect(() => {
    if (!visible) {
      setCurrentIndex(0);
      setIsMuted(false);
      setManualHold(false);
      setInteractionFocused(false);
      setViewersVisible(false);
      setDeleteConfirmVisible(false);
      resetProgress();
      transitionLock.current = false;
    }
  }, [resetProgress, visible]);

  const selectReaction = useCallback(async (reaction: StoryReactionKey | null) => {
    if (!currentStory || isOwnStory || !onSetReaction || reactionPending) return;
    setReactionPending(true);
    try {
      await onSetReaction(currentStory.id, reaction);
    } catch {
      // StoriesContext restores the last persisted selection.
    } finally {
      setReactionPending(false);
    }
  }, [currentStory, isOwnStory, onSetReaction, reactionPending]);

  const triggerReactionEffect = useCallback((reaction: StoryReactionKey) => {
    setReactionEffect(current => ({ reaction, token: current.token + 1 }));
  }, []);

  const sendReply = useCallback(async (text: string, clientMessageId: string) => {
    if (!currentStory || isOwnStory || !onReplyToStory) throw new Error('STORY_REPLY_UNAVAILABLE');
    await onReplyToStory(currentStory.id, text, clientMessageId);
  }, [currentStory, isOwnStory, onReplyToStory]);

  const requestDelete = useCallback(() => {
    if (!isOwnStory || !onDeleteStory || deletePending) return;
    setDeleteError(false);
    setDeleteConfirmVisible(true);
  }, [isOwnStory, onDeleteStory, deletePending]);

  const cancelDelete = useCallback(() => {
    if (deletePending) return;
    setDeleteConfirmVisible(false);
    setDeleteError(false);
  }, [deletePending]);

  const confirmDelete = useCallback(async () => {
    if (!currentStory || !isOwnStory || !onDeleteStory || deletePending) return;
    setDeletePending(true);
    setDeleteError(false);
    try {
      await onDeleteStory(currentStory.id);
      setDeleteConfirmVisible(false);
      transitionLock.current = true;
      stopPhotoProgress();
      onClose();
    } catch (_) {
      void _;
      setDeleteError(true);
    } finally {
      setDeletePending(false);
    }
  }, [currentStory, isOwnStory, onClose, onDeleteStory, deletePending, stopPhotoProgress]);

  const handlePressIn = useCallback(() => {
    holdTriggered.current = false;
  }, []);

  const handleLongPress = useCallback(() => {
    holdTriggered.current = true;
    setManualHold(true);
  }, []);

  const handlePressOut = useCallback(() => {
    if (holdTriggered.current) setManualHold(false);
  }, []);

  const handleZonePress = useCallback((direction: 'prev' | 'next') => {
    if (holdTriggered.current) {
      holdTriggered.current = false;
      return;
    }
    if (direction === 'prev') goPrev();
    else goNext();
  }, [goNext, goPrev]);

  // Swipe down to close
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 10 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 100) {
          Animated.timing(translateY, {
            toValue: viewportHeightRef.current,
            duration: 200,
            useNativeDriver: true,
          }).start(closeViewer);
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
      onRequestClose={closeViewer}
    >
      <Animated.View
        style={[styles.container, { transform: [{ translateY }] }]}
        {...panResponder.panHandlers}
      >
        {/* Story media */}
        {currentStory.storyKind === 'shared' && onGetSharedContent ? (
          <View style={styles.sharedContentLayer} pointerEvents="box-none">
            <StorySharedContentCard
              storyId={currentStory.id}
              load={onGetSharedContent}
              onReadyChange={handleSharedReadyChange}
              onOpen={openSharedContent}
            />
          </View>
        ) : (
          <StoryMedia
            story={currentStory}
            isActive={visible}
            shouldPause={shouldPausePlayback}
            isMuted={isMuted}
            restartToken={restartToken}
            onReadyChange={handleMediaReadyChange}
            onProgress={handleVideoProgress}
            onVideoEnd={handleVideoEnd}
            onReset={handleMediaReset}
          />
        )}
        <StoryCompositionOverlay composition={currentStory.composition} width={viewportWidth} height={viewportHeight} />

        <StoryReactionEffect
          reaction={reactionEffect.reaction}
          effectToken={reactionEffect.token}
        />

        {/* Dark gradient top/bottom */}
        <LinearGradient
          colors={['rgba(0,0,0,0.6)', 'transparent']}
          style={styles.topGrad}
          pointerEvents="none"
        />
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.45)']}
          style={styles.botGrad}
          pointerEvents="none"
        />

        {/* Progress bars */}
        <View style={[styles.progressRow, { paddingTop: insets.top + 8 }]}>
          {stories.map((_, i) => (
            <View key={i} style={styles.progressTrack}>
              <Animated.View
                style={[
                  styles.progressFill,
                  {
                    width: i < currentIndex
                      ? '100%'
                      : i === currentIndex
                        ? progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] })
                        : '0%',
                  },
                ]}
              />
            </View>
          ))}
        </View>

        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 20 }]}>
          <Avatar uri={storyGroup.avatar} username={storyGroup.username} size={38} showBorder />
          <View style={styles.headerInfo}>
            <Text style={styles.headerUsername}>@{storyGroup.username}</Text>
            <Text style={styles.headerTime}>
              {timeAgo(currentStory.createdAt)}
            </Text>
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
          {currentStory.storyKind === 'media' && currentStory.mediaType === 'video' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isMuted ? 'Activar sonido' : 'Silenciar video'}
              onPress={() => setIsMuted(muted => !muted)}
              hitSlop={10}
              style={styles.iconBtn}
            >
              <MaterialIcons
                name={isMuted ? 'volume-off' : 'volume-up'}
                size={22}
                color="rgba(255,255,255,0.9)"
              />
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cerrar historia"
            onPress={closeViewer}
            hitSlop={10}
            style={styles.iconBtn}
          >
            <MaterialIcons name="close" size={24} color="#fff" />
          </Pressable>
        </View>

        {/* Tap zones: left = prev, right = next */}
        <View style={styles.tapZones} pointerEvents={deleteConfirmVisible || viewersVisible ? 'none' : 'box-none'}>
          <Pressable
            style={styles.tapLeft}
            delayLongPress={HOLD_DELAY_MS}
            onPressIn={handlePressIn}
            onLongPress={handleLongPress}
            onPressOut={handlePressOut}
            onPress={() => handleZonePress('prev')}
          />
          <Pressable
            style={styles.tapRight}
            delayLongPress={HOLD_DELAY_MS}
            onPressIn={handlePressIn}
            onLongPress={handleLongPress}
            onPressOut={handlePressOut}
            onPress={() => handleZonePress('next')}
          />
        </View>

        {!isOwnStory && onSetReaction && onReplyToStory ? (
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            pointerEvents="box-none"
            style={[styles.interactionsContainer, { paddingBottom: Math.max(insets.bottom, Spacing.sm) }]}
          >
            <StoryInteractions
              key={currentStory.id}
              username={storyGroup.username}
              selectedReaction={currentStory.viewerReaction ?? null}
              reactionPending={reactionPending}
              onReaction={selectReaction}
              onReactionEffect={triggerReactionEffect}
              onReply={sendReply}
              onFocusChange={setInteractionFocused}
            />
          </KeyboardAvoidingView>
        ) : null}

        {/* Bottom: owner controls / story index */}
        {isOwnStory ? <View style={[styles.bottomRow, { paddingBottom: insets.bottom + Spacing.md }]}>
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
        </View> : null}

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
          reactions={reactions}
          reactionCount={reactionCount}
          reactionsLoading={reactionsLoading}
          reactionsLoadingMore={reactionsLoadingMore}
          reactionsHasMore={Boolean(reactionCursor) && reactions.length < reactionCount}
          reactionsError={reactionsError}
          onReactionsRetry={() => {
            if (currentStory) void loadReactions(currentStory.id);
          }}
          onReactionsLoadMore={() => {
            if (currentStory && reactionCursor) void loadReactions(currentStory.id, reactionCursor, true);
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
                <Pressable
                  accessibilityRole="button"
                  disabled={deletePending}
                  onPress={cancelDelete}
                  style={styles.deleteCancelButton}
                >
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
  const date = new Date(dateStr);
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  media: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
  },
  mediaState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    zIndex: 6,
  },
  mediaStateText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: FontSize.sm,
  },
  retryButton: {
    borderRadius: Radius.full,
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  retryText: {
    color: '#fff',
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
  topGrad: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 184,
  },
  botGrad: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: 196,
  },
  progressRow: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    flexDirection: 'row',
    paddingHorizontal: Spacing.md,
    gap: 3,
    zIndex: 10,
  },
  progressTrack: {
    flex: 1,
    height: 2.5,
    backgroundColor: 'rgba(255,255,255,0.28)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#fff',
    borderRadius: 2,
  },
  header: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
    gap: Spacing.sm,
    zIndex: 10,
  },
  headerInfo: { flex: 1 },
  headerUsername: {
    color: '#fff',
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
  },
  headerTime: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: FontSize.xs,
  },
  iconBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
    backgroundColor: 'rgba(10,10,15,0.24)',
  },
  tapZones: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    flexDirection: 'row',
    zIndex: 5,
  },
  tapLeft: {
    flex: 1,
  },
  tapRight: {
    flex: 2,
  },
  bottomRow: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    zIndex: 10,
  },
  sharedContentLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 6,
  },
  interactionsContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(10,10,15,0.38)',
  },
  bottomLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  viewerCountButton: {
    minWidth: 46,
    height: 44,
    paddingHorizontal: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: Radius.full,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  viewerCountText: {
    color: '#fff',
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
  storyCounter: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
  },
  swipeHint: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: FontSize.xs,
  },
  deleteOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    backgroundColor: 'rgba(0,0,0,0.66)',
  },
  deleteCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: Radius.lg,
    backgroundColor: '#1B1B20',
    padding: Spacing.lg,
  },
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
