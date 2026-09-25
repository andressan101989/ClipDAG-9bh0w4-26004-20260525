import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../worker.mjs';

const html = (body, status = 200) => new Response(body, {
  status,
  headers: { 'content-type': 'text/html; charset=utf-8' },
});

function environment() {
  const assets = new Map([
    ['/index.html', html('<title>Nelyon Admin</title>')],
    ['/assets/admin-a1b2c3.js', new Response('admin-js', {
      headers: { 'content-type': 'application/javascript' },
    })],
  ]);
  return {
    ASSETS: {
      async fetch(request) {
        return assets.get(new URL(request.url).pathname) ?? html('not-found', 404);
      },
    },
  };
}

function request(path, { destination, accept, method = 'GET' } = {}) {
  const headers = new Headers();
  if (destination !== undefined) headers.set('sec-fetch-dest', destination);
  if (accept !== undefined) headers.set('accept', accept);
  return new Request(`https://admin-preview.test${path}`, { method, headers });
}

test('canonicalizes the exact Admin root and serves only mounted deep links', async () => {
  const redirect = await worker.fetch(request('/admin'), environment());
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get('location'), 'https://admin-preview.test/admin/');
  for (const path of ['/admin/', '/admin/advertising', '/admin/advertising/review', '/admin/users/example']) {
    const response = await worker.fetch(request(path, { destination: 'document' }), environment());
    assert.equal(response.status, 200, path);
    assert.match(await response.text(), /Nelyon Admin/);
  }
  for (const path of ['/', '/business/', '/administrator', '/adminx']) {
    const response = await worker.fetch(request(path, { destination: 'document' }), environment());
    assert.equal(response.status, 404, path);
  }
});

test('serves exact Admin assets', async () => {
  const response = await worker.fetch(request('/admin/assets/admin-a1b2c3.js'), environment());
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'admin-js');
});

test('never falls missing Admin assets back to HTML', async () => {
  for (const headers of [
    { destination: 'document', accept: 'text/html' },
    { destination: 'script', accept: 'text/html' },
    { accept: 'text/html' },
  ]) {
    const response = await worker.fetch(request('/admin/assets/missing.js', headers), environment());
    assert.equal(response.status, 404);
    assert.equal(await response.text(), 'not-found');
  }
});

test('gives present non-document destination precedence over Accept', async () => {
  const blocked = await worker.fetch(request('/admin/advertising', {
    destination: 'script',
    accept: 'text/html',
  }), environment());
  const heuristic = await worker.fetch(request('/admin/advertising', { accept: 'text/html' }), environment());
  assert.equal(blocked.status, 404);
  assert.equal(heuristic.status, 200);
});

test('rejects mutation methods and applies shared headers', async () => {
  const rejected = await worker.fetch(request('/admin/advertising', { method: 'POST' }), environment());
  const shell = await worker.fetch(request('/admin/advertising', { destination: 'document' }), environment());
  assert.equal(rejected.status, 405);
  assert.equal(shell.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(shell.headers.get('cache-control'), 'no-store');
  assert.equal(shell.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
});
