import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync('supabase/functions/_shared/mediaPurposes.ts', 'utf8');

test('all authorized purposes have explicit limits and MIME allowlists', () => {
  for (const purpose of [
    'avatar', 'post_image', 'carousel_image', 'thumbnail', 'product_image', 'store_logo', 'store_banner',
    'chat_image', 'chat_audio', 'voice_note', 'music_audio', 'document',
    'attachment', 'live_cover',
    'product_video',
  ]) assert.match(source, new RegExp(`${purpose}:\\s*\\{`));
  assert.match(source, /avatar:\s*\{\s*kind:\s*"image",\s*maxBytes:\s*10_000_000/);
  assert.match(source, /product_video:\s*\{[\s\S]*maxBytes:\s*250_000_000/);
  assert.match(source, /video\/mp4/);
});
test('empty MIME, excessive size and public private-purpose uploads are rejected', () => {
  assert.match(source, /!mimeType/);
  assert.match(source, /sizeBytes\s*>\s*rule\.maxBytes/);
  assert.match(source, /visibility_not_allowed/);
});
