import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons, MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAlert } from "@/template";
import { SellerScreenHeader } from "@/components/marketplace/SellerScreenHeader";
import {
  createStore,
  fetchSellerFoundation,
  setStoreMedia,
  updateStore,
  type MarketplaceStore,
} from "@/services/marketplaceService";
import {
  deleteMediaAsset,
  getMediaUrl,
  getSafeMediaError,
  uploadMediaFromUri,
} from "@/services/mediaService";
import {
  fetchMarketplaceStoreReputation,
  type MarketplaceStoreReputation,
} from "@/services/marketplaceReviewService";
import {
  Colors,
  FontSize,
  FontWeight,
  Radius,
  Shadow,
  Spacing,
} from "@/constants/theme";

type BrandingSlot = "logo" | "banner";

export default function SellerStore() {
  const insets = useSafeAreaInsets(),
    router = useRouter(),
    { showAlert } = useAlert(),
    saveLock = useRef(false),
    uploadLock = useRef(false);
  const { width } = useWindowDimensions(),
    wide = width >= 700;
  const [store, setStore] = useState<MarketplaceStore | null>(null),
    [name, setName] = useState(""),
    [slug, setSlug] = useState(""),
    [description, setDescription] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null),
    [bannerUrl, setBannerUrl] = useState<string | null>(null),
    [reputation, setReputation] = useState<MarketplaceStoreReputation | null>(
      null,
    );
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [uploading, setUploading] = useState<BrandingSlot | null>(null),
    [error, setError] = useState<string | null>(null);

  const hydrate = useCallback(async () => {
    setLoading(true);
    try {
      const value = await fetchSellerFoundation();
      if (value.seller?.status !== "approved") {
        router.replace("/seller" as never);
        return;
      }
      setStore(value.store);
      if (value.store) {
        setName(value.store.name);
        setSlug(value.store.slug);
        setDescription(value.store.description ?? "");
        const [logo, banner, nextReputation] = await Promise.all([
          value.store.logo_asset_id
            ? getMediaUrl(value.store.logo_asset_id).catch(() => null)
            : null,
          value.store.banner_asset_id
            ? getMediaUrl(value.store.banner_asset_id).catch(() => null)
            : null,
          fetchMarketplaceStoreReputation(value.store.id).catch(() => null),
        ]);
        setLogoUrl(logo);
        setBannerUrl(banner);
        setReputation(nextReputation);
      }
      setError(null);
    } catch {
      setError("No pudimos cargar la configuración de tu tienda.");
    } finally {
      setLoading(false);
    }
  }, [router]);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const save = async () => {
    if (saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    try {
      if (store) await updateStore(store.id, name, slug, description);
      else await createStore(name, slug, description);
      await hydrate();
      showAlert(
        "Tienda guardada",
        "La configuración se actualizó correctamente.",
      );
    } catch {
      showAlert(
        "No se pudo guardar",
        "Revisa el nombre y el identificador de la tienda.",
      );
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };

  const pickBranding = async (slot: BrandingSlot) => {
    if (!store) {
      showAlert(
        "Guarda tu tienda",
        "Primero guarda la información de la tienda.",
      );
      return;
    }
    if (uploadLock.current) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showAlert(
        "Permiso necesario",
        "Habilita el acceso a tus fotos para elegir una imagen.",
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: slot === "logo" ? [1, 1] : [16, 6],
      quality: 0.85,
    });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    uploadLock.current = true;
    setUploading(slot);
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
      await setStoreMedia(
        store.id,
        slot === "logo" ? uploaded.assetId : store.logo_asset_id,
        slot === "banner" ? uploaded.assetId : store.banner_asset_id,
      );
      uploadedId = null;
      const nextStore = {
        ...store,
        [slot === "logo" ? "logo_asset_id" : "banner_asset_id"]:
          uploaded.assetId,
      };
      setStore(nextStore);
      const publicUrl =
        uploaded.url ?? (await getMediaUrl(uploaded.assetId).catch(() => null));
      if (slot === "logo") setLogoUrl(publicUrl);
      else setBannerUrl(publicUrl);
      setReputation(
        await fetchMarketplaceStoreReputation(store.id).catch(() => reputation),
      );
      showAlert(
        slot === "logo" ? "Logo actualizado" : "Portada actualizada",
        "La identidad visual ya está disponible en Marketplace.",
      );
    } catch (cause) {
      if (uploadedId) await deleteMediaAsset(uploadedId).catch(() => {});
      const safe = getSafeMediaError(cause);
      if (__DEV__)
        console.info("[MarketplaceStoreBranding]", {
          operation: "upload_failed",
          slot,
          stage: safe.stage,
          code: safe.code,
        });
      showAlert(
        "No se pudo subir la imagen",
        "Usa una imagen JPG, PNG o WebP válida e inténtalo nuevamente.",
      );
    } finally {
      uploadLock.current = false;
      setUploading(null);
    }
  };

  if (loading)
    return (
      <View style={[styles.page, styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={Colors.primary} />
        <Text style={styles.stateText}>Cargando tu tienda…</Text>
      </View>
    );
  if (error)
    return (
      <View style={[styles.page, styles.center, { paddingTop: insets.top }]}>
        <MaterialIcons name="storefront" size={44} color={Colors.textSubtle} />
        <Text style={styles.stateText}>{error}</Text>
        <Pressable
          style={styles.primaryButton}
          onPress={() => void hydrate()}
          accessibilityRole="button"
        >
          <Text style={styles.primaryButtonText}>Reintentar</Text>
        </Pressable>
      </View>
    );

  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <SellerScreenHeader
        title="Configuración de tienda"
        fallbackRoute="/seller"
        align="left"
        subtitle={
          <Text style={styles.headerSubtitle}>
            On<Text style={styles.headerAccent}>Space Marketplace</Text>
          </Text>
        }
      />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Logo de la tienda</Text>
          <Text style={styles.sectionBody}>
            Este logo aparecerá en tu tienda y junto a tus productos.
          </Text>
          <View style={[styles.logoLayout, wide && styles.logoLayoutWide]}>
            <View style={styles.logoPreview}>
              {logoUrl ? (
                <Image
                  source={{ uri: logoUrl }}
                  style={styles.brandImage}
                  contentFit="contain"
                />
              ) : (
                <>
                  <MaterialCommunityIcons
                    name="storefront-outline"
                    size={40}
                    color={Colors.textSubtle}
                  />
                  <Text style={styles.fallbackText}>Sin logo</Text>
                </>
              )}
            </View>
            <View style={styles.logoActions}>
              <Pressable
                disabled={!store || uploading !== null}
                style={[
                  styles.uploadButton,
                  (!store || uploading !== null) && styles.disabled,
                ]}
                onPress={() => void pickBranding("logo")}
                accessibilityRole="button"
                accessibilityLabel={
                  logoUrl
                    ? "Cambiar logo de la tienda"
                    : "Subir logo de la tienda"
                }
                accessibilityState={{ disabled: !store || uploading !== null }}
              >
                <MaterialIcons name="file-upload" size={21} color="#fff" />
                <Text style={styles.uploadButtonText}>
                  {uploading === "logo"
                    ? "Subiendo…"
                    : logoUrl
                      ? "Cambiar logo"
                      : "Subir logo"}
                </Text>
              </Pressable>
              {logoUrl ? (
                <Text style={styles.currentAsset}>
                  El logo actual se reemplazará al completar la carga.
                </Text>
              ) : null}
            </View>
            <View style={styles.guidance}>
              <Text style={styles.guidanceTitle}>Recomendaciones</Text>
              {[
                "Formato: JPG, PNG o WebP",
                "Presentación cuadrada",
                "Fondo transparente recomendado",
                "Máx. 10 MB",
              ].map((item) => (
                <View key={item} style={styles.guidanceRow}>
                  <MaterialIcons
                    name="check-circle-outline"
                    size={18}
                    color={Colors.primaryLight}
                  />
                  <Text style={styles.guidanceText}>{item}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Información de la tienda</Text>
          <StoreField icon="storefront" label="Nombre de la tienda">
            <TextInput
              style={styles.rowInput}
              value={name}
              onChangeText={setName}
              maxLength={100}
              placeholder="Nombre de la tienda"
              placeholderTextColor={Colors.textSubtle}
              accessibilityLabel="Nombre de la tienda"
            />
          </StoreField>
          <StoreField icon="alternate-email" label="Identificador público">
            <TextInput
              style={styles.rowInput}
              value={slug}
              onChangeText={setSlug}
              autoCapitalize="none"
              maxLength={80}
              placeholder="identificador-tienda"
              placeholderTextColor={Colors.textSubtle}
              accessibilityLabel="Identificador público de la tienda"
            />
          </StoreField>
          <StoreField icon="format-list-bulleted" label="Descripción" multiline>
            <TextInput
              style={[styles.rowInput, styles.rowInputMultiline]}
              value={description}
              onChangeText={setDescription}
              maxLength={1000}
              multiline
              placeholder="Cuenta qué ofrece tu tienda"
              placeholderTextColor={Colors.textSubtle}
              accessibilityLabel="Descripción de la tienda"
            />
          </StoreField>
        </View>
        <View style={styles.section}>
          <View>
            <Text style={styles.sectionTitle}>Identidad visual</Text>
            <Text style={styles.sectionBody}>
              Personaliza la apariencia pública de tu tienda.
            </Text>
          </View>
          <View style={styles.bannerHeading}>
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerTitle}>Imagen de portada</Text>
              <Text style={styles.brandHelp}>
                JPG, PNG o WebP · máximo 25 MB
              </Text>
            </View>
            <Pressable
              disabled={!store || uploading !== null}
              style={[
                styles.secondaryButton,
                (!store || uploading !== null) && styles.disabled,
              ]}
              onPress={() => void pickBranding("banner")}
              accessibilityRole="button"
              accessibilityLabel={
                bannerUrl
                  ? "Cambiar portada de la tienda"
                  : "Subir portada de la tienda"
              }
              accessibilityState={{ disabled: !store || uploading !== null }}
            >
              <MaterialIcons
                name="image"
                size={19}
                color={Colors.textPrimary}
              />
              <Text style={styles.secondaryButtonText}>
                {uploading === "banner"
                  ? "Subiendo…"
                  : bannerUrl
                    ? "Cambiar portada"
                    : "Subir portada"}
              </Text>
            </Pressable>
          </View>
          <View style={styles.bannerPreview}>
            {bannerUrl ? (
              <Image
                source={{ uri: bannerUrl }}
                style={styles.brandImage}
                contentFit="cover"
              />
            ) : (
              <>
                <MaterialCommunityIcons
                  name="image-outline"
                  size={36}
                  color={Colors.textSubtle}
                />
                <Text style={styles.fallbackText}>Sin portada</Text>
              </>
            )}
          </View>
        </View>
        <View style={styles.section}>
          <View style={styles.reputationHeading}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>
                Cómo te ven los compradores
              </Text>
              <Text style={styles.sectionBody}>
                Así se ve tu reputación pública en OnSpace Marketplace.
              </Text>
            </View>
            {store ? (
              <Pressable
                style={styles.viewStoreButton}
                onPress={() =>
                  router.push({
                    pathname: "/store/[id]",
                    params: { id: store.id },
                  } as never)
                }
                accessibilityRole="button"
                accessibilityLabel="Ver mi tienda"
              >
                <Text style={styles.viewStoreText}>Ver mi tienda</Text>
                <MaterialIcons
                  name="open-in-new"
                  size={18}
                  color={Colors.primaryLight}
                />
              </Pressable>
            ) : null}
          </View>
          {reputation &&
          (reputation.sellerAggregate.reviewCount > 0 ||
            reputation.productAggregate.reviewCount > 0) ? (
            <View style={styles.metrics}>
              <ReputationMetric
                label="Calificación de productos"
                value={reputation.productAggregate.averageRating}
                count={reputation.productAggregate.reviewCount}
              />
              <ReputationMetric
                label="Calificación del vendedor"
                value={reputation.sellerAggregate.averageRating}
                count={reputation.sellerAggregate.reviewCount}
              />
            </View>
          ) : (
            <Text style={styles.pageBody}>
              Sin reseñas verificadas todavía.
            </Text>
          )}
        </View>
        <Pressable
          disabled={saving}
          style={[styles.primaryButton, saving && styles.disabled]}
          onPress={() => void save()}
          accessibilityRole="button"
          accessibilityLabel="Guardar configuración de tienda"
          accessibilityState={{ disabled: saving }}
        >
          <LinearGradient
            colors={[Colors.primary, "#6C3EFF"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.saveGradient}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <MaterialIcons name="save" size={20} color="#fff" />
                <Text style={styles.primaryButtonText}>Guardar cambios</Text>
              </>
            )}
          </LinearGradient>
        </Pressable>
        <View style={styles.secureFooter}>
          <MaterialIcons
            name="verified-user"
            size={17}
            color={Colors.primaryLight}
          />
          <Text style={styles.secureFooterText}>
            Tu información está segura en{" "}
            <Text style={styles.headerAccent}>OnSpace Marketplace</Text>
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function StoreField({
  icon,
  label,
  multiline = false,
  children,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>["name"];
  label: string;
  multiline?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.storeField, multiline && styles.storeFieldMultiline]}>
      <View style={styles.fieldIcon}>
        <MaterialIcons name={icon} size={20} color={Colors.primaryLight} />
      </View>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldControl}>{children}</View>
    </View>
  );
}

