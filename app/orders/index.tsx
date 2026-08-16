import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from '@/components/ui/SafeImage';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing } from '@/constants/theme';
import {
  fetchBuyerOrders,
  type MarketplaceOrderListItem,
  type MarketplaceOrderPage,
  type MarketplaceOrderStatus,
} from '@/services/marketplaceFulfillmentService';
import { StatusBadge } from '@/components/marketplace/OrderStatus';
import { SellerScreenHeader } from '@/components/marketplace/SellerScreenHeader';

const PAGE = 20;
const filters: [string, MarketplaceOrderStatus | null][] = [
  ['Todos', null],
  ['Confirmados', 'confirmed'],
  ['En preparación', 'processing'],
  ['Enviados', 'shipped'],
  ['Entregados', 'delivered'],
  ['Reembolsados', 'refunded'],
  ['Parciales', 'partially_refunded'],
  ['Cancelados', 'cancelled'],
];

export default function BuyerOrders() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const lock = useRef(false);
  const generation = useRef(0);
  const [status, setStatus] = useState<MarketplaceOrderStatus | null>(null);
  const [items, setItems] = useState<MarketplaceOrderListItem[]>([]);
  const [next, setNext] = useState<MarketplaceOrderPage['nextCursor']>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async (mode: 'replace' | 'append' = 'replace') => {
    if (mode === 'append' && lock.current) return;
    if (mode === 'append') lock.current = true;
    const token = ++generation.current;
    if (mode === 'append') setMore(true);
    else if (items.length) setRefreshing(true);
    else setLoading(true);
    try {
      const page = await fetchBuyerOrders({
        status,
        limit: PAGE,
        cursor: mode === 'append' ? next ?? undefined : undefined,
      });
      if (token !== generation.current) return;
      setItems((old) => mode === 'append'
        ? [...new Map([...old, ...page.items].map((item) => [item.id, item])).values()]
        : page.items);
      setNext(page.nextCursor);
      setError(false);
    } catch {
      if (token === generation.current) setError(true);
    } finally {
      if (mode === 'append') lock.current = false;
      setLoading(false);
      setRefreshing(false);
      setMore(false);
    }
  }, [items.length, next, status]);

  useFocusEffect(
    useCallback(() => {
      generation.current++;
      setItems([]);
      setNext(null);
      void load('replace');
      // The focused query intentionally resets only when its canonical status filter changes.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status]),
  );

  return <View style={[styles.root, { paddingTop: insets.top }]}>
    <SellerScreenHeader title="Mis pedidos" fallbackRoute="/(tabs)/profile" />
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.filters}
      accessibilityRole="tablist"
    >
      {filters.map(([label, value]) => <Pressable
        key={label}
        accessibilityRole="tab"
        accessibilityState={{ selected: status === value }}
        onPress={() => {
          if (status !== value) {
            generation.current++;
            setStatus(value);
          }
        }}
        style={[styles.chip, status === value && styles.selectedChip]}
      >
        <Text style={styles.text}>{label}</Text>
      </Pressable>)}
    </ScrollView>
    {loading
      ? <ActivityIndicator style={styles.center} color={Colors.primary} />
      : <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          onEndReached={() => { if (next && !more) void load('append'); }}
          onEndReachedThreshold={0.4}
          ListFooterComponent={more ? <ActivityIndicator color={Colors.primary} /> : null}
          refreshControl={<RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load('replace')}
            tintColor={Colors.primary}
          />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<View style={styles.center}>
            <Text style={styles.title}>{error ? 'No pudimos cargar tus pedidos' : 'Aún no tienes pedidos'}</Text>
            {error ? <Pressable style={styles.retry} onPress={() => void load()}>
              <Text style={styles.text}>Reintentar</Text>
            </Pressable> : null}
          </View>}
          renderItem={({ item }) => <Pressable
            style={styles.card}
            onPress={() => router.push(`/orders/${item.id}` as never)}
          >
            <Image
              source={item.firstItemImage ? { uri: item.firstItemImage } : undefined}
              style={styles.image}
            />
            <View style={styles.cardContent}>
              <Text style={styles.title}>{item.firstItemTitle}</Text>
              <Text style={styles.muted}>{item.storeName} · {item.orderNumber}</Text>
              <Text style={styles.price}>{item.total.toFixed(2)} BDAG</Text>
            </View>
            <StatusBadge status={item.status} />
          </Pressable>}
        />}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.full, backgroundColor: Colors.surfaceElevated },
  selectedChip: { backgroundColor: Colors.primary },
  text: { color: Colors.textPrimary },
  list: { padding: Spacing.md, gap: Spacing.md, flexGrow: 1 },
  card: { flexDirection: 'row', gap: 12, padding: 12, backgroundColor: Colors.surfaceElevated, borderRadius: Radius.lg, alignItems: 'center' },
  cardContent: { flex: 1, minWidth: 0 },
  image: { width: 64, height: 64, borderRadius: Radius.md, backgroundColor: Colors.surfaceHighlight },
  title: { color: Colors.textPrimary, fontWeight: '700' },
  muted: { color: Colors.textSecondary },
  price: { color: Colors.primaryLight, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  retry: { minHeight: 44, padding: 12, backgroundColor: Colors.primary, borderRadius: Radius.md },
});
