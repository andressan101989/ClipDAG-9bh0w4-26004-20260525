/**
 * services/deeparService.ts  — v5
 *
 * ══ CRITICAL FIX: Remote filter loading ══════════════════════════════════════
 *
 *  switchEffectWithPath() requires a LOCAL file path — NOT a remote URL.
 *  Remote URL causes a silent no-op (iOS) or crash (Android).
 *
 *  Solution: download each .deepar filter to expo-file-system cache on first use,
 *  then pass the local URI to switchEffectWithPath. Subsequent uses are instant.
 *
 * ══ ATS / SSL notes ══════════════════════════════════════════════════════════
 *
 *  The DeepAR CDN (s3.amazonaws.com) uses HTTPS — no ATS exception needed.
 *  If a download fails with a network error, the UI shows an error badge.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 */

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';

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
    console.log('[DeepAR] SDK loaded successfully');
  }
} catch (e) {
  console.warn('[DeepAR] Not compiled in EAS Build yet. Run: pnpm add react-native-deepar then rebuild.');
}

export const DeepAR           = DeepARModule?.default ?? null;
export const DeepARCamera     = DeepARModule?.default ?? null;
export const DeepARCameraKit  = DeepARModule           ?? null;

export const isDeepARAvailable = () =>
  DEEPAR_ENABLED &&
  !!DeepARCamera &&
  DEEPAR_API_KEY.length > 10;

// ─────────────────────────────────────────────────────────────────────────────
// AR FILTER CATALOG
// ─────────────────────────────────────────────────────────────────────────────
export interface DeepARFilter {
  id:          string;
  name:        string;
  emoji:       string;
  category:    'face' | 'beauty' | 'background' | 'social';
  /**
   * Remote URL of the .deepar effect file.
   * Will be downloaded and cached locally before applying.
   */
  remoteUrl:   string;
  description: string;
}

/**
 * DeepAR Free Filter Pack — effects from the official free pack.
 * https://docs.deepar.ai/deep-ar-studio/free-filter-pack
 *
 * Files are downloaded on first use and cached in FileSystem.cacheDirectory.
 *
 * Note: DeepAR free-pack filenames have NO extension on the CDN.
 */
const DEEPAR_CDN = 'https://s3.amazonaws.com/deepar-assets/filter-pack/';

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
    remoteUrl: `${DEEPAR_CDN}hope`,              description: 'Mariposas y flores' },
  { id: 'burning_effect', name: 'Burning',     emoji: '💀', category: 'social',
    remoteUrl: `${DEEPAR_CDN}burning_effect`,    description: 'Cara en llamas' },
];

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL FILTER CACHE
// Each filter is downloaded once to cacheDirectory and reused on subsequent taps.
// ─────────────────────────────────────────────────────────────────────────────
const downloadCache: Record<string, string> = {};   // filterId → local file URI
const downloadingIds: Set<string>           = new Set();

/** Local cache directory for DeepAR effects */
const CACHE_DIR = `${FileSystem.cacheDirectory}deepar_effects/`;

/**
 * Ensure the DeepAR effects cache directory exists.
 */
async function ensureCacheDir(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(CACHE_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
    }
  } catch (e) {
    console.warn('[DeepAR] ensureCacheDir failed:', e);
  }
}

/**
 * Returns the local file path for a filter, downloading it if necessary.
 *
 * ⚠️  CRITICAL: switchEffectWithPath needs a FILE:// path, NOT a remote URL.
 *    This function bridges the gap by caching the remote asset locally.
 */
