/**
 * metro.config.js  — v3 (Hermes Hardened)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ROOT CAUSE: OTEL_PKG dynamic import in @supabase/realtime-js
 * ════════════════════════════════════════════════════════════════════════════
 *
 * @supabase/realtime-js ships packages/shared/tracing/src/extract.ts which
 * contains:
 *
 *   const OTEL_PKG = '@opentelemetry/api'
 *   otelModulePromise = import(/* webpackIgnore * / OTEL_PKG).catch(() => null)
 *
 * Metro bundles this verbatim. Hermes on iOS/Android cannot parse dynamic
 * imports of variables — only string literals. Result:
 *
 *   main.jsbundle:102219:57: error: Invalid expression encountered
 *   ...se = import(/* webpackIgnore: true * / OTEL_PKG).catch...
 *
 * ── TWO-LAYER FIX ────────────────────────────────────────────────────────────
 *
 * Layer 1 (Babel, plugins/babel-strip-dynamic-imports.js):
 *   Transforms import(variable) → Promise.resolve(null) at Babel time.
 *   Runs BEFORE Metro serialises the bundle so Hermes never sees the bad syntax.
 *   String-literal dynamic imports are untouched.
 *
 * Layer 2 (Metro resolver — this file):
 *   Block all @opentelemetry/* on every platform as a belt-and-suspenders.
 *   Even if the Babel pass misses a file, the blocked import returns an empty
 *   stub and the optional-dependency load fails gracefully.
 *
 * ── ALWAYS_BLOCKED (all platforms, including native preview) ─────────────────
 *   react-native-deepar          → requireNativeComponent at module-level
 *   react-native-dynamic         → requires react ^16.11.0
 *   react-native-webrtc          → unregistered native modules
 *   react-native-elements        → legacy peer dep conflict
 *   snack-content                → Expo Snack internal
 *
 * ── CJS_ALIASES: Force CommonJS builds for ESM-only packages ────────────────
 *   valtio                       → ESM build uses import.meta (Hermes incompatible)
 *                                  Force the CJS build instead so no babel transform needed
 *
 * ── OTEL_BLOCKED (all platforms) ────────────────────────────────────────────
 *   @opentelemetry/*             → Node.js/web instrumentation pulled in by @walletconnect
 *                                  AND by @supabase/realtime-js tracing module.
 *                                  Contains: import(OTEL_PKG) — Hermes fatal.
 *
 * ── WALLETCONNECT: web/preview blocked only, native EAS loads normally ─────
 *   @walletconnect/*             → blocked on web/preview (no native modules);
 *                                  native EAS iOS/Android loads the real SDK.
 *   @web3modal/*                 → same constraint
 *
 * ── WEB_ONLY_BLOCKED ────────────────────────────────────────────────────────
 *   react-native-vision-camera   → requires native camera module
 *   react-native-worklets-core   → requires native worklets
 *   react-native-get-random-values → native crypto module
 */

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

const EMPTY_STUB = path.resolve(__dirname, '_metro_empty_stub.js');

// ── Blocked on ALL platforms (preview + EAS build native + web) ──────────────
const ALWAYS_BLOCKED = [
  // react-native-deepar: blocked until DEEPAR_API_KEY_IOS / DEEPAR_API_KEY_ANDROID
  // are configured. The native module calls requireNativeComponent at module level
  // and crashes on startup without valid API keys.
  'react-native-deepar',
  'react-native-dynamic',
  'react-native-webrtc',
  'react-native-elements',
  'snack-content',
];

// ── CJS aliases: force CommonJS builds for packages that ship broken ESM ─────
// valtio ships an ESM build (valtio/esm/react.mjs) with `import.meta.env`
// which Hermes cannot parse. Metro resolves ESM by default; redirect to CJS.
const CJS_ALIASES = {
  'valtio/esm/react.mjs':   'valtio/react',
  'valtio/esm/index.mjs':   'valtio',
  'valtio/esm/vanilla.mjs': 'valtio/vanilla',
  'valtio/esm/utils.mjs':   'valtio/utils',
};

// ── SUPABASE_TRACING_BLOCKED ─────────────────────────────────────────────────
// @supabase/realtime-js and @supabase/supabase-js ship a tracing module that
// does: import(/* webpackIgnore */ OTEL_PKG) — a dynamic import of a variable.
// Hermes cannot parse this. Block the entire tracing sub-path so it resolves
// to an empty stub. Supabase core functionality is unaffected; only the
// optional OpenTelemetry tracing integration is disabled.
//
// The module paths observed in the wild:
//   @supabase/realtime-js/dist/module/lib/tracing/...
//   @supabase/supabase-js/dist/module/lib/tracing/...
//   @supabase/shared/tracing/...
const SUPABASE_TRACING_PATHS = [
  '@supabase/realtime-js/dist/module/lib/tracing',
  '@supabase/realtime-js/dist/cjs/lib/tracing',
  '@supabase/realtime-js/src/lib/tracing',
  '@supabase/supabase-js/dist/module/lib/tracing',
  '@supabase/supabase-js/dist/cjs/lib/tracing',
];

