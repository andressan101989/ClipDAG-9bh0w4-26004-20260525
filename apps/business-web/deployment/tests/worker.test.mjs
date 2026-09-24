import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../worker.mjs';

const html = (body, status = 200) => new Response(body, {
  status,
  headers: { 'content-type': 'text/html; charset=utf-8' },
});

function environment() {
  const calls = [];
  const assets = new Map([
    ['/index.html', html('<title>Nelyon Business</title>')],
    ['/assets/app-a1b2c3.js', new Response('business-js', {
      headers: { 'content-type': 'application/javascript' },
    })],
  ]);
  return {
    calls,
    ASSETS: {
      async fetch(request) {
        const url = new URL(request.url);
        calls.push(url.pathname);
        return assets.get(url.pathname) ?? html('not-found', 404);
      },
    },
  };
}

function request(path, { destination, accept, method = 'GET' } = {}) {
  const headers = new Headers();
  if (destination !== undefined) headers.set('sec-fetch-dest', destination);
  if (accept !== undefined) headers.set('accept', accept);
  return new Request(`https://nelyon.app${path}`, { method, headers });
}

test('serves only the exact /business/ mount', async () => {
  for (const path of ['/business', '/businessx', '/', '/advertising']) {
    const response = await worker.fetch(request(path, { destination: 'document' }), environment());
    assert.equal(response.status, 404, path);
  }
});

test('serves the Business shell and mounted deep links', async () => {
  for (const path of ['/business/', '/business/ads', '/business/ads/campaigns', '/business/ads/campaigns/example-id']) {
    const response = await worker.fetch(request(path, { destination: 'document' }), environment());
    assert.equal(response.status, 200, path);
    assert.match(await response.text(), /Nelyon Business/);
  }
});

test('serves exact Business assets after stripping the mount', async () => {
  const env = environment();
  const response = await worker.fetch(request('/business/assets/app-a1b2c3.js'), env);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'business-js');
  assert.deepEqual(env.calls, ['/assets/app-a1b2c3.js']);
});

test('never falls a missing Business asset back to HTML', async () => {
  for (const headers of [
    { destination: 'document', accept: 'text/html' },
    { destination: 'script', accept: 'text/html' },
    { accept: 'text/html' },
  ]) {
    const response = await worker.fetch(request('/business/assets/missing.js', headers), environment());
    assert.equal(response.status, 404);
    assert.equal(await response.text(), 'not-found');
  }
});

test('gives a present non-document destination precedence over Accept', async () => {
  const blocked = await worker.fetch(request('/business/ads', {
    destination: 'script',
    accept: 'text/html',
  }), environment());
  const heuristic = await worker.fetch(request('/business/ads', { accept: 'text/html' }), environment());

  assert.equal(blocked.status, 404);
  assert.equal(heuristic.status, 200);
});

test('rejects mutation methods', async () => {
  const response = await worker.fetch(request('/business/ads', { method: 'POST' }), environment());
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, HEAD');
});
