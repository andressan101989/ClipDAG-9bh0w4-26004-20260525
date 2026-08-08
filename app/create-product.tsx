import React, { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Colors } from "@/constants/theme";
export default function CreateProductEntry() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/seller/product-editor/new" as never);
  }, [router]);
  return (
    <View style={s.root}>
      <ActivityIndicator color={Colors.primary} />
      <Text style={s.text}>Preparando tu borrador...</Text>
    </View>
  );
}
const s = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: Colors.bg,
  },
  text: { color: Colors.textSecondary },
});
