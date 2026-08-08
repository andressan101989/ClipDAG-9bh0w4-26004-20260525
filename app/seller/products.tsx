import React, { useCallback } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useShop } from "@/hooks/useShop";
import {
  Colors,
  FontSize,
  FontWeight,
  Radius,
  Spacing,
} from "@/constants/theme";
import { SellerScreenHeader } from "@/components/marketplace/SellerScreenHeader";
import { classifySellerProductStatusCore } from "@/services/marketplaceSellerProductStatusCore.mjs";

const PRODUCT_STATUS_LABEL = {
  draft: "Borrador",
  published: "Publicado",
  sold_out: "Agotado",
  configuration_required: "Configuración requerida",
  paused: "Pausado",
} as const;

export default function SellerProducts() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    myProducts,
    sellerProductsState,
    sellerProductsError,
    fetchMyProducts,
    setPublished,
    deleteProduct,
  } = useShop();
  useFocusEffect(
    useCallback(() => {
      void fetchMyProducts();
    }, [fetchMyProducts]),
  );
  const errorMessage =
    sellerProductsError === "session"
      ? "Tu sesión expiró. Inicia sesión nuevamente."
      : "No pudimos cargar tus productos.";
  const errorState = (
    <View style={s.error}>
      <Text style={s.errorText}>{errorMessage}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Reintentar cargar productos"
        onPress={() => void fetchMyProducts()}
      >
        <Text style={s.retry}>Reintentar</Text>
      </Pressable>
    </View>
  );
  return (
    <View style={[s.page, { paddingTop: insets.top }]}>
      <SellerScreenHeader title="Mis productos" fallbackRoute="/seller" />
      <View style={s.actions}>
        <Pressable style={s.add} onPress={() => router.push("/create-product")}>
          <Text style={s.addText}>Crear producto</Text>
        </Pressable>
      </View>
      {sellerProductsState === "loading" && myProducts.length === 0 ? (
        <ActivityIndicator color={Colors.primary} />
      ) : (
        <FlatList
          data={myProducts}
          keyExtractor={(item) => item.id}
          contentContainerStyle={s.list}
          ListHeaderComponent={
            sellerProductsState === "error" && myProducts.length > 0
              ? errorState
              : null
          }
          ListEmptyComponent={
            sellerProductsState === "empty" ? (
              <Text style={s.empty}>Todavía no tienes productos.</Text>
            ) : sellerProductsState === "error" ? (
              errorState
            ) : null
          }
          renderItem={({ item }) => (
            <View style={s.card}>
              <View style={s.grow}>
                <Text style={s.name}>{item.title}</Text>
                <Text style={s.meta}>
                  {item.price.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")}{" "}
                  BDAG ·{" "}
                  {PRODUCT_STATUS_LABEL[classifySellerProductStatusCore(item)]}
                </Text>
              </View>
              <Pressable
                onPress={() =>
                  router.push(`/seller/product-editor/${item.id}` as never)
                }
              >
                <Text style={s.link}>
                  {item.status === "paused" && !item.published_at
                    ? "Continuar editando"
                    : "Editar"}
                </Text>
              </Pressable>
              <Pressable
                onPress={() =>
                  void setPublished(item.id, item.status !== "active")
                }
              >
                <Text style={s.link}>
                  {item.status === "active" ? "Pausar" : "Publicar"}
                </Text>
              </Pressable>
              <Pressable onPress={() => void deleteProduct(item.id)}>
                <Text style={[s.link, { color: Colors.secondary }]}>
                  Eliminar
                </Text>
              </Pressable>
            </View>
          )}
        />
      )}
    </View>
  );
}
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: Colors.bg },
  actions: { paddingHorizontal: Spacing.lg, alignItems: "flex-end" },
  add: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
  },
  addText: { color: "#000", fontWeight: FontWeight.bold },
  list: { padding: Spacing.lg, gap: Spacing.sm },
  empty: { color: Colors.textSecondary, textAlign: "center" },
  error: { alignItems: "center", gap: Spacing.sm, padding: Spacing.md },
  errorText: { color: Colors.textSecondary, textAlign: "center" },
  retry: { color: Colors.primary, fontWeight: FontWeight.semibold },
  card: {
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  grow: { flex: 1 },
  name: { color: Colors.textPrimary, fontWeight: FontWeight.semibold },
  meta: { color: Colors.textSubtle, fontSize: FontSize.xs, marginTop: 4 },
  link: { color: Colors.primary, fontSize: FontSize.xs },
});
