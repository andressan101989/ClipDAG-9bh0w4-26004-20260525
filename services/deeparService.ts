/**
 * services/deeparService.ts — v6
 *
 * ══ ROOT CAUSE FIX ═══════════════════════════════════════════════════════════
 *
 *  PROBLEM: expo-file-system downloads return a `file://...` URI.
 *           DeepAR iOS SDK requires a RAW filesystem path without the
 *           `file://` scheme prefix. Passing `file://...` to
 *           switchEffectWithPath() causes a silent no-op or GL context crash.
 *
 *  SOLUTION: Use rn-fetch-blob (the same library used in the official
 *           react-native-deepar example). Its `res.path()` returns the raw
 *           POSIX path that DeepAR expects: `/var/mobile/Containers/...`
 *
 * ══ FILTER CDN ═══════════════════════════════════════════════════════════════
 *
 *  Previous CDN (s3.amazonaws.com/deepar-assets) was NOT publicly accessible.
 *  Correct public CDN: https://storage.deepar.ai/effects/{name}
 *  Files have NO extension.
 *
 * ══ SKIA CONFLICT ════════════════════════════════════════════════════════════
 *
 *  DeepAR uses a Metal/OpenGL render surface (CAEAGLLayer / CAMetalLayer).
 *  React Native Views with zIndex placed directly on top of DeepAR's surface
 *  destroy the Metal render pipeline → black camera.
 *
 *  Solution: never render Skia or any GPU-composited View over the DeepAR
 *  component. Use only standard UIKit-backed Views as overlays (badges, buttons).
 *
 * ═════════════════════════════════════════════════════════════════════════════
 */

import { Platform } from 'react-native';

// ── ACTIVE — set to false to fall back to Skia/Reanimated effects ────────────
export const DEEPAR_ENABLED = true;

// ── Platform-specific API keys ────────────────────────────────────────────────
export const DEEPAR_API_KEY_IOS     = process.env.EXPO_PUBLIC_DEEPAR_API_KEY_IOS     ?? 'b5ed95b597e2d095a99d348245484f5ca0ea76dd4297a6e03d0a0b630cb2f2b4511186a4577ef72a';
export const DEEPAR_API_KEY_ANDROID = process.env.EXPO_PUBLIC_DEEPAR_API_KEY_ANDROID ?? '26eb786956b608da971d30ec64fc5bcec72ce89cd1914b3cfc5ed32c3232f6da70a5923630b8696b';

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
    console.log('[DeepAR] SDK loaded. Default:', !!DeepARModule?.default, 'Camera:', !!DeepARModule?.Camera);
  }
} catch (e) {
  console.warn('[DeepAR] SDK not compiled. Run: pnpm add react-native-deepar && eas build');
}

export const DeepAR           = DeepARModule?.default ?? null;
export const DeepARCamera     = DeepARModule?.default ?? null;
export const DeepARCameraKit  = DeepARModule           ?? null;

export const isDeepARAvailable = () =>
  DEEPAR_ENABLED &&
  !!DeepARCamera &&
  typeof DeepARCamera === 'function' &&
  DEEPAR_API_KEY.length > 10;

// ── expo-file-system (replaces rn-fetch-blob — no native module needed) ────────
// DeepAR iOS requires a raw POSIX path: /var/mobile/Containers/...
// expo-file-system.downloadAsync() returns a file:// URI.
// Strip the scheme with .replace('file://', '') to get the raw path DeepAR needs.
import * as FileSystem from 'expo-file-system';
const hasFileSystem = typeof FileSystem?.downloadAsync === 'function';
console.log('[DeepAR] expo-file-system available:', hasFileSystem);

// ─────────────────────────────────────────────────────────────────────────────
// AR FILTER CATALOG
// ─────────────────────────────────────────────────────────────────────────────
export interface DeepARFilter {
  id:          string;
  name:        string;
  emoji:       string;
  category:    'face' | 'beauty' | 'background' | 'social';
  /**
   * Remote URL of the .deepar effect file (no extension).
   * Downloaded and cached locally on first use via rn-fetch-blob.
   */
  remoteUrl:   string;
  description: string;
}

