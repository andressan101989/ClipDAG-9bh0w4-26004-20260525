/**
 * services/deeparService.ts — v9 (strict validation + runtime logs)
 *
 * DeepAR SDK resolution:
 *   - metro.config.js blocks react-native-deepar on web/preview → require() throws → null
 *   - EAS native build → require() succeeds → validate function type → assign
 *
 * Runtime confirmation logs (visible in Metro/Xcode console):
 *   [DeepAR] SDK require succeeded
 *   [DeepAR] component resolved ✓  (or detailed failure reason)
 *   [DeepAR] mounted               (emitted by CameraCore on first render)
 *   [DeepAR] initialized           (emitted by onInitialized callback)
 *   [DeepAR] camera surface ready  (emitted by onCameraReady callback)
 *   [DeepAR] effect applied        (emitted by switchDeepAREffect on success)
 *
 * All rn-fetch-blob references removed — expo-file-system is the sole
 * download mechanism. DeepAR requires raw POSIX paths (no file:// prefix).
 */

import { Platform } from 'react-native';

// ── Feature flag ──────────────────────────────────────────────────────────────
export const DEEPAR_ENABLED = true;

// DeepAR API keys — loaded from env vars, never hardcoded in source.
// Set EXPO_PUBLIC_DEEPAR_LICENSE_IOS and EXPO_PUBLIC_DEEPAR_LICENSE_ANDROID
// in your .env file. Obtain keys at https://www.deepar.ai
//
// Native config plugins inject the values into Info.plist / strings.xml at build time:
//   iOS:     plugins/withDeepARiOS.js      → Info.plist  key: ar_key
//   Android: plugins/withDeepARAndroidFix.js → strings.xml key: deepar_api_key
export const DEEPAR_API_KEY_IOS: string =
  process.env.EXPO_PUBLIC_DEEPAR_LICENSE_IOS ?? '';
export const DEEPAR_API_KEY_ANDROID: string =
  process.env.EXPO_PUBLIC_DEEPAR_LICENSE_ANDROID ?? '';
export const DEEPAR_API_KEY: string =
  Platform.OS === 'android' ? DEEPAR_API_KEY_ANDROID : DEEPAR_API_KEY_IOS;

// ── Lazy-load DeepAR SDK ──────────────────────────────────────────────────────
// require() is deferred (not a top-level static import) so that module
// evaluation at app startup never attempts to touch the native bridge before
// it is ready. metro.config.js redirects the require to an empty stub on
// web/preview, so the catch branch runs on those platforms — no crash.
let _DeepAR: any       = null;
let _DeepARCamera: any = null;

try {
  const sdk = require('react-native-deepar');
  const exportKeys: string[] = Object.keys(sdk ?? {});
  console.log('[DeepAR] SDK require succeeded. exports:', exportKeys.join(', '));

  // ── Resolve DeepAR imperative API (ref methods) ───────────────────────────
  const deepARCandidate: unknown = sdk?.DeepAR ?? sdk?.default?.DeepAR ?? null;
  if (deepARCandidate !== null && typeof deepARCandidate === 'function') {
    _DeepAR = deepARCandidate;
    console.log('[DeepAR] DeepAR class resolved ✓');
  } else {
    console.log('[DeepAR] DeepAR class not found (optional — ref methods used instead)');
  }

  // ── Resolve DeepARCamera React component ─────────────────────────────────
  // Defensive priority order — most specific named export first.
  // sdk.default is intentionally last: it can be a plain module object {}
  // which would pass an instanceof check but is NOT a React component.
  const candidates: Array<[string, unknown]> = [
    ['sdk.DeepARCamera',          sdk?.DeepARCamera],
    ['sdk.default.DeepARCamera',  sdk?.default?.DeepARCamera],
    // sdk.default ONLY if it looks like a component (function/class, not plain object)
    ['sdk.default (fallback)',    typeof sdk?.default === 'function' ? sdk.default : null],
  ];

  for (const [label, candidate] of candidates) {
    if (candidate === null || candidate === undefined) continue;
    if (typeof candidate !== 'function') {
      console.warn(`[DeepAR] ${label} is type "${typeof candidate}" — skipping (not a React component)`);
      continue;
    }
    _DeepARCamera = candidate;
    console.log(`[DeepAR] DeepARCamera resolved via ${label} ✓`);
    break;
  }

  if (_DeepARCamera === null) {
    console.warn(
      '[DeepAR] DeepARCamera NOT resolved from any export path.',
      'Available keys:', exportKeys.join(', '),
      '— falling back to expo-camera. Check react-native-deepar version.',
    );
  }
} catch (e: any) {
  console.log('[DeepAR] require skipped (expected on web/preview):', e?.message ?? String(e));
}