// ── @walletconnect/* and @web3modal/* — BLOCKED ON WEB/PREVIEW ONLY ─────────
// On native EAS builds (iOS/Android) WalletConnect loads normally.
// On web/preview it's blocked because the SDK requires native modules not
// available in web/preview environments.
// NOTE: The startup crash was caused by top-level require() in
// useExternalWallet.native.ts — that file now uses lazy require() inside
// openModal() so it never executes at module load time.
const WALLETCONNECT_PREFIXES = [
  '@walletconnect/',
  '@web3modal/',
  'react-native-modal',  // pulled in by @walletconnect/modal-react-native
];

// ── ALL @opentelemetry/* — blocked on every platform ─────────────────────────
// Contains: import(/* webpackIgnore */ /* turbopackIgnore */) syntax
// that Hermes on iOS cannot parse → "Invalid expression encountered" in main.jsbundle
const OTEL_PREFIXES = ['@opentelemetry/'];

// ── Blocked only on web / PC preview ─────────────────────────────────────────
// react-native-deepar is included here so the web preview doesn't crash
// with "requireNativeComponent is not a function" — but on iOS/Android EAS
// builds it loads normally (not blocked).
const WEB_ONLY_BLOCKED = [
  'react-native-deepar',
  'react-native-vision-camera',
  'react-native-vision-camera-face-detector',
  'react-native-worklets-core',
  'react-native-get-random-values',
  // Native-only SDKs — crash on web/preview, work fine in EAS native builds
  'react-native-incall-manager',
  '@react-native-ml-kit/face-detection',
  'ffmpeg-kit-react-native',
];

const originalResolver = config.resolver?.resolveRequest;

config.resolver = {
  ...config.resolver,
  resolveRequest: (context, moduleName, platform) => {
    // 1. CJS aliases — redirect ESM builds with import.meta to their CJS equivalents
    if (CJS_ALIASES[moduleName]) {
      return context.resolveRequest(context, CJS_ALIASES[moduleName], platform);
    }

    // 2. Block ALL @opentelemetry/* on every platform
    const isOtel = OTEL_PREFIXES.some(
      prefix => moduleName === prefix.slice(0, -1) || moduleName.startsWith(prefix),
    );
    if (isOtel) {
      return { type: 'sourceFile', filePath: EMPTY_STUB };
    }

    // 2b. Block Supabase tracing sub-paths (contain import(OTEL_PKG) dynamic imports)
    const isSupabaseTracing = SUPABASE_TRACING_PATHS.some(
      p => moduleName === p || moduleName.startsWith(p + '/'),
    );
    if (isSupabaseTracing) {
      return { type: 'sourceFile', filePath: EMPTY_STUB };
    }

    // 3. Block @walletconnect/* and @web3modal/* only on web/preview
    // On native EAS builds (iOS/Android) the SDK loads normally — required for
    // WalletConnect QR modal to work on physical devices.
    const isWC = WALLETCONNECT_PREFIXES.some(
      prefix => moduleName === prefix.slice(0, -1) || moduleName.startsWith(prefix),
    );
    if (isWC && (platform === 'web' || platform === null)) {
      return { type: 'sourceFile', filePath: EMPTY_STUB };
    }

    // 4. Always blocked
    const isAlways = ALWAYS_BLOCKED.some(
      b => moduleName === b || moduleName.startsWith(b + '/'),
    );
    if (isAlways) {
      return { type: 'sourceFile', filePath: EMPTY_STUB };
    }

    // 5. Web-only / preview blocked (NOT blocked on iOS/Android EAS builds)
    // react-native-deepar is in this list so web preview stays crash-free,
    // but the native EAS build loads the real SDK.
    const isPreview = platform === 'web' || platform === null;
    if (isPreview) {
      const isWebBlocked = WEB_ONLY_BLOCKED.some(
        b => moduleName === b || moduleName.startsWith(b + '/'),
      );
      if (isWebBlocked) {
        return { type: 'sourceFile', filePath: EMPTY_STUB };
      }
    }

    if (originalResolver) {
      return originalResolver(context, moduleName, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
  },
};

module.exports = config;
