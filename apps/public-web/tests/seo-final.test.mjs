import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../src/', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const seo = await import('../src/lib/seo.ts').catch(() => null);

test('one SEO registry covers every public route with unique production metadata', () => {
  assert.ok(seo, 'canonical SEO registry must exist');
  assert.equal(seo.PUBLIC_ORIGIN, 'https://nelyon.app');
  const routes = ['/', '/features', '/business', '/ads', '/marketplace', '/creators', '/live', '/whats-new', '/download', '/support', '/contact', '/privacy', '/terms'];
  assert.deepEqual(Object.keys(seo.publicSeo).sort(), routes.sort());
  const entries = Object.values(seo.publicSeo);
  assert.equal(new Set(entries.map((item) => item.title)).size, entries.length);
  assert.equal(new Set(entries.map((item) => item.description)).size, entries.length);
  assert.ok(entries.every((item) => item.title.trim() && item.description.trim()));
  assert.equal(seo.publicSeo['/privacy'].indexable, false);
  assert.equal(seo.publicSeo['/terms'].indexable, false);
  assert.ok(routes.filter((route) => !['/privacy', '/terms'].includes(route)).every((route) => seo.publicSeo[route].indexable));
});

test('shared layout owns canonical, robots, social, icon and factual structured metadata', () => {
  const layout = read('layouts/PublicLayout.astro');
  assert.match(layout, /resolveSeo/);
  assert.match(layout, /name="robots"/);
  assert.match(layout, /twitter:card/);
  assert.match(layout, /twitter:title/);
  assert.match(layout, /rel="canonical"/);
  assert.match(layout, /rel="icon"/);
  assert.match(layout, /application\/ld\+json/);
  assert.doesNotMatch(layout, /content="noindex,nofollow"/);
});

test('robots, sitemap and web manifest are generated from public authorities', () => {
  for (const path of ['pages/robots.txt.ts', 'pages/sitemap.xml.ts', 'pages/site.webmanifest.ts']) {
    assert.ok(existsSync(new URL(path, root)), path);
  }
  const robots = read('pages/robots.txt.ts');
  const sitemap = read('pages/sitemap.xml.ts');
  assert.match(robots, /Disallow: \/business\//);
  assert.match(robots, /Disallow: \/store\$/);
  assert.match(robots, /Sitemap: \$\{PUBLIC_ORIGIN\}\/sitemap\.xml/);
  assert.match(sitemap, /getPublishedUpdates/);
  assert.match(sitemap, /indexableStaticRoutes/);
  assert.doesNotMatch(sitemap, /businessHome|businessLogin/);
});

test('private Business keeps its own noindex boundary', () => {
  const businessHtml = readFileSync(new URL('../../business-web/index.html', import.meta.url), 'utf8');
  assert.match(businessHtml, /name="robots" content="noindex,nofollow"/);
});

test('404 and pending legal pages remain deliberately non-indexable', () => {
  assert.match(read('pages/404.astro'), /indexable=\{false\}/);
  assert.match(read('pages/404.astro'), /canonical=\{false\}/);
  assert.match(read('components/LegalPage.astro'), /indexable=\{state\.state === 'approved'\}/);
});

test('mobile navigation manages focus and reduced motion applies globally', () => {
  const layout = read('layouts/PublicLayout.astro');
  const css = read('styles/public.css');
  assert.match(layout, /menu\.querySelector<HTMLElement>/);
  assert.match(layout, /event\.key === 'Tab'/);
  assert.match(layout, /aria-current/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /animation-duration:\s*0\.01ms/);
});
