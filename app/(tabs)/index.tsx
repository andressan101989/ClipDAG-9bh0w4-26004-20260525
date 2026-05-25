import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, StyleSheet, FlatList, Dimensions, ViewToken, RefreshControl,
  Text, Pressable, Animated, Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/hooks/useAuth';
import { useFeed } from '@/hooks/useFeed';
import { useStories } from '@/hooks/useStories';
import { useNotifications } from '@/hooks/useNotifications';
import { useAlert } from '@/template';
import { getSupabaseClient } from '@/template';
import { VideoCard, TAB_BAR_HEIGHT, STORIES_BAR_HEIGHT } from '@/components/feature/VideoCard';
import { CommentSheet } from '@/components/feature/CommentSheet';
import { DAGRewardToast } from '@/components/feature/DAGRewardToast';
import { StoriesBar } from '@/components/feature/StoriesBar';
import { StoryViewer } from '@/components/feature/StoryViewer';
import { Colors, FontWeight } from '@/constants/theme';
import { base64ToUint8Array } from '@/contexts/FeedContext';
import { useRouter } from 'expo-router';
import { useScrollToTop } from '@react-navigation/native';
import type { StoryGroup } from '@/components/feature/StoriesBar';
import type { VideoWithMeta } from '@/contexts/FeedContext';

function isVideoReel(video: VideoWithMeta): boolean {
  const url = video.videoUrl || '';
  if (!url) return false;
  const clean = url.split('?')[0].toLowerCase();
  if (
    clean.includes('gtv-videos-bucket') ||
    clean.includes('commondatastorage.googleapis.com') ||
    clean.includes('/videos/')
  ) return true;
  const ext = clean.split('.').pop() || '';
  return ['mp4', 'mov', 'avi', 'mkv', 'webm', 'quicktime', 'm4v'].includes(ext);
}

function isCarousel(video: VideoWithMeta): boolean {
  return Array.isArray((video as any).mediaUrls) && (video as any).mediaUrls.length > 1;
}

// Height of the fixed top header
const { height: WINDOW_HEIGHT } = Dimensions.get('window');

// Defined outside component — static reference prevents re-evaluation on every render.
// React Native Web's VirtualizedList requires exactly one of these two keys.
const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 75 };

