import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { MaterialCommunityIcons, MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAlert } from "@/template";
import {
  createStore,
  fetchSellerFoundation,
  setStoreMedia,
  updateStore,
  type MarketplaceStore,
} from "@/services/marketplaceService";
import { deleteMediaAsset, getMediaUrl, getSafeMediaError, uploadMediaFromUri } from "@/services/mediaService";
import { fetchMarketplaceStoreReputation, type MarketplaceStoreReputation } from "@/services/marketplaceReviewService";
import { Colors, FontSize, FontWeight, Radius, Spacing } from "@/constants/theme";
import { SellerScreenHeader } from "@/components/marketplace/SellerScreenHeader";

type BrandingSlot = "logo" | "banner";

export default function SellerStore() {
  const insets = useSafeAreaInsets(), router = useRouter(), { showAlert } = useAlert(), saveLock = useRef(false), uploadLock = useRef(false);
  const [store, setStore] = useState<MarketplaceStore | null>(null), [name, setName] = useState(""), [slug, setSlug] = useState(""), [description, setDescription] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null), [bannerUrl, setBannerUrl] = useState<string | null>(null), [reputation, setReputation] = useState<MarketplaceStoreReputation | null>(null);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [uploading, setUploading] = useState<BrandingSlot | null>(null), [error, setError] = useState<string | null>(null);

  const hydrate = useCallback(async () => {
    setLoading(true);
    try {
      const value = await fetchSellerFoundation();
      if (value.seller?.status !== "approved") { router.replace("/seller" as never); return; }
      setStore(value.store);
      if (value.store) {
        setName(value.store.name);setSlug(value.store.slug);setDescription(value.store.description ?? "");
        const [logo, banner, nextReputation] = await Promise.all([
          value.store.logo_asset_id ? getMediaUrl(value.store.logo_asset_id).catch(() => null) : null,
          value.store.banner_asset_id ? getMediaUrl(value.store.banner_asset_id).catch(() => null) : null,
          fetchMarketplaceStoreReputation(value.store.id).catch(() => null),
        ]);
        setLogoUrl(logo);setBannerUrl(banner);setReputation(nextReputation);
      }
      setError(null);
    } catch {
      setError("No pudimos cargar la configuración de tu tienda.");
    } finally { setLoading(false); }
  }, [router]);
  useEffect(() => { void hydrate(); }, [hydrate]);

  const save = async () => {
    if (saveLock.current) return;
    saveLock.current = true;setSaving(true);
    try {
      if (store) await updateStore(store.id, name, slug, description);
      else await createStore(name, slug, description);
      await hydrate();
      showAlert("Tienda guardada", "La configuración se actualizó correctamente.");
    } catch { showAlert("No se pudo guardar", "Revisa el nombre y el identificador de la tienda."); }
    finally { saveLock.current = false;setSaving(false); }
  };

  const pickBranding = async (slot: BrandingSlot) => {
    if (!store) { showAlert("Guarda tu tienda", "Primero guarda la información de la tienda.");return; }
    if (uploadLock.current) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { showAlert("Permiso necesario", "Habilita el acceso a tus fotos para elegir una imagen.");return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: slot === "logo" ? [1, 1] : [16, 6],
      quality: 0.85,
    });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    uploadLock.current = true;setUploading(slot);
    let uploadedId: string | null = null;
    try {
      const uploaded = await uploadMediaFromUri({
        uri: asset.uri,
        purpose: slot === "logo" ? "store_logo" : "store_banner",
        mimeType: asset.mimeType ?? "image/jpeg",
        fileName: asset.fileName ?? undefined,
        sizeBytes: asset.fileSize,
        visibility: "public",
      });
      uploadedId = uploaded.assetId;
      await setStoreMedia(store.id, slot === "logo" ? uploaded.assetId : store.logo_asset_id, slot === "banner" ? uploaded.assetId : store.banner_asset_id);
      uploadedId = null;
      const nextStore = { ...store, [slot === "logo" ? "logo_asset_id" : "banner_asset_id"]: uploaded.assetId };
      setStore(nextStore);
      const publicUrl = uploaded.url ?? await getMediaUrl(uploaded.assetId).catch(() => null);
      if (slot === "logo") setLogoUrl(publicUrl);else setBannerUrl(publicUrl);
      setReputation(await fetchMarketplaceStoreReputation(store.id).catch(() => reputation));
      showAlert(slot === "logo" ? "Logo actualizado" : "Portada actualizada", "La identidad visual ya está disponible en Marketplace.");
    } catch (cause) {
      if (uploadedId) await deleteMediaAsset(uploadedId).catch(() => {});
      const safe = getSafeMediaError(cause);
      if (__DEV__) console.info("[MarketplaceStoreBranding]", { operation: "upload_failed", slot, stage: safe.stage, code: safe.code });
      showAlert("No se pudo subir la imagen", "Usa una imagen JPG, PNG o WebP válida e inténtalo nuevamente.");
    } finally { uploadLock.current = false;setUploading(null); }
  };

  if (loading) return <View style={[styles.page, styles.center, { paddingTop: insets.top }]}><ActivityIndicator color={Colors.primary} /><Text style={styles.stateText}>Cargando tu tienda…</Text></View>;
  if (error) return <View style={[styles.page, styles.center, { paddingTop: insets.top }]}><MaterialIcons name="storefront" size={44} color={Colors.textSubtle} /><Text style={styles.stateText}>{error}</Text><Pressable style={styles.primaryButton} onPress={() => void hydrate()} accessibilityRole="button"><Text style={styles.primaryButtonText}>Reintentar</Text></Pressable></View>;

  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <SellerScreenHeader title="Configurar tienda" fallbackRoute="/seller" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View><Text style={styles.eyebrow}>IDENTIDAD VISUAL</Text><Text style={styles.pageTitle}>Haz reconocible tu tienda</Text><Text style={styles.pageBody}>Usamos únicamente imágenes que tú subes y que pertenecen a tu cuenta.</Text></View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Logo de la tienda</Text>
          <View style={styles.logoRow}>
            <View style={styles.logoPreview}>{logoUrl ? <Image source={{ uri: logoUrl }} style={styles.brandImage} contentFit="contain" /> : <><MaterialCommunityIcons name="storefront-outline" size={35} color={Colors.textSubtle} /><Text style={styles.fallbackText}>Sin logo</Text></>}</View>
            <View style={styles.brandCopy}><Text style={styles.brandTitle}>{logoUrl ? "Logo actual" : "Añade tu logo"}</Text><Text style={styles.brandHelp}>JPG, PNG o WebP · máximo 10 MB</Text><Pressable disabled={!store || uploading !== null} style={[styles.secondaryButton, (!store || uploading !== null) && styles.disabled]} onPress={() => void pickBranding("logo")} accessibilityRole="button" accessibilityLabel={logoUrl ? "Cambiar logo de la tienda" : "Subir logo de la tienda"} accessibilityState={{ disabled: !store || uploading !== null }}><Text style={styles.secondaryButtonText}>{uploading === "logo" ? "Subiendo…" : logoUrl ? "Cambiar logo" : "Subir logo"}</Text></Pressable></View>
          </View>
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Imagen de portada</Text>
          <View style={styles.bannerPreview}>{bannerUrl ? <Image source={{ uri: bannerUrl }} style={styles.brandImage} contentFit="cover" /> : <><MaterialCommunityIcons name="image-outline" size={34} color={Colors.textSubtle} /><Text style={styles.fallbackText}>Sin portada</Text></>}</View>
          <Text style={styles.brandHelp}>JPG, PNG o WebP · máximo 25 MB</Text>
          <Pressable disabled={!store || uploading !== null} style={[styles.secondaryButton, (!store || uploading !== null) && styles.disabled]} onPress={() => void pickBranding("banner")} accessibilityRole="button" accessibilityLabel={bannerUrl ? "Cambiar portada de la tienda" : "Subir portada de la tienda"} accessibilityState={{ disabled: !store || uploading !== null }}><Text style={styles.secondaryButtonText}>{uploading === "banner" ? "Subiendo…" : bannerUrl ? "Cambiar portada" : "Subir portada"}</Text></Pressable>
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Información de la tienda</Text>
          <Text style={styles.label}>Nombre</Text><TextInput style={styles.input} value={name} onChangeText={setName} maxLength={100} placeholder="Nombre de la tienda" placeholderTextColor={Colors.textSubtle} accessibilityLabel="Nombre de la tienda" />
          <Text style={styles.label}>Identificador público</Text><TextInput style={styles.input} value={slug} onChangeText={setSlug} autoCapitalize="none" maxLength={80} placeholder="identificador-tienda" placeholderTextColor={Colors.textSubtle} accessibilityLabel="Identificador público de la tienda" />
          <Text style={styles.label}>Descripción</Text><TextInput style={[styles.input, styles.note]} value={description} onChangeText={setDescription} maxLength={1000} multiline placeholder="Cuenta qué ofrece tu tienda" placeholderTextColor={Colors.textSubtle} accessibilityLabel="Descripción de la tienda" />
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Reputación pública</Text>
          {reputation && (reputation.sellerAggregate.reviewCount > 0 || reputation.productAggregate.reviewCount > 0) ? <View style={styles.metrics}><ReputationMetric label="Valoración del vendedor" value={reputation.sellerAggregate.averageRating} count={reputation.sellerAggregate.reviewCount} /><ReputationMetric label="Reseñas de productos" value={reputation.productAggregate.averageRating} count={reputation.productAggregate.reviewCount} /></View> : <Text style={styles.pageBody}>Sin reseñas verificadas todavía.</Text>}
        </View>
        <Pressable disabled={saving} style={[styles.primaryButton, saving && styles.disabled]} onPress={() => void save()} accessibilityRole="button" accessibilityLabel="Guardar configuración de tienda" accessibilityState={{ disabled: saving }}><Text style={styles.primaryButtonText}>{saving ? "Guardando…" : "Guardar tienda"}</Text></Pressable>
      </ScrollView>
    </View>
  );
}

