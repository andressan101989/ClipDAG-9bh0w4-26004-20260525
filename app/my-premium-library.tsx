import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';

import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import {
  fetchCreatorPremiumLibraryTeasers,
  fetchMyCreatorPremiumLibrary,
  getCurrentCreatorPremiumUserId,
  type CreatorPremiumCursor,
  type CreatorPremiumLibraryItem,
} from '@/services/creatorPremiumService';
import { rememberCreatorPremiumContentKind } from '@/services/creatorPremiumViewerRuntime.mjs';

type LibraryDisplayItem = CreatorPremiumLibraryItem & { teaser_url: string | null };

function mergeLibraryItems(
  current: LibraryDisplayItem[],
  next: LibraryDisplayItem[],
): LibraryDisplayItem[] {
  const unique = new Map(current.map(item => [item.id, item]));
  for (const item of next) unique.set(item.id, item);
  return [...unique.values()];
}

export default function MyPremiumLibraryScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [items, setItems] = useState<LibraryDisplayItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const nextCursorRef = useRef<CreatorPremiumCursor | null>(null);
  const requestGeneration = useRef(0);
  const loadingMoreRef = useRef(false);

  const loadPage = useCallback(async (reset: boolean) => {
    if (!reset && (!nextCursorRef.current || loadingMoreRef.current)) return;
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    if (reset) {
      setError(false);
      setLoading(true);
    } else {
      loadingMoreRef.current = true;
      setLoadingMore(true);
    }

    try {
      const page = await fetchMyCreatorPremiumLibrary({
        limit: 24,
        cursor: reset ? null : nextCursorRef.current,
      });
      const teasers = await fetchCreatorPremiumLibraryTeasers(page.items);
      if (requestGeneration.current !== generation) return;
      const hydrated = page.items.map(item => ({
        ...item,
        teaser_url: teasers[item.id] ?? null,
      }));
      setItems(current => reset ? hydrated : mergeLibraryItems(current, hydrated));
      nextCursorRef.current = page.nextCursor;
      setError(false);
    } catch {
      if (requestGeneration.current === generation) setError(true);
    } finally {
      if (requestGeneration.current === generation) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
        loadingMoreRef.current = false;
      }
    }
  }, []);

  useFocusEffect(useCallback(() => {
    if (!user?.id) {
      requestGeneration.current += 1;
      nextCursorRef.current = null;
      setItems([]);
      setLoading(false);
      setError(false);
      return () => { requestGeneration.current += 1; };
    }
    void loadPage(true);
    return () => {
      requestGeneration.current += 1;
      loadingMoreRef.current = false;
    };
  }, [loadPage, user?.id]));

  const refresh = useCallback(() => {
    setRefreshing(true);
    nextCursorRef.current = null;
    void loadPage(true);
  }, [loadPage]);

  const openItem = useCallback(async (item: LibraryDisplayItem) => {
    if (item.entitlement_expires_at && Date.parse(item.entitlement_expires_at) <= Date.now()) return;
    const generation = requestGeneration.current;
    try {
      const currentUserId = await getCurrentCreatorPremiumUserId();
      if (
        !currentUserId
        || currentUserId !== user?.id
        || requestGeneration.current !== generation
      ) return;
      rememberCreatorPremiumContentKind(currentUserId, item.id, item.content_kind);
      router.push({
        pathname: '/creator-premium-viewer/[contentId]',
        params: { contentId: item.id },
      } as never);
    } catch {
      setError(true);
    }
  }, [router, user?.id]);

  const renderItem = useCallback(({ item }: { item: LibraryDisplayItem }) => {
    const expired = Boolean(
      item.entitlement_expires_at
      && Date.parse(item.entitlement_expires_at) <= Date.now(),
    );
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Abrir ${item.title}`}
        disabled={expired}
        onPress={() => { void openItem(item); }}
        style={styles.card}
      >
        {item.teaser_url ? (
          <Image source={{ uri: item.teaser_url }} style={styles.teaser} contentFit="cover" transition={120} />
        ) : (
          <View style={[styles.teaser, styles.placeholder]}>
            <Text style={styles.placeholderIcon}>{item.content_kind === 'video' ? '▶' : '▧'}</Text>
          </View>
        )}
        <View style={styles.cardBody}>
          <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
          <Text style={styles.meta}>
            {expired ? 'Acceso vencido' : item.content_kind === 'video' ? 'Video protegido' : 'Imagen protegida'}
          </Text>
          <Text style={styles.source}>
            {item.entitlement_source === 'purchase' ? 'Acceso individual' : 'Acceso por suscripción'}
          </Text>
        </View>
      </Pressable>
    );
  }, [openItem]);

  const handlePaginationScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const nearEnd = contentOffset.y + layoutMeasurement.height >= contentSize.height - 240;
    if (nearEnd && nextCursorRef.current) void loadPage(false);
  }, [loadPage]);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Volver" onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>Volver</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Mi biblioteca Premium</Text>
        <View style={styles.headerSpacer} />
      </View>
      <View style={styles.notice}>
        <Text style={styles.noticeIcon}>●</Text>
        <Text style={styles.noticeText}>Las compras y suscripciones aún no están habilitadas.</Text>
      </View>

      {loading && items.length === 0 ? (
        <View style={styles.center}><ActivityIndicator size="large" color={Colors.purple} /></View>
      ) : error && items.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>⌁</Text>
          <Text style={styles.emptyTitle}>No pudimos cargar tu biblioteca</Text>
          <Text style={styles.emptyBody}>Comprueba tu conexión o vuelve a validar tu sesión.</Text>
          <Pressable accessibilityRole="button" onPress={() => { void loadPage(true); }} style={styles.retryButton}>
            <Text style={styles.retryText}>Reintentar</Text>
          </Pressable>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>▦</Text>
          <Text style={styles.emptyTitle}>Sin contenido Premium</Text>
          <Text style={styles.emptyBody}>Tu contenido con acceso vigente aparecerá aquí.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.purple} />}
          onScroll={handlePaginationScroll}
          scrollEventThrottle={200}
        >
          {error ? <Text style={styles.inlineError}>La actualización falló; conservamos la última vista segura.</Text> : null}
          <View style={styles.grid}>
            {items.map(item => <React.Fragment key={item.id}>{renderItem({ item })}</React.Fragment>)}
          </View>
          {loadingMore ? <ActivityIndicator color={Colors.purple} style={styles.footer} /> : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  header: { minHeight: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  backButton: { minWidth: 60, minHeight: 44, justifyContent: 'center' },
  backText: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  headerTitle: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  headerSpacer: { width: 60 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, margin: Spacing.md, padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.purpleDim },
  noticeIcon: { color: Colors.purple, fontSize: FontSize.xs },
  noticeText: { flex: 1, color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 18 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.xl },
  emptyTitle: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold, textAlign: 'center' },
  emptyBody: { color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 20, textAlign: 'center' },
  retryButton: { minHeight: 44, justifyContent: 'center', marginTop: Spacing.md, paddingHorizontal: Spacing.lg, borderRadius: Radius.full, backgroundColor: Colors.purple },
  retryText: { color: Colors.textOnBrand, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  list: { paddingHorizontal: Spacing.md, paddingBottom: Spacing.xxl },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  card: { width: '47%', flexGrow: 1, overflow: 'hidden', borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  teaser: { width: '100%', aspectRatio: 1 },
  placeholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceElevated },
  placeholderIcon: { color: Colors.purple, fontSize: 38, fontWeight: FontWeight.bold },
  cardBody: { gap: Spacing.xs, padding: Spacing.md },
  title: { minHeight: 36, color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  meta: { color: Colors.purple, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
  source: { color: Colors.textSubtle, fontSize: FontSize.xs },
  inlineError: { marginBottom: Spacing.md, color: Colors.warning, fontSize: FontSize.xs, textAlign: 'center' },
  emptyIcon: { color: Colors.textSubtle, fontSize: 48 },
  footer: { marginVertical: Spacing.lg },
});
