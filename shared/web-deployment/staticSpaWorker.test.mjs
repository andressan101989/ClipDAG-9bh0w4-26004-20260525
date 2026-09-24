import assert from 'node:assert/strict';
import test from 'node:test';

import { createStaticSpaWorker } from './staticSpaWorker.mjs';

const html = (body, status = 200) => new Response(body, {
  status,
  headers: { 'content-type': 'text/html; charset=utf-8' },
});

function environment() {
  const calls = [];
  const assets = new Map([
    ['/index.html', html('spa-shell')],
    ['/assets/app-a1b2c3.js', new Response('asset-body', {
      headers: { 'content-type': 'application/javascript' },
    })],
    ['/data.json', new Response('{"ok":true}', {
      headers: { 'content-type': 'application/json' },
    })],
  ]);

  return {
    calls,
    ASSETS: {
      async fetch(request) {
        const url = new URL(request.url);
        calls.push({ method: request.method, pathname: url.pathname, search: url.search });
        return assets.get(url.pathname) ?? html('asset-404', 404);
      },
    },
  };
}

function request(path, { method = 'GET', destination, accept } = {}) {
  const headers = new Headers();
  if (destination !== undefined) headers.set('sec-fetch-dest', destination);
  if (accept !== undefined) headers.set('accept', accept);
  return new Request(`https://example.test${path}`, { method, headers });
}

test('accepts only GET and HEAD', async () => {
  const worker = createStaticSpaWorker({ mountPath: '/business' });
  const response = await worker.fetch(request('/business/ads', { method: 'POST' }), environment());

  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, HEAD');
});

test('enforces an exact non-root mount boundary', async () => {
  const worker = createStaticSpaWorker({ mountPath: '/business' });
  for (const path of ['/business', '/businessx', '/', '/advertising']) {
    const response = await worker.fetch(request(path, { destination: 'document' }), environment());
    assert.equal(response.status, 404, path);
  }
});

test('maps the mount root and exact mounted assets into the asset binding', async () => {
  const worker = createStaticSpaWorker({ mountPath: '/business' });
  const env = environment();

  const shell = await worker.fetch(request('/business/', { destination: 'document' }), env);
  const asset = await worker.fetch(request('/business/assets/app-a1b2c3.js?cache=1'), env);

  assert.equal(await shell.text(), 'spa-shell');
  assert.equal(await asset.text(), 'asset-body');
  assert.deepEqual(env.calls, [
    { method: 'GET', pathname: '/index.html', search: '' },
    { method: 'GET', pathname: '/assets/app-a1b2c3.js', search: '?cache=1' },
  ]);
});

test('uses a present Sec-Fetch-Dest as the authoritative fallback signal', async () => {
  const worker = createStaticSpaWorker({ mountPath: '/business' });

  const documentResponse = await worker.fetch(request('/business/ads', {
    destination: 'document',
    accept: 'text/html',
  }), environment());
  assert.equal(documentResponse.status, 200);
  assert.equal(await documentResponse.text(), 'spa-shell');

  for (const destination of ['script', 'style', 'image', 'font', 'empty']) {
    const response = await worker.fetch(request('/business/ads', {
      destination,
      accept: 'text/html',
    }), environment());
    assert.equal(response.status, 404, destination);
    assert.equal(await response.text(), 'asset-404');
  }
});

test('uses Accept text/html only when Sec-Fetch-Dest is absent', async () => {
  const worker = createStaticSpaWorker({ mountPath: '/business' });
  const accepted = await worker.fetch(request('/business/ads', { accept: 'text/html' }), environment());
  const rejected = await worker.fetch(request('/business/ads', { accept: '*/*' }), environment());

  assert.equal(accepted.status, 200);
  assert.equal(await accepted.text(), 'spa-shell');
  assert.equal(rejected.status, 404);
});

test('never falls asset-like paths back to the SPA shell', async () => {
  const worker = createStaticSpaWorker({ mountPath: '/business' });
  const paths = [
    '/business/assets/missing',
    '/business/missing.js',
    '/business/missing.MJS',
    '/business/missing.cjs',
    '/business/missing.css',
    '/business/missing.map',
    '/business/missing.json',
    '/business/missing.png',
    '/business/missing.jpg',
    '/business/missing.jpeg',
    '/business/missing.gif',
    '/business/missing.webp',
    '/business/missing.avif',
    '/business/missing.svg',
    '/business/missing.ico',
    '/business/missing.woff',
    '/business/missing.woff2',
    '/business/missing.ttf',
    '/business/missing.otf',
    '/business/missing.eot',
    '/business/missing.wasm',
    '/business/missing.xml',
    '/business/missing.txt',
    '/business/missing.webmanifest',
    '/business/missing.pdf',
    '/business/missing.mp4',
    '/business/missing.webm',
    '/business/missing.mp3',
    '/business/missing.m4a',
    '/business/missing.ogg',
  ];

  for (const path of paths) {
    for (const headers of [
      { destination: 'document', accept: 'text/html' },
      { accept: 'text/html' },
    ]) {
      const response = await worker.fetch(request(path, headers), environment());
      assert.equal(response.status, 404, `${path} ${JSON.stringify(headers)}`);
      assert.equal(await response.text(), 'asset-404');
    }
  }
});

test('supports the root mount', async () => {
  const worker = createStaticSpaWorker({ mountPath: '' });
  for (const path of ['/', '/advertising']) {
    const response = await worker.fetch(request(path, { destination: 'document' }), environment());
    assert.equal(response.status, 200, path);
    assert.equal(await response.text(), 'spa-shell');
  }
});

test('adds security and cache headers', async () => {
  const worker = createStaticSpaWorker({ mountPath: '/business' });
  const shell = await worker.fetch(request('/business/ads', { destination: 'document' }), environment());
  const asset = await worker.fetch(request('/business/assets/app-a1b2c3.js'), environment());

  assert.equal(shell.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(shell.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(shell.headers.get('permissions-policy'), 'browsing-topics=()');
  assert.equal(shell.headers.get('strict-transport-security'), 'max-age=31536000');
  assert.equal(shell.headers.get('cache-control'), 'public, max-age=0, must-revalidate, no-transform');
  assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');
});

test('returns no body for HEAD while preserving asset headers and status', async () => {
  const worker = createStaticSpaWorker({ mountPath: '/business' });
  const response = await worker.fetch(request('/business/assets/app-a1b2c3.js', { method: 'HEAD' }), environment());

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/javascript');
  assert.equal(await response.text(), '');
});

test('rejects invalid mount paths', () => {
  assert.throws(() => createStaticSpaWorker({ mountPath: 'business' }), /mountPath/);
  assert.throws(() => createStaticSpaWorker({ mountPath: '/business/' }), /mountPath/);
});
