import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const files = [
  'services/mediaService.ts',
  'supabase/functions/create-media-upload/index.ts',
  'supabase/functions/finalize-media-upload/index.ts',
  'supabase/functions/get-media-url/index.ts',
  'supabase/functions/delete-media-asset/index.ts',
].map(path => fs.readFileSync(path, 'utf8')).join('\n');
const create = fs.readFileSync('supabase/functions/create-media-upload/index.ts', 'utf8');

test('R2 credentials remain backend-only and are never public client variables', () => {
  assert.doesNotMatch(fs.readFileSync('services/mediaService.ts', 'utf8'), /R2_ACCESS_KEY|R2_SECRET|CLOUDFLARE_ACCOUNT/);
  assert.doesNotMatch(files, /EXPO_PUBLIC_R2|console\.(log|warn)\([^)]*uploadUrl/);
});
test('server owns object keys and enforces traversal-safe names and rate limits', () => {
  assert.match(create, /const key=`\$\{env\}\/\$\{purpose\}\/\$\{user\.id\}/);
  assert.doesNotMatch(create, /body\.object_key/);
  assert.match(create, /replace\(\/\[\\u0000-\\u001f\\\\\\\/\]\//);
  assert.match(create, /recent\?\?0\)>=20/);
  assert.match(create, /pending\?\?0\)>=10/);
  assert.match(create, /500_000_000/);
});
