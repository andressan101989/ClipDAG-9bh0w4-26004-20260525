module.exports = function (api) {
  api.cache(true);
  return {
    presets: [[
      'babel-preset-expo',
      {
        // Required: valtio (used by @walletconnect) ships ESM with `import.meta.env`.
        // Hermes does not support import.meta natively — this polyfill rewrites it.
        // Safe to enable now that @opentelemetry/* is fully blocked in metro.config.js
        // (those packages contained dynamic import() that conflicted with this option).
        unstable_transformImportMeta: true,
      },
    ]],
    plugins: [
      // reanimated MUST be the last plugin
      'react-native-reanimated/plugin',
    ],
  };
};
