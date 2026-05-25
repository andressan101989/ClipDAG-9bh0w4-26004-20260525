/**
 * react-native.config.js
 *
 * Deshabilita el autolinking de ffmpeg-kit-react-native para iOS.
 * Android sigue compilando y enlazando normalmente via Gradle.
 * El paquete permanece instalado y disponible para import en JS/TS.
 */
module.exports = {
  dependencies: {
    'ffmpeg-kit-react-native': {
      platforms: {
        ios: null,  // no autolink en iOS — evita CocoaPods error
      },
    },
  },
};
