import React from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Colors, Radius } from "@/constants/theme";
import type { ProductEditorMedia } from "@/services/marketplaceProductDraftService";
export function ProductMediaTile({
  item,
  onCover,
  onRemove,
  onMoveLeft,
  onMoveRight,
  onRetry,
}: {
  item: ProductEditorMedia;
  onCover?: () => void;
  onRemove: () => void;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  onRetry?: () => void;
}) {
  return (
    <View style={s.tile}>
      {item.kind === "image" ? (
        <Image source={{ uri: item.url }} style={s.image} />
      ) : (
        <View style={[s.image, s.video]}>
          <Text style={s.videoText}>
            VIDEO
            {item.durationMs ? `\n${Math.ceil(item.durationMs / 1000)}s` : ""}
          </Text>
        </View>
      )}
      {item.state === "uploading" ? (
        <View style={s.overlay}>
          <ActivityIndicator color="#fff" />
          <Text style={s.white}>Subiendo...</Text>
        </View>
      ) : null}
      {item.state === "failed" ? (
        <View style={s.overlay}>
          <Text style={s.white}>No pudimos subir este archivo.</Text>
        </View>
      ) : null}
      {item.isCover ? <Text style={s.cover}>Portada</Text> : null}
      <View style={s.actions}>
        {item.state === "failed" && onRetry ? (
          <Pressable onPress={onRetry}>
            <Text style={s.action}>Reintentar</Text>
          </Pressable>
        ) : null}
        {onMoveLeft ? (
          <Pressable onPress={onMoveLeft}>
            <Text style={s.action}>←</Text>
          </Pressable>
        ) : null}
        {onCover && !item.isCover ? (
          <Pressable onPress={onCover}>
            <Text style={s.action}>Portada</Text>
          </Pressable>
        ) : null}
        {onMoveRight ? (
          <Pressable onPress={onMoveRight}>
            <Text style={s.action}>→</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onRemove}>
          <Text style={[s.action, s.remove]}>Eliminar</Text>
        </Pressable>
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  tile: {
    width: "48%",
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
    backgroundColor: Colors.surface,
  },
  image: {
    width: "100%",
    aspectRatio: 1,
    backgroundColor: Colors.surfaceElevated,
  },
  video: { alignItems: "center", justifyContent: "center" },
  videoText: {
    color: Colors.primaryLight,
    textAlign: "center",
    fontWeight: "800",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,.7)",
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
  },
  white: { color: "#fff", textAlign: "center" },
  cover: {
    position: "absolute",
    top: 6,
    left: 6,
    backgroundColor: Colors.primary,
    color: "#fff",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    fontSize: 11,
    fontWeight: "800",
  },
  actions: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: 5,
  },
  action: { color: Colors.primaryLight, fontWeight: "700", fontSize: 12 },
  remove: { color: Colors.error },
});
