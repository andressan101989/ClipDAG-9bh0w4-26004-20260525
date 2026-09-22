import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { assemble } from '../scripts/assemble.mjs';

test('assembles Public at root and Business under /business without overwriting the public page', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nelyon-frontdoor-'));
  const publicDist = join(root, 'public');
  const businessDist = join(root, 'business');
  const output = join(root, 'output');
  await mkdir(join(publicDist, '_astro'), { recursive: true });
  await mkdir(join(businessDist, 'assets'), { recursive: true });
  await writeFile(join(publicDist, 'index.html'), 'public-home');
  await writeFile(join(publicDist, 'business.html'), 'public-business');
  await writeFile(join(publicDist, '404.html'), 'public-404');
  await writeFile(join(publicDist, 'robots.txt'), 'robots');
  await writeFile(join(publicDist, 'sitemap.xml'), 'sitemap');
  await writeFile(join(publicDist, 'site.webmanifest'), 'manifest');
  await writeFile(join(businessDist, 'index.html'), 'business-spa');
  await writeFile(join(businessDist, 'assets', 'app.js'), 'business-js');

  const result = await assemble({ publicDist, businessDist, output, allowedRoot: root });

  assert.equal(await readFile(join(output, 'business.html'), 'utf8'), 'public-business');
  assert.equal(await readFile(join(output, 'business', 'index.html'), 'utf8'), 'business-spa');
  assert.equal(await readFile(join(output, 'business', 'assets', 'app.js'), 'utf8'), 'business-js');
  assert.deepEqual(result.requiredFiles, [
    'index.html',
    'business.html',
    'business/index.html',
    '404.html',
    'robots.txt',
    'sitemap.xml',
    'site.webmanifest',
  ]);
});
