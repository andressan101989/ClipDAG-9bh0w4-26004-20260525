import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { randomUUID } from 'expo-crypto';
import { useAlert } from '@/template';
import {
  fetchCategories, fetchSellerProductVariants, updateProduct,
  type MarketplaceCategoryRecord,
} from '@/services/marketplaceService';
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme';
import { SellerScreenHeader } from '@/components/marketplace/SellerScreenHeader';
import {
  fetchMyLiveAffiliateOffer,
  upsertMyLiveAffiliateOffer,
  type LiveAffiliateOffer,
} from '@/services/liveCommerceService';
import {
  creatorCommissionBpsToPercent,
  creatorCommissionPercentToBps,
} from '@/services/affiliateCommissionState';
import {
  fetchMyMarketplaceShippingProfiles,
  setMyMarketplaceProductShippingProfile,
  upsertMyMarketplaceShippingProfile,
  type MarketplaceShippingProfile,
} from '@/services/marketplaceShippingService';

export default function EditProduct() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { showAlert } = useAlert();
  const lock = useRef(false);
  const affiliateLock = useRef(false);
  const affiliateKey = useRef(randomUUID());
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('0');
  const [hasVariants, setHasVariants] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [categories, setCategories] = useState<MarketplaceCategoryRecord[]>([]);
  const [optionNames, setOptionNames] = useState<string[]>([]);
  const [variantCount, setVariantCount] = useState(1);
  const [activeVariantCount, setActiveVariantCount] = useState(1);
  const [totalInventory, setTotalInventory] = useState(0);
  const [priceRange, setPriceRange] = useState('');
  const [affiliateOffer, setAffiliateOffer] = useState<LiveAffiliateOffer | null>(null);
  const [affiliatePercent, setAffiliatePercent] = useState('10');
  const [affiliateBusy, setAffiliateBusy] = useState(false);
  const [storeId, setStoreId] = useState('');
  const [shippingProfiles, setShippingProfiles] = useState<MarketplaceShippingProfile[]>([]);
  const [shippingProfileId, setShippingProfileId] = useState('');
  const [shippingCountry, setShippingCountry] = useState('US');
  const [shippingPrice, setShippingPrice] = useState('0');
  const [returnPolicy, setReturnPolicy] = useState('Devoluciones aceptadas dentro de 14 días.');
  const [shippingBusy, setShippingBusy] = useState(false);
  useFocusEffect(React.useCallback(()=>{if(!storeId)return;let active=true;void fetchMyMarketplaceShippingProfiles(storeId).then(profiles=>{if(active)setShippingProfiles(profiles);});return()=>{active=false;};},[storeId]));

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetchSellerProductVariants(id),
      fetchCategories(),
      fetchMyLiveAffiliateOffer(id),
    ]).then(([inventory, values, offer]) => {
      if (!active) return;
      const product = inventory.detail.product;
      const variants = inventory.detail.variants.filter(item => item.status !== 'archived');
      const activeVariants = variants.filter(item => item.status === 'active');
      const prices = activeVariants.map(item => Number(item.price));
      setTitle(product.title);
      setStoreId(product.store_id);
      setDescription(product.description);
      setPrice(String(product.price));
      setStock(String(product.stock));
      setHasVariants(inventory.detail.options.length > 0 || variants.length > 1);
      setCategoryId(product.category_id);
      setTags(product.tags);
      setCategories(values);
      setOptionNames(inventory.detail.options.map(option => option.name));
      setVariantCount(variants.length);
      setActiveVariantCount(activeVariants.length);
      setTotalInventory(inventory.inventory.reduce((sum, level) => sum + level.available_quantity, 0));
      setPriceRange(prices.length
        ? `${Math.min(...prices).toFixed(2)}${Math.min(...prices) === Math.max(...prices) ? '' : ` – ${Math.max(...prices).toFixed(2)}`} BDAG`
        : 'Sin precio activo');
      setAffiliateOffer(offer);
      if (offer) setAffiliatePercent(creatorCommissionBpsToPercent(offer.commissionBps));
      void fetchMyMarketplaceShippingProfiles(product.store_id).then(profiles => {
        if (!active) return;
        setShippingProfiles(profiles);
        const selected = profiles.find(profile => profile.id === product.shipping_profile_id) ?? profiles[0];
        if (selected) {
          setShippingProfileId(selected.id);
          setShippingCountry(selected.regions[0]?.countryCode ?? selected.shipsFromCountry);
          setShippingPrice(String(selected.regions[0]?.shippingPrice ?? 0));
          setReturnPolicy(selected.returnPolicySummary);
        }
      });
    }).catch(() => {
      if (!active) return;
      showAlert('Producto no disponible', 'No puedes editar este producto.');
      router.back();
    });
    return () => { active = false; };
  }, [id, router, showAlert]);

  const save = async () => {
    if (lock.current) return;
    if (!/^\d{1,12}(?:\.\d{1,8})?$/.test(price) || Number(price) <= 0) {
      showAlert('Precio inválido', 'Usa hasta 8 decimales.');
      return;
    }
    lock.current = true;
    try {
      await updateProduct(id, {
        categoryId, title, description, price,
        stock: Math.max(0, Number.parseInt(stock, 10) || 0), tags,
      });
      showAlert('Producto actualizado', 'Los cambios se guardaron.');
      router.replace('/seller/products' as never);
    } catch {
      showAlert('No se pudo guardar', 'Verifica los datos e inténtalo nuevamente.');
    } finally {
      lock.current = false;
    }
  };

  const saveAffiliateOffer = async (status: 'active' | 'paused') => {
    if (affiliateLock.current) return;
    let commissionBps: number;
    try {
      commissionBps = creatorCommissionPercentToBps(affiliatePercent);
    } catch {
      showAlert('Comisión inválida', 'Ingresa un porcentaje entre 0.01% y 30%, con hasta dos decimales.');
      return;
    }
    affiliateLock.current = true;
    setAffiliateBusy(true);
    try {
      await upsertMyLiveAffiliateOffer({
        productId: id,
        offerScope: 'public_creator',
        creatorId: null,
        commissionBps,
        status,
        startsAt: affiliateOffer?.startsAt ?? null,
        endsAt: affiliateOffer?.endsAt ?? null,
        idempotencyKey: affiliateKey.current,
      });
      const next = await fetchMyLiveAffiliateOffer(id);
      setAffiliateOffer(next);
      affiliateKey.current = randomUUID();
      showAlert(
        status === 'active' ? 'Afiliados activados' : 'Afiliados desactivados',
        status === 'active'
          ? 'La nueva comisión se aplicará únicamente a futuras ventas elegibles.'
          : 'No se aceptarán nuevas compras afiliadas. Las ventas anteriores no cambian.',
      );
    } catch {
      showAlert('No se pudo actualizar', 'La configuración anterior se conserva. Inténtalo nuevamente.');
    } finally {
      affiliateLock.current = false;
      setAffiliateBusy(false);
    }
  };

  const saveShipping = async () => {
    if (shippingBusy || !storeId) return;
    const amount = Number(shippingPrice);
    if (!/^[A-Za-z]{2}$/.test(shippingCountry) || !Number.isFinite(amount) || amount < 0 || returnPolicy.trim().length < 2) {
      showAlert('Envío inválido', 'Revisa el país, el precio y la política de devolución.');
      return;
    }
    setShippingBusy(true);
    try {
      const existing = shippingProfiles.find(profile => profile.id === shippingProfileId && profile.configurationStatus === 'explicit_ready');
      const profileId = await upsertMyMarketplaceShippingProfile({
        profileId: existing?.id, storeId, name: `Envío ${shippingCountry.toUpperCase()}`,
        processingDaysMin: 1, processingDaysMax: 3, shipsFromCountry: shippingCountry,
        returnPolicySummary: returnPolicy.trim(), regions: [{ countryCode: shippingCountry, regionCode: null,
          shippingPrice: amount, freeShippingThreshold: null, transitDaysMin: 2, transitDaysMax: 7 }],
      });
      await setMyMarketplaceProductShippingProfile(id, profileId);
      const profiles = await fetchMyMarketplaceShippingProfiles(storeId);
      setShippingProfiles(profiles); setShippingProfileId(profileId);
      showAlert('Envío actualizado', 'Los próximos checkouts congelarán este precio y estimado.');
    } catch {
      showAlert('No se pudo guardar el envío', 'La configuración anterior se conserva.');
    } finally { setShippingBusy(false); }
  };

  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <SellerScreenHeader title="Editar producto" fallbackRoute="/seller/products" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>CONFIGURACIÓN DEL PRODUCTO</Text>
          <Text style={styles.heroTitle}>Información principal</Text>
          <Text style={styles.help}>Actualiza los datos que verá el comprador.</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.label}>Nombre del producto</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} maxLength={120} accessibilityLabel="Nombre del producto" />
          <Text style={styles.label}>Descripción</Text>
          <TextInput style={[styles.input, styles.note]} value={description} onChangeText={setDescription} multiline maxLength={3000} accessibilityLabel="Descripción" />
          <View style={styles.twoColumns}>
            <View style={styles.column}>
              <Text style={styles.label}>Precio proyectado</Text>
              <TextInput style={styles.input} value={price} onChangeText={setPrice} keyboardType="decimal-pad" editable={!hasVariants} accessibilityLabel="Precio" />
            </View>
            <View style={styles.column}>
              <Text style={styles.label}>Stock proyectado</Text>
              <TextInput style={styles.input} value={stock} onChangeText={setStock} keyboardType="number-pad" editable={!hasVariants} accessibilityLabel="Stock" />
            </View>
          </View>
          {hasVariants ? <Text style={styles.help}>El precio y el inventario se calculan desde las variantes activas.</Text> : null}
        </View>

        <View style={styles.setupCard}>
          <View style={styles.setupTop}>
            <View style={styles.setupIcon}><MaterialIcons name={hasVariants ? 'style' : 'inventory-2'} size={25} color={Colors.primaryLight} /></View>
            <View style={styles.setupCopy}>
              <Text style={styles.setupLabel}>TIPO DE PRODUCTO</Text>
              <Text style={styles.setupTitle}>{hasVariants ? 'Producto con variantes' : 'Producto simple'}</Text>
            </View>
          </View>
          {hasVariants ? (
            <>
              {optionNames.length ? <Text style={styles.optionNames}>{optionNames.join(' · ')}</Text> : null}
              <View style={styles.metrics}>
                <View style={styles.metric}><Text style={styles.metricValue}>{variantCount}</Text><Text style={styles.metricLabel}>variantes</Text></View>
                <View style={styles.metric}><Text style={styles.metricValue}>{activeVariantCount}</Text><Text style={styles.metricLabel}>activas</Text></View>
                <View style={styles.metric}><Text style={styles.metricValue}>{totalInventory}</Text><Text style={styles.metricLabel}>unidades</Text></View>
              </View>
              <Text style={styles.priceRange}>{priceRange}</Text>
              <Text style={styles.help}>Variantes e inventario: edita combinaciones, precios y usa Establecer o Ajustar para cambiar inventario existente.</Text>
            </>
          ) : (
            <Text style={styles.help}>Vende este producto en distintos colores, tallas u otras opciones.</Text>
          )}
          <Pressable
            style={({ pressed }) => [styles.variantButton, pressed && { opacity: 0.75 }]}
            onPress={() => router.push(`/seller/product/${id}/variants` as never)}
            accessibilityRole="button"
          >
            <MaterialIcons name={hasVariants ? 'tune' : 'add-circle-outline'} size={20} color={Colors.textOnBrand} />
            <Text style={styles.variantText}>{hasVariants ? 'Administrar variantes' : 'Agregar variantes'}</Text>
            <MaterialIcons name="chevron-right" size={20} color={Colors.textOnBrand} />
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Categoría</Text>
          <View style={styles.categories}>
            {categories.map(item => (
              <Pressable
                key={item.id}
                style={[styles.chip, categoryId === item.id && styles.active]}
                onPress={() => setCategoryId(item.id)}
                accessibilityRole="radio"
                accessibilityState={{ checked: categoryId === item.id }}
              >
                <Text style={[styles.chipText, categoryId === item.id && styles.activeText]}>{item.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.card}>
          <View style={styles.affiliateHeading}>
            <View style={styles.setupCopy}>
              <Text style={styles.cardTitle}>Afiliados y comisiones</Text>
              <Text style={styles.help}>Permite que otros creadores vendan este producto en sus LIVE.</Text>
            </View>
            <Text style={[styles.status, affiliateOffer?.status === 'active' && styles.statusActive]}>
              {affiliateOffer?.status === 'active' ? 'Activa' : 'Desactivada'}
            </Text>
          </View>
          <Text style={styles.label}>Comisión del creador (%)</Text>
          <TextInput
            style={styles.input}
            value={affiliatePercent}
            onChangeText={value => { setAffiliatePercent(value); affiliateKey.current = randomUUID(); }}
            keyboardType="decimal-pad"
            editable={!affiliateBusy}
            accessibilityLabel="Porcentaje de comisión para creadores"
          />
          <Text style={styles.help}>Entre 0.01% y 30%. Los pedidos existentes conservan la comisión congelada al comprar.</Text>
          <View style={styles.estimate}>
            <Text style={styles.estimateTitle}>Neto estimado del vendedor</Text>
            <Text style={styles.help}>Precio − tarifa de plataforma − comisión del creador.</Text>
            <Text style={styles.help}>La tarifa de plataforma se calcula al pagar y no puede editarse aquí.</Text>
          </View>
          {affiliateOffer?.startsAt || affiliateOffer?.endsAt ? (
            <Text style={styles.help}>
              Vigencia: {affiliateOffer.startsAt ?? 'ahora'} — {affiliateOffer.endsAt ?? 'sin fecha de fin'}
            </Text>
          ) : null}
          <View style={styles.affiliateActions}>
            <Pressable
              style={[styles.variantButton, styles.affiliatePrimary, affiliateBusy && styles.disabled]}
              onPress={() => void saveAffiliateOffer('active')}
              disabled={affiliateBusy}
              accessibilityRole="button"
              accessibilityLabel={affiliateOffer?.status === 'active' ? 'Editar comisión' : 'Activar afiliados'}
            >
              <Text style={styles.variantText}>{affiliateOffer?.status === 'active' ? 'Editar comisión' : 'Activar afiliados'}</Text>
            </Pressable>
            {affiliateOffer?.status === 'active' ? (
              <Pressable
                style={[styles.secondaryButton, affiliateBusy && styles.disabled]}
                onPress={() => void saveAffiliateOffer('paused')}
                disabled={affiliateBusy}
                accessibilityRole="button"
                accessibilityLabel="Desactivar afiliados"
              >
                <Text style={styles.secondaryText}>Desactivar afiliados</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Envío</Text>
          <Text style={styles.help}>Configuración autoritativa para destinos, precio y entrega estimada.</Text>
          {shippingProfiles.filter(profile=>profile.configurationStatus!=='explicit_ready').map(profile=><View key={profile.id} style={styles.setupCard}><Text style={styles.setupTitle}>Configuración requerida</Text><Text style={styles.help}>{profile.productsUsing} productos vinculados no pueden aceptar compras hasta completar la configuración.</Text><Pressable style={styles.variantButton} onPress={()=>router.push({pathname:'/seller/shipping-profile',params:{storeId,profileId:profile.id}} as never)}><Text style={styles.variantText}>Configurar destinos</Text></Pressable></View>)}
          <Text style={styles.label}>País admitido (código de dos letras)</Text>
          <TextInput style={styles.input} value={shippingCountry} onChangeText={setShippingCountry} autoCapitalize="characters" maxLength={2} />
          <Text style={styles.label}>Precio de envío (BDAG)</Text>
          <TextInput style={styles.input} value={shippingPrice} onChangeText={setShippingPrice} keyboardType="decimal-pad" />
          <Text style={styles.label}>Política de devolución</Text>
          <TextInput style={[styles.input, styles.note]} value={returnPolicy} onChangeText={setReturnPolicy} multiline maxLength={1000} />
          <Text style={styles.help}>Preparación: 1–3 días · tránsito estimado: 2–7 días. El checkout conserva estos valores aunque el perfil cambie después.</Text>
          <Pressable style={[styles.variantButton, shippingBusy && styles.disabled]} disabled={shippingBusy} onPress={() => void saveShipping()} accessibilityRole="button">
            <Text style={styles.variantText}>Guardar envío</Text>
          </Pressable>
        </View>
        <Pressable style={styles.button} onPress={save}><Text style={styles.buttonText}>Guardar cambios</Text></Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxl, gap: Spacing.md },
  hero: { gap: 4, marginBottom: Spacing.xs },
  eyebrow: { color: Colors.primaryLight, fontSize: FontSize.xs, fontWeight: FontWeight.bold, letterSpacing: 1 },
  heroTitle: { color: Colors.textPrimary, fontSize: FontSize.xxl, fontWeight: FontWeight.extrabold },
  card: { padding: Spacing.lg, borderRadius: Radius.xl, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.borderSubtle, gap: Spacing.sm, ...Shadow.subtle },
  cardTitle: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  label: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  input: { minHeight: 52, backgroundColor: Colors.surfaceElevated, borderColor: Colors.border, borderWidth: 1, borderRadius: Radius.md, padding: Spacing.md, color: Colors.textPrimary },
  note: { height: 120, textAlignVertical: 'top' },
  twoColumns: { flexDirection: 'row', gap: Spacing.sm },
  column: { flex: 1, gap: 6 },
  help: { color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 20 },
  setupCard: { padding: Spacing.lg, borderRadius: Radius.xl, backgroundColor: Colors.primaryDim, borderWidth: 1, borderColor: Colors.primaryGlow, gap: Spacing.md, ...Shadow.brand },
  setupTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  setupIcon: { width: 50, height: 50, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primaryGlow },
  setupCopy: { flex: 1, gap: 3 },
  setupLabel: { color: Colors.primaryLight, fontSize: FontSize.xs, fontWeight: FontWeight.bold, letterSpacing: 1 },
  setupTitle: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  optionNames: { color: Colors.textPrimary, fontWeight: FontWeight.semibold },
  metrics: { flexDirection: 'row', gap: Spacing.sm },
  metric: { flex: 1, padding: 10, borderRadius: Radius.md, alignItems: 'center', backgroundColor: Colors.surfaceElevated },
  metricValue: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  metricLabel: { color: Colors.textSubtle, fontSize: FontSize.xs },
  priceRange: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
  variantButton: { minHeight: 52, paddingHorizontal: Spacing.md, borderRadius: Radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary },
  variantText: { flex: 1, color: Colors.textOnBrand, textAlign: 'center', fontWeight: FontWeight.bold },
  categories: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 13, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border },
  active: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { color: Colors.textSecondary },
  activeText: { color: Colors.textOnBrand, fontWeight: FontWeight.bold },
  button: { minHeight: 54, backgroundColor: Colors.primary, padding: Spacing.md, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', ...Shadow.brand },
  buttonText: { color: Colors.textOnBrand, fontWeight: FontWeight.bold },
  affiliateHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  status: { color: Colors.textSecondary, backgroundColor: Colors.surfaceElevated, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 6, fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  statusActive: { color: Colors.success, borderWidth: 1, borderColor: Colors.success },
  estimate: { padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.surfaceElevated, gap: 4 },
  estimateTitle: { color: Colors.textPrimary, fontWeight: FontWeight.bold },
  affiliateActions: { gap: Spacing.sm },
  affiliatePrimary: { width: '100%' },
  secondaryButton: { minHeight: 48, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: Colors.textPrimary, fontWeight: FontWeight.semibold },
  disabled: { opacity: 0.55 },
});
