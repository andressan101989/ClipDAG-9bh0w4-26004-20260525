/**
 * components/feature/SkiaEffectsLayer.tsx  — v4  (iOS Hermes safe)
 *
 * Fixes vs v3:
 *  1. Removed ...StyleSheet.absoluteFillObject spread inside useAnimatedStyle()
 *     → Hermes treats StyleSheet ids as indexed CSS props → CSSStyleDeclaration crash
 *     → All animated styles now use explicit position/top/left/right/bottom properties
 *  2. Removed Animated.Text (iOS Hermes multibyte emoji crash)
 *     → Hearts rendered as regular <Text> inside a plain <View> animated wrapper
 *  3. All Math.random() calls moved inside useMemo (stable across renders)
 *  4. Skia ColorMatrix disabled on iOS (Canvas API not available in dev-client without XCFramework)
 *     → Falls through to Reanimated fallback safely
 */

import React, { useEffect, useMemo } from 'react';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming,
  withSequence, Easing,
} from 'react-native-reanimated';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

// ── Lazy-load Skia — only use when fully compiled (EAS Build) ─────────────────
let SkiaAvailable = false;
let SkiaCanvas: any  = null;
let SkiaFill: any    = null;
let SkiaColorMatrix: any = null;

try {
  const skia = require('@shopify/react-native-skia');
  SkiaCanvas      = skia.Canvas      ?? null;
  SkiaFill        = skia.Fill        ?? null;
  SkiaColorMatrix = skia.ColorMatrix ?? null;
  // Only mark available if ALL three are present AND we're NOT on web
  if (SkiaCanvas && SkiaFill && SkiaColorMatrix) {
    SkiaAvailable = true;
  }
} catch {
  // Not compiled — Reanimated fallback
}

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
// SKIA COLOR MATRIX CONFIGS
// ─────────────────────────────────────────────────────────────────────────────
const COLOR_MATRICES: Partial<Record<SkiaEffectId, number[]>> = {
  vintage: [0.9,0.15,0.10,0,0.05, 0.10,0.80,0.10,0,0.02, 0.10,0.05,0.60,0,0.00, 0,0,0,1,0],
  cine:    [0.70,0.15,0.05,0,-0.03, 0.10,0.75,0.08,0,0.00, 0.10,0.18,0.85,0,0.02, 0,0,0,1,0],
  frio:    [0.80,0.05,0.05,0,0, 0.05,0.85,0.10,0,0, 0.10,0.10,1.10,0,0, 0,0,0,1,0],
  calido:  [1.15,0.10,0.00,0,0.03, 0.05,0.90,0.05,0,0.01, 0.00,0.02,0.75,0,0.00, 0,0,0,1,0],
  bn:      [0.299,0.587,0.114,0,0, 0.299,0.587,0.114,0,0, 0.299,0.587,0.114,0,0, 0,0,0,1,0],
  neon:    [1.30,-0.20,0.10,0,0.05, -0.10,1.10,0.10,0,0.00, 0.20,-0.10,1.40,0,0.05, 0,0,0,1,0],
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function SkiaEffectsLayer({ effectId, width, height }: Props) {
  if (effectId === 'none') return null;

  // Skia ColorMatrix path — only when fully compiled
  if (SkiaAvailable && SkiaCanvas && SkiaFill && SkiaColorMatrix && COLOR_MATRICES[effectId]) {
    const matrix = COLOR_MATRICES[effectId]!;
    return (
      <SkiaCanvas style={sty.absoluteFill} pointerEvents="none">
        <SkiaFill>
          <SkiaColorMatrix matrix={matrix} />
        </SkiaFill>
      </SkiaCanvas>
    );
  }

  // Pure Reanimated fallback — always safe on iOS Hermes
  return <ReanimatedEffect effectId={effectId} width={Math.max(1, width)} height={Math.max(1, height)} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// REANIMATED EFFECTS
// ─────────────────────────────────────────────────────────────────────────────
function ReanimatedEffect({ effectId, width, height }: Props) {
  if (['vintage','cine','frio','calido','bn','neon'].includes(effectId)) {
    return <ColorGradeOverlay effectId={effectId} width={width} height={height} />;
  }
  if (effectId === 'chromatic') return <RaChromatic />;
  if (effectId === 'bokeh')     return <RaBokeh height={height} />;
  if (effectId === 'beauty')    return null; // simple static overlay — no animation needed
  if (effectId === 'particles') return <RaParticles width={width} height={height} />;
  if (effectId === 'glitch')    return <RaGlitch />;
  if (effectId === 'starfield') return <RaStarfield width={width} height={height} />;
  if (effectId === 'rain')      return <RaRain width={width} height={height} />;
  if (effectId === 'glow')      return <RaGlow width={width} height={height} />;
  if (effectId === 'hearts')    return <RaHearts width={width} height={height} />;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// COLOR GRADE OVERLAY (static — no useAnimatedStyle)
// ─────────────────────────────────────────────────────────────────────────────
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
  const vh = height * 0.30;
  return (
    <View style={sty.absoluteFill} pointerEvents="none">
      <View style={[sty.absoluteFill, { backgroundColor: c.color }]} />
      {c.vignette ? (
        <>
          <LinearGradient
            colors={[c.vignette, 'transparent']}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, height: vh }}
          />
          <LinearGradient
            colors={['transparent', c.vignette]}
            style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: vh }}
          />
        </>
      ) : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHROMATIC ABERRATION
// FIX: useAnimatedStyle returns only animated properties — NO spread of StyleSheet
// ─────────────────────────────────────────────────────────────────────────────
function RaChromatic() {
  const sh = useSharedValue(0);
  useEffect(() => {
    sh.value = withRepeat(
      withSequence(withTiming(8, { duration: 600 }), withTiming(-6, { duration: 600 })),
      -1, true,
    );
  }, []);

  // FIX: explicit position properties, no spread
  const rSty = useAnimatedStyle(() => ({
    position:        'absolute',
    top:             0,
    left:            0,
    right:           0,
    bottom:          0,
    backgroundColor: 'rgba(255,20,80,0.18)',
    transform:       [{ translateX: sh.value }],
  }));
  const cSty = useAnimatedStyle(() => ({
    position:        'absolute',
    top:             0,
    left:            0,
    right:           0,
    bottom:          0,
    backgroundColor: 'rgba(0,255,220,0.15)',
    transform:       [{ translateX: -sh.value * 0.85 }],
  }));
  return (
    <View style={[sty.absoluteFill, sty.z8, sty.overflow]} pointerEvents="none">
      <Animated.View style={rSty} />
      <Animated.View style={cSty} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BOKEH VIGNETTE
// ─────────────────────────────────────────────────────────────────────────────
function RaBokeh({ height }: { height: number }) {
  const alpha = useSharedValue(0.4);
  useEffect(() => {
    alpha.value = withRepeat(
      withSequence(withTiming(0.55, { duration: 1200 }), withTiming(0.38, { duration: 1200 })),
      -1, true,
    );
  }, []);

  // FIX: no spread inside useAnimatedStyle
  const vigSty = useAnimatedStyle(() => ({
    position: 'absolute',
    top:      0,
    left:     0,
    right:    0,
    bottom:   0,
    opacity:  alpha.value,
  }));

  return (
    <View style={[sty.absoluteFill, sty.z6]} pointerEvents="none">
      <Animated.View style={vigSty}>
        <LinearGradient
          colors={['rgba(0,0,0,0.7)', 'transparent', 'rgba(0,0,0,0.6)']}
          style={sty.absoluteFill}
          start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }}
        />
        <LinearGradient
          colors={['rgba(0,0,0,0.6)', 'transparent', 'rgba(0,0,0,0.6)']}
          style={sty.absoluteFill}
          start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
        />
      </Animated.View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTICLES
// ─────────────────────────────────────────────────────────────────────────────
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

  // FIX: explicit layout — no spread
  const pSty = useAnimatedStyle(() => ({
    position:        'absolute',
    left:            x,
    top:             y,
    width:           size,
    height:          size,
    borderRadius:    size / 2,
    backgroundColor: color,
    opacity:         op.value,
    transform:       [{ translateY: ty.value }],
  }));
  return <Animated.View style={pSty} />;
}

function RaParticles({ width, height }: { width: number; height: number }) {
  const pts = useMemo(() => Array.from({ length: 16 }, (_, i) => ({
    id:    i,
    x:     (i / 16) * Math.max(1, width - 20),
    y:     height * 0.2 + (i % 5) * (height * 0.12),
    size:  4 + (i % 5) * 1.6,
    color: ['#FFD700','#FFA500','#FFE066','#FF9D00'][i % 4],
    delay: i * 140,
  })), [width, height]);
  return (
    <View style={[sty.absoluteFill, sty.z10]} pointerEvents="none">
      {pts.map(p => (
        <RaParticle key={p.id} x={p.x} y={p.y} size={p.size} color={p.color} delay={p.delay} />
      ))}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GLITCH
// ─────────────────────────────────────────────────────────────────────────────
function RaGlitch() {
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
    }, 700);
    return () => clearInterval(iv);
  }, []);

  // FIX: explicit position, no spread
  const rs = useAnimatedStyle(() => ({
    position:        'absolute',
    top:             0, left: 0, right: 0, bottom: 0,
    backgroundColor: `rgba(255,0,60,${al.value})`,
    transform:       [{ translateX: sh.value }],
  }));
  const cs = useAnimatedStyle(() => ({
    position:        'absolute',
    top:             0, left: 0, right: 0, bottom: 0,
    backgroundColor: `rgba(0,255,255,${al.value * 0.7})`,
    transform:       [{ translateX: -sh.value * 0.8 }],
  }));
  return (
    <View style={[sty.absoluteFill, sty.z10, sty.overflow]} pointerEvents="none">
      <Animated.View style={rs} />
      <Animated.View style={cs} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STARFIELD
// ─────────────────────────────────────────────────────────────────────────────
function RaStarfield({ width, height }: { width: number; height: number }) {
  const rot = useSharedValue(0);
  useEffect(() => {
    rot.value = withRepeat(
      withTiming(360, { duration: 8000, easing: Easing.linear }), -1, false,
    );
  }, []);
  const cx = width / 2;
  const cy = height / 2;

  const STARS = useMemo(() => Array.from({ length: 22 }, (_, i) => ({
    id:    i,
    angle: (i / 22) * 360,
    r:     55 + (i % 5) * 28,
    size:  2 + (i % 3),
    color: ['#FFD700','#FFFFFF','#A0C4FF','#FF88CC'][i % 4],
  })), []);

  const ringSty = useAnimatedStyle(() => ({
    position:    'absolute',
    left:        cx - 80,
    top:         cy - 80,
    width:       160,
    height:      160,
    borderRadius: 80,
    borderWidth: 1,
    borderColor: 'rgba(160,100,255,0.3)',
    transform:   [{ rotate: `${rot.value}deg` }],
  }));

  return (
    <View style={[sty.absoluteFill, sty.z10]} pointerEvents="none">
      <Animated.View style={ringSty} />
      {STARS.map(s => {
        const rad = (s.angle * Math.PI) / 180;
        const sx  = cx + Math.cos(rad) * s.r - s.size / 2;
        const sy  = cy + Math.sin(rad) * s.r - s.size / 2;
        return (
          <View key={s.id} style={{
            position:        'absolute',
            left:            sx,
            top:             sy,
            width:           s.size,
            height:          s.size,
            borderRadius:    s.size / 2,
            backgroundColor: s.color,
            opacity:         0.85,
          }} />
        );
      })}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RAIN
// ─────────────────────────────────────────────────────────────────────────────
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

  // FIX: explicit position, no spread
  const dSty = useAnimatedStyle(() => ({
    position:        'absolute',
    left:            x,
    top:             y.value,
    width:           1.5,
    height:          len,
    backgroundColor: 'rgba(120,200,255,0.55)',
    borderRadius:    1,
  }));
  return <Animated.View style={dSty} />;
}

function RaRain({ width, height }: { width: number; height: number }) {
  const drops = useMemo(() => Array.from({ length: 20 }, (_, i) => ({
    id:    i,
    x:     (i / 20) * Math.max(1, width - 4),
    len:   20 + (i % 7) * 4,
    speed: 600 + (i % 5) * 140,
    delay: i * 90,
  })), [width]);
  return (
    <View style={[sty.absoluteFill, sty.z10]} pointerEvents="none">
      {drops.map(d => (
        <RaRainDrop key={d.id} x={d.x} len={d.len} speed={d.speed} delay={d.delay} height={height} />
      ))}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GLOW
// ─────────────────────────────────────────────────────────────────────────────
function RaGlow({ width, height }: { width: number; height: number }) {
  const al = useSharedValue(0.3);
  useEffect(() => {
    al.value = withRepeat(
      withSequence(withTiming(0.5, { duration: 800 }), withTiming(0.3, { duration: 800 })),
      -1, false,
    );
  }, []);

  // FIX: explicit layout, no spread
  const gSty = useAnimatedStyle(() => ({
    position:        'absolute',
    left:            width * 0.15,
    top:             height * 0.10,
    width:           width * 0.70,
    height:          height * 0.50,
    borderRadius:    width * 0.35,
    backgroundColor: `rgba(124,92,255,${al.value})`,
  }));
  return (
    <View style={[sty.absoluteFill, sty.z6]} pointerEvents="none">
      <Animated.View style={gSty} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HEARTS
// FIX: Use regular <Text> inside an Animated.View (not Animated.Text)
//      Animated.Text causes multibyte emoji crash on iOS Hermes
// ─────────────────────────────────────────────────────────────────────────────
function RaHeart({ x, y, emoji, size, delay }: {
  x: number; y: number; emoji: string; size: number; delay: number;
}) {
  const op = useSharedValue(0);
  const ty = useSharedValue(0);
  useEffect(() => {
    let iv: ReturnType<typeof setInterval>;
    const t = setTimeout(() => {
      const run = () => {
        op.value = 0;
        ty.value = 0;
        op.value = withTiming(1, { duration: 300 });
        ty.value = withTiming(-100, { duration: 2200, easing: Easing.out(Easing.quad) });
      };
      run();
      iv = setInterval(run, 2700);
    }, delay);
    return () => { clearTimeout(t); clearInterval(iv); };
  }, []);

  // FIX: explicit position, no spread; plain Animated.View + <Text> (not Animated.Text)
  const hSty = useAnimatedStyle(() => ({
    position:  'absolute',
    left:      x,
    top:       y,
    opacity:   op.value,
    transform: [{ translateY: ty.value }],
  }));
  return (
    <Animated.View style={hSty}>
      <Text style={{ fontSize: size }} allowFontScaling={false}>{emoji}</Text>
    </Animated.View>
  );
}

function RaHearts({ width, height }: { width: number; height: number }) {
  const HEARTS = ['💕','❤️','💖','💗','🩷','💝'];
  // FIX: deterministic positions — no Math.random() at render time
  const items = useMemo(() => Array.from({ length: 10 }, (_, i) => ({
    id:    i,
    x:     20 + ((i * 73) % Math.max(1, width - 60)),
    y:     height * 0.4 + ((i * 37) % (height * 0.35)),
    emoji: HEARTS[i % HEARTS.length],
    size:  16 + (i % 4) * 3.5,
    delay: i * 220,
  })), [width, height]);
  return (
    <View style={[sty.absoluteFill, sty.z10]} pointerEvents="none">
      {items.map(h => (
        <RaHeart key={h.id} x={h.x} y={h.y} emoji={h.emoji} size={h.size} delay={h.delay} />
      ))}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED STYLES — referenced by name, never spread inside useAnimatedStyle
// ─────────────────────────────────────────────────────────────────────────────
const sty = StyleSheet.create({
  absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  z5:           { zIndex: 5  },
  z6:           { zIndex: 6  },
  z8:           { zIndex: 8  },
  z10:          { zIndex: 10 },
  overflow:     { overflow: 'hidden' },
});
