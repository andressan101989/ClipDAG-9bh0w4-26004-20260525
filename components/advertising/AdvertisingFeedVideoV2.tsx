import React from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "@/components/ui/SafeImage";

type Props = { url: string; thumbnailUrl: string | null; isActive: boolean; onReady: () => void };

export function AdvertisingFeedVideoV2({ thumbnailUrl }: Props) {
  return (
    <View style={StyleSheet.absoluteFillObject}>
      {thumbnailUrl ? <Image source={{ uri: thumbnailUrl }} style={StyleSheet.absoluteFillObject} contentFit="cover" /> : null}
    </View>
  );
}
