/**
 * hooks/useVisionCamera.native.ts
 *
 * Native stub — Metro picks this over useVisionCamera.ts on iOS/Android.
 *
 * react-native-vision-camera@5.0.10 has a broken pnpm installation
 * (lib/index.js imports ./CameraDevices which does not exist), causing
 * Node.js ESM resolution to crash even when the file is a .native.ts stub.
 *
 * Strategy: zero top-level VisionCamera imports.
 * Camera rendering and face detection are handled directly by creator-studio.tsx
 * via expo-camera (CameraView + onFacesDetected), which works in Expo Go and
 * EAS Build without frame-processor compilation.
 *
 * For production VisionCamera + ML Kit frame processors, a Dev Client build
 * with VisionCamera properly compiled is required. At that point, re-enable
 * the real imports once the pnpm resolution issue is resolved.
 */
import { useSharedValue } from 'react-native-reanimated';

// ── Face data shape shared with creator-studio.tsx ───────────────────────────
export interface NativeFace {
  faceID?: number;
  bounds: {
    origin: { x: number; y: number };
    size:   { width: number; height: number };
  };
  rollAngle?: number;
  yawAngle?:  number;
  smilingProbability?: number;
  LEFT_EYE?:    { x: number; y: number };
  RIGHT_EYE?:   { x: number; y: number };
  LEFT_EAR?:    { x: number; y: number };
  RIGHT_EAR?:   { x: number; y: number };
  NOSE_BASE?:   { x: number; y: number };
  LEFT_CHEEK?:  { x: number; y: number };
  RIGHT_CHEEK?: { x: number; y: number };
  LEFT_MOUTH?:  { x: number; y: number };
  RIGHT_MOUTH?: { x: number; y: number };
  BOTTOM_MOUTH?:{ x: number; y: number };
}

/**
 * useARFaceProcessor — native stub (no VisionCamera frame processor).
 * Face detection is handled by expo-camera's onFacesDetected prop instead.
 * Returns undefined so <Camera frameProcessor={undefined}> skips frame processing.
 */
export function useARFaceProcessor(
  _isActive: ReturnType<typeof useSharedValue<boolean>>,
  _onFaces: (faces: NativeFace[]) => void,
) {
  return undefined;
}