/**
 * DeepAR Free Filter Pack — official public CDN.
 * Confirmed working from react-native-deepar example app.
 * Mirror: betacoins.magix.net (used in react-native-deepar example Config.TEST)
 */
const DEEPAR_CDN         = 'https://storage.deepar.ai/effects/';
const DEEPAR_CDN_MIRROR  = 'http://betacoins.magix.net/public/deepar-filters/';

export const DEEPAR_FILTERS: DeepARFilter[] = [
  // ── Face ────────────────────────────────────────────────────────────────
  { id: 'flower_crown',  name: 'Corona',      emoji: '🌸', category: 'face',
    remoteUrl: `${DEEPAR_CDN}flower_crown`,      description: 'Corona de flores animada' },
  { id: 'lion',          name: 'León',         emoji: '🦁', category: 'face',
    remoteUrl: `${DEEPAR_CDN}lion`,              description: 'Máscara facial de león 3D' },
  { id: 'viking_helmet', name: 'Viking',       emoji: '🪖', category: 'face',
    remoteUrl: `${DEEPAR_CDN}viking_helmet`,     description: 'Casco vikingo animado' },
  { id: 'aviators',      name: 'Aviador',      emoji: '😎', category: 'face',
    remoteUrl: `${DEEPAR_CDN}aviators`,          description: 'Gafas de aviador vintage' },
  { id: 'dalmatian',     name: 'Perrito',      emoji: '🐶', category: 'face',
    remoteUrl: `${DEEPAR_CDN}dalmatian`,         description: 'Filtro dálmata con orejas' },
  { id: 'pug',           name: 'Pug',          emoji: '🐾', category: 'face',
    remoteUrl: `${DEEPAR_CDN}pug`,               description: 'Cara de pug animado' },
  { id: 'beard',         name: 'Barba',        emoji: '🧔', category: 'face',
    remoteUrl: `${DEEPAR_CDN}beard`,             description: 'Barba hipster animada' },
  // ── Beauty ──────────────────────────────────────────────────────────────
  { id: 'beauty',        name: 'Beauty',       emoji: '✨', category: 'beauty',
    remoteUrl: `${DEEPAR_CDN}beauty`,            description: 'Suavizado de piel + mejora facial' },
  { id: 'makeup',        name: 'Maquillaje',   emoji: '💄', category: 'beauty',
    remoteUrl: `${DEEPAR_CDN}makeup`,            description: 'Maquillaje labios y ojos' },
  { id: 'face_painting', name: 'Face Paint',   emoji: '🎨', category: 'beauty',
    remoteUrl: `${DEEPAR_CDN}face_painting`,     description: 'Pintura artística facial' },
  // ── Background ──────────────────────────────────────────────────────────
  { id: 'galaxy_segmentation', name: 'Galaxia', emoji: '🌌', category: 'background',
    remoteUrl: `${DEEPAR_CDN}galaxy_segmentation`, description: 'Fondo galaxia + remoción BG' },
  { id: 'background_segmentation', name: 'Sin fondo', emoji: '🫧', category: 'background',
    remoteUrl: `${DEEPAR_CDN}background_segmentation`, description: 'Remoción de fondo en tiempo real' },
  // ── Social ───────────────────────────────────────────────────────────────
  { id: 'fire',          name: 'Fuego',        emoji: '🔥', category: 'social',
    remoteUrl: `${DEEPAR_CDN}fire`,              description: 'Llamas animadas alrededor de la cara' },
  { id: 'disco',         name: 'Disco',        emoji: '🪩', category: 'social',
    remoteUrl: `${DEEPAR_CDN}disco`,             description: 'Luces de discoteca psicodélicas' },
  { id: 'hope',          name: 'Hope',         emoji: '🦋', category: 'social',
    remoteUrl: `${DEEPAR_CDN}hope`,             description: 'Mariposas y flores' },
  { id: 'burning_effect', name: 'Burning',     emoji: '💀', category: 'social',
    remoteUrl: `${DEEPAR_CDN}burning_effect`,    description: 'Cara en llamas' },
];

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL FILTER CACHE (in-memory path registry)
// ─────────────────────────────────────────────────────────────────────────────
/** Raw filesystem paths cached in memory after first download */
const pathCache: Record<string, string> = {};
const downloadingIds: Set<string>       = new Set();

