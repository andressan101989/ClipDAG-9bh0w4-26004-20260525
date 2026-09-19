import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

const core = await import('../src/lib/updates-core.ts').catch(() => null);
const schemaModule = await import('../src/lib/updateSchema.ts').catch(() => null);
const presentation = await import('../src/lib/updatePresentation.ts').catch(() => null);

const entry = (id, publishedAt, extra = {}) => ({
  id,
  data: { publishedAt: new Date(publishedAt), draft: false, featured: false, availability: 'preview', ...extra },
});

test('published updates are newest first, exclude drafts and future dates, and select a featured update', () => {
  assert.ok(core, 'canonical update selector must exist');
  const result = core.selectPublishedUpdates([
    entry('older', '2026-09-10T00:00:00Z'),
    entry('future', '2026-09-20T00:00:00Z'),
    entry('featured', '2026-09-18T00:00:00Z', { featured: true }),
    entry('draft', '2026-09-19T00:00:00Z', { draft: true }),
    entry('newest', '2026-09-19T00:00:00Z'),
  ], new Date('2026-09-19T12:00:00Z'));
  assert.deepEqual(result.items.map((item) => item.id), ['newest', 'featured', 'older']);
  assert.equal(result.featured?.id, 'featured');
  assert.deepEqual(result.neighbors.featured, { newer: 'newest', older: 'older' });
});

test('an update at the exact UTC build instant is eligible and equal timestamps have deterministic ordering', () => {
  assert.ok(core);
  const result = core.selectPublishedUpdates([
    entry('a', '2026-09-19T12:00:00Z'),
    entry('b', '2026-09-19T12:00:00Z'),
  ], new Date('2026-09-19T12:00:00Z'));
  assert.deepEqual(result.items.map((item) => item.id), ['b', 'a']);
});

test('duplicate or unsafe filename-derived slugs fail closed', () => {
  assert.ok(core);
  assert.throws(() => core.selectPublishedUpdates([
    entry('release', '2026-09-19T00:00:00Z'),
    entry('release', '2026-09-18T00:00:00Z'),
  ], new Date('2026-09-19T12:00:00Z')), /duplicate/i);
  assert.throws(() => core.selectPublishedUpdates([entry('../secret', '2026-09-19T00:00:00Z')], new Date('2026-09-19T12:00:00Z')), /slug/i);
});

test('an empty collection has no featured entry or neighbors', () => {
  assert.ok(core);
  assert.deepEqual(core.selectPublishedUpdates([], new Date('2026-09-19T12:00:00Z')), { items: [], featured: null, neighbors: {} });
});

const validArticle = {
  title: 'A product preview', summary: 'A concise, factual editorial summary.',
  publishedAt: '2026-09-18T00:00:00Z', category: 'Product',
  availability: 'preview', featured: false, draft: false,
};
test('schema requires editorial facts, valid UTC dates, category and availability', () => {
  assert.ok(schemaModule);
  const schema = schemaModule.updateSchema;
  assert.equal(schema.parse(validArticle).publishedAt.toISOString(), '2026-09-18T00:00:00.000Z');
  for (const key of ['title', 'summary']) {
    assert.equal(schema.safeParse({ ...validArticle, [key]: '' }).success, false);
    const missing = { ...validArticle };
    delete missing[key];
    assert.equal(schema.safeParse(missing).success, false);
  }
  for (const value of ['2026-09-18', '2026-02-30T00:00:00Z', '2026-09-18T00:00:00-04:00']) {
    assert.equal(schema.safeParse({ ...validArticle, publishedAt: value }).success, false);
  }
  assert.equal(schema.safeParse({ ...validArticle, category: 'Secret' }).success, false);
  assert.equal(schema.safeParse({ ...validArticle, availability: 'launched' }).success, false);
  assert.equal(schema.safeParse({ ...validArticle, coverImage: '/media/home/feed-720.webp' }).success, false);
  assert.equal(schema.safeParse({ ...validArticle, coverImage: '/media/../secret.webp', coverAlt: 'Secret' }).success, false);
  assert.equal(schema.safeParse({ ...validArticle, slug: 'second-authority' }).success, false);
});

test('all four explicit availability states validate', () => {
  const schema = schemaModule.updateSchema;
  for (const availability of ['available', 'rolling_out', 'preview', 'coming_soon']) {
    assert.equal(schema.safeParse({ ...validArticle, availability }).success, true);
    assert.ok(presentation.availabilityLabels[availability]);
  }
});

test('homepage, index and detail share one canonical collection helper', () => {
  const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
  for (const path of ['../src/pages/index.astro', '../src/pages/whats-new.astro', '../src/pages/whats-new/[slug].astro']) {
    assert.match(source(path), /getPublishedUpdates/);
  }
  assert.match(source('../src/lib/updates.ts'), /getCollection\('whatsNew'\)/);
  assert.doesNotMatch(source('../src/pages/index.astro'), /<UpdateCard label="(?:New|Update|Coming next)"/);
  assert.match(source('../src/pages/[...path].astro'), /path !== '\/whats-new'/);
  assert.doesNotMatch(source('../src/components/UpdateCard.astro'), /aria-label=/);
  assert.match(source('../src/components/UpdateCard.astro'), /\{category\} · \{label\}/);
});

test('initial content is versioned, has one filename slug and explicitly marked preview status', () => {
  const folder = new URL('../src/content/whats-new/', import.meta.url);
  const filenames = readdirSync(folder).filter((name) => name.endsWith('.md'));
  assert.equal(filenames.length, 3);
  for (const filename of filenames) {
    const body = readFileSync(new URL(filename, folder), 'utf8');
    assert.doesNotMatch(body, /^slug:/m);
    assert.match(body, /^availability: preview$/m);
    assert.match(body, /^draft: false$/m);
    assert.doesNotMatch(body, /\b(?:generally available|now available to everyone|live for all)\b/i);
  }
});