export async function getLocalFilterPath(filter: DeepARFilter): Promise<string | null> {
  // Already cached in memory
  if (downloadCache[filter.id]) {
    console.log('[DeepAR] Cache hit:', filter.id, '→', downloadCache[filter.id]);
    return downloadCache[filter.id];
  }

  // Prevent concurrent downloads of the same filter
  if (downloadingIds.has(filter.id)) {
    // Wait for ongoing download (poll)
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (downloadCache[filter.id]) {
          clearInterval(check);
          resolve(downloadCache[filter.id]);
        } else if (!downloadingIds.has(filter.id)) {
          clearInterval(check);
          resolve(null);
        }
      }, 200);
    });
  }

  downloadingIds.add(filter.id);

  try {
    await ensureCacheDir();

    // Use filter id as filename (no extension — DeepAR format)
    const localPath = `${CACHE_DIR}${filter.id}`;

    // Check if already downloaded to disk
    const existing = await FileSystem.getInfoAsync(localPath);
    if (existing.exists) {
      console.log('[DeepAR] Disk cache hit:', filter.id);
      downloadCache[filter.id] = localPath;
      downloadingIds.delete(filter.id);
      return localPath;
    }

    console.log('[DeepAR] Downloading filter:', filter.id, '←', filter.remoteUrl);

    const result = await FileSystem.downloadAsync(filter.remoteUrl, localPath);

    if (result.status !== 200) {
      console.error('[DeepAR] Download failed — HTTP', result.status, filter.id);
      downloadingIds.delete(filter.id);
      return null;
    }

    // Verify the file exists and is non-empty
    const info = await FileSystem.getInfoAsync(localPath);
    if (!info.exists || (info as any).size === 0) {
      console.error('[DeepAR] Downloaded file is empty:', filter.id);
      downloadingIds.delete(filter.id);
      return null;
    }

    console.log('[DeepAR] ✅ Downloaded:', filter.id, '→', localPath, `(${(info as any).size} bytes)`);
    downloadCache[filter.id] = localPath;
    downloadingIds.delete(filter.id);
    return localPath;

  } catch (e) {
    console.error('[DeepAR] Download error for', filter.id, ':', e);
    downloadingIds.delete(filter.id);
    return null;
  }
}

/**
 * Prefetch the most commonly used filters in background after DeepAR initializes.
 * Call this in EffectsTab's onInitialized callback.
 */
export async function prefetchDeepARFilters(
  filterIds: string[] = ['flower_crown', 'lion', 'aviators', 'beauty', 'fire'],
): Promise<void> {
  const filters = DEEPAR_FILTERS.filter(f => filterIds.includes(f.id));
  // Download in parallel but don't block the UI
  await Promise.allSettled(filters.map(f => getLocalFilterPath(f)));
  console.log('[DeepAR] Prefetch complete for:', filterIds);
}

// ─────────────────────────────────────────────────────────────────────────────
// EFFECT SWITCHING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Switch the active DeepAR AR effect.
 *
 * ASYNC — downloads the filter file to local cache if not already present,
 * then calls switchEffectWithPath with the LOCAL path.
 *
 * Returns: 'ok' | 'downloading' | 'error'
 */
export async function switchDeepAREffect(
  deepARRef: React.MutableRefObject<any>,
  filter:    DeepARFilter,
  onProgress?: (state: 'downloading' | 'applying' | 'ok' | 'error', msg?: string) => void,
): Promise<'ok' | 'downloading' | 'error'> {
  if (!isDeepARAvailable() || !deepARRef.current) return 'error';

  try {
    onProgress?.('downloading');
    const localPath = await getLocalFilterPath(filter);

    if (!localPath) {
      console.error('[DeepAR] No local path for filter:', filter.id);
      onProgress?.('error', 'No se pudo descargar el filtro');
      return 'error';
    }

    onProgress?.('applying');
    console.log('[DeepAR] Applying effect:', filter.id, 'path:', localPath);

    // ✅ CORRECT: switchEffectWithPath with LOCAL file path
    deepARRef.current.switchEffectWithPath({
      path: localPath,
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
    // Empty mask string clears the effect slot
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
  ready:        boolean;
  hasPackage:   boolean;
  hasApiKey:    boolean;
  isEnabled:    boolean;
  instructions: string[];
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
export async function requestDeepARPermissions(): Promise<boolean> {
  if (!DeepARCameraKit) return false;
  try {
    const Camera = DeepARCameraKit.Camera ?? null;
    if (!Camera) return false;
    const cam = await Camera.requestCameraPermission?.();
    const mic = await Camera.requestMicrophonePermission?.();
    console.log('[DeepAR] Permissions → camera:', cam, 'mic:', mic);
    return cam === 'authorized';
  } catch (e) {
    console.warn('[DeepAR] requestDeepARPermissions failed:', e);
    return false;
  }
}

export async function getDeepARCameraPermission(): Promise<string> {
  if (!DeepARCameraKit?.Camera) return 'not-determined';
  try {
    return (await DeepARCameraKit.Camera.getCameraPermissionStatus?.()) ?? 'not-determined';
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
