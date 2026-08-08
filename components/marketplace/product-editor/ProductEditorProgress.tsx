import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Colors, Radius } from "@/constants/theme";
export const PRODUCT_EDITOR_STEPS = [
  "Informacion",
  "Fotos y video",
  "Precio e inventario",
  "Variantes",
  "Envio",
  "Vista previa",
] as const;
export function ProductEditorProgress({ step }: { step: number }) {
  return (
    <View style={s.wrap}>
      <View style={s.track}>
        <View
          style={[
            s.fill,
            { width: `${((step + 1) / PRODUCT_EDITOR_STEPS.length) * 100}%` },
          ]}
        />
      </View>
      <Text style={s.caption}>
        {step + 1} de 6 / {PRODUCT_EDITOR_STEPS[step]}
      </Text>
    </View>
  );
}
const s = StyleSheet.create({
  wrap: { gap: 8 },
  track: {
    height: 6,
    borderRadius: Radius.full,
    backgroundColor: Colors.border,
    overflow: "hidden",
  },
  fill: { height: 6, backgroundColor: Colors.primary },
  caption: { color: Colors.textSecondary, fontSize: 13, fontWeight: "600" },
});
