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

test('serves the Admin root and deep links', async () => {
  for (const path of ['/', '/advertising', '/advertising/health', '/users/example']) {
    const response = await worker.fetch(request(path, { destination: 'document' }), environment());
    assert.equal(response.status, 200, path);
    assert.match(await response.text(), /Nelyon Admin/);
  }
});

test('serves exact Admin assets', async () => {
  const response = await worker.fetch(request('/assets/admin-a1b2c3.js'), environment());
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'admin-js');
});

test('never falls missing Admin assets back to HTML', async () => {
  for (const headers of [
    { destination: 'document', accept: 'text/html' },
    { destination: 'script', accept: 'text/html' },
    { accept: 'text/html' },
  ]) {
    const response = await worker.fetch(request('/assets/missing.js', headers), environment());
    assert.equal(response.status, 404);
    assert.equal(await response.text(), 'not-found');
  }
});

test('gives present non-document destination precedence over Accept', async () => {
  const blocked = await worker.fetch(request('/advertising', {
    destination: 'script',
    accept: 'text/html',
  }), environment());
  const heuristic = await worker.fetch(request('/advertising', { accept: 'text/html' }), environment());
  assert.equal(blocked.status, 404);
  assert.equal(heuristic.status, 200);
});

test('rejects mutation methods and applies shared headers', async () => {
  const rejected = await worker.fetch(request('/advertising', { method: 'POST' }), environment());
  const shell = await worker.fetch(request('/advertising', { destination: 'document' }), environment());
  assert.equal(rejected.status, 405);
  assert.equal(shell.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(shell.headers.get('cache-control'), 'public, max-age=0, must-revalidate, no-transform');
});
