/**
 * services/deeparService.ts
 *
 * DeepAR integration — ACTIVE.
 *
 * Keys loaded from .env:
 *   EXPO_PUBLIC_DEEPAR_API_KEY_ANDROID
 *   EXPO_PUBLIC_DEEPAR_API_KEY_IOS
 *
 * ══ EAS BUILD SETUP ══════════════════════════════════════════════════════════
 *
 *  1. pnpm add react-native-deepar
 *
 *  Android (auto via EAS Build):
 *   - minSdkVersion 23, compileSdkVersion 35 (already set in app.json)
 *   - Proguard rules auto-applied by EAS Build
 *
 *  iOS (manual — ONE TIME in Xcode after eas prebuild):
 *   - Download DeepAR.xcframework from developer.deepar.ai/downloads
 *   - Drag into Xcode → Build Phases → Link Binary With Libraries
 *   - Set "Embed and Sign" in Frameworks, Libraries, and Embedded Content
 *
 *  2. Run: eas build --profile development --platform android (or ios)
 *
 * ════════════════════════════════════════════════════════════════════════════
 */

import { Platform } from 'react-native';

// ── ACTIVE — set to false to fall back to Skia/Reanimated effects ────────────
export const DEEPAR_ENABLED = true;

// ── Platform-specific API keys ────────────────────────────────────────────────
export const DEEPAR_API_KEY_IOS     = process.env.EXPO_PUBLIC_DEEPAR_API_KEY_IOS     ?? 'b5ed95b597e2d095a99d348245484f5ca0ea76dd4297a6e03d0a0b630cb2f2b4511186a4577ef72a';
export const DEEPAR_API_KEY_ANDROID = process.env.EXPO_PUBLIC_DEEPAR_API_KEY_ANDROID ?? '26eb786956b608da971d30ec64fc5bcec72ce89cd1914b3cfc5ed32c3232f6da70a5923630b8696b';

// Active key for current platform
export const DEEPAR_API_KEY = Platform.select({
  ios:     DEEPAR_API_KEY_IOS,
  android: DEEPAR_API_KEY_ANDROID,
  default: DEEPAR_API_KEY_ANDROID,
}) ?? '';

// ── Lazy-load react-native-deepar ────────────────────────────────────────────
let DeepARModule: any = null;

try {
  if (DEEPAR_ENABLED) {
    DeepARModule = require('react-native-deepar');
    console.log('[DeepAR] SDK loaded successfully');
  }
} catch (e) {
  console.warn('[DeepAR] Not compiled in EAS Build yet. Run: pnpm add react-native-deepar then rebuild.');
}

export const DeepAR           = DeepARModule?.default ?? DeepARModule?.DeepAR ?? null;
export const DeepARCamera     = DeepARModule?.Camera  ?? null;
export const DeepARCameraKit  = DeepARModule          ?? null;

export const isDeepARAvailable = () =>
  DEEPAR_ENABLED &&
  !!DeepARCamera &&
  DEEPAR_API_KEY.length > 10;

// ─────────────────────────────────────────────────────────────────────────────
// AR FILTER CATALOG
// These match DeepAR's free filter pack:
// https://docs.deepar.ai/deep-ar-studio/free-filter-pack
// ─────────────────────────────────────────────────────────────────────────────
export interface DeepARFilter {
  id:          string;
  name:        string;
  emoji:       string;
  category:    'face' | 'beauty' | 'background' | 'social';
  /** Path to bundled .deepar file, OR remote URL */
  path:        string;
  description: string;
}

/**
 * DeepAR Free Filter Pack effects.
 * Files hosted on DeepAR CDN — no local bundling required.
 * Loaded on-demand via switchDeepAREffect → switchEffectWithPath using rn-fetch-blob cache.
 *
 * Free pack: https://docs.deepar.ai/deep-ar-studio/free-filter-pack
 * CDN base:  https://s3.amazonaws.com/deepar-assets/filter-pack/
 */
const DEEPAR_CDN = 'https://s3.amazonaws.com/deepar-assets/filter-pack/';

