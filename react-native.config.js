/**
 * react-native.config.js
 *
 * Controla el autolinking nativo (CocoaPods iOS / Gradle Android)
 * para módulos que requieren configuración especial o que fueron
 * excluidos para estabilizar el startup nativo iOS.
 *
 * ESTADO ACTUAL (Fase 1 DeepAR re-integración):
 *  - react-native-deepar: iOS autolinking DESACTIVADO para aislar crash.
 *    Android autolinking sigue activo.
 *    El SDK JS sigue siendo lazy-loaded (solo en deepar-test y creator-studio).
 *
 *  - @walletconnect/react-native-compat: iOS excluido — NSDictionary nil crash en startup.
 *  - react-native-maps: iOS excluido — AIRGoogleMapManager.constantsToExport llama a
 *    [GMSServices openSourceLicenseInfo] sin API key → nil → NSInvalidArgumentException.
 *    No se usa en ningún archivo JS. Android activo.
 *  - react-native-webrtc: sigue excluido — crash nativo en Expo managed.
 *  - ffmpeg-kit-react-native: excluido iOS — XCFramework demasiado pesado.
 *  - react-native-vision-camera: excluido — no se usa en la app actualmente.
 *  - react-native-worklets-core: excluido — dependencia de vision-camera.
 */
module.exports = {
  dependencies: {
    // ── react-native-deepar: iOS autolinking RE-ENABLED ──────────────────────
    // API key injected into Info.plist at build time via plugins/withDeepARiOS.js.
    // metro.config.js stubs react-native-deepar for web/preview/Android; iOS EAS
    // builds resolve the real SDK so CocoaPods autolinking picks it up correctly.
    'react-native-deepar': {
      platforms: {
        // iOS autolinking re-enabled — withDeepARiOS.js injects DEEPAR_API_KEY_IOS
        // Android: autolinking habilitado (no override needed)
      },
    },

    // ── @walletconnect/react-native-compat: iOS EXCLUIDO ─────────────────────
    // NSDictionary nil crash en startup — confirmed root cause.
    // Android autolinking sigue activo.
    '@walletconnect/react-native-compat': {
      platforms: {
        ios: null,
      },
    },

    // ── react-native-maps: iOS EXCLUIDO ──────────────────────────────────────
    // AIRGoogleMapManager.constantsToExport calls [GMSServices openSourceLicenseInfo]
    // at module registration. No API key → nil → NSInvalidArgumentException crash.
    // Not imported anywhere in JS. Android autolinking remains active.
    'react-native-maps': {
      platforms: {
        ios: null,
      },
    },

    // ── react-native-webrtc: sigue EXCLUIDO ──────────────────────────────────
    // NativeModules crash en startup en Expo managed workflow iOS.
    'react-native-webrtc': {
      platforms: {
        ios: null,
        android: null,
      },
    },

    // ── ffmpeg-kit-react-native: iOS excluido — Android ok ───────────────────
    // XCFramework demasiado pesado para EAS managed iOS.
    'ffmpeg-kit-react-native': {
      platforms: {
        ios: null,
        // Android: autolinking habilitado
      },
    },

    // ── react-native-vision-camera: excluido (no en uso activo) ─────────────
    'react-native-vision-camera': {
      platforms: {
        ios: null,
        android: null,
      },
    },

    // ── react-native-worklets-core: excluido (dependencia de vision-camera) ──
    'react-native-worklets-core': {
      platforms: {
        ios: null,
        android: null,
      },
    },
  },
};
