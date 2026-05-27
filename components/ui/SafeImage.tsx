/**
 * components/ui/SafeImage.tsx — Drop-in replacement for expo-image's Image
 *
 * Problem: expo-image v2+ throws "native only [Image]" when rendered in
 * environments that don't bundle the expo-image native module
 * (OnSpace App preview, Expo Go, CI, web).
 *
 * Solution: try-require expo-image at module load time (one-time cost).
 * If it's unavailable, fall back to React Native's built-in Image.
 *
 * Usage — identical to expo-image:
 *   import { Image } from '@/components/ui/SafeImage';
 *   <Image source={{ uri }} contentFit="cover" transition={200} />
 */

import React from 'react';
import {
  Image as RNImage,
  ImageStyle,
  StyleProp,
  ImageResizeMode,
} from 'react-native';

// ── One-time try-require (result is cached by Metro's module registry) ────────
let ExpoImageComponent: React.ComponentType<any> | null = null;
try {
  const mod = require('expo-image');
  const candidate = mod?.Image ?? mod?.default?.Image ?? mod?.default;
  if (candidate && typeof candidate === 'function') {
    ExpoImageComponent = candidate;
  }
} catch {
  /* expo-image native module not available in this environment */
}

// ── ContentFit → RN ResizeMode mapping ───────────────────────────────────────
function toResizeMode(contentFit?: string): ImageResizeMode {
  switch (contentFit) {
    case 'contain':    return 'contain';
    case 'fill':       return 'stretch';
    case 'none':       return 'center';
    case 'scale-down': return 'contain';
    case 'cover':
    default:           return 'cover';
  }
}

// ── Public props interface (superset of both expo-image and RN Image) ─────────
export interface SafeImageProps {
  source: any;
  style?: StyleProp<ImageStyle>;
  contentFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
  /** expo-image transition duration (ignored on RN fallback) */
  transition?: number | { duration?: number };
  placeholder?: any;
  blurhash?: string;
  onLoad?: (e: any) => void;
  onError?: (e?: any) => void;
  /** Allow any other expo-image props */
  [key: string]: any;
}

/**
 * Safe Image — renders expo-image when available, otherwise RN's Image.
 * Exported both as named `Image` (drop-in) and default export.
 */
export const Image = React.memo(function SafeImage({
  source,
  style,
  contentFit = 'cover',
  transition,
  placeholder,
  blurhash,
  onLoad,
  onError,
  ...rest
}: SafeImageProps) {
  if (ExpoImageComponent) {
    const EI = ExpoImageComponent;
    return (
      <EI
        source={source}
        style={style}
        contentFit={contentFit}
        transition={transition}
        placeholder={placeholder}
        blurhash={blurhash}
        onLoad={onLoad}
        onError={onError}
        {...rest}
      />
    );
  }

  // ── React Native Image fallback ───────────────────────────────────────────
  const resizeMode = toResizeMode(contentFit);
  // Strip expo-image-specific props that RN Image doesn't understand
  const {
    contentPosition: _cp,
    responsivePolicy: _rp,
    cachePolicy: _cache,
    recyclingKey: _rk,
    ...rnRest
  } = rest;

  return (
    <RNImage
      source={source}
      style={style as any}
      resizeMode={resizeMode}
      onLoad={onLoad as any}
      onError={onError as any}
      {...rnRest}
    />
  );
});

export default Image;
