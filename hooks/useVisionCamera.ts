/**
 * hooks/useVisionCamera.ts
 *
 * Web / Expo-Go stub — Metro picks this file on web builds.
 * All exports are no-ops so creator-studio renders the fallback UI
 * without crashing the bundler.
 */
import { useSharedValue } from 'react-native-reanimated';
import type { NativeFace } from './useVisionCamera.native';

export type { NativeFace };

/**
 * useARFaceProcessor — web stub.
 * Returns undefined; the Camera itself is null on web so this
 * value never reaches any <Camera frameProcessor=...> prop.
 */
export function useARFaceProcessor(
  _isActive: ReturnType<typeof useSharedValue<boolean>>,
  _onFaces: (faces: NativeFace[]) => void,
) {
  return undefined;
}
