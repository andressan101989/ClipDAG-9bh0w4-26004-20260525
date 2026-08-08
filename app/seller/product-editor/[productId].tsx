import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { randomUUID } from "expo-crypto";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors, Radius, Spacing } from "@/constants/theme";
import { uploadMediaFromUri } from "@/services/mediaService";
import {
  createOrResumeMarketplaceProductDraft,
  fetchMarketplaceProductDraft,
  persistMarketplaceProductMedia,
  saveMarketplaceProductDraft,
  type MarketplaceProductDraft,
  type ProductEditorMedia,
} from "@/services/marketplaceProductDraftService";
import { calculateMarketplaceProductQuality } from "@/services/marketplaceProductQuality";
import {
  evaluateMarketplaceProductPublication,
  fetchCategories,
  fetchSellerFoundation,
  fetchSellerProductVariants,
  setProductPublished,
  setVariantInventory,
  updateVariant,
  type MarketplaceCategoryRecord,
} from "@/services/marketplaceService";
import {
  fetchMyMarketplaceShippingProfiles,
  type MarketplaceShippingProfile,
} from "@/services/marketplaceShippingService";
import {
  fetchMyLiveAffiliateOffer,
  upsertMyLiveAffiliateOffer,
} from "@/services/liveCommerceService";
import { creatorCommissionPercentToBps } from "@/services/affiliateCommissionState";
import { ProductEditorProgress } from "@/components/marketplace/product-editor/ProductEditorProgress";
import { ProductQualityScore } from "@/components/marketplace/product-editor/ProductQualityScore";
import { ProductMediaTile } from "@/components/marketplace/product-editor/ProductMediaTile";
import {
  Choice,
  EditorCard,
  EditorField,
} from "@/components/marketplace/product-editor/ProductEditorFields";

