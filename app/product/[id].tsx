import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useShop } from '@/hooks/useShop';
import { useAuth } from '@/hooks/useAuth';
import { useMarketplaceCart } from '@/hooks/useMarketplaceCart';
import { useAlert } from '@/template';
import { CyberButton } from '@/components/ui/CyberButton';
import { Avatar } from '@/components/ui/Avatar';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import type { Product } from '@/contexts/ShopContext';
import {
  fetchMarketplaceProductDetail,MarketplaceReadError,type MarketplaceProductOption,type MarketplaceVariant,
} from '@/services/marketplaceService';
import {
  isOptionValueSelectable, reconcileVariantSelection, resolveExactVariant, selectionForPreferredVariant,
} from '@/services/marketplaceVariantSelection';
import {isPublicMarketplaceImageUrl} from '@/services/marketplaceCart';
import {MarketplaceShippingQuoteCard} from '@/components/marketplace/MarketplaceShippingQuoteCard';

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { products, toggleSaveProduct, isSavedProduct } = useShop();
  const {addItem,totalQuantity}=useMarketplaceCart();
  const { showAlert } = useAlert();

  const [product, setProduct] = useState<Product | null>(null);
  const [options,setOptions]=useState<MarketplaceProductOption[]>([]);
  const [variants,setVariants]=useState<MarketplaceVariant[]>([]);
  const [selectedValues,setSelectedValues]=useState<Record<string,string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [readError,setReadError]=useState<'permission'|'transport'|null>(null);
  const [quantity, setQuantity] = useState(1);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const addToCartLockRef=useRef(false);

  useEffect(() => {
    let active=true;
    if(!id){setNotFound(true);setIsLoading(false);return()=>{active=false;};}
    setIsLoading(true);
    void fetchMarketplaceProductDetail(id).then(value=>{
      if(!active)return;
      setProduct(value?.product??products.find(p=>p.id===id)??null);
      setOptions(value?.options??[]);setVariants(value?.variants??[]);
      setSelectedValues(selectionForPreferredVariant(value?.options??[],value?.variants??[]));
      setNotFound(!value);setReadError(null);
    }).catch(error=>{if(active){if(error instanceof MarketplaceReadError&&error.code==='marketplace_read_permission')setReadError('permission');else if(error instanceof MarketplaceReadError&&error.code==='marketplace_read_transport')setReadError('transport');else setNotFound(true);}}).finally(()=>{if(active)setIsLoading(false);});
    return()=>{active=false;};
  }, [id, products]);

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
        <Text style={styles.sectionTitle}>{readError?'No pudimos cargar el producto':'Producto no disponible'}</Text>
        <Text style={[styles.description,{textAlign:'center'}]}>{readError==='permission'?'La tienda necesita una actualización de configuración. Inténtalo nuevamente.':readError==='transport'?'Revisa tu conexión e inténtalo nuevamente.':'Este producto no existe o ya no está disponible.'}</Text>
        <CyberButton label="Volver" onPress={()=>router.back()} />
      </View>
    );
  }

  const isOwner = user?.id === product.seller_id;
  const isSaved = isSavedProduct(product.id);
  const activeVariants=variants.filter(variant=>variant.status==='active');
  const selectedVariant=options.length>0
    ?resolveExactVariant(options,variants,selectedValues)
    :activeVariants.find(item=>item.is_default)??activeVariants[0];
  const effectivePrice=selectedVariant?.price??product.price;
  const available=selectedVariant?.available_quantity??0;
  const totalPrice = effectivePrice * quantity;
  const hasDifferentPrices=product.variant_price_max!=null&&product.variant_price_max>product.price;
  const displayImage=selectedVariant?.image_url??product.images[selectedImageIndex];
  const selectionIncomplete=options.length>0&&!selectedVariant;
  const handleAddToCart=()=>{
    if(addToCartLockRef.current||isOwner||!selectedVariant||available<=0||!Number.isInteger(quantity)||quantity<1||quantity>available)return;
    addToCartLockRef.current=true;
    try{
      const selectedOptions=options.flatMap(option=>{
        const valueId=selectedValues[option.id];
        const value=option.values.find(candidate=>candidate.id===valueId&&selectedVariant.option_value_ids.includes(candidate.id));
        return value?[{optionId:option.id,optionName:option.name,valueId:value.id,value:value.value}]:[];
      });
      if(selectedOptions.length!==options.length)return;
      const imageUrl=[selectedVariant.image_url,product.images[selectedImageIndex],product.images[0]]
        .find(candidate=>candidate&&isPublicMarketplaceImageUrl(candidate))??null;
      const result=addItem({productId:product.id,variantId:selectedVariant.id,sellerId:product.seller_id,
        storeId:product.store_id,title:product.title,sellerUsername:product.seller?.username??null,
        sku:selectedVariant.sku,imageUrl,options:selectedOptions,currency:'BDAG',unitPrice:selectedVariant.price,
        compareAtPrice:selectedVariant.compare_at_price,quantity,availableQuantitySnapshot:selectedVariant.available_quantity,
        productUpdatedAt:product.updated_at});
      if(!result.ok){
        showAlert('No se pudo agregar',result.code==='cart_limit_reached'?'Tu carrito alcanzó el máximo de productos.':'Revisa la variante y la cantidad.');
        return;
      }
      const adjusted=result.status==='quantity_adjusted';
      const optionText=selectedOptions.map(option=>option.value).join(' · ');
      Alert.alert(adjusted?'Cantidad ajustada':'Agregado al carrito',
        adjusted?`Solo hay ${result.applied} unidades disponibles para esta variante.`
          :`${product.title}${optionText?` · ${optionText}`:''} · Cantidad ${result.item.quantity}`,
        [{text:'Seguir comprando',style:'cancel'},{text:'Ver carrito',onPress:()=>router.push('/cart' as never)}]);
    }finally{addToCartLockRef.current=false;}
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <MaterialIcons name="arrow-back-ios" size={20} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{product.title}</Text>
        <Pressable style={styles.headerIcon} onPress={()=>router.push('/cart' as never)}
          accessibilityRole="button" accessibilityLabel={`Carrito, ${totalQuantity} productos`}>
          <MaterialIcons name="shopping-cart" size={24} color={Colors.textPrimary} />
          {totalQuantity>0?<View style={styles.cartBadge}><Text style={styles.cartBadgeText}>{totalQuantity>99?'99+':totalQuantity}</Text></View>:null}
        </Pressable>
        <Pressable style={styles.headerIcon} onPress={() => toggleSaveProduct(product.id)} hitSlop={8}>
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
          {displayImage ? (
            <>
              <Image
                source={{ uri: displayImage }}
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
                const enabled=isOptionValueSelectable(variants,value.id);
                const selected=selectedValues[option.id]===value.id;
                return <Pressable key={value.id} disabled={!enabled}
                  style={[styles.optionChip,selected&&styles.optionChipSelected,!enabled&&styles.optionChipDisabled]}
                  accessibilityRole="radio"
                  accessibilityLabel={`${option.name} ${value.value}`}
                  accessibilityState={{selected,disabled:!enabled}}
                  onPress={()=>{
                    setSelectedValues(previous=>reconcileVariantSelection(
                      options,variants,previous,option.id,value.id,
                    ));
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
              {selectionIncomplete?'Completa tus opciones'
                :available > 10 ? 'En stock' : available > 0 ? `Solo ${available} disponibles` : 'Agotado'}
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

          <MarketplaceShippingQuoteCard productId={product.id} quantity={quantity}/>

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
      {!isOwner && selectedVariant && available > 0 ? (
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
            onPress={handleAddToCart}
            accessibilityRole="button"
            accessibilityLabel={`Agregar ${product.title} al carrito`}
          >
            <MaterialIcons name="add-shopping-cart" size={18} color="#000" />
            <Text style={styles.buyBtnPrice}>{totalPrice.toFixed(2)} BDAG</Text>
            <Text style={styles.buyBtnText}>Agregar al carrito</Text>
          </Pressable>
        </View>
      ) : isOwner ? (
        <View style={[styles.buyBar, { paddingBottom: insets.bottom + Spacing.sm }]}>
          <Text style={styles.ownerNote}>Este es tu producto</Text>
        </View>
      ) : activeVariants.length===0 ? (
        <View style={[styles.buyBar, { paddingBottom: insets.bottom + Spacing.sm }]}>
          <Text style={styles.soldOutNote}>Producto agotado</Text>
        </View>
      ) : selectionIncomplete ? (
        <View style={[styles.buyBar, { paddingBottom: insets.bottom + Spacing.sm }]}>
          <Text style={styles.soldOutNote}>Completa tus opciones</Text>
        </View>
      ) : (
        <View style={[styles.buyBar, { paddingBottom: insets.bottom + Spacing.sm }]}>
          <Text style={styles.soldOutNote}>Esta combinación está agotada</Text>
        </View>
      )}
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
  headerIcon:{width:44,height:44,alignItems:'center',justifyContent:'center'},
  cartBadge:{position:'absolute',right:1,top:1,minWidth:18,height:18,paddingHorizontal:3,borderRadius:9,backgroundColor:Colors.secondary,alignItems:'center',justifyContent:'center'},
  cartBadgeText:{color:'#fff',fontSize:9,fontWeight:FontWeight.bold},
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
  optionChip:{minHeight:44,justifyContent:'center',borderWidth:1,borderColor:Colors.border,borderRadius:Radius.md,paddingHorizontal:14,paddingVertical:9},
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
});
