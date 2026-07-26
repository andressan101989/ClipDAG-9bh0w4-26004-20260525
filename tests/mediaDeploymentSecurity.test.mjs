import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), 'utf8');

test('media functions preserve the required gateway JWT policy', () => {
  const config = read('supabase/config.toml');
  const expected = new Map([
    ['create-media-upload', 'true'],
    ['finalize-media-upload', 'true'],
    ['get-media-url', 'true'],
    ['delete-media-asset', 'true'],
    ['cleanup-stale-media-uploads', 'false'],
  ]);

  for (const [functionName, verifyJwt] of expected) {
    const section = config.match(
      new RegExp(
        `\\[functions\\.${functionName}\\]([\\s\\S]*?)(?=\\n\\[functions\\.|$)`,
      ),
    );
    assert.ok(section, `missing config section for ${functionName}`);
    assert.match(
      section[1],
      new RegExp(`verify_jwt\\s*=\\s*${verifyJwt}\\b`),
      `${functionName} must set verify_jwt=${verifyJwt}`,
    );
  }
});

test('cleanup remains protected by its independent media secret', () => {
  const cleanup = read(
    'supabase/functions/cleanup-stale-media-uploads/index.ts',
  );
  assert.match(cleanup, /X-Cleanup-Secret/);
  assert.match(cleanup, /MEDIA_CLEANUP_SECRET/);
  assert.doesNotMatch(cleanup, /CALL_DISPATCH_SECRET|call_dispatch_/);
});

test('media deployment configuration does not modify call infrastructure', () => {
  const changedFiles = process.env.MEDIA_CHANGED_FILES?.split(/\r?\n/)
    .filter(Boolean) ?? [];
  assert.equal(
    changedFiles.some((file) =>
      /(^|\/)(modules\/onspace-callkit|dispatch-call-push-deliveries|dispatch-incoming-call-deliveries|watch-call-status)/.test(
        file.replaceAll('\\', '/'),
      ),
    ),
    false,
  );
});
