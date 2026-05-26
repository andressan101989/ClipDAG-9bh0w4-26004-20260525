/**
 * components/ui/SkeletonLoader.tsx — Animated skeleton loading placeholders
 *
 * Provides shimmer-pulsing skeleton placeholders for:
 *   - Feed cards (video reel, post, carousel)
 *   - Profile grid items
 *   - User list rows
 *   - Generic content blocks
 *
 * Uses Animated.Value shimmer cycling at 1.2s for smooth perceived performance.
 */

import React, { useEffect, useRef, memo } from 'react';
import { View, Animated, StyleSheet, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const { width: SCREEN_W } = Dimensions.get('window');

// ── Base skeleton bone ─────────────────────────────────────────────────────────

interface BoneProps {
  width:       number | string;
  height:      number;
  borderRadius?: number;
  style?:      any;
}

function Bone({ width, height, borderRadius = 8, style }: BoneProps) {
  return (
    <View
      style={[
        { width: width as any, height, borderRadius, backgroundColor: 'rgba(255,255,255,0.07)', overflow: 'hidden' },
        style,
      ]}
    />
  );
}

// ── Shimmer wrapper ────────────────────────────────────────────────────────────

interface ShimmerProps {
  children: React.ReactNode;
}

function Shimmer({ children }: ShimmerProps) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] });

  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

// ── Feed Reel Skeleton ────────────────────────────────────────────────────────

export const FeedReelSkeleton = memo(function FeedReelSkeleton() {
  return (
    <Shimmer>
      <View style={sk.reelContainer}>
        {/* Video area */}
        <View style={sk.reelVideo} />
        {/* Bottom info */}
        <View style={sk.reelBottom}>
          <View style={sk.reelLeft}>
            <Bone width={40} height={40} borderRadius={20} />
            <Bone width={120} height={12} borderRadius={6} style={{ marginTop: 6 }} />
            <Bone width={180} height={10} borderRadius={5} style={{ marginTop: 6 }} />
            <Bone width={100} height={8} borderRadius={4} style={{ marginTop: 6 }} />
          </View>
          <View style={sk.reelActions}>
            {[1, 2, 3, 4].map(i => <Bone key={i} width={40} height={40} borderRadius={20} />)}
          </View>
        </View>
      </View>
    </Shimmer>
  );
});

// ── Post Card Skeleton ────────────────────────────────────────────────────────

export const PostCardSkeleton = memo(function PostCardSkeleton() {
  return (
    <Shimmer>
      <View style={sk.postCard}>
        {/* Header */}
        <View style={sk.postHeader}>
          <Bone width={42} height={42} borderRadius={21} />
          <View style={{ flex: 1, gap: 6, marginLeft: 10 }}>
            <Bone width={120} height={11} borderRadius={5} />
            <Bone width={80}  height={9}  borderRadius={4} />
          </View>
          <Bone width={60} height={28} borderRadius={14} />
        </View>
        {/* Image */}
        <Bone width={SCREEN_W} height={SCREEN_W} borderRadius={0} />
        {/* Actions */}
        <View style={sk.postActions}>
          <View style={{ flexDirection: 'row', gap: 16 }}>
            {[1, 2, 3].map(i => <Bone key={i} width={26} height={26} borderRadius={13} />)}
          </View>
          <Bone width={26} height={26} borderRadius={13} />
        </View>
        {/* Caption */}
        <View style={{ paddingHorizontal: 16, gap: 8, marginBottom: 12 }}>
          <Bone width={80} height={10} borderRadius={4} />
          <Bone width={SCREEN_W - 80} height={10} borderRadius={4} />
          <Bone width={SCREEN_W - 120} height={10} borderRadius={4} />
        </View>
      </View>
    </Shimmer>
  );
});

// ── Profile Grid Skeleton ─────────────────────────────────────────────────────

const THUMB = (SCREEN_W - 4) / 3;

export const ProfileGridSkeleton = memo(function ProfileGridSkeleton() {
  return (
    <Shimmer>
      <View style={sk.grid}>
        {Array.from({ length: 9 }).map((_, i) => (
          <Bone key={i} width={THUMB} height={THUMB * 1.25} borderRadius={0} />
        ))}
      </View>
    </Shimmer>
  );
});

// ── User Row Skeleton ─────────────────────────────────────────────────────────

export const UserRowSkeleton = memo(function UserRowSkeleton() {
  return (
    <Shimmer>
      <View style={sk.userRow}>
        <Bone width={44} height={44} borderRadius={22} />
        <View style={{ flex: 1, gap: 7, marginLeft: 12 }}>
          <Bone width={140} height={11} borderRadius={5} />
          <Bone width={100} height={9}  borderRadius={4} />
        </View>
        <Bone width={72} height={32} borderRadius={16} />
      </View>
    </Shimmer>
  );
});

