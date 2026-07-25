import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const sql = fs.readFileSync('supabase/migrations/20260726090000_media_asset_foundation.sql', 'utf8');

test('provider-neutral asset and link tables have constrained lifecycle metadata', () => {
  assert.match(sql, /create table if not exists public\.media_assets/i);
  assert.match(sql, /'r2','cloudflare_stream','supabase_legacy'/);
  assert.match(sql, /'pending','uploading','ready','failed','delete_pending','deleted'/);
  assert.match(sql, /unique\(bucket_name, object_key\)/i);
  assert.match(sql, /create table if not exists public\.media_asset_links/i);
});
test('RLS exposes reads but no client lifecycle writes', () => {
  assert.match(sql, /enable row level security/);
  assert.match(sql, /owner_id = auth\.uid\(\)/);
  assert.match(sql, /visibility = 'public' and status = 'ready'/);
  assert.doesNotMatch(sql, /create policy .* for (insert|update|delete)/i);
});
