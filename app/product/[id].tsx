import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
  TextInput, Modal, KeyboardAvoidingView, Platform,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useShop } from '@/hooks/useShop';
import { useAuth } from '@/hooks/useAuth';
import { useAlert } from '@/template';
import { CyberButton } from '@/components/ui/CyberButton';
import { Avatar } from '@/components/ui/Avatar';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import type { Product } from '@/contexts/ShopContext';

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { products, placeOrder, toggleSaveProduct, isSavedProduct } = useShop();
  const { showAlert } = useAlert();

  const [product, setProduct] = useState<Product | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [orderModalVisible, setOrderModalVisible] = useState(false);
  const [shippingAddress, setShippingAddress] = useState('');
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);

  useEffect(() => {
    if (id) {
      const found = products.find(p => p.id === id);
      if (found) setProduct(found);
    }
  }, [id, products]);

  const handleOrder = async () => {
    if (!user) { showAlert('Inicia sesión', 'Necesitas una cuenta para comprar'); return; }
    if (!product) return;
    if (!shippingAddress.trim() && product.category === 'physical') {
      showAlert('Dirección requerida', 'Ingresa tu dirección de envío');
      return;
    }
    setIsLoading(true);
    const result = await placeOrder(product.id, quantity, shippingAddress.trim());
    setIsLoading(false);

    if (result.success) {
      setOrderModalVisible(false);
      showAlert('¡Pedido realizado!', `Tu pedido #${result.orderId?.substring(0, 8)} ha sido confirmado. El vendedor se pondrá en contacto pronto.`, [
        { text: 'Ver mis pedidos', onPress: () => router.push('/my-orders') },
        { text: 'OK' },
      ]);
    } else {
      showAlert('Error', result.error || 'No se pudo procesar el pedido');
    }
  };

  if (!product) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <StatusBar style="light" />
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    );
  }

  const isOwner = user?.id === product.sellerId;
  const isSaved = isSavedProduct(product.id);
  const totalPrice = product.price * quantity;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <MaterialIcons name="arrow-back-ios" size={20} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{product.title}</Text>
        <Pressable onPress={() => toggleSaveProduct(product.id)} hitSlop={8}>
          <MaterialIcons
            name={isSaved ? 'bookmark' : 'bookmark-border'}
            size={24}
            color={isSaved ? Colors.warning : Colors.textSecondary}
          />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, { paddingBottom: 140 + insets.bottom }]}>
        {/* Images */}
        <View style={styles.imageSection}>
          {product.images.length > 0 ? (
            <>
              <Image
                source={{ uri: product.images[selectedImageIndex] }}
                style={styles.mainImage}
                contentFit="cover"
                transition={200}
              />
              {product.images.length > 1 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbRow}>
                  {product.images.map((img, i) => (
                    <Pressable key={i} onPress={() => setSelectedImageIndex(i)}>
                      <Image
                        source={{ uri: img }}
                        style={[styles.thumbImg, i === selectedImageIndex && styles.thumbImgActive]}
                        contentFit="cover"
                        transition={200}
                      />
                    </Pressable>
                  ))}
                </ScrollView>
              ) : null}
            </>
          ) : (
            <View style={styles.imagePlaceholder}>
              <MaterialIcons name="image" size={64} color={Colors.textSubtle} />
            </View>
          )}
        </View>

        {/* Product info */}
        <View style={styles.infoSection}>
          <View style={styles.titleRow}>
            <Text style={styles.productTitle}>{product.title}</Text>
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryBadgeText}>{product.category}</Text>
            </View>
          </View>

          <View style={styles.priceRow}>
            <Text style={styles.price}>${product.price.toFixed(2)}</Text>
            <Text style={styles.currency}>{product.currency}</Text>
            {product.totalSales > 0 ? (
              <View style={styles.salesBadge}>
                <MaterialIcons name="trending-up" size={12} color={Colors.accent} />
                <Text style={styles.salesText}>{product.totalSales} vendidos</Text>
              </View>
            ) : null}
          </View>

          {/* Stock */}
          <View style={styles.stockRow}>
            <View style={[styles.stockDot, product.stock > 0 ? styles.stockDotAvail : styles.stockDotOut]} />
            <Text style={[styles.stockText, product.stock === 0 && { color: Colors.secondary }]}>
              {product.stock > 10 ? 'En stock' : product.stock > 0 ? `Solo ${product.stock} disponibles` : 'Agotado'}
            </Text>
          </View>

          {/* Seller */}
          <Pressable
            style={styles.sellerCard}
            onPress={() => router.push(`/chat/${product.sellerId}`)}
          >
            <Avatar uri={product.sellerAvatar} username={product.sellerUsername} size={42} showBorder />
            <View style={styles.sellerInfo}>
              <Text style={styles.sellerLabel}>Vendedor</Text>
              <Text style={styles.sellerName}>@{product.sellerUsername}</Text>
            </View>
            <Pressable
              style={styles.contactBtn}
              onPress={() => router.push(`/chat/${product.sellerId}`)}
            >
              <MaterialIcons name="chat" size={16} color={Colors.primary} />
              <Text style={styles.contactBtnText}>Contactar</Text>
            </Pressable>
          </Pressable>

          {/* Description */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Descripción</Text>
            <Text style={styles.description}>{product.description || 'Sin descripción disponible.'}</Text>
          </View>

          {/* Tags */}
          {product.tags.length > 0 ? (
            <View style={styles.tagsWrap}>
              {product.tags.map(tag => (
                <View key={tag} style={styles.tag}>
                  <Text style={styles.tagText}>#{tag}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* Buy bar */}
      {!isOwner && product.stock > 0 ? (
        <View style={[styles.buyBar, { paddingBottom: insets.bottom + Spacing.sm }]}>
          {/* Quantity */}
          <View style={styles.quantityControl}>
            <Pressable
              style={styles.quantityBtn}
              onPress={() => setQuantity(q => Math.max(1, q - 1))}
              hitSlop={8}
            >
              <MaterialIcons name="remove" size={18} color={Colors.textPrimary} />
            </Pressable>
            <Text style={styles.quantityValue}>{quantity}</Text>
            <Pressable
              style={styles.quantityBtn}
              onPress={() => setQuantity(q => Math.min(product.stock, q + 1))}
              hitSlop={8}
            >
              <MaterialIcons name="add" size={18} color={Colors.textPrimary} />
            </Pressable>
          </View>

          <Pressable
            style={styles.buyBtn}
            onPress={() => {
              if (!user) { showAlert('Inicia sesión', 'Necesitas una cuenta para comprar'); return; }
              setOrderModalVisible(true);
            }}
          >
            <Text style={styles.buyBtnPrice}>${totalPrice.toFixed(2)}</Text>
            <Text style={styles.buyBtnText}>Comprar ahora</Text>
          </Pressable>
        </View>
      ) : isOwner ? (
        <View style={[styles.buyBar, { paddingBottom: insets.bottom + Spacing.sm }]}>
          <Text style={styles.ownerNote}>Este es tu producto</Text>
        </View>
      ) : (
        <View style={[styles.buyBar, { paddingBottom: insets.bottom + Spacing.sm }]}>
          <Text style={styles.soldOutNote}>Producto agotado</Text>
        </View>
      )}

      {/* Order modal */}
      <Modal visible={orderModalVisible} transparent animationType="slide" presentationStyle="overFullScreen">
        <Pressable style={styles.modalBackdrop} onPress={() => setOrderModalVisible(false)} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
            <View style={styles.modalHeader}>
              <View style={styles.handleBar} />
              <Text style={styles.modalTitle}>Confirmar pedido</Text>
              <Pressable onPress={() => setOrderModalVisible(false)} hitSlop={8}>
                <MaterialIcons name="close" size={22} color={Colors.textSecondary} />
              </Pressable>
            </View>

            <View style={styles.orderSummary}>
              {product.images[0] ? (
                <Image source={{ uri: product.images[0] }} style={styles.orderThumb} contentFit="cover" />
              ) : null}
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.orderProductTitle} numberOfLines={2}>{product.title}</Text>
                <Text style={styles.orderQty}>Cantidad: {quantity}</Text>
                <Text style={styles.orderTotal}>Total: ${totalPrice.toFixed(2)} {product.currency}</Text>
              </View>
            </View>

            {product.category === 'physical' ? (
              <View style={styles.formField}>
                <Text style={styles.fieldLabel}>Dirección de envío</Text>
                <TextInput
                  style={[styles.fieldInput, { height: 80, textAlignVertical: 'top' }]}
                  value={shippingAddress}
                  onChangeText={setShippingAddress}
                  placeholder="Calle, número, ciudad, país..."
                  placeholderTextColor={Colors.textSubtle}
                  multiline
                />
              </View>
            ) : (
              <View style={styles.digitalNote}>
                <MaterialIcons name="cloud-download" size={18} color={Colors.primary} />
                <Text style={styles.digitalNoteText}>
                  Producto digital — recibirás el enlace de descarga por mensaje
                </Text>
              </View>
            )}

            <CyberButton
              label={isLoading ? 'Procesando...' : `Confirmar pedido • $${totalPrice.toFixed(2)}`}
              onPress={handleOrder}
              loading={isLoading}
              size="lg"
              fullWidth
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  centered: { alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm,
  },
  backBtn: { padding: 4 },
  headerTitle: { flex: 1, color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  scroll: { gap: Spacing.md },
  imageSection: {},
  mainImage: { width: '100%', height: 340 },
  imagePlaceholder: {
    height: 280, backgroundColor: Colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  thumbRow: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, gap: Spacing.sm },
  thumbImg: {
    width: 60, height: 60, borderRadius: Radius.sm,
    borderWidth: 1, borderColor: Colors.border,
  },
  thumbImgActive: { borderColor: Colors.primary, borderWidth: 2 },
  infoSection: { paddingHorizontal: Spacing.md, gap: Spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  productTitle: { flex: 1, color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: FontWeight.bold, lineHeight: 28 },
  categoryBadge: {
    backgroundColor: Colors.primaryDim, borderRadius: Radius.full,
    paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: Colors.primary + '44',
  },
  categoryBadgeText: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: FontWeight.medium },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.xs },
  price: { color: Colors.primary, fontSize: FontSize.xxxl, fontWeight: FontWeight.extrabold },
  currency: { color: Colors.textSecondary, fontSize: FontSize.md },
  salesBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.accentDim, borderRadius: Radius.full,
    paddingHorizontal: 8, paddingVertical: 3, marginLeft: Spacing.sm,
  },
  salesText: { color: Colors.accent, fontSize: FontSize.xs, fontWeight: FontWeight.medium },
  stockRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  stockDot: { width: 8, height: 8, borderRadius: 4 },
  stockDotAvail: { backgroundColor: Colors.accent },
  stockDotOut: { backgroundColor: Colors.secondary },
  stockText: { color: Colors.accent, fontSize: FontSize.sm },
  sellerCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.border,
  },
  sellerInfo: { flex: 1 },
  sellerLabel: { color: Colors.textSubtle, fontSize: FontSize.xs },
  sellerName: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  contactBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primaryDim, borderRadius: Radius.md,
    paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: Colors.primary + '44',
  },
  contactBtnText: { color: Colors.primary, fontSize: FontSize.xs, fontWeight: FontWeight.medium },
  section: { gap: Spacing.xs },
  sectionTitle: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  description: { color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 22 },
  tagsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  tag: {
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.full,
    paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: Colors.border,
  },
  tagText: { color: Colors.textSecondary, fontSize: FontSize.xs },
  buyBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.md, paddingTop: Spacing.md,
    backgroundColor: Colors.bg, borderTopWidth: 1, borderTopColor: Colors.border,
  },
  quantityControl: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs,
    borderWidth: 1, borderColor: Colors.border,
  },
  quantityBtn: { padding: Spacing.xs },
  quantityValue: {
    color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.bold,
    minWidth: 28, textAlign: 'center',
  },
  buyBtn: {
    flex: 1, backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingVertical: 14, alignItems: 'center', flexDirection: 'row',
    justifyContent: 'center', gap: Spacing.sm,
  },
  buyBtnPrice: { color: '#000', fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  buyBtnText: { color: '#000', fontSize: FontSize.md, fontWeight: FontWeight.bold },
  ownerNote: { flex: 1, color: Colors.textSecondary, textAlign: 'center', fontSize: FontSize.sm },
  soldOutNote: { flex: 1, color: Colors.secondary, textAlign: 'center', fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  modalSheet: {
    backgroundColor: Colors.surfaceElevated, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: Spacing.lg, gap: Spacing.md,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.xs },
  handleBar: {
    position: 'absolute', top: -16, left: '50%', marginLeft: -20,
    width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border,
  },
  modalTitle: { flex: 1, color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.semibold, textAlign: 'center' },
  orderSummary: {
    flexDirection: 'row', gap: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: Radius.md, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.border,
  },
  orderThumb: { width: 70, height: 70, borderRadius: Radius.sm },
  orderProductTitle: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  orderQty: { color: Colors.textSecondary, fontSize: FontSize.sm },
  orderTotal: { color: Colors.primary, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  formField: { gap: Spacing.xs },
  fieldLabel: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  fieldInput: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    color: Colors.textPrimary, fontSize: FontSize.md,
  },
  digitalNote: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.primaryDim, borderRadius: Radius.md, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.primary + '33',
  },
  digitalNoteText: { flex: 1, color: Colors.primary, fontSize: FontSize.sm, lineHeight: 18 },
});