// ── Generic Content Block Skeleton ───────────────────────────────────────────

interface ContentSkeletonProps {
  rows?:   number;
  header?: boolean;
}

// Pre-computed widths — Math.random() must never be called during render
// because it produces a different value on every re-render cycle.
const CONTENT_ROW_WIDTHS = ['92%', '86%', '98%', '79%', '90%', '84%', '95%'] as const;

export const ContentSkeleton = memo(function ContentSkeleton({ rows = 3, header = true }: ContentSkeletonProps) {
  return (
    <Shimmer>
      <View style={sk.contentBlock}>
        {header ? <Bone width={160} height={14} borderRadius={6} style={{ marginBottom: 12 }} /> : null}
        {Array.from({ length: rows }).map((_, i) => (
          <Bone
            key={i}
            width={CONTENT_ROW_WIDTHS[i % CONTENT_ROW_WIDTHS.length] as any}
            height={11}
            borderRadius={5}
            style={{ marginBottom: 8 }}
          />
        ))}
      </View>
    </Shimmer>
  );
});

// ── Loading Dots ──────────────────────────────────────────────────────────────

export const LoadingDots = memo(function LoadingDots({ color = 'rgba(255,255,255,0.6)', size = 8 }: { color?: string; size?: number }) {
  // Hooks must be called unconditionally at the top level — never inside arrays
  const anim0 = useRef(new Animated.Value(0)).current;
  const anim1 = useRef(new Animated.Value(0)).current;
  const anim2 = useRef(new Animated.Value(0)).current;
  const anims = [anim0, anim1, anim2];

  useEffect(() => {
    const createAnim = (anim: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration: 400, useNativeDriver: true }),
          Animated.delay(400),
        ])
      );
    const a0 = createAnim(anims[0], 0);
    const a1 = createAnim(anims[1], 180);
    const a2 = createAnim(anims[2], 360);
    a0.start(); a1.start(); a2.start();
    return () => { a0.stop(); a1.stop(); a2.stop(); };
  }, []);

  return (
    <View style={{ flexDirection: 'row', gap: size * 0.6, alignItems: 'center' }}>
      {anims.map((anim, i) => (
        <Animated.View
          key={i}
          style={{
            width: size, height: size, borderRadius: size / 2,
            backgroundColor: color,
            opacity: anim,
            transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.2] }) }],
          }}
        />
      ))}
    </View>
  );
});

// ── Fade-in wrapper ───────────────────────────────────────────────────────────

interface FadeInProps {
  children:   React.ReactNode;
  delay?:     number;
  duration?:  number;
  style?:     any;
}

export const FadeIn = memo(function FadeIn({ children, delay = 0, duration = 300, style }: FadeInProps) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.timing(opacity, { toValue: 1, duration, useNativeDriver: true }).start();
    }, delay);
    return () => clearTimeout(t);
  }, [delay, duration]);

  return <Animated.View style={[{ opacity }, style]}>{children}</Animated.View>;
});

// ── Slide-up wrapper ──────────────────────────────────────────────────────────

interface SlideUpProps {
  children:   React.ReactNode;
  delay?:     number;
  distance?:  number;
  style?:     any;
}

export const SlideUp = memo(function SlideUp({ children, delay = 0, distance = 20, style }: SlideUpProps) {
  const translateY = useRef(new Animated.Value(distance)).current;
  const opacity    = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, speed: 18, bounciness: 4 }),
        Animated.timing(opacity,    { toValue: 1, duration: 250,          useNativeDriver: true }),
      ]).start();
    }, delay);
    return () => clearTimeout(t);
  }, [delay]);

  return (
    <Animated.View style={[{ opacity, transform: [{ translateY }] }, style]}>
      {children}
    </Animated.View>
  );
});

// ── Styles ────────────────────────────────────────────────────────────────────

const sk = StyleSheet.create({
  reelContainer: { width: SCREEN_W, height: 200, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 0, overflow: 'hidden', position: 'relative' },
  reelVideo:     { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.05)' },
  reelBottom:    { position: 'absolute', bottom: 16, left: 16, right: 16, flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  reelLeft:      { flex: 1, gap: 4 },
  reelActions:   { gap: 16, alignItems: 'center' },

  postCard: { backgroundColor: 'rgba(255,255,255,0.02)', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)', paddingBottom: 8 },
  postHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 },
  postActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 2 },

  userRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },

  contentBlock: { padding: 16 },
});
