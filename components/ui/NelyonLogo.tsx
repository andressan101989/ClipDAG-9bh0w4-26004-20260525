import { Image, type ImageStyle } from 'expo-image';
import type { StyleProp } from 'react-native';

type NelyonLogoProps = {
  onDark?: boolean;
  style?: StyleProp<ImageStyle>;
};

const logo = require('@/assets/branding/nelyon/v1/nelyon-wordmark.png');
const logoOnDark = require('@/assets/branding/nelyon/v1/nelyon-wordmark-on-dark.png');

export function NelyonLogo({ onDark = false, style }: NelyonLogoProps) {
  return (
    <Image
      accessibilityLabel="Nelyon"
      contentFit="contain"
      source={onDark ? logoOnDark : logo}
      style={style}
    />
  );
}
