import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, Pressable, StyleSheet, FlatList,
  Dimensions, ActivityIndicator, ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { useFeed } from '@/hooks/useFeed';
import { useAlert } from '@/template';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { formatNumber } from '@/services/mockData';
import type { VideoWithMeta } from '@/contexts/FeedContext';

const { width: SCREEN_W } = Dimensions.get('window');
const GRID_GAP = 2;
const THUMB_SIZE = (SCREEN_W - GRID_GAP * 2) / 3;

type ContentTab = 'posts' | 'reels' | 'saved' | 'stories' | 'drafts';

const TAB_CONFIG: { key: ContentTab; icon: string; label: string }[] = [
  { key: 'posts', icon: 'grid', label: 'Publicaciones' },
  { key: 'reels', icon: 'play-box-multiple-outline', label: 'Reels' },
  { key: 'saved', icon: 'bookmark-outline', label: 'Guardados' },
  { key: 'stories', icon: 'circle-outline', label: 'Historias' },
  { key: 'drafts', icon: 'file-outline', label: 'Borradores' },
];

// ── Sort options ───────────────────────────────────────────────────────────────
type SortBy = 'newest' | 'oldest' | 'most_liked' | 'most_viewed';

interface ContentItemProps {
  video: VideoWithMeta;
  onPress: (video: VideoWithMeta) => void;
  onLongPress: (video: VideoWithMeta) => void;
}

const ContentItem = React.memo(function ContentItem({ video, onPress, onLongPress }: ContentItemProps) {
  const isVideo = !!(video.videoUrl?.match(/\.(mp4|mov|avi|mkv|webm)$/i) ||
    video.videoUrl?.includes('gtv-videos-bucket') ||
    video.videoUrl?.includes('/videos/'));
  const isCarousel = Array.isArray((video as any).mediaUrls) && (video as any).mediaUrls.length > 1;

  const imgSrc = video.thumbnailUrl?.startsWith('http')
    ? { uri: video.thumbnailUrl }
    : video.videoUrl?.startsWith('http')
      ? { uri: video.videoUrl }
      : { uri: `https://api.dicebear.com/7.x/shapes/svg?seed=${video.id}` };

  return (
    <Pressable
      style={styles.gridItem}
      onPress={() => onPress(video)}
      onLongPress={() => onLongPress(video)}
    >
      <Image source={imgSrc} style={styles.gridThumb} contentFit="cover" transition={150} />
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.78)']}
        style={styles.gridOverlay}
      >
        <View style={styles.gridStats}>
          <MaterialIcons name="favorite" size={10} color={Colors.secondary} />
          <Text style={styles.gridStatText}>{formatNumber(video.likes || 0)}</Text>
        </View>
      </LinearGradient>
      {/* Type badge */}
      <View style={styles.typeBadge}>
        {isCarousel ? (
          <MaterialCommunityIcons name="image-multiple-outline" size={10} color="#fff" />
        ) : isVideo ? (
          <MaterialCommunityIcons name="play" size={10} color="#fff" />
        ) : (
          <MaterialIcons name="photo" size={10} color="#fff" />
        )}
      </View>
    </Pressable>
  );
});

