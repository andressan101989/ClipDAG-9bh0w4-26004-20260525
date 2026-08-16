import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type ViewToken,
} from "react-native";
import { Image } from "expo-image";
import { MaterialCommunityIcons, MaterialIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/hooks/useAuth";
import { useMarketplaceCart } from "@/hooks/useMarketplaceCart";
import { useShop } from "@/hooks/useShop";
import { useWallet } from "@/hooks/useWallet";
import {
  fetchCategories,
  fetchProducts,
  MarketplaceReadError,
  PRODUCT_CATEGORIES,
  type MarketplaceCategory,
  type MarketplaceCategoryRecord,
  type Product,
} from "@/services/marketplaceService";
import { fetchMarketplaceProductReputation } from "@/services/marketplaceReviewService";
import {
  fetchSponsoredProducts,
  recordAdEvent,
  type SponsoredProduct,
} from "@/services/marketplaceAdsService";
import {
  MARKETPLACE_AD_VISIBLE_MS,
  MARKETPLACE_AD_VISIBLE_RATIO,
} from "@/services/marketplaceAdVisibility";
import {
  marketplaceSponsoredProductRoute,
  mixMarketplaceSponsoredProducts,
  type MarketplaceSponsoredMixItem,
} from "@/services/marketplaceSponsoredMix";
import { Colors, FontWeight, Spacing } from "@/constants/theme";

type MarketLoadError = "network" | "permission" | "request" | null;
type ProductRating = { averageRating: number; reviewCount: number };
type MarketplaceGridEntry = MarketplaceSponsoredMixItem<
  Product,
  SponsoredProduct
>;
type GridEntry = MarketplaceGridEntry | { kind: "skeleton"; id: string };

const MARKETPLACE_PAGE_LIMIT = 30;
const SKELETONS: GridEntry[] = Array.from({ length: 6 }, (_, index) => ({
  kind: "skeleton",
  id: `shop-skeleton-${index}`,
}));

const fmt = (value: number, decimals = 0) =>
  value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

const fmtShort = (value: number) => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
};

const categoryFallbackLabel = (category: MarketplaceCategory) =>
  PRODUCT_CATEGORIES.find((item) => item.key === category)?.label ?? category;

const ProductMediaFallback = () => (
  <View
    style={styles.productImageFallback}
    accessibilityLabel="Imagen no disponible"
  >
    <View style={styles.productImageFallbackIcon}>
      <MaterialIcons
        name="image-not-supported"
        size={27}
        color={Colors.textSubtle}
      />
    </View>
    <Text style={styles.productImageFallbackText}>Imagen no disponible</Text>
  </View>
);

const FavoriteButton = ({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: (event: GestureResponderEvent) => void;
}) => (
  <Pressable
    style={styles.favoriteButton}
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={`${active ? "Quitar" : "Guardar"} ${label}`}
    accessibilityState={{ selected: active }}
    hitSlop={6}
  >
    <MaterialCommunityIcons
      name={active ? "heart" : "heart-outline"}
      size={21}
      color={active ? Colors.secondaryLight : "#FFFFFF"}
    />
  </Pressable>
);

const Rating = ({ value }: { value?: ProductRating }) =>
  value ? (
    <View
      style={styles.ratingRow}
      accessibilityLabel={`${value.averageRating.toFixed(1)}, ${value.reviewCount} reseñas verificadas`}
    >
      <MaterialIcons name="star" size={12} color="#FFB21A" />
      <Text style={styles.ratingText}>{value.averageRating.toFixed(1)}</Text>
      <Text style={styles.ratingCount}>({value.reviewCount})</Text>
    </View>
  ) : null;

