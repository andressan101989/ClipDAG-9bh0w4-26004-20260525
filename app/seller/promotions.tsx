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
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { randomUUID } from "expo-crypto";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SellerScreenHeader } from "@/components/marketplace/SellerScreenHeader";
import { Colors, Radius, Spacing } from "@/constants/theme";
import {
  fetchMyProductsPage,
  fetchSellerProductVariants,
  type MarketplaceVariant,
  type Product,
} from "@/services/marketplaceService";
import {
  createMarketplacePromotion,
  endMarketplacePromotion,
  listMyMarketplacePromotionsPage,
  promotionLabel,
  type MarketplacePromotion,
  type MarketplacePromotionState,
  type MarketplacePromotionType,
} from "@/services/marketplacePromotionService";
import { mergeMarketplaceCursorPage } from "@/services/marketplaceCursorCollection";
type Filter = MarketplacePromotionState | "all";
const filters: [Filter, string][] = [
  ["active", "Activas"],
  ["scheduled", "Programadas"],
  ["ended", "Finalizadas"],
  ["all", "Todas"],
];
export default function Promotions() {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<MarketplacePromotion[]>([]),
    [products, setProducts] = useState<Product[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(false),
    [creating, setCreating] = useState(false),
    [filter, setFilter] = useState<Filter>("active"),
    [promotionCursor, setPromotionCursor] = useState<{
      createdAt: string;
      promotionId: string;
    } | null>(null),
    [productCursor, setProductCursor] = useState<{
      updatedAt: string;
      productId: string;
    } | null>(null),
    [loadingMorePromotions, setLoadingMorePromotions] = useState(false),
    [loadingMoreProducts, setLoadingMoreProducts] = useState(false);
  const promotionRequest = useRef(false),
    productRequest = useRef(false);
  const load = useCallback(async () => {
    if (promotionRequest.current || productRequest.current) return;
    promotionRequest.current = true;
    productRequest.current = true;
    setLoading(true);
    try {
      const [p, ps] = await Promise.all([
        listMyMarketplacePromotionsPage(null, 50),
        fetchMyProductsPage(null, 50),
      ]);
      setItems(p.items);
      setPromotionCursor(p.nextCursor);
      setProducts(ps.items.filter((x) => x.status === "active"));
      setProductCursor(ps.nextCursor);
      setError(false);
    } catch {
      setError(true);
    } finally {
      promotionRequest.current = false;
      productRequest.current = false;
      setLoading(false);
    }
  }, []);
  const loadMorePromotions = useCallback(async () => {
    if (!promotionCursor || promotionRequest.current) return;
    promotionRequest.current = true;
    setLoadingMorePromotions(true);
    try {
      const page = await listMyMarketplacePromotionsPage(promotionCursor, 50);
      setItems(
        (current) =>
          mergeMarketplaceCursorPage(
            { items: current, nextCursor: promotionCursor },
            page,
          ).items,
      );
      setPromotionCursor(page.nextCursor);
    } catch {
      setError(true);
    } finally {
      promotionRequest.current = false;
      setLoadingMorePromotions(false);
    }
  }, [promotionCursor]);
  const loadMoreProducts = useCallback(async () => {
    if (!productCursor || productRequest.current) return;
    productRequest.current = true;
    setLoadingMoreProducts(true);
    try {
      const page = await fetchMyProductsPage(productCursor, 50),
        active = {
          items: page.items.filter((item) => item.status === "active"),
          nextCursor: page.nextCursor,
        };
      setProducts(
        (current) =>
          mergeMarketplaceCursorPage(
            { items: current, nextCursor: productCursor },
            active,
          ).items,
      );
      setProductCursor(page.nextCursor);
    } catch {
      setError(true);
    } finally {
      productRequest.current = false;
      setLoadingMoreProducts(false);
    }
  }, [productCursor]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  const shown = useMemo(
    () => (filter === "all" ? items : items.filter((x) => x.state === filter)),
    [filter, items],
  );
  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <SellerScreenHeader title="Promociones" fallbackRoute="/seller" />
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => void load()}
            tintColor={Colors.primary}
          />
        }
        contentContainerStyle={s.content}
      >
        <Pressable
          style={s.primary}
          accessibilityRole="button"
          accessibilityLabel="Crear promoción"
          onPress={() => setCreating((x) => !x)}
        >
          <Text style={s.primaryText}>
            {creating ? "Cerrar" : "Crear promoción"}
          </Text>
        </Pressable>
        {creating ? (
          <CreateForm
            products={products}
            hasMoreProducts={productCursor !== null}
            loadingMoreProducts={loadingMoreProducts}
            loadMoreProducts={loadMoreProducts}
            done={() => {
              setCreating(false);
              void load();
            }}
          />
        ) : null}
        <View style={s.filters}>
          {filters.map(([v, l]) => (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: filter === v }}
              key={v}
              style={[s.chip, filter === v && s.chipOn]}
              onPress={() => setFilter(v)}
            >
              <Text style={s.text}>{l}</Text>
            </Pressable>
          ))}
        </View>
        {loading && !items.length ? (
          <ActivityIndicator color={Colors.primary} />
        ) : error ? (
          <View style={s.empty}>
            <Text style={s.title}>No pudimos cargar las promociones</Text>
            <Pressable onPress={() => void load()}>
              <Text style={s.link}>Reintentar</Text>
            </Pressable>
          </View>
        ) : shown.length ? (
          shown.map((p) => (
            <View key={p.id} style={s.card}>
              <Text style={s.title}>{p.productTitle}</Text>
              <Text style={s.accent}>{promotionLabel(p)}</Text>
              <Text style={s.muted}>
                {p.variantTitle ?? "Todo el producto"} ·{" "}
                {p.state === "active"
                  ? "Activa"
                  : p.state === "scheduled"
                    ? "Programada"
                    : "Finalizada"}
              </Text>
              <Text style={s.muted}>
                {new Date(p.startsAt).toLocaleString()} —{" "}
                {new Date(p.endsAt).toLocaleString()}
              </Text>
              {p.state === "active" ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Finalizar promoción de ${p.productTitle}`}
                  onPress={() =>
                    Alert.alert(
                      "Finalizar promoción",
                      "El precio normal volverá a aplicarse a nuevas reservas.",
                      [
                        { text: "Cancelar", style: "cancel" },
                        {
                          text: "Finalizar",
                          style: "destructive",
                          onPress: () =>
                            void endMarketplacePromotion(p.id).then(load),
                        },
                      ],
                    )
                  }
                >
                  <Text style={s.end}>Finalizar</Text>
                </Pressable>
              ) : null}
            </View>
          ))
        ) : (
          <View style={s.empty}>
            <Text style={s.title}>
              {filter === "active"
                ? "No tienes promociones activas"
                : "Aún no tienes promociones"}
            </Text>
            <Text style={s.muted}>
              Crea una promoción para un producto elegible.
            </Text>
          </View>
        )}
        {promotionCursor !== null ? (
          <Pressable
            accessibilityRole="button"
            style={s.choice}
            disabled={loadingMorePromotions}
            onPress={() => void loadMorePromotions()}
          >
            <Text style={s.link}>
              {loadingMorePromotions ? "Cargando…" : "Cargar más promociones"}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}
function CreateForm({
  products,
  hasMoreProducts,
  loadingMoreProducts,
  loadMoreProducts,
  done,
}: {
  products: Product[];
  hasMoreProducts: boolean;
  loadingMoreProducts: boolean;
  loadMoreProducts: () => Promise<void>;
  done: () => void;
}) {
  const [product, setProduct] = useState<Product | null>(products[0] ?? null),
    [variants, setVariants] = useState<MarketplaceVariant[]>([]),
    [variantId, setVariantId] = useState<string | null>(null),
    [type, setType] = useState<MarketplacePromotionType>("percentage"),
    [value, setValue] = useState(""),
    [starts, setStarts] = useState(new Date()),
    [ends, setEnds] = useState(new Date(Date.now() + 7 * 86400000)),
    [saving, setSaving] = useState(false),
    [loadingVariants, setLoadingVariants] = useState(false);
  const idempotencyKey=useRef(randomUUID());
  useEffect(() => {
    let active = true;
    setVariantId(null);
    setVariants([]);
    if (!product) return;
    setLoadingVariants(true);
    void fetchSellerProductVariants(product.id)
      .then((result) => {
        if (active)
          setVariants(
            result.detail.variants.filter((v) => v.status === "active"),
          );
      })
      .catch(() => {
        if (active)
          Alert.alert(
            "No pudimos cargar las variantes",
            "Inténtalo nuevamente.",
          );
      })
      .finally(() => {
        if (active) setLoadingVariants(false);
      });
    return () => {
      active = false;
    };
  }, [product]);
  const selected = variants.find((v) => v.id === variantId),
    base = selected?.base_price ?? selected?.price ?? product?.price ?? 0,
    numeric = Number(value),
    preview =
      numeric > 0
        ? type === "percentage"
          ? base * (1 - numeric / 100)
          : type === "fixed_amount"
            ? base - numeric
            : numeric
        : null,
    mustChooseVariant =
      type==="promotional_price"&&variants.length>1&&variantId==null,
    valid = Boolean(
      product &&
        !loadingVariants &&
        !mustChooseVariant &&
        Number.isFinite(numeric) &&
        numeric > 0 &&
        preview &&
        preview > 0 &&
        preview < base &&
        starts<ends,
    );
  const save = async () => {
    if (!product || !valid) return;
    setSaving(true);
    try {
      await createMarketplacePromotion({
        productId: product.id,
        variantId,
        type,
        value: numeric,
        startsAt: starts,
        endsAt: ends,
        idempotencyKey: idempotencyKey.current,
      });
      done();
    } catch {
      Alert.alert(
        "No pudimos crear la promoción",
        "Revisa los datos y vuelve a intentar. La misma solicitud se reutilizará de forma segura.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <View style={s.form}>
      <Text style={s.title}>Nueva promoción</Text>
      <Text style={s.label}>1. Producto</Text>
      <ScrollView horizontal>
        {products.map((p) => (
          <Pressable
            key={p.id}
            style={[s.choice, product?.id === p.id && s.choiceOn]}
            onPress={() => setProduct(p)}
          >
            <Text style={s.text}>
              {p.title} · {p.price.toFixed(2)} BDAG
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      {hasMoreProducts ? (
        <Pressable
          accessibilityRole="button"
          style={s.choice}
          disabled={loadingMoreProducts}
          onPress={() => void loadMoreProducts()}
        >
          <Text style={s.link}>
            {loadingMoreProducts ? "Cargando…" : "Cargar más productos"}
          </Text>
        </Pressable>
      ) : null}
      <Text style={s.label}>2. Alcance del precio</Text>
      {loadingVariants ? (
        <ActivityIndicator color={Colors.primary} />
      ) : (
        <ScrollView horizontal>
          <Pressable
            style={[s.choice, variantId === null && s.choiceOn]}
            onPress={() => setVariantId(null)}
          >
            <Text style={s.text}>Todo el producto</Text>
          </Pressable>
          {variants.map((v) => (
            <Pressable
              key={v.id}
              accessibilityRole="button"
              accessibilityLabel={`Seleccionar variante ${v.title ?? v.sku ?? "sin nombre"}`}
              style={[s.choice, variantId === v.id && s.choiceOn]}
              onPress={() => setVariantId(v.id)}
            >
              <Text style={s.text}>
                {v.title??v.sku??"Variante"} ·{" "}
                {(v.base_price ?? v.price).toFixed(2)} BDAG
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      <Text style={s.label}>3. Tipo</Text>
      <View style={s.filters}>
        {(
          [
            ["percentage", "Porcentaje"],
            ["fixed_amount", "Monto fijo"],
            ["promotional_price", "Precio promocional"],
          ] as [MarketplacePromotionType, string][]
        ).map(([v, l]) => (
          <Pressable
            key={v}
            style={[s.choice, type === v && s.choiceOn]}
            onPress={() => setType(v)}
          >
            <Text style={s.text}>{l}</Text>
          </Pressable>
        ))}
      </View>
      {mustChooseVariant ? (
        <Text style={s.end}>
          Selecciona una variante para definir un precio promocional fijo.
        </Text>
      ) : null}
      <Text style={s.label}>4. Descuento / precio</Text>
      <TextInput
        value={value}
        onChangeText={setValue}
        keyboardType="decimal-pad"
        style={s.input}
        accessibilityLabel="Valor de promoción"
      />
      <Text style={s.label}>5. Inicio</Text>
      <DateTimePicker
        value={starts}
        mode="datetime"
        onChange={(_, d) => d && setStarts(d)}
      />
      <Text style={s.label}>6. Fin</Text>
      <DateTimePicker
        value={ends}
        mode="datetime"
        onChange={(_, d) => d && setEnds(d)}
      />
      {product && preview != null ? (
        <View style={s.preview}>
          <Text style={s.muted}>Precio normal {base.toFixed(2)} BDAG</Text>
          <Text style={s.accent}>
            Precio promocional {preview.toFixed(2)} BDAG
          </Text>
        </View>
      ) : null}
      <Pressable
        disabled={!valid || saving}
        style={[s.primary, (!valid || saving) && s.disabled]}
        onPress={() => void save()}
      >
        <Text style={s.primaryText}>
          {saving ? "Guardando…" : "Guardar y activar"}
        </Text>
      </Pressable>
    </View>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  content: { padding: Spacing.md, gap: Spacing.md, paddingBottom: Spacing.xxl },
  primary: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.md,
    backgroundColor: Colors.primary,
  },
  primaryText: { color: Colors.textOnBrand, fontWeight: "800" },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    padding: 10,
    borderRadius: Radius.full,
    backgroundColor: Colors.surfaceElevated,
  },
  chipOn: { backgroundColor: Colors.primary },
  text: { color: Colors.textPrimary },
  card: {
    padding: Spacing.md,
    gap: 6,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceElevated,
  },
  title: { color: Colors.textPrimary, fontWeight: "800" },
  accent: { color: Colors.accent, fontWeight: "800" },
  muted: { color: Colors.textSecondary },
  end: { color: Colors.error, fontWeight: "800", paddingVertical: 8 },
  empty: {
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  link: { color: Colors.primaryLight, fontWeight: "800" },
  form: {
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.primary,
    backgroundColor: Colors.surfaceElevated,
  },
  label: { color: Colors.textSecondary, fontWeight: "700" },
  choice: {
    padding: 10,
    marginRight: 8,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceHighlight,
  },
  choiceOn: { borderWidth: 1, borderColor: Colors.primary },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    color: Colors.textPrimary,
    paddingHorizontal: Spacing.md,
  },
  preview: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.accentDim,
  },
  disabled: { opacity: 0.45 },
});