export default function MyContentScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { videos, savedVideoIds, deleteVideo } = useFeed();
  const { showAlert } = useAlert();

  const [activeTab, setActiveTab] = useState<ContentTab>('posts');
  const [sortBy, setSortBy] = useState<SortBy>('newest');
  const [isDeleting, setIsDeleting] = useState(false);

  const myVideos = useMemo(() => videos.filter(v => v.userId === user?.id), [videos, user?.id]);
  const savedVideos = useMemo(() => videos.filter(v => savedVideoIds.has(v.id)), [videos, savedVideoIds]);

  const myReels = useMemo(() => myVideos.filter(v => {
    const url = v.videoUrl || '';
    return url.match(/\.(mp4|mov|avi|mkv|webm)$/i) ||
      url.includes('gtv-videos-bucket') ||
      url.includes('/videos/');
  }), [myVideos]);

  const myPosts = useMemo(() => myVideos.filter(v => {
    const url = v.videoUrl || '';
    const isCarousel = Array.isArray((v as any).mediaUrls) && (v as any).mediaUrls.length > 1;
    const isVid = url.match(/\.(mp4|mov|avi|mkv|webm)$/i) ||
      url.includes('gtv-videos-bucket') || url.includes('/videos/');
    return !isVid || isCarousel;
  }), [myVideos]);

  const sortedItems = useCallback((items: VideoWithMeta[]) => {
    return [...items].sort((a, b) => {
      switch (sortBy) {
        case 'newest': return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
        case 'oldest': return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
        case 'most_liked': return (b.likes || 0) - (a.likes || 0);
        case 'most_viewed': return (b.viewsCount || 0) - (a.viewsCount || 0);
        default: return 0;
      }
    });
  }, [sortBy]);

  const currentItems: VideoWithMeta[] = useMemo(() => {
    switch (activeTab) {
      case 'posts': return sortedItems(myPosts);
      case 'reels': return sortedItems(myReels);
      case 'saved': return sortedItems(savedVideos);
      case 'stories': return [];
      case 'drafts': return [];
      default: return [];
    }
  }, [activeTab, myPosts, myReels, savedVideos, sortedItems]);

  const totalLikes = useMemo(() => myVideos.reduce((s, v) => s + (v.likes || 0), 0), [myVideos]);
  const totalViews = useMemo(() => myVideos.reduce((s, v) => s + (v.viewsCount || 0), 0), [myVideos]);

  const handleItemPress = useCallback((video: VideoWithMeta) => {
    showAlert(
      `@${video.username}`,
      video.caption || 'Sin descripcion',
      [
        {
          text: 'Ver Analytics',
          onPress: () => showAlert('Analytics', `Likes: ${formatNumber(video.likes || 0)}\nVistas: ${formatNumber(video.viewsCount || 0)}\nComentarios: ${formatNumber(video.comments || 0)}`),
        },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => handleDelete(video),
        },
        { text: 'Cancelar', style: 'cancel' },
      ]
    );
  }, [showAlert]);

  const handleItemLongPress = useCallback((video: VideoWithMeta) => {
    handleItemPress(video);
  }, [handleItemPress]);

  const handleDelete = useCallback(async (video: VideoWithMeta) => {
    showAlert('Eliminar publicacion', 'Esta accion es permanente.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          setIsDeleting(true);
          const result = await deleteVideo(video.id, video.videoUrl, video.thumbnailUrl);
          setIsDeleting(false);
          if (result.success) showAlert('Eliminado', 'Tu publicacion fue eliminada');
          else showAlert('Error', result.error || 'No se pudo eliminar');
        },
      },
    ]);
  }, [deleteVideo, showAlert]);

  const handleSort = useCallback(() => {
    const options: { text: string; key: SortBy }[] = [
      { text: 'Mas reciente', key: 'newest' },
      { text: 'Mas antiguo', key: 'oldest' },
      { text: 'Mas likes', key: 'most_liked' },
      { text: 'Mas vistas', key: 'most_viewed' },
    ];
    showAlert('Ordenar por', '', [
      ...options.map(o => ({ text: o.text, onPress: () => setSortBy(o.key) })),
      { text: 'Cancelar', style: 'cancel' as const },
    ]);
  }, [showAlert]);

  const renderItem = useCallback(({ item }: { item: VideoWithMeta }) => (
    <ContentItem video={item} onPress={handleItemPress} onLongPress={handleItemLongPress} />
  ), [handleItemPress, handleItemLongPress]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <MaterialIcons name="arrow-back" size={24} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Mis Contenidos</Text>
        <Pressable onPress={handleSort} style={styles.sortBtn} hitSlop={8}>
          <MaterialCommunityIcons name="sort-variant" size={22} color={Colors.textSecondary} />
        </Pressable>
      </View>

      {/* Stats strip */}
      <View style={styles.statsStrip}>
        <View style={styles.statBox}>
          <Text style={styles.statVal}>{formatNumber(myVideos.length)}</Text>
          <Text style={styles.statLbl}>Publicaciones</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Text style={styles.statVal}>{formatNumber(totalLikes)}</Text>
          <Text style={styles.statLbl}>Total Likes</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Text style={styles.statVal}>{formatNumber(totalViews)}</Text>
          <Text style={styles.statLbl}>Total Vistas</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Text style={[styles.statVal, { color: Colors.primary }]}>
            {(totalLikes * 0.01).toFixed(2)}
          </Text>
          <Text style={styles.statLbl}>$DAG Ganados</Text>
        </View>
      </View>

      {/* Content tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsScroll}
        contentContainerStyle={styles.tabsContent}
      >
        {TAB_CONFIG.map(t => {
          const count = t.key === 'posts' ? myPosts.length
            : t.key === 'reels' ? myReels.length
            : t.key === 'saved' ? savedVideos.length
            : 0;
          return (
            <Pressable
              key={t.key}
              style={[styles.tab, activeTab === t.key && styles.tabActive]}
              onPress={() => setActiveTab(t.key)}
            >
              <MaterialCommunityIcons
                name={t.icon as any}
                size={16}
                color={activeTab === t.key ? '#fff' : Colors.textSubtle}
              />
              <Text style={[styles.tabLabel, activeTab === t.key && styles.tabLabelActive]}>
                {t.label}
              </Text>
              {count > 0 ? (
                <View style={[styles.tabBadge, activeTab === t.key && styles.tabBadgeActive]}>
                  <Text style={styles.tabBadgeText}>{count}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Content grid */}
      {isDeleting ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.primary} size="large" />
          <Text style={styles.loadingText}>Eliminando...</Text>
        </View>
      ) : currentItems.length === 0 ? (
        <View style={styles.emptyState}>
          <LinearGradient
            colors={['rgba(124,92,255,0.12)', 'rgba(255,45,120,0.08)']}
            style={styles.emptyIcon}
          >
            <MaterialCommunityIcons
              name={activeTab === 'saved' ? 'bookmark-outline' : activeTab === 'drafts' ? 'file-outline' : 'video-plus-outline'}
              size={40}
              color={Colors.primary}
            />
          </LinearGradient>
          <Text style={styles.emptyTitle}>
            {activeTab === 'saved' ? 'Sin guardados'
              : activeTab === 'drafts' ? 'Sin borradores'
              : activeTab === 'stories' ? 'Sin historias'
              : 'Sin publicaciones'}
          </Text>
          <Text style={styles.emptySub}>
            {activeTab === 'saved' ? 'Guarda contenido de otros creadores'
              : 'Crea y sube tu primer contenido'}
          </Text>
          {activeTab !== 'saved' && activeTab !== 'drafts' && activeTab !== 'stories' ? (
            <Pressable
              style={styles.createBtn}
              onPress={() => router.push('/(tabs)/upload')}
            >
              <LinearGradient
                colors={['#7C5CFF', '#FF2D78']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.createBtnGrad}
              >
                <MaterialCommunityIcons name="plus" size={16} color="#fff" />
                <Text style={styles.createBtnText}>Crear contenido</Text>
              </LinearGradient>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <FlatList
          data={currentItems}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          numColumns={3}
          columnWrapperStyle={styles.row}
          contentContainerStyle={{ paddingBottom: 80 + insets.bottom }}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          maxToRenderPerBatch={12}
          windowSize={5}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  loadingText: { color: Colors.textSubtle, fontSize: FontSize.sm },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  sortBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  // Stats
  statsStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceElevated,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.md,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statBox: { flex: 1, alignItems: 'center', gap: 2 },
  statVal: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  statLbl: { color: Colors.textSubtle, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.3 },
  statDivider: { width: 1, height: 28, backgroundColor: Colors.border },

  // Tabs
  tabsScroll: { maxHeight: 48, marginBottom: Spacing.xs },
  tabsContent: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tabActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  tabLabel: { color: Colors.textSubtle, fontSize: FontSize.xs, fontWeight: FontWeight.medium },
  tabLabelActive: { color: '#fff', fontWeight: FontWeight.semibold },
  tabBadge: {
    backgroundColor: Colors.border,
    borderRadius: Radius.full,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  tabBadgeActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
  tabBadgeText: { color: '#fff', fontSize: 9, fontWeight: FontWeight.bold },

  // Grid
  row: { gap: GRID_GAP },
  gridItem: {
    width: THUMB_SIZE,
    height: THUMB_SIZE * 1.25,
    backgroundColor: Colors.surface,
    position: 'relative',
  },
  gridThumb: { ...StyleSheet.absoluteFillObject },
  gridOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 5, justifyContent: 'flex-end',
    height: '50%',
  },
  gridStats: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  gridStatText: { color: '#fff', fontSize: 10, fontWeight: FontWeight.semibold },
  typeBadge: {
    position: 'absolute', top: 4, right: 4,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },

  // Empty state
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    padding: Spacing.xl,
  },
  emptyIcon: {
    width: 80, height: 80, borderRadius: Radius.xl,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { color: Colors.textSecondary, fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  emptySub: { color: Colors.textSubtle, fontSize: FontSize.sm, textAlign: 'center' },
  createBtn: { borderRadius: Radius.full, overflow: 'hidden', marginTop: Spacing.sm },
  createBtnGrad: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: Spacing.lg, paddingVertical: 12,
  },
  createBtnText: { color: '#fff', fontSize: FontSize.sm, fontWeight: FontWeight.bold },
});