const ProductCard = memo(function ProductCard({
  product,
  width,
  rating,
  canSave,
  saved,
  onToggleSave,
  onPress,
}: {
  product: Product;
  width: number;
  rating?: ProductRating;
  canSave: boolean;
  saved: boolean;
  onToggleSave: () => void;
  onPress: () => void;
}) {
  const image = product.images?.[0] ?? null;
  const soldOut = product.stock === 0;
  const hasCanonicalOffer =
    product.compare_at_price != null &&
    product.compare_at_price > product.price;
  return (
    <Pressable
      style={[styles.productCard, { width }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${product.title}, ${fmt(product.price, 2)} BDAG`}
    >
      <View style={styles.productMedia}>
        {image ? (
          <Image
            source={{ uri: image }}
            style={styles.productImage}
            contentFit="cover"
            transition={180}
          />
        ) : (
          <ProductMediaFallback />
        )}
        <View
          style={hasCanonicalOffer ? styles.offerBadge : styles.categoryBadge}
        >
          <Text
            style={
              hasCanonicalOffer
                ? styles.offerBadgeText
                : styles.categoryBadgeText
            }
          >
            {hasCanonicalOffer
              ? "Oferta"
              : categoryFallbackLabel(product.category)}
          </Text>
        </View>
        {canSave ? (
          <FavoriteButton
            active={saved}
            label={product.title}
            onPress={(event) => {
              event.stopPropagation();
              onToggleSave();
            }}
          />
        ) : null}
        {soldOut ? (
          <View style={styles.soldOutOverlay} pointerEvents="none">
            <Text style={styles.soldOutOverlayText}>Agotado</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.productBody}>
        <Text style={styles.productTitle} numberOfLines={2}>
          {product.title}
        </Text>
        {product.seller ? (
          <Text style={styles.storeName} numberOfLines={1}>
            @{product.seller.username}
          </Text>
        ) : (
          <View style={styles.storeNamePlaceholder} />
        )}
        <View style={styles.productBottomRow}>
          <Text
            style={styles.productPrice}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.72}
          >
            {product.variant_price_max != null &&
            product.variant_price_max > product.price
              ? "Desde "
              : ""}
            {fmt(product.price, 2)} BDAG
          </Text>
          <Rating value={rating} />
        </View>
      </View>
    </Pressable>
  );
});

const SponsoredCard = memo(function SponsoredCard({
  item,
  width,
  rating,
  canSave,
  saved,
  isVisible,
  position,
  onToggleSave,
  onPress,
}: {
  item: SponsoredProduct;
  width: number;
  rating?: ProductRating;
  canSave: boolean;
  saved: boolean;
  isVisible: boolean;
  position: number;
  onToggleSave: () => void;
  onPress: () => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sent = useRef(false);
  useEffect(() => {
    if (!sent.current && isVisible && !timer.current) {
      timer.current = setTimeout(() => {
        sent.current = true;
        timer.current = null;
        void recordAdEvent({
          campaignId: item.campaign_id,
          productId: item.product_id,
          eventType: "impression",
          surface: "marketplace_home",
          metadata: { position },
        }).catch(() => {});
      }, MARKETPLACE_AD_VISIBLE_MS);
    } else if (!isVisible && timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [isVisible, item.campaign_id, item.product_id, position]);

  const image = item.images?.[0] ?? null;
  return (
    <Pressable
      style={[styles.productCard, styles.sponsoredCard, { width }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Patrocinado, ${item.title}, ${Number(item.price).toFixed(2)} BDAG`}
    >
      <View style={styles.productMedia}>
        {image ? (
          <Image
            source={{ uri: image }}
            style={styles.productImage}
            contentFit="cover"
            transition={180}
          />
        ) : (
          <ProductMediaFallback />
        )}
        <View style={styles.sponsoredBadge}>
          <MaterialIcons name="campaign" size={11} color="#251A04" />
          <Text style={styles.sponsoredBadgeText}>Patrocinado</Text>
        </View>
        {canSave ? (
          <FavoriteButton
            active={saved}
            label={item.title}
            onPress={(event) => {
              event.stopPropagation();
              onToggleSave();
            }}
          />
        ) : null}
      </View>
      <View style={styles.productBody}>
        <Text style={styles.productTitle} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={styles.storeName} numberOfLines={1}>
          @{item.seller.username}
        </Text>
        <View style={styles.productBottomRow}>
          <Text
            style={styles.productPrice}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.72}
          >
            {Number(item.price).toFixed(2)} BDAG
          </Text>
          <Rating value={rating} />
        </View>
      </View>
    </Pressable>
  );
});

const ProductSkeleton = memo(function ProductSkeleton({
  width,
}: {
  width: number;
}) {
  return (
    <View
      style={[styles.productCard, styles.skeletonCard, { width }]}
      accessibilityLabel="Cargando producto"
    >
      <View style={[styles.productMedia, styles.skeletonMedia]} />
      <View style={styles.productBody}>
        <View style={[styles.skeletonLine, styles.skeletonTitle]} />
        <View style={[styles.skeletonLine, styles.skeletonStore]} />
        <View style={[styles.skeletonLine, styles.skeletonPrice]} />
      </View>
    </View>
  );
});

