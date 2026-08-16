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
type StoreFieldName = "name" | "slug" | "description";
type SaveState = "idle" | "success" | "error";

export default function SellerStore() {
  const insets = useSafeAreaInsets(),
    router = useRouter(),
    { showAlert } = useAlert(),
    saveLock = useRef(false),
    uploadLock = useRef(false);
  const { width } = useWindowDimensions(),
    compact = width < 360,
    wide = width >= 760,
    ratingsStacked = width < 360;
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
    [error, setError] = useState<string | null>(null),
    [focusedField, setFocusedField] = useState<StoreFieldName | null>(null),
    [saveState, setSaveState] = useState<SaveState>("idle");

  const hydrate = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
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
        if (!silent) setLoading(false);
      }
    },
    [router],
  );
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const save = async () => {
    if (saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setSaveState("idle");
    try {
      if (store) await updateStore(store.id, name, slug, description);
      else await createStore(name, slug, description);
      await hydrate(true);
      setSaveState("success");
      showAlert(
        "Tienda guardada",
        "La configuración se actualizó correctamente.",
      );
    } catch {
      setSaveState("error");
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

  const edit = (field: StoreFieldName, value: string) => {
    setSaveState("idle");
    if (field === "name") setName(value);
    else if (field === "slug") setSlug(value);
    else setDescription(value);
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
          style={[styles.primaryButton, styles.stateRetryButton]}
          onPress={() => void hydrate()}
          accessibilityRole="button"
          accessibilityLabel="Reintentar carga de tienda"
        >
          <Text style={styles.primaryButtonText}>Reintentar</Text>
        </Pressable>
      </View>
    );

  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <View pointerEvents="none" style={styles.ambientGlow} />
      <LinearGradient
        colors={["rgba(10,10,15,.98)", "rgba(14,12,23,.98)"]}
        style={styles.headerFrame}
      >
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
      </LinearGradient>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.profileRail} accessibilityRole="tablist">
          <View
            style={styles.profileTab}
            accessibilityRole="tab"
            accessibilityState={{ selected: true }}
          >
            <Text style={styles.profileTabText}>Perfil de tienda</Text>
          </View>
          <View style={styles.profileRailLine} />
        </View>
        <View style={[styles.section, styles.logoSection]}>
          <Text style={styles.sectionTitle}>Logo de la tienda</Text>
          <Text style={styles.sectionBody}>
            Este logo aparecerá en tu tienda y junto a tus productos.
          </Text>
          <View style={[styles.logoLayout, wide && styles.logoLayoutWide]}>
            <View
              style={[styles.logoPrimary, compact && styles.logoPrimaryCompact]}
            >
              <View
                style={[
                  styles.logoPreviewShell,
                  compact && styles.logoPreviewShellCompact,
                ]}
              >
                <LinearGradient
                  colors={[Colors.primaryLight, Colors.primary, "#34215F"]}
                  style={styles.logoRing}
                >
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
                          size={compact ? 34 : 42}
                          color={Colors.textSubtle}
                        />
                        <Text style={styles.fallbackText}>Sin logo</Text>
                      </>
                    )}
                  </View>
                </LinearGradient>
                <View style={styles.logoEditBadge} pointerEvents="none">
                  <MaterialCommunityIcons
                    name="pencil-outline"
                    size={19}
                    color="#fff"
                  />
                </View>
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
                  accessibilityState={{
                    disabled: !store || uploading !== null,
                    busy: uploading === "logo",
                  }}
                >
                  <LinearGradient
                    colors={["#7044FF", "#8A55FF"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.uploadGradient}
                  >
                    {uploading === "logo" ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <MaterialIcons
                        name={logoUrl ? "image" : "file-upload"}
                        size={21}
                        color="#fff"
                      />
                    )}
                    <Text style={styles.uploadButtonText}>
                      {uploading === "logo"
                        ? "Subiendo…"
                        : logoUrl
                          ? "Cambiar logo"
                          : "Subir logo"}
                    </Text>
                  </LinearGradient>
                </Pressable>
                <Text style={styles.currentAsset}>
                  {logoUrl
                    ? "La nueva imagen reemplazará el logo actual."
                    : "Añade una imagen que identifique tu tienda."}
                </Text>
              </View>
            </View>
            <View style={[styles.guidance, wide && styles.guidanceWide]}>
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
          <View style={styles.sectionHeading}>
            <View style={styles.sectionIcon}>
              <MaterialCommunityIcons
                name="store-cog-outline"
                size={21}
                color={Colors.primaryLight}
              />
            </View>
            <View style={styles.sectionHeadingCopy}>
              <Text style={styles.sectionTitle}>Información de la tienda</Text>
              <Text style={styles.sectionBody}>
                Mantén clara y reconocible tu identidad pública.
              </Text>
            </View>
          </View>
          <StoreField
            icon="storefront"
            label="Nombre de la tienda"
            helper="Así te encontrarán los compradores"
            active={focusedField === "name"}
          >
            <TextInput
              style={styles.rowInput}
              value={name}
              onChangeText={(value) => edit("name", value)}
              onFocus={() => setFocusedField("name")}
              onBlur={() => setFocusedField(null)}
              maxLength={100}
              placeholder="Nombre de la tienda"
              placeholderTextColor={Colors.textSubtle}
              selectionColor={Colors.primaryLight}
              accessibilityLabel="Nombre de la tienda"
            />
          </StoreField>
          <StoreField
            icon="alternate-email"
            label="Identificador público"
            helper={
              slug ? `onspace.app/store/${slug}` : "URL pública de tu tienda"
            }
            active={focusedField === "slug"}
          >
            <TextInput
              style={styles.rowInput}
              value={slug}
              onChangeText={(value) => edit("slug", value)}
              onFocus={() => setFocusedField("slug")}
              onBlur={() => setFocusedField(null)}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={80}
              placeholder="identificador-tienda"
              placeholderTextColor={Colors.textSubtle}
              selectionColor={Colors.primaryLight}
              accessibilityLabel="Identificador público de la tienda"
            />
          </StoreField>
          <StoreField
            icon="format-list-bulleted"
            label="Descripción"
            helper="Resume qué vendes y qué hace especial a tu tienda"
            multiline
            active={focusedField === "description"}
          >
            <View>
              <TextInput
                style={[styles.rowInput, styles.rowInputMultiline]}
                value={description}
                onChangeText={(value) => edit("description", value)}
                onFocus={() => setFocusedField("description")}
                onBlur={() => setFocusedField(null)}
                maxLength={1000}
                multiline
                placeholder="Cuenta qué ofrece tu tienda"
                placeholderTextColor={Colors.textSubtle}
                selectionColor={Colors.primaryLight}
                accessibilityLabel="Descripción de la tienda"
              />
              <Text style={styles.characterCount}>
                {description.length}/1000
              </Text>
            </View>
          </StoreField>
        </View>
        <View style={styles.section}>
          <View style={styles.sectionHeading}>
            <View style={styles.sectionIcon}>
              <MaterialCommunityIcons
                name="palette-outline"
                size={21}
                color={Colors.primaryLight}
              />
            </View>
            <View style={styles.sectionHeadingCopy}>
              <Text style={styles.sectionTitle}>Identidad visual</Text>
              <Text style={styles.sectionBody}>
                Personaliza la apariencia pública de tu tienda.
              </Text>
            </View>
          </View>
          <View
            style={[
              styles.bannerHeading,
              compact && styles.bannerHeadingCompact,
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerTitle}>Imagen de portada</Text>
              <Text style={styles.brandHelp}>
                Se mostrará en el encabezado público de tu tienda.
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
              {uploading === "banner" ? (
                <ActivityIndicator color={Colors.textPrimary} size="small" />
              ) : (
                <MaterialIcons
                  name="image"
                  size={19}
                  color={Colors.textPrimary}
                />
              )}
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
              <>
                <Image
                  source={{ uri: bannerUrl }}
                  style={styles.brandImage}
                  contentFit="cover"
                />
                <LinearGradient
                  pointerEvents="none"
                  colors={["rgba(0,0,0,.08)", "rgba(0,0,0,.72)"]}
                  style={styles.bannerOverlay}
                />
                <View pointerEvents="none" style={styles.previewBadge}>
                  <Text style={styles.previewBadgeText}>Vista previa</Text>
                </View>
              </>
            ) : (
              <>
                <MaterialCommunityIcons
                  name="image-outline"
                  size={36}
                  color={Colors.textSubtle}
                />
                <Text style={styles.bannerFallbackTitle}>Sin portada</Text>
                <Text style={styles.bannerFallbackBody}>
                  Añade una imagen horizontal para presentar tu marca.
                </Text>
              </>
            )}
          </View>
          <Text style={styles.bannerLimit}>JPG, PNG o WebP · máximo 25 MB</Text>
        </View>
        <View style={styles.section}>
          <View
            style={[
              styles.reputationHeading,
              compact && styles.reputationHeadingCompact,
            ]}
          >
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
          <View
            style={[styles.metrics, ratingsStacked && styles.metricsStacked]}
          >
            <ReputationMetric
              label="Calificación de productos"
              value={reputation?.productAggregate.averageRating ?? null}
              count={reputation?.productAggregate.reviewCount ?? 0}
              caption="Basado en reseñas verificadas de productos"
            />
            <ReputationMetric
              label="Calificación del vendedor"
              value={reputation?.sellerAggregate.averageRating ?? null}
              count={reputation?.sellerAggregate.reviewCount ?? 0}
              caption="Basado en transacciones verificadas"
            />
          </View>
        </View>
        <View style={styles.saveArea}>
          <Pressable
            disabled={saving}
            style={[styles.primaryButton, saving && styles.disabled]}
            onPress={() => void save()}
            accessibilityRole="button"
            accessibilityLabel="Guardar configuración de tienda"
            accessibilityState={{ disabled: saving, busy: saving }}
          >
            <LinearGradient
              colors={["#6338FF", "#8654FF", "#7345FF"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.saveGradient}
            >
              {saving ? (
                <>
                  <ActivityIndicator color="#fff" />
                  <Text style={styles.primaryButtonText}>
                    Guardando cambios…
                  </Text>
                </>
              ) : (
                <>
                  <MaterialCommunityIcons
                    name="content-save-outline"
                    size={21}
                    color="#fff"
                  />
                  <Text style={styles.primaryButtonText}>Guardar cambios</Text>
                </>
              )}
            </LinearGradient>
          </Pressable>
          {saveState !== "idle" ? (
            <View
              style={[
                styles.saveFeedback,
                saveState === "error" && styles.saveFeedbackError,
              ]}
              accessible
              accessibilityLiveRegion="polite"
            >
              <MaterialIcons
                name={
                  saveState === "success" ? "check-circle" : "error-outline"
                }
                size={17}
                color={saveState === "success" ? Colors.success : Colors.error}
              />
              <Text
                style={[
                  styles.saveFeedbackText,
                  saveState === "error" && styles.saveFeedbackTextError,
                ]}
              >
                {saveState === "success"
                  ? "Cambios guardados correctamente."
                  : "No se pudieron guardar los cambios. Revisa los datos."}
              </Text>
            </View>
          ) : null}
        </View>
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
  helper,
  active = false,
  multiline = false,
  children,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>["name"];
  label: string;
  helper: string;
  active?: boolean;
  multiline?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View
      style={[
        styles.storeField,
        active && styles.storeFieldActive,
        multiline && styles.storeFieldMultiline,
      ]}
    >
      <View style={styles.fieldIcon}>
        <MaterialIcons name={icon} size={20} color={Colors.primaryLight} />
      </View>
      <View style={styles.fieldBody}>
        <View style={styles.fieldHeading}>
          <Text style={styles.fieldLabel}>{label}</Text>
          <Text style={styles.fieldHelper} numberOfLines={1}>
            {helper}
          </Text>
        </View>
        <View style={styles.fieldControl}>{children}</View>
      </View>
    </View>
  );
}

