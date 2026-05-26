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

      // reanimated MUST be the last plugin
      'react-native-reanimated/plugin',
    ],
  };
};
