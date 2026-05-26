module.exports = function (api) {
  api.cache(true);
  return {
    presets: [[
      'babel-preset-expo',
      {
        // unstable_transformImportMeta intentionally REMOVED.
        // metro.config.js CJS_ALIASES redirect valtio ESM paths (valtio/esm/*.mjs)
        // to their CJS equivalents before Metro ever tries to parse them.
        // The transform is therefore unnecessary and risks re-introducing
        // incompatible dynamic-import rewrites for any future ESM transitive dep.
      },
    ]],
    plugins: [
      // reanimated MUST be the last plugin
      'react-native-reanimated/plugin',
    ],
  };
};
