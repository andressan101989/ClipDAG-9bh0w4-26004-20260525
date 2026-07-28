import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
  TextInput, Modal, KeyboardAvoidingView, Platform,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
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
import {
  fetchMarketplaceProductDetail,type MarketplaceProductOption,type MarketplaceVariant,
} from '@/services/marketplaceService';

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { products, toggleSaveProduct, isSavedProduct } = useShop();
  const { showAlert } = useAlert();

  const [product, setProduct] = useState<Product | null>(null);
  const [options,setOptions]=useState<MarketplaceProductOption[]>([]);
  const [variants,setVariants]=useState<MarketplaceVariant[]>([]);
  const [selectedValues,setSelectedValues]=useState<Record<string,string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [orderModalVisible, setOrderModalVisible] = useState(false);
  const [shippingAddress, setShippingAddress] = useState('');
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);

  useEffect(() => {
    let active=true;
    if(!id){setNotFound(true);setIsLoading(false);return()=>{active=false;};}
    setIsLoading(true);
    void fetchMarketplaceProductDetail(id).then(value=>{
      if(!active)return;
      setProduct(value?.product??products.find(p=>p.id===id)??null);
      setOptions(value?.options??[]);setVariants(value?.variants??[]);
      const preferred=value?.variants.find(item=>item.is_default&&item.status==='active')
        ??value?.variants.find(item=>item.status==='active');
      if(preferred){
        const next:Record<string,string>={};
        for(const option of value?.options??[]){
          const match=option.values.find(item=>preferred.option_value_ids.includes(item.id));
          if(match) next[option.id]=match.id;
        }
        setSelectedValues(next);
      }
      setNotFound(!value);
    }).catch(()=>{if(active)setNotFound(true);}).finally(()=>{if(active)setIsLoading(false);});
    return()=>{active=false;};
  }, [id, products]);

  const handleOrder = async () => {
    if (!user) { showAlert('Inicia sesión', 'Necesitas una cuenta para comprar'); return; }
    if (!product) return;
    if (!shippingAddress.trim()) {
      showAlert('Dirección requerida', 'Ingresa tu dirección de envío');
      return;
    }
    setOrderModalVisible(false);
    showAlert('Checkout no disponible', 'Checkout BDAG pendiente de implementación');
  };

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <StatusBar style="light" />
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    );
  }
  if (!product || notFound) {
    return (
      <View style={[styles.container,styles.centered,{paddingTop:insets.top,paddingHorizontal:Spacing.lg}]}>
        <StatusBar style="light" />
        <MaterialIcons name="inventory-2" size={48} color={Colors.textSubtle} />
        <Text style={styles.sectionTitle}>Producto no disponible</Text>
        <Text style={[styles.description,{textAlign:'center'}]}>Este producto no existe o ya no está disponible.</Text>
        <CyberButton label="Volver" onPress={()=>router.back()} />
      </View>
    );
  }

  const isOwner = user?.id === product.seller_id;
  const isSaved = isSavedProduct(product.id);
  const selectedVariant=variants.find(variant=>
    variant.status==='active'&&options.every(option=>
      selectedValues[option.id]&&variant.option_value_ids.includes(selectedValues[option.id])
    )
  )??(options.length===0?variants.find(item=>item.is_default&&item.status==='active'):undefined);
  const effectivePrice=selectedVariant?.price??product.price;
  const available=selectedVariant?.available_quantity??product.stock;
  const totalPrice = effectivePrice * quantity;
  const hasDifferentPrices=product.variant_price_max!=null&&product.variant_price_max>product.price;
  const optionValueEnabled=(optionId:string,valueId:string)=>variants.some(variant=>{
    if(variant.status!=='active'||!variant.option_value_ids.includes(valueId)) return false;
    return options.every(option=>option.id===optionId||!selectedValues[option.id]
      ||variant.option_value_ids.includes(selectedValues[option.id]));
  });

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
                source={{ uri: selectedVariant?.image_url??product.images[selectedImageIndex] }}
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
            <Text style={styles.price}>
              {options.length>0&&!selectedVariant&&hasDifferentPrices?'Desde ':''}
              {effectivePrice.toFixed(2)} BDAG
            </Text>
            {selectedVariant?.compare_at_price!=null&&selectedVariant.compare_at_price>effectivePrice?
              <Text style={styles.comparePrice}>{selectedVariant.compare_at_price.toFixed(2)} BDAG</Text>:null}
            {product.total_sales > 0 ? (
              <View style={styles.salesBadge}>
                <MaterialIcons name="trending-up" size={12} color={Colors.accent} />
                <Text style={styles.salesText}>{product.total_sales} vendidos</Text>
              </View>
            ) : null}
          </View>

          {options.map(option=><View key={option.id} style={styles.optionBlock}>
            <Text style={styles.optionName}>{option.name}</Text>
            <View style={styles.optionValues}>
              {option.values.map(value=>{
                const enabled=optionValueEnabled(option.id,value.id);
                const selected=selectedValues[option.id]===value.id;
                return <Pressable key={value.id} disabled={!enabled}
                  style={[styles.optionChip,selected&&styles.optionChipSelected,!enabled&&styles.optionChipDisabled]}
                  onPress={()=>{
                    setSelectedValues(previous=>({...previous,[option.id]:value.id}));
                    setQuantity(1);
                  }}>
                  <Text style={[styles.optionChipText,selected&&styles.optionChipTextSelected]}>{value.value}</Text>
                </Pressable>;
              })}
            </View>
          </View>)}

          {/* Stock */}
          <View style={styles.stockRow}>
            <View style={[styles.stockDot, available > 0 ? styles.stockDotAvail : styles.stockDotOut]} />
            <Text style={[styles.stockText, available === 0 && { color: Colors.secondary }]}>
              {available > 10 ? 'En stock' : available > 0 ? `Solo ${available} disponibles` : 'Agotado'}
            </Text>
          </View>

          {/* Seller */}
          <Pressable
            style={styles.sellerCard}
            onPress={() => router.push(`/chat/${product.seller_id}`)}
          >
            <Avatar uri={product.seller?.avatar_url??''} username={product.seller?.username??'Vendedor'} size={42} showBorder />
            <View style={styles.sellerInfo}>
              <Text style={styles.sellerLabel}>Vendedor</Text>
              <Text style={styles.sellerName}>@{product.seller?.username??'Vendedor'}</Text>
            </View>
            <Pressable
              style={styles.contactBtn}
              onPress={() => router.push(`/chat/${product.seller_id}`)}
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
      {!isOwner && available > 0 && (options.length===0||selectedVariant) ? (
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
              onPress={() => setQuantity(q => Math.min(available, q + 1))}
              hitSlop={8}
            >
              <MaterialIcons name="add" size={18} color={Colors.textPrimary} />
            </Pressable>
          </View>

          <Pressable
            style={styles.buyBtn}
            onPress={() => {
              if (!user) { showAlert('Inicia sesión', 'Necesitas una cuenta para comprar'); return; }
              showAlert('Checkout no disponible', 'Checkout BDAG pendiente de implementación');
            }}
          >
            <Text style={styles.buyBtnPrice}>{totalPrice.toFixed(2)} BDAG</Text>
            <Text style={styles.buyBtnText}>Checkout próximamente</Text>
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
                <Text style={styles.orderTotal}>Total: {totalPrice.toFixed(2)} BDAG</Text>
              </View>
            </View>

            {product.product_type === 'physical' ? (
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
              label={isLoading ? 'Procesando...' : `Confirmar pedido · ${totalPrice.toFixed(2)} BDAG`}
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
  comparePrice:{color:Colors.textSubtle,textDecorationLine:'line-through',fontSize:FontSize.sm},
  optionBlock:{gap:Spacing.sm,marginTop:Spacing.md},
  optionName:{color:Colors.textPrimary,fontWeight:FontWeight.bold},
  optionValues:{flexDirection:'row',flexWrap:'wrap',gap:Spacing.sm},
  optionChip:{borderWidth:1,borderColor:Colors.border,borderRadius:Radius.md,paddingHorizontal:14,paddingVertical:9},
  optionChipSelected:{borderColor:Colors.primary,backgroundColor:Colors.primary+'22'},
  optionChipDisabled:{opacity:0.3},
  optionChipText:{color:Colors.textSecondary},
  optionChipTextSelected:{color:Colors.primary,fontWeight:FontWeight.bold},
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
