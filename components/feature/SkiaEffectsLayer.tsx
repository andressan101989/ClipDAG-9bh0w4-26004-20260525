/**
 * components/feature/SkiaEffectsLayer.tsx  — v3
 *
 * iOS-safe rewrite:
 *  - Removed useClockValue / useDerivedValue (Skia v0.x API, removed in v1+)
 *  - All animations use Reanimated 3 SharedValues via useSharedValue/useAnimatedStyle
 *  - No hook calls inside .map() — pre-computed particle arrays
 *  - ColorMatrix applied via Skia ColorMatrix + Fill pattern (v1+ compatible)
 *  - Falls back to Reanimated overlay when Skia not available
 */

import React, { useEffect, useMemo } from 'react';

// ── Lazy-load Skia ────────────────────────────────────────────────────────────
let SkiaAvailable = false;
let SkiaCanvas: any  = null;
let SkiaFill: any    = null;
let SkiaColorMatrix: any = null;

try {
  const skia = require('@shopify/react-native-skia');
  // v1+ API surface
  SkiaCanvas      = skia.Canvas      ?? null;
  SkiaFill        = skia.Fill        ?? null;
  SkiaColorMatrix = skia.ColorMatrix ?? null;
  if (SkiaCanvas && SkiaFill) SkiaAvailable = true;
} catch {
  // Not compiled in — Reanimated fallback
}

import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming,
  withSequence, Easing,
} from 'react-native-reanimated';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

// ─────────────────────────────────────────────────────────────────────────────
export type SkiaEffectId =
  | 'none'
  | 'particles'
  | 'glow'
  | 'glitch'
  | 'starfield'
  | 'hearts'
  | 'rain'
  | 'vintage'
  | 'cine'
  | 'frio'
  | 'calido'
  | 'bn'
  | 'neon'
  | 'chromatic'
  | 'bokeh'
  | 'beauty';

interface Props {
  effectId: SkiaEffectId;
  width:    number;
  height:   number;
}

// ─────────────────────────────────────────────────────────────────────────────
// SKIA COLOR MATRIX CONFIGS  (5×4 row-major)
// ─────────────────────────────────────────────────────────────────────────────
const COLOR_MATRICES: Partial<Record<SkiaEffectId, number[]>> = {
  vintage: [
    0.9,  0.15, 0.10, 0, 0.05,
    0.10, 0.80, 0.10, 0, 0.02,
    0.10, 0.05, 0.60, 0, 0.00,
    0,    0,    0,    1, 0,
  ],
  cine: [
    0.70, 0.15, 0.05, 0, -0.03,
    0.10, 0.75, 0.08, 0,  0.00,
    0.10, 0.18, 0.85, 0,  0.02,
    0,    0,    0,    1,  0,
  ],
  frio: [
    0.80, 0.05, 0.05, 0, 0,
    0.05, 0.85, 0.10, 0, 0,
    0.10, 0.10, 1.10, 0, 0,
    0,    0,    0,    1, 0,
  ],
  calido: [
    1.15, 0.10, 0.00, 0, 0.03,
    0.05, 0.90, 0.05, 0, 0.01,
    0.00, 0.02, 0.75, 0, 0.00,
    0,    0,    0,    1, 0,
  ],
  bn: [
    0.299, 0.587, 0.114, 0, 0,
    0.299, 0.587, 0.114, 0, 0,
    0.299, 0.587, 0.114, 0, 0,
    0,     0,     0,     1, 0,
  ],
  neon: [
    1.30, -0.20, 0.10, 0, 0.05,
    -0.10, 1.10, 0.10, 0, 0.00,
    0.20, -0.10, 1.40, 0, 0.05,
    0,    0,     0,    1, 0,
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function SkiaEffectsLayer({ effectId, width, height }: Props) {
  if (effectId === 'none') return null;

  // Try Skia ColorMatrix path for color grading effects
  if (SkiaAvailable && SkiaCanvas && SkiaFill && SkiaColorMatrix && COLOR_MATRICES[effectId]) {
    const matrix = COLOR_MATRICES[effectId]!;
    return (
      <SkiaCanvas style={[StyleSheet.absoluteFillObject, { zIndex: 5 }]} pointerEvents="none">
        <SkiaFill>
          <SkiaColorMatrix matrix={matrix} />
        </SkiaFill>
      </SkiaCanvas>
    );
  }

  // All other effects — pure Reanimated (no Skia clock API needed)
  return <ReanimatedEffect effectId={effectId} width={width} height={height} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// REANIMATED EFFECTS (iOS + Android safe, no Skia required)
// ─────────────────────────────────────────────────────────────────────────────
function ReanimatedEffect({ effectId, width, height }: Props) {
  if (['vintage','cine','frio','calido','bn','neon'].includes(effectId)) {
    return <ColorGradeOverlay effectId={effectId} width={width} height={height} />;
  }
  if (effectId === 'chromatic') return <RaChromatic width={width} height={height} />;
  if (effectId === 'bokeh')     return <RaBokeh     width={width} height={height} />;
  if (effectId === 'beauty')    return <RaBeauty    width={width} height={height} />;
  if (effectId === 'particles') return <RaParticles width={width} height={height} />;
  if (effectId === 'glitch')    return <RaGlitch    width={width} height={height} />;
  if (effectId === 'starfield') return <RaStarfield width={width} height={height} />;
  if (effectId === 'rain')      return <RaRain      width={width} height={height} />;
  if (effectId === 'glow')      return <RaGlow      width={width} height={height} />;
  if (effectId === 'hearts')    return <RaHearts    width={width} height={height} />;
  return null;
}

// ── Color Grade Overlay ──────────────────────────────────────────────────────
function ColorGradeOverlay({ effectId, width, height }: { effectId: string; width: number; height: number }) {
  const configs: Record<string, { color: string; vignette?: string }> = {
    vintage: { color: 'rgba(120,72,20,0.38)',  vignette: 'rgba(60,20,0,0.55)' },
    cine:    { color: 'rgba(5,10,30,0.30)',    vignette: 'rgba(0,0,0,0.65)' },
    frio:    { color: 'rgba(70,130,255,0.28)' },
    calido:  { color: 'rgba(255,130,40,0.30)' },
    bn:      { color: 'rgba(128,128,128,0.72)' },
    neon:    { color: 'rgba(180,0,255,0.22)' },
  };
  const c = configs[effectId];
  if (!c) return null;
  return (
    <View style={[StyleSheet.absoluteFillObject, { zIndex: 5 }]} pointerEvents="none">
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: c.color }]} />
      {c.vignette ? (
        <>
          <LinearGradient colors={[c.vignette, 'transparent']}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, height: height * 0.30 }} />
          <LinearGradient colors={['transparent', c.vignette]}
            style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: height * 0.30 }} />
        </>
      ) : null}
    </View>
  );
}

