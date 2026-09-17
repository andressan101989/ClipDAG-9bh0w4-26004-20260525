import React, { memo } from "react";
import { Dimensions, Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "@/components/ui/SafeImage";
import { getVideoCardHeight } from "@/components/feature/VideoCard";
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from "@/constants/theme";
import type { SponsoredProduct } from "@/services/marketplaceAdsService";

type Props = {
  product: SponsoredProduct;
  onPress: () => void;
};

export const SponsoredFeedCard = memo(function SponsoredFeedCard({ product, onPress }: Props) {
  const imageUrl = product.images[0];
  const sellerName = product.seller.display_name || `@${product.seller.username}`;

  return (
    <View
      accessibilityLabel={`Patrocinado: ${product.title}`}
      style={[styles.card, { width: Dimensions.get("window").width, height: getVideoCardHeight() }]}
    >
      {imageUrl ? (
        <Image source={{ uri: imageUrl }} style={StyleSheet.absoluteFillObject} contentFit="cover" transition={180} />
      ) : (
        <View style={[StyleSheet.absoluteFillObject, styles.placeholder]}>
          <MaterialCommunityIcons name="shopping-outline" size={64} color={Colors.textSecondary} />
        </View>
      )}
      <View style={styles.scrim} />
      <View style={styles.content}>
        <View style={styles.sponsoredBadge}>
          <MaterialCommunityIcons name="bullhorn-outline" size={14} color={Colors.textPrimary} />
          <Text style={styles.sponsoredText}>Patrocinado</Text>
        </View>
        <Text style={styles.seller}>{sellerName}</Text>
        <Text numberOfLines={2} style={styles.title}>{product.title}</Text>
        <Text style={styles.price}>{product.price.toFixed(2)} BDAG</Text>
        <Pressable accessibilityRole="button" onPress={onPress} style={styles.cta}>
          <Text style={styles.ctaText}>Ver producto</Text>
          <MaterialCommunityIcons name="arrow-right" size={20} color={Colors.textOnBrand} />
        </Pressable>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.surface, overflow: "hidden", justifyContent: "flex-end" },
  placeholder: { alignItems: "center", justifyContent: "center", backgroundColor: Colors.surfaceElevated },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(5,8,18,0.34)" },
  content: { paddingHorizontal: Spacing.lg, paddingBottom: 116, gap: Spacing.sm },
  sponsoredBadge: {
    alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6,
    borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 7,
    backgroundColor: "rgba(10,10,15,0.76)", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)",
  },
  sponsoredText: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  seller: { color: Colors.textSecondary, fontSize: FontSize.md, fontWeight: FontWeight.medium },
  title: { color: Colors.textPrimary, fontSize: 30, lineHeight: 36, fontWeight: FontWeight.extrabold },
  price: { color: Colors.accentLight, fontSize: FontSize.xl, fontWeight: FontWeight.bold },
  cta: {
    marginTop: Spacing.sm, minHeight: 52, borderRadius: Radius.lg,
    backgroundColor: Colors.primaryLight, flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: Spacing.sm, ...Shadow.brand,
  },
  ctaText: { color: Colors.textOnBrand, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
});
