import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const distUrl = new URL('../dist/', import.meta.url);
const distPath = fileURLToPath(distUrl);
const origin = 'https://nelyon.app';
const staticRoutes = ['/', '/features', '/business', '/ads', '/marketplace', '/creators', '/live', '/whats-new', '/download', '/support', '/contact', '/privacy', '/terms'];
const noindexRoutes = new Set(['/privacy', '/terms']);
const fileFor = (route) => route === '/' ? 'index.html' : `${route.slice(1)}.html`;
const readRoute = (route) => readFileSync(join(distPath, fileFor(route)), 'utf8');
const attr = (html, selector) => html.match(selector)?.[1] ?? null;

const titles = [];
const descriptions = [];
for (const route of staticRoutes) {
  const html = readRoute(route);
  const title = attr(html, /<title>([^<]+)<\/title>/);
  const description = attr(html, /<meta name="description" content="([^"]+)"/);
  const canonical = attr(html, /<link rel="canonical" href="([^"]+)"/);
  const expectedCanonical = `${origin}${route === '/' ? '/' : route}`;
  assert.ok(title, `${route}: title`);
  assert.ok(description, `${route}: description`);
  assert.equal(canonical, expectedCanonical, `${route}: canonical`);
  assert.match(html, new RegExp(`name="robots" content="${noindexRoutes.has(route) ? 'noindex,nofollow' : 'index,follow'}"`), `${route}: robots`);
  assert.ok(html.includes(`property="og:title" content="${title}"`), `${route}: OG title`);
  assert.ok(html.includes(`property="og:description" content="${description}"`), `${route}: OG description`);
  assert.ok(html.includes(`property="og:url" content="${expectedCanonical}"`), `${route}: OG URL`);
  assert.ok(html.includes(`name="twitter:title" content="${title}"`), `${route}: Twitter title`);
  assert.ok(html.includes(`name="twitter:description" content="${description}"`), `${route}: Twitter description`);
  assert.match(html, /<link rel="icon" href="\/_astro\/[^" ]+\.png" type="image\/png">/, `${route}: icon`);
  assert.match(html, /<link rel="manifest" href="\/site\.webmanifest">/, `${route}: manifest`);
  titles.push(title);
  descriptions.push(description);
}
assert.equal(new Set(titles).size, titles.length, 'static titles are unique');
assert.equal(new Set(descriptions).size, descriptions.length, 'static descriptions are unique');

const notFound = readFileSync(join(distPath, '404.html'), 'utf8');
assert.match(notFound, /name="robots" content="noindex,nofollow"/);
assert.doesNotMatch(notFound, /rel="canonical"/);

const home = readRoute('/');
const homeJson = JSON.parse(home.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)?.[1] ?? 'null');
assert.deepEqual(homeJson?.['@graph']?.map((entry) => entry['@type']), ['Organization', 'WebSite']);
assert.equal(homeJson['@graph'][0].name, 'Nelyon');
assert.equal(homeJson['@graph'][0].url, `${origin}/`);
assert.equal('legalName' in homeJson['@graph'][0], false);

const sitemap = readFileSync(join(distPath, 'sitemap.xml'), 'utf8');
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
for (const route of staticRoutes.filter((route) => !noindexRoutes.has(route))) {
  assert.ok(sitemapUrls.includes(`${origin}${route === '/' ? '/' : route}`), `${route}: sitemap`);
}
for (const forbidden of ['/privacy', '/terms', '/404', '/business/home', '/business/login', '/business/invitations']) {
  assert.ok(!sitemapUrls.includes(`${origin}${forbidden}`), `${forbidden}: excluded from sitemap`);
}
assert.ok(sitemapUrls.every((url) => url.startsWith(`${origin}/`)), 'sitemap uses the canonical origin');

const robots = readFileSync(join(distPath, 'robots.txt'), 'utf8');
assert.match(robots, /^User-agent: \*$/m);
assert.match(robots, /^Allow: \/$/m);
assert.match(robots, /^Disallow: \/business\/$/m);
assert.match(robots, /^Sitemap: https:\/\/nelyon\.app\/sitemap\.xml$/m);

const manifest = JSON.parse(readFileSync(join(distPath, 'site.webmanifest'), 'utf8'));
assert.equal(manifest.name, 'Nelyon');
assert.equal(manifest.icons[0].sizes, '1024x1024');
assert.ok(manifest.icons[0].src.startsWith(`${origin}/_astro/`));

const htmlFiles = [];
const walk = (directory) => {
  for (const name of readdirSync(directory)) {
    const full = join(directory, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (name.endsWith('.html')) htmlFiles.push(full);
  }
};
walk(distPath);
const allHtml = htmlFiles.map((path) => readFileSync(path, 'utf8')).join('\n');
assert.doesNotMatch(allHtml, /href="(?:#|javascript:void\(0\))"/i, 'no placeholder links');
assert.doesNotMatch(allHtml, /(?:example\.com|clipdag\.io|onspace\.ai|nelyon\.com)/i, 'no placeholder or legacy domains');
assert.doesNotMatch(allHtml, /href="https:\/\/(?:apps\.apple\.com|play\.google\.com)/i, 'no unverified store links');

for (const route of staticRoutes) {
  const html = readRoute(route);
  for (const match of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) {
    const href = match[1];
    if (href.startsWith('mailto:')) continue;
    if (href.startsWith('#')) {
      assert.ok(html.includes(`id="${href.slice(1)}"`), `${route}: fragment ${href}`);
      continue;
    }
    const url = new URL(href, origin);
    assert.equal(url.origin, origin, `${route}: unapproved external link ${href}`);
    const target = url.pathname.replace(/\/$/, '') || '/';
    assert.ok(
      staticRoutes.includes(target) || target.startsWith('/business/') || sitemapUrls.includes(`${origin}${target}`),
      `${route}: unresolved internal link ${href}`,
    );
  }
}

assert.equal(existsSync(join(distPath, 'business', 'home.html')), false, 'Astro does not build private Business pages');
console.log(`SEO, sitemap, robots, structured data and link integrity: PASS (${staticRoutes.length} routes, ${sitemapUrls.length} sitemap URLs)`);
