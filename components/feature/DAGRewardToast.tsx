/**
 * components/feature/DAGRewardToast.tsx — v2 with enhanced microanimations
 *
 * Changes vs v1:
 *   - Scale pop-in (spring) + slide-up entry
 *   - Particle sparkle burst animation (3 flying ◈ symbols)
 *   - Glow pulse during visible phase
 *   - Smooth slide-up + fade-out exit
 */

import React, { useEffect, useRef, useState, memo } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';

interface DAGRewardToastProps {
  visible: boolean;
  amount:  number;
  onHide:  () => void;
}

// ── Sparkle particle ──────────────────────────────────────────────────────────

interface SparkleProps {
  dx: number;
  dy: number;
  delay: number;
}

const Sparkle = memo(function Sparkle({ dx, dy, delay }: SparkleProps) {
  const x       = useRef(new Animated.Value(0)).current;
  const y       = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const scale   = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(x,       { toValue: dx, duration: 600, useNativeDriver: true }),
        Animated.timing(y,       { toValue: dy, duration: 600, useNativeDriver: true }),
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1, duration: 120,    useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: 480,    useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.spring(scale, { toValue: 1.4, useNativeDriver: true, speed: 40, bounciness: 10 }),
          Animated.timing(scale, { toValue: 0.5, duration: 300,    useNativeDriver: true }),
        ]),
      ]).start();
    }, delay);
    return () => clearTimeout(t);
  }, [dx, dy, delay]);

  return (
    <Animated.Text
      style={[
        sp.particle,
        { opacity, transform: [{ translateX: x }, { translateY: y }, { scale }] },
      ]}
    >
      ◈
    </Animated.Text>
  );
});

const sp = StyleSheet.create({
  particle: {
    position: 'absolute',
    color:    Colors.primary,
    fontSize: 11,
    fontWeight: FontWeight.bold,
  },
});

const SPARKLES: SparkleProps[] = [
  { dx: -28, dy: -22, delay: 0   },
  { dx:  32, dy: -18, delay: 60  },
  { dx:   4, dy: -32, delay: 120 },
  { dx: -20, dy: -30, delay: 30  },
  { dx:  24, dy: -28, delay: 90  },
];

// ── Main Toast ────────────────────────────────────────────────────────────────

export const DAGRewardToast = memo(function DAGRewardToast({
  visible, amount, onHide,
}: DAGRewardToastProps) {
  const opacity    = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(24)).current;
  const scale      = useRef(new Animated.Value(0.7)).current;
  const glowAnim   = useRef(new Animated.Value(0)).current;
  const [render,   setRender] = useState(false);
  const [showSpark, setShowSpark] = useState(false);

  useEffect(() => {
    if (visible) {
      setRender(true);
      setShowSpark(false);
      // Reset
      opacity.setValue(0); translateY.setValue(24); scale.setValue(0.7);

      // Entry: pop in + slide up
      Animated.parallel([
        Animated.timing(opacity,    { toValue: 1, duration: 220,             useNativeDriver: true }),
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, speed: 28, bounciness: 14 }),
        Animated.spring(scale,      { toValue: 1, useNativeDriver: true, speed: 28, bounciness: 14 }),
      ]).start(() => {
        setShowSpark(true);
        // Glow pulse
        Animated.loop(
          Animated.sequence([
            Animated.timing(glowAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
            Animated.timing(glowAnim, { toValue: 0, duration: 700, useNativeDriver: true }),
          ]),
          { iterations: 3 },
        ).start();
      });

      const timer = setTimeout(() => {
        setShowSpark(false);
        Animated.parallel([
          Animated.timing(opacity,    { toValue: 0, duration: 280, useNativeDriver: true }),
          Animated.timing(translateY, { toValue: -16, duration: 280, useNativeDriver: true }),
          Animated.timing(scale,      { toValue: 0.85, duration: 280, useNativeDriver: true }),
        ]).start(() => { setRender(false); onHide(); });
      }, 2_200);

      return () => clearTimeout(timer);
    } else {
      setRender(false);
    }
  }, [visible]);

  if (!render) return null;

  const glowOpacity = glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.25] });

  return (
    <Animated.View
      style={[
        t.wrap,
        { opacity, transform: [{ translateY }, { scale }] },
      ]}
      pointerEvents="none"
    >
      {/* Sparkle particles */}
      {showSpark ? SPARKLES.map((sp, i) => (
        <Sparkle key={i} dx={sp.dx} dy={sp.dy} delay={sp.delay} />
      )) : null}

      <LinearGradient
        colors={['rgba(0,212,255,0.18)', 'rgba(0,102,255,0.12)']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={t.pill}
      >
        {/* Glow overlay */}
        <Animated.View
          style={[StyleSheet.absoluteFillObject, { backgroundColor: Colors.primary, opacity: glowOpacity, borderRadius: Radius.full }]}
          pointerEvents="none"
        />
        <Text style={t.icon}>◈</Text>
        <Text style={t.text}>+{amount.toFixed(2)} $DAG al creador</Text>
      </LinearGradient>
    </Animated.View>
  );
});

const t = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 118,
    alignSelf: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.primary + '88',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    overflow: 'hidden',
  },
  icon: { color: Colors.primaryLight, fontSize: FontSize.md },
  text: { color: Colors.primaryLight, fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
});
