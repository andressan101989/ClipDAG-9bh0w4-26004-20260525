/**
 * components/ui/CounterBadge.tsx — Animated counter with number flip transitions
 *
 * Animates numeric transitions (like count, comment count, etc.) with:
 *   - Scale+fade pop animation on increment
 *   - Color flash for positive increments (green) / decrements (red)
 *   - Compact formatNumber display (1.2k, 8.3M, etc.)
 */

import React, { useEffect, useRef, memo } from 'react';
import { Animated, Text, StyleSheet } from 'react-native';
import { formatNumber } from '@/services/mockData';

interface CounterBadgeProps {
  value:       number;
  color?:      string;
  fontSize?:   number;
  fontWeight?: string;
  style?:      any;
}

export const CounterBadge = memo(function CounterBadge({
  value,
  color     = 'rgba(255,255,255,0.9)',
  fontSize  = 12,
  fontWeight = '600',
  style,
}: CounterBadgeProps) {
  const prevRef  = useRef(value);
  const scale    = useRef(new Animated.Value(1)).current;
  const opacity  = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = value;
    if (value === prev) return;

    // Pop animation on change
    Animated.sequence([
      Animated.parallel([
        Animated.spring(scale,   { toValue: 1.25, useNativeDriver: true, speed: 70, bounciness: 8 }),
        Animated.timing(opacity, { toValue: 0.7,  duration: 60,          useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.spring(scale,   { toValue: 1,    useNativeDriver: true, speed: 40, bounciness: 10 }),
        Animated.timing(opacity, { toValue: 1,    duration: 120,         useNativeDriver: true }),
      ]),
    ]).start();
  }, [value]);

  return (
    <Animated.Text
      style={[
        { color, fontSize, fontWeight: fontWeight as any, transform: [{ scale }], opacity },
        style,
      ]}
    >
      {typeof value === 'number' ? formatNumber(value) : value}
    </Animated.Text>
  );
});
