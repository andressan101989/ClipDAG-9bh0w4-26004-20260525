import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const profile = fs.readFileSync('app/(tabs)/profile.tsx', 'utf8');
const upload = fs.readFileSync('app/(tabs)/upload.tsx', 'utf8');
const product = fs.readFileSync('app/seller/product-editor/[productId].tsx', 'utf8');
const story = fs.readFileSync('app/(tabs)/index.tsx', 'utf8');
const protectedSources = [
  'modules/onspace-callkit/ios/OnSpaceCallCoordinator.swift',
  'hooks/useAgoraEngine.native.ts',
].map(path => fs.readFileSync(path, 'utf8'));

test('new public image uploaders use mediaService and never persist local fallback URLs', () => {
  assert.match(profile, /purpose: 'avatar'/);
  assert.match(upload, /'post_image'/);
  assert.match(upload, /'carousel_image'/);
  assert.match(product, /purpose: "product_image"/);
  assert.match(story, /purpose: 'post_image'/);
  assert.doesNotMatch(product, /setImages\(prev => \[\.\.\.prev, asset\.uri\]\)/);
  assert.doesNotMatch(upload, /const finalUrl = url \|\| selectedMedia\.uri/);
});
test('carousel concurrency is limited and protected call/Agora code is untouched by media imports', () => {
  assert.match(upload, /mapWithConcurrency\(carouselMedias, 3/);
  for (const source of protectedSources) assert.doesNotMatch(source, /mediaService|Cloudflare R2/);
});
