import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const remove = fs.readFileSync('supabase/functions/delete-media-asset/index.ts', 'utf8');
const cleanup = fs.readFileSync('supabase/functions/cleanup-stale-media-uploads/index.ts', 'utf8');
const sql = fs.readFileSync('supabase/migrations/20260726090000_media_asset_foundation.sql', 'utf8');
const safetySql = fs.readFileSync('supabase/migrations/20260726105000_media_public_urls_and_safe_links.sql', 'utf8');

test('delete is owner-scoped, schedule-only, and idempotent', () => {
  assert.match(remove, /\.eq\('owner_id',user\.id\)/);
  assert.match(remove, /if\(a\.status==='deleted'\)/);
  assert.match(remove, /schedule_media_asset_deletion/);
  assert.match(remove, /status:'delete_pending'/);
  assert.doesNotMatch(remove, /deleteObject\(|finalize_media_asset_deletion/);
  assert.match(safetySql, /for update;/i);
  assert.match(safetySql, /media_asset_has_valid_links\(p_asset_id\)/);
});
test('stale uploads and failed deletes have an idempotent cron backstop', () => {
  assert.match(sql, /created_at < now\(\) - interval '1 hour'/);
  assert.match(sql, /interval '24 hours'/);
  assert.match(sql, /'\*\/15 \* \* \* \*'/);
  assert.match(cleanup, /X-Cleanup-Secret/);
  assert.match(cleanup, /MEDIA_CLEANUP_SECRET/);
  assert.doesNotMatch(`${cleanup}\n${sql}`, /CALL_DISPATCH_SECRET|call_dispatch_(project_url|publishable_key|secret)/);
  assert.match(cleanup, /deleteObjectWithReceipt/);
  assert.match(cleanup, /verifyObjectAbsent/);
  assert.match(cleanup, /finalize_media_asset_cleanup_v1/);
  assert.match(cleanup, /record_media_asset_cleanup_failure_v1/);
});
