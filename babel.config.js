module.exports = function (api) {
  api.cache(true);
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

      // reanimated v4: plugin moved to react-native-worklets/plugin
      // react-native-reanimated/plugin now re-exports this internally but
      // requires react-native-worklets to be resolvable first.
      'react-native-worklets/plugin',
    ],
  };
};
