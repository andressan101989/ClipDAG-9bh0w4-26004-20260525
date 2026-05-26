/**
 * services/deeparService.ts — v7 (DEEPAR DISABLED — startup crash isolation)
 *
 * DeepAR is COMPLETELY DISABLED to isolate the iOS startup crash.
 * All exports are stubs that return null/false immediately.
 * No react-native-deepar SDK is loaded, no native bridge calls are made.
 *
 * To re-enable: set DEEPAR_ENABLED = true and rebuild with EAS.
 */

import { Platform } from 'react-native';

// ── DISABLED for crash isolation ─────────────────────────────────────────────
export const DEEPAR_ENABLED = false;

export const DEEPAR_API_KEY_IOS     = '';
export const DEEPAR_API_KEY_ANDROID = '';
export const DEEPAR_API_KEY         = '';

export const DeepAR          = null;
export const DeepARCamera    = null;
export const DeepARCameraKit = null;

export const isDeepARAvailable = () => false;

// expo-file-system — kept for API surface only (no downloads while disabled)
import * as FileSystem from 'expo-file-system';
const hasFileSystem = typeof FileSystem?.downloadAsync === 'function';

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
async function tryDownload(_url: string, _effectId: string): Promise<string | null> {
  return null; // DeepAR disabled
}

export async function getLocalFilterPath(_filter: DeepARFilter): Promise<string | null> {
  return null; // DeepAR disabled
}

/**
 * Prefetch the most commonly used filters in background after DeepAR initializes.
 */
export async function prefetchDeepARFilters(
  _filterIds?: string[],
): Promise<void> {
  // DeepAR disabled — no-op
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
  _deepARRef: React.MutableRefObject<any>,
  _filter:    DeepARFilter,
  onProgress?: (state: 'downloading' | 'applying' | 'ok' | 'error', msg?: string) => void,
): Promise<'ok' | 'downloading' | 'error'> {
  onProgress?.('error', 'DeepAR disabled');
  return 'error';
}

/**
 * Clear/reset the active DeepAR effect (plain camera, no AR).
 */
export function clearDeepAREffect(_deepARRef: React.MutableRefObject<any>) {
  // DeepAR disabled — no-op
}

// ─────────────────────────────────────────────────────────────────────────────
// DIAGNOSTICS
// ─────────────────────────────────────────────────────────────────────────────
export function getDeepARStatus() {
  return {
    ready: false, hasPackage: false, hasApiKey: false,
    hasFetchBlob: true, hasFileSystem: hasFileSystem,
    isEnabled: false,
    instructions: ['DeepAR disabled for crash isolation — set DEEPAR_ENABLED = true to re-enable'],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CAPTURE / RECORDING
// ─────────────────────────────────────────────────────────────────────────────
export function triggerDeepARScreenshot(_deepARRef: React.MutableRefObject<any>) { /* disabled */ }
export function startDeepARRecording(_deepARRef: React.MutableRefObject<any>) { /* disabled */ }
export function stopDeepARRecording(_deepARRef: React.MutableRefObject<any>) { /* disabled */ }

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
export async function requestDeepARPermissions(): Promise<boolean> { return true; }
export async function getDeepARCameraPermission(): Promise<string> { return 'not-determined'; }

// ─────────────────────────────────────────────────────────────────────────────
// BEAUTY PARAMS
// ─────────────────────────────────────────────────────────────────────────────
export function setBeautyParams(
  _deepARRef: React.MutableRefObject<any>,
  _params: { smoothing?: number; teeth?: number },
) { /* disabled */ }

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────
export { DeepARCamera as DeepARCameraComponent };
