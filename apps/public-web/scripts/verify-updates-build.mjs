import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
const read = (path) => readFileSync(new URL(path, dist), 'utf8');
const content = new URL('../src/content/whats-new/', import.meta.url);
const frontmatterValue = (body, key) => body.match(new RegExp(`^${key}:\\s*"?([^"\\r\\n]+)"?$`, 'm'))?.[1];
const all = readdirSync(content).filter((filename) => filename.endsWith('.md')).map((filename) => {
  const body = readFileSync(new URL(filename, content), 'utf8');
  return { slug: filename.slice(0, -3), publishedAt: new Date(frontmatterValue(body, 'publishedAt')), draft: frontmatterValue(body, 'draft') === 'true' };
});
const now = new Date();
const eligible = all.filter((item) => !item.draft && item.publishedAt <= now).sort((a, b) => b.publishedAt - a.publishedAt || b.slug.localeCompare(a.slug));
const slugs = eligible.map((item) => item.slug);
const index = read('whats-new.html');
const home = read('index.html');
assert.match(index, /<h1[^>]*>What’s New<\/h1>/);
assert.match(index, /name="robots" content="index,follow"/);
assert.match(index, /https:\/\/nelyon\.app\/whats-new/);
assert.match(index, /og:description/);
const chronology = index.slice(index.indexOf('Latest updates'));
for (let i = 1; i < slugs.length; i++) assert.ok(chronology.indexOf(slugs[i - 1]) < chronology.indexOf(slugs[i]), 'newest-first index');
const generated = readdirSync(new URL('whats-new/', dist)).filter((filename) => filename.endsWith('.html')).map((filename) => filename.slice(0, -5));
assert.deepEqual(generated.sort(), [...slugs].sort(), 'only eligible details are generated');
for (const slug of slugs) {
  const path = `whats-new/${slug}.html`;
  assert.equal(existsSync(new URL(path, dist)), true, `${slug} is generated`);
  const html = read(path);
  assert.match(html, /<article\b/);
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
  assert.match(html, /name="robots" content="index,follow"/);
  assert.match(html, new RegExp(`https://nelyon\\.app/whats-new/${slug}`));
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /datePublished/);
  assert.match(html, /article:published_time/);
  const jsonLd = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)?.[1];
  assert.ok(jsonLd, 'Article JSON-LD present');
  const article = JSON.parse(jsonLd);
  assert.equal(article['@type'], 'Article');
  assert.equal(article.mainEntityOfPage, `https://nelyon.app/whats-new/${slug}`);
  assert.match(html, /Preview/);
  if (slugs.indexOf(slug) < 3) assert.match(home, new RegExp(`/whats-new/${slug}`), `${slug} appears in homepage teaser`);
}
for (const item of all.filter((entry) => entry.draft || entry.publishedAt > now)) {
  assert.doesNotMatch(index + home, new RegExp(`/whats-new/${item.slug}`));
  assert.equal(existsSync(new URL(`whats-new/${item.slug}.html`, dist)), false);
}
assert.equal(existsSync(new URL('whats-new/not-a-story.html', dist)), false);
const output = [index, home, ...slugs.map((slug) => read(`whats-new/${slug}.html`))].join('\n');
assert.doesNotMatch(output, /ClipDAG|OnSpace|SUPABASE_SERVICE_ROLE|202609\d{8}_business_|aewwdlvbwpczqyvkwvvj/i);
console.log('Built What’s New index, details, metadata, homepage links and leak audit: PASS');
