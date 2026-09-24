import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

function parseJsonc(text) {
  return JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''));
}

async function config(name) {
  return parseJsonc(await readFile(new URL(`../wrangler.${name}.jsonc`, import.meta.url), 'utf8'));
}

test('defines safe unbound, preview, and route-only Business configs', async () => {
  const unbound = await config('unbound');
  const preview = await config('preview');
  const route = await config('route');

  for (const item of [unbound, preview, route]) {
    assert.equal(item.name, 'nelyon-business-web');
    assert.equal(item.main, './worker.mjs');
    assert.equal(item.assets.directory, '../dist');
    assert.equal(item.assets.binding, 'ASSETS');
    assert.equal(item.assets.run_worker_first, true);
    assert.equal(item.assets.html_handling, 'none');
    assert.equal(item.assets.not_found_handling, 'none');
  }

  assert.equal(unbound.workers_dev, false);
  assert.equal(unbound.preview_urls, false);
  assert.equal('routes' in unbound, false);

  assert.equal(preview.workers_dev, true);
  assert.equal(preview.preview_urls, true);
  assert.equal('routes' in preview, false);

  assert.equal(route.workers_dev, false);
  assert.equal(route.preview_urls, false);
  assert.deepEqual(route.routes, [{ pattern: 'nelyon.app/business/*', zone_name: 'nelyon.app' }]);
  assert.notEqual(route.routes[0].pattern, 'nelyon.app/business*');
  assert.equal(route.routes.some((item) => item.custom_domain === true), false);
});

test('keeps route application separate from version upload and deployment', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.match(packageJson.scripts['build:deployment'] ?? '', /buildPublicSupabaseSpa/);
  assert.match(packageJson.scripts['test:deployment'] ?? '', /shared\/web-deployment/);
  assert.doesNotMatch(packageJson.scripts['upload:preview'] ?? '', /wrangler\.route/);
  assert.doesNotMatch(packageJson.scripts['deploy:isolated'] ?? '', /wrangler\.route/);
  assert.doesNotMatch(packageJson.scripts['apply:production-route'] ?? '', /wrangler deploy|versions upload/);
  assert.match(packageJson.scripts['promote:version'] ?? '', /versions deploy/);
});