function FeaturedHero({
  item,
  itemCount,
  selectedIndex,
  isVisible,
  onSelect,
  onExplore,
  onOpenProduct,
}: {
  item?: SponsoredProduct;
  itemCount: number;
  selectedIndex: number;
  isVisible: boolean;
  onSelect: (index: number) => void;
  onExplore: () => void;
  onOpenProduct: (item: SponsoredProduct, position: number) => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentCampaigns = useRef(new Set<string>());
  useEffect(() => {
    if (!item || sentCampaigns.current.has(item.campaign_id)) return;
    if (isVisible && !timer.current) {
      timer.current = setTimeout(() => {
        sentCampaigns.current.add(item.campaign_id);
        timer.current = null;
        void recordAdEvent({
          campaignId: item.campaign_id,
          productId: item.product_id,
          eventType: "impression",
          surface: "marketplace_home",
          metadata: { position: selectedIndex, placement: "featured_hero" },
        }).catch(() => {});
      }, MARKETPLACE_AD_VISIBLE_MS);
    }
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [isVisible, item, selectedIndex]);

  return (
    <LinearGradient
      colors={["#092A57", "#16245A", "#251238"]}
      start={{ x: 0, y: 0.4 }}
      end={{ x: 1, y: 0.6 }}
      style={styles.shopHero}
    >
      <View style={styles.heroCopy}>
        <View style={styles.heroBadge}>
          <Text style={styles.heroBadgeText}>
            {item ? "PATROCINADO" : "DESCUBRIR"}
          </Text>
        </View>
        <Text style={styles.heroTitle} numberOfLines={2}>
          {item?.title ?? "Descubre nuevos productos"}
        </Text>
        <Text style={styles.heroBody} numberOfLines={2}>
          {item
            ? `Por @${item.seller.username}`
            : "Explora productos físicos y digitales en OnSpace."}
        </Text>
        <Pressable
          style={styles.heroButton}
          onPress={() =>
            item ? onOpenProduct(item, selectedIndex) : onExplore()
          }
          accessibilityRole="button"
          accessibilityLabel={item ? `Ver ${item.title}` : "Explorar productos"}
        >
          <Text style={styles.heroButtonText}>
            {item ? "Ver producto" : "Explorar"}
          </Text>
          <MaterialIcons name="arrow-forward" size={14} color="#FFFFFF" />
        </Pressable>
      </View>
      <View style={styles.heroArt} pointerEvents="none">
        <View style={styles.heroHandle} />
        <MaterialCommunityIcons
          name="shopping-outline"
          size={50}
          color="#58C0FF"
        />
      </View>
      {itemCount > 1 ? (
        <View style={styles.heroDots}>
          {Array.from({ length: itemCount }, (_, index) => (
            <Pressable
              key={`hero-dot-${index}`}
              style={[
                styles.heroDot,
                index === selectedIndex && styles.heroDotSelected,
              ]}
              onPress={() => onSelect(index)}
              accessibilityRole="button"
              accessibilityLabel={`Destacado ${index + 1} de ${itemCount}`}
              accessibilityState={{ selected: index === selectedIndex }}
            />
          ))}
        </View>
      ) : null}
    </LinearGradient>
  );
}

export default function ShopScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const listRef = useRef<FlatList<GridEntry>>(null);
  const { width: viewportWidth } = useWindowDimensions();
  const { user } = useAuth();
  const walletData = useWallet();
  const balance = walletData?.balance ?? 0;
  const { totalQuantity } = useMarketplaceCart();
  const { toggleSaveProduct, isSavedProduct } = useShop();
  const [products, setProducts] = useState<Product[]>([]);
  const [categoryRecords, setCategoryRecords] = useState<
    MarketplaceCategoryRecord[]
  >([]);
  const [category, setCategory] = useState<MarketplaceCategory | "">("");
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<MarketLoadError>(null);
  const [sponsored, setSponsored] = useState<SponsoredProduct[]>([]);
  const [heroIndex, setHeroIndex] = useState(0);
  const [scrollY, setScrollY] = useState(0);
  const [ratings, setRatings] = useState<Record<string, ProductRating>>({});
  const [visibleSponsored, setVisibleSponsored] = useState<Set<string>>(
    new Set(),
  );
  const reputationAttempted = useRef(new Set<string>());
  const cardWidth = Math.max(
    136,
    (viewportWidth - Spacing.md * 2 - Spacing.sm) / 2,
  );

  const categoryOptions = useMemo(
    () => [
      { key: "" as const, label: "Todo" },
      ...categoryRecords.map((record) => ({
        key: record.slug,
        label: record.name,
      })),
    ],
    [categoryRecords],
  );

  const loadCategories = useCallback(async () => {
    try {
      const next = await fetchCategories();
      setCategoryRecords(next);
      setCategory((current) =>
        current && !next.some((record) => record.slug === current)
          ? ""
          : current,
      );
    } catch {
      setCategoryRecords([]);
      setCategory("");
    }
  }, []);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const [catalog, ads] = await Promise.all([
        fetchProducts({
          category: category || undefined,
          search: searchQuery || undefined,
          limit: MARKETPLACE_PAGE_LIMIT,
        }),
        searchQuery
          ? Promise.resolve([])
          : fetchSponsoredProducts(
              "marketplace_home",
              category || undefined,
            ).catch(() => []),
      ]);
      setProducts(catalog.filter((product) => product.seller_id !== user?.id));
      setSponsored(ads);
      setHeroIndex(0);
      setError(null);
    } catch (error) {
      const nextError: Exclude<MarketLoadError, null> =
        error instanceof MarketplaceReadError &&
        error.code === "marketplace_read_transport"
          ? "network"
          : error instanceof MarketplaceReadError &&
              error.code === "marketplace_read_permission"
            ? "permission"
            : "request";
      setError(nextError);
      if (__DEV__)
        console.warn("[MarketplaceScreen]", {
          operation: "loadProducts",
          category: nextError,
          postgresCode:
            error instanceof MarketplaceReadError ? error.postgresCode : null,
        });
    } finally {
      setLoading(false);
    }
  }, [category, searchQuery, user?.id]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadProducts(), loadCategories()]);
    } finally {
      setRefreshing(false);
    }
  }, [loadCategories, loadProducts]);

  const loadRatingsForIds = useCallback((ids: string[]) => {
    const pending = [...new Set(ids)].filter((id) => {
      if (reputationAttempted.current.has(id)) return false;
      reputationAttempted.current.add(id);
      return true;
    });
    if (pending.length === 0) return;
    void Promise.allSettled(
      pending.map(async (id) => ({
        id,
        reputation: await fetchMarketplaceProductReputation(id),
      })),
    ).then((results) => {
      const verified: Record<string, ProductRating> = {};
      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        const aggregate = result.value.reputation.productAggregate;
        if (aggregate.reviewCount > 0 && aggregate.averageRating !== null) {
          verified[result.value.id] = {
            averageRating: aggregate.averageRating,
            reviewCount: aggregate.reviewCount,
          };
        }
      }
      if (Object.keys(verified).length > 0)
        setRatings((current) => ({ ...current, ...verified }));
    });
  }, []);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken<GridEntry>[] }) => {
      const productIds: string[] = [];
      const campaigns = new Set<string>();
      for (const token of viewableItems) {
        const item = token.item;
        if (!item || item.kind === "skeleton") continue;
        if (item.kind === "organic") productIds.push(item.product.id);
        else {
          productIds.push(item.product.product_id);
          campaigns.add(item.product.campaign_id);
        }
      }
      loadRatingsForIds(productIds);
      setVisibleSponsored(campaigns);
    },
  ).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: MARKETPLACE_AD_VISIBLE_RATIO * 100,
  }).current;

  const mixedProducts = useMemo(
    () => mixMarketplaceSponsoredProducts(products, sponsored),
    [products, sponsored],
  );
  const isCatalogEmpty = mixedProducts.length === 0;
  const data: GridEntry[] =
    error ? [] : loading && isCatalogEmpty ? SKELETONS : mixedProducts;
  const featured = sponsored[heroIndex];
  const hasActiveFilter = Boolean(searchQuery || category);
  const catalogTitle = searchQuery
    ? "Resultados"
    : category
      ? (categoryOptions.find((item) => item.key === category)?.label ??
        categoryFallbackLabel(category))
      : "Productos para ti";

  const openSponsored = useCallback(
    (item: SponsoredProduct, position: number) => {
      void recordAdEvent({
        campaignId: item.campaign_id,
        productId: item.product_id,
        eventType: "click",
        surface: "marketplace_home",
        metadata: { position },
      }).catch(() => {});
      router.push({
        pathname: "/product/[id]",
        params: marketplaceSponsoredProductRoute(item),
      });
    },
    [router],
  );

  const clearFilters = useCallback(() => {
    setSearch("");
    setSearchQuery("");
    setCategory("");
  }, []);

  const errorMessage =
    error === "network"
      ? "No pudimos conectar con la tienda. Revisa tu conexión."
      : error === "permission"
        ? "La tienda necesita una actualización de acceso. Inténtalo nuevamente."
        : "No pudimos cargar los productos.";

  const header = (
    <View style={styles.headerStack}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.headerEyebrow}>O N S P A C E</Text>
          <Text style={styles.headerTitle}>Tienda</Text>
          <Text style={styles.headerSub}>
            Compra productos físicos y digitales
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            style={styles.walletPill}
            onPress={() => router.push("/(tabs)/wallet")}
            accessibilityRole="button"
            accessibilityLabel={`Saldo, ${fmt(balance)} BDAG`}
          >
            <MaterialCommunityIcons
              name="hexagon-multiple"
              size={13}
              color="#FFB21A"
            />
            <Text style={styles.walletText} numberOfLines={1}>
              {balance >= 1000 ? fmtShort(balance) : fmt(balance)} BDAG
            </Text>
          </Pressable>
          <Pressable
            style={styles.iconButton}
            onPress={() => router.push("/cart" as never)}
            accessibilityRole="button"
            accessibilityLabel={`Carrito, ${totalQuantity} productos`}
          >
            <MaterialIcons
              name="shopping-cart"
              size={22}
              color={Colors.textPrimary}
            />
            {totalQuantity > 0 ? (
              <View style={styles.cartBadge}>
                <Text style={styles.cartBadgeText}>
                  {totalQuantity > 99 ? "99+" : totalQuantity}
                </Text>
              </View>
            ) : null}
          </Pressable>
        </View>
      </View>

      <View style={styles.searchBar}>
        <MaterialIcons name="search" size={22} color="#A9ADBD" />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Buscar productos"
          placeholderTextColor="#777C91"
          returnKeyType="search"
          accessibilityLabel="Buscar productos en la tienda"
        />
        {search ? (
          <Pressable
            style={styles.clearSearch}
            onPress={() => setSearch("")}
            accessibilityRole="button"
            accessibilityLabel="Limpiar búsqueda"
          >
            <MaterialIcons
              name="close"
              size={19}
              color={Colors.textSecondary}
            />
          </Pressable>
        ) : (
          <MaterialIcons name="tune" size={19} color="#A9ADBD" />
        )}
      </View>

      <FeaturedHero
        item={featured}
        itemCount={sponsored.length}
        selectedIndex={heroIndex}
        isVisible={scrollY < 300}
        onSelect={setHeroIndex}
        onExplore={() =>
          listRef.current?.scrollToOffset({ offset: 395, animated: true })
        }
        onOpenProduct={openSponsored}
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categories}
      >
        {categoryOptions.map((item) => {
          const selected = category === item.key;
          return (
            <Pressable
              key={item.key || "all"}
              style={[
                styles.categoryChip,
                selected && styles.categoryChipSelected,
              ]}
              onPress={() => setCategory(item.key)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`Categoría ${item.label}`}
            >
              <Text
                style={[
                  styles.categoryChipText,
                  selected && styles.categoryChipTextSelected,
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.filterRail}>
        <View style={styles.filterStatus}>
          <MaterialIcons
            name="filter-list"
            size={14}
            color={Colors.textSecondary}
          />
          <Text style={styles.filterStatusText}>
            {category ? "Categoría activa" : "Todas las categorías"}
          </Text>
        </View>
        {hasActiveFilter ? (
          <Pressable
            style={styles.clearFiltersButton}
            onPress={clearFilters}
            accessibilityRole="button"
            accessibilityLabel="Limpiar filtros"
          >
            <Text style={styles.clearFiltersText}>Limpiar</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.catalogHeader}>
        <View style={styles.catalogCopy}>
          <Text style={styles.catalogTitle}>{catalogTitle}</Text>
          <Text style={styles.catalogMeta}>
            {loading ? "Actualizando…" : `${products.length} productos`}
          </Text>
        </View>
        <Pressable
          style={styles.sellButton}
          onPress={() => router.push("/seller" as never)}
          accessibilityRole="button"
          accessibilityLabel="Ir al centro de vendedores"
        >
          <MaterialCommunityIcons
            name="store-plus-outline"
            size={16}
            color="#39AFFF"
          />
          <Text style={styles.sellButtonText}>Vender</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <FlatList
        ref={listRef}
        data={data}
        numColumns={2}
        keyExtractor={(item) =>
          item.kind === "skeleton"
            ? item.id
            : item.kind === "organic"
              ? item.product.id
              : `ad:${item.product.campaign_id}`
        }
        renderItem={({ item }) => {
          if (item.kind === "skeleton")
            return <ProductSkeleton width={cardWidth} />;
          if (item.kind === "organic") {
            const p = item.product;
            return (
              <ProductCard
                product={p}
                width={cardWidth}
                rating={ratings[p.id]}
                canSave={Boolean(user)}
                saved={isSavedProduct(p.id)}
                onToggleSave={() => toggleSaveProduct(p.id)}
                onPress={() =>
                  router.push({
                    pathname: "/product/[id]",
                    params: { id: p.id, source: "shop" },
                  })
                }
              />
            );
          }
          const ad = item.product;
          return (
            <SponsoredCard
              item={ad}
              width={cardWidth}
              rating={ratings[ad.product_id]}
              canSave={Boolean(user)}
              saved={isSavedProduct(ad.product_id)}
              isVisible={visibleSponsored.has(ad.campaign_id)}
              position={item.position}
              onToggleSave={() => toggleSaveProduct(ad.product_id)}
              onPress={() => openSponsored(ad, item.position)}
            />
          );
        }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          error ? (
            <View style={styles.stateCard}>
              <MaterialCommunityIcons
                name="store-alert-outline"
                size={30}
                color={Colors.secondary}
              />
              <View style={styles.stateCopy}>
                <Text style={styles.stateTitle}>
                  La tienda no está disponible
                </Text>
                <Text style={styles.stateBody}>{errorMessage}</Text>
              </View>
              <Pressable
                style={styles.retryButton}
                onPress={() => void loadProducts()}
                accessibilityRole="button"
              >
                <Text style={styles.retryText}>Reintentar</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.stateCard}>
              <MaterialCommunityIcons
                name="shopping-search"
                size={30}
                color={Colors.borderHighlight}
              />
              <View style={styles.stateCopy}>
                <Text style={styles.stateTitle}>
                  {searchQuery ? "Sin resultados" : "No hay productos aquí"}
                </Text>
                <Text style={styles.stateBody}>
                  {searchQuery
                    ? "Prueba otra búsqueda o categoría."
                    : "Explora otra categoría o vuelve pronto."}
                </Text>
              </View>
              {hasActiveFilter ? (
                <Pressable
                  style={styles.retryButton}
                  onPress={clearFilters}
                  accessibilityRole="button"
                >
                  <Text style={styles.retryText}>Ver todo</Text>
                </Pressable>
              ) : null}
            </View>
          )
        }
        ListFooterComponent={
          loading && products.length > 0 ? (
            <View style={styles.loadingFooter} />
          ) : null
        }
        columnWrapperStyle={styles.productRow}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: 92 + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onScroll={(event) => setScrollY(event.nativeEvent.contentOffset.y)}
        scrollEventThrottle={100}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        initialNumToRender={6}
        maxToRenderPerBatch={8}
        windowSize={7}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={Colors.primary}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#07080C" },
  listContent: { paddingHorizontal: Spacing.md },
  headerStack: { paddingTop: 10, paddingBottom: 12, gap: 14 },
  header: {
    minHeight: 82,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerCopy: { flex: 1, minWidth: 0, paddingRight: 8 },
  headerEyebrow: {
    color: "#38A9FF",
    fontSize: 9,
    lineHeight: 13,
    fontWeight: FontWeight.extrabold,
    letterSpacing: 2.2,
  },
  headerTitle: {
    color: "#F8F8FB",
    fontSize: 36,
    lineHeight: 41,
    fontWeight: FontWeight.extrabold,
    letterSpacing: -1.1,
  },
  headerSub: { color: "#9A9EAF", fontSize: 11, lineHeight: 15 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  walletPill: {
    height: 42,
    maxWidth: 94,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    borderRadius: 15,
    backgroundColor: "#2A1D05",
    borderWidth: 1,
    borderColor: "#7A520A",
  },
  walletText: {
    flexShrink: 1,
    color: "#FFB21A",
    fontSize: 10,
    fontWeight: FontWeight.bold,
    fontVariant: ["tabular-nums"],
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#11131A",
    borderWidth: 1,
    borderColor: "#303442",
  },
  cartBadge: {
    position: "absolute",
    right: -4,
    top: -5,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 3,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.secondary,
  },
  cartBadgeText: { color: "#FFFFFF", fontSize: 9, fontWeight: FontWeight.bold },
  searchBar: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 13,
    borderRadius: 16,
    backgroundColor: "#11131A",
    borderWidth: 1,
    borderColor: "#2B2E3A",
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    color: Colors.textPrimary,
    fontSize: 12,
  },
  clearSearch: {
    width: 32,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  shopHero: {
    height: 142,
    position: "relative",
    flexDirection: "row",
    overflow: "hidden",
    padding: 13,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#194D9F",
  },
  heroCopy: { flex: 1, minWidth: 0, alignItems: "flex-start", zIndex: 2 },
  heroBadge: {
    minHeight: 22,
    justifyContent: "center",
    paddingHorizontal: 8,
    borderRadius: 9,
    backgroundColor: "#073B70",
  },
  heroBadgeText: { color: "#5CC1FF", fontSize: 8, fontWeight: FontWeight.bold },
  heroTitle: {
    maxWidth: "78%",
    marginTop: 6,
    color: "#FFFFFF",
    fontSize: 19,
    lineHeight: 23,
    fontWeight: FontWeight.bold,
  },
  heroBody: {
    maxWidth: "72%",
    marginTop: 2,
    color: "#C2C8DC",
    fontSize: 10,
    lineHeight: 14,
  },
  heroButton: {
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: "auto",
    paddingHorizontal: 11,
    borderRadius: 10,
    backgroundColor: "#6F39EE",
  },
  heroButtonText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: FontWeight.semibold,
  },
  heroArt: {
    position: "absolute",
    right: 19,
    top: 27,
    width: 106,
    height: 91,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#4168FF",
    backgroundColor: "#152E73",
    transform: [{ rotate: "7deg" }],
  },
  heroHandle: {
    position: "absolute",
    top: -11,
    width: 42,
    height: 22,
    borderRadius: 12,
    borderWidth: 4,
    borderColor: "#42B5FF",
  },
  heroDots: {
    position: "absolute",
    right: 22,
    bottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  heroDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#455071" },
  heroDotSelected: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#855FFF",
  },
  categories: { gap: 8, paddingRight: Spacing.md },
  categoryChip: {
    height: 38,
    justifyContent: "center",
    paddingHorizontal: 15,
    borderRadius: 13,
    backgroundColor: "#12141C",
    borderWidth: 1,
    borderColor: "#2B2E3A",
  },
  categoryChipSelected: { backgroundColor: "#724BFF", borderColor: "#855FFF" },
  categoryChipText: {
    color: "#B4B7C7",
    fontSize: 13,
    fontWeight: FontWeight.semibold,
  },
  categoryChipTextSelected: { color: "#FFFFFF", fontWeight: FontWeight.bold },
  filterRail: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  filterStatus: {
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    borderRadius: 11,
    backgroundColor: "#11131A",
    borderWidth: 1,
    borderColor: "#2B2E3A",
  },
  filterStatusText: {
    color: "#C2C5D1",
    fontSize: 11,
    fontWeight: FontWeight.medium,
  },
  clearFiltersButton: {
    height: 34,
    justifyContent: "center",
    paddingHorizontal: 11,
    borderRadius: 11,
    backgroundColor: Colors.primaryDim,
    borderWidth: 1,
    borderColor: Colors.primaryGlow,
  },
  clearFiltersText: {
    color: Colors.primaryLight,
    fontSize: 11,
    fontWeight: FontWeight.semibold,
  },
  catalogHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  catalogCopy: { flex: 1, minWidth: 0 },
  catalogTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    lineHeight: 24,
    fontWeight: FontWeight.bold,
  },
  catalogMeta: { color: Colors.textSubtle, fontSize: 10, marginTop: 1 },
  sellButton: {
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 13,
    borderRadius: 12,
    backgroundColor: "#071825",
    borderWidth: 1,
    borderColor: "#0C5488",
  },
  sellButtonText: {
    color: "#39AFFF",
    fontSize: 11,
    fontWeight: FontWeight.semibold,
  },
  productRow: { gap: Spacing.sm, paddingBottom: Spacing.sm },
  productCard: {
    overflow: "hidden",
    borderRadius: 16,
    backgroundColor: "#101219",
    borderWidth: 1,
    borderColor: "#262A36",
  },
  sponsoredCard: { borderColor: "rgba(255,178,26,.40)" },
  productMedia: {
    width: "100%",
    aspectRatio: 171 / 142,
    position: "relative",
    overflow: "hidden",
    backgroundColor: "#171A22",
  },
  productImage: { width: "100%", height: "100%" },
  productImageFallback: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#171A22",
  },
  productImageFallbackIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#222631",
    borderWidth: 1,
    borderColor: "#303543",
  },
  productImageFallbackText: {
    color: Colors.textSubtle,
    fontSize: 9,
    fontWeight: FontWeight.semibold,
  },
  categoryBadge: {
    position: "absolute",
    left: 7,
    top: 7,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: "rgba(7,8,12,.78)",
  },
  categoryBadgeText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: FontWeight.bold,
  },
  offerBadge: {
    position: "absolute",
    left: 7,
    top: 7,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: "#C62A4B",
  },
  offerBadgeText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: FontWeight.bold,
  },
  sponsoredBadge: {
    position: "absolute",
    left: 7,
    top: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: "#D69B20",
  },
  sponsoredBadgeText: {
    color: "#251A04",
    fontSize: 8,
    fontWeight: FontWeight.extrabold,
  },
  favoriteButton: {
    position: "absolute",
    right: 6,
    top: 5,
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
    backgroundColor: "rgba(7,8,12,.46)",
  },
  soldOutOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(7,7,15,.58)",
  },
  soldOutOverlayText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: FontWeight.extrabold,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  productBody: {
    minHeight: 94,
    paddingHorizontal: 9,
    paddingTop: 7,
    paddingBottom: 8,
  },
  productTitle: {
    minHeight: 32,
    color: "#FFFFFF",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: FontWeight.semibold,
  },
  storeName: { color: "#A6AABC", fontSize: 10, lineHeight: 14 },
  storeNamePlaceholder: { height: 14 },
  productBottomRow: {
    minHeight: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
    marginTop: 8,
  },
  productPrice: {
    flex: 1,
    minWidth: 0,
    color: "#FFB21A",
    fontSize: 12,
    fontWeight: FontWeight.bold,
    fontVariant: ["tabular-nums"],
  },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  ratingText: {
    color: "#FFB21A",
    fontSize: 10,
    fontWeight: FontWeight.semibold,
  },
  ratingCount: { color: Colors.textSubtle, fontSize: 8 },
  skeletonCard: { borderColor: "#20232E" },
  skeletonMedia: { backgroundColor: "#151821" },
  skeletonLine: { height: 10, borderRadius: 5, backgroundColor: "#20232E" },
  skeletonTitle: { width: "88%", marginTop: 2 },
  skeletonStore: { width: "54%", marginTop: 8 },
  skeletonPrice: { width: "42%", marginTop: 14 },
  stateCard: {
    minHeight: 118,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: Spacing.md,
    padding: 14,
    borderRadius: 14,
    backgroundColor: "#101219",
    borderWidth: 1,
    borderColor: "#262A36",
  },
  stateCopy: { flex: 1, minWidth: 0, gap: 3 },
  stateTitle: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontWeight: FontWeight.bold,
  },
  stateBody: { color: Colors.textSecondary, fontSize: 11, lineHeight: 16 },
  retryButton: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: Colors.primary,
  },
  retryText: { color: "#FFFFFF", fontSize: 10, fontWeight: FontWeight.bold },
  loadingFooter: { height: Spacing.md },
});
