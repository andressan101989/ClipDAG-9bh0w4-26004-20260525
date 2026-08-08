import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const create = fs.readFileSync('supabase/functions/create-media-upload/index.ts', 'utf8');
const finalize = fs.readFileSync('supabase/functions/finalize-media-upload/index.ts', 'utf8');
const r2 = fs.readFileSync('supabase/functions/_shared/r2.ts', 'utf8');

test('create returns a short-lived content-type-bound direct PUT contract', () => {
  assert.match(create, /authenticatedUser\(req\)/);
  assert.match(create, /crypto\.randomUUID\(\)/);
  assert.match(create, /status:'pending'/);
  assert.match(create, /method:'PUT'/);
  assert.match(create, /headers:\{'Content-Type':mime\}/);
  assert.match(r2, /ContentType:mime/);
  assert.match(r2, /expiresIn:300/);
});
test('finalize uses HEAD and changes only verified objects to ready', () => {
  assert.match(finalize, /headObject\(/);
  assert.match(finalize, /ContentLength/);
  assert.match(finalize, /ContentType\s*!==\s*a\.mime_type/);
  assert.match(finalize, /status:\s*"ready"/);
  assert.match(finalize, /status:\s*"failed"[\s\S]*error_code:\s*"object_missing"/);
  assert.match(finalize, /if\s*\(a\.status === "ready"\)/);
});
