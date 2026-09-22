import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/worker.mjs';

const html = (body, status = 200) => new Response(body, {
  status,
  headers: { 'content-type': 'text/html; charset=utf-8' },
});

function environment() {
  const calls = [];
  const assets = new Map([
    ['/', html('public-home')],
    ['/business', html('public-business')],
    ['/business/index.html', html('business-spa')],
    ['/business/assets/app-123.js', new Response('business-js', {
      headers: { 'content-type': 'application/javascript' },
    })],
  ]);

  return {
    calls,
    ASSETS: {
      async fetch(request) {
        const url = new URL(request.url);
        calls.push({ method: request.method, pathname: url.pathname });
        return assets.get(url.pathname) ?? html('public-404', 404);
      },
    },
  };
}

test('serves the public root and the exact public /business page', async () => {
  const env = environment();
  const root = await worker.fetch(new Request('https://nelyon.app/'), env);
  const business = await worker.fetch(new Request('https://nelyon.app/business'), env);

  assert.equal(root.status, 200);
  assert.equal(await root.text(), 'public-home');
  assert.equal(business.status, 200);
  assert.equal(await business.text(), 'public-business');
});

test('falls back Business document navigations to the SPA shell', async () => {
  const env = environment();
  const response = await worker.fetch(new Request('https://nelyon.app/business/orders?state=open', {
    headers: { accept: 'text/html,application/xhtml+xml' },
  }), env);

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'business-spa');
  assert.deepEqual(env.calls.map(({ pathname }) => pathname), [
    '/business/orders',
    '/business/index.html',
  ]);
  assert.equal(response.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
});

test('serves Business assets exactly and never falls missing assets back to HTML', async () => {
  const env = environment();
  const asset = await worker.fetch(new Request('https://nelyon.app/business/assets/app-123.js'), env);
  const missing = await worker.fetch(new Request('https://nelyon.app/business/assets/missing.js', {
    headers: { accept: '*/*' },
  }), env);

  assert.equal(asset.status, 200);
  assert.equal(await asset.text(), 'business-js');
  assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), 'public-404');
});

test('returns the branded 404 for unknown public routes', async () => {
  const env = environment();
  const response = await worker.fetch(new Request('https://nelyon.app/not-a-real-page', {
    headers: { accept: 'text/html' },
  }), env);

  assert.equal(response.status, 404);
  assert.equal(await response.text(), 'public-404');
});

test('redirects legacy routes permanently while preserving the query string', async () => {
  const env = environment();
  const response = await worker.fetch(new Request('https://nelyon.app/invitations?invitation=abc'), env);

  assert.equal(response.status, 308);
  assert.equal(response.headers.get('location'), 'https://nelyon.app/business/invitations?invitation=abc');
  assert.equal(env.calls.length, 0);
});

test('redirects www permanently to the apex while preserving path and query', async () => {
  const env = environment();
  const response = await worker.fetch(new Request('https://www.nelyon.app/features?source=www'), env);

  assert.equal(response.status, 308);
  assert.equal(response.headers.get('location'), 'https://nelyon.app/features?source=www');
  assert.equal(env.calls.length, 0);
});

test('adds the shared safe response headers', async () => {
  const env = environment();
  const response = await worker.fetch(new Request('https://nelyon.app/'), env);

  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(response.headers.get('permissions-policy'), 'browsing-topics=()');
  assert.equal(response.headers.get('strict-transport-security'), null);
});
