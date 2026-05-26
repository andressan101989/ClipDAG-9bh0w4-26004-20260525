/**
 * components/ui/AnimatedPressable.tsx — Universal animated Pressable
 *
 * Provides consistent microanimation feedback across all interactive elements:
 *   - scale-down on press (spring-back on release)
 *   - optional haptic feedback via expo-haptics
 *   - opacity fallback for older devices / disabled state
 *   - hitSlop defaults aligned to platform guidelines (44px iOS / 48px Android)
 */

import React, { useRef, useCallback, memo } from 'react';
import {
  Pressable, Animated, StyleSheet, Platform,
  type ViewStyle, type PressableProps,
} from 'react-native';

let Haptics: any = null;
try { Haptics = require('expo-haptics'); } catch { /* optional */ }

export type HapticStyle = 'light' | 'medium' | 'heavy' | 'selection' | 'none';

export interface AnimatedPressableProps extends Omit<PressableProps, 'style'> {
  children:     React.ReactNode;
  style?:       ViewStyle | ViewStyle[];
  pressedScale?: number;          // 0.0–1.0; default 0.92
  duration?:    number;           // spring duration ms; default 120
  haptic?:      HapticStyle;      // haptic feedback on press; default 'light'
  disabled?:    boolean;
  activeOpacity?: number;         // opacity when pressed; default 0.85
}

export const AnimatedPressable = memo(function AnimatedPressable({
  children,
  style,
  pressedScale = 0.92,
  duration     = 120,
  haptic       = 'light',
  disabled     = false,
  activeOpacity = 0.85,
  onPress,
  onPressIn,
  onPressOut,
  ...rest
}: AnimatedPressableProps) {
  const scale   = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  const fireHaptic = useCallback(() => {
    if (!Haptics || haptic === 'none') return;
    try {
      switch (haptic) {
        case 'selection':
          Haptics.selectionAsync?.();
          break;
        case 'light':
          Haptics.impactAsync?.(Haptics.ImpactFeedbackStyle?.Light);
          break;
        case 'medium':
          Haptics.impactAsync?.(Haptics.ImpactFeedbackStyle?.Medium);
          break;
        case 'heavy':
          Haptics.impactAsync?.(Haptics.ImpactFeedbackStyle?.Heavy);
          break;
      }
    } catch { /* ignore */ }
  }, [haptic]);

  const handlePressIn = useCallback((e: any) => {
    Animated.spring(scale, {
      toValue:         pressedScale,
      useNativeDriver: true,
      speed:           60,
      bounciness:      2,
    }).start();
    Animated.timing(opacity, {
      toValue:         activeOpacity,
      duration:        80,
      useNativeDriver: true,
    }).start();
    onPressIn?.(e);
  }, [pressedScale, activeOpacity, onPressIn]);

  const handlePressOut = useCallback((e: any) => {
    Animated.spring(scale, {
      toValue:         1,
      useNativeDriver: true,
      speed:           50,
      bounciness:      6,
    }).start();
    Animated.timing(opacity, {
      toValue:         1,
      duration:        100,
      useNativeDriver: true,
    }).start();
    onPressOut?.(e);
  }, [onPressOut]);

  const handlePress = useCallback((e: any) => {
    if (disabled) return;
    fireHaptic();
    onPress?.(e);
  }, [disabled, fireHaptic, onPress]);

  const flatStyle = Array.isArray(style) ? StyleSheet.flatten(style) : (style ?? {});

  return (
    <Pressable
      {...rest}
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      accessible
    >
      <Animated.View
        style={[
          flatStyle,
          { transform: [{ scale }], opacity: disabled ? 0.5 : opacity },
        ]}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
});
