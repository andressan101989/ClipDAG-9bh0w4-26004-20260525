import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Image } from "expo-image";
import { MaterialIcons } from "@expo/vector-icons";
import { VideoView, useVideoPlayer } from "expo-video";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors, FontWeight, Radius, Spacing } from "@/constants/theme";
import type { MarketplaceProductGalleryItem } from "@/services/marketplaceService";

type Props = {
  items: MarketplaceProductGalleryItem[];
  selectedIndex: number;
  onSelect: (index: number) => void;
};

export function ProductMediaGallery({ items, selectedIndex, onSelect }: Props) {
  const { width: viewportWidth } = useWindowDimensions(),
    insets = useSafeAreaInsets();
  const galleryWidth = Math.min(
      Math.max(280, viewportWidth - Spacing.md * 2),
      900,
    ),
    selected = items[selectedIndex] ?? null;
  const heroRef = useRef<FlatList<MarketplaceProductGalleryItem>>(null),
    thumbnailRef =
      useRef<
        FlatList<{ item: MarketplaceProductGalleryItem; sourceIndex: number }>
      >(null),
    fullscreenRef =
      useRef<
        FlatList<{ item: MarketplaceProductGalleryItem; sourceIndex: number }>
      >(null);
  const [fullscreen, setFullscreen] = useState(false);
  const player = useVideoPlayer(
    selected?.kind === "video" ? selected.url : null,
    (instance) => {
      instance.muted = true;
    },
  );
  const images = useMemo(
    () =>
      items.flatMap((item, sourceIndex) =>
        item.kind === "image" ? [{ item, sourceIndex }] : [],
      ),
    [items],
  );
  const thumbnailEntries = useMemo(() => {
    if (items.length <= 6)
      return items.map((item, sourceIndex) => ({ item, sourceIndex }));
    const start = Math.min(Math.max(selectedIndex - 2, 0), items.length - 5);
    return items
      .slice(start, start + 5)
      .map((item, offset) => ({ item, sourceIndex: start + offset }));
  }, [items, selectedIndex]);
  const hiddenThumbnailCount = Math.max(
    0,
    items.length - thumbnailEntries.length,
  );
  const fullscreenIndex = Math.max(
    0,
    images.findIndex((entry) => entry.sourceIndex === selectedIndex),
  );

  useEffect(() => {
    if (selected?.kind !== "video") player.pause();
  }, [player, selected?.kind]);
  useEffect(() => {
    if (!items.length || selectedIndex < 0 || selectedIndex >= items.length)
      return;
    heroRef.current?.scrollToOffset({
      offset: selectedIndex * galleryWidth,
      animated: false,
    });
    const thumbnailIndex = thumbnailEntries.findIndex(
      (entry) => entry.sourceIndex === selectedIndex,
    );
    if (thumbnailIndex >= 0)
      thumbnailRef.current?.scrollToIndex({
        index: thumbnailIndex,
        animated: true,
        viewPosition: 0.5,
      });
  }, [galleryWidth, items.length, selectedIndex, thumbnailEntries]);
  useEffect(() => {
    if (fullscreen && images.length)
      fullscreenRef.current?.scrollToOffset({
        offset: fullscreenIndex * viewportWidth,
        animated: false,
      });
  }, [fullscreen, fullscreenIndex, images.length, viewportWidth]);

  const selectFromScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!items.length) return;
    const index = Math.max(
      0,
      Math.min(
        items.length - 1,
        Math.round(event.nativeEvent.contentOffset.x / galleryWidth),
      ),
    );
    if (index !== selectedIndex) onSelect(index);
  };
  const selectFullscreen = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!images.length) return;
    const index = Math.max(
      0,
      Math.min(
        images.length - 1,
        Math.round(event.nativeEvent.contentOffset.x / viewportWidth),
      ),
    );
    if (images[index].sourceIndex !== selectedIndex)
      onSelect(images[index].sourceIndex);
  };
  const selectAdjacent = (direction: -1 | 1) => {
    const next = selectedIndex + direction;
    if (next >= 0 && next < items.length) onSelect(next);
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
            getItemLayout={(_, index) => ({
              length: galleryWidth,
              offset: galleryWidth * index,
              index,
            })}
            onMomentumScrollEnd={selectFromScroll}
            accessibilityLabel="Galería deslizable del producto"
            renderItem={({ item, index }) => (
              <View style={[styles.heroPage, { width: galleryWidth }]}>
                {item.kind === "video" && index === selectedIndex ? (
                  <VideoView
                    player={player}
                    style={styles.media}
                    nativeControls
                    contentFit="contain"
                    accessibilityLabel={`Video ${index + 1} del producto`}
                  />
                ) : item.kind === "video" ? (
                  <View style={[styles.media, styles.videoPage]}>
                    <MaterialIcons
                      name="play-circle-filled"
                      size={64}
                      color="#fff"
                    />
                    <Text style={styles.videoPageText}>Video del producto</Text>
                  </View>
                ) : (
                  <Pressable
                    style={styles.media}
                    onPress={() => setFullscreen(true)}
                    accessibilityRole="button"
                    accessibilityLabel={`Ampliar imagen ${index + 1} del producto`}
                  >
                    <Image
                      source={{ uri: item.url }}
                      style={styles.media}
                      contentFit="cover"
                      transition={180}
                    />
                    <View style={styles.expandHint}>
                      <MaterialIcons
                        name="zoom-out-map"
                        size={14}
                        color="#fff"
                      />
                      <Text style={styles.expandHintText}>
                        Toca para ampliar
                      </Text>
                    </View>
                  </Pressable>
                )}
              </View>
            )}
          />
        ) : (
          <View style={[styles.media, styles.empty]}>
            <View style={styles.emptyIcon}>
              <MaterialIcons
                name="image-not-supported"
                size={48}
                color={Colors.textSubtle}
              />
            </View>
            <Text style={styles.emptyText}>Imagen no disponible</Text>
          </View>
        )}
        {items.length > 1 ? (
          <>
            <Pressable
              style={[
                styles.arrow,
                styles.arrowLeft,
                selectedIndex === 0 && styles.arrowDisabled,
              ]}
              disabled={selectedIndex === 0}
              onPress={() => selectAdjacent(-1)}
              accessibilityRole="button"
              accessibilityLabel="Ver elemento anterior"
              accessibilityState={{ disabled: selectedIndex === 0 }}
            >
              <MaterialIcons name="chevron-left" size={31} color="#fff" />
            </Pressable>
            <Pressable
              style={[
                styles.arrow,
                styles.arrowRight,
                selectedIndex === items.length - 1 && styles.arrowDisabled,
              ]}
              disabled={selectedIndex === items.length - 1}
              onPress={() => selectAdjacent(1)}
              accessibilityRole="button"
              accessibilityLabel="Ver elemento siguiente"
              accessibilityState={{
                disabled: selectedIndex === items.length - 1,
              }}
            >
              <MaterialIcons name="chevron-right" size={31} color="#fff" />
            </Pressable>
          </>
        ) : null}
        {selected?.kind === "image" ? (
          <Pressable
            style={styles.expandButton}
            onPress={() => setFullscreen(true)}
            accessibilityRole="button"
            accessibilityLabel="Abrir imagen a pantalla completa"
          >
            <MaterialIcons name="fullscreen" size={24} color="#fff" />
          </Pressable>
        ) : null}
        {items.length ? (
          <View style={styles.count}>
            <Text style={styles.countText}>
              {Math.min(selectedIndex + 1, items.length)} / {items.length}
            </Text>
          </View>
        ) : null}
      </View>
      {items.length > 1 ? (
        <FlatList
          ref={thumbnailRef}
          horizontal
          data={thumbnailEntries}
          keyExtractor={(entry) =>
            `thumb-${entry.sourceIndex}-${entry.item.kind}-${entry.item.url}`
          }
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.thumbnails}
          getItemLayout={(_, index) => ({
            length: 76,
            offset: 76 * index,
            index,
          })}
          renderItem={({ item: entry }) => {
            const selectedThumbnail = entry.sourceIndex === selectedIndex;
            return (
              <Pressable
                onPress={() => onSelect(entry.sourceIndex)}
                accessibilityRole="button"
                accessibilityLabel={
                  entry.item.kind === "video"
                    ? "Seleccionar video del producto"
                    : `Seleccionar imagen ${entry.sourceIndex + 1}`
                }
                accessibilityState={{ selected: selectedThumbnail }}
                style={[
                  styles.thumbnail,
                  selectedThumbnail && styles.thumbnailSelected,
                ]}
              >
                {entry.item.kind === "image" ? (
                  <Image
                    source={{ uri: entry.item.url }}
                    style={styles.thumbnailMedia}
                    contentFit="cover"
                  />
                ) : (
                  <View style={[styles.thumbnailMedia, styles.videoThumbnail]}>
                    <MaterialIcons
                      name="play-circle-filled"
                      size={30}
                      color="#fff"
                    />
                    <Text style={styles.videoText}>Video</Text>
                  </View>
                )}
              </Pressable>
            );
          }}
          ListFooterComponent={
            hiddenThumbnailCount ? (
              <Pressable
                style={styles.moreMedia}
                onPress={() =>
                  onSelect(Math.min(items.length - 1, selectedIndex + 1))
                }
                accessibilityRole="button"
                accessibilityLabel={`Ver ${hiddenThumbnailCount} elementos adicionales`}
              >
                <Text style={styles.moreMediaCount}>
                  +{hiddenThumbnailCount}
                </Text>
                <Text style={styles.moreMediaText}>Ver más</Text>
              </Pressable>
            ) : null
          }
        />
      ) : null}
      {items.length > 1 ? (
        <View
          style={styles.dots}
          accessibilityLabel={`Elemento ${selectedIndex + 1} de ${items.length}`}
        >
          {items.map((_, index) => (
            <View
              key={`dot-${index}`}
              style={[
                styles.dot,
                index === selectedIndex && styles.dotSelected,
              ]}
            />
          ))}
        </View>
      ) : null}
      <Modal
        visible={fullscreen}
        transparent
        animationType="fade"
        onRequestClose={() => setFullscreen(false)}
      >
        <View style={styles.fullscreen}>
          <View
            style={[
              styles.fullscreenHeader,
              { paddingTop: insets.top + Spacing.xs },
            ]}
          >
            <Text style={styles.fullscreenCount}>
              {images.length ? `${fullscreenIndex + 1} / ${images.length}` : ""}
            </Text>
            <Pressable
              style={styles.closeButton}
              onPress={() => setFullscreen(false)}
              accessibilityRole="button"
              accessibilityLabel="Cerrar imagen ampliada"
            >
              <MaterialIcons name="close" size={26} color="#fff" />
            </Pressable>
          </View>
          <FlatList
            ref={fullscreenRef}
            horizontal
            pagingEnabled
            data={images}
            keyExtractor={(entry, index) => `full-${entry.item.url}-${index}`}
            showsHorizontalScrollIndicator={false}
            getItemLayout={(_, index) => ({
              length: viewportWidth,
              offset: viewportWidth * index,
              index,
            })}
            onMomentumScrollEnd={selectFullscreen}
            renderItem={({ item: entry, index }) => (
              <View
                style={[
                  styles.fullscreenPage,
                  { width: viewportWidth, paddingBottom: insets.bottom },
                ]}
              >
                <Image
                  source={{ uri: entry.item.url }}
                  style={styles.fullscreenImage}
                  contentFit="contain"
                  accessibilityLabel={`Imagen ampliada ${index + 1} de ${images.length}`}
                />
              </View>
            )}
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  gallery: { alignItems: "center", backgroundColor: Colors.bg, gap: 4 },
  stage: {
    aspectRatio: 1.62,
    maxHeight: 430,
    position: "relative",
    overflow: "hidden",
    borderRadius: Radius.lg,
    backgroundColor: "#17171D",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  heroPage: { height: "100%" },
  media: { width: "100%", height: "100%" },
  empty: { alignItems: "center", justifyContent: "center", gap: Spacing.sm },
  emptyIcon: {
    width: 82,
    height: 82,
    borderRadius: 41,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.surface,
  },
  emptyText: { color: Colors.textSecondary },
  videoPage: {
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    backgroundColor: "#11131A",
  },
  videoPageText: {
    color: Colors.textSecondary,
    fontWeight: FontWeight.semibold,
  },
  expandHint: {
    position: "absolute",
    left: "50%",
    bottom: Spacing.md,
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 13,
    borderRadius: Radius.full,
    backgroundColor: "rgba(14,14,18,.78)",
    transform: [{ translateX: -72 }],
  },
  expandHintText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: FontWeight.semibold,
  },
  expandButton: {
    position: "absolute",
    right: 12,
    top: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15,15,20,.58)",
  },
  count: {
    position: "absolute",
    right: 14,
    bottom: 14,
    minHeight: 34,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 13,
    borderRadius: Radius.full,
    backgroundColor: "rgba(10,10,14,.78)",
  },
  countText: { color: "#fff", fontSize: 12, fontWeight: FontWeight.bold },
  arrow: {
    position: "absolute",
    top: "50%",
    marginTop: -24,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(10,10,14,.62)",
  },
  arrowLeft: { left: 12 },
  arrowRight: { right: 12 },
  arrowDisabled: { opacity: 0.2 },
  thumbnails: {
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: 4,
  },
  thumbnail: {
    width: 68,
    height: 58,
    padding: 2,
    borderRadius: Radius.md,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: Colors.surface,
  },
  thumbnailSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryDim,
  },
  thumbnailMedia: { width: "100%", height: "100%", borderRadius: Radius.sm },
  videoThumbnail: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#171923",
  },
  videoText: { color: "#fff", fontSize: 9, fontWeight: FontWeight.bold },
  moreMedia: {
    width: 68,
    height: 58,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  moreMediaCount: {
    color: Colors.textPrimary,
    fontSize: 15,
    fontWeight: FontWeight.bold,
  },
  moreMediaText: { color: Colors.textSecondary, fontSize: 10 },
  dots: {
    minHeight: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.borderHighlight,
  },
  dotSelected: {
    backgroundColor: Colors.primary,
    transform: [{ scale: 1.14 }],
  },
  fullscreen: { flex: 1, backgroundColor: "#000" },
  fullscreenHeader: {
    position: "absolute",
    zIndex: 2,
    top: 0,
    left: 0,
    right: 0,
    minHeight: 64,
    paddingHorizontal: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(0,0,0,.45)",
  },
  fullscreenCount: { color: "#fff", fontWeight: FontWeight.bold },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,.14)",
  },
  fullscreenPage: { flex: 1, alignItems: "center", justifyContent: "center" },
  fullscreenImage: { width: "100%", height: "100%" },
});
