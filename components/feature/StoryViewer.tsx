/**
 * StoryViewer.tsx — Web stub (no expo-video, not available on web bundler)
 * The real implementation is in StoryViewer.native.tsx for iOS/Android.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, Modal, Pressable, StyleSheet, Dimensions,
  Animated, PanResponder,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/ui/Avatar';
import { Colors, FontSize, FontWeight, Spacing, Radius } from '@/constants/theme';
import type { StoryGroup, StoryItem } from './StoriesBar';

const { width: W, height: H } = Dimensions.get('window');
const STORY_DURATION = 15000;

interface StoryViewerProps {
  visible: boolean;
  storyGroup: StoryGroup | null;
  onClose: () => void;
  onMarkViewed?: (storyId: string) => void;
}

// Web: render image only (videos show as image placeholder)
function StoryMedia({ story }: { story: StoryItem; isActive: boolean }) {
  if (story.mediaType === 'video') {
    return (
      <View style={[styles.media, { backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' }]}>
        <MaterialIcons name="videocam" size={52} color="rgba(255,255,255,0.4)" />
        <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 8 }}>Video (solo móvil)</Text>
      </View>
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
  const progressAnim = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  const stories = storyGroup?.stories || [];
  const currentStory = stories[currentIndex] || null;

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
      if (onMarkViewed) onMarkViewed(currentStory.id);
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
          <Pressable onPress={onClose} hitSlop={10} style={styles.iconBtn}>
            <MaterialIcons name="close" size={24} color="#fff" />
          </Pressable>
        </View>

        <View style={styles.tapZones} pointerEvents="box-none">
          <Pressable style={styles.tapLeft} onPress={goPrev} />
          <Pressable style={styles.tapRight} onPress={goNext} />
        </View>

        <View style={[styles.bottomRow, { paddingBottom: insets.bottom + Spacing.md }]}>
          <Text style={styles.storyCounter}>{currentIndex + 1} / {stories.length}</Text>
          <Text style={styles.swipeHint}>Desliza para cerrar</Text>
        </View>
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
  storyCounter: { color: 'rgba(255,255,255,0.7)', fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  swipeHint: { color: 'rgba(255,255,255,0.4)', fontSize: FontSize.xs },
});
