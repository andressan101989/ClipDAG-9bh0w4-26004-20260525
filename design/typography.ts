import type { TextStyle } from "react-native";

const style = (
  fontSize: number,
  lineHeight: number,
  fontWeight: TextStyle["fontWeight"],
  letterSpacing = 0,
): TextStyle => ({ fontSize, lineHeight, fontWeight, letterSpacing });
export const typography = {
  display: style(34, 40, "800", -0.8),
  headingLarge: style(28, 34, "800", -0.5),
  headingMedium: style(22, 28, "700", -0.25),
  headingSmall: style(18, 24, "700"),
  bodyLarge: style(17, 25, "400"),
  body: style(15, 22, "400"),
  bodySmall: style(13, 19, "400"),
  label: style(13, 17, "600", 0.1),
  labelStrong: style(14, 18, "700", 0.1),
  caption: style(11, 15, "500", 0.15),
  priceLarge: { ...style(26, 31, "800", -0.4), fontVariant: ["tabular-nums"] },
  price: { ...style(16, 21, "800"), fontVariant: ["tabular-nums"] },
  metric: { ...style(20, 25, "800", -0.25), fontVariant: ["tabular-nums"] },
} satisfies Record<string, TextStyle>;
export type TypographyVariant = keyof typeof typography;
