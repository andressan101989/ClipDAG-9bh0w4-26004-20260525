import React, { useState } from 'react';
import {
  View, Text, ScrollView, Pressable, FlatList,
  TextInput, StyleSheet,
} from 'react-native';
import { Image } from '@/components/ui/SafeImage';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Avatar } from '@/components/ui/Avatar';
import { useAuth } from '@/hooks/useAuth';
import { useAlert } from '@/template';
import { useWallet } from '@/hooks/useWallet';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import {
  SAMPLE_VIDEOS, SEARCH_TAGS, MOCK_LIVE_STREAMS, MOCK_CREATORS,
  formatNumber, LiveStream, Creator,
} from '@/services/mockData';
import { LiveViewerSheet } from '@/components/feature/LiveViewerSheet';

type Tab = 'discover' | 'live' | 'creators';

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const { isFollowing, toggleFollow } = useAuth();
  const { addReward } = useWallet() ?? {};
  const { showAlert } = useAlert();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('discover');
  const [selectedStream, setSelectedStream] = useState<LiveStream | null>(null);
  const [liveSheetVisible, setLiveSheetVisible] = useState(false);

  const filteredVideos = query.trim()
    ? SAMPLE_VIDEOS.filter(v =>
        v.caption.toLowerCase().includes(query.toLowerCase()) ||
        v.username.toLowerCase().includes(query.toLowerCase())
      )
    : SAMPLE_VIDEOS;

  const handleJoinLive = (stream: LiveStream) => {
    setSelectedStream(stream);
    setLiveSheetVisible(true);
  };

  const handleSendTip = (amount: number) => {
    addReward?.(amount, `Tip enviado a @${selectedStream?.username}`);
    showAlert(
      'Tip enviado!',
      `Enviaste ${amount} $DAG a @${selectedStream?.username}. El creador lo recibira en su billetera.`
    );
  };

  const handleFollowCreator = (creator: Creator) => {
    toggleFollow(creator.id);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Descubrir</Text>
      </View>

      {/* Search bar */}
      <View style={styles.searchBar}>
        <MaterialIcons name="search" size={20} color={Colors.textSubtle} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Buscar videos, creadores, tags..."
          placeholderTextColor={Colors.textSubtle}
          autoCorrect={false}
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <MaterialIcons name="close" size={18} color={Colors.textSubtle} />
          </Pressable>
        ) : null}
      </View>

      {/* Tabs */}
      {!query ? (
        <View style={styles.tabBar}>
          {(['discover', 'live', 'creators'] as Tab[]).map(t => (
            <Pressable
              key={t}
              style={[styles.tabBtn, tab === t && styles.tabBtnActive]}
              onPress={() => setTab(t)}
            >
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                {t === 'discover' ? 'Populares' : t === 'live' ? '🔴 En Vivo' : 'Creadores'}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 120 + insets.bottom }]}
      >
        {query ? (
          /* Search results */
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Resultados para "{query}"</Text>
            {filteredVideos.map(video => (
              <Pressable
                key={video.id}
                style={({ pressed }) => [styles.resultCard, pressed && { opacity: 0.8 }]}
              >
                <Image
                  source={{ uri: video.thumbnailUrl }}
                  style={styles.resultThumb}
                  contentFit="cover"
                  transition={200}
                />
                <View style={styles.resultInfo}>
                  <Text style={styles.resultUser}>@{video.username}</Text>
                  <Text style={styles.resultCaption} numberOfLines={2}>{video.caption}</Text>
                  <Text style={styles.resultLikes}>❤ {formatNumber(video.likes)}</Text>
                </View>
              </Pressable>
            ))}
            {filteredVideos.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyIcon}>🔍</Text>
                <Text style={styles.emptyText}>No se encontraron resultados</Text>
              </View>
            ) : null}
          </View>
        ) : tab === 'discover' ? (
          <>
            {/* Trending Tags */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Trending Tags</Text>
              <View style={styles.tagsGrid}>
                {SEARCH_TAGS.map(tag => (
                  <Pressable
                    key={tag}
                    style={({ pressed }) => [styles.tag, pressed && { opacity: 0.7 }]}
                    onPress={() => setQuery(tag)}
                  >
                    <LinearGradient
                      colors={['rgba(0,212,255,0.12)', 'rgba(0,102,255,0.08)']}
                      style={styles.tagGradient}
                    >
                      <Text style={styles.tagText}>{tag}</Text>
                    </LinearGradient>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Popular Videos Grid */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Videos Populares</Text>
              <View style={styles.videoGrid}>
                {SAMPLE_VIDEOS.map(video => (
                  <Pressable
                    key={video.id}
                    style={({ pressed }) => [styles.videoThumb, pressed && { opacity: 0.8 }]}
                  >
                    <Image
                      source={{ uri: video.thumbnailUrl }}
                      style={styles.thumbImage}
                      contentFit="cover"
                      transition={200}
                    />
                    <LinearGradient
                      colors={['transparent', 'rgba(0,0,0,0.75)']}
                      style={styles.thumbOverlay}
                    >
                      <MaterialIcons name="play-arrow" size={16} color="#fff" />
                      <Text style={styles.thumbLikes}>{formatNumber(video.likes)}</Text>
                    </LinearGradient>
                  </Pressable>
                ))}
              </View>
            </View>
          </>
        ) : tab === 'live' ? (
          /* Live Streams */
          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <View style={styles.liveDot} />
              <Text style={styles.sectionTitle}>Streams en Vivo</Text>
            </View>
            {MOCK_LIVE_STREAMS.map(stream => (
              <Pressable
                key={stream.id}
                style={({ pressed }) => [styles.liveCard, pressed && { opacity: 0.85 }]}
                onPress={() => handleJoinLive(stream)}
              >
                <View style={styles.liveThumbnailWrap}>
                  <Image
                    source={{ uri: stream.thumbnailUrl }}
                    style={styles.liveThumbnail}
                    contentFit="cover"
                    transition={200}
                  />
                  <LinearGradient
                    colors={['transparent', 'rgba(0,0,0,0.7)']}
                    style={StyleSheet.absoluteFillObject}
                  />
                  <View style={styles.liveBadge}>
                    <View style={styles.liveDotSmall} />
                    <Text style={styles.liveBadgeText}>EN VIVO</Text>
                  </View>
                  <View style={styles.liveViewers}>
                    <MaterialIcons name="visibility" size={12} color="#fff" />
                    <Text style={styles.liveViewersText}>{formatNumber(stream.viewers)}</Text>
                  </View>
                  {/* Join button overlay */}
                  <View style={styles.joinOverlay}>
                    <View style={styles.joinBtn}>
                      <MaterialIcons name="play-arrow" size={16} color="#fff" />
                      <Text style={styles.joinBtnText}>Unirse</Text>
                    </View>
                  </View>
                </View>
                <View style={styles.liveInfo}>
                  <View style={styles.liveUser}>
                    <Avatar uri={stream.userAvatar} username={stream.username} size={32} showBorder />
                    <Text style={styles.liveUsername}>@{stream.username}</Text>
                  </View>
                  <Text style={styles.liveTitle} numberOfLines={2}>{stream.title}</Text>
                  <View style={styles.liveDagRow}>
                    <Text style={styles.liveDagIcon}>◈</Text>
                    <Text style={styles.liveDagText}>{stream.dagEarned.toFixed(1)} $DAG ganados</Text>
                  </View>
                </View>
              </Pressable>
            ))}
          </View>
        ) : (
          /* Creators */
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Top Creadores $DAG</Text>
            {MOCK_CREATORS.map((creator, idx) => (
              <View key={creator.id} style={styles.creatorCard}>
                <Text style={styles.creatorRank}>#{idx + 1}</Text>
                <Avatar uri={creator.avatar} username={creator.username} size={52} showBorder />
                <View style={styles.creatorInfo}>
                  <Text style={styles.creatorName}>@{creator.username}</Text>
                  <Text style={styles.creatorFollowers}>{formatNumber(creator.followers)} seguidores</Text>
                  <View style={styles.creatorDagRow}>
                    <Text style={styles.creatorDagIcon}>◈</Text>
                    <Text style={styles.creatorDagText}>{formatNumber(creator.dagEarned)} $DAG</Text>
                  </View>
                </View>
                <Pressable
                  style={({ pressed }) => [
                    styles.followBtn,
                    isFollowing(creator.id) && styles.followBtnActive,
                    pressed && { opacity: 0.75 },
                  ]}
                  onPress={() => handleFollowCreator(creator)}
                >
                  <MaterialIcons
                    name={isFollowing(creator.id) ? 'check' : 'person-add'}
                    size={14}
                    color={isFollowing(creator.id) ? Colors.textSecondary : '#fff'}
                  />
                  <Text style={[
                    styles.followBtnText,
                    isFollowing(creator.id) && styles.followBtnTextActive,
                  ]}>
                    {isFollowing(creator.id) ? 'Siguiendo' : 'Seguir'}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Live viewer sheet */}
      <LiveViewerSheet
        visible={liveSheetVisible}
        stream={selectedStream}
        onClose={() => setLiveSheetVisible(false)}
        onSendTip={handleSendTip}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: { paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm },
  headerTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.border, height: 48,
  },
  searchInput: { flex: 1, color: Colors.textPrimary, fontSize: FontSize.md },
  tabBar: {
    flexDirection: 'row', marginHorizontal: Spacing.md, marginBottom: Spacing.md,
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md,
    padding: 3, borderWidth: 1, borderColor: Colors.border,
  },
  tabBtn: { flex: 1, paddingVertical: Spacing.sm, alignItems: 'center', borderRadius: Radius.sm },
  tabBtnActive: { backgroundColor: Colors.primary },
  tabText: { color: Colors.textSubtle, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  tabTextActive: { color: '#fff' },
  scrollContent: { padding: Spacing.md, gap: Spacing.xl },
  section: { gap: Spacing.md },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.textPrimary },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  tagsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tag: { borderRadius: Radius.full, overflow: 'hidden' },
  tagGradient: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
    borderRadius: Radius.full, borderWidth: 1, borderColor: 'rgba(0,212,255,0.3)',
  },
  tagText: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  videoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  videoThumb: { width: '31.5%', aspectRatio: 9 / 16, borderRadius: Radius.sm, overflow: 'hidden' },
  thumbImage: { width: '100%', height: '100%' },
  thumbOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: Spacing.xs, flexDirection: 'row', alignItems: 'center', gap: 2,
  },
  thumbLikes: { color: '#fff', fontSize: FontSize.xs },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.error },
  liveCard: {
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.lg,
    overflow: 'hidden', borderWidth: 1, borderColor: Colors.border,
  },
  liveThumbnailWrap: { height: 160, position: 'relative' },
  liveThumbnail: { width: '100%', height: '100%' },
  liveBadge: {
    position: 'absolute', top: Spacing.sm, left: Spacing.sm,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.error, borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 3,
  },
  liveDotSmall: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  liveBadgeText: { color: '#fff', fontSize: 11, fontWeight: FontWeight.bold },
  liveViewers: {
    position: 'absolute', top: Spacing.sm, right: Spacing.sm,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: 3,
  },
  liveViewersText: { color: '#fff', fontSize: 11 },
  joinOverlay: {
    position: 'absolute', bottom: Spacing.sm, right: Spacing.sm,
  },
  joinBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm, paddingVertical: 5,
  },
  joinBtnText: { color: '#fff', fontSize: 12, fontWeight: FontWeight.semibold },
  liveInfo: { padding: Spacing.md, gap: Spacing.sm },
  liveUser: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  liveUsername: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  liveTitle: { color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 18 },
  liveDagRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  liveDagIcon: { color: Colors.primary, fontSize: 13 },
  liveDagText: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  creatorCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.border,
  },
  creatorRank: {
    color: Colors.textSubtle, fontSize: FontSize.md,
    fontWeight: FontWeight.bold, width: 24, textAlign: 'center',
  },
  creatorInfo: { flex: 1 },
  creatorName: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  creatorFollowers: { color: Colors.textSubtle, fontSize: FontSize.xs },
  creatorDagRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  creatorDagIcon: { color: Colors.primary, fontSize: 12 },
  creatorDagText: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  followBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    minWidth: 88,
  },
  followBtnActive: {
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  followBtnText: { color: '#fff', fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  followBtnTextActive: { color: Colors.textSecondary },
  resultCard: {
    flexDirection: 'row', gap: Spacing.md, backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.md, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border,
  },
  resultThumb: { width: 80, height: 100 },
  resultInfo: {
    flex: 1, padding: Spacing.sm, justifyContent: 'center', gap: Spacing.xs,
  },
  resultUser: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  resultCaption: { color: Colors.textPrimary, fontSize: FontSize.sm },
  resultLikes: { color: Colors.textSubtle, fontSize: FontSize.xs },
  emptyState: {
    alignItems: 'center', paddingVertical: Spacing.xxl, gap: Spacing.sm,
  },
  emptyIcon: { fontSize: 40 },
  emptyText: { color: Colors.textSubtle, fontSize: FontSize.md },
});
