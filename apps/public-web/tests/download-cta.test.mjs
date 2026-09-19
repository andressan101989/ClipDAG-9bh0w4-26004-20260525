import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../src/', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');

test('download has a dedicated public page and an honest unavailable-store state', () => {
  assert.ok(existsSync(new URL('pages/download.astro', root)));
  const page = source('pages/download.astro');
  assert.equal((page.match(/<h1\b/g) ?? []).length, 1);
  assert.match(page, /PublicLayout/);
  assert.match(page, /storeLinks\.ios/);
  assert.match(page, /storeLinks\.android/);
  assert.match(page, /Store links will be available here/);
  assert.doesNotMatch(page, /apps\.apple\.com|play\.google\.com/);
  assert.match(source('pages/[...path].astro'), /path !== '\/download'/);
});

test('public destinations have one CTA authority and no session logic', () => {
  const ctas = source('lib/publicCtas.ts');
  assert.match(ctas, /shared\/web-routing\/paths\.json/);
  for (const key of ['home', 'features', 'business', 'ads', 'marketplace', 'creators', 'live', 'whatsNew', 'download', 'support', 'contact', 'privacy', 'terms', 'businessHome', 'businessLogin', 'businessAds']) {
    assert.match(ctas, new RegExp(`\\b${key}:`));
  }
  assert.match(ctas, /ios: null/);
  assert.match(ctas, /android: null/);
  for (const file of ['layouts/PublicLayout.astro', 'pages/index.astro', 'data/productPages.ts', 'components/ProductPage.astro', 'pages/whats-new/[slug].astro']) {
    assert.match(source(file), /publicCtas/);
  }
  assert.doesNotMatch(ctas + source('pages/download.astro'), /@supabase|BusinessAuthProvider|localStorage|businessApi|sellerCenterApi|adsManagerApi|businessPayoutsApi|hls\.js/);
});