function ReputationMetric({
  label,
  value,
  count,
  caption,
}: {
  label: string;
  value: number | null;
  count: number;
  caption: string;
}) {
  const rating = value ?? 0;
  return (
    <View style={styles.metric}>
      <View style={styles.metricHeading}>
        <Text style={styles.metricLabel}>{label}</Text>
        <MaterialIcons
          name="info-outline"
          size={15}
          color={Colors.textSubtle}
        />
      </View>
      <View style={styles.metricScoreRow}>
        <Text style={styles.metricValue}>
          {value == null ? "—" : value.toFixed(1)}
        </Text>
        <View
          style={styles.metricStars}
          accessibilityLabel={`${rating} de 5 estrellas`}
        >
          {[1, 2, 3, 4, 5].map((star) => (
            <MaterialIcons
              key={star}
              name={
                rating >= star
                  ? "star"
                  : rating >= star - 0.5
                    ? "star-half"
                    : "star-border"
              }
              size={18}
              color={value == null ? Colors.textSubtle : Colors.warning}
            />
          ))}
        </View>
        <Text style={styles.metricCount}>({count})</Text>
      </View>
      <Text style={styles.metricCaption}>
        {count > 0 ? caption : "Sin reseñas verificadas todavía"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#08090D" },
  ambientGlow: {
    position: "absolute",
    top: 42,
    right: -120,
    width: 290,
    height: 290,
    borderRadius: 145,
    backgroundColor: Colors.primaryGlow,
    opacity: 0.22,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
    padding: Spacing.xl,
  },
  stateText: { color: Colors.textSecondary, textAlign: "center" },
  headerFrame: {
    borderBottomWidth: 1,
    borderBottomColor: "rgba(124,92,255,.13)",
  },
  headerSubtitle: { color: Colors.textPrimary, fontSize: 13, marginTop: 2 },
  headerAccent: { color: Colors.primaryLight },
  content: {
    width: "100%",
    maxWidth: 940,
    alignSelf: "center",
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 52,
    gap: 16,
  },
  profileRail: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "flex-end",
  },
  profileTab: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 10,
    borderBottomWidth: 3,
    borderBottomColor: Colors.primary,
  },
  profileTabText: {
    color: Colors.primaryLight,
    fontSize: 13,
    fontWeight: FontWeight.bold,
  },
  profileRailLine: {
    flex: 1,
    height: 1,
    marginBottom: 0,
    backgroundColor: Colors.border,
  },
  section: {
    gap: 14,
    padding: 16,
    borderRadius: 20,
    backgroundColor: "rgba(22,22,30,.96)",
    borderWidth: 1,
    borderColor: "rgba(111,105,137,.28)",
    ...Shadow.card,
  },
  logoSection: { paddingTop: 18 },
  sectionTitle: {
    color: Colors.textPrimary,
    fontSize: 19,
    fontWeight: FontWeight.extrabold,
    letterSpacing: -0.25,
  },
  sectionBody: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 2,
  },
  sectionHeading: { flexDirection: "row", alignItems: "center", gap: 12 },
  sectionHeadingCopy: { flex: 1, minWidth: 0 },
  sectionIcon: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primaryDim,
    borderWidth: 1,
    borderColor: "rgba(124,92,255,.2)",
  },
  logoLayout: { width: "100%", gap: 16 },
  logoLayoutWide: { flexDirection: "row", alignItems: "center" },
  logoPrimary: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  logoPrimaryCompact: { gap: 10 },
  logoPreviewShell: { width: 136, height: 136, position: "relative" },
  logoPreviewShellCompact: { width: 108, height: 108 },
  logoRing: {
    flex: 1,
    borderRadius: 999,
    padding: 3,
    ...Shadow.glow,
  },
  logoPreview: {
    flex: 1,
    borderRadius: 999,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: "#101116",
    borderWidth: 4,
    borderColor: "#171720",
  },
  logoEditBadge: {
    position: "absolute",
    right: -2,
    bottom: 4,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primary,
    borderWidth: 3,
    borderColor: "#171720",
    ...Shadow.brand,
  },
  logoActions: { minWidth: 0, flex: 1, alignItems: "stretch", gap: 8 },
  uploadButton: {
    minHeight: 54,
    overflow: "hidden",
    borderRadius: 14,
    ...Shadow.brand,
  },
  uploadGradient: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    paddingHorizontal: 12,
  },
  uploadButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: FontWeight.bold,
  },
  currentAsset: {
    color: Colors.textSubtle,
    fontSize: 11,
    lineHeight: 15,
    textAlign: "center",
  },
  guidance: {
    width: "100%",
    padding: 14,
    gap: 10,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: "rgba(12,13,18,.58)",
  },
  guidanceWide: { width: 260, flexShrink: 0 },
  guidanceTitle: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontWeight: FontWeight.bold,
  },
  guidanceRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  guidanceText: { flex: 1, color: Colors.textSecondary, fontSize: 12 },
  brandImage: { width: "100%", height: "100%" },
  fallbackText: { color: Colors.textSubtle, fontSize: 11 },
  brandHelp: { color: Colors.textSecondary, fontSize: 11, lineHeight: 16 },
  storeField: {
    minHeight: 94,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 11,
    padding: 12,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: "rgba(12,13,18,.65)",
  },
  storeFieldActive: {
    borderColor: Colors.primary,
    backgroundColor: "rgba(124,92,255,.07)",
    shadowColor: Colors.primary,
    shadowOpacity: 0.19,
    shadowRadius: 10,
    elevation: 4,
  },
  storeFieldMultiline: { minHeight: 148 },
  fieldIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primaryDim,
  },
  fieldBody: { flex: 1, minWidth: 0 },
  fieldHeading: { minHeight: 38, justifyContent: "center" },
  fieldLabel: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontWeight: FontWeight.semibold,
  },
  fieldHelper: { color: Colors.textSubtle, fontSize: 10, marginTop: 2 },
  fieldControl: { minWidth: 0 },
  rowInput: {
    minHeight: 44,
    paddingHorizontal: 0,
    paddingVertical: 8,
    color: Colors.textPrimary,
    fontSize: 15,
    fontWeight: FontWeight.medium,
  },
  rowInputMultiline: { minHeight: 72, textAlignVertical: "top" },
  characterCount: {
    color: Colors.textSubtle,
    fontSize: 10,
    textAlign: "right",
    marginTop: 2,
  },
  bannerHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  bannerHeadingCompact: { alignItems: "stretch", flexDirection: "column" },
  bannerTitle: {
    color: Colors.textPrimary,
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
  },
  bannerPreview: {
    width: "100%",
    height: 142,
    position: "relative",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderRadius: 16,
    backgroundColor: "rgba(10,11,15,.72)",
    borderWidth: 1,
    borderColor: Colors.borderHighlight,
  },
  bannerOverlay: { ...StyleSheet.absoluteFillObject },
  previewBadge: {
    position: "absolute",
    top: 12,
    left: 12,
    minHeight: 30,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: 15,
    backgroundColor: "rgba(10,10,15,.72)",
  },
  previewBadgeText: { color: Colors.textSecondary, fontSize: 11 },
  bannerFallbackTitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: FontWeight.semibold,
  },
  bannerFallbackBody: {
    maxWidth: 260,
    color: Colors.textSubtle,
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
  },
  bannerLimit: { color: Colors.textSubtle, fontSize: 10, textAlign: "right" },
  primaryButton: {
    minHeight: 58,
    overflow: "hidden",
    borderRadius: 15,
    backgroundColor: Colors.primary,
    ...Shadow.brand,
  },
  stateRetryButton: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  saveArea: { gap: 9 },
  saveGradient: {
    minHeight: 58,
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
  saveFeedback: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "rgba(0,229,160,.08)",
  },
  saveFeedbackError: { backgroundColor: "rgba(255,59,92,.08)" },
  saveFeedbackText: { color: Colors.success, fontSize: 11 },
  saveFeedbackTextError: { color: Colors.error },
  secondaryButton: {
    minHeight: 46,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 15,
    borderRadius: 13,
    backgroundColor: "rgba(16,17,23,.88)",
    borderWidth: 1,
    borderColor: Colors.borderHighlight,
  },
  secondaryButtonText: {
    color: Colors.textPrimary,
    fontWeight: FontWeight.semibold,
    fontSize: 12,
  },
  disabled: { opacity: 0.48 },
  reputationHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  reputationHeadingCompact: {
    alignItems: "flex-start",
    flexDirection: "column",
  },
  viewStoreButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  viewStoreText: {
    color: Colors.primaryLight,
    fontWeight: FontWeight.bold,
    fontSize: 12,
  },
  metrics: { flexDirection: "row", gap: 10 },
  metricsStacked: { flexDirection: "column" },
  metric: {
    flex: 1,
    minWidth: 0,
    minHeight: 132,
    padding: 13,
    borderRadius: 15,
    backgroundColor: "rgba(12,13,18,.65)",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  metricHeading: { flexDirection: "row", alignItems: "center", gap: 5 },
  metricLabel: {
    flexShrink: 1,
    color: Colors.textPrimary,
    fontSize: 11,
    fontWeight: FontWeight.semibold,
  },
  metricScoreRow: {
    minHeight: 39,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 5,
    marginTop: 6,
  },
  metricValue: {
    color: Colors.textPrimary,
    fontSize: 25,
    fontWeight: FontWeight.extrabold,
  },
  metricStars: { flexDirection: "row", alignItems: "center" },
  metricCount: { color: Colors.textSecondary, fontSize: 11 },
  metricCaption: { color: Colors.textSubtle, fontSize: 10, lineHeight: 14 },
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
