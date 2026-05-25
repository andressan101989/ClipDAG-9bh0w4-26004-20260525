/**
 * hooks/useFaceTracking.ts  — v5 (ML Kit via frame-capture)
 *
 * Replaces expo-camera's onFacesDetected (unreliable in SDK 53) with a
 * decoupled design:
 *
 *   1. All SharedValues are declared here (same as before).
 *   2. updateFromMLKit(result) accepts a face result from
 *      @react-native-ml-kit/face-detection and pipes it into the SharedValues
 *      using the same coordinate-transform logic as v4.
 *   3. clearFace() resets detected → 0 when no face is found.
 *
 * The camera preview (CameraView) runs at full FPS with no callbacks.
 * A separate hook (useMlKitFaceDetector) captures frames periodically and
 * calls updateFromMLKit with the result.
 *
 * SharedValue contract:
 *   detected  — number  1 = face present, 0 = no face
 *   bX,bY,bW,bH — bounding box in view pixels (spring-smoothed)
 *   landmarks — 10 key points in view pixels (direct assign)
 *   roll,yaw,smile — rotation and classification values
 */

import { useSharedValue, withSpring } from 'react-native-reanimated';
import { useCallback, useRef } from 'react';
import { Platform } from 'react-native';

// ── Spring config ─────────────────────────────────────────────────────────────
const SPRING = { damping: 22, stiffness: 280, mass: 0.5 };

// ── Types ─────────────────────────────────────────────────────────────────────
export interface PointSV {
  x: ReturnType<typeof useSharedValue<number>>;
  y: ReturnType<typeof useSharedValue<number>>;
}

export interface FaceSharedValues {
  detected:    ReturnType<typeof useSharedValue<number>>;
  bX:          ReturnType<typeof useSharedValue<number>>;
  bY:          ReturnType<typeof useSharedValue<number>>;
  bW:          ReturnType<typeof useSharedValue<number>>;
  bH:          ReturnType<typeof useSharedValue<number>>;
  leftEye:     PointSV;
  rightEye:    PointSV;
  noseBase:    PointSV;
  leftMouth:   PointSV;
  rightMouth:  PointSV;
  bottomMouth: PointSV;
  leftCheek:   PointSV;
  rightCheek:  PointSV;
  leftEar:     PointSV;
  rightEar:    PointSV;
  roll:        ReturnType<typeof useSharedValue<number>>;
  yaw:         ReturnType<typeof useSharedValue<number>>;
  smile:       ReturnType<typeof useSharedValue<number>>;
  // Debug raw coords
  rawBX:       ReturnType<typeof useSharedValue<number>>;
  rawBY:       ReturnType<typeof useSharedValue<number>>;
  rawBW:       ReturnType<typeof useSharedValue<number>>;
  rawBH:       ReturnType<typeof useSharedValue<number>>;
}

/**
 * Normalised face result — common shape accepted by updateFromMLKit.
 * Both ML Kit and the legacy expo-camera callback can be adapted to this shape.
 */
