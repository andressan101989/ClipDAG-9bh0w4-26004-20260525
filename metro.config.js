/**
 * metro.config.js
 *
 * Blocks incompatible packages from crashing the Metro bundler.
 *
 * Always-blocked (all platforms):
 *   - react-native-dynamic  (requires react ^16.11.0)
 *   - react-native-webrtc   (requires unregistered native modules)
 *   - react-native-elements (legacy peer dep conflict)
 *   - snack-content         (Expo Snack internal, not for production)
 *
 * Web-only blocked (native modules that crash the Node/web bundler):
 *   - react-native-vision-camera          (native frames API, no web support)
 *   - react-native-vision-camera-face-detector (ML Kit, native only)
 *   - react-native-worklets-core          (JSI worklets, native only)
 *   - react-native-get-random-values      (native crypto, no web)
 *   - @walletconnect/modal-react-native   (native WalletConnect, no web)
 *   - @walletconnect/react-native-compat  (native WalletConnect, no web)
 */

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// ── Stub file: an empty CommonJS module returned for blocked packages ─────────
const EMPTY_STUB = path.resolve(__dirname, '_metro_empty_stub.js');

// Blocked on ALL platforms
const ALWAYS_BLOCKED = [
  'react-native-dynamic',
  'react-native-webrtc',
  'react-native-elements',
  'snack-content',
];

// Blocked ONLY on web (native-only modules that cannot be resolved in Node)
// NOTE: react-native-vision-camera and react-native-worklets-core are intentionally
// listed here — they are only used on native via .native.ts file extensions.
// Metro automatically resolves .native.ts on iOS/Android, so blocking on web is safe.
const WEB_ONLY_BLOCKED = [
  'react-native-vision-camera',
  'react-native-vision-camera-face-detector',
  'react-native-worklets-core',
  'react-native-get-random-values',
  '@walletconnect/modal-react-native',
  '@walletconnect/react-native-compat',
];

const originalResolver = config.resolver?.resolveRequest;

config.resolver = {
  ...config.resolver,
  resolveRequest: (context, moduleName, platform) => {
    const isAlwaysBlocked = ALWAYS_BLOCKED.some(
      blocked => moduleName === blocked || moduleName.startsWith(blocked + '/'),
    );
    if (isAlwaysBlocked) {
      console.warn(`[Metro] Stubbing incompatible module: ${moduleName}`);
      return { type: 'sourceFile', filePath: EMPTY_STUB };
    }

    const isWebBlocked =
      platform === 'web' &&
      WEB_ONLY_BLOCKED.some(
        blocked => moduleName === blocked || moduleName.startsWith(blocked + '/'),
      );
    if (isWebBlocked) {
      console.warn(`[Metro] Stubbing web-incompatible native module: ${moduleName}`);
      return { type: 'sourceFile', filePath: EMPTY_STUB };
    }

    if (originalResolver) {
      return originalResolver(context, moduleName, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
  },
};

module.exports = config;
