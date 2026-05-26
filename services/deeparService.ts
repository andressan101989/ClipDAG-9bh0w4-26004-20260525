/**
 * services/deeparService.ts — v8 (DeepAR re-enabled, metro still blocks SDK on preview)
 *
 * DeepAR SDK is blocked by metro.config.js ALWAYS_BLOCKED list (react-native-deepar).
 * isDeepARAvailable() checks at runtime whether the native module loaded.
 * On preview/web this returns false gracefully — no crash.
 * On EAS native build: returns true and enables AR filters.
 */

import { Platform } from 'react-native';

// ── Re-enabled — metro blocks react-native-deepar on preview, graceful on EAS ─
export const DEEPAR_ENABLED = true;

export const DEEPAR_API_KEY_IOS     = '';
export const DEEPAR_API_KEY_ANDROID = '';
export const DEEPAR_API_KEY         = '';

// Lazy-load DeepAR — metro blocks the package on preview, so this try/catch
// gracefully returns null when not available.
let _DeepAR: any = null;
let _DeepARCamera: any = null;
try {
  const sdk = require('react-native-deepar');
  _DeepAR       = sdk?.DeepAR       ?? null;
  _DeepARCamera = sdk?.DeepARCamera ?? sdk?.default ?? null;
} catch { /* blocked by metro on preview — expected */ }

export const DeepAR          = _DeepAR;
export const DeepARCamera    = _DeepARCamera;
export const DeepARCameraKit = _DeepARCamera;

export const isDeepARAvailable = () =>
  DEEPAR_ENABLED &&
  _DeepARCamera !== null &&
  typeof _DeepARCamera === 'function';

// expo-file-system — lazy-loaded to avoid native module crash at startup.
// A static top-level import can crash iOS if the native module hasn't
// hydrated yet during the JS bundle evaluation phase.
let _FileSystem: any = null;
try { _FileSystem = require('expo-file-system'); } catch { /* not available */ }
const hasFileSystem = typeof _FileSystem?.downloadAsync === 'function';

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
  if (!hasFileSystem || !_FileSystem) return null;
  try {
    const dir  = _FileSystem.cacheDirectory + 'deepar_filters/';
    const dest = dir + effectId;
    // Ensure directory exists
    await _FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    const { uri, status } = await _FileSystem.downloadAsync(url, dest);
    if (status !== 200) return null;
    // DeepAR iOS requires raw POSIX path — strip file:// prefix
    const rawPath = uri.replace(/^file:\/\//, '');
    // Validate file is not an HTML error page (must be ≥ 64 bytes)
    const info = await _FileSystem.getInfoAsync(uri, { size: true }).catch(() => null);
    if (!info || (info as any).size < 64) return null;
    return rawPath;
  } catch {
    return null;
  }
}

export async function getLocalFilterPath(filter: DeepARFilter): Promise<string | null> {
  if (!DEEPAR_ENABLED) return null;
  if (pathCache[filter.id]) return pathCache[filter.id];
  if (downloadingIds.has(filter.id)) return null;
  downloadingIds.add(filter.id);
  try {
    // Try primary CDN, then mirror
    let path = await tryDownload(filter.remoteUrl, filter.id);
    if (!path) path = await tryDownload(
      filter.remoteUrl.replace(DEEPAR_CDN, DEEPAR_CDN_MIRROR), filter.id
    );
    if (path) pathCache[filter.id] = path;
    return path;
  } finally {
    downloadingIds.delete(filter.id);
  }
}

/**
 * Prefetch the most commonly used filters in background after DeepAR initializes.
 */
export async function prefetchDeepARFilters(
  filterIds?: string[],
): Promise<void> {
  if (!DEEPAR_ENABLED || !isDeepARAvailable()) return;
  const ids = filterIds ?? ['flower_crown', 'lion', 'beauty', 'fire', 'disco'];
  await Promise.all(
    DEEPAR_FILTERS
      .filter(f => ids.includes(f.id))
      .map(f => getLocalFilterPath(f).catch(() => null))
  );
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
  if (!DEEPAR_ENABLED || !deepARRef?.current) {
    onProgress?.('error', 'DeepAR not available');
    return 'error';
  }
  onProgress?.('downloading');
  try {
    const localPath = await getLocalFilterPath(filter);
    if (!localPath) {
      onProgress?.('error', 'No se pudo descargar el filtro');
      return 'error';
    }
    onProgress?.('applying');
    if (typeof deepARRef.current.switchEffectWithPath === 'function') {
      deepARRef.current.switchEffectWithPath({ path: localPath, slot: 'effect' });
    } else if (typeof deepARRef.current.switchEffect === 'function') {
      deepARRef.current.switchEffect({ mask: localPath });
    }
    onProgress?.('ok');
    return 'ok';
  } catch (e: any) {
    onProgress?.('error', e?.message ?? 'Error al aplicar filtro');
    return 'error';
  }
}

/**
 * Clear/reset the active DeepAR effect (plain camera, no AR).
 */
export function clearDeepAREffect(deepARRef: React.MutableRefObject<any>) {
  if (!deepARRef?.current) return;
  try {
    if (typeof deepARRef.current.switchEffectWithPath === 'function') {
      deepARRef.current.switchEffectWithPath({ path: '', slot: 'effect' });
    }
  } catch { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// DIAGNOSTICS
// ─────────────────────────────────────────────────────────────────────────────
export function getDeepARStatus() {
  const hasPackage = _DeepARCamera !== null;
  return {
    ready:        isDeepARAvailable(),
    hasPackage,
    hasApiKey:    false, // API key loaded by native module from app.json config
    hasFileSystem: hasFileSystem,
    isEnabled:    DEEPAR_ENABLED,
    instructions: hasPackage
      ? ['DeepAR SDK loaded — check API key in app.json expo.plugins config']
      : ['react-native-deepar not available (preview mode or metro blocked) — use EAS build'],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CAPTURE / RECORDING
// ─────────────────────────────────────────────────────────────────────────────
export function triggerDeepARScreenshot(deepARRef: React.MutableRefObject<any>) {
  try { deepARRef?.current?.takeScreenshot?.(); } catch { /* ignore */ }
}
export function startDeepARRecording(deepARRef: React.MutableRefObject<any>) {
  try { deepARRef?.current?.startVideoRecording?.(); } catch { /* ignore */ }
}
export function stopDeepARRecording(deepARRef: React.MutableRefObject<any>) {
  try { deepARRef?.current?.finishVideoRecording?.(); } catch { /* ignore */ }
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
    const { requestCameraPermissionsAsync } = require('expo-camera');
    const { granted } = await requestCameraPermissionsAsync();
    return granted;
  } catch {
    return false;
  }
}
export async function getDeepARCameraPermission(): Promise<string> {
  try {
    const { getCameraPermissionsAsync } = require('expo-camera');
    const { status } = await getCameraPermissionsAsync();
    return status;
  } catch {
    return 'not-determined';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BEAUTY PARAMS
// ─────────────────────────────────────────────────────────────────────────────
export function setBeautyParams(
  deepARRef: React.MutableRefObject<any>,
  params: { smoothing?: number; teeth?: number },
) {
  try {
    if (!deepARRef?.current) return;
    if (params.smoothing !== undefined)
      deepARRef.current.setBeautyParams?.({ smoothingFactor: params.smoothing });
  } catch { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────
export { DeepARCamera as DeepARCameraComponent };
