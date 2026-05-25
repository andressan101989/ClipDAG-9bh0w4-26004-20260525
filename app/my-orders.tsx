import React from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useShop } from '@/hooks/useShop';
import { useAuth } from '@/hooks/useAuth';
import { useAlert } from '@/template';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { timeAgo } from '@/services/mockData';
import type { Order } from '@/contexts/ShopContext';

const STATUS_CONFIG: Record<Order['status'], { label: string; color: string; icon: string }> = {
  pending: { label: 'Pendiente', color: Colors.warning, icon: 'schedule' },
  confirmed: { label: 'Confirmado', color: Colors.primary, icon: 'check-circle' },
  shipped: { label: 'Enviado', color: Colors.purple, icon: 'local-shipping' },
  delivered: { label: 'Entregado', color: Colors.accent, icon: 'done-all' },
  cancelled: { label: 'Cancelado', color: Colors.secondary, icon: 'cancel' },
  refunded: { label: 'Reembolsado', color: Colors.textSecondary, icon: 'replay' },
};

function OrderCard({ order, isSeller, onUpdateStatus }: {
  order: Order;
  isSeller: boolean;
  onUpdateStatus: (id: string, status: Order['status']) => void;
}) {
  const status = STATUS_CONFIG[order.status];

  return (
    <View style={styles.orderCard}>
      {order.productImage ? (
        <Image source={{ uri: order.productImage }} style={styles.orderImg} contentFit="cover" transition={200} />
      ) : (
        <View style={[styles.orderImg, styles.orderImgPlaceholder]}>
          <MaterialIcons name="inventory" size={24} color={Colors.textSubtle} />
        </View>
      )}

      <View style={styles.orderInfo}>
        <Text style={styles.orderTitle} numberOfLines={2}>{order.productTitle}</Text>
        <Text style={styles.orderMeta}>Cant: {order.quantity} · ${order.totalPrice.toFixed(2)}</Text>
        <Text style={styles.orderTime}>{timeAgo(order.createdAt)}</Text>

        <View style={[styles.statusBadge, { backgroundColor: status.color + '22', borderColor: status.color + '44' }]}>
          <MaterialIcons name={status.icon as any} size={12} color={status.color} />
          <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
        </View>

        {/* Seller actions */}
        {isSeller && order.status === 'pending' ? (
          <View style={styles.actionRow}>
            <Pressable
              style={[styles.actionBtn, { borderColor: Colors.accent + '44', backgroundColor: Colors.accentDim }]}
              onPress={() => onUpdateStatus(order.id, 'confirmed')}
            >
              <Text style={[styles.actionBtnText, { color: Colors.accent }]}>Confirmar</Text>
            </Pressable>
            <Pressable
              style={[styles.actionBtn, { borderColor: Colors.secondary + '44', backgroundColor: Colors.secondaryDim }]}
              onPress={() => onUpdateStatus(order.id, 'cancelled')}
            >
              <Text style={[styles.actionBtnText, { color: Colors.secondary }]}>Rechazar</Text>
            </Pressable>
          </View>
        ) : isSeller && order.status === 'confirmed' ? (
          <Pressable
            style={[styles.actionBtn, { borderColor: Colors.purple + '44', backgroundColor: Colors.purple + '22' }]}
            onPress={() => onUpdateStatus(order.id, 'shipped')}
          >
            <MaterialIcons name="local-shipping" size={13} color={Colors.purple} />
            <Text style={[styles.actionBtnText, { color: Colors.purple }]}>Marcar enviado</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export default function MyOrdersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { myOrders, fetchMyOrders, updateOrderStatus, isLoading } = useShop();
  const { showAlert } = useAlert();

  const [tab, setTab] = React.useState<'buying' | 'selling'>('buying');

  const buyingOrders = myOrders.filter(o => o.buyerId === user?.id);
  const sellingOrders = myOrders.filter(o => o.sellerId === user?.id);
  const displayOrders = tab === 'buying' ? buyingOrders : sellingOrders;

  const handleUpdateStatus = async (orderId: string, status: Order['status']) => {
    const result = await updateOrderStatus(orderId, status);
    if (!result.success) showAlert('Error', result.error || 'No se pudo actualizar');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <MaterialIcons name="arrow-back-ios" size={20} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Mis Pedidos</Text>
        <View style={{ width: 30 }} />
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {(['buying', 'selling'] as const).map(t => (
          <Pressable
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'buying' ? `Comprando (${buyingOrders.length})` : `Vendiendo (${sellingOrders.length})`}
            </Text>
          </Pressable>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.primary} size="large" />
        </View>
      ) : displayOrders.length === 0 ? (
        <View style={styles.centered}>
          <MaterialIcons name="receipt-long" size={52} color={Colors.textSubtle} />
          <Text style={styles.emptyTitle}>
            {tab === 'buying' ? 'Sin pedidos aún' : 'Sin ventas aún'}
          </Text>
          <Text style={styles.emptySub}>
            {tab === 'buying' ? 'Explora la tienda para encontrar productos' : 'Crea un producto para empezar a vender'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={displayOrders}
          keyExtractor={item => item.id}
          contentContainerStyle={{ padding: Spacing.md, gap: Spacing.md, paddingBottom: 100 + insets.bottom }}
          renderItem={({ item }) => (
            <OrderCard
              order={item}
              isSeller={tab === 'selling'}
              onUpdateStatus={handleUpdateStatus}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm,
  },
  backBtn: { padding: 4 },
  headerTitle: { flex: 1, color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.semibold, textAlign: 'center' },
  tabs: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: Colors.primary },
  tabText: { color: Colors.textSubtle, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  tabTextActive: { color: Colors.primary, fontWeight: FontWeight.bold },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  emptyTitle: { color: Colors.textSecondary, fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  emptySub: { color: Colors.textSubtle, fontSize: FontSize.sm, textAlign: 'center', paddingHorizontal: Spacing.xl },
  orderCard: {
    flexDirection: 'row', gap: Spacing.md,
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.border,
  },
  orderImg: { width: 70, height: 70, borderRadius: Radius.sm },
  orderImgPlaceholder: { backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  orderInfo: { flex: 1, gap: 5 },
  orderTitle: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  orderMeta: { color: Colors.textSecondary, fontSize: FontSize.xs },
  orderTime: { color: Colors.textSubtle, fontSize: FontSize.xs },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, alignSelf: 'flex-start',
  },
  statusText: { fontSize: FontSize.xs, fontWeight: FontWeight.medium },
  actionRow: { flexDirection: 'row', gap: Spacing.sm },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: Radius.sm, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1,
  },
  actionBtnText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold },
});
