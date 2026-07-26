import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const service = fs.readFileSync('services/mediaService.ts', 'utf8');

test('client performs direct binary PUT, checks HTTP and finalizes', () => {
  assert.match(service, /new File\(input\.uri\)/);
  assert.match(service, /method:'PUT'/);
  assert.match(service, /body:file/);
  assert.match(service, /if\(!response\.ok\)/);
  assert.match(service, /finalizeMediaUpload\(contract\.assetId(?:,\s*operationId)?\)/);
  assert.match(service, /AbortController/);
  assert.doesNotMatch(service, /base64/i);
});
test('client rejects local persisted URLs and has no storage fallback', () => {
  assert.match(service, /\^\(file\|ph\|content\):/);
  assert.doesNotMatch(service, /supabase\.storage|storage\.from/);
});
