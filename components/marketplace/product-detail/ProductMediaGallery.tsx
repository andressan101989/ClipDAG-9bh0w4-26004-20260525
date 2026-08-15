import React, { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Modal, NativeScrollEvent, NativeSyntheticEvent, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Image } from "expo-image";
import { MaterialIcons } from "@expo/vector-icons";
import { VideoView, useVideoPlayer } from "expo-video";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors, FontWeight, Radius, Spacing } from "@/constants/theme";
import type { MarketplaceProductGalleryItem } from "@/services/marketplaceService";

type Props = { items: MarketplaceProductGalleryItem[]; selectedIndex: number; onSelect: (index: number) => void };

export function ProductMediaGallery({ items, selectedIndex, onSelect }: Props) {
  const { width: viewportWidth } = useWindowDimensions(), insets = useSafeAreaInsets();
  const galleryWidth = Math.min(viewportWidth, 430), selected = items[selectedIndex] ?? null;
  const heroRef = useRef<FlatList<MarketplaceProductGalleryItem>>(null), thumbnailRef = useRef<FlatList<MarketplaceProductGalleryItem>>(null), fullscreenRef = useRef<FlatList<{ item: MarketplaceProductGalleryItem; sourceIndex: number }>>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const player = useVideoPlayer(selected?.kind === "video" ? selected.url : null, (instance) => { instance.muted = true; });
  const images = useMemo(() => items.flatMap((item, sourceIndex) => item.kind === "image" ? [{ item, sourceIndex }] : []), [items]);
  const fullscreenIndex = Math.max(0, images.findIndex((entry) => entry.sourceIndex === selectedIndex));

  useEffect(() => { if (selected?.kind !== "video") player.pause(); }, [player, selected?.kind]);
  useEffect(() => {
    if (!items.length || selectedIndex < 0 || selectedIndex >= items.length) return;
    heroRef.current?.scrollToOffset({ offset: selectedIndex * galleryWidth, animated: false });
    thumbnailRef.current?.scrollToIndex({ index: selectedIndex, animated: true, viewPosition: 0.5 });
  }, [galleryWidth, items.length, selectedIndex]);
  useEffect(() => {
    if (fullscreen && images.length) fullscreenRef.current?.scrollToOffset({ offset: fullscreenIndex * viewportWidth, animated: false });
  }, [fullscreen, fullscreenIndex, images.length, viewportWidth]);

  const selectFromScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!items.length) return;
    const index = Math.max(0, Math.min(items.length - 1, Math.round(event.nativeEvent.contentOffset.x / galleryWidth)));
    if (index !== selectedIndex) onSelect(index);
  };
  const selectFullscreen = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!images.length) return;
    const index = Math.max(0, Math.min(images.length - 1, Math.round(event.nativeEvent.contentOffset.x / viewportWidth)));
    if (images[index].sourceIndex !== selectedIndex) onSelect(images[index].sourceIndex);
  };

  return (
    <View style={styles.gallery}>
      <View style={[styles.stage, { width: galleryWidth }]}>
        {items.length ? (
          <FlatList
            ref={heroRef}
            horizontal
            pagingEnabled
            data={items}
            keyExtractor={(item, index) => `${item.kind}-${item.url}-${index}`}
            showsHorizontalScrollIndicator={false}
            getItemLayout={(_, index) => ({ length: galleryWidth, offset: galleryWidth * index, index })}
            onMomentumScrollEnd={selectFromScroll}
            accessibilityLabel="Galería deslizable del producto"
            renderItem={({ item, index }) => (
              <View style={[styles.heroPage, { width: galleryWidth }]}>
                {item.kind === "video" && index === selectedIndex ? (
                  <VideoView player={player} style={styles.media} nativeControls contentFit="contain" accessibilityLabel={`Video ${index + 1} del producto`} />
                ) : item.kind === "video" ? (
                  <View style={[styles.media, styles.videoPage]}><MaterialIcons name="play-circle-filled" size={64} color="#fff" /><Text style={styles.videoPageText}>Video del producto</Text></View>
                ) : (
                  <Pressable style={styles.media} onPress={() => setFullscreen(true)} accessibilityRole="button" accessibilityLabel={`Ampliar imagen ${index + 1} del producto`}>
                    <Image source={{ uri: item.url }} style={styles.media} contentFit="cover" transition={180} />
                    <View style={styles.expandHint}><MaterialIcons name="zoom-out-map" size={14} color="#fff" /><Text style={styles.expandHintText}>Toca para ampliar</Text></View>
                  </Pressable>
                )}
              </View>
            )}
          />
        ) : (
          <View style={[styles.media, styles.empty]}><View style={styles.emptyIcon}><MaterialIcons name="image-not-supported" size={48} color={Colors.textSubtle} /></View><Text style={styles.emptyText}>Imagen no disponible</Text></View>
        )}
        {items.length ? <View style={styles.count}><MaterialIcons name={selected?.kind === "video" ? "play-arrow" : "photo-library"} size={13} color="#fff" /><Text style={styles.countText}>{Math.min(selectedIndex + 1, items.length)} / {items.length}</Text></View> : null}
      </View>
      {items.length > 1 ? (
        <FlatList
          ref={thumbnailRef}
          horizontal
          data={items}
          keyExtractor={(item, index) => `thumb-${item.kind}-${item.url}-${index}`}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.thumbnails}
          getItemLayout={(_, index) => ({ length: 74, offset: 74 * index, index })}
          renderItem={({ item, index }) => {
            const selectedThumbnail = index === selectedIndex;
            return <Pressable onPress={() => onSelect(index)} accessibilityRole="button" accessibilityLabel={item.kind === "video" ? "Seleccionar video del producto" : `Seleccionar imagen ${index + 1}`} accessibilityState={{ selected: selectedThumbnail }} style={[styles.thumbnail, selectedThumbnail && styles.thumbnailSelected]}>{item.kind === "image" ? <Image source={{ uri: item.url }} style={styles.thumbnailMedia} contentFit="cover" /> : <View style={[styles.thumbnailMedia, styles.videoThumbnail]}><MaterialIcons name="play-circle-filled" size={30} color="#fff" /><Text style={styles.videoText}>Video</Text></View>}</Pressable>;
          }}
        />
      ) : null}
      <Modal visible={fullscreen} transparent animationType="fade" onRequestClose={() => setFullscreen(false)}>
        <View style={styles.fullscreen}>
          <View style={[styles.fullscreenHeader, { paddingTop: insets.top + Spacing.xs }]}>
            <Text style={styles.fullscreenCount}>{images.length ? `${fullscreenIndex + 1} / ${images.length}` : ""}</Text>
            <Pressable style={styles.closeButton} onPress={() => setFullscreen(false)} accessibilityRole="button" accessibilityLabel="Cerrar imagen ampliada"><MaterialIcons name="close" size={26} color="#fff" /></Pressable>
          </View>
          <FlatList
            ref={fullscreenRef}
            horizontal
            pagingEnabled
            data={images}
            keyExtractor={(entry, index) => `full-${entry.item.url}-${index}`}
            showsHorizontalScrollIndicator={false}
            getItemLayout={(_, index) => ({ length: viewportWidth, offset: viewportWidth * index, index })}
            onMomentumScrollEnd={selectFullscreen}
            renderItem={({ item: entry, index }) => <View style={[styles.fullscreenPage, { width: viewportWidth, paddingBottom: insets.bottom }]}><Image source={{ uri: entry.item.url }} style={styles.fullscreenImage} contentFit="contain" accessibilityLabel={`Imagen ampliada ${index + 1} de ${images.length}`} /></View>}
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  gallery: { alignItems: "center", backgroundColor: Colors.surfaceElevated }, stage: { aspectRatio: 1, maxHeight: 430, position: "relative", overflow: "hidden", borderBottomLeftRadius: Radius.lg, borderBottomRightRadius: Radius.lg, backgroundColor: "#090A0E" }, heroPage: { height: "100%" }, media: { width: "100%", height: "100%" }, empty: { alignItems: "center", justifyContent: "center", gap: Spacing.sm }, emptyIcon: { width: 82, height: 82, borderRadius: 41, alignItems: "center", justifyContent: "center", backgroundColor: Colors.surface }, emptyText: { color: Colors.textSecondary }, videoPage: { alignItems: "center", justifyContent: "center", gap: Spacing.sm, backgroundColor: "#11131A" }, videoPageText: { color: Colors.textSecondary, fontWeight: FontWeight.semibold },
  expandHint: { position: "absolute", left: Spacing.md, bottom: Spacing.md, minHeight: 34, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, borderRadius: Radius.full, backgroundColor: "rgba(0,0,0,.72)" }, expandHintText: { color: "#fff", fontSize: 11, fontWeight: FontWeight.bold }, count: { position: "absolute", right: Spacing.md, bottom: Spacing.md, minHeight: 34, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 11, borderRadius: Radius.full, backgroundColor: "rgba(0,0,0,.72)" }, countText: { color: "#fff", fontSize: 12, fontWeight: FontWeight.bold },
  thumbnails: { gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm }, thumbnail: { width: 66, height: 66, padding: 2, borderRadius: Radius.md, overflow: "hidden", borderWidth: 2, borderColor: "transparent", backgroundColor: Colors.surface }, thumbnailSelected: { borderColor: Colors.primary, backgroundColor: Colors.primaryDim }, thumbnailMedia: { width: "100%", height: "100%", borderRadius: Radius.sm }, videoThumbnail: { alignItems: "center", justifyContent: "center", backgroundColor: "#171923" }, videoText: { color: "#fff", fontSize: 9, fontWeight: FontWeight.bold },
  fullscreen: { flex: 1, backgroundColor: "#000" }, fullscreenHeader: { position: "absolute", zIndex: 2, top: 0, left: 0, right: 0, minHeight: 64, paddingHorizontal: Spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "rgba(0,0,0,.45)" }, fullscreenCount: { color: "#fff", fontWeight: FontWeight.bold }, closeButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,.14)" }, fullscreenPage: { flex: 1, alignItems: "center", justifyContent: "center" }, fullscreenImage: { width: "100%", height: "100%" },
});
