/**
 * app/(tabs)/shop.tsx — Marketplace & Discovery Hub
 *
 * Simplified focus:
 *  • Featured/promoted creators discovery
 *  • Marketplace: products, digital goods, services
 *  • Economy stats overview
 *  • Trending subscriptions
 *
 * Creator management moved to: Profile → Monetizar → creator-monetization.tsx
 * Subscription management moved to: my-subscriptions.tsx
 * Creator profiles: app/creator/[id].tsx
 */
import React, { useState, useEffect, useCallback, memo } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput,
  StyleSheet, ActivityIndicator, Dimensions, RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useAuth } from '@/hooks/useAuth';
import { useWallet } from '@/hooks/useWallet';
import { fetchFeaturedCreators, searchCreators, type CreatorProfile } from '@/services/creatorService';
import { fetchSubscriptionPlans, type SubscriptionPlan } from '@/services/subscriptionService';
import { fetchProducts, PRODUCT_CATEGORIES, type Product } from '@/services/marketplaceService';
import { fetchExclusiveContent, type ExclusiveContent } from '@/services/economyService';
import { isProfileBoosted } from '@/services/boostService';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';

const { width: W } = Dimensions.get('window');
const CARD_W = (W - Spacing.md * 2 - Spacing.sm) / 2;

function fmt(n: number, d = 0) {
  return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtShort(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

type ShopTab = 'discover' | 'market' | 'exclusive';

const SHOP_TABS: { key: ShopTab; icon: string; label: string; color: string }[] = [
  { key: 'discover',  icon: 'compass-outline',          label: 'Descubrir', color: '#7C5CFF' },
  { key: 'market',    icon: 'storefront-outline',        label: 'Market',    color: '#2D9EFF' },
  { key: 'exclusive', icon: 'lock-outline',              label: 'Exclusivo', color: '#A855F7' },
];

// ── Creator discovery card ─────────────────────────────────────────────────────
const CreatorCard = memo(function CreatorCard({
  creator, isBoosted, onPress,
}: { creator: CreatorProfile; isBoosted: boolean; onPress: () => void }) {
  const avatar = creator.avatar_url ||
    `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(creator.username || 'u')}`;
  return (
    <Pressable style={cr.card} onPress={onPress}>
      <LinearGradient colors={isBoosted
        ? ['rgba(255,157,0,0.15)', 'rgba(124,92,255,0.08)']
        : ['rgba(255,255,255,0.04)', 'rgba(255,255,255,0.01)']}
        style={cr.inner}
      >
        {/* Boosted glow ring */}
        {isBoosted ? (
          <LinearGradient colors={['#FF9D00', '#FF5A00', '#A855F7']} style={cr.avatarRing}>
            <Image source={{ uri: avatar }} style={cr.avatar} contentFit="cover" />
          </LinearGradient>
        ) : (
          <View style={[cr.avatarRing, { backgroundColor: Colors.border }]}>
            <Image source={{ uri: avatar }} style={cr.avatar} contentFit="cover" />
          </View>
        )}

        <View style={cr.info}>
          <Text style={cr.name} numberOfLines={1}>
            {creator.display_name || creator.username}
          </Text>
          <Text style={cr.username} numberOfLines={1}>@{creator.username}</Text>
          {creator.profession ? (
            <Text style={cr.profession} numberOfLines={1}>{creator.profession}</Text>
          ) : null}
        </View>

        <View style={cr.stats}>
          <View style={cr.statItem}>
            <Text style={cr.statVal}>{fmtShort(creator.followers_count)}</Text>
            <Text style={cr.statLabel}>seguidores</Text>
          </View>
        </View>

        {isBoosted ? (
          <View style={cr.boostBadge}>
            <MaterialCommunityIcons name="rocket-launch" size={8} color="#fff" />
            <Text style={cr.boostBadgeText}>BOOST</Text>
          </View>
        ) : null}
      </LinearGradient>
    </Pressable>
  );
});

const cr = StyleSheet.create({
  card:          { width: CARD_W, borderRadius: Radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  inner:         { padding: Spacing.md, gap: 8, alignItems: 'center', position: 'relative' },
  avatarRing:    { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', padding: 2 },
  avatar:        { width: 62, height: 62, borderRadius: 31 },
  info:          { alignItems: 'center', gap: 1, width: '100%' },
  name:          { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.bold, textAlign: 'center' },
  username:      { color: Colors.textSubtle, fontSize: 10 },
  profession:    { color: Colors.primary, fontSize: 10, fontWeight: FontWeight.medium },
  stats:         { flexDirection: 'row' },
  statItem:      { alignItems: 'center' },
  statVal:       { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  statLabel:     { color: Colors.textSubtle, fontSize: 9 },
  boostBadge:    { position: 'absolute', top: 8, right: 8, flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#FF9D00', borderRadius: Radius.full, paddingHorizontal: 5, paddingVertical: 2 },
  boostBadgeText:{ color: '#fff', fontSize: 8, fontWeight: FontWeight.bold },
});

// ── Subscription plan card (horizontal) ──────────────────────────────────────
const PlanCard = memo(function PlanCard({
  plan, onPress,
}: { plan: SubscriptionPlan; onPress: () => void }) {
  const avatar = plan.creator?.avatar_url ||
    `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(plan.creator?.username || 'u')}`;
  return (
    <Pressable style={pl.card} onPress={onPress}>
      <LinearGradient colors={['rgba(168,85,247,0.12)', 'rgba(124,92,255,0.05)']} style={pl.inner}>
        <Image source={{ uri: avatar }} style={pl.avatar} contentFit="cover" />
        <View style={{ flex: 1 }}>
          <Text style={pl.planName} numberOfLines={1}>{plan.name}</Text>
          <Text style={pl.creator} numberOfLines={1}>@{plan.creator?.username}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={pl.price}>{fmt(plan.price_bdag)} BDAG</Text>
          <Text style={pl.cycle}>/mes</Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={16} color={Colors.textSubtle} />
      </LinearGradient>
    </Pressable>
  );
});

const pl = StyleSheet.create({
  card:    { borderRadius: Radius.md, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(168,85,247,0.25)' },
  inner:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.sm + 4 },
  avatar:  { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.surface },
  planName:{ color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  creator: { color: Colors.textSubtle, fontSize: FontSize.xs },
  price:   { color: '#A855F7', fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  cycle:   { color: Colors.textSubtle, fontSize: 9 },
});

// ── Product card ──────────────────────────────────────────────────────────────
const ProductCard = memo(function ProductCard({
  product, onPress,
}: { product: Product; onPress: () => void }) {
  const img = product.images?.[0]
    ? { uri: product.images[0] }
    : { uri: `https://picsum.photos/seed/${product.id}/300/200` };
  return (
    <Pressable style={pc.card} onPress={onPress}>
      <Image source={img} style={pc.img} contentFit="cover" transition={200} />
      <View style={pc.body}>
        <Text style={pc.title} numberOfLines={2}>{product.title}</Text>
        <View style={pc.footer}>
          <Text style={pc.price}>${fmt(product.price, 2)}</Text>
          <Text style={pc.sales}>{product.total_sales} ventas</Text>
        </View>
        {product.seller ? (
          <Text style={pc.seller} numberOfLines={1}>@{product.seller.username}</Text>
        ) : null}
      </View>
    </Pressable>
  );
});

const pc = StyleSheet.create({
  card:   { width: CARD_W, borderRadius: Radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surfaceElevated },
  img:    { width: '100%', height: 110 },
  body:   { padding: 10, gap: 4 },
  title:  { color: Colors.textPrimary, fontSize: FontSize.xs, fontWeight: FontWeight.bold, lineHeight: 16 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  price:  { color: Colors.blue, fontSize: FontSize.md, fontWeight: FontWeight.extrabold },
  sales:  { color: Colors.textSubtle, fontSize: 9 },
  seller: { color: Colors.textSubtle, fontSize: 9 },
});

// ── Exclusive content card ────────────────────────────────────────────────────
const ExclusiveCard = memo(function ExclusiveCard({
  item, onPress,
}: { item: ExclusiveContent; onPress: () => void }) {
  const thumb = item.preview_url?.startsWith('http')
    ? { uri: item.preview_url }
    : { uri: `https://picsum.photos/seed/${item.id}/300/400` };
  return (
    <Pressable style={ec.card} onPress={onPress}>
      <Image source={thumb} style={ec.img} contentFit="cover" transition={200} />
      <LinearGradient colors={['transparent', 'rgba(7,7,15,0.9)']} style={ec.overlay}>
        <View style={ec.lockRow}>
          <MaterialIcons name="lock" size={10} color="#fff" />
          <Text style={ec.price}>{fmt(item.price_bdag)} BDAG</Text>
        </View>
        <Text style={ec.title} numberOfLines={2}>{item.title}</Text>
        {item.creator ? (
          <Text style={ec.creator} numberOfLines={1}>@{item.creator.username}</Text>
        ) : null}
      </LinearGradient>
      <View style={ec.typeBadge}>
        <Text style={ec.typeText}>{item.content_type.toUpperCase().slice(0, 5)}</Text>
      </View>
    </Pressable>
  );
});

const ec = StyleSheet.create({
  card:      { width: CARD_W, height: 180, borderRadius: Radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(168,85,247,0.25)', position: 'relative' },
  img:       { width: '100%', height: '100%' },
  overlay:   { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 10, gap: 3 },
  lockRow:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  price:     { color: '#A855F7', fontSize: 10, fontWeight: FontWeight.bold },
  title:     { color: '#fff', fontSize: 11, fontWeight: FontWeight.bold, lineHeight: 15 },
  creator:   { color: 'rgba(255,255,255,0.6)', fontSize: 9 },
  typeBadge: { position: 'absolute', top: 8, left: 8, backgroundColor: 'rgba(168,85,247,0.7)', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 },
  typeText:  { color: '#fff', fontSize: 8, fontWeight: FontWeight.bold },
});

// ════════════════════════════════════════════════════════════════════════════
// MAIN SCREEN
// ════════════════════════════════════════════════════════════════════════════
export default function ShopScreen() {
  const insets = useSafeAreaInsets();
  const router  = useRouter();
  const { user } = useAuth();
  const walletData = useWallet();
  const balance = walletData?.balance ?? 0;

  const [activeTab,   setActiveTab]   = useState<ShopTab>('discover');
  const [refreshing,  setRefreshing]  = useState(false);
  const [search,      setSearch]      = useState('');
  const [searching,   setSearching]   = useState(false);

  // Discover tab
  const [featured,        setFeatured]        = useState<CreatorProfile[]>([]);
  const [searchResults,   setSearchResults]   = useState<CreatorProfile[]>([]);
  const [plans,           setPlans]           = useState<SubscriptionPlan[]>([]);
  const [boostedIds,      setBoostedIds]      = useState<Set<string>>(new Set());
  const [discoverLoading, setDiscoverLoading] = useState(false);

  // Market tab
  const [products,      setProducts]      = useState<Product[]>([]);
  const [productCat,    setProductCat]    = useState('');
  const [marketLoading, setMarketLoading] = useState(false);

  // Exclusive tab
  const [exclusiveContent, setExclusiveContent] = useState<ExclusiveContent[]>([]);
  const [excFilter,        setExcFilter]        = useState('');
  const [excLoading,       setExcLoading]       = useState(false);

  // ── Loaders ───────────────────────────────────────────────────────────────
  const loadDiscover = useCallback(async () => {
    setDiscoverLoading(true);
    const [creators, subPlans] = await Promise.all([
      fetchFeaturedCreators(16),
      fetchSubscriptionPlans({ limit: 10 }),
    ]);
    // Check which are boosted
    const boostChecks = await Promise.all(
      creators.map(c => isProfileBoosted(c.id).then(r => r.boosted ? c.id : null))
    );
    setBoostedIds(new Set(boostChecks.filter(Boolean) as string[]));
    setFeatured(creators.filter(c => c.id !== user?.id));
    setPlans(subPlans.filter(p => p.creator_id !== user?.id));
    setDiscoverLoading(false);
  }, [user?.id]);

  const loadProducts = useCallback(async () => {
    setMarketLoading(true);
    const prods = await fetchProducts({ category: productCat || undefined, limit: 30 });
    setProducts(prods.filter(p => p.seller_id !== user?.id));
    setMarketLoading(false);
  }, [productCat, user?.id]);

  const loadExclusive = useCallback(async () => {
    setExcLoading(true);
    const items = await fetchExclusiveContent({ contentType: excFilter || undefined, limit: 30 });
    setExclusiveContent(items.filter(i => i.creator_id !== user?.id));
    setExcLoading(false);
  }, [excFilter, user?.id]);

  useEffect(() => { loadDiscover(); }, [loadDiscover]);
  useEffect(() => { if (activeTab === 'market') loadProducts(); }, [activeTab, loadProducts]);
  useEffect(() => { if (activeTab === 'exclusive') loadExclusive(); }, [activeTab, loadExclusive]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadDiscover(), loadProducts(), loadExclusive()]);
    setRefreshing(false);
  }, [loadDiscover, loadProducts, loadExclusive]);

  // ── Search creators ───────────────────────────────────────────────────────
  const handleSearch = useCallback(async (q: string) => {
    setSearch(q);
    if (!q.trim()) { setSearchResults([]); return; }
    setSearching(true);
    const results = await searchCreators(q, 10);
    setSearchResults(results.filter(c => c.id !== user?.id));
    setSearching(false);
  }, [user?.id]);

  const displayCreators = search.trim() ? searchResults : featured;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Marketplace</Text>
          <Text style={styles.headerSub}>Descubre · Conecta · Monetiza</Text>
        </View>
        <View style={styles.headerRight}>
          <Pressable style={styles.walletPill} onPress={() => router.push('/(tabs)/wallet')}>
            <MaterialCommunityIcons name="hexagon-multiple" size={12} color="#FF9D00" />
            <Text style={styles.walletPillText}>{balance >= 1000 ? fmtShort(balance) : fmt(balance)} BDAG</Text>
          </Pressable>
        </View>
      </View>

      {/* ── Tab bar ─────────────────────────────────────────────────────── */}
      <View style={styles.tabBar}>
        {SHOP_TABS.map(t => (
          <Pressable key={t.key}
            style={[styles.tabBtn, activeTab === t.key && { borderBottomColor: t.color, borderBottomWidth: 2 }]}
            onPress={() => setActiveTab(t.key)}
          >
            <MaterialCommunityIcons name={t.icon as any} size={14}
              color={activeTab === t.key ? t.color : Colors.textSubtle} />
            <Text style={[styles.tabText, activeTab === t.key && { color: t.color }]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: 100 + insets.bottom }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >

        {/* ════ DISCOVER TAB ════════════════════════════════════════════════ */}
        {activeTab === 'discover' && (
          <>
            {/* Search bar */}
            <View style={styles.searchBar}>
              <MaterialCommunityIcons name="magnify" size={16} color={Colors.textSubtle} />
              <TextInput
                style={styles.searchInput}
                value={search}
                onChangeText={handleSearch}
                placeholder="Buscar creadores..."
                placeholderTextColor={Colors.textSubtle}
                returnKeyType="search"
              />
              {searching ? <ActivityIndicator size="small" color={Colors.primary} /> : null}
              {search && !searching ? (
                <Pressable onPress={() => { setSearch(''); setSearchResults([]); }} hitSlop={8}>
                  <MaterialCommunityIcons name="close-circle" size={16} color={Colors.textSubtle} />
                </Pressable>
              ) : null}
            </View>

            {/* My monetization quick access */}
            {!search && (
              <LinearGradient colors={['rgba(124,92,255,0.18)', 'rgba(168,85,247,0.08)']} style={styles.myEconomyCard}>
                <View style={styles.myEconomyLeft}>
                  <LinearGradient colors={['#7C5CFF', '#A855F7']} style={styles.myEconomyIcon}>
                    <MaterialCommunityIcons name="hexagon-multiple" size={16} color="#fff" />
                  </LinearGradient>
                  <View>
                    <Text style={styles.myEconomyTitle}>Tu Economía BDAG</Text>
                    <Text style={styles.myEconomySub}>{fmt(balance)} BDAG · Creador · Mercado</Text>
                  </View>
                </View>
                <View style={styles.myEconomyActions}>
                  <Pressable style={styles.myEconomyBtn} onPress={() => router.push('/creator-monetization')}>
                    <MaterialIcons name="star" size={12} color="#A855F7" />
                    <Text style={[styles.myEconomyBtnText, { color: '#A855F7' }]}>Monetizar</Text>
                  </Pressable>
                  <Pressable style={styles.myEconomyBtn} onPress={() => router.push('/my-subscriptions')}>
                    <MaterialIcons name="subscriptions" size={12} color={Colors.blue} />
                    <Text style={[styles.myEconomyBtnText, { color: Colors.blue }]}>Suscrip.</Text>
                  </Pressable>
                </View>
              </LinearGradient>
            )}

            {/* Featured creators */}
            <Text style={styles.sectionTitle}>
              {search ? `Resultados para "${search}"` : '⭐ Creadores Destacados'}
            </Text>

            {discoverLoading ? (
              <View style={styles.centered}><ActivityIndicator color={Colors.primary} /></View>
            ) : displayCreators.length === 0 ? (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="account-search-outline" size={44} color={Colors.border} />
                <Text style={styles.emptyTitle}>{search ? 'Sin resultados' : 'Sin creadores'}</Text>
              </View>
            ) : (
              <View style={styles.cardGrid}>
                {displayCreators.map(creator => (
                  <CreatorCard
                    key={creator.id}
                    creator={creator}
                    isBoosted={boostedIds.has(creator.id)}
                    onPress={() => router.push(`/creator/${creator.id}`)}
                  />
                ))}
              </View>
            )}

            {/* Trending subscriptions */}
            {!search && plans.length > 0 ? (
              <>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>🔥 Suscripciones Trending</Text>
                  <Pressable onPress={() => router.push('/my-subscriptions')}>
                    <Text style={styles.seeAll}>Ver todas</Text>
                  </Pressable>
                </View>
                <View style={{ gap: 8 }}>
                  {plans.slice(0, 5).map(plan => (
                    <PlanCard
                      key={plan.id}
                      plan={plan}
                      onPress={() => router.push(`/creator/${plan.creator_id}`)}
                    />
                  ))}
                </View>
              </>
            ) : null}
          </>
        )}

        {/* ════ MARKET TAB ══════════════════════════════════════════════════ */}
        {activeTab === 'market' && (
          <>
            {/* Sell CTA */}
            <Pressable style={styles.sellCTA} onPress={() => router.push('/create-product')}>
              <LinearGradient colors={['rgba(45,158,255,0.18)', 'rgba(124,92,255,0.08)']} style={styles.sellCTAInner}>
                <MaterialCommunityIcons name="storefront-outline" size={20} color={Colors.blue} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.sellCTATitle}>¿Tienes algo que vender?</Text>
                  <Text style={styles.sellCTASub}>Publica productos, servicios o contenido digital</Text>
                </View>
                <View style={styles.sellCTABtn}>
                  <Text style={styles.sellCTABtnText}>Publicar</Text>
                </View>
              </LinearGradient>
            </Pressable>

            {/* Category filter */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {PRODUCT_CATEGORIES.map(cat => (
                <Pressable key={cat.key}
                  style={[styles.filterChip, productCat === cat.key && styles.filterChipActive]}
                  onPress={() => setProductCat(cat.key)}
                >
                  <Text style={[styles.filterChipText, productCat === cat.key && styles.filterChipTextActive]}>
                    {cat.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            {marketLoading ? (
              <View style={styles.centered}><ActivityIndicator color={Colors.blue} /></View>
            ) : products.length === 0 ? (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons name="storefront-outline" size={44} color={Colors.border} />
                <Text style={styles.emptyTitle}>Sin productos en esta categoría</Text>
                <Pressable style={[styles.emptyActionBtn, { borderColor: Colors.blue + '44', backgroundColor: Colors.blueDim }]}
                  onPress={() => router.push('/create-product')}>
                  <Text style={[styles.emptyActionText, { color: Colors.blue }]}>Vender ahora</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.cardGrid}>
                {products.map(p => (
                  <ProductCard key={p.id} product={p}
                    onPress={() => router.push({ pathname: '/product/[id]', params: { id: p.id } })} />
                ))}
              </View>
            )}
          </>
        )}

        {/* ════ EXCLUSIVE TAB ═══════════════════════════════════════════════ */}
        {activeTab === 'exclusive' && (
          <>
            {/* Info strip */}
            <LinearGradient colors={['rgba(168,85,247,0.15)', 'rgba(124,92,255,0.07)']} style={styles.exclusiveInfoBar}>
              <MaterialIcons name="lock" size={14} color="#A855F7" />
              <Text style={styles.exclusiveInfoText}>
                Contenido premium de creadores · Desbloquea con BDAG o suscríbete
              </Text>
              <Pressable onPress={() => router.push('/my-subscriptions')}>
                <Text style={styles.exclusiveInfoCTA}>Suscribirme</Text>
              </Pressable>
            </LinearGradient>

            {/* Type filter */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {['', 'post', 'video', 'image', 'download', 'bundle'].map(ct => (
                <Pressable key={ct}
                  style={[styles.filterChip, excFilter === ct && { ...styles.filterChipActive, backgroundColor: '#A855F7', borderColor: '#A855F7' }]}
                  onPress={() => setExcFilter(ct)}
                >
                  <Text style={[styles.filterChipText, excFilter === ct && styles.filterChipTextActive]}>
                    {ct || 'Todo'}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            {excLoading ? (
              <View style={styles.centered}><ActivityIndicator color="#A855F7" /></View>
            ) : exclusiveContent.length === 0 ? (
              <View style={styles.emptyState}>
                <MaterialIcons name="lock" size={44} color={Colors.border} />
                <Text style={styles.emptyTitle}>Sin contenido exclusivo</Text>
                <Pressable style={[styles.emptyActionBtn, { borderColor: '#A855F744', backgroundColor: '#A855F718' }]}
                  onPress={() => router.push('/(tabs)/upload')}>
                  <Text style={[styles.emptyActionText, { color: '#A855F7' }]}>Publicar contenido exclusivo</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.cardGrid}>
                {exclusiveContent.map(item => (
                  <ExclusiveCard key={item.id} item={item}
                    onPress={() => router.push(`/creator/${item.creator_id}`)} />
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: Colors.bg },
  scroll: { padding: Spacing.md, gap: Spacing.md },

  // Header
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm },
  headerTitle:  { fontSize: FontSize.xl, fontWeight: FontWeight.extrabold, color: Colors.textPrimary, letterSpacing: -0.5 },
  headerSub:    { fontSize: FontSize.xs, color: Colors.textSubtle, marginTop: 1 },
  headerRight:  { alignItems: 'flex-end', gap: 6 },
  walletPill:   { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,157,0,0.12)', borderRadius: Radius.md, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: 'rgba(255,157,0,0.25)' },
  walletPillText: { color: '#FF9D00', fontSize: FontSize.xs, fontWeight: FontWeight.bold },

  // Tab bar
  tabBar:  { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.border },
  tabBtn:  { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 11, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabText: { color: Colors.textSubtle, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },

  // Search bar
  searchBar:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceElevated, borderRadius: Radius.xl, paddingHorizontal: Spacing.md, paddingVertical: 11, borderWidth: 1, borderColor: Colors.border },
  searchInput: { flex: 1, color: Colors.textPrimary, fontSize: FontSize.sm },

  // My economy card
  myEconomyCard:    { borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: 'rgba(124,92,255,0.2)', gap: Spacing.sm },
  myEconomyLeft:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  myEconomyIcon:    { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  myEconomyTitle:   { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  myEconomySub:     { color: Colors.textSubtle, fontSize: FontSize.xs },
  myEconomyActions: { flexDirection: 'row', gap: Spacing.sm },
  myEconomyBtn:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: Colors.surface, borderRadius: Radius.md, paddingVertical: 8, borderWidth: 1, borderColor: Colors.border },
  myEconomyBtnText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold },

  // Sections
  sectionTitle:     { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  seeAll:           { color: Colors.primary, fontSize: FontSize.xs, fontWeight: FontWeight.semibold },

  // Cards grid
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, justifyContent: 'space-between' },

  // Sell CTA
  sellCTA:       { borderRadius: Radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(45,158,255,0.25)' },
  sellCTAInner:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  sellCTATitle:  { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  sellCTASub:    { color: Colors.textSubtle, fontSize: FontSize.xs, marginTop: 1 },
  sellCTABtn:    { backgroundColor: Colors.blue, borderRadius: Radius.sm, paddingHorizontal: 12, paddingVertical: 8 },
  sellCTABtnText:{ color: '#fff', fontSize: FontSize.xs, fontWeight: FontWeight.bold },

  // Exclusive info bar
  exclusiveInfoBar:  { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: Radius.md, padding: 11, borderWidth: 1, borderColor: 'rgba(168,85,247,0.25)' },
  exclusiveInfoText: { color: Colors.textSecondary, fontSize: 11, flex: 1, lineHeight: 16 },
  exclusiveInfoCTA:  { color: '#A855F7', fontSize: FontSize.xs, fontWeight: FontWeight.bold },

  // Filters
  filterRow:            { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  filterChip:           { paddingHorizontal: 12, paddingVertical: 7, borderRadius: Radius.full, backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border },
  filterChipActive:     { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterChipText:       { color: Colors.textSubtle, fontSize: FontSize.xs, fontWeight: FontWeight.medium },
  filterChipTextActive: { color: '#fff', fontWeight: FontWeight.bold },

  // States
  centered:       { paddingVertical: 40, alignItems: 'center' },
  emptyState:     { alignItems: 'center', paddingVertical: 48, gap: Spacing.md },
  emptyTitle:     { color: Colors.textSubtle, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  emptyActionBtn: { borderRadius: Radius.md, paddingHorizontal: 18, paddingVertical: 10, borderWidth: 1 },
  emptyActionText:{ fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
});
