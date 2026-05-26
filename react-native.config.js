/**
 * react-native.config.js
 *
 * Deshabilita el autolinking nativo en iOS para módulos que:
 *  - Requieren setup nativo especial no disponible en EAS managed
 *  - Crashean al inicializarse sin configuración nativa adicional
 *  - Están bloqueados en Metro (JS) pero sus CocoaPods siguen enlazándose
 *
 * IMPORTANTE: "ios: null" desactiva CocoaPods autolinking en iOS.
 * Los paquetes permanecen instalados — Metro los bloquea en JS también
 * via ALWAYS_BLOCKED / WEB_ONLY_BLOCKED en metro.config.js.
 *
 * DIAGNÓSTICO iOS "Failed to launch app":
 *  - react-native-deepar: SDK nativo crashea sin API key válido configurado
 *    via plugin iOS. withDeepARAndroidFix solo toca Android, no iOS.
 *  - react-native-webrtc: módulo nativo inestable en Expo managed workflow,
 *    registra NativeModules antes del bridge JS — crash en startup.
 *  - ffmpeg-kit-react-native: binario FFmpeg XCFramework demasiado grande,
 *    incrementa boot time y puede crashear en dispositivos con memoria limitada.
 */
module.exports = {
  dependencies: {
    // ── Deshabilita autolinking iOS ──────────────────────────────────────────
    'react-native-deepar': {
      platforms: {
        ios: null,     // DeepAR SDK crashea sin API key nativo — deshabilitar CocoaPods
        android: null, // Metro bloquea JS; Android build.gradle también excluido
      },
    },
    'react-native-webrtc': {
      platforms: {
        ios: null,     // NativeModules crash en startup — Expo managed no soportado
        android: null, // Metro bloquea JS también
      },
    },
    'ffmpeg-kit-react-native': {
      platforms: {
        ios: null,     // XCFramework demasiado grande — deshabilitar CocoaPods
        // Android: autolinking habilitado (Gradle funciona correctamente)
      },
    },
    // ── Vision Camera — también excluido de native para evitar pod conflicts ──
    'react-native-vision-camera': {
      platforms: {
        ios: null,
        android: null,
      },
    },
    'react-native-worklets-core': {
      platforms: {
        ios: null,
        android: null,
      },
    },
  },
};
