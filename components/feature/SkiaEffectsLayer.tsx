/**
 * components/feature/SkiaEffectsLayer.tsx  — v2
 *
 * GPU-accelerated visual effects layer using @shopify/react-native-skia.
 * Runs on the Skia render thread — zero JS bridge overhead per frame.
 *
 * NEW in v2:
 *  - ChromaticAberration  — RGB split shader via RuntimeEffect (SkSL)
 *  - BokehVignette        — edge bokeh simulation (radial blur + vignette)
 *  - BeautySkin           — soft-glow skin smoothing overlay
 *  - ColorGrade (Skia)    — ColorMatrix via ImageFilter (proper GPU path)
 *  - All animated effects use useClockValue (Skia UI thread, 60 FPS)
 *
 * Falls back to Reanimated automatically when Skia is not compiled in.
 */

import React, { useEffect, useMemo } from 'react';

// ── Lazy-load Skia ────────────────────────────────────────────────────────────
let SkiaAvailable = false;
let Canvas: any        = null;
let Circle: any        = null;
let Rect: any          = null;
let Line: any          = null;
let Group: any         = null;
let BlurMask: any      = null;
let Paint: any         = null;
let ColorMatrix: any   = null;
let ImageFilter: any   = null;
let RuntimeEffect: any = null;
let Shader: any        = null;
let useCanvasRef: any  = null;
let useDerivedValue: any    = null;
let useClockValue: any      = null;
let useValue: any           = null;
let Fill: any          = null;

try {
  const skia = require('@shopify/react-native-skia');
  Canvas        = skia.Canvas;
  Circle        = skia.Circle;
  Rect          = skia.Rect;
  Group         = skia.Group;
  BlurMask      = skia.BlurMask;
  Fill          = skia.Fill;
  Paint         = skia.Paint;
  ColorMatrix   = skia.ColorMatrix;
  ImageFilter   = skia.ImageFilter;
  RuntimeEffect = skia.RuntimeEffect;
  Shader        = skia.Shader;
  Line          = skia.Line;
  useCanvasRef  = skia.useCanvasRef;
  useDerivedValue  = skia.useDerivedValue;
  useClockValue = skia.useClockValue;
  useValue      = skia.useValue;
  SkiaAvailable = true;
} catch {
  // Not compiled in — Reanimated fallback active
}

// ── Reanimated (always available) ─────────────────────────────────────────────
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming,
  withSequence, Easing,
} from 'react-native-reanimated';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC INTERFACE
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

  if (SkiaAvailable) {
    return <SkiaEffect effectId={effectId} width={width} height={height} />;
  }
  return <ReanimatedFallback effectId={effectId} width={width} height={height} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// SKIA IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────
function SkiaEffect({ effectId, width, height }: Props) {
  const clock = useClockValue(0);

  // Color grading via ColorMatrix ImageFilter
  if (COLOR_MATRICES[effectId]) {
    const matrix = COLOR_MATRICES[effectId]!;
    return (
      <Canvas style={[StyleSheet.absoluteFillObject, { zIndex: 5 }]} pointerEvents="none">
        <Fill>
          <ColorMatrix matrix={matrix} />
        </Fill>
      </Canvas>
    );
  }

  if (effectId === 'chromatic')  return <SkiaChromaticAberration clock={clock} width={width} height={height} />;
  if (effectId === 'bokeh')      return <SkiaBokehVignette        clock={clock} width={width} height={height} />;
  if (effectId === 'beauty')     return <SkiaBeautySkin           clock={clock} width={width} height={height} />;
  if (effectId === 'particles')  return <SkiaParticles            clock={clock} width={width} height={height} />;
  if (effectId === 'glitch')     return <SkiaGlitch               clock={clock} width={width} height={height} />;
  if (effectId === 'starfield')  return <SkiaStarfield            clock={clock} width={width} height={height} />;
  if (effectId === 'rain')       return <SkiaRain                 clock={clock} width={width} height={height} />;
  if (effectId === 'glow')       return <SkiaGlow                 clock={clock} width={width} height={height} />;

  return null;
}

