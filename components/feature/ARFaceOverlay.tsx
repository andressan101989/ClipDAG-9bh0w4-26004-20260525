
/**
 * components/feature/ARFaceOverlay.tsx  — v4 (coord-fix + debug mode)
 *
 * All SharedValues are now number (not boolean) — critical for Reanimated 3
 * worklet arithmetic.  `detected` = 1 means face found, 0 = no face.
 *
 * Debug mode: renders a green bounding box + red landmark dots so you can
 * visually confirm the tracking pipeline is working before styling the filters.
 *
 * Filters:
 *   glasses — aviator sunglasses with arms + lens sheen
 *   makeup  — blush + eyeshadow + lip tint
 *   beauty  — pulsing skin-glow + eye brightening
 *   hat     — top hat with gold band + 3D shading
 *   neon    — animated cyan outline + magenta eye rings + scan line
 *   anime   — large eyes with iris/pupil/shines + blush + sparkle
 *   mask    — venetian half-mask with gold trim + eye holes
 */

import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
  withSpring,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import type { FaceSharedValues } from '@/hooks/useFaceTracking';

// ─────────────────────────────────────────────────────────────────────────────
// worklet-safe helpers
// ─────────────────────────────────────────────────────────────────────────────
function clamp(v: number, lo: number, hi: number): number {
  'worklet';
  return v < lo ? lo : v > hi ? hi : v;
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter ID type
// ─────────────────────────────────────────────────────────────────────────────
export type ARFilterId =
  | 'none'
  | 'glasses'
  | 'makeup'
  | 'beauty'
  | 'hat'
  | 'neon'
  | 'anime'
  | 'mask';

// ─────────────────────────────────────────────────────────────────────────────
// DEBUG OVERLAY — green bounding box + landmark dots
// Shows raw tracking data so you can confirm detection works
// ─────────────────────────────────────────────────────────────────────────────
export function ARDebugOverlay({ sv }: { sv: FaceSharedValues }) {
  const boxStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      position: 'absolute',
      left:   sv.bX.value,
      top:    sv.bY.value,
      width:  sv.bW.value,
      height: sv.bH.value,
      borderWidth: 2,
      borderColor: '#00FF00',
      borderRadius: 4,
      opacity: sv.detected.value,
    };
  });

  // The `ldot` function is a helper that returns an animated style object.
  // It is NOT a React component or a hook itself, so `rules-of-hooks` doesn't apply to its definition,
  // but if `useAnimatedStyle` was called conditionally *inside* `ldot`, that would be a hook rule violation.
  // In this case, `useAnimatedStyle` is called outside `ldot` in the main component scope for each dot.
  // The eslint-disable comment can be removed as `ldot` itself is not a hook.
  const ldot = (ptX: { value: number }, ptY: { value: number }, color: string) => {
    const s = useAnimatedStyle(() => {
      'worklet';
      return {
        position: 'absolute',
        width: 10, height: 10,
        borderRadius: 5,
        backgroundColor: color,
        left:  ptX.value - 5,
        top:   ptY.value - 5,
        opacity: sv.detected.value,
      };
    });
    return s;
  };

  const leStyle = ldot(sv.leftEye.x,    sv.leftEye.y,    '#FF3B3B');
  const reStyle = ldot(sv.rightEye.x,   sv.rightEye.y,   '#FF3B3B');
  const nbStyle = ldot(sv.noseBase.x,   sv.noseBase.y,   '#FFFF00');
  const lcStyle = ldot(sv.leftCheek.x,  sv.leftCheek.y,  '#00BFFF');
  const rcStyle = ldot(sv.rightCheek.x, sv.rightCheek.y, '#00BFFF');
  const lmStyle = ldot(sv.leftMouth.x,  sv.leftMouth.y,  '#FF69B4');
  const rmStyle = ldot(sv.rightMouth.x, sv.rightMouth.y, '#FF69B4');

  return (
    <>
      <Animated.View style={boxStyle} pointerEvents="none" />
      <Animated.View style={leStyle} pointerEvents="none" />
      <Animated.View style={reStyle} pointerEvents="none" />
      <Animated.View style={nbStyle} pointerEvents="none" />
      <Animated.View style={lcStyle} pointerEvents="none" />
      <Animated.View style={rcStyle} pointerEvents="none" />
      <Animated.View style={lmStyle} pointerEvents="none" />
      <Animated.View style={rmStyle} pointerEvents="none" />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. GLASSES
// ─────────────────────────────────────────────────────────────────────────────
function GlassesOverlay({ sv }: { sv: FaceSharedValues }) {
  // Left lens
  const leftLens = useAnimatedStyle(() => {
    'worklet';
    const span = Math.abs(sv.rightEye.x.value - sv.leftEye.x.value);
    const sz   = clamp(span * 1.05, 30, 200);
    const rot  = clamp(sv.roll.value, -30, 30);
    return {
      position: 'absolute',
      width: sz, height: sz * 0.60,
      borderRadius: sz * 0.18,
      borderWidth: 3.5,
      borderColor: '#8B6914',
      overflow: 'hidden' as const,
      left: sv.leftEye.x.value - sz * 0.70,
      top:  sv.leftEye.y.value - sz * 0.30,
      transform: [{ rotate: `${rot}deg` }],
      opacity: sv.detected.value,
    };
  });

  // Right lens
  const rightLens = useAnimatedStyle(() => {
    'worklet';
    const span = Math.abs(sv.rightEye.x.value - sv.leftEye.x.value);
    const sz   = clamp(span * 1.05, 30, 200);
    const rot  = clamp(sv.roll.value, -30, 30);
    return {
      position: 'absolute',
      width: sz, height: sz * 0.60,
      borderRadius: sz * 0.18,
      borderWidth: 3.5,
      borderColor: '#8B6914',
      overflow: 'hidden' as const,
      left: sv.rightEye.x.value - sz * 0.35,
      top:  sv.rightEye.y.value - sz * 0.30,
      transform: [{ rotate: `${rot}deg` }],
      opacity: sv.detected.value,
    };
  });

  // Bridge connecting the two lenses
  const bridge = useAnimatedStyle(() => {
    'worklet';
    const span = Math.abs(sv.rightEye.x.value - sv.leftEye.x.value);
    const bridgeW = clamp(span * 0.30, 8, 60);
    // midpoint between eyes
    const midX = (sv.leftEye.x.value + sv.rightEye.x.value) / 2;
    const midY = (sv.leftEye.y.value + sv.rightEye.y.value) / 2;
    return {
      position: 'absolute',
      width: bridgeW, height: 4,
      backgroundColor: '#8B6914',
      borderRadius: 2,
      left:  midX - bridgeW / 2,
      top:   midY - 2,
      opacity: sv.detected.value,
    };
  });

  // Left arm
  const leftArm = useAnimatedStyle(() => {
    'worklet';
    const span = Math.abs(sv.rightEye.x.value - sv.leftEye.x.value);
    const armW = clamp(span * 0.90, 20, 140);
    const lx   = Math.min(sv.leftEye.x.value, sv.rightEye.x.value);
    const my   = (sv.leftEye.y.value + sv.rightEye.y.value) / 2;
    return {
      position: 'absolute',
      width: armW, height: 5,
      backgroundColor: '#8B6914',
      borderRadius: 3,
      left:  lx - armW - span * 0.20,
      top:   my - 2,
      opacity: sv.detected.value,
    };
  });

  // Right arm
  const rightArm = useAnimatedStyle(() => {
    'worklet';
    const span = Math.abs(sv.rightEye.x.value - sv.leftEye.x.value);
    const armW = clamp(span * 0.90, 20, 140);
    const rx   = Math.max(sv.leftEye.x.value, sv.rightEye.x.value);
    const my   = (sv.leftEye.y.value + sv.rightEye.y.value) / 2;
    return {
      position: 'absolute',
      width: armW, height: 5,
      backgroundColor: '#8B6914',
      borderRadius: 3,
      left:  rx + span * 0.20,
      top:   my - 2,
      opacity: sv.detected.value,
    };
  });

  const LENS_COLORS: [string, string, string] = [
    'rgba(180,140,0,0.55)',
    'rgba(100,60,0,0.78)',
    'rgba(60,30,0,0.65)',
  ];

  return (
    <>
      <Animated.View style={leftArm}  pointerEvents="none" />
      <Animated.View style={rightArm} pointerEvents="none" />
      <Animated.View style={leftLens} pointerEvents="none">
        <LinearGradient colors={LENS_COLORS} start={{ x:0,y:0 }} end={{ x:1,y:1 }} style={StyleSheet.absoluteFillObject} />
        <View style={gs.lensSheen} />
      </Animated.View>
      <Animated.View style={bridge} pointerEvents="none" />
      <Animated.View style={rightLens} pointerEvents="none">
        <LinearGradient colors={LENS_COLORS} start={{ x:0,y:0 }} end={{ x:1,y:1 }} style={StyleSheet.absoluteFillObject} />
        <View style={gs.lensSheen} />
      </Animated.View>
    </>
  );
}

const gs = StyleSheet.create({
  lensSheen: {
    position: 'absolute', top: '5%', left: '10%',
    width: '35%', height: '28%',
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 6,
    transform: [{ skewX: '-20deg' }],
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. MAKEUP — blush + eyeshadow + lip tint
// ─────────────────────────────────────────────────────────────────────────────
function MakeupOverlay({ sv }: { sv: FaceSharedValues }) {
  const leftBlush = useAnimatedStyle(() => {
    'worklet';
    const sz = clamp(sv.bW.value * 0.30, 20, 90);
    return {
      position: 'absolute',
      width: sz, height: sz * 0.55,
      left:  sv.leftCheek.x.value - sz / 2,
      top:   sv.leftCheek.y.value - sz * 0.28,
      borderRadius: sz * 0.5,
      overflow: 'hidden' as const,
      opacity: sv.detected.value * 0.60,
    };
  });

  const rightBlush = useAnimatedStyle(() => {
    'worklet';
    const sz = clamp(sv.bW.value * 0.30, 20, 90);
    return {
      position: 'absolute',
      width: sz, height: sz * 0.55,
      left:  sv.rightCheek.x.value - sz / 2,
      top:   sv.rightCheek.y.value - sz * 0.28,
      borderRadius: sz * 0.5,
      overflow: 'hidden' as const,
      opacity: sv.detected.value * 0.60,
    };
  });

  const leftShadow = useAnimatedStyle(() => {
    'worklet';
    const sW = clamp(sv.bW.value * 0.34, 18, 100);
    const sH = clamp(sv.bW.value * 0.15, 8,  40);
    return {
      position: 'absolute',
      width: sW, height: sH,
      left:  sv.leftEye.x.value - sW / 2,
      top:   sv.leftEye.y.value - sH * 1.8,
      borderRadius: sH * 0.5,
      overflow: 'hidden' as const,
      opacity: sv.detected.value * 0.55,
    };
  });

  const rightShadow = useAnimatedStyle(() => {
    'worklet';
    const sW = clamp(sv.bW.value * 0.34, 18, 100);
    const sH = clamp(sv.bW.value * 0.15, 8,  40);
    return {
      position: 'absolute',
      width: sW, height: sH,
      left:  sv.rightEye.x.value - sW / 2,
      top:   sv.rightEye.y.value - sH * 1.8,
      borderRadius: sH * 0.5,
      overflow: 'hidden' as const,
      opacity: sv.detected.value * 0.55,
    };
  });

  const lips = useAnimatedStyle(() => {
    'worklet';
    const lW  = clamp(sv.bW.value * 0.48, 24, 120);
    const lH  = clamp(sv.bW.value * 0.16, 8,  38);
    const cx  = (sv.leftMouth.x.value + sv.rightMouth.x.value) / 2;
    return {
      position: 'absolute',
      width: lW, height: lH,
      left:  cx - lW / 2,
      top:   sv.bottomMouth.y.value - lH,
      borderRadius: lH * 0.5,
      overflow: 'hidden' as const,
      opacity: sv.detected.value * 0.70,
    };
  });

  const BLUSH: [string, string, string] = ['rgba(255,100,120,0)', 'rgba(255,90,130,0.85)', 'rgba(255,100,120,0)'];
  const SHADOW: [string, string, string] = ['rgba(130,0,200,0)', 'rgba(200,50,255,0.75)', 'rgba(130,0,200,0)'];
  const LIPS: [string, string, string] = ['rgba(200,20,60,0.4)', 'rgba(220,0,60,0.88)', 'rgba(200,20,60,0.4)'];

  return (
    <>
      <Animated.View style={leftBlush}  pointerEvents="none"><LinearGradient colors={BLUSH}  start={{x:0,y:0.5}} end={{x:1,y:0.5}} style={StyleSheet.absoluteFillObject} /></Animated.View>
      <Animated.View style={rightBlush} pointerEvents="none"><LinearGradient colors={BLUSH}  start={{x:0,y:0.5}} end={{x:1,y:0.5}} style={StyleSheet.absoluteFillObject} /></Animated.View>
      <Animated.View style={leftShadow}  pointerEvents="none"><LinearGradient colors={SHADOW} start={{x:0,y:0}} end={{x:1,y:0}} style={StyleSheet.absoluteFillObject} /></Animated.View>
      <Animated.View style={rightShadow} pointerEvents="none"><LinearGradient colors={SHADOW} start={{x:0,y:0}} end={{x:1,y:0}} style={StyleSheet.absoluteFillObject} /></Animated.View>
      <Animated.View style={lips}        pointerEvents="none"><LinearGradient colors={LIPS}   start={{x:0,y:0.5}} end={{x:1,y:0.5}} style={StyleSheet.absoluteFillObject} /></Animated.View>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. BEAUTY — pulsing soft-glow skin tint + eye brightening
// ─────────────────────────────────────────────────────────────────────────────
function BeautyOverlay({ sv }: { sv: FaceSharedValues }) {
  const pulse = useSharedValue(0.35);
  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(0.52, { duration: 1800, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.35, { duration: 1800, easing: Easing.inOut(Easing.sin) }),
      ),
      -1, false,
    );
  }, []);

  const faceGlow = useAnimatedStyle(() => {
    'worklet';
    const gW = sv.bW.value * 1.15;
    const gH = sv.bH.value * 1.10;
    return {
      position: 'absolute',
      width: gW, height: gH,
      left:  sv.bX.value - sv.bW.value * 0.075,
      top:   sv.bY.value - sv.bH.value * 0.05,
      borderRadius: gW * 0.5,
      overflow: 'hidden' as const,
      opacity: sv.detected.value * pulse.value,
    };
  });

  const leftBright = useAnimatedStyle(() => {
    'worklet';
    const sz = clamp(sv.bW.value * 0.22, 14, 60);
    return {
      position: 'absolute',
      width: sz, height: sz,
      borderRadius: sz / 2,
      left:  sv.leftEye.x.value - sz / 2,
      top:   sv.leftEye.y.value - sz / 2,
      overflow: 'hidden' as const,
      opacity: sv.detected.value * 0.40,
    };
  });

  const rightBright = useAnimatedStyle(() => {
    'worklet';
    const sz = clamp(sv.bW.value * 0.22, 14, 60);
    return {
      position: 'absolute',
      width: sz, height: sz,
      borderRadius: sz / 2,
      left:  sv.rightEye.x.value - sz / 2,
      top:   sv.rightEye.y.value - sz / 2,
      overflow: 'hidden' as const,
      opacity: sv.detected.value * 0.40,
    };
  });

  return (
    <>
      <Animated.View style={faceGlow}    pointerEvents="none"><LinearGradient colors={['rgba(255,220,200,0)','rgba(255,200,175,0.65)','rgba(255,220,200,0)']} style={StyleSheet.absoluteFillObject} /></Animated.View>
      <Animated.View style={leftBright}  pointerEvents="none"><LinearGradient colors={['rgba(255,255,255,0.65)','rgba(255,255,255,0)']} style={[StyleSheet.absoluteFillObject,{borderRadius:9999}]} /></Animated.View>
      <Animated.View style={rightBright} pointerEvents="none"><LinearGradient colors={['rgba(255,255,255,0.65)','rgba(255,255,255,0)']} style={[StyleSheet.absoluteFillObject,{borderRadius:9999}]} /></Animated.View>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. HAT — top hat with gold band, buckle, and brim shadow
// ─────────────────────────────────────────────────────────────────────────────
function HatOverlay({ sv }: { sv: FaceSharedValues }) {
  const crown = useAnimatedStyle(() => {
    'worklet';
    const fW  = sv.bW.value;
    const cW  = fW * 0.78;
    const cH  = fW * 0.90;
    const cx  = sv.bX.value + fW / 2;
    return {
      position: 'absolute',
      width: cW, height: cH,
      left:  cx - cW / 2,
      top:   sv.bY.value - cH - fW * 0.04,
      borderTopLeftRadius: 14,
      borderTopRightRadius: 14,
      overflow: 'hidden' as const,
      transform: [{ rotate: `${clamp(sv.roll.value,-25,25)}deg` }],
      opacity: sv.detected.value,
    };
  });

  const brim = useAnimatedStyle(() => {
    'worklet';
    const fW  = sv.bW.value;
    const bW  = fW * 1.35;
    const bH  = fW * 0.18;
    const cx  = sv.bX.value + fW / 2;
    return {
      position: 'absolute',
      width: bW, height: bH,
      left:  cx - bW / 2,
      top:   sv.bY.value - bH * 0.60,
      borderRadius: 8,
      overflow: 'hidden' as const,
      transform: [{ rotate: `${clamp(sv.roll.value,-25,25)}deg` }],
      opacity: sv.detected.value,
    };
  });

  return (
    <>
      <Animated.View style={crown} pointerEvents="none">
        <LinearGradient colors={['#2C2C2C','#1A1A1A','#111111']} start={{x:0,y:0}} end={{x:1,y:1}} style={StyleSheet.absoluteFillObject} />
        <LinearGradient colors={['transparent','rgba(255,255,255,0.07)','transparent']} start={{x:0.7,y:0}} end={{x:1,y:0}} style={StyleSheet.absoluteFillObject} />
        {/* Band */}
        <View style={ht.band}>
          <LinearGradient colors={['#CC9900','#FFD700','#CC9900']} start={{x:0,y:0}} end={{x:1,y:0}} style={StyleSheet.absoluteFillObject} />
          <View style={ht.buckle} />
        </View>
      </Animated.View>
      <Animated.View style={brim} pointerEvents="none">
        <LinearGradient colors={['#2A2A2A','#1A1A1A','#111']} start={{x:0,y:0}} end={{x:1,y:0}} style={StyleSheet.absoluteFillObject} />
        <LinearGradient colors={['transparent','rgba(0,0,0,0.55)']} start={{x:0.5,y:0}} end={{x:0.5,y:1}} style={StyleSheet.absoluteFillObject} />
      </Animated.View>
    </>
  );
}

const ht = StyleSheet.create({
  band: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 16, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  buckle: { width: 20, height: 14, borderWidth: 2.5, borderColor: '#8B6914', backgroundColor: 'transparent' },
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. NEON — face outline + eye rings + scan line
// ─────────────────────────────────────────────────────────────────────────────
function NeonOverlay({ sv }: { sv: FaceSharedValues }) {
  const glow = useSharedValue(0.6);
  const scan = useSharedValue(0);

  useEffect(() => {
    glow.value = withRepeat(withSequence(
      withTiming(1.0, { duration: 700, easing: Easing.inOut(Easing.quad) }),
      withTiming(0.5, { duration: 700, easing: Easing.inOut(Easing.quad) }),
    ), -1, false);
    scan.value = withRepeat(withTiming(1, { duration: 1600, easing: Easing.linear }), -1, false);
  }, []);

  const faceOutline = useAnimatedStyle(() => {
    'worklet';
    const fW = sv.bW.value * 1.08;
    const fH = sv.bH.value * 1.05;
    return {
      position: 'absolute',
      width: fW, height: fH,
      left:  sv.bX.value - sv.bW.value * 0.04,
      top:   sv.bY.value - sv.bH.value * 0.025,
      borderRadius: fW * 0.5,
      borderWidth: 3,
      borderColor: '#00FFFF',
      transform: [{ rotate: `${clamp(sv.roll.value,-20,20)}deg` }],
      opacity: sv.detected.value * glow.value,
    };
  });

  const leftRing = useAnimatedStyle(() => {
    'worklet';
    const sz = clamp(sv.bW.value * 0.28, 18, 80);
    return {
      position: 'absolute',
      width: sz, height: sz * 0.65,
      left:  sv.leftEye.x.value - sz / 2,
      top:   sv.leftEye.y.value - sz * 0.32,
      borderRadius: sz * 0.4,
      borderWidth: 2.5,
      borderColor: '#FF00FF',
      opacity: sv.detected.value * glow.value * 0.9,
    };
  });

  const rightRing = useAnimatedStyle(() => {
    'worklet';
    const sz = clamp(sv.bW.value * 0.28, 18, 80);
    return {
      position: 'absolute',
      width: sz, height: sz * 0.65,
      left:  sv.rightEye.x.value - sz / 2,
      top:   sv.rightEye.y.value - sz * 0.32,
      borderRadius: sz * 0.4,
      borderWidth: 2.5,
      borderColor: '#FF00FF',
      opacity: sv.detected.value * glow.value * 0.9,
    };
  });

  const scanLine = useAnimatedStyle(() => {
    'worklet';
    const posY = sv.bY.value + sv.bH.value * scan.value;
    return {
      position: 'absolute',
      left:   sv.bX.value - sv.bW.value * 0.04,
      top:    posY,
      width:  sv.bW.value * 1.08,
      height: 2,
      overflow: 'hidden' as const,
      opacity: sv.detected.value * 0.55,
    };
  });

  const noseDot = useAnimatedStyle(() => {
    'worklet';
    const sz = clamp(sv.bW.value * 0.10, 6, 22);
    return {
      position: 'absolute',
      width: sz, height: sz,
      borderRadius: sz / 2,
      backgroundColor: '#00FF88',
      left: sv.noseBase.x.value - sz / 2,
      top:  sv.noseBase.y.value - sz / 2,
      opacity: sv.detected.value * glow.value * 0.85,
    };
  });

  return (
    <>
      <Animated.View style={faceOutline} pointerEvents="none" />
      <Animated.View style={leftRing}    pointerEvents="none" />
      <Animated.View style={rightRing}   pointerEvents="none" />
      <Animated.View style={noseDot}     pointerEvents="none" />
      <Animated.View style={scanLine}    pointerEvents="none">
        <LinearGradient colors={['transparent','#00FFFF','transparent']} start={{x:0,y:0}} end={{x:1,y:0}} style={StyleSheet.absoluteFillObject} />
      </Animated.View>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. ANIME — large eyes + iris/pupil/shines + blush + sparkle
// ─────────────────────────────────────────────────────────────────────────────
function AnimeOverlay({ sv }: { sv: FaceSharedValues }) {
  const sparkle = useSharedValue(0);
  useEffect(() => {
    sparkle.value = withRepeat(withSequence(
      withTiming(1, { duration: 350, easing: Easing.out(Easing.exp) }),
      withTiming(0, { duration: 350, easing: Easing.in(Easing.exp) }),
      withTiming(0, { duration: 900 }),
    ), -1, false);
  }, []);

  const leftEye = useAnimatedStyle(() => {
    'worklet';
    const sz = clamp(sv.bW.value * 0.38, 22, 110);
    return {
      position: 'absolute',
      width: sz, height: sz * 1.30,
      left:  sv.leftEye.x.value - sz / 2,
      top:   sv.leftEye.y.value - sz * 0.65,
      borderRadius: sz * 0.22,
      overflow: 'hidden' as const,
      borderWidth: 2.5,
      borderColor: '#1A1A1A',
      transform: [{ rotate: `${clamp(sv.roll.value,-20,20)}deg` }],
      opacity: sv.detected.value * 0.93,
    };
  });

  const rightEye = useAnimatedStyle(() => {
    'worklet';
    const sz = clamp(sv.bW.value * 0.38, 22, 110);
    return {
      position: 'absolute',
      width: sz, height: sz * 1.30,
      left:  sv.rightEye.x.value - sz / 2,
      top:   sv.rightEye.y.value - sz * 0.65,
      borderRadius: sz * 0.22,
      overflow: 'hidden' as const,
      borderWidth: 2.5,
      borderColor: '#1A1A1A',
      transform: [{ rotate: `${clamp(sv.roll.value,-20,20)}deg` }],
      opacity: sv.detected.value * 0.93,
    };
  });

  const leftBlush = useAnimatedStyle(() => {
    'worklet';
    const sz = clamp(sv.bW.value * 0.30, 18, 80);
    return {
      position: 'absolute',
      width: sz, height: sz * 0.55,
      left:  sv.leftCheek.x.value - sz / 2,
      top:   sv.leftCheek.y.value - sz * 0.25,
      borderRadius: sz * 0.5,
      overflow: 'hidden' as const,
      opacity: sv.detected.value * 0.72,
    };
  });

  const rightBlush = useAnimatedStyle(() => {
    'worklet';
    const sz = clamp(sv.bW.value * 0.30, 18, 80);
    return {
      position: 'absolute',
      width: sz, height: sz * 0.55,
      left:  sv.rightCheek.x.value - sz / 2,
      top:   sv.rightCheek.y.value - sz * 0.25,
      borderRadius: sz * 0.5,
      overflow: 'hidden' as const,
      opacity: sv.detected.value * 0.72,
    };
  });

  const starStyle = useAnimatedStyle(() => {
    'worklet';
    const sz = clamp(sv.bW.value * 0.13, 8, 30);
    return {
      position: 'absolute',
      width: sz, height: sz,
      left: sv.bX.value + sv.bW.value * 0.80,
      top:  sv.bY.value - sz * 0.5,
      opacity: sv.detected.value * sparkle.value,
      transform: [{ scale: 0.5 + sparkle.value * 0.5 }, { rotate: `${sparkle.value * 45}deg` }],
    };
  });

  const ANIME_EYE: [string, string, string, string] = ['#A0C4FF','#4080FF','#1A3080','#050A20'];
  const BLUSH: [string, string, string] = ['rgba(255,130,150,0)','rgba(255,95,125,0.78)','rgba(255,130,150,0)'];

  return (
    <>
      <Animated.View style={leftEye} pointerEvents="none">
        <LinearGradient colors={ANIME_EYE} start={{x:0.5,y:0}} end={{x:0.5,y:1}} style={StyleSheet.absoluteFillObject} />
        <View style={an.iris} /><View style={an.pupil} />
        <View style={an.shineL} /><View style={an.shineR} />
      </Animated.View>
      <Animated.View style={rightEye} pointerEvents="none">
        <LinearGradient colors={ANIME_EYE} start={{x:0.5,y:0}} end={{x:0.5,y:1}} style={StyleSheet.absoluteFillObject} />
        <View style={an.iris} /><View style={an.pupil} />
        <View style={an.shineL} /><View style={an.shineR} />
      </Animated.View>
      <Animated.View style={leftBlush}  pointerEvents="none"><LinearGradient colors={BLUSH} start={{x:0,y:0.5}} end={{x:1,y:0.5}} style={StyleSheet.absoluteFillObject} /></Animated.View>
      <Animated.View style={rightBlush} pointerEvents="none"><LinearGradient colors={BLUSH} start={{x:0,y:0.5}} end={{x:1,y:0.5}} style={StyleSheet.absoluteFillObject} /></Animated.View>
      <Animated.View style={starStyle} pointerEvents="none">
        <LinearGradient colors={['#FFD700','#FFF7A0']} style={[StyleSheet.absoluteFillObject,{borderRadius:3}]} />
      </Animated.View>
    </>
  );
}

const an = StyleSheet.create({
  iris:   { position:'absolute', width:'55%', height:'55%', borderRadius:999, backgroundColor:'#2050C0', alignSelf:'center', top:'25%' },
  pupil:  { position:'absolute', width:'28%', height:'28%', borderRadius:999, backgroundColor:'#050A20', alignSelf:'center', top:'36%' },
  shineL: { position:'absolute', width:'22%', height:'22%', borderRadius:999, backgroundColor:'rgba(255,255,255,0.92)', top:'15%', left:'20%' },
  shineR: { position:'absolute', width:'12%', height:'12%', borderRadius:999, backgroundColor:'rgba(255,255,255,0.6)',  top:'55%', right:'18%' },
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. MASK — venetian half-mask with gold trim and eye holes
// ─────────────────────────────────────────────────────────────────────────────
function MaskOverlay({ sv }: { sv: FaceSharedValues }) {
  const maskBody = useAnimatedStyle(() => {
    'worklet';
    const fW = sv.bW.value;
    const fH = sv.bH.value;
    const mW = fW * 1.08;
    const mH = fH * 0.62;
    return {
      position: 'absolute',
      width: mW, height: mH,
      left:  sv.bX.value - fW * 0.04,
      top:   sv.bY.value + fH * 0.02,
      borderTopLeftRadius:     mW * 0.5,
      borderTopRightRadius:    mW * 0.5,
      borderBottomLeftRadius:  mW * 0.12,
      borderBottomRightRadius: mW * 0.12,
      overflow: 'hidden' as const,
      borderWidth: 3,
      borderColor: '#CC9900',
      transform: [{ rotate: `${clamp(sv.roll.value,-25,25)}deg` }],
      opacity: sv.detected.value * 0.94,
    };
  });

  // Eye holes: position relative to mask origin (absolute in parent View)
  const leftHole = useAnimatedStyle(() => {
    'worklet';
    const fW = sv.bW.value;
    const fH = sv.bH.value;
    const mX = sv.bX.value - fW * 0.04;
    const mY = sv.bY.value + fH * 0.02;
    const hW = clamp(fW * 0.30, 18, 80);
    const hH = clamp(fW * 0.20, 12, 50);
    return {
      position: 'absolute',
      width: hW, height: hH,
      left:  sv.leftEye.x.value - hW / 2,
      top:   sv.leftEye.y.value - hH / 2,
      borderRadius: hH * 0.5,
      backgroundColor: 'rgba(0,0,0,0.90)',
      borderWidth: 2, borderColor: '#AA7700',
      opacity: sv.detected.value,
    };
  });

  const rightHole = useAnimatedStyle(() => {
    'worklet';
    const fW = sv.bW.value;
    const hW = clamp(fW * 0.30, 18, 80);
    const hH = clamp(fW * 0.20, 12, 50);
    return {
      position: 'absolute',
      width: hW, height: hH,
      left:  sv.rightEye.x.value - hW / 2,
      top:   sv.rightEye.y.value - hH / 2,
      borderRadius: hH * 0.5,
      backgroundColor: 'rgba(0,0,0,0.90)',
      borderWidth: 2, borderColor: '#AA7700',
      opacity: sv.detected.value,
    };
  });

  return (
    <>
      <Animated.View style={maskBody} pointerEvents="none">
        <LinearGradient colors={['#8B1A1A','#C02020','#8B1A1A']} start={{x:0,y:0}} end={{x:1,y:0}} style={StyleSheet.absoluteFillObject} />
        <LinearGradient colors={['#CC9900','#FFD700','#CC9900']} start={{x:0,y:0}} end={{x:1,y:0}} style={mk.topBand} />
        <View style={[mk.diamond, { left: '20%' }]} />
        <View style={[mk.diamond, { left: '45%' }]} />
        <View style={[mk.diamond, { right: '20%' }]} />
      </Animated.View>
      {/* Eye holes render outside mask (above) to avoid clipping */}
      <Animated.View style={leftHole}  pointerEvents="none" />
      <Animated.View style={rightHole} pointerEvents="none" />
    </>
  );
}

const mk = StyleSheet.create({
  topBand: { position:'absolute', top:0, left:0, right:0, height:8 },
  diamond: { position:'absolute', top:12, width:10, height:10, backgroundColor:'#FFD700', transform:[{rotate:'45deg'}] },
});

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────
interface ARFaceOverlayProps {
  sv:        FaceSharedValues;
  filterId:  ARFilterId;
  debugMode?: boolean;
}

export function ARFaceOverlay({ sv, filterId, debugMode = false }: ARFaceOverlayProps) {
  return (
    <>
      {/* Debug bounding box — always show when debugMode=true */}
      {debugMode ? <ARDebugOverlay sv={sv} /> : null}

      {filterId === 'glasses' ? <GlassesOverlay sv={sv} /> : null}
      {filterId === 'makeup'  ? <MakeupOverlay  sv={sv} /> : null}
      {filterId === 'beauty'  ? <BeautyOverlay  sv={sv} /> : null}
      {filterId === 'hat'     ? <HatOverlay     sv={sv} /> : null}
      {filterId === 'neon'    ? <NeonOverlay    sv={sv} /> : null}
      {filterId === 'anime'   ? <AnimeOverlay   sv={sv} /> : null}
      {filterId === 'mask'    ? <MaskOverlay    sv={sv} /> : null}
    </>
  );
}

export { ARDebugOverlay };
