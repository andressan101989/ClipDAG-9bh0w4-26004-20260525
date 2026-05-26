/**
 * react-native.config.js
 *
 * Controla el autolinking nativo (CocoaPods iOS / Gradle Android)
 * para módulos que requieren configuración especial o que fueron
 * excluidos para estabilizar el startup nativo iOS.
 *
 * ESTADO ACTUAL (Fase 1 DeepAR re-integración):
 *  - react-native-deepar: autolinking RE-ACTIVADO en iOS y Android.
 *    La API key nativa se configura vía plugins/withDeepARiOS.js (Info.plist).
 *    El SDK JS sigue siendo lazy-loaded (solo en deepar-test y creator-studio).
 *
 *  - react-native-webrtc: sigue excluido — crash nativo en Expo managed.
 *  - ffmpeg-kit-react-native: excluido iOS — XCFramework demasiado pesado.
 *  - react-native-vision-camera: excluido — no se usa en la app actualmente.
 *  - react-native-worklets-core: excluido — dependencia de vision-camera.
 */
module.exports = {
  dependencies: {
    // ── react-native-deepar: CocoaPods autolinking RE-ACTIVADO ────────────────
    // La API key iOS se inyecta en Info.plist vía plugins/withDeepARiOS.js.
    // Sin API key, el SDK crashea al inicializar — ese era el root cause original.
    // El SDK JS es lazy-loaded exclusivamente en deepar-test.tsx y creator-studio.
    // metro.config.js bloquea react-native-deepar solo en web/preview (no en EAS).
    'react-native-deepar': {
      // Sin plataformas null = autolinking habilitado en iOS y Android
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
