import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../src/', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');
const slugs = ['features', 'business', 'ads', 'marketplace', 'creators', 'live'];

test('the six product routes have dedicated pages and one shared public composition', () => {
  for (const slug of slugs) {
    assert.ok(existsSync(new URL(`pages/${slug}.astro`, root)), slug);
    const page = source(`pages/${slug}.astro`);
    assert.match(page, /ProductPage/);
    assert.match(page, new RegExp(`productPages\.${slug}`));
  }
  const product = source('components/ProductPage.astro');
  assert.match(product, /<PublicLayout>/);
});

test('product metadata is centralized and product copy remains cautious', () => {
  const config = source('data/productPages.ts');
  const layout = source('layouts/PublicLayout.astro');
  const seo = source('lib/seo.ts');
  const titles = slugs.map((slug) => seo.match(new RegExp(`'/${slug}': \\{ title: '([^']+)'`))?.[1]);
  assert.equal(titles.length, slugs.length);
  assert.equal(new Set(titles).size, slugs.length);
  assert.ok(titles.every(Boolean));
  assert.doesNotMatch(config, /pageTitle:|description:/);
  assert.match(layout, /seo\.indexable/);
  assert.match(layout, /rel="canonical"/);
  assert.match(layout, /og:title/);
  assert.doesNotMatch(config, /PROMOTIONAL CONCEPT|PRODUCT-FAITHFUL MOCKUP|testimonio real|usuarios reales/i);
});

test('public product surfaces contain no private imports or new data authority', () => {
  const files = [source('components/ProductPage.astro'), source('data/productPages.ts'), ...slugs.map((slug) => source(`pages/${slug}.astro`))].join('\n');
  assert.doesNotMatch(files, /BusinessAuthProvider|@supabase|businessApi|sellerCenterApi|adsManagerApi|businessBillingApi|businessPayoutsApi|businessAnalyticsApi|businessTeamApi|hls\.js/);
  assert.match(files, /publicCtas\.businessHome/);
  assert.match(files, /publicCtas\.businessAds/);
});

test('shared composition has semantic sections, a single H1, accessible media and reduced motion', () => {
  const page = source('components/ProductPage.astro');
  const css = source('styles/product-pages.css');
  assert.match(page, /analyticsLabel="Nelyon Ads"/);
  assert.equal((page.match(/<h1\b/g) ?? []).length, 1);
  assert.match(page, /<section\b/);
  assert.match(page, /loading="lazy"/);
  assert.match(page, /alt=/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});
