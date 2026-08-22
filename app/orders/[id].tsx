import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { fetchBuyerOrder, isSafeTrackingUrl, type MarketplaceOrderDetail } from '@/services/marketplaceFulfillmentService';
import { OrderTimeline, StatusBadge } from '@/components/marketplace/OrderStatus';
import { SellerScreenHeader } from '@/components/marketplace/SellerScreenHeader';
import { MarketplaceDisputePanel } from '@/components/marketplace/MarketplaceDisputePanel';
import { confirmMarketplaceOrderDelivery, MarketplaceSettlementError } from '@/services/marketplaceSettlementService';
import { buyerOrderProtectionMessage } from '@/services/marketplaceOrderPresentation';

export default function BuyerOrder() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<MarketplaceOrderDetail | null>(null);
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [settling, setSettling] = useState(false);
  const settlementLock = useRef(false);
  const settlementKey = useRef(randomUUID());
  const load = useCallback(async () => {
    if (!id) { setState('error'); return; }
    setState('loading');
    try { setData(await fetchBuyerOrder(id)); setState('loaded'); }
    catch { setData(null); setState('error'); }
  }, [id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  if (state === 'loading') return <View style={[styles.root, styles.center, { paddingTop: insets.top }]}><ActivityIndicator color={Colors.primary} /></View>;
  if (state === 'error' || !data) return <View style={[styles.root, { paddingTop: insets.top }]}><SellerScreenHeader title="Pedido no disponible" fallbackRoute="/orders" /><View style={styles.center}><Text style={styles.title}>Pedido no disponible</Text><Text style={styles.muted}>No pudimos cargar este pedido.</Text><Pressable style={styles.button} onPress={() => void load()}><Text style={styles.buttonText}>Reintentar</Text></Pressable></View></View>;
  const confirmDelivery = () => Alert.alert('Confirmar recepción', 'Confirma únicamente si recibiste el pedido en buenas condiciones. Esto puede liberar los fondos retenidos al vendedor.', [
    { text: 'Volver', style: 'cancel' },
    { text: 'Sí, confirmar recepción', onPress: async () => {
      if (settlementLock.current || !id) return;
      settlementLock.current = true; setSettling(true);
      try { await confirmMarketplaceOrderDelivery(id, settlementKey.current); await load(); }
      catch (error) {
        const code = error instanceof MarketplaceSettlementError ? error.code : 'marketplace_settlement_unknown';
        Alert.alert('No se pudo confirmar', code === 'marketplace_settlement_transport' ? 'Revisa tu conexión. No se duplicó ninguna liberación.' : 'El pedido no es elegible o tiene una disputa activa.');
      } finally { settlementLock.current = false; setSettling(false); }
    } },
  ]);
  const track = async () => {
    const url = data.shipment?.trackingUrl;
    if (!url || !isSafeTrackingUrl(url)) return;
    if (await Linking.canOpenURL(url)) await Linking.openURL(url);
    else Alert.alert('Enlace no disponible', 'No se pudo abrir el seguimiento.');
  };
  return <View style={[styles.root, { paddingTop: insets.top }]}><SellerScreenHeader title="Detalle del pedido" fallbackRoute="/orders" /><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <View style={styles.row}><View><Text style={styles.title}>{data.order.orderNumber}</Text><Text style={styles.muted}>{data.store.name}</Text></View><StatusBadge status={data.order.status} /></View>
    <View style={styles.card}><Text style={styles.heading}>Productos</Text>{data.items.map(item => <View key={item.id} style={styles.row}><View style={styles.flex}><Text style={styles.text}>{item.productTitle}</Text><Text style={styles.muted}>{item.options.map(option => option.value).join(' · ')} · Cantidad {item.quantity}</Text></View><Text style={styles.text}>{item.lineTotal.toFixed(2)} BDAG</Text></View>)}{data.shippingAmount > 0 ? <Text style={styles.text}>Envío · {data.shippingAmount.toFixed(2)} BDAG</Text> : null}<Text style={styles.total}>Total · {data.order.total.toFixed(2)} BDAG</Text></View>
    <View style={styles.card}><Text style={styles.heading}>Entrega</Text><Text style={styles.text}>{data.shippingAddress.recipientName}</Text><Text style={styles.muted}>{data.shippingAddress.city}, {data.shippingAddress.region} · {data.shippingAddress.country}</Text>{data.shipment ? <><Text style={styles.text}>{data.shipment.carrierName} · {data.shipment.trackingNumber}</Text>{data.shipment.estimatedDeliveryAt ? <Text style={styles.muted}>Entrega estimada: {new Date(data.shipment.estimatedDeliveryAt).toLocaleDateString()}</Text> : null}{data.shipment.trackingUrl ? <Pressable style={styles.button} onPress={() => void track()}><Text style={styles.buttonText}>Ver seguimiento</Text></Pressable> : null}</> : <Text style={styles.muted}>El vendedor todavía está preparando el pedido.</Text>}</View>
    <View style={styles.card}><Text style={styles.heading}>Historial</Text><OrderTimeline events={data.events} /></View>
    <Text style={styles.protect}>{buyerOrderProtectionMessage(data.order.status, data.dispute)}</Text>
    {data.order.status === 'shipped' && !data.dispute ? <><Pressable style={styles.button} disabled={settling} onPress={confirmDelivery} accessibilityRole="button"><Text style={styles.buttonText}>{settling ? 'Confirmando…' : 'Confirmar recepción'}</Text></Pressable><MarketplaceDisputePanel orderId={data.order.id} items={data.items} current={data.dispute} onSubmitted={load} /></> : null}
    {data.dispute ? <MarketplaceDisputePanel orderId={data.order.id} items={data.items} current={data.dispute} onSubmitted={load} /> : null}
    <Pressable style={styles.outline} onPress={() => router.push(`/checkout/reservation/${data.order.checkoutId}` as never)}><Text style={styles.buttonText}>Ver recibo de pago</Text></Pressable>
  </ScrollView></View>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: Colors.bg }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }, content: { padding: Spacing.md, gap: Spacing.md, paddingBottom: 40 }, row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 }, flex: { flex: 1 }, title: { color: Colors.textPrimary, fontSize: 20, fontWeight: '800' }, heading: { color: Colors.textPrimary, fontWeight: '800' }, text: { color: Colors.textPrimary }, muted: { color: Colors.textSecondary }, card: { backgroundColor: Colors.surfaceElevated, borderRadius: Radius.lg, padding: Spacing.md, gap: 12 }, total: { color: Colors.primaryLight, fontWeight: '800', textAlign: 'right' }, protect: { color: Colors.accent, textAlign: 'center' }, button: { minHeight: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.primary, borderRadius: Radius.md }, outline: { minHeight: 48, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: Colors.primary, borderRadius: Radius.md }, buttonText: { color: Colors.textPrimary, fontWeight: '700' } });