export const DeepAR          = _DeepAR;
export const DeepARCamera    = _DeepARCamera;
export const DeepARCameraKit = _DeepARCamera; // alias used in some older imports

/** Returns true only when a valid React component function was resolved. */
export const isDeepARAvailable = (): boolean =>
  DEEPAR_ENABLED &&
  _DeepARCamera !== null &&
  typeof _DeepARCamera === 'function';

// ── expo-file-system (lazy) ───────────────────────────────────────────────────
// Lazy-required to avoid native module crash during JS bundle evaluation
// (same reason as the DeepAR require above).
let _FileSystem: any = null;
try { _FileSystem = require('expo-file-system'); } catch { /* not available on web */ }
const hasFileSystem = typeof _FileSystem?.downloadAsync === 'function';

// ─────────────────────────────────────────────────────────────────────────────
// AR FILTER CATALOG
// ─────────────────────────────────────────────────────────────────────────────
export interface DeepARFilter {
  id:          string;
  name:        string;
  emoji:       string;
  category:    'face' | 'beauty' | 'background' | 'social';
  /** Remote URL of the .deepar effect file. Downloaded and cached on first use. */
  remoteUrl:   string;
  description: string;
}

const DEEPAR_CDN        = 'https://storage.deepar.ai/effects/';
const DEEPAR_CDN_MIRROR = 'http://betacoins.magix.net/public/deepar-filters/';

export const DEEPAR_FILTERS: DeepARFilter[] = [
  // ── Face ────────────────────────────────────────────────────────────────
  { id: 'flower_crown',  name: 'Corona',    emoji: '🌸', category: 'face',
    remoteUrl: `${DEEPAR_CDN}flower_crown`,    description: 'Corona de flores animada' },
  { id: 'lion',          name: 'León',      emoji: '🦁', category: 'face',
    remoteUrl: `${DEEPAR_CDN}lion`,            description: 'Máscara facial de león 3D' },
  { id: 'viking_helmet', name: 'Viking',    emoji: '🪖', category: 'face',
    remoteUrl: `${DEEPAR_CDN}viking_helmet`,   description: 'Casco vikingo animado' },
  { id: 'aviators',      name: 'Aviador',   emoji: '😎', category: 'face',
    remoteUrl: `${DEEPAR_CDN}aviators`,        description: 'Gafas de aviador vintage' },
  { id: 'dalmatian',     name: 'Perrito',   emoji: '🐶', category: 'face',
    remoteUrl: `${DEEPAR_CDN}dalmatian`,       description: 'Filtro dálmata con orejas' },
  { id: 'pug',           name: 'Pug',       emoji: '🐾', category: 'face',
    remoteUrl: `${DEEPAR_CDN}pug`,             description: 'Cara de pug animado' },
  { id: 'beard',         name: 'Barba',     emoji: '🧔', category: 'face',
    remoteUrl: `${DEEPAR_CDN}beard`,           description: 'Barba hipster animada' },
  // ── Beauty ──────────────────────────────────────────────────────────────
  { id: 'beauty',        name: 'Beauty',    emoji: '✨', category: 'beauty',
    remoteUrl: `${DEEPAR_CDN}beauty`,          description: 'Suavizado de piel + mejora facial' },
  { id: 'makeup',        name: 'Maquillaje',emoji: '💄', category: 'beauty',
    remoteUrl: `${DEEPAR_CDN}makeup`,          description: 'Maquillaje labios y ojos' },
  { id: 'face_painting', name: 'Face Paint',emoji: '🎨', category: 'beauty',
    remoteUrl: `${DEEPAR_CDN}face_painting`,   description: 'Pintura artística facial' },
  // ── Background ──────────────────────────────────────────────────────────
  { id: 'galaxy_segmentation',     name: 'Galaxia',   emoji: '🌌', category: 'background',
    remoteUrl: `${DEEPAR_CDN}galaxy_segmentation`,     description: 'Fondo galaxia + remoción BG' },
  { id: 'background_segmentation', name: 'Sin fondo', emoji: '🫧', category: 'background',
    remoteUrl: `${DEEPAR_CDN}background_segmentation`, description: 'Remoción de fondo en tiempo real' },
  // ── Social ───────────────────────────────────────────────────────────────
  { id: 'fire',          name: 'Fuego',     emoji: '🔥', category: 'social',
    remoteUrl: `${DEEPAR_CDN}fire`,            description: 'Llamas animadas alrededor de la cara' },
  { id: 'disco',         name: 'Disco',     emoji: '🪩', category: 'social',
    remoteUrl: `${DEEPAR_CDN}disco`,           description: 'Luces de discoteca psicodélicas' },
  { id: 'hope',          name: 'Hope',      emoji: '🦋', category: 'social',
    remoteUrl: `${DEEPAR_CDN}hope`,            description: 'Mariposas y flores' },
  { id: 'burning_effect',name: 'Burning',   emoji: '💀', category: 'social',
    remoteUrl: `${DEEPAR_CDN}burning_effect`,  description: 'Cara en llamas' },
];

