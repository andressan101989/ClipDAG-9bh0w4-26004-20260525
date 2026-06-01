module.exports = function (api) {
  api.cache(true);

  // ── Reanimated plugin resolution ─────────────────────────────────────────
  // Expo SDK 54 ships with react-native-reanimated ~3.x (v3).
  // v3 bundles its Babel plugin at 'react-native-reanimated/plugin'.
  // v4 moved the plugin to a separate 'react-native-worklets' peer package.
  //
  // If the installed version is v4 AND react-native-worklets is present,
  // use 'react-native-worklets/plugin'.
  // Otherwise fall back to the v3 bundled plugin.
  let reanimatedPlugin = 'react-native-reanimated/plugin';
  try {
    // Check if this is reanimated v4 by looking for the worklets peer
    require.resolve('react-native-worklets/plugin');
    reanimatedPlugin = 'react-native-worklets/plugin';
  } catch (_) {
    // react-native-worklets not installed → use bundled v3 plugin
    reanimatedPlugin = 'react-native-reanimated/plugin';
  }

  return {
    presets: [[
      'babel-preset-expo',
      {
        // unstable_transformImportMeta: replaces import.meta.env with a
        // process.env-based polyfill that Hermes can parse.
        // Required because valtio ships ESM builds with import.meta.env
        // (e.g. valtio/esm/react.mjs line 53) that Hermes cannot handle.
        // The metro.config.js CJS_ALIASES are a belt-and-suspenders but
        // the Metro resolver intercepts by module name — when a transitive
        // dep already resolved to the full file path Babel is the last guard.
        unstable_transformImportMeta: true,
      },
    ]],
    plugins: [
      // ── strip-dynamic-variable-imports ──────────────────────────────────────
      // Converts:  import(/* webpackIgnore */ OTEL_PKG)  →  Promise.resolve(null)
      //
      // Root cause: @supabase/realtime-js ships tracing/extract.ts which does
      // import(/* webpackIgnore: true */ /* turbopackIgnore: true */ OTEL_PKG)
      // where OTEL_PKG = '@opentelemetry/api'. Hermes cannot parse dynamic
      // imports of variables — only string literals. This Babel pass runs
      // BEFORE Metro serialises the bundle, so Hermes never sees the bad syntax.
      //
      // String-literal dynamic imports (import('./file')) are untouched.
      // This plugin is safe to apply on all platforms.
      './plugins/babel-strip-dynamic-imports',

      // Resolved above: v3 → 'react-native-reanimated/plugin'
      //                 v4 → 'react-native-worklets/plugin' (if worklets present)
      reanimatedPlugin,
    ],
  };
};