// ── Chromatic Aberration ─────────────────────────────────────────────────────
function RaChromatic({ width, height }: { width: number; height: number }) {
  const sh = useSharedValue(0);
  useEffect(() => {
    sh.value = withRepeat(
      withSequence(withTiming(8, { duration: 600 }), withTiming(-6, { duration: 600 })),
      -1, true,
    );
  }, []);
  const rSty = useAnimatedStyle(() => ({
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,20,80,0.18)',
    transform: [{ translateX: sh.value }],
  }));
  const cSty = useAnimatedStyle(() => ({
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,255,220,0.15)',
    transform: [{ translateX: -sh.value * 0.85 }],
  }));
  return (
    <View style={[StyleSheet.absoluteFillObject, { zIndex: 8, overflow: 'hidden' }]} pointerEvents="none">
      <Animated.View style={rSty} />
      <Animated.View style={cSty} />
    </View>
  );
}

// ── Bokeh Vignette ───────────────────────────────────────────────────────────
function RaBokeh({ width, height }: { width: number; height: number }) {
  const alpha = useSharedValue(0.4);
  useEffect(() => {
    alpha.value = withRepeat(
      withSequence(withTiming(0.55, { duration: 1200 }), withTiming(0.38, { duration: 1200 })),
      -1, true,
    );
  }, []);
  const vigSty = useAnimatedStyle(() => ({ ...StyleSheet.absoluteFillObject, opacity: alpha.value }));
  return (
    <View style={[StyleSheet.absoluteFillObject, { zIndex: 6 }]} pointerEvents="none">
      <Animated.View style={vigSty}>
        <LinearGradient colors={['rgba(0,0,0,0.7)', 'transparent', 'rgba(0,0,0,0.6)']}
          style={StyleSheet.absoluteFillObject} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} />
        <LinearGradient colors={['rgba(0,0,0,0.6)', 'transparent', 'rgba(0,0,0,0.6)']}
          style={StyleSheet.absoluteFillObject} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} />
      </Animated.View>
    </View>
  );
}

// ── Beauty Skin ──────────────────────────────────────────────────────────────
function RaBeauty({ width, height }: { width: number; height: number }) {
  const al = useSharedValue(0.12);
  useEffect(() => {
    al.value = withRepeat(
      withSequence(withTiming(0.16, { duration: 1500 }), withTiming(0.10, { duration: 1500 })),
      -1, true,
    );
  }, []);
  const sty = useAnimatedStyle(() => ({
    ...StyleSheet.absoluteFillObject,
    backgroundColor: `rgba(255,210,185,${al.value})`,
  }));
  return (
    <View style={[StyleSheet.absoluteFillObject, { zIndex: 5 }]} pointerEvents="none">
      <Animated.View style={sty} />
    </View>
  );
}

