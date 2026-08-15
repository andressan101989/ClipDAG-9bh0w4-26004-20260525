import React, { useEffect } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { MaterialIcons } from "@expo/vector-icons";
import { VideoView, useVideoPlayer } from "expo-video";
import { Colors, FontWeight, Radius, Spacing } from "@/constants/theme";
import type { MarketplaceProductGalleryItem } from "@/services/marketplaceService";

type Props = {
  items: MarketplaceProductGalleryItem[];
  selectedIndex: number;
  onSelect: (index: number) => void;
};

export function ProductMediaGallery({ items, selectedIndex, onSelect }: Props) {
  const selected = items[selectedIndex] ?? null;
  const player = useVideoPlayer(selected?.kind === "video" ? selected.url : null, (instance) => {
    instance.muted = true;
  });
  useEffect(() => {
    if (selected?.kind !== "video") player.pause();
  }, [player, selected?.kind]);
  const imageUrl = selected?.kind === "image"
    ? selected.url
    : items.find((item) => item.kind === "image")?.url;

  return (
    <View style={styles.gallery}>
      <View style={styles.stage}>
        {selected?.kind === "video" ? (
          <VideoView
            player={player}
            style={styles.media}
            nativeControls
            contentFit="contain"
            accessibilityLabel="Video del producto"
          />
        ) : imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={styles.media}
            contentFit="cover"
            transition={180}
            accessibilityLabel={`Imagen ${selectedIndex + 1} del producto`}
          />
        ) : (
          <View style={[styles.media, styles.empty]}>
            <View style={styles.emptyIcon}>
              <MaterialIcons name="image-not-supported" size={48} color={Colors.textSubtle} />
            </View>
            <Text style={styles.emptyText}>Imagen no disponible</Text>
          </View>
        )}
        {items.length ? (
          <View style={styles.count}>
            <MaterialIcons name={selected?.kind === "video" ? "play-arrow" : "photo-library"} size={13} color="#fff" />
            <Text style={styles.countText}>{Math.min(selectedIndex + 1, items.length)} / {items.length}</Text>
          </View>
        ) : null}
      </View>
      {items.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbnails}>
          {items.map((item, index) => {
            const selectedThumbnail = index === selectedIndex;
            return (
              <Pressable
                key={`${item.kind}-${item.url}`}
                onPress={() => onSelect(index)}
                accessibilityRole="button"
                accessibilityLabel={item.kind === "video" ? "Seleccionar video del producto" : `Seleccionar imagen ${index + 1}`}
                accessibilityState={{ selected: selectedThumbnail }}
                style={[styles.thumbnail, selectedThumbnail && styles.thumbnailSelected]}
              >
                {item.kind === "image" ? (
                  <Image source={{ uri: item.url }} style={styles.thumbnailMedia} contentFit="cover" />
                ) : (
                  <View style={[styles.thumbnailMedia, styles.videoThumbnail]}>
                    <MaterialIcons name="play-circle-filled" size={30} color="#fff" />
                    <Text style={styles.videoText}>Video</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  gallery: { backgroundColor: Colors.surfaceElevated },
  stage: { width: "100%", aspectRatio: 1, maxHeight: 430, position: "relative", overflow: "hidden", backgroundColor: "#090A0E" },
  media: { ...StyleSheet.absoluteFillObject },
  empty: { alignItems: "center", justifyContent: "center", gap: Spacing.sm },
  emptyIcon: { width: 82, height: 82, borderRadius: 41, alignItems: "center", justifyContent: "center", backgroundColor: Colors.surface },
  emptyText: { color: Colors.textSecondary },
  count: { position: "absolute", right: Spacing.md, bottom: Spacing.md, minHeight: 32, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 11, borderRadius: Radius.full, backgroundColor: "rgba(0,0,0,.72)" },
  countText: { color: "#fff", fontSize: 12, fontWeight: FontWeight.bold },
  thumbnails: { gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  thumbnail: { width: 66, height: 66, padding: 2, borderRadius: Radius.md, overflow: "hidden", borderWidth: 2, borderColor: "transparent", backgroundColor: Colors.surface },
  thumbnailSelected: { borderColor: Colors.primary, backgroundColor: Colors.primaryDim },
  thumbnailMedia: { width: "100%", height: "100%", borderRadius: Radius.sm },
  videoThumbnail: { alignItems: "center", justifyContent: "center", backgroundColor: "#171923" },
  videoText: { color: "#fff", fontSize: 9, fontWeight: FontWeight.bold },
});
