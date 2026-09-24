import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { prepareBusinessDeployment } from '../prepare.mjs';

async function fixture(indexHtml = '<link rel="icon" href="/favicon.png"><script src="/business/assets/app-a1b2c3.js"></script><link rel="stylesheet" href="/business/assets/app-a1b2c3.css">') {
  const root = await mkdtemp(join(tmpdir(), 'nelyon-business-deployment-'));
  const distDir = join(root, 'dist');
  const iconSource = join(root, 'icon.png');
  await mkdir(distDir, { recursive: true });
  await writeFile(join(distDir, 'index.html'), indexHtml);
  await writeFile(iconSource, 'canonical-icon');
  return { root, distDir, iconSource };
}

test('requires a generated index.html', async () => {
  const { root, iconSource } = await fixture();
  await assert.rejects(
    prepareBusinessDeployment({ distDir: join(root, 'missing'), iconSource }),
    /index\.html/,
  );
});

test('rejects unmounted script and stylesheet URLs', async () => {
  for (const badReference of ['/assets/app.js', '/app.css']) {
    const { distDir, iconSource } = await fixture(`<script src="${badReference}"></script>`);
    await assert.rejects(prepareBusinessDeployment({ distDir, iconSource }), /\/business\//);
  }
});

test('copies the canonical icon and rewrites only generated output', async () => {
  const { root, distDir, iconSource } = await fixture();
  const outside = join(root, 'outside.txt');
  await writeFile(outside, 'unchanged');

  await prepareBusinessDeployment({ distDir, iconSource });

  assert.equal(await readFile(join(distDir, 'favicon.png'), 'utf8'), 'canonical-icon');
  assert.match(await readFile(join(distDir, 'index.html'), 'utf8'), /href="\/business\/favicon\.png"/);
  assert.equal(await readFile(outside, 'utf8'), 'unchanged');
});

test('is idempotent', async () => {
  const { distDir, iconSource } = await fixture();
  await prepareBusinessDeployment({ distDir, iconSource });
  const once = await readFile(join(distDir, 'index.html'), 'utf8');
  await prepareBusinessDeployment({ distDir, iconSource });
  assert.equal(await readFile(join(distDir, 'index.html'), 'utf8'), once);
});