export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, toggleFollow, isFollowing } = useAuth();
  const {
    videos, isLiked, isSaved, toggleLike, toggleSave,
    getComments, addComment, loadMoreVideos, refreshFeed,
    isLoadingFeed, trackView, sendGift,
  } = useFeed();
  const { storyGroups, addStory, markStoryViewed } = useStories();
  const { unreadCount: notifCount } = useNotifications();
  const { showAlert } = useAlert();
  const supabase = getSupabaseClient();

  const [activeIndex, setActiveIndex] = useState(0);
  const [commentVideoId, setCommentVideoId] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [viewingStoryGroup, setViewingStoryGroup] = useState<StoryGroup | null>(null);
  const [storyViewerVisible, setStoryViewerVisible] = useState(false);

  // Ref for scroll-to-top on Home tab press
  const feedListRef = useRef<FlatList<VideoWithMeta>>(null);
  useScrollToTop(feedListRef);

  // Top bar height: safe area + 52px content
  const TOP_BAR_HEIGHT = insets.top + 52;
  // Stories bar sits directly below top bar
  const HEADER_TOTAL_HEIGHT = TOP_BAR_HEIGHT + STORIES_BAR_HEIGHT;

  // Animated opacity: fades header + stories completely for video reels
  const headerOpacity = useRef(new Animated.Value(1)).current;
  const activeIsReel = useRef(false);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const fullyVisible = viewableItems.find(t => t.isViewable && t.index !== null);
    if (fullyVisible && fullyVisible.index !== null) {
      setActiveIndex(fullyVisible.index);
    }
  });
  const viewabilityConfig = useRef(VIEWABILITY_CONFIG);

  // Fade header based on active item type
  useEffect(() => {
    const v = videos[activeIndex];
    if (!v) return;
    const isReel = isVideoReel(v) && !isCarousel(v);
    if (isReel === activeIsReel.current) return;
    activeIsReel.current = isReel;
    Animated.timing(headerOpacity, {
      toValue: isReel ? 0 : 1,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [activeIndex, videos]);

  const handleLike = useCallback(async (videoId: string, creatorId: string) => {
    const wasLiked = isLiked(videoId);
    await toggleLike(videoId, creatorId);
    if (!wasLiked && creatorId !== user?.id) {
      setToastVisible(true);
    }
  }, [toggleLike, isLiked, user]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await refreshFeed();
    setIsRefreshing(false);
  }, [refreshFeed]);

  const handleSave = useCallback((videoId: string) => { toggleSave(videoId); }, [toggleSave]);

  const handleViewTracked = useCallback((videoId: string, durationMs: number, completed: boolean) => {
    trackView(videoId, durationMs, completed);
  }, [trackView]);

  // Story upload
  const uploadStory = useCallback(async (asset: ImagePicker.ImagePickerAsset) => {
    if (!user) return;
    const isVideo = asset.type === 'video';
    const ext = isVideo ? 'mp4' : 'jpg';
    const bucket = isVideo ? 'videos' : 'images';
    const fileName = `${user.id}/story_${Date.now()}.${ext}`;
    const mimeType = asset.mimeType || (isVideo ? 'video/mp4' : 'image/jpeg');

    try {
      if (asset.base64) {
        const bytes = base64ToUint8Array(asset.base64);
        const { error } = await supabase.storage.from(bucket).upload(fileName, bytes, { contentType: mimeType, upsert: false });
        if (error) { showAlert('Error', 'No se pudo subir la historia'); return; }
        const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(fileName);
        await addStory(publicUrl, isVideo ? 'video' : 'photo');
      } else {
        await addStory(asset.uri, isVideo ? 'video' : 'photo');
      }
      showAlert('Historia publicada!', 'Tu historia estará visible por 24 horas');
    } catch (_) {
      showAlert('Error', 'No se pudo publicar la historia');
    }
  }, [user, supabase, addStory, showAlert]);

  const handleAddStory = useCallback(() => {
    showAlert('Agregar Historia', 'Cómo quieres crear tu historia?', [
      {
        text: 'Cámara',
        onPress: async () => {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) { showAlert('Permiso denegado', 'Habilita la cámara en ajustes'); return; }
          const result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.All, allowsEditing: true, aspect: [9, 16], quality: 0.8, base64: true, videoMaxDuration: 15 });
          if (!result.canceled && result.assets[0]) await uploadStory(result.assets[0]);
        },
      },
      {
        text: 'Galería',
        onPress: async () => {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!perm.granted) { showAlert('Permiso denegado', 'Habilita la galería en ajustes'); return; }
          const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.All, allowsEditing: true, aspect: [9, 16], quality: 0.8, base64: true, videoMaxDuration: 15 });
          if (!result.canceled && result.assets[0]) await uploadStory(result.assets[0]);
        },
      },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  }, [showAlert, uploadStory]);

  const handleViewStory = useCallback((group: StoryGroup) => {
    setViewingStoryGroup(group);
    setStoryViewerVisible(true);
  }, []);

  const currentComments = commentVideoId ? getComments(commentVideoId) : [];

  // For image/carousel posts: add padding so first item clears the fixed header
  // For video reels: no top padding (full screen behind header which fades out)
  const getItemLayout = useCallback((_: any, index: number) => {
    return { length: WINDOW_HEIGHT, offset: WINDOW_HEIGHT * index, index };
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* ── Feed ── fills the full screen; image posts get top padding via ListHeaderComponent */}
      <FlatList
        ref={feedListRef}
        data={videos}
        keyExtractor={item => item.id}
        style={styles.feedList}
        // Spacer so the first non-reel item starts below the fixed header overlay
        ListHeaderComponent={<View style={styles.feedTopSpacer} />}
        contentContainerStyle={styles.feedContent}
        renderItem={({ item, index }) => (
          <VideoCard
            video={item}
            isActive={index === activeIndex}
            isLiked={isLiked(item.id)}
            isSaved={isSaved(item.id)}
            isFollowing={isFollowing(item.userId)}
            currentUserDagBalance={user?.dagBalance || 0}
            currentUserId={user?.id || ''}
            onLike={() => handleLike(item.id, item.userId)}
            onComment={() => setCommentVideoId(item.id)}
            onFollow={() => toggleFollow(item.userId)}
            onSave={() => handleSave(item.id)}
            onProfilePress={() => {}}
            onSendGift={sendGift}
            onViewTracked={(durationMs, completed) => handleViewTracked(item.id, durationMs, completed)}
          />
        )}
        showsVerticalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged.current}
        viewabilityConfig={viewabilityConfig.current}
        onEndReached={loadMoreVideos}
        onEndReachedThreshold={0.5}
        removeClippedSubviews
        maxToRenderPerBatch={3}
        windowSize={5}
        decelerationRate="normal"
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={Colors.primary}
            colors={[Colors.primary]}
            progressViewOffset={HEADER_TOTAL_HEIGHT}
          />
        }
      />

      {/* ── Fixed top overlay: header + stories (fades out during reel) ── */}
      <Animated.View
        style={[styles.topOverlay, { opacity: headerOpacity }]}
        pointerEvents="box-none"
      >
        {/* Gradient backing so header is readable over any content */}
        <LinearGradient
          colors={['rgba(10,10,15,0.92)', 'rgba(10,10,15,0.6)', 'transparent']}
          style={[StyleSheet.absoluteFillObject]}
          pointerEvents="none"
        />

        {/* Top bar */}
        <View style={[styles.topBar, { paddingTop: insets.top + 8, height: TOP_BAR_HEIGHT }]}>
          {/* ClipDAG Brand Logo */}
          <View style={styles.logoWrap}>
            <LinearGradient
              colors={['#7C5CFF', '#FF2D78']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={styles.logoGrad}
            >
              <Text style={styles.logoClip}>Clip</Text>
            </LinearGradient>
            <Text style={styles.logoDAG}>DAG</Text>
          </View>

          {/* Right actions */}
          <View style={styles.topBarRight}>
            <Pressable
              style={styles.topBarBtn}
              onPress={() => router.push('/messages')}
              hitSlop={8}
            >
              <MaterialCommunityIcons name="message-text-outline" size={22} color="rgba(255,255,255,0.85)" />
            </Pressable>
            <Pressable
              style={styles.topBarBtn}
              onPress={() => router.push('/settings')}
              hitSlop={8}
            >
              <MaterialCommunityIcons name="cog-outline" size={22} color="rgba(255,255,255,0.85)" />
            </Pressable>
          </View>
        </View>

        {/* Stories bar — sits directly below top bar */}
        <View pointerEvents="box-none">
          <StoriesBar
            currentUserId={user?.id || ''}
            currentUserAvatar={user?.avatar}
            currentUsername={user?.username}
            storyGroups={storyGroups}
            onAddStory={handleAddStory}
            onViewStory={handleViewStory}
          />
        </View>
      </Animated.View>

      <DAGRewardToast visible={toastVisible} amount={0.01} onHide={() => setToastVisible(false)} />

      <CommentSheet
        visible={commentVideoId !== null}
        onClose={() => setCommentVideoId(null)}
        comments={currentComments}
        onSubmit={(text) => {
          if (commentVideoId && user) {
            addComment(commentVideoId, {
              userId: user.id,
              username: user.username,
              avatar: user.avatar || '',
              text,
            });
          }
        }}
        userAvatar={user?.avatar}
        username={user?.username}
      />

      <StoryViewer
        visible={storyViewerVisible}
        storyGroup={viewingStoryGroup}
        onClose={() => { setStoryViewerVisible(false); setViewingStoryGroup(null); }}
        onMarkViewed={markStoryViewed}
      />
    </View>
  );
}

// The spacer pushes the first list item (image/carousel posts) below the fixed header.
// For video reels the header fades to 0 opacity so they appear fullscreen.
const FEED_TOP_SPACER = 160; // TOP_BAR_HEIGHT (~52+safeArea) + STORIES_BAR_HEIGHT (~100)

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  feedList: { flex: 1 },
  feedContent: {},

  // Pushes first item below fixed overlay — height matches HEADER_TOTAL_HEIGHT
  feedTopSpacer: { height: FEED_TOP_SPACER },

  // Fixed top overlay — does NOT scroll with the list
  topOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    zIndex: 20,
  },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },

  // ClipDAG Brand Logo
  logoWrap: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  logoGrad: {
    borderRadius: 7, paddingHorizontal: 8, paddingVertical: 3,
  },
  logoClip: {
    color: '#fff', fontSize: 17, fontWeight: FontWeight.extrabold,
    letterSpacing: -0.5,
  },
  logoDAG: {
    color: '#fff', fontSize: 17, fontWeight: FontWeight.extrabold,
    letterSpacing: -0.5,
  },

  topBarRight: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  topBarBtn: { padding: 8, borderRadius: 20 },
});
