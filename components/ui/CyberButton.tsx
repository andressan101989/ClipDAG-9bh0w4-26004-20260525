/**
 * components/ui/CyberButton.tsx — v2 with microanimations + haptic feedback
 *
 * Changes vs v1:
 *   - Scale-down press animation (spring back on release)
 *   - expo-haptics light feedback on press
 *   - Shimmer/glow pulse animation on primary variant (1.5s loop)
 *   - Disabled state: reduced opacity + no animation
 *   - Loading state: preserves button dimensions, swaps to dots
 */

import React, { ReactNode, useRef, useEffect, useCallback, memo } from 'react';
import {
  Animated, Text, StyleSheet, Pressable,
  ActivityIndicator, type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { LoadingDots } from './SkeletonLoader';

let Haptics: any = null;
try { Haptics = require('expo-haptics'); } catch { /* optional */ }

interface CyberButtonProps {
  label:       string;
  onPress:     () => void;
  variant?:    'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?:       'sm' | 'md' | 'lg';
  disabled?:   boolean;
  loading?:    boolean;
  icon?:       ReactNode;
  style?:      ViewStyle;
  fullWidth?:  boolean;
}

export const CyberButton = memo(function CyberButton({
  label,
  onPress,
  variant   = 'primary',
  size      = 'md',
  disabled  = false,
  loading   = false,
  icon,
  style,
  fullWidth = false,
}: CyberButtonProps) {
  const scale     = useRef(new Animated.Value(1)).current;
  const glowAnim  = useRef(new Animated.Value(0)).current;

  // Glow pulse for primary variant
  useEffect(() => {
    if (variant !== 'primary' || disabled || loading) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0, duration: 1400, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [variant, disabled, loading]);

  const handlePressIn = useCallback(() => {
    Animated.spring(scale, { toValue: 0.94, useNativeDriver: true, speed: 60, bounciness: 2 }).start();
  }, []);

  const handlePressOut = useCallback(() => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 45, bounciness: 8 }).start();
  }, []);

  const handlePress = useCallback(() => {
    if (disabled || loading) return;
    try {
      Haptics?.impactAsync?.(Haptics?.ImpactFeedbackStyle?.Light);
    } catch { /* ignore */ }
    onPress();
  }, [disabled, loading, onPress]);

  const height   = size === 'sm' ? 36 : size === 'md' ? 48 : 56;
  const fontSize = size === 'sm' ? FontSize.sm : size === 'md' ? FontSize.md : FontSize.lg;
  const px       = size === 'sm' ? Spacing.md : size === 'md' ? Spacing.lg : Spacing.xl;

  const isGradient = variant === 'primary' || variant === 'secondary';
  const isInteractive = !disabled && !loading;

  const wrapStyle: ViewStyle = {
    alignSelf: fullWidth ? 'stretch' : 'auto',
    opacity:   disabled ? 0.5 : 1,
    ...(style ?? {}),
  };

  if (isGradient) {
    const gradColors: [string, string] = variant === 'primary'
      ? ['#00D4FF', '#0066FF']
      : ['#FF2D55', '#FF6B8A'];

    const glowOpacity = variant === 'primary'
      ? glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.3] })
      : new Animated.Value(0);

    return (
      <Pressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled || loading}
        style={wrapStyle}
        accessible
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: disabled || loading, busy: loading }}
      >
        <Animated.View style={{ transform: [{ scale }] }}>
          <LinearGradient
            colors={disabled ? ['#333', '#333'] : gradColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.base, { height, paddingHorizontal: px }]}
          >
            {/* Glow overlay */}
            {variant === 'primary' && !disabled && !loading ? (
              <Animated.View
                style={[
                  StyleSheet.absoluteFillObject,
                  { backgroundColor: '#fff', opacity: glowOpacity, borderRadius: Radius.md },
                ]}
                pointerEvents="none"
              />
            ) : null}

            {loading ? (
              <LoadingDots color="rgba(255,255,255,0.8)" size={7} />
            ) : (
              <>
                {icon}
                <Text style={[styles.labelGradient, { fontSize }]}>{label}</Text>
              </>
            )}
          </LinearGradient>
        </Animated.View>
      </Pressable>
    );
  }

  // Outline / ghost / danger
  const outlineColors = {
    outline: { border: Colors.primary,    text: Colors.primary,       bg: 'transparent' as const },
    ghost:   { border: 'transparent',     text: Colors.textSecondary, bg: 'transparent' as const },
    danger:  { border: Colors.error,      text: Colors.error,         bg: Colors.secondaryDim },
  };
  const c = outlineColors[variant as 'outline' | 'ghost' | 'danger'];

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled || loading}
      style={wrapStyle}
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
    >
      <Animated.View
        style={[
          styles.base,
          {
            height,
            paddingHorizontal: px,
            borderColor:       c.border,
            borderWidth:       variant === 'outline' ? 1 : 0,
            backgroundColor:   c.bg,
            transform:         [{ scale }],
          },
        ]}
      >
        {loading ? (
          <LoadingDots color={c.text + 'bb'} size={7} />
        ) : (
          <>
            {icon}
            <Text style={[styles.label, { fontSize, color: c.text }]}>{label}</Text>
          </>
        )}
      </Animated.View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  base: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    borderRadius:    Radius.md,
    gap:             Spacing.sm,
    overflow:        'hidden',
  },
  label: {
    fontWeight: FontWeight.semibold,
  },
  labelGradient: {
    color:      '#FFFFFF',
    fontWeight: FontWeight.semibold,
  },
});
