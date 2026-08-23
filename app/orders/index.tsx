import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
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
import { formatOrderNumberForList } from '@/services/marketplaceOrderPresentation';

const PAGE = 20;
const COMPACT_BREAKPOINT = 390;
const ICON_ONLY_STATUS_BREAKPOINT = 350;
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
  const { width } = useWindowDimensions();
  const compact = width < COMPACT_BREAKPOINT;
  const iconOnlyStatus = width < ICON_ONLY_STATUS_BREAKPOINT;
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
      style={styles.filterRail}
    >
      {filters.map(([label, value]) => <Pressable
        key={label}
        accessibilityRole="tab"
        accessibilityState={{ selected: status === value }}
        hitSlop={2}
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
            accessibilityLabel={`Ver pedido ${item.orderNumber}`}
            accessibilityHint={item.returnProgress
              ? buyerReturnProgressLabel(
                  item.returnProgress.shippingStatus,
                  item.returnProgress.labelSent,
                )
              : undefined}
            accessibilityRole="button"
            style={[styles.card, compact && styles.cardCompact]}
            onPress={() => router.push(`/orders/${item.id}` as never)}
          >
            <Image
              source={item.firstItemImage ? { uri: item.firstItemImage } : undefined}
              style={[styles.image, compact && styles.imageCompact]}
            />
            <View style={styles.cardContent}>
              <Text style={styles.title} numberOfLines={2}>{item.firstItemTitle}</Text>
              <Text style={styles.muted} numberOfLines={1}>{item.storeName}</Text>
              <Text
                accessibilityLabel={`Pedido ${item.orderNumber}`}
                ellipsizeMode="middle"
                numberOfLines={1}
                style={styles.orderNumber}
              >
                {formatOrderNumberForList(item.orderNumber)}
              </Text>
              <Text style={styles.price} numberOfLines={1}>{item.total.toFixed(2)} BDAG</Text>
              {item.returnProgress ? <Text style={styles.returnProgress} numberOfLines={1}>
                {buyerReturnProgressLabel(
                  item.returnProgress.shippingStatus,
                  item.returnProgress.labelSent,
                )}
              </Text> : null}
            </View>
            <View style={styles.statusSlot}>
              <StatusBadge
                status={item.status}
                compact={compact}
                showLabel={!iconOnlyStatus}
              />
            </View>
          </Pressable>}
        />}
  </View>;
}

const buyerReturnProgressLabel = (
  status: NonNullable<MarketplaceOrderListItem['returnProgress']>['shippingStatus'],
  labelSent: boolean,
) => status === 'shipped'
  ? 'Devolución enviada'
  : status === 'awaiting_buyer_shipment'
    ? labelSent ? 'Label listo para imprimir' : 'Esperando label del vendedor'
    : 'Esperando instrucciones de devolución';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  filterRail: { flexGrow: 0, height: 52, maxHeight: 52 },
  filters: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6 },
  chip: { height: 40, maxHeight: 40, flexShrink: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderRadius: Radius.full, backgroundColor: Colors.surfaceElevated },
  selectedChip: { backgroundColor: Colors.primary },
  text: { color: Colors.textPrimary },
  list: { padding: Spacing.md, gap: Spacing.md, flexGrow: 1 },
  card: { flexDirection: 'row', gap: 12, padding: 12, backgroundColor: Colors.surfaceElevated, borderRadius: Radius.lg, alignItems: 'center' },
  cardCompact: { gap: 8, paddingHorizontal: 10 },
  cardContent: { flex: 1, flexShrink: 1, minWidth: 0 },
  image: { width: 64, height: 64, flexShrink: 0, borderRadius: Radius.md, backgroundColor: Colors.surfaceHighlight },
  imageCompact: { width: 56, height: 56 },
  statusSlot: { flexShrink: 0 },
  orderNumber: { color: Colors.textSecondary, flexShrink: 1, minWidth: 0 },
  title: { color: Colors.textPrimary, fontWeight: '700' },
  muted: { color: Colors.textSecondary },
  price: { color: Colors.primaryLight, fontWeight: '800' },
  returnProgress: { color: Colors.warning, fontSize: 12, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  retry: { minHeight: 44, padding: 12, backgroundColor: Colors.primary, borderRadius: Radius.md },
});
