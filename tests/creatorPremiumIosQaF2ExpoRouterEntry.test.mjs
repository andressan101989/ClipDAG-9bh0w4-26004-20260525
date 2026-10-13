import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { getMetroServerRoot, resolveEntryPoint } = require('@expo/config/paths');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
  assert.match(
    readFileSync(entryFile, 'utf8'),
    /import\s+['"]expo-router\/entry['"]/,
    'the project-local entry must delegate to the canonical Expo Router entry',
  );
});
