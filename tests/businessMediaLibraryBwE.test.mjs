import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const migration = readFileSync(join(root, "supabase/migrations/20260916204028_business_media_library_bw_e.sql"), "utf8");
const createMedia = readFileSync(join(root, "supabase/functions/create-media-upload/index.ts"), "utf8");
const finalizeMedia = readFileSync(join(root, "supabase/functions/finalize-media-upload/index.ts"), "utf8");
const createStream = readFileSync(join(root, "supabase/functions/create-stream-upload/index.ts"), "utf8");
const client = readFileSync(join(root, "apps/business-web/src/lib/businessMediaApi.ts"), "utf8");
const sharedPlayer = readFileSync(join(root, "shared/web-media/src/BrowserVideoPreview.tsx"), "utf8");

test("BW-E remains a projection over canonical assets with no parallel media tables", () => {
  assert.doesNotMatch(migration, /create\s+table/i);
  assert.match(migration, /from public\.media_assets/);
  assert.match(migration, /from public\.video_assets/);
  assert.match(migration, /public\.search_my_business_media/);
  assert.match(migration, /public\.set_marketplace_store_media/);
});

test("business upload scopes are capability-checked and keep business_owner_id canonical", () => {
  for (const source of [createMedia, createStream]) {
    assert.match(source, /business_owner_id/);
    assert.match(source, /business\.media\.manage/);
    assert.match(source, /ownerId=requestedBusinessOwner/);
    assert.match(source, /purpose!=='business_library'/);
  }
  assert.match(finalizeMedia, /a\.purpose === "business_library"/);
  assert.match(finalizeMedia, /business\.media\.manage/);
});

test("R2 client sends exact returned headers and preserves write-once precondition", () => {
  assert.match(createMedia, /'If-None-Match':'\*'/);
  assert.match(client, /uploadRequest\(uploadUrl, "PUT", file, headers/);
  assert.match(client, /request\.status === 412/);
  assert.doesNotMatch(client, /setRequestHeader\("If-None-Match"/);
});

test("library and Store authorities are capability-scoped with safe search paths", () => {
  assert.match(migration, /business\.media\.read/);
  assert.match(migration, /business\.media\.manage/);
  assert.match(migration, /business\.store\.manage/);
  assert.match(migration, /security definer\s+set search_path = ''/gi);
  assert.match(migration, /revoke all on function public\.search_my_business_media[^;]+from public, anon/);
  assert.match(migration, /grant execute on function public\.search_my_business_media[^;]+to authenticated/);
});

test("one neutral browser player owns native HLS and hls.js fallback", () => {
  assert.match(sharedPlayer, /application\/vnd\.apple\.mpegurl/);
  assert.match(sharedPlayer, /video\.src = url/);
  assert.match(sharedPlayer, /import\("hls\.js"\)/);
  assert.match(sharedPlayer, /hls\.loadSource\(url\)/);
  assert.match(sharedPlayer, /hls\.attachMedia\(video\)/);
  assert.match(sharedPlayer, /hls\?\.destroy\(\)/);
});
