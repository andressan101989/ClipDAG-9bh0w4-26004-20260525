import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readRoot = file => JSON.parse(readFileSync(new URL('../../' + file, import.meta.url), 'utf8'));

// The callers retain their exact lockfile hash. Compare the manifest's install
// contract to that pinned lock root, allowing unrelated scripts/metadata to evolve.
export function assertDependencyContract(
  manifest = readRoot('package.json'),
  lock = readRoot('package-lock.json'),
) {
  const root = lock.packages?.[''];
  assert.ok(root && typeof root === 'object', 'package-lock root is required');
  for (const field of [
    'dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies',
    'peerDependenciesMeta', 'bundleDependencies', 'bundledDependencies', 'workspaces',
    'engines', 'os', 'cpu', 'libc', 'devEngines', 'packageManager',
  ]) {
    assert.deepEqual(manifest[field], root[field], `Dependency contract drift: ${field}`);
  }
  // npm does not reliably preserve these in packages['']; their approved state
  // is absent, so equality with a newly added lock-root value is insufficient.
  for (const field of ['overrides', 'resolutions']) {
    assert.equal(Object.hasOwn(manifest, field), false, `Unapproved ${field} in package.json`);
    assert.equal(Object.hasOwn(root, field), false, `Unapproved ${field} in package-lock root`);
  }
}