const EMPTY = {
  title: "Producto sin titulo",
  description: "",
  price: "1",
  brand: "",
  stock: "0",
  productType: "physical" as const,
  tags: [] as string[],
};
export default function ProductEditorScreen() {
  const params = useLocalSearchParams<{ productId: string }>(),
    router = useRouter(),
    insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [publishing, setPublishing] = useState(false),
    [step, setStep] = useState(0),
    [productId, setProductId] = useState<string | null>(
      params.productId === "new" ? null : params.productId,
    ),
    [storeId, setStoreId] = useState(""),
    [categories, setCategories] = useState<MarketplaceCategoryRecord[]>([]),
    [categoryId, setCategoryId] = useState(""),
    [shippingProfiles, setShippingProfiles] = useState<
      MarketplaceShippingProfile[]
    >([]),
    [shippingProfileId, setShippingProfileId] = useState<string | null>(null),
    [title, setTitle] = useState(EMPTY.title),
    [description, setDescription] = useState(""),
    [price, setPrice] = useState("1"),
    [brand, setBrand] = useState(""),
    [stock, setStock] = useState("0"),
    [productType, setProductType] = useState<"physical" | "digital">(
      "physical",
    ),
    [images, setImages] = useState<ProductEditorMedia[]>([]),
    [video, setVideo] = useState<ProductEditorMedia | null>(null),
    [dirty, setDirty] = useState(false),
    [message, setMessage] = useState(""),
    [affiliateEnabled, setAffiliateEnabled] = useState(false),
    [affiliatePercent, setAffiliatePercent] = useState("10"),
    saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shippingReady =
    productType === "digital" ||
    shippingProfiles.some(
      (x) =>
        x.id === shippingProfileId &&
        x.status === "active" &&
        x.configurationStatus === "explicit_ready",
    );
  const quality = useMemo(
    () =>
      calculateMarketplaceProductQuality({
        title,
        description,
        categoryId: categoryId || null,
        imageCount: images.filter((x) => x.state === "ready").length,
        hasValidVideo: Boolean(
          video?.durationMs &&
            video.durationMs <= 60000 &&
            video.state === "ready",
        ),
        price: Number(price),
        inventory: Number(stock),
        variantsReady: true,
        shippingReady,
        productType,
      }),
    [
      title,
      description,
      categoryId,
      images,
      video,
      price,
      stock,
      shippingReady,
      productType,
    ],
  );
  const hydrate = (d: MarketplaceProductDraft) => {
    setProductId(d.id);
    setStoreId(d.storeId);
    setCategoryId(d.categoryId);
    setTitle(d.title);
    setDescription(d.description);
    setPrice(String(d.price));
    setBrand(d.brand);
    setStock(String(d.stock));
    setShippingProfileId(d.shippingProfileId);
    setProductType(d.productType);
    setImages(d.media.filter((x) => x.kind === "image"));
    setVideo(d.media.find((x) => x.kind === "video") ?? null);
  };
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [foundation, cats] = await Promise.all([
        fetchSellerFoundation(),
        fetchCategories(),
      ]);
      if (!foundation.store || foundation.seller?.status !== "approved")
        throw new Error("seller_not_ready");
      setStoreId(foundation.store.id);
      setCategories(cats);
      const defaultCategory =
        cats.find((x) => x.slug === "physical") ?? cats[0];
      if (!defaultCategory) throw new Error("category_missing");
      let id = productId;
      if (!id) {
        id = await createOrResumeMarketplaceProductDraft(
          foundation.store.id,
          defaultCategory.id,
          randomUUID(),
        );
        router.replace(`/seller/product-editor/${id}` as never);
      }
      hydrate(await fetchMarketplaceProductDraft(id));
      const affiliate = await fetchMyLiveAffiliateOffer(id).catch(() => null);
      setAffiliateEnabled(affiliate?.status === "active");
      if (affiliate) setAffiliatePercent(String(affiliate.commissionBps / 100));
      setShippingProfiles(
        await fetchMyMarketplaceShippingProfiles(foundation.store.id),
      );
    } catch {
      Alert.alert(
        "No pudimos abrir el borrador",
        "Tu trabajo guardado permanece seguro. Intentalo nuevamente.",
      );
    } finally {
      setLoading(false);
    }
  }, [productId, router]);
  useEffect(() => {
    void load();
  }, [load]);
  const save = useCallback(
    async (silent = false) => {
      if (!productId || !categoryId) return;
      const numericPrice = Number(price),
        numericStock = Number(stock);
      if (
        !title.trim() ||
        !Number.isFinite(numericPrice) ||
        numericPrice <= 0 ||
        !Number.isInteger(numericStock) ||
        numericStock < 0
      ) {
        if (!silent)
          Alert.alert(
            "Revisa el producto",
            "Completa nombre, precio e inventario con valores validos.",
          );
        return;
      }
      setSaving(true);
      try {
        await saveMarketplaceProductDraft({
          id: productId,
          storeId,
          categoryId,
          title: title.trim(),
          description,
          price: numericPrice,
          brand,
          compareAtPrice: null,
          stock: numericStock,
          tags: [],
          shippingProfileId,
          productType,
        });
        await persistMarketplaceProductMedia(
          productId,
          images.filter((x) => x.state === "ready"),
          images.find((x) => x.isCover)?.assetId ?? images[0]?.assetId ?? null,
          video?.state === "ready" ? video : null,
        );
        setDirty(false);
        setMessage("Borrador guardado");
        if (!silent)
          Alert.alert("Borrador guardado", "Puedes continuar cuando quieras.");
      } catch {
        setMessage("No pudimos guardar. Reintenta.");
        if (!silent)
          Alert.alert(
            "No pudimos guardar",
            "El borrador anterior permanece seguro.",
          );
      } finally {
        setSaving(false);
      }
    },
    [
      productId,
      categoryId,
      price,
      stock,
      title,
      storeId,
      description,
      brand,
      shippingProfileId,
      productType,
      images,
      video,
    ],
  );
  useEffect(() => {
    if (!dirty || loading) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(true), 1200);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [dirty, loading, save]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active" && dirty) void save(true);
    });
    return () => sub.remove();
  }, [dirty, save]);
  const change =
    <T,>(setter: React.Dispatch<React.SetStateAction<T>>) =>
    (value: T) => {
      setter(value);
      setDirty(true);
    };
  const persistMedia = async (
    nextImages: ProductEditorMedia[],
    nextVideo: ProductEditorMedia | null,
  ) => {
    if (!productId) return;
    setImages(nextImages);
    setVideo(nextVideo);
    await persistMarketplaceProductMedia(
      productId,
      nextImages.filter((x) => x.state === "ready"),
      nextImages.find((x) => x.isCover)?.assetId ??
        nextImages[0]?.assetId ??
        null,
      nextVideo?.state === "ready" ? nextVideo : null,
    );
  };
  const addPhotos = async () => {
    if (images.length >= 5) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: 5 - images.length,
      quality: 1,
    });
    if (result.canceled) return;
    let uploadedImages = images.filter((x) => x.state === "ready");
    for (const asset of result.assets.slice(0, 5 - images.length)) {
      const local: ProductEditorMedia = {
        assetId: randomUUID(),
        url: asset.uri,
        kind: "image",
        mimeType: asset.mimeType ?? "image/jpeg",
        durationMs: null,
        position: uploadedImages.length,
        isCover: uploadedImages.length === 0,
        state: "uploading",
      };
      setImages((current) => [...current, local]);
      try {
        const uploaded = await uploadMediaFromUri({
          uri: asset.uri,
          purpose: "product_image",
          mimeType: asset.mimeType ?? "image/jpeg",
          fileName: asset.fileName ?? undefined,
          sizeBytes: asset.fileSize,
          visibility: "public",
        });
        const ready = {
          ...local,
          assetId: uploaded.assetId,
          url: uploaded.url!,
          state: "ready" as const,
        };
        const next = [...uploadedImages, ready].slice(0, 5).map((x, i) => ({
          ...x,
          position: i,
          isCover: uploadedImages.length === 0 ? i === 0 : x.isCover,
        }));
        uploadedImages = next;
        await persistMedia(next, video);
      } catch {
        setImages((current) =>
          current.map((x) =>
            x.assetId === local.assetId ? { ...x, state: "failed" } : x,
          ),
        );
      }
    }
  };
  const addVideo = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: false,
    });
    if (result.canceled) return;
    const asset = result.assets[0],
      duration = asset.duration ?? 0;
    if (duration <= 0) {
      Alert.alert(
        "Video no valido",
        "No pudimos procesar este video. Selecciona otro archivo.",
      );
      return;
    }
    if (duration > 60000) {
      Alert.alert(
        "Video demasiado largo",
        "El video debe durar 60 segundos o menos.",
      );
      return;
    }
    const mime =
      asset.mimeType ??
      (asset.fileName?.toLowerCase().endsWith(".mov")
        ? "video/quicktime"
        : "video/mp4");
    if (!["video/mp4", "video/quicktime"].includes(mime)) {
      Alert.alert("Formato no compatible", "Selecciona un video MP4 o MOV.");
      return;
    }
    const local: ProductEditorMedia = {
      assetId: randomUUID(),
      url: asset.uri,
      kind: "video",
      mimeType: mime,
      durationMs: duration,
      position: 0,
      isCover: false,
      state: "uploading",
    };
    setVideo(local);
    try {
      const uploaded = await uploadMediaFromUri({
        uri: asset.uri,
        purpose: "product_video",
        mimeType: mime,
        fileName: asset.fileName ?? undefined,
        sizeBytes: asset.fileSize,
        durationMs: duration,
        visibility: "public",
        timeoutMs: 300000,
      });
      await persistMedia(images, {
        ...local,
        assetId: uploaded.assetId,
        url: uploaded.url!,
        state: "ready",
      });
    } catch {
      setVideo({ ...local, state: "failed" });
    }
  };
  const retryMedia = async (item: ProductEditorMedia) => {
    try {
      const uploaded = await uploadMediaFromUri({
        uri: item.url,
        purpose: item.kind === "video" ? "product_video" : "product_image",
        mimeType:
          item.mimeType ?? (item.kind === "video" ? "video/mp4" : "image/jpeg"),
        durationMs: item.durationMs ?? undefined,
        visibility: "public",
        timeoutMs: item.kind === "video" ? 300000 : 120000,
      });
      const ready = {
        ...item,
        assetId: uploaded.assetId,
        url: uploaded.url!,
        state: "ready" as const,
      };
      if (item.kind === "video") await persistMedia(images, ready);
      else
        await persistMedia(
          images.map((x) => (x.assetId === item.assetId ? ready : x)),
          video,
        );
    } catch {
      Alert.alert(
        "No pudimos subir este archivo",
        "Revisa tu conexion e intentalo nuevamente.",
      );
    }
  };
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= images.length) return;
    const next = [...images];
    [next[index], next[target]] = [next[target], next[index]];
    void persistMedia(
      next.map((x, i) => ({ ...x, position: i })),
      video,
    );
  };
  const removeImage = (assetId: string) => {
    const remaining = images
      .filter((x) => x.assetId !== assetId)
      .map((x, i) => ({ ...x, position: i }));
    if (remaining.length && !remaining.some((x) => x.isCover))
      remaining[0] = { ...remaining[0], isCover: true };
    void persistMedia(remaining, video);
  };
  const publish = async () => {
    if (!productId) return;
    const numericPrice = Number(price);
    const numericStock = Number(stock);
    if (
      !title.trim() ||
      !categoryId ||
      !Number.isFinite(numericPrice) ||
      numericPrice <= 0 ||
      !Number.isInteger(numericStock) ||
      numericStock < 0
    ) {
      Alert.alert(
        "Revisa el producto",
        "Completa nombre, categoria, precio e inventario con valores validos.",
      );
      return;
    }
    if (productType === "physical" && !shippingReady) {
      Alert.alert(
        "Configuracion de envio requerida",
        "Selecciona un perfil con destinos configurados antes de publicar.",
      );
      return;
    }
    setPublishing(true);
    try {
      await save(true);
      if (images.some((x) => x.state !== "ready") || !images.length)
        throw new Error("media");
      const inventory = await fetchSellerProductVariants(productId),
        configurableVariants = inventory.detail.variants.filter(
          (x) => x.status !== "archived",
        ),
        defaultVariant = configurableVariants.find((x) => x.is_default);
      if (!defaultVariant) throw new Error("variant");
      if (
        configurableVariants.length === 1 &&
        inventory.detail.options.length === 0
      ) {
        await updateVariant(defaultVariant.id, {
          sku:
            defaultVariant.sku ?? `SKU-${productId.slice(0, 8).toUpperCase()}`,
          price: Number(price),
          status: "active",
          imageAssetId: null,
        });
        const currentInventory = inventory.inventory.find(
          (x) => x.variant_id === defaultVariant.id,
        );
        if (currentInventory?.on_hand !== Number(stock))
          await setVariantInventory(
            defaultVariant.id,
            Number(stock),
            "Publicacion V2",
            randomUUID(),
          );
      }
      const readiness = await evaluateMarketplaceProductPublication(productId);
      if (!readiness.ready)
        throw new Error(readiness.reasonCode ?? "not_ready");
      await setProductPublished(productId, true);
      if (affiliateEnabled)
        await upsertMyLiveAffiliateOffer({
          productId,
          offerScope: "public_creator",
          creatorId: null,
          commissionBps: creatorCommissionPercentToBps(affiliatePercent),
          status: "active",
          startsAt: null,
          endsAt: null,
          idempotencyKey: randomUUID(),
        }).catch(() =>
          Alert.alert(
            "Producto publicado, afiliados pendientes",
            "Reintentar activar afiliados desde la edición del producto.",
          ),
        );
      Alert.alert(
        "Producto publicado",
        "Tu producto ya esta disponible en Marketplace.",
        [
          {
            text: "Ver productos",
            onPress: () => router.replace("/seller/products"),
          },
        ],
      );
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      const friendly = code.includes("media")
        ? "Agrega al menos una foto lista."
        : code.includes("shipping")
          ? "Completa la configuracion de envio."
          : code.includes("inventory") || code.includes("stock")
            ? "Configura el inventario."
            : "Completa los datos marcados antes de publicar.";
      Alert.alert("Aun no se puede publicar", friendly);
    } finally {
      setPublishing(false);
    }
  };
  if (loading)
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={Colors.primary} />
        <Text style={styles.muted}>Preparando tu borrador...</Text>
      </View>
    );
  const nav = (
    <View style={styles.nav}>
      {step > 0 ? (
        <Pressable
          style={styles.secondary}
          onPress={() => setStep((x) => x - 1)}
        >
          <Text style={styles.secondaryText}>Anterior</Text>
        </Pressable>
      ) : (
        <View />
      )}
      {step < 5 ? (
        <Pressable style={styles.primary} onPress={() => setStep((x) => x + 1)}>
          <Text style={styles.primaryText}>Continuar</Text>
        </Pressable>
      ) : (
        <Pressable
          disabled={publishing}
          style={[styles.primary, publishing && styles.disabled]}
          onPress={() => void publish()}
        >
          {publishing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryText}>Publicar producto</Text>
          )}
        </Pressable>
      )}
    </View>
  );
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingTop: insets.top + Spacing.md,
          paddingBottom: insets.bottom + 100,
          paddingHorizontal: Spacing.md,
          gap: Spacing.md,
        }}
      >
        <View style={styles.header}>
          <Pressable
            onPress={() => {
              if (dirty) void save(true);
              router.back();
            }}
          >
            <Text style={styles.back}>‹</Text>
          </Pressable>
          <View>
            <Text style={styles.heading}>
              {params.productId === "new"
                ? "Crear producto"
                : "Editar producto"}
            </Text>
            <Text style={styles.muted}>{message || "Borrador privado"}</Text>
          </View>
          <Pressable disabled={saving} onPress={() => void save()}>
            <Text style={styles.save}>Guardar borrador</Text>
          </Pressable>
        </View>
        <ProductEditorProgress step={step} />
        <ProductQualityScore quality={quality} />
        {step === 0 ? (
          <EditorCard title="Informacion">
            <EditorField
              label="Nombre del producto"
              hint={`${title.length}/80`}
              value={title}
              onChange={change(setTitle)}
            />
            <EditorField
              label="Descripcion"
              hint={`${description.length}/2000`}
              value={description}
              onChange={change(setDescription)}
              multiline
            />
            <EditorField
              label="Marca (opcional)"
              value={brand}
              onChange={change(setBrand)}
            />
            <Text style={styles.label}>Categoria</Text>
            <View style={styles.choices}>
              {categories.map((c) => (
                <Choice
                  key={c.id}
                  label={c.name}
                  selected={categoryId === c.id}
                  onPress={() => {
                    setCategoryId(c.id);
                    setDirty(true);
                  }}
                />
              ))}
            </View>
          </EditorCard>
        ) : null}
        {step === 1 ? (
          <EditorCard title="Fotos y video">
            <Text style={styles.muted}>
              Fotos del producto {images.length}/5. Agrega hasta 5 fotos claras.
            </Text>
            <View style={styles.grid}>
              {images.map((item, index) => (
                <ProductMediaTile
                  key={item.assetId}
                  item={item}
                  onCover={() =>
                    void persistMedia(
                      images.map((x) => ({
                        ...x,
                        isCover: x.assetId === item.assetId,
                      })),
                      video,
                    )
                  }
                  onRemove={() => removeImage(item.assetId)}
                  onRetry={() => void retryMedia(item)}
                  onMoveLeft={index ? () => move(index, -1) : undefined}
                  onMoveRight={
                    index < images.length - 1 ? () => move(index, 1) : undefined
                  }
                />
              ))}
            </View>
            <Pressable
              disabled={images.length >= 5}
              style={[styles.secondary, images.length >= 5 && styles.disabled]}
              onPress={() => void addPhotos()}
            >
              <Text style={styles.secondaryText}>Agregar fotos</Text>
            </Pressable>
            <Text style={styles.label}>
              Video del producto · Opcional · Maximo 60 segundos
            </Text>
            {video ? (
              <ProductMediaTile
                item={video}
                onRetry={() => void retryMedia(video)}
                onRemove={() => void persistMedia(images, null)}
              />
            ) : null}
            <Text style={styles.label}>
              Permitir que otros creadores vendan este producto
            </Text>
            <Choice
              label={
                affiliateEnabled ? "Afiliados activados" : "Activar afiliados"
              }
              selected={affiliateEnabled}
              onPress={() => setAffiliateEnabled((x) => !x)}
            />
            {affiliateEnabled ? (
              <EditorField
                label="Comision del creador (%)"
                value={affiliatePercent}
                onChange={setAffiliatePercent}
                keyboardType="decimal-pad"
              />
            ) : null}
            <Pressable style={styles.secondary} onPress={() => void addVideo()}>
              <Text style={styles.secondaryText}>
                {video ? "Cambiar video" : "Agregar video"}
              </Text>
            </Pressable>
          </EditorCard>
        ) : null}
        {step === 2 ? (
          <EditorCard title="Precio e inventario">
            <EditorField
              label="Precio"
              value={price}
              onChange={change(setPrice)}
              keyboardType="decimal-pad"
            />
            <Text style={styles.currency}>BDAG</Text>
            <EditorField
              label="Stock disponible"
              value={stock}
              onChange={change(setStock)}
              keyboardType="number-pad"
            />
          </EditorCard>
        ) : null}
        {step === 3 ? (
          <EditorCard title="Variantes">
            <Text style={styles.body}>
              Cada producto conserva una variante predeterminada. Puedes
              configurar Color, Talla, SKU y existencias por variante en el
              editor especializado.
            </Text>
            {productId ? (
              <Pressable
                style={styles.secondary}
                onPress={() =>
                  router.push(`/seller/product/${productId}/variants`)
                }
              >
                <Text style={styles.secondaryText}>Configurar variantes</Text>
              </Pressable>
            ) : null}
          </EditorCard>
        ) : null}
        {step === 4 ? (
          <EditorCard title="Envio">
            <View style={styles.choices}>
              {productType === "physical" ? (
                shippingProfiles.map((p) => (
                  <Choice
                    key={p.id}
                    label={`${p.name}${p.configurationStatus === "explicit_ready" ? "" : " · Configuracion requerida"}`}
                    selected={shippingProfileId === p.id}
                    disabled={
                      p.status !== "active" ||
                      p.configurationStatus !== "explicit_ready"
                    }
                    onPress={() => {
                      setShippingProfileId(p.id);
                      setDirty(true);
                    }}
                  />
                ))
              ) : (
                <Text style={styles.body}>
                  Los productos digitales no tienen cargo de envio.
                </Text>
              )}
            </View>
            {productType === "physical" && !shippingReady ? (
              <>
                <Text style={styles.warning}>
                  Configuracion de envio requerida
                </Text>
                <Pressable
                  style={styles.secondary}
                  onPress={() =>
                    router.push({
                      pathname: "/seller/shipping-profile",
                      params: { storeId, profileId: shippingProfileId ?? "" },
                    })
                  }
                >
                  <Text style={styles.secondaryText}>Configurar envio</Text>
                </Pressable>
              </>
            ) : null}
          </EditorCard>
        ) : null}
        {step === 5 ? (
          <EditorCard title="Vista previa">
            {images[0] ? (
              <Image
                source={{
                  uri: (images.find((x) => x.isCover) ?? images[0]).url,
                }}
                style={styles.preview}
              />
            ) : (
              <View style={[styles.preview, styles.center]}>
                <Text style={styles.muted}>Agrega una portada</Text>
              </View>
            )}
            <Text style={styles.previewTitle}>{title}</Text>
            <Text style={styles.price}>{price} BDAG</Text>
            <Text style={styles.body}>{description || "Sin descripcion"}</Text>
            <Text style={styles.muted}>
              {stock} disponibles ·{" "}
              {shippingReady ? "Envio configurado" : "Envio pendiente"}
            </Text>
            {video ? (
              <Text style={styles.videoReady}>
                Video listo · {Math.ceil((video.durationMs ?? 0) / 1000)}s
              </Text>
            ) : null}
            <Text style={styles.previewBadge}>
              Vista previa privada · no genera impresiones
            </Text>
          </EditorCard>
        ) : null}
        {nav}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  center: { alignItems: "center", justifyContent: "center", gap: 12 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  heading: { fontSize: 23, fontWeight: "900", color: Colors.textPrimary },
  back: { fontSize: 40, color: Colors.textPrimary },
  save: { color: Colors.primaryLight, fontWeight: "800" },
  muted: { color: Colors.textSecondary },
  label: { color: Colors.textPrimary, fontWeight: "800" },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  nav: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  primary: {
    minHeight: 50,
    minWidth: 140,
    paddingHorizontal: 18,
    borderRadius: Radius.md,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: "#fff", fontWeight: "800" },
  secondary: {
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { color: Colors.primaryLight, fontWeight: "800" },
  disabled: { opacity: 0.4 },
  body: { color: Colors.textSecondary, lineHeight: 21 },
  currency: { color: Colors.primaryLight, fontWeight: "800" },
  warning: { color: Colors.warning, fontWeight: "800" },
  preview: {
    width: "100%",
    aspectRatio: 1.4,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceElevated,
  },
  previewTitle: { fontSize: 24, fontWeight: "900", color: Colors.textPrimary },
  price: { fontSize: 21, fontWeight: "900", color: Colors.primaryLight },
  previewBadge: { color: Colors.textSubtle, fontSize: 12 },
  videoReady: { color: Colors.success, fontWeight: "700" },
});
