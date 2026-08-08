import React, { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Colors } from "@/constants/theme";
export default function LegacyProductEdit() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    router = useRouter();
  useEffect(() => {
    if (id) router.replace(`/seller/product-editor/${id}` as never);
  }, [id, router]);
  return (
    <View style={s.root}>
      <ActivityIndicator color={Colors.primary} />
    </View>
  );
}
const s = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.bg,
  },
});