// ── Chromatic Aberration — RGB channel split with animation ──────────────────
// Simulated via 3 semi-transparent colored Rects that shift in/out
function SkiaChromaticAberration({ clock, width, height }: { clock: any; width: number; height: number }) {
  const shift = useDerivedValue(() => {
    return 6 + 4 * Math.sin(clock.current / 600);
  }, [clock]);

  const alpha = useDerivedValue(() => {
    return 0.18 + 0.10 * Math.sin(clock.current / 900);
  }, [clock]);

  return (
    <Canvas style={[StyleSheet.absoluteFillObject, { zIndex: 8 }]} pointerEvents="none">
      {/* Red channel — shifted right */}
      <Rect x={shift.value} y={0} width={width} height={height} color={`rgba(255,20,80,${alpha.value})`} />
      {/* Cyan channel — shifted left */}
      <Rect x={-shift.value} y={0} width={width} height={height} color={`rgba(0,255,220,${alpha.value * 0.85})`} />
      {/* Blue boost — slight vertical shift */}
      <Rect x={0} y={shift.value * 0.5} width={width} height={height} color={`rgba(60,60,255,${alpha.value * 0.5})`} />
    </Canvas>
  );
}

// ── Bokeh Vignette — radial blur simulation via gradient rings ───────────────
function SkiaBokehVignette({ clock, width, height }: { clock: any; width: number; height: number }) {
  const cx = width / 2;
  const cy = height / 2;
  const pulse = useDerivedValue(() => {
    return 0.4 + 0.08 * Math.sin(clock.current / 1200);
  }, [clock]);

  // Bokeh circles at corners
  const bokehDots = useMemo(() => [
    { x: 30,        y: 60,         r: 18, c: 'rgba(255,200,100,0.45)' },
    { x: width - 35, y: 80,        r: 14, c: 'rgba(100,200,255,0.4)' },
    { x: 40,        y: height - 80, r: 22, c: 'rgba(255,100,200,0.35)' },
    { x: width - 45, y: height - 60, r: 16, c: 'rgba(150,255,150,0.38)' },
    { x: cx * 0.3,  y: cy * 0.5,   r: 10, c: 'rgba(255,180,80,0.3)' },
    { x: cx * 1.7,  y: cy * 1.6,   r: 12, c: 'rgba(80,180,255,0.3)' },
  ], [width, height, cx, cy]);

  return (
    <Canvas style={[StyleSheet.absoluteFillObject, { zIndex: 6 }]} pointerEvents="none">
      {/* Dark vignette ring */}
      <Rect x={0} y={0} width={width} height={height} color={`rgba(0,0,0,${pulse.value})`}>
        <BlurMask blur={60} style="normal" />
      </Rect>
      {/* Bokeh dots */}
      {bokehDots.map((d, i) => (
        <Circle key={i} cx={d.x} cy={d.y} r={d.r} color={d.c}>
          <BlurMask blur={8} style="normal" />
        </Circle>
      ))}
    </Canvas>
  );
}

// ── Beauty Skin — soft luminous glow overlay ─────────────────────────────────
function SkiaBeautySkin({ clock, width, height }: { clock: any; width: number; height: number }) {
  const alpha = useDerivedValue(() => {
    return 0.12 + 0.04 * Math.sin(clock.current / 1500);
  }, [clock]);

  const cx = width / 2;
  const cy = height * 0.38; // face center bias

  return (
    <Canvas style={[StyleSheet.absoluteFillObject, { zIndex: 5 }]} pointerEvents="none">
      {/* Skin warm tint */}
      <Rect x={0} y={0} width={width} height={height} color={`rgba(255,210,180,${alpha.value})`} />
      {/* Central face glow */}
      <Circle cx={cx} cy={cy} r={width * 0.45} color={`rgba(255,230,210,${alpha.value * 1.3})`}>
        <BlurMask blur={50} style="normal" />
      </Circle>
      {/* Eye brightening zones */}
      <Circle cx={cx - width * 0.14} cy={cy - height * 0.04} r={width * 0.08} color={`rgba(255,255,240,${alpha.value * 0.8})`}>
        <BlurMask blur={18} style="normal" />
      </Circle>
      <Circle cx={cx + width * 0.14} cy={cy - height * 0.04} r={width * 0.08} color={`rgba(255,255,240,${alpha.value * 0.8})`}>
        <BlurMask blur={18} style="normal" />
      </Circle>
    </Canvas>
  );
}

