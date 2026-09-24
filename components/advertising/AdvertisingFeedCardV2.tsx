import React, { memo } from "react";
import { Dimensions, Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "@/components/ui/SafeImage";
import { AdvertisingFeedVideoV2 } from "@/components/advertising/AdvertisingFeedVideoV2";
import { getVideoCardHeight } from "@/components/feature/VideoCard";
import { Colors, FontSize, FontWeight, Radius, Shadow, Spacing } from "@/constants/theme";
import type { AdvertisingDeliveryAdV2 } from "@/services/advertisingDeliveryService";

type Props = { ad: AdvertisingDeliveryAdV2; isActive: boolean; onMediaReady: () => void; onPress?: () => void };

const ctaLabels: Record<AdvertisingDeliveryAdV2["creative"]["call_to_action"], string | null> = {
  learn_more: "Más información",
  shop_now: "Comprar ahora",
  sign_up: "Registrarse",
  contact_us: "Contactar",
  send_message: "Enviar mensaje",
  download: "Descargar",
  visit_profile: "Ver perfil",
  none: null,
};

export const AdvertisingFeedCardV2 = memo(function AdvertisingFeedCardV2({ ad, isActive, onMediaReady, onPress }: Props) {
  const cta = ctaLabels[ad.creative.call_to_action];
  return (
    <View accessibilityLabel={`Patrocinado: ${ad.creative.headline ?? ad.advertiser.display_name}`} style={[styles.card, { width: Dimensions.get("window").width, height: getVideoCardHeight() }]}>
      {ad.creative.format === "video" ? (
        <AdvertisingFeedVideoV2
          isActive={isActive}
          onReady={onMediaReady}
          thumbnailUrl={ad.creative.media.thumbnail_url}
          url={ad.creative.media.url}
        />
      ) : <Image source={{ uri: ad.creative.media.url }} style={StyleSheet.absoluteFillObject} contentFit="cover" transition={180} onLoad={onMediaReady} />}
      <View style={styles.scrim} />
      <View style={styles.content}>
        <View style={styles.sponsoredBadge}><MaterialCommunityIcons name="bullhorn-outline" size={14} color={Colors.textPrimary} /><Text style={styles.sponsoredText}>Patrocinado</Text></View>
        <Text style={styles.advertiser}>{ad.advertiser.display_name}</Text>
        {ad.creative.headline ? <Text numberOfLines={2} style={styles.headline}>{ad.creative.headline}</Text> : null}
        {ad.creative.primary_text ? <Text numberOfLines={3} style={styles.primaryText}>{ad.creative.primary_text}</Text> : null}
        {cta && onPress ? <Pressable accessibilityRole="button" onPress={onPress} style={styles.cta}><Text style={styles.ctaText}>{cta}</Text><MaterialCommunityIcons name="arrow-right" size={20} color={Colors.textOnBrand} /></Pressable> : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.surface, overflow: "hidden", justifyContent: "flex-end" },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(5,8,18,0.42)" },
  content: { paddingHorizontal: Spacing.lg, paddingBottom: 116, gap: Spacing.sm },
  sponsoredBadge: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: "rgba(10,10,15,0.76)", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" },
  sponsoredText: { color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  advertiser: { color: Colors.textSecondary, fontSize: FontSize.md, fontWeight: FontWeight.medium },
  headline: { color: Colors.textPrimary, fontSize: 30, lineHeight: 36, fontWeight: FontWeight.extrabold },
  primaryText: { color: Colors.textPrimary, fontSize: FontSize.md, lineHeight: 22 },
  cta: { marginTop: Spacing.sm, minHeight: 52, borderRadius: Radius.lg, backgroundColor: Colors.primaryLight, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: Spacing.sm, ...Shadow.brand },
  ctaText: { color: Colors.textOnBrand, fontSize: FontSize.lg, fontWeight: FontWeight.bold },
});
