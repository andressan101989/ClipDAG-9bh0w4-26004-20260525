/**
 * metro.config.js
 *
 * Blocks packages that crash Metro/Hermes:
 *
 * ALWAYS_BLOCKED (all platforms):
 *   - react-native-deepar              → requireNativeComponent at module-level
 *   - react-native-dynamic             → requires react ^16.11.0
 *   - react-native-webrtc              → unregistered native modules
 *   - react-native-elements            → legacy peer dep conflict
 *   - snack-content                    → Expo Snack internal
 *
 * OTEL_BLOCKED (all platforms):
 *   - @opentelemetry/*                 → dynamic import() incompatible with Hermes iOS
 *     Pulled in as transitive dep by @walletconnect packages.
 *     Contains:  import(webpackIgnore / turbopackIgnore)
 *     Hermes rejects this syntax → "Invalid expression encountered" in main.jsbundle
 *
 * WEB_ONLY_BLOCKED:
 *   - react-native-vision-camera, react-native-worklets-core, etc.
 *   - @walletconnect/* native packages crash on web/preview
 */

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

const EMPTY_STUB = path.resolve(__dirname, '_metro_empty_stub.js');

const ALWAYS_BLOCKED = [
  'react-native-deepar',
  'react-native-dynamic',
  'react-native-webrtc',
  'react-native-elements',
  'snack-content',
];

// ALL @opentelemetry/* packages — block on every platform.
// These are Node.js/web instrumentation libs pulled in by @walletconnect.
// They contain dynamic import(/* webpackIgnore */ ...) syntax that Hermes rejects.
const OTEL_PREFIXES = ['@opentelemetry/'];

const WEB_ONLY_BLOCKED = [
  'react-native-vision-camera',
  'react-native-vision-camera-face-detector',
  'react-native-worklets-core',
  'react-native-get-random-values',
  '@walletconnect/modal-react-native',
  '@walletconnect/react-native-compat',
  // WalletConnect core packages also pull in @opentelemetry on web
  '@walletconnect/core',
  '@walletconnect/sign-client',
  '@walletconnect/web3wallet',
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

    // 2. Always blocked
    const isAlways = ALWAYS_BLOCKED.some(
      b => moduleName === b || moduleName.startsWith(b + '/'),
    );
    if (isAlways) {
      return { type: 'sourceFile', filePath: EMPTY_STUB };
    }

    // 3. Web-only blocked
    const isWeb = platform === 'web';
    if (isWeb) {
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