export const DEEPAR_FILTERS: DeepARFilter[] = [
  // ── Face filters ────────────────────────────────────────────────────────
  {
    id: 'flower_crown',      name: 'Corona',       emoji: '🌸', category: 'face',
    path: `${DEEPAR_CDN}flower_crown`,
    description: 'Corona de flores animada sobre la cabeza',
  },
  {
    id: 'lion',              name: 'León',          emoji: '🦁', category: 'face',
    path: `${DEEPAR_CDN}lion`,
    description: 'Máscara facial de león 3D con animación',
  },
  {
    id: 'viking_helmet',     name: 'Viking',        emoji: '🪖', category: 'face',
    path: `${DEEPAR_CDN}viking_helmet`,
    description: 'Casco vikingo con cuernos animados',
  },
  {
    id: 'aviators',          name: 'Aviador',       emoji: '😎', category: 'face',
    path: `${DEEPAR_CDN}aviators`,
    description: 'Gafas de aviador vintage',
  },
  {
    id: 'dalmatian',         name: 'Perrito',       emoji: '🐶', category: 'face',
    path: `${DEEPAR_CDN}dalmatian`,
    description: 'Filtro de perrito dálmata con orejas',
  },
  {
    id: 'pug',               name: 'Pug',           emoji: '🐾', category: 'face',
    path: `${DEEPAR_CDN}pug`,
    description: 'Filtro de cara de pug animado',
  },
  {
    id: 'beard',             name: 'Barba',         emoji: '🧔', category: 'face',
    path: `${DEEPAR_CDN}beard`,
    description: 'Barba hipster animada',
  },
  // ── Beauty filters ───────────────────────────────────────────────────────
  {
    id: 'beauty',            name: 'Beauty',        emoji: '✨', category: 'beauty',
    path: `${DEEPAR_CDN}beauty`,
    description: 'Suavizado de piel + mejora facial',
  },
  {
    id: 'makeup',            name: 'Maquillaje',    emoji: '💄', category: 'beauty',
    path: `${DEEPAR_CDN}makeup`,
    description: 'Maquillaje completo con labios y ojos',
  },
  {
    id: 'face_painting',     name: 'Face Paint',    emoji: '🎨', category: 'beauty',
    path: `${DEEPAR_CDN}face_painting`,
    description: 'Pintura artística facial',
  },
  // ── Background filters ────────────────────────────────────────────────────
  {
    id: 'galaxy_segmentation', name: 'Galaxia',     emoji: '🌌', category: 'background',
    path: `${DEEPAR_CDN}galaxy_segmentation`,
    description: 'Fondo de galaxia con eliminación de fondo',
  },
  {
    id: 'background_segmentation', name: 'Sin fondo', emoji: '🫧', category: 'background',
    path: `${DEEPAR_CDN}background_segmentation`,
    description: 'Eliminación de fondo en tiempo real',
  },
  // ── Social / fun ─────────────────────────────────────────────────────────
  {
    id: 'fire',              name: 'Fuego',         emoji: '🔥', category: 'social',
    path: `${DEEPAR_CDN}fire`,
    description: 'Llamas animadas alrededor de la cara',
  },
  {
    id: 'disco',             name: 'Disco',         emoji: '🪩', category: 'social',
    path: `${DEEPAR_CDN}disco`,
    description: 'Luces de discoteca psicodélicas',
  },
  {
    id: 'hope',              name: 'Hope',          emoji: '🦋', category: 'social',
    path: `${DEEPAR_CDN}hope`,
    description: 'Mariposas y flores alrededor del rostro',
  },
  {
    id: 'ping_pong',         name: 'Ping Pong',     emoji: '🏓', category: 'social',
    path: `${DEEPAR_CDN}ping_pong`,
    description: 'Juego interactivo de ping pong facial',
  },
  {
    id: 'burning_effect',    name: 'Burning',       emoji: '💀', category: 'social',
    path: `${DEEPAR_CDN}burning_effect`,
    description: 'Cara en llamas con efecto de fuego',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checks if all prerequisites for DeepAR are met and returns a status report.
 * Use this to show appropriate UI to the user.
 */
export function getDeepARStatus(): {
  ready:         boolean;
  hasPackage:    boolean;
  hasApiKey:     boolean;
  isEnabled:     boolean;
  instructions:  string[];
} {
  const hasPackage = !!DeepARModule;
  const hasApiKey  = !!DEEPAR_API_KEY && DEEPAR_API_KEY.length > 10;
  const isEnabled  = DEEPAR_ENABLED;
  const ready      = isEnabled && hasPackage && hasApiKey;

  const instructions: string[] = [];
  if (!isEnabled)  instructions.push('Set DEEPAR_ENABLED = true in services/deeparService.ts');
  if (!hasApiKey)  instructions.push('Add EXPO_PUBLIC_DEEPAR_API_KEY to .env file');
  if (!hasPackage) instructions.push('Run: pnpm add react-native-deepar');
  if (!ready)      instructions.push('Rebuild EAS Build after all above steps');

  return { ready, hasPackage, hasApiKey, isEnabled, instructions };
}

/**
 * Switch the active DeepAR AR effect via the camera ref.
 * Supports both local bundled paths and remote CDN URLs.
 * No-op if DeepAR not available.
 */
export function switchDeepAREffect(deepARRef: React.MutableRefObject<any>, filter: DeepARFilter) {
  if (!isDeepARAvailable() || !deepARRef.current) return;
  try {
    const isRemote = filter.path.startsWith('http');
    if (isRemote) {
      // Use switchEffectWithPath for remote/cached paths
      deepARRef.current.switchEffectWithPath({
        path: filter.path,
        slot: 'effect',
      });
    } else {
      deepARRef.current.switchEffect({
        slot: 'effect',
        path: filter.path,
      });
    }
    console.log('[DeepAR] Effect switched to:', filter.id);
  } catch (e) {
    console.warn('[DeepAR] switchEffect failed:', e);
  }
}

/**
 * Clear/reset the active DeepAR effect (return to plain camera).
 */
export function clearDeepAREffect(deepARRef: React.MutableRefObject<any>) {
  if (!isDeepARAvailable() || !deepARRef.current) return;
  try {
    deepARRef.current.clearEffect({ slot: 'effect' });
  } catch (e) {
    console.warn('[DeepAR] clearEffect failed:', e);
  }
}

/**
 * Set DeepAR beauty parameters.
 * Accepts values 0.0 (off) to 1.0 (max).
 */
export function setBeautyParams(deepARRef: React.MutableRefObject<any>, params: {
  smoothing?:  number;
  teeth?:      number;
  eyes?:       number;
}) {
  if (!isDeepARAvailable() || !deepARRef.current) return;
  try {
    if (params.smoothing !== undefined) {
      deepARRef.current.changeParameter('softening', 'blur', params.smoothing);
    }
    if (params.teeth !== undefined) {
      deepARRef.current.changeParameter('teeth_whitening', 'strength', params.teeth);
    }
  } catch (e) {
    console.warn('[DeepAR] setBeautyParams failed:', e);
  }
}

/**
 * Take a photo with the current AR effect applied.
 * DeepAR fires onScreenshotTaken on the Camera component — pass the callback
 * via props, this function just triggers the capture.
 */
export function triggerDeepARScreenshot(deepARRef: React.MutableRefObject<any>) {
  if (!isDeepARAvailable() || !deepARRef.current) return;
  try {
    deepARRef.current.takeScreenshot();
  } catch (e) {
    console.warn('[DeepAR] takeScreenshot failed:', e);
  }
}

/**
 * Start video recording with current AR effect.
 * DeepAR fires onVideoRecordingFinished on the Camera component.
 */
export function startDeepARRecording(deepARRef: React.MutableRefObject<any>) {
  if (!isDeepARAvailable() || !deepARRef.current) return;
  try {
    deepARRef.current.startRecording({ maxDuration: 60 });
  } catch (e) {
    console.warn('[DeepAR] startRecording failed:', e);
  }
}

export function stopDeepARRecording(deepARRef: React.MutableRefObject<any>) {
  if (!isDeepARAvailable() || !deepARRef.current) return;
  try {
    deepARRef.current.stopRecording();
  } catch (e) {
    console.warn('[DeepAR] stopRecording failed:', e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DEEPAR CAMERA COMPONENT WRAPPER
// Returns null if DeepAR not enabled — caller falls back to expo-camera
// ─────────────────────────────────────────────────────────────────────────────
export { DeepARCamera as DeepARCameraComponent };

/**
 * When DeepAR is enabled, replace CameraView with DeepARCamera in EffectsTab.
 * Example usage in creator-studio.tsx EffectsTab:
 *
 *   import { DeepARCameraComponent, DEEPAR_API_KEY, isDeepARAvailable } from '@/services/deeparService';
 *
 *   {isDeepARAvailable() ? (
 *     <DeepARCameraComponent
 *       ref={deepARRef}
 *       apiKey={DEEPAR_API_KEY}
 *       style={StyleSheet.absoluteFillObject}
 *       facing="front"
 *       onInitialized={() => console.log('DeepAR ready')}
 *       onScreenshotTaken={(path) => handleCapture(path)}
 *       onError={(text, type) => console.error('DeepAR error:', text, type)}
 *     />
 *   ) : (
 *     <CameraView ref={cameraRef} style={StyleSheet.absoluteFillObject} facing={facing} mode="video" />
 *   )}
 */
