/**
 * metro.config.js
 *
 * Blocks packages that crash Metro/Hermes in preview and EAS builds.
 *
 * ── ALWAYS_BLOCKED (all platforms, including native preview) ─────────────────
 *   react-native-deepar          → requireNativeComponent at module-level
 *   react-native-dynamic         → requires react ^16.11.0
 *   react-native-webrtc          → unregistered native modules
 *   react-native-elements        → legacy peer dep conflict
 *   snack-content                → Expo Snack internal
 *   @walletconnect/*             → require native modules not in Expo Go / OnSpace preview
 *                                  They also pull in @opentelemetry with dynamic import()
 *                                  that Hermes cannot parse. WalletConnect only works in
 *                                  a full EAS build with native module support; gracefully
 *                                  degrade to no-op in preview.
 *   @web3modal/*                 → same issue, web3modal native dependencies
 *
 * ── OTEL_BLOCKED (all platforms) ────────────────────────────────────────────
 *   @opentelemetry/*             → Node.js/web instrumentation pulled in by @walletconnect.
 *                                  Contains: import(webpackIgnore / turbopackIgnore)
 *                                  Hermes rejects this → "Invalid expression encountered"
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

// Blocked on ALL platforms (preview + EAS build native + web)
const ALWAYS_BLOCKED = [
  'react-native-deepar',
  'react-native-dynamic',
  'react-native-webrtc',
  'react-native-elements',
  'snack-content',
];

// ALL @walletconnect/* and @web3modal/* — blocked on all platforms in preview.
// These require native modules that don't exist in the Expo Go / OnSpace preview
// runtime, and pull in @opentelemetry with dynamic import() that Hermes rejects.
// WalletConnect only works in a proper EAS native build.
const WALLETCONNECT_PREFIXES = [
  '@walletconnect/',
  '@web3modal/',
  'react-native-modal',  // pulled in by @walletconnect/modal-react-native
];

// ALL @opentelemetry/* — blocked on every platform.
// Contains: import(/* webpackIgnore */ /* turbopackIgnore */) syntax
// that Hermes on iOS cannot parse → "Invalid expression encountered" in main.jsbundle
const OTEL_PREFIXES = ['@opentelemetry/'];

// Blocked only on web / PC preview
const WEB_ONLY_BLOCKED = [
  'react-native-vision-camera',
  'react-native-vision-camera-face-detector',
  'react-native-worklets-core',
  'react-native-get-random-values',
];

const originalResolver = config.resolver?.resolveRequest;

config.resolver = {
  ...config.resolver,
  resolveRequest: (context, moduleName, platform) => {
    // 1. Block ALL @opentelemetry/* on every platform
    const isOtel = OTEL_PREFIXES.some(
      prefix => moduleName === prefix.slice(0, -1) || moduleName.startsWith(prefix),
    );
    if (isOtel) {
      return { type: 'sourceFile', filePath: EMPTY_STUB };
    }

    // 2. Block ALL @walletconnect/* and @web3modal/* on every platform
    const isWC = WALLETCONNECT_PREFIXES.some(
      prefix => moduleName === prefix.slice(0, -1) || moduleName.startsWith(prefix),
    );
    if (isWC) {
      return { type: 'sourceFile', filePath: EMPTY_STUB };
    }

    // 3. Always blocked
    const isAlways = ALWAYS_BLOCKED.some(
      b => moduleName === b || moduleName.startsWith(b + '/'),
    );
    if (isAlways) {
      return { type: 'sourceFile', filePath: EMPTY_STUB };
    }

    // 4. Web-only blocked
    if (platform === 'web' || platform === null) {
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
