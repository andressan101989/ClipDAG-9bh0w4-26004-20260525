import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const feed = fs.readFileSync('contexts/FeedContext.tsx', 'utf8');
const upload = fs.readFileSync('app/(tabs)/upload.tsx', 'utf8');
const presentation = fs.readFileSync('services/videoPresentation.ts', 'utf8');

test('legacy HTTPS and Supabase paths remain readable', () => {
  assert.match(presentation, /PLAYABLE_URL_RE = \/\^\(https\?:/);
  assert.match(presentation, /normalizePlayableUrl/);
  assert.match(presentation, /getPublicUrl/);
  assert.match(feed, /mapVideoRow/);
});
test('video remains legacy and image paths use the R2 media service', () => {
  assert.match(upload, /if \(isVideo\)/);
  assert.match(upload, /Contenido exclusivo próximamente/);
  assert.match(upload, /uploadMediaFromUri/);
  assert.match(upload, /purpose: mode === 'carousel' \? 'carousel_image' : 'post_image'/);
  assert.doesNotMatch(upload, /purpose:\s*'video'/);
});