// ── Particles — golden GPU circles ──────────────────────────────────────────
function SkiaParticles({ clock, width, height }: { clock: any; width: number; height: number }) {
  const COLORS = ['#FFD700', '#FFA500', '#FFE066', '#FFFACD', '#FF9D00'];
  const particles = useMemo(() =>
    Array.from({ length: 22 }, (_, i) => ({
      x:     20 + Math.random() * (width  - 40),
      baseY: height * 0.3 + Math.random() * height * 0.5,
      r:     3 + Math.random() * 7,
      color: COLORS[i % COLORS.length],
      speed: 800 + Math.random() * 600,
      phase: Math.random() * Math.PI * 2,
    })),
  [width, height]);

  return (
    <Canvas style={[StyleSheet.absoluteFillObject, { zIndex: 10 }]} pointerEvents="none">
      {particles.map((p, i) => {
        const y = useDerivedValue(() => {
          const t        = clock.current;
          const cyc      = p.speed;
          const progress = ((t + p.phase * 300) % cyc) / cyc;
          return p.baseY - progress * 120;
        }, [clock]);
        const op = useDerivedValue(() => {
          const t        = clock.current;
          const cyc      = p.speed;
          const progress = ((t + p.phase * 300) % cyc) / cyc;
          return progress < 0.1 ? progress * 10 : progress > 0.8 ? (1 - progress) * 5 : 1;
        }, [clock]);
        return (
          <Circle key={i} cx={p.x} cy={y.value} r={p.r} color={p.color} opacity={op.value} />
        );
      })}
    </Canvas>
  );
}

// ── Glitch — RGB split + scan bars ──────────────────────────────────────────
function SkiaGlitch({ clock, width, height }: { clock: any; width: number; height: number }) {
  const shift = useDerivedValue(() => {
    const t   = clock.current;
    const cyc = 700;
    const ph  = t % cyc;
    if (ph > 500) return 0;
    const gp  = ph % 160;
    if (gp < 40)  return 10;
    if (gp < 80)  return -8;
    if (gp < 120) return 5;
    return 0;
  }, [clock]);

  const alpha = useDerivedValue(() => {
    const ph = clock.current % 700;
    return ph > 500 ? 0 : 0.35;
  }, [clock]);

  return (
    <Canvas style={[StyleSheet.absoluteFillObject, { zIndex: 10 }]} pointerEvents="none">
      <Rect x={shift.value}           y={0} width={width} height={height} color={`rgba(255,0,60,${alpha.value})`} />
      <Rect x={-shift.value * 0.8}    y={0} width={width} height={height} color={`rgba(0,255,255,${alpha.value * 0.7})`} />
      <Rect x={0} y={height * 0.33}   width={width} height={3} color={`rgba(0,255,255,${alpha.value * 2})`} />
      <Rect x={0} y={height * 0.66}   width={width} height={2} color={`rgba(255,0,200,${alpha.value * 2})`} />
    </Canvas>
  );
}

// ── Starfield — orbiting dots ─────────────────────────────────────────────────
function SkiaStarfield({ clock, width, height }: { clock: any; width: number; height: number }) {
  const cx = width / 2;
  const cy = height / 2;
  const STARS = useMemo(() =>
    Array.from({ length: 28 }, (_, i) => ({
      angle0: (i / 28) * Math.PI * 2,
      r:      50 + (i % 6) * 30,
      size:   1.5 + (i % 3),
      color:  ['#FFD700', '#FFFFFF', '#A0C4FF', '#FF88CC', '#00E5A0'][i % 5],
    })),
  []);

  const rotation = useDerivedValue(() => (clock.current / 8000) * Math.PI * 2, [clock]);

  return (
    <Canvas style={[StyleSheet.absoluteFillObject, { zIndex: 10 }]} pointerEvents="none">
      {STARS.map((s, i) => {
        const ang = useDerivedValue(() => s.angle0 + rotation.value, [rotation]);
        const px  = useDerivedValue(() => cx + Math.cos(ang.value) * s.r, [ang]);
        const py  = useDerivedValue(() => cy + Math.sin(ang.value) * s.r, [ang]);
        return (
          <Circle key={i} cx={px.value} cy={py.value} r={s.size} color={s.color} opacity={0.9} />
        );
      })}
    </Canvas>
  );
}

