import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const businessShell = await readFile(new URL('../../business-web/index.html', import.meta.url), 'utf8');

test('deploys one Worker with Static Assets and no workers.dev origin', () => {
  assert.equal(config.name, 'nelyon-web');
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.assets, {
    directory: './dist',
    binding: 'ASSETS',
    html_handling: 'drop-trailing-slash',
    not_found_handling: '404-page',
    run_worker_first: true,
  });
});

test('Business shell uses the stable assembled Nelyon favicon', () => {
  assert.match(businessShell, /<link rel="icon" href="\/favicon\.png" type="image\/png"\s*\/>/);
});

test('binds only the apex and www custom domains', () => {
  assert.deepEqual(config.routes, [
    { pattern: 'nelyon.app', custom_domain: true },
    { pattern: 'www.nelyon.app', custom_domain: true },
  ]);
});
