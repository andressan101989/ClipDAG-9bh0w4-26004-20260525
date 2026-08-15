import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Image } from "expo-image";
import { MaterialCommunityIcons, MaterialIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/hooks/useAuth";
import { useMarketplaceCart } from "@/hooks/useMarketplaceCart";
import { useWallet } from "@/hooks/useWallet";
import {
  fetchProducts,
  MarketplaceReadError,
  PRODUCT_CATEGORIES,
  type MarketplaceCategory,
  type Product,
} from "@/services/marketplaceService";
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
} from "@/services/marketplaceSponsoredMix";
import { Colors, FontSize, FontWeight, Radius, Spacing } from "@/constants/theme";

type MarketLoadError = "network" | "permission" | "request" | null;

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

const categoryLabel = (category: MarketplaceCategory) =>
  PRODUCT_CATEGORIES.find((item) => item.key === category)?.label ?? category;

const ProductMediaFallback = () => (
  <View style={styles.productImageFallback} accessibilityLabel="Imagen no disponible">
    <View style={styles.productImageFallbackIcon}>
      <MaterialIcons name="image-not-supported" size={30} color={Colors.textSubtle} />
    </View>
    <Text style={styles.productImageFallbackText}>Imagen no disponible</Text>
  </View>
);

const ProductCard = memo(function ProductCard({
  product,
  width,
  onPress,
}: {
  product: Product;
  width: number;
  onPress: () => void;
}) {
  const image = product.images?.[0] ?? null;
  const soldOut = product.stock === 0;
  return (
    <Pressable
      style={[styles.productCard, { width }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${product.title}, ${fmt(product.price, 2)} BDAG`}
    >
      <View style={styles.productMedia}>
        {image ? (
          <Image source={{ uri: image }} style={styles.productImage} contentFit="cover" transition={180} />
        ) : (
          <ProductMediaFallback />
        )}
        <View style={styles.categoryBadge}>
          <Text style={styles.categoryBadgeText}>{categoryLabel(product.category)}</Text>
        </View>
        {soldOut ? (
          <View style={styles.soldOutOverlay}>
            <Text style={styles.soldOutOverlayText}>Agotado</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.productBody}>
        <Text style={styles.productTitle} numberOfLines={2}>{product.title}</Text>
        {product.seller ? (
          <View style={styles.storeRow}>
            <MaterialCommunityIcons name="storefront-outline" size={13} color={Colors.textSubtle} />
            <Text style={styles.storeName} numberOfLines={1}>@{product.seller.username}</Text>
          </View>
        ) : null}
        <Text style={styles.productPrice} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
          {product.variant_price_max != null && product.variant_price_max > product.price ? "Desde " : ""}
          {fmt(product.price, 2)} BDAG
        </Text>
        <Text style={styles.productSales}>{product.total_sales > 0 ? `${product.total_sales} vendidos` : "Nuevo en la tienda"}</Text>
      </View>
    </Pressable>
  );
});

const SponsoredCard = memo(function SponsoredCard({
  item,
  width,
  viewportHeight,
  scrollY,
  gridY,
  onPress,
}: {
  item: SponsoredProduct;
  width: number;
  viewportHeight: number;
  scrollY: number;
  gridY: number;
  onPress: () => void;
}) {
  const [y, setY] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sent = useRef(false);
  useEffect(() => {
    const height = width + 142;
    const top = gridY + y - scrollY;
    const visible = Math.max(0, Math.min(top + height, viewportHeight) - Math.max(top, 0));
    if (!sent.current && visible / height >= MARKETPLACE_AD_VISIBLE_RATIO) {
      if (!timer.current)
        timer.current = setTimeout(() => {
          sent.current = true;
          void recordAdEvent({
            campaignId: item.campaign_id,
            productId: item.product_id,
            eventType: "impression",
            surface: "marketplace_home",
            metadata: { position: 2 },
          }).catch(() => {});
        }, MARKETPLACE_AD_VISIBLE_MS);
    } else if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [gridY, item, scrollY, viewportHeight, width, y]);
  const image = item.images?.[0] ?? null;
  return (
    <View onLayout={(event) => setY(event.nativeEvent.layout.y)}>
      <Pressable
        style={[styles.productCard, styles.sponsoredCard, { width }]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Patrocinado, ${item.title}, ${Number(item.price).toFixed(2)} BDAG`}
      >
        <View style={styles.productMedia}>
          {image ? (
            <Image source={{ uri: image }} style={styles.productImage} contentFit="cover" transition={180} />
          ) : (
            <ProductMediaFallback />
          )}
          <View style={styles.sponsoredBadge}>
            <MaterialIcons name="campaign" size={12} color="#221604" />
            <Text style={styles.sponsoredBadgeText}>Patrocinado</Text>
          </View>
        </View>
        <View style={styles.productBody}>
          <Text style={styles.productTitle} numberOfLines={2}>{item.title}</Text>
          <View style={styles.storeRow}>
            <MaterialCommunityIcons name="storefront-outline" size={13} color={Colors.textSubtle} />
            <Text style={styles.storeName} numberOfLines={1}>@{item.seller.username}</Text>
          </View>
          <Text style={styles.productPrice} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
            {Number(item.price).toFixed(2)} BDAG
          </Text>
          <Text style={styles.productSales}>Promocionado por el vendedor</Text>
        </View>
      </Pressable>
    </View>
  );
});

export default function ShopScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const { user } = useAuth();
  const walletData = useWallet();
  const balance = walletData?.balance ?? 0;
  const { totalQuantity } = useMarketplaceCart();
  const [products, setProducts] = useState<Product[]>([]);
  const [category, setCategory] = useState<MarketplaceCategory | "">("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<MarketLoadError>(null);
  const [sponsored, setSponsored] = useState<SponsoredProduct[]>([]);
  const [scrollY, setScrollY] = useState(0);
  const [gridY, setGridY] = useState(0);
  const cardWidth = Math.max(136, (viewportWidth - Spacing.md * 2 - Spacing.sm) / 2);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const [catalog, ads] = await Promise.all([
        fetchProducts({ category: category || undefined, search: search.trim() || undefined, limit: 30 }),
        fetchSponsoredProducts("marketplace_home", category || undefined).catch(() => []),
      ]);
      setProducts(catalog.filter((product) => product.seller_id !== user?.id));
      setSponsored(ads);
      setError(null);
    } catch (error) {
      const nextError: Exclude<MarketLoadError, null> =
        error instanceof MarketplaceReadError && error.code === "marketplace_read_transport"
          ? "network"
          : error instanceof MarketplaceReadError && error.code === "marketplace_read_permission"
            ? "permission"
            : "request";
      setError(nextError);
      if (__DEV__)
        console.warn("[MarketplaceScreen]", {
          operation: "loadProducts",
          category: nextError,
          postgresCode: error instanceof MarketplaceReadError ? error.postgresCode : null,
        });
    } finally {
      setLoading(false);
    }
  }, [category, search, user?.id]);

  useEffect(() => {
    const timer = setTimeout(() => void loadProducts(), 250);
    return () => clearTimeout(timer);
  }, [loadProducts]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadProducts();
    } finally {
      setRefreshing(false);
    }
  }, [loadProducts]);

  const errorMessage =
    error === "network"
      ? "No pudimos conectar con la tienda. Revisa tu conexión."
      : error === "permission"
        ? "La tienda necesita una actualización de acceso. Inténtalo nuevamente."
        : "No pudimos cargar los productos.";
  const mixedProducts = mixMarketplaceSponsoredProducts(products, sponsored);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.headerEyebrow}>ONSPACE</Text>
          <Text style={styles.headerTitle}>Tienda</Text>
          <Text style={styles.headerSub}>Productos, ofertas y tiendas en un solo lugar</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            style={styles.walletPill}
            onPress={() => router.push("/(tabs)/wallet")}
            accessibilityRole="button"
            accessibilityLabel={`Saldo, ${fmt(balance)} BDAG`}
          >
            <MaterialCommunityIcons name="hexagon-multiple" size={13} color="#FFB11B" />
            <Text style={styles.walletText}>{balance >= 1000 ? fmtShort(balance) : fmt(balance)} BDAG</Text>
          </Pressable>
          <Pressable
            style={styles.iconButton}
            onPress={() => router.push("/cart" as never)}
            accessibilityRole="button"
            accessibilityLabel={`Carrito, ${totalQuantity} productos`}
          >
            <MaterialIcons name="shopping-cart" size={23} color={Colors.textPrimary} />
            {totalQuantity > 0 ? (
              <View style={styles.cartBadge}><Text style={styles.cartBadgeText}>{totalQuantity > 99 ? "99+" : totalQuantity}</Text></View>
            ) : null}
          </Pressable>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onScroll={(event) => setScrollY(event.nativeEvent.contentOffset.y)}
        scrollEventThrottle={100}
        contentContainerStyle={[styles.scroll, { paddingBottom: 100 + insets.bottom }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={Colors.primary} />}
      >
        <LinearGradient colors={["rgba(45,158,255,.18)", "rgba(124,92,255,.08)"]} style={styles.shopHero}>
          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle}>Encuentra tu próximo favorito</Text>
            <Text style={styles.heroBody}>Explora productos físicos y digitales de tiendas OnSpace.</Text>
          </View>
          <MaterialCommunityIcons name="shopping-outline" size={42} color={Colors.blue} />
        </LinearGradient>

        <View style={styles.searchBar}>
          <MaterialIcons name="search" size={21} color={Colors.textSubtle} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Buscar productos o tiendas"
            placeholderTextColor={Colors.textSubtle}
            returnKeyType="search"
            accessibilityLabel="Buscar en la tienda"
          />
          {loading && search ? <ActivityIndicator size="small" color={Colors.primary} /> : null}
          {search ? (
            <Pressable
              style={styles.clearSearch}
              onPress={() => setSearch("")}
              accessibilityRole="button"
              accessibilityLabel="Limpiar búsqueda"
            >
              <MaterialIcons name="close" size={19} color={Colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categories}>
          {PRODUCT_CATEGORIES.map((item) => {
            const selected = category === item.key;
            return (
              <Pressable
                key={item.key || "all"}
                style={[styles.categoryChip, selected && styles.categoryChipSelected]}
                onPress={() => setCategory(item.key)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`Categoría ${item.label}`}
              >
                <Text style={[styles.categoryChipText, selected && styles.categoryChipTextSelected]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.catalogHeader}>
          <View style={styles.catalogCopy}>
            <Text style={styles.catalogTitle}>{search.trim() ? "Resultados" : category ? categoryLabel(category) : "Productos para ti"}</Text>
            <Text style={styles.catalogMeta}>{loading ? "Actualizando…" : `${products.length} productos`}</Text>
          </View>
          <Pressable style={styles.sellButton} onPress={() => router.push("/seller" as never)} accessibilityRole="button">
            <MaterialCommunityIcons name="store-plus-outline" size={17} color={Colors.blue} />
            <Text style={styles.sellButtonText}>Vender</Text>
          </Pressable>
        </View>

        {error ? (
          <View style={styles.stateCard}>
            <MaterialCommunityIcons name="store-alert-outline" size={42} color={Colors.secondary} />
            <Text style={styles.stateTitle}>La tienda no está disponible</Text>
            <Text style={styles.stateBody}>{errorMessage}</Text>
            <Pressable style={styles.retryButton} onPress={() => void loadProducts()} accessibilityRole="button">
              <Text style={styles.retryText}>Reintentar</Text>
            </Pressable>
          </View>
        ) : loading && products.length === 0 ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={Colors.blue} />
            <Text style={styles.stateBody}>Preparando la tienda…</Text>
          </View>
        ) : mixedProducts.length === 0 ? (
          <View style={styles.stateCard}>
            <MaterialCommunityIcons name="shopping-search" size={46} color={Colors.borderHighlight} />
            <Text style={styles.stateTitle}>{search ? "Sin resultados" : "No hay productos aquí"}</Text>
            <Text style={styles.stateBody}>{search ? "Prueba otra búsqueda o categoría." : "Vuelve pronto para descubrir nuevas publicaciones."}</Text>
            {search || category ? (
              <Pressable style={styles.retryButton} onPress={() => { setSearch(""); setCategory(""); }} accessibilityRole="button">
                <Text style={styles.retryText}>Ver todos los productos</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View style={styles.productGrid} onLayout={(event) => setGridY(event.nativeEvent.layout.y)}>
            {mixedProducts.map((entry) => {
              if (entry.kind === "organic") {
                const p = entry.product;
                return (
                  <ProductCard
                    key={p.id}
                    product={p}
                    width={cardWidth}
                    onPress={() => router.push({ pathname: "/product/[id]", params: { id: p.id, source: "shop" } })}
                  />
                );
              }
              const ad = entry.product;
              return (
                <SponsoredCard
                  key={`ad:${ad.campaign_id}`}
                  item={ad}
                  width={cardWidth}
                  viewportHeight={viewportHeight}
                  scrollY={scrollY}
                  gridY={gridY}
                  onPress={() => {
                    void recordAdEvent({
                      campaignId: ad.campaign_id,
                      productId: ad.product_id,
                      eventType: "click",
                      surface: "marketplace_home",
                      metadata: { position: entry.position },
                    }).catch(() => {});
                    router.push({ pathname: "/product/[id]", params: marketplaceSponsoredProductRoute(ad) });
                  }}
                />
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  headerCopy: { flex: 1, minWidth: 0 },
  headerEyebrow: { color: Colors.blue, fontSize: 9, fontWeight: FontWeight.extrabold, letterSpacing: 1.8 },
  headerTitle: { color: Colors.textPrimary, fontSize: 28, lineHeight: 32, fontWeight: FontWeight.extrabold, letterSpacing: -0.8 },
  headerSub: { color: Colors.textSubtle, fontSize: FontSize.xs, marginTop: 1 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: Spacing.xs, marginLeft: Spacing.sm },
  walletPill: { minHeight: 44, maxWidth: 112, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, borderRadius: Radius.full, backgroundColor: "rgba(255,177,27,.12)", borderWidth: 1, borderColor: "rgba(255,177,27,.25)" },
  walletText: { flexShrink: 1, color: "#FFB11B", fontSize: 10, fontWeight: FontWeight.bold },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border },
  cartBadge: { position: "absolute", right: 0, top: 0, minWidth: 18, height: 18, paddingHorizontal: 3, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: Colors.secondary },
  cartBadgeText: { color: "#fff", fontSize: 9, fontWeight: FontWeight.bold },
  scroll: { padding: Spacing.md, gap: Spacing.md },
  shopHero: { minHeight: 116, flexDirection: "row", alignItems: "center", gap: Spacing.md, padding: Spacing.lg, borderRadius: Radius.xl, borderWidth: 1, borderColor: "rgba(45,158,255,.25)" },
  heroCopy: { flex: 1, minWidth: 0, gap: 4 },
  heroTitle: { color: Colors.textPrimary, fontSize: FontSize.xl, lineHeight: 26, fontWeight: FontWeight.extrabold },
  heroBody: { color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 19 },
  searchBar: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: Spacing.sm, paddingHorizontal: Spacing.md, borderRadius: Radius.full, backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.borderHighlight },
  searchInput: { flex: 1, minWidth: 0, color: Colors.textPrimary, fontSize: FontSize.md },
  clearSearch: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  categories: { gap: Spacing.sm, paddingRight: Spacing.md },
  categoryChip: { minHeight: 44, justifyContent: "center", paddingHorizontal: Spacing.md, borderRadius: Radius.full, backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border },
  categoryChipSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  categoryChipText: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  categoryChipTextSelected: { color: "#fff", fontWeight: FontWeight.bold },
  catalogHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: Spacing.sm },
  catalogCopy: { flex: 1, minWidth: 0 },
  catalogTitle: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.extrabold },
  catalogMeta: { color: Colors.textSubtle, fontSize: FontSize.xs, marginTop: 2 },
  sellButton: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: Spacing.md, borderRadius: Radius.full, backgroundColor: Colors.blueDim, borderWidth: 1, borderColor: Colors.blue + "44" },
  sellButtonText: { color: Colors.blue, fontWeight: FontWeight.bold },
  productGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm, justifyContent: "space-between", alignItems: "flex-start" },
  productCard: { overflow: "hidden", borderRadius: Radius.lg, backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border },
  sponsoredCard: { borderColor: "rgba(255,177,27,.38)" },
  productMedia: { width: "100%", aspectRatio: 1, position: "relative", overflow: "hidden", backgroundColor: Colors.surface },
  productImage: { width: "100%", height: "100%" },
  productImageFallback: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center", gap: Spacing.xs, backgroundColor: Colors.surface },
  productImageFallbackIcon: { width: 58, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center", backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border },
  productImageFallbackText: { color: Colors.textSubtle, fontSize: 10, fontWeight: FontWeight.semibold, textAlign: "center" },
  categoryBadge: { position: "absolute", left: 8, top: 8, paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.full, backgroundColor: "rgba(7,7,15,.76)" },
  categoryBadgeText: { color: "#fff", fontSize: 9, fontWeight: FontWeight.bold },
  sponsoredBadge: { position: "absolute", left: 8, top: 8, flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.full, backgroundColor: "#FFB11B" },
  sponsoredBadgeText: { color: "#221604", fontSize: 9, fontWeight: FontWeight.extrabold },
  soldOutOverlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(7,7,15,.56)" },
  soldOutOverlayText: { color: "#fff", fontSize: FontSize.sm, fontWeight: FontWeight.extrabold, textTransform: "uppercase", letterSpacing: 1 },
  productBody: { minHeight: 132, padding: Spacing.sm, gap: 5 },
  productTitle: { color: Colors.textPrimary, fontSize: FontSize.sm, lineHeight: 18, fontWeight: FontWeight.bold },
  storeRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  storeName: { flex: 1, color: Colors.textSubtle, fontSize: 10 },
  productPrice: { color: Colors.blue, fontSize: FontSize.md, fontWeight: FontWeight.extrabold, fontVariant: ["tabular-nums"] },
  productSales: { color: Colors.textSubtle, fontSize: 9 },
  stateCard: { minHeight: 220, alignItems: "center", justifyContent: "center", gap: Spacing.sm, padding: Spacing.xl, borderRadius: Radius.xl, backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.border },
  stateTitle: { color: Colors.textPrimary, fontSize: FontSize.lg, fontWeight: FontWeight.bold, textAlign: "center" },
  stateBody: { color: Colors.textSecondary, fontSize: FontSize.sm, lineHeight: 20, textAlign: "center" },
  retryButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: Spacing.lg, borderRadius: Radius.full, backgroundColor: Colors.primary },
  retryText: { color: "#fff", fontWeight: FontWeight.bold },
});
