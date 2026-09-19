import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('public foundation is static, noindex during shell phase and uses official branding', () => {
  const config = read('../astro.config.mjs');
  const layout = read('../src/layouts/PublicLayout.astro');
  const shell = read('../src/pages/[...path].astro');
  assert.match(config, /output:\s*'static'/);
  assert.match(config, /site:\s*'https:\/\/nelyon\.app'/);
  assert.match(layout, /noindex,nofollow/);
  assert.match(layout, /nelyon-wordmark-on-dark\.png/);
  assert.match(shell, /getStaticPaths/);
  assert.ok(existsSync(new URL('../src/pages/404.astro', import.meta.url)));
});

test('public source imports neither Business nor Supabase modules', () => {
  for (const path of ['../src/layouts/PublicLayout.astro', '../src/pages/index.astro', '../src/pages/[...path].astro']) {
    const source = read(path);
    assert.doesNotMatch(source, /BusinessAuthProvider|@supabase|businessApi|sellerCenterApi|adsManagerApi|hls\.js/);
  }
});

test('legacy static redirect shell preserves the current query string', () => {
  const shell = read('../src/pages/[...path].astro');
  assert.match(shell, /window\.location\.search/);
  assert.match(shell, /window\.location\.replace/);
});
