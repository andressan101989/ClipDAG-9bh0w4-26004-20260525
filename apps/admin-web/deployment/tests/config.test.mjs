import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

function parseJsonc(text) {
  return JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''));
}

async function config(name) {
  return parseJsonc(await readFile(new URL(`../wrangler.${name}.jsonc`, import.meta.url), 'utf8'));
}

test('defines isolated unbound, preview, and route-only Admin configs', async () => {
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

  const route = await config('route');
  assert.equal(route.name, 'nelyon-admin-web');
  assert.deepEqual(route.routes, [
    { pattern: 'nelyon.app/admin', zone_name: 'nelyon.app' },
    { pattern: 'nelyon.app/admin/*', zone_name: 'nelyon.app' },
  ]);
  assert.equal(route.routes.some((item) => item.pattern === 'nelyon.app/admin*'), false);
  assert.equal(route.routes.some((item) => item.custom_domain === true), false);
});

test('keeps route application separate from version upload and deployment', async () => {
  await assert.rejects(access(new URL('../wrangler.production.jsonc', import.meta.url)));
  const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal('deploy:production' in packageJson.scripts, false);
  assert.match(packageJson.scripts['build:deployment'] ?? '', /buildPublicSupabaseSpa/);
  assert.match(packageJson.scripts['test:deployment'] ?? '', /shared\/web-deployment/);
  assert.match(packageJson.scripts['deploy:isolated'] ?? '', /wrangler\.unbound\.jsonc/);
  assert.match(packageJson.scripts['upload:preview'] ?? '', /versions upload/);
  assert.match(packageJson.scripts['promote:version'] ?? '', /versions deploy/);
  assert.match(packageJson.scripts['apply:production-route'] ?? '', /triggers deploy/);
  assert.doesNotMatch(packageJson.scripts['apply:production-route'] ?? '', /build|versions upload|deploy:isolated/);
});

test('builds and routes the Admin SPA under the explicit /admin base', async () => {
  const vite = await readFile(new URL('../../vite.config.ts', import.meta.url), 'utf8');
  const entry = await readFile(new URL('../../src/main.tsx', import.meta.url), 'utf8');
  assert.match(vite, /base:\s*["']\/admin\/["']/);
  assert.match(entry, /BrowserRouter basename=["']\/admin["']/);
});
