import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import {
  CommercePrice,
  LoadingButton,
  ProductAvailabilityBadge,
  ProductThumbnail,
  QuantityStepper,
} from "@/components/design";
import { OnSpaceText } from "@/components/design/OnSpaceText";
import { spacing } from "@/design";
import type { MarketplaceProductDetail } from "@/services/marketplaceService";
import type { MarketplaceVariantSelection } from "@/services/marketplaceVariantSelection";
import type { LiveSessionProduct } from "@/services/liveCommerceService";
import { LiveVariantSelector } from "./LiveVariantSelector";

export function LiveProductQuickView({
  pin,
  detail,
  selection,
  quantity,
  statusText,
  busy,
  onSelect,
  onQuantity,
  onContinue,
}: {
  pin: LiveSessionProduct;
  detail: MarketplaceProductDetail;
  selection: MarketplaceVariantSelection;
  quantity: number;
  statusText: string | null;
  busy: boolean;
  onSelect: (optionId: string, valueId: string) => void;
  onQuantity: (value: number) => void;
  onContinue: () => void;
}) {
  const variant = detail.variants.find(
      (item) =>
        item.option_value_ids.every((value) =>
          Object.values(selection).includes(value),
        ) && item.option_value_ids.length === Object.keys(selection).length,
    ),
    available = variant?.available_quantity ?? 0,
    canBuy = !!variant && available > 0,
    image = variant?.image_url ?? detail.product.images[0] ?? pin.imageUrl;
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.hero}>
        <ProductThumbnail
          uri={image}
          size="large"
          label={detail.product.title}
        />
        <View style={styles.heroText}>
          <OnSpaceText variant="headingMedium" numberOfLines={2}>
            {detail.product.title}
          </OnSpaceText>
          <OnSpaceText variant="bodySmall" color="textMuted" numberOfLines={1}>
            {pin.storeName} · {pin.sellerName}
          </OnSpaceText>
          {variant ? (
            <CommercePrice
              price={variant.price}
              compareAtPrice={variant.compare_at_price}
              size="large"
            />
          ) : null}
        </View>
      </View>
      <OnSpaceText variant="body" color="textSecondary" numberOfLines={3}>
        {detail.product.description}
      </OnSpaceText>
      <LiveVariantSelector
        detail={detail}
        selection={selection}
        onSelect={onSelect}
      />
      <View style={styles.quantityLine}>
        <View>
          <OnSpaceText variant="labelStrong">Cantidad</OnSpaceText>
          <OnSpaceText variant="caption" color="textMuted">
            {available} disponibles
          </OnSpaceText>
        </View>
        <QuantityStepper
          value={quantity}
          maximum={Math.max(1, available)}
          disabled={!canBuy}
          onChange={onQuantity}
        />
      </View>
      {statusText ? (
        <View style={styles.availability}>
          <ProductAvailabilityBadge
            availability={
              variant?.available_quantity === 0
                ? "out_of_stock"
                : "product_unavailable"
            }
          />
          <OnSpaceText variant="bodySmall" color="textDanger">
            {statusText}
          </OnSpaceText>
        </View>
      ) : null}
      <LoadingButton
        label="Continuar con la entrega"
        variant="commerce"
        size="large"
        disabled={!canBuy}
        loading={busy}
        onPress={onContinue}
      />
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  content: { gap: spacing.xl, paddingBottom: spacing.xxxl },
  hero: { flexDirection: "row", gap: spacing.lg },
  heroText: { flex: 1, justifyContent: "center", gap: spacing.xs },
  quantityLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  availability: { gap: spacing.sm },
});