export interface NormalisedFace {
  /** Bounding box in the coordinate space of the *image* that was processed */
  bounds: { x: number; y: number; width: number; height: number };
  /** Image dimensions used for the detection (pixels) */
  imageSize: { width: number; height: number };
  landmarks?: {
    leftEye?:     { x: number; y: number };
    rightEye?:    { x: number; y: number };
    noseBase?:    { x: number; y: number };
    leftMouth?:   { x: number; y: number };
    rightMouth?:  { x: number; y: number };
    bottomMouth?: { x: number; y: number };
    leftCheek?:   { x: number; y: number };
    rightCheek?:  { x: number; y: number };
    leftEar?:     { x: number; y: number };
    rightEar?:    { x: number; y: number };
  };
  angles?: {
    roll?:  number;
    yaw?:   number;
    smile?: number;
  };
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useFaceTracking(params: {
  viewWidth:  number;
  viewHeight: number;
  facing:     'front' | 'back';
}) {
  const { viewWidth, viewHeight, facing } = params;

  // ── All SharedValues declared directly in hook body ───────────────────────
  const detected    = useSharedValue<number>(0);
  const bX          = useSharedValue<number>(0);
  const bY          = useSharedValue<number>(0);
  const bW          = useSharedValue<number>(100);
  const bH          = useSharedValue<number>(100);
  const rawBX       = useSharedValue<number>(0);
  const rawBY       = useSharedValue<number>(0);
  const rawBW       = useSharedValue<number>(100);
  const rawBH       = useSharedValue<number>(100);
  const leftEyeX    = useSharedValue<number>(0);
  const leftEyeY    = useSharedValue<number>(0);
  const rightEyeX   = useSharedValue<number>(0);
  const rightEyeY   = useSharedValue<number>(0);
  const noseBaseX   = useSharedValue<number>(0);
  const noseBaseY   = useSharedValue<number>(0);
  const leftMouthX  = useSharedValue<number>(0);
  const leftMouthY  = useSharedValue<number>(0);
  const rightMouthX = useSharedValue<number>(0);
  const rightMouthY = useSharedValue<number>(0);
  const botMouthX   = useSharedValue<number>(0);
  const botMouthY   = useSharedValue<number>(0);
  const leftCheekX  = useSharedValue<number>(0);
  const leftCheekY  = useSharedValue<number>(0);
  const rightCheekX = useSharedValue<number>(0);
  const rightCheekY = useSharedValue<number>(0);
  const leftEarX    = useSharedValue<number>(0);
  const leftEarY    = useSharedValue<number>(0);
  const rightEarX   = useSharedValue<number>(0);
  const rightEarY   = useSharedValue<number>(0);
  const roll        = useSharedValue<number>(0);
  const yaw         = useSharedValue<number>(0);
  const smile       = useSharedValue<number>(0);

  const sv: FaceSharedValues = {
    detected,
    bX, bY, bW, bH,
    rawBX, rawBY, rawBW, rawBH,
    leftEye:     { x: leftEyeX,    y: leftEyeY    },
    rightEye:    { x: rightEyeX,   y: rightEyeY   },
    noseBase:    { x: noseBaseX,   y: noseBaseY   },
    leftMouth:   { x: leftMouthX,  y: leftMouthY  },
    rightMouth:  { x: rightMouthX, y: rightMouthY },
    bottomMouth: { x: botMouthX,   y: botMouthY   },
    leftCheek:   { x: leftCheekX,  y: leftCheekY  },
    rightCheek:  { x: rightCheekX, y: rightCheekY },
    leftEar:     { x: leftEarX,    y: leftEarY    },
    rightEar:    { x: rightEarX,   y: rightEarY   },
    roll, yaw, smile,
  };

  // ── Update from ML Kit result ─────────────────────────────────────────────
  const updateFromMLKit = useCallback((face: NormalisedFace) => {
    const { bounds, imageSize, landmarks, angles } = face;

    // Scale from image space → view space
    const sx = viewWidth  / Math.max(1, imageSize.width);
    const sy = viewHeight / Math.max(1, imageSize.height);

    // Raw coords (for debug)
    rawBX.value = bounds.x;
    rawBY.value = bounds.y;
    rawBW.value = bounds.width;
    rawBH.value = bounds.height;

    // Scaled bounding box
    const scaledW = bounds.width  * sx;
    const scaledH = bounds.height * sy;
    const scaledX = facing === 'front'
      ? viewWidth - (bounds.x * sx) - scaledW  // mirror for selfie cam
      : bounds.x * sx;
    const scaledY = bounds.y * sy;

    bX.value = withSpring(scaledX, SPRING);
    bY.value = withSpring(scaledY, SPRING);
    bW.value = withSpring(scaledW, SPRING);
    bH.value = withSpring(scaledH, SPRING);

    // Convert a landmark point from image space → view space (with mirroring)
    const pt = (p: { x: number; y: number } | undefined) => {
      if (!p) return { x: scaledX + scaledW / 2, y: scaledY + scaledH / 2 };
      const vx = facing === 'front' ? viewWidth - p.x * sx : p.x * sx;
      const vy = p.y * sy;
      return { x: vx, y: vy };
    };

    const lm = landmarks ?? {};
    const le  = pt(lm.leftEye);
    const re  = pt(lm.rightEye);
    const nb  = pt(lm.noseBase);
    const lmo = pt(lm.leftMouth);
    const rmo = pt(lm.rightMouth);
    const bm  = pt(lm.bottomMouth);
    const lc  = pt(lm.leftCheek);
    const rc  = pt(lm.rightCheek);
    const lear = pt(lm.leftEar);
    const rear = pt(lm.rightEar);

    leftEyeX.value    = le.x;    leftEyeY.value    = le.y;
    rightEyeX.value   = re.x;    rightEyeY.value   = re.y;
    noseBaseX.value   = nb.x;    noseBaseY.value   = nb.y;
    leftMouthX.value  = lmo.x;   leftMouthY.value  = lmo.y;
    rightMouthX.value = rmo.x;   rightMouthY.value = rmo.y;
    botMouthX.value   = bm.x;    botMouthY.value   = bm.y;
    leftCheekX.value  = lc.x;    leftCheekY.value  = lc.y;
    rightCheekX.value = rc.x;    rightCheekY.value = rc.y;
    leftEarX.value    = lear.x;  leftEarY.value    = lear.y;
    rightEarX.value   = rear.x;  rightEarY.value   = rear.y;

    roll.value  = angles?.roll  ?? 0;
    yaw.value   = angles?.yaw   ?? 0;
    smile.value = angles?.smile ?? 0;

    detected.value = 1;
  }, [viewWidth, viewHeight, facing]);

  // ── Clear (no face found) ─────────────────────────────────────────────────
  const clearFace = useCallback(() => {
    detected.value = 0;
  }, []);

  // ── Legacy shim: onFacesDetected compatible with old expo-camera format ───
  // Kept for compatibility; not used when ML Kit is active
  const onFacesDetected = useCallback((event: any) => {
    const faces: any[] = event?.faces ?? [];
    if (faces.length === 0) { clearFace(); return; }
    const f = faces[0];
    updateFromMLKit({
      bounds: {
        x: f.bounds?.origin?.x ?? 0,
        y: f.bounds?.origin?.y ?? 0,
        width:  f.bounds?.size?.width  ?? 100,
        height: f.bounds?.size?.height ?? 100,
      },
      // Legacy callback doesn't provide image size — assume view space
      imageSize: { width: viewWidth, height: viewHeight },
      landmarks: {
        leftEye:     f.leftEyePosition,
        rightEye:    f.rightEyePosition,
        noseBase:    f.noseBasePosition,
        leftMouth:   f.leftMouthPosition,
        rightMouth:  f.rightMouthPosition,
        bottomMouth: f.bottomMouthPosition,
        leftCheek:   f.leftCheekPosition,
        rightCheek:  f.rightCheekPosition,
        leftEar:     f.leftEarPosition,
        rightEar:    f.rightEarPosition,
      },
      angles: {
        roll:  f.rollAngle,
        yaw:   f.yawAngle,
        smile: f.smilingProbability,
      },
    });
  }, [updateFromMLKit, clearFace, viewWidth, viewHeight]);

  return { sv, updateFromMLKit, clearFace, onFacesDetected };
}
