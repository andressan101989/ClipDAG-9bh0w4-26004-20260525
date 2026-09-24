import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

function parseJsonc(text) {
  return JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''));
}

async function config(name) {
  return parseJsonc(await readFile(new URL(`../wrangler.${name}.jsonc`, import.meta.url), 'utf8'));
}

test('defines isolated unbound and preview Admin configs', async () => {
  const unbound = await config('unbound');
  const preview = await config('preview');

  for (const item of [unbound, preview]) {
    assert.equal(item.name, 'nelyon-admin-web');
    assert.equal(item.main, './worker.mjs');
    assert.equal(item.assets.directory, '../dist');
    assert.equal(item.assets.binding, 'ASSETS');
    assert.equal(item.assets.run_worker_first, true);
    assert.equal(item.assets.html_handling, 'none');
    assert.equal(item.assets.not_found_handling, 'none');
    assert.equal('routes' in item, false);
    assert.doesNotMatch(JSON.stringify(item), /nelyon\.app|\/admin|custom_domain/i);
  }

  assert.equal(unbound.workers_dev, false);
  assert.equal(unbound.preview_urls, false);
  assert.equal(preview.workers_dev, true);
  assert.equal(preview.preview_urls, true);
});

test('has no Admin production config or production deploy script', async () => {
  await assert.rejects(access(new URL('../wrangler.production.jsonc', import.meta.url)));
  const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal('deploy:production' in packageJson.scripts, false);
  assert.match(packageJson.scripts['deploy:isolated'] ?? '', /wrangler\.unbound\.jsonc/);
  assert.match(packageJson.scripts['upload:preview'] ?? '', /versions upload/);
});
