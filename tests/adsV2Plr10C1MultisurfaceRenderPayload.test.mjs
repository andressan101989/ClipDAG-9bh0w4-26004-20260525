import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const migrationNames = readdirSync(new URL("../supabase/migrations/", import.meta.url))
  .filter((name) => name.endsWith("_ads_v2_plr_10_c1_multisurface_render_payload.sql"));
const sql = migrationNames.length === 1
  ? readFileSync(new URL(`../supabase/migrations/${migrationNames[0]}`, import.meta.url), "utf8")
  : "";

const placements = [
  "social_feed",
  "clips",
  "stories",
  "live",
  "marketplace_home",
  "marketplace_search",
];

test("C1 replaces the one canonical render RPC without changing its payload or security boundary", () => {
  assert.equal(migrationNames.length, 1);
  assert.match(sql, /create or replace function public\.get_advertising_delivery_render_payload_v2\s*\(\s*p_ad_id uuid,\s*p_placement_code text,\s*p_viewer_user_id uuid\s*\)/i);
  assert.match(sql, /returns jsonb[\s\S]*?stable[\s\S]*?security definer[\s\S]*?set search_path\s*=\s*''/i);
  assert.doesNotMatch(sql, /p_placement_code\s+is\s+distinct\s+from\s+'social_feed'/i);
  assert.match(sql, /private\.advertising_delivery_preflight_at\s*\(\s*p_ad_id,\s*p_placement_code,\s*p_viewer_user_id,/i);
  for (const placement of placements) assert.match(sql, new RegExp(`'${placement}'`));
  for (const payloadKey of ["advertiser", "creative", "media", "destination"]) {
    assert.match(sql, new RegExp(`'${payloadKey}'`));
  }
  assert.match(sql, /provider\s*=\s*'r2'[\s\S]*?pub-d146e3d06d274db4871f5b6020fd850f/i);
  assert.match(sql, /provider\s*=\s*'cloudflare_stream'[\s\S]*?cloudflarestream/i);
  assert.match(sql, /revoke all on function public\.get_advertising_delivery_render_payload_v2\(uuid,text,uuid\)[\s\S]*?from public,\s*anon,\s*authenticated,\s*service_role/i);
  assert.match(sql, /grant execute on function public\.get_advertising_delivery_render_payload_v2\(uuid,text,uuid\)[\s\S]*?to service_role/i);
});

test("C1 uses the exact closed placement allowlist and preserves fail-closed invalid-placement semantics", () => {
  assert.match(sql, /advertising_delivery_render_placement_invalid/i);
  const allowed = [...sql.matchAll(/'(social_feed|clips|stories|live|marketplace_home|marketplace_search)'/g)]
    .map((match) => match[1]);
  assert.deepEqual([...new Set(allowed)].sort(), [...placements].sort());
  assert.doesNotMatch(sql, /select\s+code\s+from\s+private\.advertising_placement_catalog/i);
});