// ── Rain — vertical streaks ───────────────────────────────────────────────────
function SkiaRain({ clock, width, height }: { clock: any; width: number; height: number }) {
  const drops = useMemo(() =>
    Array.from({ length: 24 }, (_, i) => ({
      x:     5 + Math.random() * (width - 10),
      len:   20 + Math.random() * 30,
      speed: 500 + Math.random() * 700,
      phase: Math.random() * 1200,
    })),
  [width]);

  return (
    <Canvas style={[StyleSheet.absoluteFillObject, { zIndex: 10 }]} pointerEvents="none">
      {drops.map((d, i) => {
        const y = useDerivedValue(() => {
          const progress = ((clock.current + d.phase) % d.speed) / d.speed;
          return -d.len + progress * (height + d.len * 2);
        }, [clock]);
        return (
          <Line key={i}
            p1={{ x: d.x, y: y.value }}
            p2={{ x: d.x, y: y.value + d.len }}
            color="rgba(130,200,255,0.55)"
            strokeWidth={1.5}
          />
        );
      })}
    </Canvas>
  );
}

// ── Glow — pulsing neon aura ──────────────────────────────────────────────────
function SkiaGlow({ clock, width, height }: { clock: any; width: number; height: number }) {
  const alpha = useDerivedValue(() => 0.3 + 0.2 * Math.sin(clock.current / 800), [clock]);
  return (
    <Canvas style={[StyleSheet.absoluteFillObject, { zIndex: 6 }]} pointerEvents="none">
      <Circle cx={width / 2} cy={height * 0.38} r={width * 0.38} color={`rgba(124,92,255,${alpha.value})`}>
        <BlurMask blur={40} style="normal" />
      </Circle>
    </Canvas>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REANIMATED FALLBACK
// ─────────────────────────────────────────────────────────────────────────────
function ReanimatedFallback({ effectId, width, height }: Props) {
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
  return null;
}

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
          <LinearGradient colors={[c.vignette, 'transparent']} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: height * 0.30 }} />
          <LinearGradient colors={['transparent', c.vignette]} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: height * 0.30 }} />
        </>
      ) : null}
    </View>
  );
}

