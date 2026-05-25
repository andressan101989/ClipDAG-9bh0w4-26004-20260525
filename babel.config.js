module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo']],
    // NOTE: unstable_transformImportMeta removed — it causes @opentelemetry packages
    // (pulled in by @walletconnect) to emit import(/* webpackIgnore */ ...) dynamic
    // imports that Hermes on iOS cannot parse: "Invalid expression encountered".
    plugins: [
      // reanimated MUST be the last plugin
      'react-native-reanimated/plugin',
    ],
  };
};
