import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAlert } from '@/template';
import {
  fetchCategories, fetchSellerProductVariants, updateProduct,
  type MarketplaceCategoryRecord,
} from '@/services/marketplaceService';
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from '@/constants/theme';
import { SellerScreenHeader } from '@/components/marketplace/SellerScreenHeader';

export default function EditProduct() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { showAlert } = useAlert();
  const lock = useRef(false);
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

  useEffect(() => {
    let active = true;
    void Promise.all([fetchSellerProductVariants(id), fetchCategories()]).then(([inventory, values]) => {
      if (!active) return;
      const product = inventory.detail.product;
      const variants = inventory.detail.variants.filter(item => item.status !== 'archived');
      const activeVariants = variants.filter(item => item.status === 'active');
      const prices = activeVariants.map(item => Number(item.price));
      setTitle(product.title);
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
});
