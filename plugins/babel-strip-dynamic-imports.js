/**
 * plugins/babel-strip-dynamic-imports.js
 *
 * Babel plugin that strips dynamic variable imports before Hermes sees them.
 *
 * Targets EXACTLY the pattern that causes Hermes to crash:
 *
 *   import(/* webpackIgnore: true *\/ /* turbopackIgnore: true *\/ OTEL_PKG)
 *   import(/* @vite-ignore webpackIgnore: true *\/ OTEL_PKG)
 *   import(/* ... *\/ someVariable)
 *
 * These appear in:
 *   - @supabase/realtime-js  → packages/shared/tracing/src/extract.ts
 *   - Any future package using the same pattern
 *
 * Replacement strategy:
 *   Dynamic import of a non-string expression → Promise.resolve(null)
 *   This makes the optional-dependency pattern fail gracefully (otelModulePromise = null)
 *   rather than crash Hermes.
 *
 * String literal dynamic imports (import('./some-file')) are intentionally
 * left alone — those are valid code-split patterns.
 */

'use strict';

module.exports = function babelStripDynamicImports({ types: t }) {
  return {
    name: 'strip-dynamic-variable-imports',
    visitor: {
      /**
       * Import expressions: import(expr)
       * Only strip when the argument is NOT a string literal.
       * String literals are valid and needed for code splitting.
       */
      CallExpression(nodePath) {
        const node = nodePath.node;

        // Match: import(expr) — the callee is a special "Import" node
        if (node.callee.type !== 'Import') return;

        const arg = node.arguments[0];
        if (!arg) return;

        // Leave string literal dynamic imports alone
        if (t.isStringLiteral(arg)) return;
        if (t.isTemplateLiteral(arg) && arg.expressions.length === 0) return;

        // Replace import(variable) → Promise.resolve(null)
        nodePath.replaceWith(
          t.callExpression(
            t.memberExpression(t.identifier('Promise'), t.identifier('resolve')),
            [t.nullLiteral()],
          ),
        );
      },
    },
  };
};
