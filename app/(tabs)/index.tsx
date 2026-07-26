import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, StyleSheet, FlatList, ViewToken, RefreshControl,
  Text, Pressable,
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
import { VideoCard, TAB_BAR_HEIGHT } from '@/components/feature/VideoCard';
import { CommentSheet } from '@/components/feature/CommentSheet';
import { DAGRewardToast } from '@/components/feature/DAGRewardToast';
import { StoriesBar } from '@/components/feature/StoriesBar';
import { StoryViewer } from '@/components/feature/StoryViewer';
import { Colors, FontWeight } from '@/constants/theme';
import { PostCardSkeleton, FadeIn } from '@/components/ui/SkeletonLoader';
import { uploadFileFromUri } from '@/contexts/FeedContext';
import { useRouter, useFocusEffect } from 'expo-router';
import { Audio } from 'expo-av';
import { useScrollToTop } from '@react-navigation/native';
import type { StoryGroup } from '@/components/feature/StoriesBar';
import type { VideoWithMeta } from '@/contexts/FeedContext';
import { deleteMediaAsset, uploadMediaFromUri } from '@/services/mediaService';

const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 75 };

export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, toggleFollow, isFollowing } = useAuth();
  const {
    videos, isLiked, isSaved, toggleLike, toggleSave,
    addComment, loadMoreVideos, refreshFeed,
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
  const [initialLoaded, setInitialLoaded] = useState(false);

  // Ensure AVAudioSession is in playback mode whenever the feed is visible.
  // DeepAR (Creator Studio) sets AVAudioSessionCategoryPlayAndRecord, which
  // causes AVPlayer (expo-video) to fail with AVErrorNoPermissionToPlay.
  // Resetting to playback mode on focus fixes this without touching native code.
  useFocusEffect(useCallback(() => {
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
    }).catch(() => {});
  }, []));

  useEffect(() => {
    if (videos.length > 0 && !initialLoaded) {
      setInitialLoaded(true);
    }
  }, [videos.length, initialLoaded]);

  // Ref for scroll-to-top on Home tab press
  const feedListRef = useRef<FlatList<VideoWithMeta>>(null);
  useScrollToTop(feedListRef);

  // Top bar height: safe area + 52px content
  const TOP_BAR_HEIGHT = insets.top + 52;

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const fullyVisible = viewableItems.find(t => t.isViewable && t.index !== null);
    if (fullyVisible && fullyVisible.index !== null) {
      setActiveIndex(fullyVisible.index);
    }
  });
  const viewabilityConfig = useRef(VIEWABILITY_CONFIG);

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
    let uploadedAssetId: string | undefined;
    let persistedStoryId: string | undefined;
    let failureStage = 'STORY_UPLOAD';

    try {
      if (!isVideo) {
        const uploaded = await uploadMediaFromUri({
          uri: asset.uri,
          purpose: 'post_image',
          mimeType,
          fileName: asset.fileName || undefined,
          sizeBytes: asset.fileSize,
          visibility: 'public',
        });
        if (!uploaded.url?.startsWith('https://')) throw new Error('R2 did not return a public URL');
        uploadedAssetId = uploaded.assetId;
        failureStage = 'STORY_INSERT';
        persistedStoryId = await addStory(uploaded.url, 'photo', false, uploaded.assetId);
        if (!persistedStoryId) throw new Error('Story was not persisted');
        uploadedAssetId = undefined;
        showAlert('Historia publicada!', 'Tu historia estará visible por 24 horas');
        return;
      }
      const publicUrl = await uploadFileFromUri(
        supabase,
        asset.uri,
        bucket,
        fileName,
        mimeType,
        asset.base64,
      );
      if (!publicUrl?.startsWith('https://')) throw new Error('STORY_UPLOAD_FAILED');
      failureStage = 'STORY_INSERT';
      persistedStoryId = await addStory(publicUrl, 'video', false);
      if (!persistedStoryId) throw new Error('STORY_INSERT_FAILED');
      showAlert('Historia publicada!', 'Tu historia estará visible por 24 horas');
    } catch (error) {
      console.warn('[Feed] story publish failed', {
        stage: failureStage,
        code: error instanceof Error ? error.message : 'unknown',
      });
      if (persistedStoryId && uploadedAssetId) {
        await supabase.from('stories').delete().eq('id', persistedStoryId).eq('user_id', user.id);
      }
      if (uploadedAssetId) await deleteMediaAsset(uploadedAssetId).catch(() => {});
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

  const feedHeader = (
    <View style={styles.feedHeader}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8, height: TOP_BAR_HEIGHT }]}>
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
        <View style={styles.topBarRight}>
          <Pressable style={styles.topBarBtn} onPress={() => router.push('/messages')} hitSlop={8}>
            <MaterialCommunityIcons name="message-text-outline" size={22} color="rgba(255,255,255,0.85)" />
          </Pressable>
          <Pressable style={styles.topBarBtn} onPress={() => router.push('/settings')} hitSlop={8}>
            <MaterialCommunityIcons name="cog-outline" size={22} color="rgba(255,255,255,0.85)" />
          </Pressable>
        </View>
      </View>
      <FadeIn delay={120} duration={280}>
        <StoriesBar
          currentUserId={user?.id || ''}
          currentUserAvatar={user?.avatar}
          currentUsername={user?.username}
          storyGroups={storyGroups}
          onAddStory={handleAddStory}
          onViewStory={handleViewStory}
        />
      </FadeIn>
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <FlatList
        ref={feedListRef}
        data={videos}
        keyExtractor={item => item.id}
        style={styles.feedList}
        ListHeaderComponent={feedHeader}
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
          />
        }
        ListEmptyComponent={
          isLoadingFeed && !initialLoaded ? (
            <>
              <PostCardSkeleton />
              <PostCardSkeleton />
            </>
          ) : null
        }
      />

      <DAGRewardToast visible={toastVisible} amount={0.01} onHide={() => setToastVisible(false)} />

      <CommentSheet
        visible={commentVideoId !== null}
        onClose={() => setCommentVideoId(null)}
        videoId={commentVideoId}
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
        userId={user?.id}
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  feedList: { flex: 1 },

  feedHeader: {
    backgroundColor: Colors.bg,
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