function ReputationMetric({
  label,
  value,
  count,
}: {
  label: string;
  value: number | null;
  count: number;
}) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>
        {value == null ? "Sin reseñas" : `★ ${value.toFixed(1)}`}
      </Text>
      <Text style={styles.metricCount}>
        {count} {count === 1 ? "reseña" : "reseñas"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: Colors.bg },
  center: {
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
    padding: Spacing.xl,
  },
  stateText: { color: Colors.textSecondary, textAlign: "center" },
  header: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    backgroundColor: Colors.bg,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCopy: { flex: 1, minWidth: 0, paddingHorizontal: 6 },
  headerTitle: {
    color: Colors.textPrimary,
    fontSize: 22,
    fontWeight: FontWeight.extrabold,
    letterSpacing: -0.45,
  },
  headerSubtitle: { color: Colors.textPrimary, fontSize: 13, marginTop: 2 },
  headerAccent: { color: Colors.primaryLight },
  content: {
    width: "100%",
    maxWidth: 940,
    alignSelf: "center",
    padding: Spacing.md,
    paddingBottom: 48,
    gap: Spacing.md,
  },
  pageBody: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    lineHeight: 20,
    marginTop: 4,
  },
  section: {
    gap: 12,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.subtle,
  },
  sectionTitle: {
    color: Colors.textPrimary,
    fontSize: 19,
    fontWeight: FontWeight.bold,
  },
  sectionBody: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 3,
  },
  logoLayout: { alignItems: "center", gap: Spacing.md },
  logoLayoutWide: { flexDirection: "row", alignItems: "center" },
  logoPreview: {
    width: 128,
    height: 128,
    borderRadius: 64,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: Colors.surface,
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  logoActions: { minWidth: 0, flex: 1, alignItems: "stretch", gap: 8 },
  uploadButton: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.primary,
  },
  uploadButtonText: { color: "#fff", fontWeight: FontWeight.bold },
  currentAsset: { color: Colors.textSubtle, fontSize: 11, textAlign: "center" },
  guidance: {
    width: "100%",
    maxWidth: 260,
    padding: 14,
    gap: 10,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  guidanceTitle: {
    color: Colors.textSecondary,
    fontWeight: FontWeight.semibold,
  },
  guidanceRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  guidanceText: { flex: 1, color: Colors.textSecondary, fontSize: 12 },
  brandImage: { width: "100%", height: "100%" },
  fallbackText: { color: Colors.textSubtle, fontSize: 10 },
  brandHelp: { color: Colors.textSubtle, fontSize: 11 },
  storeField: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  storeFieldMultiline: {
    minHeight: 92,
    alignItems: "flex-start",
    paddingVertical: 8,
  },
  fieldIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primaryDim,
  },
  fieldLabel: { width: 126, color: Colors.textPrimary, fontSize: 13 },
  fieldControl: { flex: 1, minWidth: 0 },
  rowInput: {
    minHeight: 44,
    paddingHorizontal: 8,
    color: Colors.textPrimary,
    textAlign: "right",
  },
  rowInputMultiline: {
    minHeight: 72,
    textAlignVertical: "top",
    textAlign: "right",
  },
  bannerHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  bannerTitle: {
    color: Colors.textPrimary,
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
  },
  bannerPreview: {
    width: "100%",
    aspectRatio: 16 / 4.5,
    borderRadius: Radius.md,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  primaryButton: { minHeight: 56, overflow: "hidden", borderRadius: Radius.md },
  saveGradient: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    paddingHorizontal: Spacing.lg,
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
  },
  secondaryButton: {
    minHeight: 44,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderHighlight,
  },
  secondaryButtonText: {
    color: Colors.textPrimary,
    fontWeight: FontWeight.semibold,
    fontSize: 12,
  },
  disabled: { opacity: 0.5 },
  reputationHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  viewStoreButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  viewStoreText: {
    color: Colors.primaryLight,
    fontWeight: FontWeight.semibold,
    fontSize: 12,
  },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  metric: {
    flex: 1,
    minWidth: 150,
    padding: 14,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  metricLabel: {
    color: Colors.textPrimary,
    fontSize: 12,
    fontWeight: FontWeight.semibold,
  },
  metricValue: {
    color: Colors.textPrimary,
    fontSize: 25,
    fontWeight: FontWeight.extrabold,
    marginTop: 6,
  },
  metricCount: { color: Colors.textSecondary, fontSize: 11, marginTop: 3 },
  secureFooter: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  secureFooterText: {
    color: Colors.textSecondary,
    fontSize: 11,
    textAlign: "center",
  },
});
