import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, TextInput,
  KeyboardAvoidingView, Platform, Switch,
} from 'react-native';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useShop } from '@/hooks/useShop';
import { useAuth } from '@/hooks/useAuth';
import { useAlert } from '@/template';
import { getSupabaseClient } from '@/template';
import { CyberButton } from '@/components/ui/CyberButton';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { uploadFileFromUri, detectMimeType } from '@/contexts/FeedContext';
import type { ProductCategory } from '@/contexts/ShopContext';

const CATEGORIES: { key: ProductCategory; label: string; icon: string }[] = [
  { key: 'digital', label: 'Digital', icon: 'cloud-download' },
  { key: 'art', label: 'Arte NFT', icon: 'palette' },
  { key: 'music', label: 'Música', icon: 'music-note' },
  { key: 'clothing', label: 'Ropa', icon: 'checkroom' },
  { key: 'physical', label: 'Físico', icon: 'inventory' },
  { key: 'other', label: 'Otro', icon: 'category' },
];

export default function CreateProductScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { createProduct } = useShop();
  const { showAlert } = useAlert();
  const supabase = getSupabaseClient();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState<ProductCategory>('digital');
  const [stock, setStock] = useState('1');
  const [tags, setTags] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [isUnlimitedStock, setIsUnlimitedStock] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  const handlePickImage = useCallback(async () => {
    if (images.length >= 4) { showAlert('Máximo 4 imágenes', 'Ya tienes el máximo de fotos'); return; }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { showAlert('Permiso denegado', 'Habilita el acceso a la galería'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      base64: true,
    });
    if (result.canceled || !result.assets[0] || !user) return;

    setIsUploadingImage(true);
    const asset = result.assets[0];
    const mimeType = asset.mimeType || detectMimeType(asset.uri, 'image/jpeg');
    const ext = mimeType.includes('png') ? 'png' : 'jpg';
    const fileName = `${user.id}/product_${Date.now()}_${images.length}.${ext}`;
    const url = await uploadFileFromUri(supabase, asset.uri, 'images', fileName, mimeType, asset.base64);
    setIsUploadingImage(false);

    if (url) {
      setImages(prev => [...prev, url]);
    } else {
      // Fallback: use local URI
      setImages(prev => [...prev, asset.uri]);
      showAlert('Nota', 'La imagen se usará localmente. Conecta el backend para guardarla en la nube.');
    }
  }, [images, user, supabase, showAlert]);

  const handlePublish = useCallback(async () => {
    if (!user) { showAlert('Inicia sesión', 'Necesitas una cuenta para vender'); return; }
    if (!title.trim()) { showAlert('Título requerido', 'Ingresa un título para tu producto'); return; }
    if (!price || isNaN(parseFloat(price)) || parseFloat(price) <= 0) {
      showAlert('Precio inválido', 'Ingresa un precio válido mayor a 0');
      return;
    }
    if (!description.trim()) { showAlert('Descripción requerida', 'Describe tu producto'); return; }

    setIsPublishing(true);
    const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
    const result = await createProduct({
      title: title.trim(),
      description: description.trim(),
      price: parseFloat(price),
      currency: 'USD',
      category,
      images,
      stock: isUnlimitedStock ? 9999 : Math.max(1, parseInt(stock) || 1),
      tags: tagList,
    });
    setIsPublishing(false);

    if (result.success) {
      showAlert('¡Producto publicado!', 'Tu producto ya está disponible en la tienda', [
        { text: 'Ver tienda', onPress: () => router.replace('/(tabs)/shop') },
        { text: 'OK', onPress: () => router.back() },
      ]);
    } else {
      showAlert('Error', result.error || 'No se pudo publicar el producto');
    }
  }, [user, title, description, price, category, stock, isUnlimitedStock, images, tags, createProduct, router, showAlert]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <MaterialIcons name="arrow-back-ios" size={20} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Crear Producto</Text>
        <View style={{ width: 30 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, { paddingBottom: 100 + insets.bottom }]}>

          {/* Images */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Imágenes del producto</Text>
            <Text style={styles.sectionSub}>Hasta 4 fotos. La primera será la portada.</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.imagesRow}>
              {images.map((img, i) => (
                <View key={i} style={styles.imageThumbWrap}>
                  <Image source={{ uri: img }} style={styles.imageThumb} contentFit="cover" transition={200} />
                  {i === 0 ? (
                    <View style={styles.primaryBadge}><Text style={styles.primaryBadgeText}>Portada</Text></View>
                  ) : null}
                  <Pressable
                    style={styles.removeImgBtn}
                    onPress={() => setImages(prev => prev.filter((_, idx) => idx !== i))}
                  >
                    <MaterialIcons name="close" size={12} color="#fff" />
                  </Pressable>
                </View>
              ))}
              {images.length < 4 ? (
                <Pressable
                  style={[styles.addImgBtn, isUploadingImage && { opacity: 0.5 }]}
                  onPress={handlePickImage}
                  disabled={isUploadingImage}
                >
                  <MaterialIcons name={isUploadingImage ? 'hourglass-empty' : 'add-photo-alternate'} size={28} color={Colors.primary} />
                  <Text style={styles.addImgText}>{isUploadingImage ? 'Subiendo...' : 'Agregar foto'}</Text>
                </Pressable>
              ) : null}
            </ScrollView>
          </View>

          {/* Basic info */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Información básica</Text>
            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>Título *</Text>
              <TextInput
                style={styles.fieldInput}
                value={title}
                onChangeText={setTitle}
                placeholder="Nombre del producto"
                placeholderTextColor={Colors.textSubtle}
                maxLength={80}
              />
              <Text style={styles.charCount}>{title.length}/80</Text>
            </View>
            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>Descripción *</Text>
              <TextInput
                style={[styles.fieldInput, { height: 100, textAlignVertical: 'top' }]}
                value={description}
                onChangeText={setDescription}
                placeholder="Describe detalladamente tu producto..."
                placeholderTextColor={Colors.textSubtle}
                multiline
                maxLength={500}
              />
              <Text style={styles.charCount}>{description.length}/500</Text>
            </View>
          </View>

          {/* Category */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Categoría</Text>
            <View style={styles.categoryGrid}>
              {CATEGORIES.map(cat => (
                <Pressable
                  key={cat.key}
                  style={[styles.catBtn, category === cat.key && styles.catBtnActive]}
                  onPress={() => setCategory(cat.key)}
                >
                  <MaterialIcons
                    name={cat.icon as any}
                    size={18}
                    color={category === cat.key ? '#000' : Colors.textSecondary}
                  />
                  <Text style={[styles.catBtnText, category === cat.key && styles.catBtnTextActive]}>
                    {cat.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Price & Stock */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Precio y stock</Text>
            <View style={styles.rowFields}>
              <View style={[styles.formField, { flex: 1 }]}>
                <Text style={styles.fieldLabel}>Precio (USD) *</Text>
                <View style={styles.priceInput}>
                  <Text style={styles.priceDollar}>$</Text>
                  <TextInput
                    style={[styles.fieldInput, { flex: 1, borderWidth: 0, paddingHorizontal: 0 }]}
                    value={price}
                    onChangeText={setPrice}
                    placeholder="0.00"
                    placeholderTextColor={Colors.textSubtle}
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>
              {!isUnlimitedStock ? (
                <View style={[styles.formField, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>Stock</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={stock}
                    onChangeText={setStock}
                    placeholder="1"
                    placeholderTextColor={Colors.textSubtle}
                    keyboardType="number-pad"
                  />
                </View>
              ) : null}
            </View>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Stock ilimitado</Text>
              <Switch
                value={isUnlimitedStock}
                onValueChange={setIsUnlimitedStock}
                trackColor={{ false: Colors.border, true: Colors.primary }}
                thumbColor="#fff"
              />
            </View>
          </View>

          {/* Tags */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Etiquetas</Text>
            <TextInput
              style={styles.fieldInput}
              value={tags}
              onChangeText={setTags}
              placeholder="nft, arte, digital (separadas por comas)"
              placeholderTextColor={Colors.textSubtle}
            />
          </View>

          <CyberButton
            label={isPublishing ? 'Publicando...' : 'Publicar producto'}
            onPress={handlePublish}
            loading={isPublishing}
            size="lg"
            fullWidth
          />
        </ScrollView>
      </KeyboardAvoidingView>
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
  headerTitle: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.semibold },
  scroll: { padding: Spacing.md, gap: Spacing.lg },
  section: { gap: Spacing.sm },
  sectionTitle: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  sectionSub: { color: Colors.textSubtle, fontSize: FontSize.xs },
  imagesRow: { gap: Spacing.sm, paddingVertical: Spacing.xs },
  imageThumbWrap: { position: 'relative', borderRadius: Radius.sm, overflow: 'hidden' },
  imageThumb: { width: 90, height: 90, borderRadius: Radius.sm },
  primaryBadge: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,212,255,0.8)', paddingVertical: 3, alignItems: 'center',
  },
  primaryBadgeText: { color: '#000', fontSize: 9, fontWeight: FontWeight.bold },
  removeImgBtn: {
    position: 'absolute', top: 4, right: 4,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: Radius.full, padding: 3,
  },
  addImgBtn: {
    width: 90, height: 90, borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.primary + '44',
    borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  addImgText: { color: Colors.primary, fontSize: 10, textAlign: 'center' },
  formField: { gap: Spacing.xs },
  fieldLabel: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  fieldInput: {
    backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border,
    borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    color: Colors.textPrimary, fontSize: FontSize.md, height: 52,
  },
  charCount: { color: Colors.textSubtle, fontSize: FontSize.xs, textAlign: 'right' },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  catBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md,
    paddingHorizontal: 12, paddingVertical: 9,
    borderWidth: 1, borderColor: Colors.border,
  },
  catBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  catBtnText: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  catBtnTextActive: { color: '#000', fontWeight: FontWeight.bold },
  rowFields: { flexDirection: 'row', gap: Spacing.md },
  priceInput: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border,
    borderRadius: Radius.md, paddingHorizontal: Spacing.md, height: 52,
  },
  priceDollar: { color: Colors.primary, fontSize: FontSize.lg, fontWeight: FontWeight.bold, marginRight: 4 },
  switchRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.surfaceElevated, borderRadius: Radius.md, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.border,
  },
  switchLabel: { color: Colors.textSecondary, fontSize: FontSize.sm },
});