function ReputationMetric({ label, value, count }: { label: string; value: number | null; count: number }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value == null ? "Sin reseñas" : `★ ${value.toFixed(1)}`}</Text><Text style={styles.metricCount}>{count} {count === 1 ? "reseña" : "reseñas"}</Text></View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Colors.bg }, center: { alignItems: "center", justifyContent: "center", gap: Spacing.md, padding: Spacing.xl }, stateText: { color: Colors.textSecondary, textAlign: "center" },
  content: { padding: Spacing.md, paddingBottom: 64, gap: Spacing.md }, eyebrow: { color: Colors.primaryLight, fontSize: 10, fontWeight: FontWeight.extrabold, letterSpacing: 1.3 }, pageTitle: { color: Colors.textPrimary, fontSize: 26, fontWeight: FontWeight.extrabold, marginTop: 4 }, pageBody: { color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 20, marginTop: 4 },
  section: { gap: Spacing.sm, padding: Spacing.md, borderRadius: Radius.lg, backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border }, sectionTitle: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold }, label: { color: Colors.textSecondary, fontSize: FontSize.xs, fontWeight: FontWeight.semibold, marginTop: 4 },
  logoRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md }, logoPreview: { width: 96, height: 96, borderRadius: 26, overflow: "hidden", alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border }, bannerPreview: { width: "100%", aspectRatio: 16 / 6, borderRadius: Radius.md, overflow: "hidden", alignItems: "center", justifyContent: "center", gap: 4, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border }, brandImage: { width: "100%", height: "100%" }, fallbackText: { color: Colors.textSubtle, fontSize: 10 }, brandCopy: { flex: 1, minWidth: 0, gap: 6 }, brandTitle: { color: Colors.textPrimary, fontWeight: FontWeight.bold }, brandHelp: { color: Colors.textSubtle, fontSize: 11 },
  input: { minHeight: 48, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, padding: Spacing.md, color: Colors.textPrimary }, note: { minHeight: 110, textAlignVertical: "top" },
  primaryButton: { minHeight: 52, alignItems: "center", justifyContent: "center", borderRadius: Radius.md, backgroundColor: Colors.primary, paddingHorizontal: Spacing.lg }, primaryButtonText: { color: "#fff", fontWeight: FontWeight.bold }, secondaryButton: { minHeight: 44, alignSelf: "flex-start", alignItems: "center", justifyContent: "center", paddingHorizontal: Spacing.md, borderRadius: Radius.full, backgroundColor: Colors.primaryDim, borderWidth: 1, borderColor: Colors.primary }, secondaryButtonText: { color: Colors.primaryLight, fontWeight: FontWeight.bold }, disabled: { opacity: 0.5 },
  metrics: { flexDirection: "row", gap: Spacing.sm }, metric: { flex: 1, minWidth: 0, padding: Spacing.sm, borderRadius: Radius.md, backgroundColor: Colors.surface }, metricLabel: { color: Colors.textSecondary, fontSize: 10 }, metricValue: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.extrabold, marginTop: 4 }, metricCount: { color: Colors.textSubtle, fontSize: 10, marginTop: 2 },
});
