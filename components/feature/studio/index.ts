/**
 * components/feature/studio/index.ts
 * 
 * Module boundary for Creator Studio tabs.
 * Each tab is isolated: no cross-tab imports.
 *
 * Load order (build hierarchy):
 *   EffectsTab    → deeparService, SkiaEffectsLayer, expo-camera (lazy)
 *   VideosTab     → ffmpegService, expo-video (lazy), expo-av, Deezer API
 *   AvatarsTab    → ai-avatar edge function, expo-image, ImagePicker
 *   MusicTab      → Deezer API, expo-av
 *
 * Native-only modules (DeepAR, expo-video, FFmpeg) are lazy-required inside
 * each tab so the preview runtime never crashes on import.
 */
export { EffectsTab } from './EffectsTab';