// ── Particles — pre-computed, no hooks in map ─────────────────────────────────
// Each particle is its own component that owns its own shared values
function RaParticle({ x, y, size, color, delay }: {
  x: number; y: number; size: number; color: string; delay: number;
}) {
  const ty = useSharedValue(0);
  const op = useSharedValue(0);
  useEffect(() => {
    let iv: ReturnType<typeof setInterval>;
    const t = setTimeout(() => {
      const run = () => {
        ty.value = 0; op.value = 0;
        op.value = withTiming(1, { duration: 300 });
        ty.value = withTiming(-90, { duration: 2000, easing: Easing.out(Easing.quad) });
      };
      run();
      iv = setInterval(run, 2300);
    }, delay);
    return () => { clearTimeout(t); clearInterval(iv); };
  }, []);
  const sty = useAnimatedStyle(() => ({
    position: 'absolute', left: x, top: y,
    width: size, height: size, borderRadius: size / 2,
    backgroundColor: color, opacity: op.value,
    transform: [{ translateY: ty.value }],
  }));
  return <Animated.View style={sty} />;
}

function RaParticles({ width, height }: { width: number; height: number }) {
  const pts = useMemo(() => Array.from({ length: 16 }, (_, i) => ({
    id: i,
    x: Math.random() * Math.max(1, width - 20),
    y: height * 0.2 + Math.random() * height * 0.6,
    size: 4 + Math.random() * 8,
    color: ['#FFD700','#FFA500','#FFE066','#FF9D00'][i % 4],
    delay: i * 140,
  })), [width, height]);
  return (
    <View style={[StyleSheet.absoluteFillObject, { zIndex: 10 }]} pointerEvents="none">
      {pts.map(p => <RaParticle key={p.id} x={p.x} y={p.y} size={p.size} color={p.color} delay={p.delay} />)}
    </View>
  );
}

// ── Glitch ───────────────────────────────────────────────────────────────────
function RaGlitch({ width, height }: { width: number; height: number }) {
  const sh = useSharedValue(0);
  const al = useSharedValue(0);
  useEffect(() => {
    const iv = setInterval(() => {
      sh.value = withSequence(
        withTiming(8,  { duration: 50 }),
        withTiming(-6, { duration: 50 }),
        withTiming(4,  { duration: 50 }),
        withTiming(0,  { duration: 50 }),
      );
      al.value = withSequence(
        withTiming(0.4, { duration: 50 }),
        withTiming(0,   { duration: 150 }),
      );
    }, 700 + Math.random() * 400);
    return () => clearInterval(iv);
  }, []);
  const rs = useAnimatedStyle(() => ({
    ...StyleSheet.absoluteFillObject,
    backgroundColor: `rgba(255,0,60,${al.value})`,
    transform: [{ translateX: sh.value }],
  }));
  const cs = useAnimatedStyle(() => ({
    ...StyleSheet.absoluteFillObject,
    backgroundColor: `rgba(0,255,255,${al.value * 0.7})`,
    transform: [{ translateX: -sh.value * 0.8 }],
  }));
  return (
    <View style={[StyleSheet.absoluteFillObject, { zIndex: 10, overflow: 'hidden' }]} pointerEvents="none">
      <Animated.View style={rs} />
      <Animated.View style={cs} />
    </View>
  );
}

// ── Starfield ────────────────────────────────────────────────────────────────
function RaStarfield({ width, height }: { width: number; height: number }) {
  const rot = useSharedValue(0);
  useEffect(() => {
    rot.value = withRepeat(withTiming(360, { duration: 8000, easing: Easing.linear }), -1, false);
  }, []);
  const cx = Math.max(1, width / 2);
  const cy = Math.max(1, height / 2);
  const STARS = useMemo(() => Array.from({ length: 22 }, (_, i) => ({
    id: i, angle: (i / 22) * 360,
    r: 55 + (i % 5) * 28, size: 2 + (i % 3),
    color: ['#FFD700','#FFFFFF','#A0C4FF','#FF88CC'][i % 4],
  })), []);
  const ringSty = useAnimatedStyle(() => ({
    position: 'absolute', left: cx - 80, top: cy - 80,
    width: 160, height: 160, borderRadius: 80,
    borderWidth: 1, borderColor: 'rgba(160,100,255,0.3)',
    transform: [{ rotate: `${rot.value}deg` }],
  }));
  return (
    <View style={[StyleSheet.absoluteFillObject, { zIndex: 10 }]} pointerEvents="none">
      <Animated.View style={ringSty} />
      {STARS.map(s => {
        const rad = (s.angle * Math.PI) / 180;
        const sx  = cx + Math.cos(rad) * s.r - s.size / 2;
        const sy  = cy + Math.sin(rad) * s.r - s.size / 2;
        return (
          <View key={s.id} style={{
            position: 'absolute', left: sx, top: sy,
            width: s.size, height: s.size, borderRadius: s.size / 2,
            backgroundColor: s.color, opacity: 0.85,
          }} />
        );
      })}
    </View>
  );
}