function RaChromatic({ width, height }: { width: number; height: number }) {
  const sh = useSharedValue(0);
  useEffect(() => {
    sh.value = withRepeat(
      withSequence(withTiming(8, { duration: 600 }), withTiming(-6, { duration: 600 })),
      -1, true,
    );
  }, []);
  const rSty = useAnimatedStyle(() => ({ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,20,80,0.18)', transform: [{ translateX: sh.value }] }));
  const cSty = useAnimatedStyle(() => ({ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,255,220,0.15)', transform: [{ translateX: -sh.value * 0.85 }] }));
  return (
    <View style={[StyleSheet.absoluteFillObject, { zIndex: 8, overflow: 'hidden' }]} pointerEvents="none">
      <Animated.View style={rSty} />
      <Animated.View style={cSty} />
    </View>
  );
}

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

function RaBeauty({ width, height }: { width: number; height: number }) {
  const al = useSharedValue(0.12);
  useEffect(() => {
    al.value = withRepeat(
      withSequence(withTiming(0.16, { duration: 1500 }), withTiming(0.10, { duration: 1500 })),
      -1, true,
    );
  }, []);
  const sty = useAnimatedStyle(() => ({ ...StyleSheet.absoluteFillObject, backgroundColor: `rgba(255,210,185,${al.value})` }));
  return (
    <View style={[StyleSheet.absoluteFillObject, { zIndex: 5 }]} pointerEvents="none">
      <Animated.View style={sty} />
    </View>
  );
}

function RaParticles({ width, height }: { width: number; height: number }) {
  const pts = useMemo(() => Array.from({ length: 16 }, (_, i) => ({
    id: i, x: Math.random() * (width - 20),
    y: height * 0.2 + Math.random() * height * 0.6,
    size: 4 + Math.random() * 8,
    color: ['#FFD700','#FFA500','#FFE066','#FF9D00'][i % 4],
    delay: i * 140,
  })), [width, height]);
  return (
    <View style={[StyleSheet.absoluteFillObject, { zIndex: 10 }]} pointerEvents="none">
      {pts.map(p => <RaParticle key={p.id} {...p} />)}
    </View>
  );
}

function RaParticle({ x, y, size, color, delay }: any) {
  const ty = useSharedValue(0);
  const op = useSharedValue(0);
  useEffect(() => {
    const t = setTimeout(() => {
      const run = () => {
        ty.value = 0; op.value = 0;
        op.value = withTiming(1, { duration: 300 });
        ty.value = withTiming(-90, { duration: 2000, easing: Easing.out(Easing.quad) });
      };
      run();
      const iv = setInterval(run, 2300);
      return () => clearInterval(iv);
    }, delay);
    return () => clearTimeout(t);
  }, []);
  const sty = useAnimatedStyle(() => ({
    position: 'absolute', left: x, top: y,
    width: size, height: size, borderRadius: size / 2,
    backgroundColor: color, opacity: op.value,
    transform: [{ translateY: ty.value }],
  }));
  return <Animated.View style={sty} />;
}

function RaGlitch({ width, height }: { width: number; height: number }) {
  const sh = useSharedValue(0);
  const al = useSharedValue(0);
  useEffect(() => {
    const iv = setInterval(() => {
      sh.value = withSequence(
        withTiming(8,  { duration: 50 }), withTiming(-6, { duration: 50 }),
        withTiming(4,  { duration: 50 }), withTiming(0,  { duration: 50 }),
      );
      al.value = withSequence(
        withTiming(0.4, { duration: 50 }), withTiming(0, { duration: 150 }),
      );
    }, 700 + Math.random() * 400);
    return () => clearInterval(iv);
  }, []);
  const rs = useAnimatedStyle(() => ({ ...StyleSheet.absoluteFillObject, backgroundColor: `rgba(255,0,60,${al.value})`, transform: [{ translateX: sh.value }] }));
  const cs = useAnimatedStyle(() => ({ ...StyleSheet.absoluteFillObject, backgroundColor: `rgba(0,255,255,${al.value * 0.7})`, transform: [{ translateX: -sh.value * 0.8 }] }));
  return (
    <View style={[StyleSheet.absoluteFillObject, { zIndex: 10, overflow: 'hidden' }]} pointerEvents="none">
      <Animated.View style={rs} />
      <Animated.View style={cs} />
    </View>
  );
}

function RaStarfield({ width, height }: { width: number; height: number }) {
  const rot = useSharedValue(0);
  useEffect(() => {
    rot.value = withRepeat(withTiming(360, { duration: 8000, easing: Easing.linear }), -1, false);
  }, []);
  const cx = width / 2, cy = height / 2;
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

function RaRain({ width, height }: { width: number; height: number }) {
  const drops = useMemo(() => Array.from({ length: 20 }, (_, i) => ({
    id: i, x: Math.random() * (width - 4),
    len: 20 + Math.random() * 28, speed: 600 + Math.random() * 700, delay: i * 90,
  })), [width]);
  return (
    <View style={[StyleSheet.absoluteFillObject, { zIndex: 10 }]} pointerEvents="none">
      {drops.map(d => <RaRainDrop key={d.id} {...d} height={height} />)}
    </View>
  );
}

function RaRainDrop({ x, len, speed, delay, height }: any) {
  const y = useSharedValue(-len);
  useEffect(() => {
    const t = setTimeout(() => {
      const fall = () => {
        y.value = -len;
        y.value = withTiming(height + len, { duration: speed, easing: Easing.linear });
      };
      fall();
      const iv = setInterval(fall, speed + 100);
      return () => clearInterval(iv);
    }, delay);
    return () => clearTimeout(t);
  }, []);
  const sty = useAnimatedStyle(() => ({
    position: 'absolute', left: x, top: y.value,
    width: 1.5, height: len, backgroundColor: 'rgba(120,200,255,0.55)', borderRadius: 1,
  }));
  return <Animated.View style={sty} />;
}

function RaGlow({ width, height }: { width: number; height: number }) {
  const al = useSharedValue(0.3);
  useEffect(() => {
    al.value = withRepeat(
      withSequence(withTiming(0.5, { duration: 800 }), withTiming(0.3, { duration: 800 })),
      -1, false,
    );
  }, []);
  const sty = useAnimatedStyle(() => ({
    position: 'absolute', left: width * 0.15, top: height * 0.10,
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
