import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable,
  TextInput, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Image } from '@/components/ui/SafeImage';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Avatar } from '@/components/ui/Avatar';
import { useAuth } from '@/hooks/useAuth';
import { getSupabaseClient } from '@/template';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { formatNumber } from '@/services/mockData';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';

// 'live' tab intentionally removed — it previously showed MOCK_LIVE_STREAMS.
// There's no `live_sessions`/`live_messages` table on the current Supabase
// project (aewwdlvbwpczqyvkwvvj) to back it with real data yet. Re-add once
// that table is migrated — see app/live/broadcast/[streamId].tsx for the
// existing live_sessions schema this would query.
type Tab = 'discover' | 'creators';
type SearchTab = 'users' | 'videos';

const RECENT_KEY = 'recent_searches';
const MAX_RECENT = 5;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const FALLBACK_TAGS = [
  '#BlockDAG', '#Web3', '#Crypto', '#NFT', '#DeFi', '#ClipDAG',
  '#EarnCrypto', '#BlockchainLife', '#CryptoCreator', '#DAG',
];

interface DbUser {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  followers_count: number;
}

interface DbVideo {
  id: string;
  user_id: string;
  caption: string;
  thumbnail_url: string | null;
  likes_count: number;
  created_at: string;
  user_profiles?: { username: string; avatar_url: string | null } | null;
}

function sevenDaysAgoIso(): string {
  return new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
}

