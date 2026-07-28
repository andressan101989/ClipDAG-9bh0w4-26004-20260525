import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync('supabase/functions/_shared/mediaPurposes.ts', 'utf8');

test('all authorized non-video purposes have explicit limits and MIME allowlists', () => {
  for (const purpose of [
    'avatar', 'post_image', 'carousel_image', 'thumbnail', 'product_image', 'store_logo', 'store_banner',
    'chat_image', 'chat_audio', 'voice_note', 'music_audio', 'document',
    'attachment', 'live_cover',
  ]) assert.match(source, new RegExp(`${purpose}:\\{`));
  assert.match(source, /avatar:\{kind:'image',maxBytes:10_000_000/);
  assert.match(source, /music_audio:\{kind:'audio',maxBytes:250_000_000/);
  assert.doesNotMatch(source, /video\/mp4/);
});
test('empty MIME, excessive size and public private-purpose uploads are rejected', () => {
  assert.match(source, /!mimeType/);
  assert.match(source, /sizeBytes>rule\.maxBytes/);
  assert.match(source, /visibility_not_allowed/);
});