// ─────────────────────────────────────────────────────────────────────────────
// LOCAL FILTER CACHE
// ─────────────────────────────────────────────────────────────────────────────
/** In-memory raw POSIX path cache (populated after first download per session). */
const pathCache: Record<string, string> = {};
const downloadingIds: Set<string>       = new Set();

/**
 * Download a DeepAR effect file via expo-file-system and return the raw
 * POSIX path (no file:// prefix).
 *
 * CRITICAL — DeepAR iOS switchEffectWithPath() requires a raw path:
 *   ✅ /var/mobile/Containers/Data/Application/.../flower_crown
 *   ❌ file:///var/mobile/Containers/Data/Application/.../flower_crown
 *
 * expo-file-system returns file:// URIs → strip the prefix.
 */
async function tryDownload(url: string, effectId: string): Promise<string | null> {
  if (!hasFileSystem || !_FileSystem) return null;
  try {
    const dir  = (_FileSystem.cacheDirectory as string) + 'deepar_filters/';
    const dest = dir + effectId;
    await _FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    const { uri, status } = await _FileSystem.downloadAsync(url, dest);
    if (status !== 200) {
      console.warn(`[DeepAR] download HTTP ${status} for ${effectId} from ${url}`);
      return null;
    }
    // Strip file:// — DeepAR iOS native code requires raw POSIX path
    const rawPath = (uri as string).replace(/^file:\/\//, '');
    // Guard: reject HTML error pages (< 64 bytes means no real .deepar binary)
    const info = await _FileSystem.getInfoAsync(uri, { size: true }).catch(() => null);
    if (!info || (info as any).size < 64) {
      console.warn(`[DeepAR] downloaded file too small for ${effectId} — likely an HTML error page`);
      return null;
    }
    console.log(`[DeepAR] filter cached: ${effectId} → ${rawPath}`);
    return rawPath;
  } catch (e: any) {
    console.warn(`[DeepAR] tryDownload failed for ${effectId}:`, e?.message ?? e);
    return null;
  }
}

export async function getLocalFilterPath(filter: DeepARFilter): Promise<string | null> {
  if (!DEEPAR_ENABLED) return null;
  if (pathCache[filter.id]) return pathCache[filter.id];
  if (downloadingIds.has(filter.id)) return null;
  downloadingIds.add(filter.id);
  try {
    // Try primary CDN first, then mirror
    let path = await tryDownload(filter.remoteUrl, filter.id);
    if (!path) {
      const mirrorUrl = filter.remoteUrl.replace(DEEPAR_CDN, DEEPAR_CDN_MIRROR);
      path = await tryDownload(mirrorUrl, filter.id);
    }
    if (path) pathCache[filter.id] = path;
    return path;
  } finally {
    downloadingIds.delete(filter.id);
  }
}

/** Prefetch the most-used filters in the background after DeepAR initializes. */
export async function prefetchDeepARFilters(filterIds?: string[]): Promise<void> {
  if (!DEEPAR_ENABLED || !isDeepARAvailable()) return;
  const ids = filterIds ?? ['flower_crown', 'lion', 'beauty', 'fire', 'disco'];
  await Promise.all(
    DEEPAR_FILTERS
      .filter(f => ids.includes(f.id))
      .map(f => getLocalFilterPath(f).catch(() => null)),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EFFECT SWITCHING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Switch the active DeepAR AR effect.
 *
 * Downloads the filter file via expo-file-system (first call only),
 * then calls switchEffectWithPath with the raw POSIX path so the
 * DeepAR Metal renderer can load it on iOS.
 */
export async function switchDeepAREffect(
  deepARRef:   React.MutableRefObject<any>,
  filter:      DeepARFilter,
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
    console.log('[DeepAR] effect applied:', filter.id);
    onProgress?.('ok');
    return 'ok';
  } catch (e: any) {
    console.warn('[DeepAR] switchEffect error:', e?.message ?? e);
    onProgress?.('error', e?.message ?? 'Error al aplicar filtro');
    return 'error';
  }
}

/** Clear the active AR effect — returns camera to plain pass-through. */
export function clearDeepAREffect(deepARRef: React.MutableRefObject<any>) {
  if (!deepARRef?.current) return;
  try {
    if (typeof deepARRef.current.switchEffectWithPath === 'function') {
      deepARRef.current.switchEffectWithPath({ path: '', slot: 'effect' });
    }
  } catch { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// RUNTIME LIFECYCLE LOGS (called from CameraCore)
// ─────────────────────────────────────────────────────────────────────────────

/** Call from CameraCore render to confirm DeepARCamera is about to mount. */
export function logDeepARMounted() {
  console.log('[DeepAR] mounted — DeepARCamera component rendered to native tree');
}

/** Call from DeepARCamera onInitialized callback. */
export function logDeepARInitialized() {
  console.log('[DeepAR] initialized — native SDK ready, Metal renderer active');
}

/** Call from DeepARCamera onCameraReady / onCameraError callbacks. */
export function logDeepARCameraReady(ready: boolean, error?: string) {
  if (ready) {
    console.log('[DeepAR] camera surface ready — texture attached to Metal layer ✓');
  } else {
    console.warn('[DeepAR] camera surface error:', error ?? 'unknown');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DIAGNOSTICS
// ─────────────────────────────────────────────────────────────────────────────
export function getDeepARStatus() {
  return {
    ready:         isDeepARAvailable(),
    hasCamera:     _DeepARCamera !== null,
    hasDeepARClass:_DeepAR !== null,
    hasFileSystem,
    isEnabled:     DEEPAR_ENABLED,
    apiKey:        DEEPAR_API_KEY.slice(0, 8) + '…', // partial for logs
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
 * Request camera permissions via expo-camera.
 *
 * DeepAR's own CameraModule (NativeModules.RNTCameraModule) must NOT be
 * called before the React bridge has fully hydrated — it will be null and
 * throw at startup. expo-camera uses the same NSCameraUsageDescription
 * entitlement and is always safe to call after the app mounts.
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
    if (params.smoothing !== undefined) {
      deepARRef.current.setBeautyParams?.({ smoothingFactor: params.smoothing });
    }
  } catch { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────
export { DeepARCamera as DeepARCameraComponent };