// ── Rain ─────────────────────────────────────────────────────────────────────
function RaRainDrop({ x, len, speed, delay, height }: {
  x: number; len: number; speed: number; delay: number; height: number;
}) {
  const y = useSharedValue(-len);
  useEffect(() => {
    let iv: ReturnType<typeof setInterval>;
    const t = setTimeout(() => {
      const fall = () => {
        y.value = -len;
        y.value = withTiming(height + len, { duration: speed, easing: Easing.linear });
      };
      fall();
      iv = setInterval(fall, speed + 100);
    }, delay);
    return () => { clearTimeout(t); clearInterval(iv); };
  }, []);
  const sty = useAnimatedStyle(() => ({
    position: 'absolute', left: x, top: y.value,
    width: 1.5, height: len, backgroundColor: 'rgba(120,200,255,0.55)', borderRadius: 1,
  }));
  return <Animated.View style={sty} />;
}

function RaRain({ width, height }: { width: number; height: number }) {
  const drops = useMemo(() => Array.from({ length: 20 }, (_, i) => ({
    id: i,
    x: Math.random() * Math.max(1, width - 4),
    len: 20 + Math.random() * 28,
    speed: 600 + Math.random() * 700,
    delay: i * 90,
  })), [width]);
  return (
    <View style={[StyleSheet.absoluteFillObject, { zIndex: 10 }]} pointerEvents="none">
      {drops.map(d => <RaRainDrop key={d.id} x={d.x} len={d.len} speed={d.speed} delay={d.delay} height={height} />)}
    </View>
  );
}

// ── Glow ─────────────────────────────────────────────────────────────────────
function RaGlow({ width, height }: { width: number; height: number }) {
  const al = useSharedValue(0.3);
  useEffect(() => {
    al.value = withRepeat(
      withSequence(withTiming(0.5, { duration: 800 }), withTiming(0.3, { duration: 800 })),
      -1, false,
    );
  }, []);
  const sty = useAnimatedStyle(() => ({
    position: 'absolute',
    left: width * 0.15, top: height * 0.10,
    width: width * 0.7, height: height * 0.5,
    borderRadius: width * 0.35,
    backgroundColor: `rgba(124,92,255,${al.value})`,
  }));
  return (
    <View style={[StyleSheet.absoluteFillObject, { zIndex: 6 }]} pointerEvents="none">
      <Animated.View style={sty} />
    </View>
  );
}

// ── Hearts ───────────────────────────────────────────────────────────────────
function RaHeart({ x, y, emoji, size, delay }: {
  x: number; y: number; emoji: string; size: number; delay: number;
}) {
  const op = useSharedValue(0);
  const ty = useSharedValue(0);
  useEffect(() => {
    let iv: ReturnType<typeof setInterval>;
    const t = setTimeout(() => {
      const run = () => {
        op.value = 0; ty.value = 0;
        op.value = withTiming(1, { duration: 300 });
        ty.value = withTiming(-100, { duration: 2200, easing: Easing.out(Easing.quad) });
      };
      run();
      iv = setInterval(run, 2700 + Math.random() * 600);
    }, delay);
    return () => { clearTimeout(t); clearInterval(iv); };
  }, []);
  const sty = useAnimatedStyle(() => ({
    position: 'absolute', left: x, top: y,
    opacity: op.value, transform: [{ translateY: ty.value }],
  }));
  return (
    <Animated.View style={sty}>
      <Animated.Text style={{ fontSize: size }}>{emoji}</Animated.Text>
    </Animated.View>
  );
}

function RaHearts({ width, height }: { width: number; height: number }) {
  const HEARTS = ['💕','❤️','💖','💗','🩷','💝'];
  const items = useMemo(() => Array.from({ length: 10 }, (_, i) => ({
    id: i,
    x: 20 + Math.random() * Math.max(1, width - 60),
    y: height * 0.4 + Math.random() * height * 0.35,
    emoji: HEARTS[i % HEARTS.length],
    size: 16 + Math.random() * 14,
    delay: i * 220,
  })), [width, height]);
  return (
    <View style={[StyleSheet.absoluteFillObject, { zIndex: 10 }]} pointerEvents="none">
      {items.map(h => (
        <RaHeart key={h.id} x={h.x} y={h.y} emoji={h.emoji} size={h.size} delay={h.delay} />
      ))}
    </View>
  );
}
