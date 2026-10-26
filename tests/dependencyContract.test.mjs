import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = file => JSON.parse(readFileSync(new URL('../' + file, import.meta.url), 'utf8'));
const manifest = read('package.json');
const lock = read('package-lock.json');
const helper = await import('./helpers/dependencyContract.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const check = (...args) => {
  assert.equal(typeof helper.assertDependencyContract, 'function', 'shared dependency contract helper is required');
  return helper.assertDependencyContract(...args);
};
test('dependency guard accepts the current manifest and script-only or formatting changes', () => {
  check(manifest, lock);
  check({ ...manifest, scripts: { ...manifest.scripts, 'c1-proof': 'node proof.mjs' } }, lock);
  check(JSON.parse(JSON.stringify(manifest, null, 4)), lock);
});
for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta',
  'bundleDependencies', 'bundledDependencies', 'workspaces', 'engines', 'os', 'cpu', 'libc', 'devEngines', 'packageManager']) {
  test(`dependency guard rejects changed ${field} root declarations`, () => {
    check(manifest, lock);
    const changed = structuredClone(manifest);
    changed[field] = ['workspaces', 'bundleDependencies', 'bundledDependencies', 'os', 'cpu', 'libc'].includes(field)
      ? ['unexpected'] : field === 'packageManager' ? 'npm@0.0.0' : { ...changed[field], unexpected: '1.0.0' };
    assert.throws(() => check(changed, lock), { name: 'AssertionError' });
  });
}
for (const field of ['overrides', 'resolutions']) {
  test(`dependency guard rejects ${field} even if copied into the lock root`, () => {
    check(manifest, lock);
    const changed = { ...manifest, [field]: { react: '0.0.0' } };
    const changedLock = structuredClone(lock);
    changedLock.packages[''][field] = changed[field];
    assert.throws(() => check(changed, changedLock), { name: 'AssertionError' });
  });
}
test('dependency guard rejects removed dependencies and missing lock root', () => {
  check(manifest, lock);
  const changed = structuredClone(manifest);
  delete changed.dependencies.react;
  assert.throws(() => check(changed, lock), { name: 'AssertionError' });
  assert.throws(() => check(manifest, { packages: {} }), { name: 'AssertionError' });
});

test('dependency guard rejects a changed lock root against the unchanged manifest', () => {
  check(manifest, lock);
  const changedLock = structuredClone(lock);
  changedLock.packages[''].dependencies.react = '0.0.0';
  assert.throws(() => check(manifest, changedLock), { name: 'AssertionError' });
});
