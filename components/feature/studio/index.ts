/**
 * components/feature/studio/index.ts — v2
 *
 * Centralized module boundary for Creator Studio tabs.
 * Each tab is fully isolated — no cross-tab imports allowed.
 *
 * Dependency tree (no circular deps):
 *   EffectsTab  → CameraCore, deeparService, SkiaEffectsLayer
 *   VideosTab   → useVideoEditor, ffmpegService, expo-video (lazy)
 *   AvatarsTab  → supabase ai-avatar function, expo-image, ImagePicker
 *   MusicTab    → Deezer API, expo-av
 *
 * Camera layer:
 *   CameraCore  → deeparService, expo-camera (lazy), deepAR lifecycle
 */
export { EffectsTab } from './EffectsTab';
export { VideosTab  } from './VideosTab';
export { AvatarsTab } from './AvatarsTab';
export { MusicTab   } from './MusicTab';
export { CameraCore } from './camera/CameraCore';
export type { CameraCoreHandle, CameraCoreProps } from './camera/CameraCore';