function extractHashtags(captions: string[]): string[] {
  const counts: Record<string, number> = {};
  for (const cap of captions) {
    const tags = cap.match(/#[\wÀ-ɏ]+/g) ?? [];
    for (const tag of tags) {
      const t = tag.toLowerCase();
      counts[t] = (counts[t] ?? 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([tag]) => tag);
}

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, isFollowing, toggleFollow } = useAuth();

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchTab, setSearchTab] = useState<SearchTab>('users');
  const [tab, setTab] = useState<Tab>('discover');

  const [loading, setLoading] = useState(false);
  const [searchUsers, setSearchUsers] = useState<DbUser[]>([]);
  const [searchVideos, setSearchVideos] = useState<DbVideo[]>([]);

  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [trendingTags, setTrendingTags] = useState<string[]>([]);
  const [suggestedUsers, setSuggestedUsers] = useState<DbUser[]>([]);
  const [popularVideos, setPopularVideos] = useState<DbVideo[]>([]);

  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  // ── Recent searches ──────────────────────────────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem(RECENT_KEY).then(val => {
      if (val) {
        try { setRecentSearches(JSON.parse(val)); } catch {}
      }
    });
  }, []);

  const saveRecentSearch = useCallback((q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setRecentSearches(prev => {
      const next = [trimmed, ...prev.filter(s => s !== trimmed)].slice(0, MAX_RECENT);
      AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const clearRecentSearches = useCallback(() => {
    setRecentSearches([]);
    AsyncStorage.removeItem(RECENT_KEY).catch(() => {});
  }, []);

  // ── Debounce ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 400);
    return () => clearTimeout(t);
  }, [query]);

  // ── Search ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    const q = debouncedQuery.trim();
    if (!q) {
      setSearchUsers([]);
      setSearchVideos([]);
      return;
    }

    saveRecentSearch(q);
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const isHashtag = q.startsWith('#');
    setLoading(true);

    if (isHashtag) {
      supabase
        .from('videos')
        .select('id, user_id, caption, thumbnail_url, likes_count, created_at, user_profiles!videos_user_id_fkey(username, avatar_url)')
        .ilike('caption', `%${q}%`)
        .order('likes_count', { ascending: false })
        .limit(30)
        .then(({ data }) => {
          setSearchVideos((data as DbVideo[]) ?? []);
          setSearchTab('videos');
          setLoading(false);
        });
    } else {
      Promise.all([
        supabase
          .from('user_profiles')
          .select('id, username, display_name, avatar_url, followers_count')
          .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
          .order('followers_count', { ascending: false })
          .limit(20),
        supabase
          .from('videos')
          .select('id, user_id, caption, thumbnail_url, likes_count, created_at, user_profiles!videos_user_id_fkey(username, avatar_url)')
          .ilike('caption', `%${q}%`)
          .order('likes_count', { ascending: false })
          .limit(20),
      ]).then(([{ data: users }, { data: videos }]) => {
        setSearchUsers((users as DbUser[]) ?? []);
        setSearchVideos((videos as DbVideo[]) ?? []);
        setLoading(false);
      }).catch(() => setLoading(false));
    }
  }, [debouncedQuery]);

  // ── Discovery data ───────────────────────────────────────────────────────────
  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    setDiscoverLoading(true);
    const since = sevenDaysAgoIso();

    Promise.all([
      supabase
        .from('videos')
        .select('caption')
        .gte('created_at', since)
        .limit(200),
      supabase
        .from('user_profiles')
        .select('id, username, display_name, avatar_url, followers_count')
        .order('followers_count', { ascending: false })
        .limit(20),
      supabase
        .from('videos')
        .select('id, user_id, caption, thumbnail_url, likes_count, created_at, user_profiles!videos_user_id_fkey(username, avatar_url)')
        .gte('created_at', since)
        .order('likes_count', { ascending: false })
        .limit(9),
    ]).then(([{ data: caps }, { data: users }, { data: vids }]) => {
      const captions = (caps ?? []).map((r: { caption: string }) => r.caption);
      setTrendingTags(extractHashtags(captions));
      setSuggestedUsers((users as DbUser[]) ?? []);
      setPopularVideos((vids as DbVideo[]) ?? []);
      setDiscoverLoading(false);
    }).catch(() => setDiscoverLoading(false));
  }, []);

  const isSearching = query.length > 0;

  const filteredSuggested = suggestedUsers.filter(
    u => u.id !== user?.id && !isFollowing(u.id),
  );

  const displayTags = trendingTags.length > 0 ? trendingTags : FALLBACK_TAGS;

  // Top creators reuses the same real user_profiles query already fetched
  // for "Creadores Sugeridos" (followers_count desc, limit 20) — just the
  // unfiltered top 10, since a leaderboard should show top creators
  // regardless of whether the viewer already follows them.
  const topCreators = suggestedUsers.slice(0, 10);

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
          placeholder="Buscar videos, creadores, #tags..."
          placeholderTextColor={Colors.textSubtle}
          autoCorrect={false}
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <MaterialIcons name="close" size={18} color={Colors.textSubtle} />
          </Pressable>
        ) : null}
      </View>

      {/* Tab bar */}
      {isSearching ? (
        <View style={styles.tabBar}>
          {(['users', 'videos'] as SearchTab[]).map(st => (
            <Pressable
              key={st}
              style={[styles.tabBtn, searchTab === st && styles.tabBtnActive]}
              onPress={() => setSearchTab(st)}
            >
              <Text style={[styles.tabText, searchTab === st && styles.tabTextActive]}>
                {st === 'users' ? 'Usuarios' : 'Videos'}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={styles.tabBar}>
          {(['discover', 'creators'] as Tab[]).map(t => (
            <Pressable
              key={t}
              style={[styles.tabBtn, tab === t && styles.tabBtnActive]}
              onPress={() => setTab(t)}
            >
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                {t === 'discover' ? 'Populares' : 'Creadores'}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 120 + insets.bottom }]}
      >
        {isSearching ? (
          loading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={Colors.primary} />
            </View>
          ) : searchTab === 'users' ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Usuarios</Text>
              {searchUsers.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyIcon}>🔍</Text>
                  <Text style={styles.emptyText}>No se encontraron usuarios</Text>
                </View>
              ) : searchUsers.map(u => (
                <Pressable
                  key={u.id}
                  style={({ pressed }) => [styles.userCard, pressed && { opacity: 0.8 }]}
                  onPress={() => router.push(`/creator/${u.id}` as any)}
                >
                  <Avatar uri={u.avatar_url ?? undefined} username={u.username} size={44} showBorder />
                  <View style={styles.userInfo}>
                    <Text style={styles.userName}>{u.display_name || u.username}</Text>
                    <Text style={styles.userHandle}>@{u.username}</Text>
                    <Text style={styles.userFollowers}>{formatNumber(u.followers_count ?? 0)} seguidores</Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={20} color={Colors.textSubtle} />
                </Pressable>
              ))}
            </View>
          ) : (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Videos</Text>
              {searchVideos.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyIcon}>🎬</Text>
                  <Text style={styles.emptyText}>No se encontraron videos</Text>
                </View>
              ) : searchVideos.map(video => {
                const profile = video.user_profiles as { username: string; avatar_url: string | null } | null;
                return (
                  <Pressable
                    key={video.id}
                    style={({ pressed }) => [styles.resultCard, pressed && { opacity: 0.8 }]}
                  >
                    <Image
                      source={{ uri: video.thumbnail_url ?? '' }}
                      style={styles.resultThumb}
                      contentFit="cover"
                      transition={200}
                    />
                    <View style={styles.resultInfo}>
                      <Text style={styles.resultUser}>@{profile?.username ?? 'user'}</Text>
                      <Text style={styles.resultCaption} numberOfLines={2}>{video.caption}</Text>
                      <Text style={styles.resultLikes}>❤ {formatNumber(video.likes_count ?? 0)}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )
        ) : tab === 'discover' ? (
          <>
            {/* Recent searches */}
            {recentSearches.length > 0 ? (
              <View style={styles.section}>
                <View style={styles.sectionRowBetween}>
                  <Text style={styles.sectionTitle}>Búsquedas recientes</Text>
                  <Pressable onPress={clearRecentSearches} hitSlop={8}>
                    <Text style={styles.clearText}>Borrar</Text>
                  </Pressable>
                </View>
                <View style={styles.tagsGrid}>
                  {recentSearches.map(s => (
                    <Pressable
                      key={s}
                      style={({ pressed }) => [styles.tag, pressed && { opacity: 0.7 }]}
                      onPress={() => setQuery(s)}
                    >
                      <LinearGradient
                        colors={['rgba(255,255,255,0.06)', 'rgba(255,255,255,0.03)']}
                        style={[styles.tagGradient, styles.tagGradientRow]}
                      >
                        <MaterialIcons name="history" size={11} color={Colors.textSubtle} />
                        <Text style={[styles.tagText, { color: Colors.textSecondary }]}>{s}</Text>
                      </LinearGradient>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Trending Tags */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Trending Tags</Text>
              {discoverLoading ? (
                <ActivityIndicator color={Colors.primary} style={styles.loadingInline} />
              ) : (
                <View style={styles.tagsGrid}>
                  {displayTags.map(tag => (
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
              )}
            </View>

            {/* Suggested Users */}
            {filteredSuggested.length > 0 || discoverLoading ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Creadores Sugeridos</Text>
                {discoverLoading ? (
                  <ActivityIndicator color={Colors.primary} style={styles.loadingInline} />
                ) : filteredSuggested.slice(0, 5).map(u => (
                  <Pressable
                    key={u.id}
                    style={({ pressed }) => [styles.userCard, pressed && { opacity: 0.8 }]}
                    onPress={() => router.push(`/creator/${u.id}` as any)}
                  >
                    <Avatar uri={u.avatar_url ?? undefined} username={u.username} size={44} showBorder />
                    <View style={styles.userInfo}>
                      <Text style={styles.userName}>{u.display_name || u.username}</Text>
                      <Text style={styles.userHandle}>@{u.username}</Text>
                      <Text style={styles.userFollowers}>{formatNumber(u.followers_count ?? 0)} seguidores</Text>
                    </View>
                    <Pressable
                      style={({ pressed }) => [
                        styles.followBtn,
                        isFollowing(u.id) && styles.followBtnActive,
                        pressed && { opacity: 0.75 },
                      ]}
                      onPress={() => toggleFollow(u.id)}
                    >
                      <MaterialIcons
                        name={isFollowing(u.id) ? 'check' : 'person-add'}
                        size={14}
                        color={isFollowing(u.id) ? Colors.textSecondary : '#fff'}
                      />
                      <Text style={[
                        styles.followBtnText,
                        isFollowing(u.id) && styles.followBtnTextActive,
                      ]}>
                        {isFollowing(u.id) ? 'Siguiendo' : 'Seguir'}
                      </Text>
                    </Pressable>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {/* Popular Videos Grid */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Videos Populares</Text>
              {discoverLoading ? (
                <ActivityIndicator color={Colors.primary} style={styles.loadingInline} />
              ) : popularVideos.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyIcon}>🎬</Text>
                  <Text style={styles.emptyText}>No hay videos populares esta semana</Text>
                </View>
              ) : (
                <View style={styles.videoGrid}>
                  {popularVideos.map(video => (
                    <Pressable
                      key={video.id}
                      style={({ pressed }) => [styles.videoThumb, pressed && { opacity: 0.8 }]}
                    >
                      <Image
                        source={{ uri: video.thumbnail_url ?? '' }}
                        style={styles.thumbImage}
                        contentFit="cover"
                        transition={200}
                      />
                      <LinearGradient
                        colors={['transparent', 'rgba(0,0,0,0.75)']}
                        style={styles.thumbOverlay}
                      >
                        <MaterialIcons name="play-arrow" size={16} color="#fff" />
                        <Text style={styles.thumbLikes}>{formatNumber(video.likes_count ?? 0)}</Text>
                      </LinearGradient>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          </>
        ) : (
          /* Creators — real top-followers leaderboard */
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Top Creadores</Text>
            {discoverLoading ? (
              <ActivityIndicator color={Colors.primary} style={styles.loadingInline} />
            ) : topCreators.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyIcon}>👥</Text>
                <Text style={styles.emptyText}>No hay creadores todavia</Text>
              </View>
            ) : topCreators.map((u, idx) => (
              <View key={u.id} style={styles.creatorCard}>
                <Text style={styles.creatorRank}>#{idx + 1}</Text>
                <Avatar uri={u.avatar_url ?? undefined} username={u.username} size={52} showBorder />
                <View style={styles.creatorInfo}>
                  <Text style={styles.creatorName}>{u.display_name || u.username}</Text>
                  <Text style={styles.creatorFollowers}>{formatNumber(u.followers_count ?? 0)} seguidores</Text>
                </View>
                <Pressable
                  style={({ pressed }) => [
                    styles.followBtn,
                    isFollowing(u.id) && styles.followBtnActive,
                    pressed && { opacity: 0.75 },
                  ]}
                  onPress={() => toggleFollow(u.id)}
                >
                  <MaterialIcons
                    name={isFollowing(u.id) ? 'check' : 'person-add'}
                    size={14}
                    color={isFollowing(u.id) ? Colors.textSecondary : '#fff'}
                  />
                  <Text style={[
                    styles.followBtnText,
                    isFollowing(u.id) && styles.followBtnTextActive,
                  ]}>
                    {isFollowing(u.id) ? 'Siguiendo' : 'Seguir'}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
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
  sectionRowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  clearText: { color: Colors.primary, fontSize: FontSize.sm },
  tagsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tag: { borderRadius: Radius.full, overflow: 'hidden' },
  tagGradient: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
    borderRadius: Radius.full, borderWidth: 1, borderColor: 'rgba(0,212,255,0.3)',
  },
  tagGradientRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tagText: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  videoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  videoThumb: { width: '31.5%', aspectRatio: 9 / 16, borderRadius: Radius.sm, overflow: 'hidden' },
  thumbImage: { width: '100%', height: '100%' },
  thumbOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: Spacing.xs, flexDirection: 'row', alignItems: 'center', gap: 2,
  },
  thumbLikes: { color: '#fff', fontSize: FontSize.xs },
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
  userCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.border,
  },
  userInfo: { flex: 1 },
  userName: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  userHandle: { color: Colors.textSubtle, fontSize: FontSize.xs },
  userFollowers: { color: Colors.textSubtle, fontSize: FontSize.xs },
  centered: { paddingVertical: Spacing.xxl, alignItems: 'center' },
  loadingInline: { alignSelf: 'flex-start', marginTop: Spacing.xs },
});