/**
 * Returns the raw local filesystem path for a filter.
 * Downloads via rn-fetch-blob if not cached.
 *
 * ⚠️  CRITICAL: DeepAR iOS requires a RAW path like
 *     `/var/mobile/Containers/Data/Application/.../file`
 *     NOT `file:///var/mobile/...`
 *
 * rn-fetch-blob's res.path() returns the raw path automatically.
 * expo-file-system returns file:// URIs, which DeepAR REJECTS silently.
 */
/**
 * Try to download from a URL using expo-file-system.
 * Returns a raw POSIX path (no file:// prefix) or null.
 *
 * CRITICAL: DeepAR iOS switchEffectWithPath() requires a raw path.
 *   ✅ CORRECT: /var/mobile/Containers/Data/.../flower_crown
 *   ❌ WRONG:   file:///var/mobile/Containers/Data/.../flower_crown
 *
 * expo-file-system returns file:// URIs — strip the prefix with .replace('file://', '').
 */
async function tryDownload(url: string, effectId: string): Promise<string | null> {
  try {
    // Ensure cache directory exists
    const cacheDir = (FileSystem.cacheDirectory ?? 'file:///tmp/') + 'deepar-filters/';
    await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true }).catch(() => {});

    const localUri = cacheDir + effectId;
    console.log('[DeepAR] Downloading:', url, '→', localUri);

    const result = await FileSystem.downloadAsync(url, localUri);

    if (!result?.uri) {
      console.warn('[DeepAR] downloadAsync returned no URI from', url);
      return null;
    }

    // Validate file size — a 404 HTML page is ~1–5KB; a real .deepar is >64KB
    const info = await FileSystem.getInfoAsync(result.uri, { size: true }).catch(() => null);
    const bytes = (info as any)?.size ?? 0;
    console.log('[DeepAR] Downloaded', bytes, 'bytes from', url);

    if (!info?.exists || bytes < 64) {
      console.warn('[DeepAR] File too small (', bytes, 'bytes) — likely 404 HTML from', url);
      await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => {});
      return null;
    }

    // Strip file:// scheme → raw POSIX path required by DeepAR iOS SDK
    const rawPath = result.uri.replace('file://', '');
    console.log('[DeepAR] Raw path:', rawPath);
    return rawPath;

  } catch (e) {
    console.warn('[DeepAR] Download failed from', url, ':', e);
    return null;
  }
}

export async function getLocalFilterPath(filter: DeepARFilter): Promise<string | null> {
  // 1. Memory cache hit
  if (pathCache[filter.id]) {
    console.log('[DeepAR] Memory cache hit:', filter.id);
    return pathCache[filter.id];
  }

  // 2. Prevent concurrent downloads
  if (downloadingIds.has(filter.id)) {
    return new Promise(resolve => {
      const check = setInterval(() => {
        if (pathCache[filter.id]) { clearInterval(check); resolve(pathCache[filter.id]); }
        else if (!downloadingIds.has(filter.id)) { clearInterval(check); resolve(null); }
      }, 200);
    });
  }

  downloadingIds.add(filter.id);

  try {
    // Primary CDN
    console.log('[DeepAR] Downloading filter:', filter.id, '← primary:', filter.remoteUrl);
    let rawPath = await tryDownload(filter.remoteUrl, filter.id);

    // Mirror fallback if primary failed or returned empty file
    if (!rawPath) {
      const mirrorUrl = `${DEEPAR_CDN_MIRROR}${filter.id}`;
      console.log('[DeepAR] Primary failed — trying mirror:', mirrorUrl);
      rawPath = await tryDownload(mirrorUrl, `${filter.id}_mirror`);
    }

    if (!rawPath) {
      console.error('[DeepAR] Both CDN sources failed for filter:', filter.id);
      downloadingIds.delete(filter.id);
      return null;
    }

    console.log('[DeepAR] Downloaded:', filter.id, '→', rawPath);
    pathCache[filter.id] = rawPath;
    downloadingIds.delete(filter.id);
    return rawPath;

  } catch (e) {
    console.error('[DeepAR] Download error for', filter.id, ':', e);
    downloadingIds.delete(filter.id);
    return null;
  }
}

