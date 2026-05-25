import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, Modal, Pressable, StyleSheet, Dimensions,
  Animated, PanResponder,
} from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/Avatar';
import { Colors, FontSize, FontWeight, Spacing, Radius } from '@/constants/theme';
import type { StoryGroup, StoryItem } from './StoriesBar';

const { width: W, height: H } = Dimensions.get('window');
const STORY_DURATION = 15000; // 15 seconds

interface StoryViewerProps {
  visible: boolean;
  storyGroup: StoryGroup | null;
  onClose: () => void;
  onMarkViewed?: (storyId: string) => void;
}

function StoryMedia({ story, isActive }: { story: StoryItem; isActive: boolean }) {
  const isVideo = story.mediaType === 'video';
  const player = useVideoPlayer(isVideo ? story.mediaUrl : '', p => {
    p.loop = false;
    p.muted = false;
  });

  useEffect(() => {
    if (!isVideo) return;
    try {
      if (isActive) {
        player.play();
      } else {
        player.pause();
        player.currentTime = 0;
      }
    } catch (_) {}
  }, [isActive, isVideo]);

  if (isVideo) {
    return (
      <VideoView
        player={player}
        style={styles.media}
        contentFit="contain"
        nativeControls={false}
      />
    );
  }
  return (
    <Image
      source={{ uri: story.mediaUrl }}
      style={styles.media}
      contentFit="contain"
      transition={150}
    />
  );
}

export function StoryViewer({ visible, storyGroup, onClose, onMarkViewed }: StoryViewerProps) {
  const insets = useSafeAreaInsets();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const translateY = useRef(new Animated.Value(0)).current;

  const stories = storyGroup?.stories || [];
  const currentStory = stories[currentIndex] || null;

  // Start progress bar animation for current story
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
    if (progressTimer.current) clearTimeout(progressTimer.current);
  }, []);

  useEffect(() => {
    if (visible && currentStory) {
      startProgress();
      if (onMarkViewed) onMarkViewed(currentStory.id);
    }
    return () => stopProgress();
  }, [visible, currentIndex]);

  useEffect(() => {
    if (!visible) {
      setCurrentIndex(0);
      stopProgress();
    }
  }, [visible]);

  const goNext = useCallback(() => {
    stopProgress();
    if (currentIndex < stories.length - 1) {
      setCurrentIndex(i => i + 1);
    } else {
      onClose();
    }
  }, [currentIndex, stories.length]);

  const goPrev = useCallback(() => {
    stopProgress();
    if (currentIndex > 0) {
      setCurrentIndex(i => i - 1);
    }
  }, [currentIndex]);

  // Swipe down to close
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 10 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
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
        {/* Story media */}
        <StoryMedia story={currentStory} isActive={true} />

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
          <Pressable onPress={() => setIsMuted(m => !m)} hitSlop={10} style={styles.iconBtn}>
            <MaterialIcons
              name={isMuted ? 'volume-off' : 'volume-up'}
              size={22}
              color="rgba(255,255,255,0.9)"
            />
          </Pressable>
          <Pressable onPress={onClose} hitSlop={10} style={styles.iconBtn}>
            <MaterialIcons name="close" size={24} color="#fff" />
          </Pressable>
        </View>

        {/* Tap zones: left = prev, right = next */}
        <View style={styles.tapZones} pointerEvents="box-none">
          <Pressable style={styles.tapLeft} onPress={goPrev} />
          <Pressable style={styles.tapRight} onPress={goNext} />
        </View>

        {/* Media type badge */}
        <View style={styles.mediaBadge} pointerEvents="none">
          <MaterialIcons
            name={currentStory.mediaType === 'video' ? 'videocam' : 'photo'}
            size={13}
            color={currentStory.mediaType === 'video' ? Colors.secondary : Colors.primary}
          />
        </View>

        {/* Bottom: story index */}
        <View style={[styles.bottomRow, { paddingBottom: insets.bottom + Spacing.md }]}>
          <Text style={styles.storyCounter}>{currentIndex + 1} / {stories.length}</Text>
          <Text style={styles.swipeHint}>Desliza para cerrar</Text>
        </View>
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
    width: W,
    height: H,
  },
  topGrad: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: 160,
  },
  botGrad: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: 100,
  },
  progressRow: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    flexDirection: 'row',
    paddingHorizontal: Spacing.sm,
    gap: 4,
    zIndex: 10,
  },
  progressTrack: {
    flex: 1,
    height: 2.5,
    backgroundColor: 'rgba(255,255,255,0.35)',
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
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
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
  mediaBadge: {
    position: 'absolute',
    bottom: 80,
    right: Spacing.md,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: Radius.full,
    padding: 6,
    zIndex: 10,
  },
  bottomRow: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    zIndex: 10,
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
});
