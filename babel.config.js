module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { unstable_transformImportMeta: true }]],
    plugins: [
      // reanimated MUST be the last plugin
      'react-native-reanimated/plugin',
    ],
  };
};
