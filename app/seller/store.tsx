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
    uploadLock = useRef(false),
    nameInputRef = useRef<TextInput>(null),
    slugInputRef = useRef<TextInput>(null),
    descriptionInputRef = useRef<TextInput>(null);
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
        <View style={[styles.section, styles.logoSection]}>
          <Text style={styles.eyebrow}>IDENTIDAD</Text>
          <Text style={styles.sectionTitle}>Logo de la tienda</Text>
          <Text style={styles.sectionBody}>
            Este logo aparecerá en tu tienda y junto a tus productos.
          </Text>
          <View style={[styles.logoLayout, wide && styles.logoLayoutWide]}>
            <Pressable
              disabled={!store || uploading !== null}
              style={({ pressed }) => [
                styles.logoPressable,
                compact && styles.logoPressableCompact,
                pressed && styles.directControlPressed,
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
                  {uploading === "logo" ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <MaterialCommunityIcons
                      name="pencil-outline"
                      size={19}
                      color="#fff"
                    />
                  )}
                </View>
              </View>
              <Text style={styles.directHint}>
                {logoUrl ? "Toca para cambiar" : "Toca para añadir tu logo"}
              </Text>
            </Pressable>
            <View
              style={[styles.logoGuidance, wide && styles.logoGuidanceWide]}
            >
              <Text style={styles.guidanceText}>JPG · PNG · WebP</Text>
              <Text style={styles.guidanceText}>
                Presentación cuadrada · Máx. 10 MB
              </Text>
              <Text style={styles.guidanceMuted}>
                Fondo transparente recomendado
              </Text>
            </View>
          </View>
        </View>
        <View style={styles.section}>
          <View style={styles.sectionHeadingCopy}>
            <Text style={styles.eyebrow}>INFORMACIÓN</Text>
            <Text style={styles.sectionTitle}>Información de la tienda</Text>
            <Text style={styles.sectionBody}>
              Mantén clara y reconocible tu identidad pública.
            </Text>
          </View>
          <StoreField
            label="Nombre de la tienda"
            helper="Así te encontrarán los compradores"
            active={focusedField === "name"}
            accessibilityLabel="Editar nombre de la tienda"
            onEdit={() => nameInputRef.current?.focus()}
          >
            <TextInput
              ref={nameInputRef}
              style={[styles.rowInput, styles.nameInput]}
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
            label="Identificador público"
            helper={
              slug ? `onspace.app/store/${slug}` : "URL pública de tu tienda"
            }
            active={focusedField === "slug"}
            accessibilityLabel="Editar identificador público"
            onEdit={() => slugInputRef.current?.focus()}
          >
            <TextInput
              ref={slugInputRef}
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
            label="Descripción"
            helper="Resume qué vendes y qué hace especial a tu tienda"
            multiline
            active={focusedField === "description"}
            accessibilityLabel="Editar descripción de la tienda"
            onEdit={() => descriptionInputRef.current?.focus()}
          >
            <View>
              <TextInput
                ref={descriptionInputRef}
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
          <View style={styles.sectionHeadingCopy}>
            <Text style={styles.eyebrow}>PORTADA</Text>
            <Text style={styles.sectionTitle}>Identidad visual</Text>
            <Text style={styles.sectionBody}>
              Personaliza la apariencia pública de tu tienda.
            </Text>
          </View>
          <View style={styles.bannerCopy}>
            <Text style={styles.bannerTitle}>Imagen de portada</Text>
            <Text style={styles.brandHelp}>
              Se mostrará en el encabezado público de tu tienda.
            </Text>
          </View>
          <Pressable
            disabled={!store || uploading !== null}
            style={({ pressed }) => [
              styles.bannerPreview,
              pressed && styles.directControlPressed,
              (!store || uploading !== null) && styles.disabled,
            ]}
            onPress={() => void pickBranding("banner")}
            accessibilityRole="button"
            accessibilityLabel={
              bannerUrl
                ? "Cambiar portada de la tienda"
                : "Subir portada de la tienda"
            }
            accessibilityState={{
              disabled: !store || uploading !== null,
              busy: uploading === "banner",
            }}
          >
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
                <Text style={styles.bannerFallbackTitle}>
                  Toca para añadir portada
                </Text>
                <Text style={styles.bannerFallbackBody}>
                  Usa una imagen horizontal que presente tu marca.
                </Text>
              </>
            )}
            <View style={styles.bannerEditBadge} pointerEvents="none">
              {uploading === "banner" ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <MaterialCommunityIcons
                  name="pencil-outline"
                  size={19}
                  color="#fff"
                />
              )}
            </View>
          </Pressable>
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
              <Text style={styles.eyebrow}>REPUTACIÓN</Text>
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
  label,
  helper,
  active = false,
  multiline = false,
  accessibilityLabel,
  onEdit,
  children,
}: {
  label: string;
  helper: string;
  active?: boolean;
  multiline?: boolean;
  accessibilityLabel: string;
  onEdit: () => void;
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
      <View style={styles.fieldBody}>
        <View style={styles.fieldHeading}>
          <Text style={styles.fieldLabel}>{label}</Text>
          <Text style={styles.fieldHelper} numberOfLines={1}>
            {helper}
          </Text>
        </View>
        <View style={styles.fieldControl}>{children}</View>
      </View>
      <Pressable
        style={({ pressed }) => [
          styles.fieldEditButton,
          pressed && styles.directControlPressed,
        ]}
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        <MaterialCommunityIcons
          name="pencil-outline"
          size={19}
          color={active ? Colors.primaryLight : Colors.textSecondary}
        />
      </Pressable>
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
    paddingTop: 16,
    paddingBottom: 52,
    gap: 22,
  },
  section: {
    gap: 12,
    paddingHorizontal: 4,
    paddingBottom: 22,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(111,105,137,.22)",
  },
  logoSection: { paddingTop: 2 },
  eyebrow: {
    color: Colors.primaryLight,
    fontSize: 10,
    fontWeight: FontWeight.bold,
    letterSpacing: 1.25,
  },
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
  sectionHeadingCopy: { minWidth: 0, gap: 2 },
  logoLayout: {
    width: "100%",
    alignItems: "center",
    gap: 14,
    paddingTop: 4,
  },
  logoLayoutWide: { flexDirection: "row", justifyContent: "center" },
  logoPressable: { alignItems: "center", gap: 8, padding: 4 },
  logoPressableCompact: { padding: 2 },
  logoPreviewShell: { width: 136, height: 136, position: "relative" },
  logoPreviewShellCompact: { width: 108, height: 108 },
  logoRing: {
    flex: 1,
    borderRadius: 999,
    padding: 3,
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
  },
  directHint: {
    color: Colors.primaryLight,
    fontSize: 11,
    fontWeight: FontWeight.semibold,
  },
  directControlPressed: { opacity: 0.72 },
  logoGuidance: {
    alignItems: "center",
    gap: 5,
    paddingVertical: 6,
  },
  logoGuidanceWide: { alignItems: "flex-start" },
  guidanceText: { color: Colors.textSecondary, fontSize: 12 },
  guidanceMuted: { color: Colors.textSubtle, fontSize: 11 },
  brandImage: { width: "100%", height: "100%" },
  fallbackText: { color: Colors.textSubtle, fontSize: 11 },
  brandHelp: { color: Colors.textSecondary, fontSize: 11, lineHeight: 16 },
  storeField: {
    minHeight: 88,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  storeFieldActive: {
    borderBottomWidth: 2,
    borderBottomColor: Colors.primaryLight,
  },
  storeFieldMultiline: { minHeight: 136 },
  fieldBody: { flex: 1, minWidth: 0 },
  fieldHeading: { minHeight: 34, justifyContent: "center" },
  fieldLabel: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontWeight: FontWeight.semibold,
  },
  fieldHelper: { color: Colors.textSubtle, fontSize: 10, marginTop: 2 },
  fieldControl: { minWidth: 0 },
  fieldEditButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 24,
  },
  rowInput: {
    minHeight: 44,
    paddingHorizontal: 0,
    paddingVertical: 8,
    color: Colors.textPrimary,
    fontSize: 15,
    fontWeight: FontWeight.medium,
  },
  nameInput: { fontSize: 17, fontWeight: FontWeight.semibold },
  rowInputMultiline: { minHeight: 72, textAlignVertical: "top" },
  characterCount: {
    color: Colors.textSubtle,
    fontSize: 10,
    textAlign: "right",
    marginTop: 2,
  },
  bannerCopy: { gap: 2 },
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
  bannerEditBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(9,9,14,.82)",
    borderWidth: 1,
    borderColor: "rgba(161,131,255,.72)",
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
