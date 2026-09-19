import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyRoute, legacyRedirectLocation } from '../src/lib/routeContract.mjs';

test('public roots remain public and unknown routes are not sent to Business', () => {
  for (const path of ['/', '/business', '/ads', '/features', '/marketplace', '/creators', '/live', '/whats-new', '/download', '/support', '/contact', '/privacy', '/terms']) {
    assert.equal(classifyRoute(path).surface, 'public', path);
  }
  assert.deepEqual(classifyRoute('/business/'), { surface: 'redirect', destination: '/business' });
  assert.equal(classifyRoute('/totally-unknown').surface, 'not-found');
  assert.equal(classifyRoute('/store/test-slug').surface, 'reserved-public');
  assert.equal(classifyRoute('/whats-new/product-update').surface, 'reserved-public');
});

test('every private route is routed to the Business SPA', () => {
  for (const path of ['/business/home', '/business/login', '/business/invitations', '/business/store', '/business/media', '/business/products', '/business/products/shipping', '/business/products/product-1', '/business/orders', '/business/orders/order-1', '/business/ads', '/business/ads/new', '/business/ads/campaign-1', '/business/finance', '/business/finance/payouts', '/business/analytics', '/business/team', '/business/settings']) {
    assert.equal(classifyRoute(path).surface, 'business', path);
  }
});

test('legacy redirects preserve query and do not swallow public conflicts', () => {
  const examples = new Map([
    ['/login', '/business/login'], ['/invitations', '/business/invitations'],
    ['/store', '/business/store'], ['/media', '/business/media'],
    ['/products', '/business/products'], ['/products/shipping', '/business/products/shipping'],
    ['/products/product-1', '/business/products/product-1'], ['/orders', '/business/orders'],
    ['/orders/order-1', '/business/orders/order-1'], ['/finance', '/business/finance'],
    ['/finance/payouts', '/business/finance/payouts'], ['/analytics', '/business/analytics'],
    ['/team', '/business/team'], ['/settings', '/business/settings'],
    ['/ads/new', '/business/ads/new'],
  ]);
  for (const [source, destination] of examples) {
    assert.deepEqual(classifyRoute(source), { surface: 'redirect', destination });
    assert.equal(legacyRedirectLocation(`${source}?source=old`), `${destination}?source=old`);
  }
  assert.equal(legacyRedirectLocation('/invitations?invitation=abc'), '/business/invitations?invitation=abc');
  assert.equal(classifyRoute('/ads').surface, 'public');
  assert.equal(classifyRoute('/ads/features').surface, 'not-found');
  assert.deepEqual(classifyRoute('/ads/11111111-1111-4111-8111-111111111111'), {
    surface: 'redirect', destination: '/business/ads/11111111-1111-4111-8111-111111111111',
  });
});