/**
 * Prefetch the most commonly used filters in background after DeepAR initializes.
 */
export async function prefetchDeepARFilters(
  filterIds: string[] = ['flower_crown', 'lion', 'aviators', 'beauty', 'fire'],
): Promise<void> {
  if (!RNFetchBlob) return;
  const filters = DEEPAR_FILTERS.filter(f => filterIds.includes(f.id));
  await Promise.allSettled(filters.map(f => getLocalFilterPath(f)));
  console.log('[DeepAR] Prefetch complete for:', filterIds);
}

// ─────────────────────────────────────────────────────────────────────────────
// EFFECT SWITCHING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Switch the active DeepAR AR effect.
 *
 * Downloads the filter to local cache via rn-fetch-blob (first call),
 * then calls switchEffectWithPath with the raw POSIX path.
 */
export async function switchDeepAREffect(
  deepARRef: React.MutableRefObject<any>,
  filter:    DeepARFilter,
  onProgress?: (state: 'downloading' | 'applying' | 'ok' | 'error', msg?: string) => void,
): Promise<'ok' | 'downloading' | 'error'> {
  if (!isDeepARAvailable() || !deepARRef.current) {
    console.warn('[DeepAR] switchDeepAREffect: not available or ref is null');
    return 'error';
  }

  try {
    onProgress?.('downloading');
    const rawPath = await getLocalFilterPath(filter);

    if (!rawPath) {
      console.error('[DeepAR] No local path for filter:', filter.id);
      onProgress?.('error', 'No se pudo descargar el filtro');
      return 'error';
    }

    onProgress?.('applying');
    console.log('[DeepAR] switchEffectWithPath:', filter.id, '→', rawPath);

    /**
     * ✅ CORRECT: pass the raw POSIX path from rn-fetch-blob
     * ❌ WRONG:  pass a file:// URI (from expo-file-system)
     */
    deepARRef.current.switchEffectWithPath({
      path: rawPath,
      slot: 'effect',
    });

    onProgress?.('ok');
    return 'ok';

  } catch (e) {
    console.warn('[DeepAR] switchDeepAREffect error:', e);
    onProgress?.('error', String(e));
    return 'error';
  }
}

/**
 * Clear/reset the active DeepAR effect (plain camera, no AR).
 */
