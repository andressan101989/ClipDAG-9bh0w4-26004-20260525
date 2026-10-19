import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { getMetroServerRoot, resolveEntryPoint } = require('@expo/config/paths');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function findFile(root, predicate) {
  for (const name of readdirSync(root)) {
    const candidate = path.join(root, name);
    if (statSync(candidate).isDirectory()) {
      const nested = findFile(candidate, predicate);
      if (nested) return nested;
    } else if (predicate(candidate)) {
      return candidate;
    }
  }
  return null;
}

test('the iOS Expo Router entry remains inside the Metro server root with shared dependencies', () => {
  const serverRoot = realpathSync(getMetroServerRoot(projectRoot));
  const entryFile = resolveEntryPoint(projectRoot, { platform: 'ios' });
  const relativeEntry = path.relative(serverRoot, entryFile);

  assert.equal(
    relativeEntry.startsWith(`..${path.sep}`) || path.isAbsolute(relativeEntry),
    false,
    `Expo resolved an entry outside Metro's root: ${relativeEntry}`,
  );
  assert.equal(entryFile, path.join(projectRoot, 'index.js'));
});

test('the exported iOS entry owns the app route context instead of delegating it through shared dependencies', () => {
  const outputDir = mkdtempSync(path.join(tmpdir(), 'nelyon-router-entry-'));

  try {
    const expoCli = require.resolve('expo/bin/cli');
    const result = spawnSync(
      process.execPath,
      [
        expoCli,
        'export',
        '--platform',
        'ios',
        '--dev',
        '--no-bytecode',
        '--no-minify',
        '--output-dir',
        outputDir,
      ],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        env: { ...process.env, EXPO_NO_TELEMETRY: '1' },
        timeout: 180_000,
      },
    );

    assert.equal(
      result.status,
      0,
      `Expo export failed:\n${result.stdout}\n${result.stderr}`,
    );

    const bundlePath = findFile(
      outputDir,
      (candidate) => candidate.includes(`${path.sep}ios${path.sep}`) && candidate.endsWith('.js'),
    );
    assert.ok(bundlePath, 'Expo export did not emit an iOS JavaScript bundle');

    const bundle = readFileSync(bundlePath, 'utf8');
    assert.equal(
      /expo-router[\\/]_ctx\.ios\.js/.test(bundle),
      false,
      'the route context must not be created from the shared expo-router package tree',
    );
    assert.match(bundle, /app\?ctx=/, 'the iOS bundle must contain the project app route context');
    assert.match(bundle, /\.\/index\.tsx/, 'the project app route context must include the root route');
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});
