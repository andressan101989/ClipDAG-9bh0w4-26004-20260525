/**
 * components/feature/studio/index.ts
 *
 * Centralized module boundary for Creator Studio tabs.
 * Each tab is fully isolated — no cross-tab imports allowed.
 *
 * Dependency tree (no circular deps):
 *   EffectsTab   → deeparService, SkiaEffectsLayer, expo-camera (lazy)
 *   VideosTab    → ffmpegService, expo-video (lazy), expo-av, Deezer API
 *   AvatarsTab   → supabase ai-avatar function, expo-image, ImagePicker
 *   MusicTab     → Deezer API, expo-av
 *
 * All native-only modules are lazy-required inside each tab so the
 * preview runtime never crashes on import.
 */
export { EffectsTab } from './EffectsTab';
export { VideosTab }  from './VideosTab';
export { AvatarsTab } from './AvatarsTab';
export { MusicTab }   from './MusicTab';