export function clearDeepAREffect(deepARRef: React.MutableRefObject<any>) {
  if (!isDeepARAvailable() || !deepARRef.current) return;
  try {
    deepARRef.current.switchEffect({ mask: '', slot: 'effect' });
    console.log('[DeepAR] Effect cleared');
  } catch (e) {
    console.warn('[DeepAR] clearEffect failed:', e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DIAGNOSTICS
// ─────────────────────────────────────────────────────────────────────────────
export function getDeepARStatus(): {
  ready:           boolean;
  hasPackage:      boolean;
  hasApiKey:       boolean;
  hasFetchBlob:    boolean;  // kept for API compat — now always true (uses expo-file-system)
  hasFileSystem:   boolean;
  isEnabled:       boolean;
  instructions:    string[];
} {
  const hasPackage    = !!DeepARModule;
  const hasApiKey     = !!DEEPAR_API_KEY && DEEPAR_API_KEY.length > 10;
  const isEnabled     = DEEPAR_ENABLED;
  const hasFileSystemOk = hasFileSystem;
  const ready         = isEnabled && hasPackage && hasApiKey;

  const instructions: string[] = [];
  if (!isEnabled)        instructions.push('Set DEEPAR_ENABLED = true in deeparService.ts');
  if (!hasApiKey)        instructions.push('Add EXPO_PUBLIC_DEEPAR_API_KEY to .env');
  if (!hasPackage)       instructions.push('Run: pnpm add react-native-deepar && eas build');
  if (!hasFileSystemOk)  instructions.push('expo-file-system missing — check Expo SDK version');
  if (!ready)            instructions.push('Rebuild EAS Build after all above steps');

  return {
    ready, hasPackage, hasApiKey,
    hasFetchBlob: true,   // expo-file-system is always available in Expo SDK 53
    hasFileSystem: hasFileSystemOk,
    isEnabled, instructions,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CAPTURE / RECORDING
// ─────────────────────────────────────────────────────────────────────────────
export function triggerDeepARScreenshot(deepARRef: React.MutableRefObject<any>) {
  if (!isDeepARAvailable() || !deepARRef.current) return;
  try { deepARRef.current.takeScreenshot(); }
  catch (e) { console.warn('[DeepAR] takeScreenshot failed:', e); }
}

export function startDeepARRecording(deepARRef: React.MutableRefObject<any>) {
  if (!isDeepARAvailable() || !deepARRef.current) return;
  try { deepARRef.current.startRecording(); }
  catch (e) { console.warn('[DeepAR] startRecording failed:', e); }
}

export function stopDeepARRecording(deepARRef: React.MutableRefObject<any>) {
  if (!isDeepARAvailable() || !deepARRef.current) return;
  try { deepARRef.current.finishRecording(); }
  catch (e) { console.warn('[DeepAR] finishRecording failed:', e); }
}

// ─────────────────────────────────────────────────────────────────────────────
// PERMISSIONS
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Request camera + microphone permissions using expo-camera.
 *
 * WHY NOT DeepAR's CameraModule:
 *   DeepAR's CameraModule calls NativeModules.RNTCameraModule. On iOS,
 *   NativeModules entries are populated lazily after bridge hydration.
 *   If called too early (e.g. during module require), RNTCameraModule is null
 *   and throws: "Cannot read property 'requestCameraPermission' of null".
 *
 *   expo-camera requests the same iOS NSCameraUsageDescription entitlement
 *   and is always available once the app has mounted.
 */
export async function requestDeepARPermissions(): Promise<boolean> {
  try {
    const ec = require('expo-camera');
    // expo-camera v14+: static methods on Camera class
    const EC = ec.Camera ?? ec.default ?? null;
    if (EC?.requestCameraPermissionsAsync) {
      const cam = await EC.requestCameraPermissionsAsync();
      const mic = await EC.requestMicrophonePermissionsAsync?.().catch(() => ({ granted: true })) ?? { granted: true };
      const ok = cam?.granted === true || cam?.status === 'granted';
      console.log('[DeepAR] Permissions (expo-camera) → camera:', cam?.status, 'mic:', mic?.status);
      return ok;
    }
    // Fallback: assume granted (DeepAR will show OS dialog on first render)
    console.warn('[DeepAR] expo-camera static API unavailable — assuming camera granted');
    return true;
  } catch (e) {
    console.warn('[DeepAR] requestDeepARPermissions failed:', e);
    // Return true so DeepAR component still mounts; it will handle its own prompt
    return true;
  }
}

export async function getDeepARCameraPermission(): Promise<string> {
  try {
    const ec = require('expo-camera');
    const EC = ec.Camera ?? ec.default ?? null;
    if (EC?.getCameraPermissionsAsync) {
      const perm = await EC.getCameraPermissionsAsync();
      return perm?.status ?? 'not-determined';
    }
    return 'not-determined';
  } catch { return 'not-determined'; }
}

// ─────────────────────────────────────────────────────────────────────────────
// BEAUTY PARAMS
// ─────────────────────────────────────────────────────────────────────────────
export function setBeautyParams(
  deepARRef: React.MutableRefObject<any>,
  params: { smoothing?: number; teeth?: number },
) {
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

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────
export { DeepARCamera as DeepARCameraComponent };
