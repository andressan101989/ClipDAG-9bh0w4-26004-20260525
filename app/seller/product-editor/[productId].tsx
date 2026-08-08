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
  BackHandler,
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
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors, Radius, Spacing } from "@/constants/theme";
import { getSafeMediaError, uploadMediaFromUri } from "@/services/mediaService";
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
  deriveMarketplaceVariantsReady,
  LatestSaveQueue,
  readyProductImages,
  replaceEditorMedia,
} from "@/services/marketplaceProductEditorState";
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
interface SaveSnapshot {
  productId: string;
  storeId: string;
  categoryId: string;
  title: string;
  description: string;
  price: number;
  brand: string;
  stock: number;
  shippingProfileId: string | null;
  productType: "physical" | "digital";
  images: ProductEditorMedia[];
  persistedVideo: ProductEditorMedia | null;
  titleConfigured: boolean;
  priceConfigured: boolean;
  categoryConfigured: boolean;
}
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
    [persistedVideo, setPersistedVideo] = useState<ProductEditorMedia | null>(
      null,
    ),
    [pendingVideo, setPendingVideo] = useState<ProductEditorMedia | null>(null),
    [variantsReady, setVariantsReady] = useState(false),
    [variantSummary, setVariantSummary] = useState({ options: 0, variants: 1 }),
    [titleConfigured, setTitleConfigured] = useState(false),
    [priceConfigured, setPriceConfigured] = useState(false),
    [categoryConfigured, setCategoryConfigured] = useState(false),
    [dirty, setDirty] = useState(false),
    [message, setMessage] = useState(""),
    [affiliateEnabled, setAffiliateEnabled] = useState(false),
    [affiliatePercent, setAffiliatePercent] = useState("10"),
    saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    saveQueue = useRef(new LatestSaveQueue<SaveSnapshot>()),
    mediaQueue = useRef<Promise<void>>(Promise.resolve()),
    imagesRef = useRef<ProductEditorMedia[]>([]),
    persistedVideoRef = useRef<ProductEditorMedia | null>(null),
    pendingVideoRef = useRef<ProductEditorMedia | null>(null);
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
        titleConfigured,
        description,
        categoryId: categoryId || null,
        categoryConfigured,
        imageCount: images.filter((x) => x.state === "ready").length,
        hasValidVideo: Boolean(
          persistedVideo?.durationMs && persistedVideo.durationMs <= 60000,
        ),
        price: Number(price),
        priceConfigured,
        inventory: Number(stock),
        variantsReady,
        shippingReady,
        productType,
      }),
    [
      title,
      description,
      categoryId,
      images,
      persistedVideo,
      price,
      priceConfigured,
      stock,
      variantsReady,
      shippingReady,
      productType,
      titleConfigured,
      categoryConfigured,
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
    const nextImages = d.media.filter((x) => x.kind === "image");
    const nextVideo = d.media.find((x) => x.kind === "video") ?? null;
    imagesRef.current = nextImages;
    persistedVideoRef.current = nextVideo;
    pendingVideoRef.current = null;
    setImages(nextImages);
    setPersistedVideo(nextVideo);
    setPendingVideo(null);
    setTitleConfigured(d.titleConfigured);
    setPriceConfigured(d.priceConfigured);
    setCategoryConfigured(d.categoryConfigured);
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
      const variantData = await fetchSellerProductVariants(id);
      setVariantsReady(deriveMarketplaceVariantsReady(variantData));
      setVariantSummary({
        options: variantData.detail.options.length,
        variants: variantData.detail.variants.filter(
          (variant) => variant.status === "active",
        ).length,
      });
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
  const refreshShippingProfiles = useCallback(async () => {
    if (!storeId) return;
    if (__DEV__)
      console.info("[MarketplaceProductEditor]", {
        operation: "shipping_refresh_start",
        storeIdPresent: true,
      });
    try {
      const profiles = await fetchMyMarketplaceShippingProfiles(storeId);
      setShippingProfiles(profiles);
      const currentReady = profiles.some(
        (profile) =>
          profile.id === shippingProfileId &&
          profile.status === "active" &&
          profile.configurationStatus === "explicit_ready",
      );
      const selected = currentReady
        ? shippingProfileId
        : profiles.find(
            (profile) =>
              profile.status === "active" &&
              profile.configurationStatus === "explicit_ready",
          )?.id ?? null;
      if (selected && selected !== shippingProfileId) {
        setShippingProfileId(selected);
        saveQueue.current.edit();
        setDirty(true);
        setMessage("Envío configurado");
        if (__DEV__)
          console.info("[MarketplaceProductEditor]", {
            operation: "shipping_profile_selected",
            profileIdPresent: true,
          });
      }
      if (__DEV__)
        console.info("[MarketplaceProductEditor]", {
          operation: "shipping_refresh_success",
          profileCount: profiles.length,
          selectedProfilePresent: Boolean(selected),
        });
    } catch (error) {
      if (__DEV__)
        console.info("[MarketplaceProductEditor]", {
          operation: "shipping_refresh_failed",
          code:
            error && typeof error === "object" && "code" in error
              ? String(error.code)
              : null,
        });
    }
  }, [shippingProfileId, storeId]);
  const refreshVariantSummary = useCallback(async () => {
    if (!productId) return;
    try {
      const variantData = await fetchSellerProductVariants(productId);
      setVariantsReady(deriveMarketplaceVariantsReady(variantData));
      setVariantSummary({
        options: variantData.detail.options.length,
        variants: variantData.detail.variants.filter(
          (variant) => variant.status === "active",
        ).length,
      });
    } catch {
      setVariantsReady(false);
    }
  }, [productId]);
  useFocusEffect(
    useCallback(() => {
      if (storeId) {
        if (__DEV__)
          console.info("[MarketplaceProductEditor]", {
            operation: "shipping_setup_return",
          });
        void refreshShippingProfiles();
        void refreshVariantSummary();
      }
    }, [refreshShippingProfiles, refreshVariantSummary, storeId]),
  );
  const snapshot = useCallback((): SaveSnapshot | null => {
    const numericPrice = Number(price),
      numericStock = Number(stock);
    if (
      !productId ||
      !categoryId ||
      !title.trim() ||
      !Number.isFinite(numericPrice) ||
      numericPrice <= 0 ||
      !Number.isInteger(numericStock) ||
      numericStock < 0
    )
      return null;
    return {
      productId,
      storeId,
      categoryId,
      title: title.trim(),
      description,
      price: numericPrice,
      brand,
      stock: numericStock,
      shippingProfileId,
      productType,
      images: imagesRef.current,
      persistedVideo: persistedVideoRef.current,
      titleConfigured,
      priceConfigured,
      categoryConfigured,
    };
  }, [
    price,
    stock,
    productId,
    categoryId,
    title,
    storeId,
    description,
    brand,
    shippingProfileId,
    productType,
    titleConfigured,
    priceConfigured,
    categoryConfigured,
  ]);
  const flushDraftSave = useCallback(
    async (silent = false): Promise<boolean> => {
      const current = snapshot();
      if (!current) {
        if (!silent)
          Alert.alert(
            "Revisa el producto",
            "Completa nombre, precio e inventario con valores validos.",
          );
        return false;
      }
      setSaving(true);
      try {
        const result = await saveQueue.current.enqueue(
          current,
          async (value) => {
            await saveMarketplaceProductDraft({
              id: value.productId,
              storeId: value.storeId,
              categoryId: value.categoryId,
              title: value.title,
              description: value.description,
              price: value.price,
              brand: value.brand,
              compareAtPrice: null,
              stock: value.stock,
              tags: [],
              shippingProfileId: value.shippingProfileId,
              productType: value.productType,
              titleConfigured: value.titleConfigured,
              priceConfigured: value.priceConfigured,
              categoryConfigured: value.categoryConfigured,
            });
            await mediaQueue.current;
          },
        );
        if (result.current) {
          setDirty(false);
          setMessage("Borrador guardado");
          if (!silent)
            Alert.alert(
              "Borrador guardado",
              "Puedes continuar cuando quieras.",
            );
        }
        return result.succeeded;
      } catch {
        setMessage("No pudimos guardar. Reintenta.");
        if (!silent)
          Alert.alert(
            "No pudimos guardar",
            "El borrador anterior permanece seguro.",
          );
        return false;
      } finally {
        setSaving(false);
      }
    },
    [snapshot],
  );
  useEffect(() => {
    if (!dirty || loading) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flushDraftSave(true), 1200);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [dirty, loading, flushDraftSave]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active" && dirty) void flushDraftSave(true);
    });
    return () => sub.remove();
  }, [dirty, flushDraftSave]);
  const change =
    <T,>(setter: React.Dispatch<React.SetStateAction<T>>) =>
    (value: T) => {
      setter(value);
      saveQueue.current.edit();
      setDirty(true);
    };
  const updateImages = (next: ProductEditorMedia[]) => {
    imagesRef.current = next;
    setImages(next);
  };
  const updatePersistedVideo = (next: ProductEditorMedia | null) => {
    persistedVideoRef.current = next;
    setPersistedVideo(next);
  };
  const updatePendingVideo = (next: ProductEditorMedia | null) => {
    pendingVideoRef.current = next;
    setPendingVideo(next);
  };
  const queueMediaPersistence = (
    nextImages: ProductEditorMedia[],
    nextVideo: ProductEditorMedia | null,
  ) => {
    if (!productId) return Promise.resolve();
    const ready = readyProductImages(nextImages);
    const cover =
      ready.find((item) => item.isCover)?.assetId ?? ready[0]?.assetId ?? null;
    const operation = mediaQueue.current.then(() =>
      persistMarketplaceProductMedia(productId, ready, cover, nextVideo),
    );
    mediaQueue.current = operation.catch(() => undefined);
    return operation;
  };
  const addPhotos = async () => {
    if (images.length >= 5) return;
    let result: ImagePicker.ImagePickerResult;
    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return;
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        selectionLimit: 5 - images.length,
        quality: 1,
      });
    } catch (error) {
      if (__DEV__)
        console.info("[ProductMediaPicker]", {
          operation: "picker_failed",
          platform: Platform.OS,
          code:
            error && typeof error === "object" && "code" in error
              ? String(error.code)
              : null,
          domain:
            error && typeof error === "object" && "domain" in error
              ? String(error.domain)
              : null,
        });
      Alert.alert(
        "No pudimos abrir esta foto",
        "Intenta descargarla completamente en Fotos o selecciona otra.",
      );
      return;
    }
    if (result.canceled) return;
    const selected = result.assets.slice(0, 5 - imagesRef.current.length);
    const localItems: ProductEditorMedia[] = selected.map((asset, offset) => {
      const clientKey = randomUUID();
      return {
        clientKey,
        assetId: clientKey,
        url: asset.uri,
        kind: "image",
        mimeType: asset.mimeType ?? "image/jpeg",
        fileName: asset.fileName ?? undefined,
        sizeBytes: asset.fileSize,
        durationMs: null,
        position: imagesRef.current.length + offset,
        isCover: imagesRef.current.length === 0 && offset === 0,
        state: "uploading",
      };
    });
    updateImages([...imagesRef.current, ...localItems]);
    for (let index = 0; index < localItems.length; index += 1) {
      const local = localItems[index],
        asset = selected[index];
      try {
        const uploaded = await uploadMediaFromUri({
          uri: asset.uri,
          purpose: "product_image",
          mimeType: asset.mimeType ?? "image/jpeg",
          fileName: asset.fileName ?? undefined,
          sizeBytes: asset.fileSize,
          visibility: "public",
        });
        const ready: ProductEditorMedia = {
          ...local,
          assetId: uploaded.assetId,
          url: uploaded.url!,
          state: "ready" as const,
        };
        const next = replaceEditorMedia(
          imagesRef.current,
          local.clientKey,
          ready,
        );
        updateImages(next);
        await queueMediaPersistence(next, persistedVideoRef.current);
      } catch (error) {
        const safe = getSafeMediaError(error);
        if (__DEV__)
          console.info("[ProductMediaPicker]", {
            operation: "upload_failed",
            platform: Platform.OS,
            stage: safe.stage,
            code: safe.code,
            attempts: safe.attempts,
          });
        updateImages(
          imagesRef.current.map((item) =>
            item.clientKey === local.clientKey
              ? { ...item, state: "failed" }
              : item,
          ),
        );
        if (
          safe.stage === "MEDIA_NORMALIZE_IMAGE" ||
          safe.code.includes("file")
        )
          Alert.alert(
            "No pudimos leer este archivo desde Fotos",
            "Descárgalo completamente o selecciona otra foto.",
          );
      }
    }
  };
  const addVideo = async () => {
    if (pendingVideoRef.current?.state === "uploading") return;
    let result: ImagePicker.ImagePickerResult;
    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) return;
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["videos"],
        allowsEditing: false,
      });
    } catch (error) {
      if (__DEV__)
        console.info("[ProductMediaPicker]", {
          operation: "picker_failed",
          platform: Platform.OS,
          code:
            error && typeof error === "object" && "code" in error
              ? String(error.code)
              : null,
          domain:
            error && typeof error === "object" && "domain" in error
              ? String(error.domain)
              : null,
        });
      Alert.alert(
        "No pudimos abrir este video",
        "Intenta descargarlo completamente en Fotos o selecciona otro.",
      );
      return;
    }
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
    const clientKey = randomUUID();
    const local: ProductEditorMedia = {
      clientKey,
      assetId: clientKey,
      url: asset.uri,
      kind: "video",
      mimeType: mime,
      fileName: asset.fileName ?? undefined,
      sizeBytes: asset.fileSize,
      durationMs: duration,
      position: 0,
      isCover: false,
      state: "uploading",
      pendingReplacement: Boolean(persistedVideoRef.current),
    };
    updatePendingVideo(local);
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
      const ready: ProductEditorMedia = {
        ...local,
        assetId: uploaded.assetId,
        url: uploaded.url!,
        state: "ready",
        pendingReplacement: false,
      };
      await queueMediaPersistence(imagesRef.current, ready);
      updatePersistedVideo(ready);
      updatePendingVideo(null);
    } catch (error) {
      const safe = getSafeMediaError(error);
      if (__DEV__)
        console.info("[ProductMediaPicker]", {
          operation: "upload_failed",
          platform: Platform.OS,
          stage: safe.stage,
          code: safe.code,
          attempts: safe.attempts,
        });
      updatePendingVideo({ ...local, state: "failed" });
    }
  };
  const retryMedia = async (item: ProductEditorMedia) => {
    try {
      if (item.kind === "video")
        updatePendingVideo({ ...item, state: "uploading" });
      else
        updateImages(
          imagesRef.current.map((x) =>
            x.clientKey === item.clientKey ? { ...x, state: "uploading" } : x,
          ),
        );
      const uploaded = await uploadMediaFromUri({
        uri: item.url,
        purpose: item.kind === "video" ? "product_video" : "product_image",
        mimeType:
          item.mimeType ?? (item.kind === "video" ? "video/mp4" : "image/jpeg"),
        fileName: item.fileName,
        sizeBytes: item.sizeBytes,
        durationMs: item.durationMs ?? undefined,
        visibility: "public",
        timeoutMs: item.kind === "video" ? 300000 : 120000,
      });
      const ready = {
        ...item,
        assetId: uploaded.assetId,
        url: uploaded.url!,
        state: "ready" as const,
        pendingReplacement: false,
      };
      if (item.kind === "video") {
        await queueMediaPersistence(imagesRef.current, ready);
        updatePersistedVideo(ready);
        updatePendingVideo(null);
      } else {
        const next = replaceEditorMedia(
          imagesRef.current,
          item.clientKey,
          ready,
        );
        updateImages(next);
        await queueMediaPersistence(next, persistedVideoRef.current);
      }
    } catch (error) {
      const safe = getSafeMediaError(error);
      if (__DEV__)
        console.info("[ProductMediaPicker]", {
          operation: "retry_failed",
          platform: Platform.OS,
          stage: safe.stage,
          code: safe.code,
          attempts: safe.attempts,
        });
      if (item.kind === "video")
        updatePendingVideo({ ...item, state: "failed" });
      else
        updateImages(
          imagesRef.current.map((x) =>
            x.clientKey === item.clientKey ? { ...x, state: "failed" } : x,
          ),
        );
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
    const positioned = next.map((x, i) => ({ ...x, position: i }));
    updateImages(positioned);
    void queueMediaPersistence(positioned, persistedVideoRef.current);
  };
  const removeImage = (clientKey: string) => {
    const remaining = images
      .filter((x) => x.clientKey !== clientKey)
      .map((x, i) => ({ ...x, position: i }));
    if (remaining.length && !remaining.some((x) => x.isCover))
      remaining[0] = { ...remaining[0], isCover: true };
    updateImages(remaining);
    void queueMediaPersistence(remaining, persistedVideoRef.current);
  };
  const removeOfficialVideo = async () => {
    await queueMediaPersistence(imagesRef.current, null);
    updatePersistedVideo(null);
  };
  const leaveEditor = useCallback(async () => {
    if (!dirty || (await flushDraftSave(true))) {
      router.back();
      return;
    }
    Alert.alert(
      "No pudimos guardar los ultimos cambios.",
      "El borrador guardado anteriormente permanece seguro.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Salir de todos modos",
          style: "destructive",
          onPress: () => router.back(),
        },
        { text: "Reintentar", onPress: () => void leaveEditor() },
      ],
    );
  }, [dirty, flushDraftSave, router]);
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          void leaveEditor();
          return true;
        },
      );
      if (productId)
        void fetchSellerProductVariants(productId)
          .then((value) =>
            setVariantsReady(deriveMarketplaceVariantsReady(value)),
          )
          .catch(() => setVariantsReady(false));
      return () => subscription.remove();
    }, [leaveEditor, productId]),
  );
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
      if (!(await flushDraftSave(true))) throw new Error("draft_save_failed");
      await saveQueue.current.wait();
      await mediaQueue.current;
      if (images.some((x) => x.state !== "ready") || !images.length)
        throw new Error("media");
      const inventory = await fetchSellerProductVariants(productId),
        configurableVariants = inventory.detail.variants.filter(
          (x) => x.status !== "archived",
        ),
        defaultVariant = configurableVariants.find((x) => x.is_default);
      setVariantsReady(deriveMarketplaceVariantsReady(inventory));
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
          <Pressable onPress={() => void leaveEditor()}>
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
          <Pressable disabled={saving} onPress={() => void flushDraftSave()}>
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
              onChange={(value) => {
                setTitleConfigured(true);
                change(setTitle)(value);
              }}
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
                    setCategoryConfigured(true);
                    saveQueue.current.edit();
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
                  key={item.clientKey}
                  item={item}
                  onCover={() => {
                    const next = imagesRef.current.map((x) => ({
                      ...x,
                      isCover: x.clientKey === item.clientKey,
                    }));
                    updateImages(next);
                    void queueMediaPersistence(next, persistedVideoRef.current);
                  }}
                  onRemove={() => removeImage(item.clientKey)}
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
            {persistedVideo ? (
              <>
                <Text style={styles.muted}>Video actual</Text>
                <ProductMediaTile
                  item={persistedVideo}
                  onRemove={() => void removeOfficialVideo()}
                />
              </>
            ) : null}
            {pendingVideo ? (
              <>
                <Text style={styles.muted}>Nuevo video</Text>
                <ProductMediaTile
                  item={pendingVideo}
                  onRetry={() => void retryMedia(pendingVideo)}
                  onRemove={() => updatePendingVideo(null)}
                  removeLabel="Cancelar reemplazo"
                />
              </>
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
                {persistedVideo ? "Cambiar video" : "Agregar video"}
              </Text>
            </Pressable>
          </EditorCard>
        ) : null}
        {step === 2 ? (
          <EditorCard title="Precio e inventario">
            <EditorField
              label="Precio"
              value={price}
              onChange={(value) => {
                setPriceConfigured(true);
                change(setPrice)(value);
              }}
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
            {variantSummary.options === 0 ? (
              <>
                <Text style={styles.body}>Este producto no tiene opciones.</Text>
                <Text style={styles.muted}>Precio: {price} BDAG · Stock: {stock}</Text>
              </>
            ) : (
              <Text style={styles.body}>{variantSummary.options} opciones · {variantSummary.variants} combinaciones</Text>
            )}
            <Text style={variantsReady ? styles.videoReady : styles.warning}>
              {variantsReady ? "✓ Variantes listas" : "⚠ Completa precios y stock"}
            </Text>
            {productId ? (
              <Pressable
                style={styles.secondary}
                onPress={() =>
                  router.push(`/seller/product/${productId}/variants`)
                }
              >
                <Text style={styles.secondaryText}>{variantSummary.options ? "Administrar variantes" : "Agregar color, talla u otra opción"}</Text>
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
                      saveQueue.current.edit();
                      setDirty(true);
                      setMessage("Envío configurado");
                      if (__DEV__)
                        console.info("[MarketplaceProductEditor]", {
                          operation: "shipping_profile_selected",
                          profileIdPresent: true,
                        });
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
                      params: {
                        storeId,
                        profileId: shippingProfileId ?? "",
                        productId: productId ?? "new",
                      },
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
            {persistedVideo ? (
              <Text style={styles.videoReady}>
                Video listo ·{" "}
                {Math.ceil((persistedVideo.durationMs ?? 0) / 1000)}s
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
