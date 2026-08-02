import React from "react";
import { Text, type TextProps } from "react-native";
import {
  colors,
  typography,
  type OnSpaceColor,
  type TypographyVariant,
} from "@/design";

export interface OnSpaceTextProps extends TextProps {
  variant?: TypographyVariant;
  color?: OnSpaceColor;
}

export function OnSpaceText({
  variant = "body",
  color = "textPrimary",
  style,
  maxFontSizeMultiplier = 1.5,
  ...props
}: OnSpaceTextProps) {
  return (
    <Text
      {...props}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[typography[variant], { color: colors[color] }, style]}
    />
  );
}
