import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const migrations = readdirSync(new URL("../supabase/migrations/", import.meta.url))
  .filter((name) => name.endsWith("_ads_v2_e2e_b2_draft_editability.sql"));

test("B2 has exactly one draft editability migration", () => {
  assert.equal(migrations.length, 1);
});

test("B2 update authorities are draft-only, owner-authorized, concurrency-safe and tightly granted", () => {
  const sql = readFileSync(new URL(`../supabase/migrations/${migrations[0]}`, import.meta.url), "utf8");
  for (const name of ["update_my_advertising_ad_set_draft", "update_my_advertising_destination_draft"]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${name}`, "i"));
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}[\\s\\S]*from public, anon, authenticated, service_role`, "i"));
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}[\\s\\S]*to authenticated`, "i"));
  }
  assert.match(sql, /security definer[\s\S]*set search_path\s*=\s*''/i);
  assert.match(sql, /for update/i);
  assert.match(sql, /advertising_ad_set_draft_stale/);
  assert.match(sql, /advertising_destination_draft_stale/);
  assert.match(sql, /advertising_destination_in_use/);
  assert.match(sql, /private\.advertising_ads[\s\S]*destination_id/i);
  assert.match(sql, /ads_require_owned_draft_campaign[\s\S]*for update/i);
  assert.match(sql, /notify\s+pgrst\s*,\s*'reload schema'/i);
  assert.match(sql, /'lifecycle'[\s\S]*activation_enabled[\s\S]*automatic_transitions_enabled/i);
  assert.match(sql, /advertising_campaign_lifecycle_policy[\s\S]*advertising_campaign_finance/i);
  assert.doesNotMatch(sql, /create\s+table/i);
  assert.doesNotMatch(sql, /activation_enabled\s*=\s*true|funding_enabled\s*=\s*true|global_v2_delivery_enabled\s*=\s*true/i);
  const executableMigrationBody = sql.replace(/\$\$[\s\S]*?\$\$/g, "$$FUNCTION_BODY$$");
  assert.doesNotMatch(executableMigrationBody, /insert\s+into\s+private\.advertising_(campaigns|ad_sets|destinations|ads)/i);
});

test("B2 workspace does not select the first Ad Set, Destination or Ad implicitly", () => {
  const source = readFileSync(new URL("../apps/business-web/src/pages/ads/BusinessAdsV2Pages.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /campaign\.adSets\s*\[\s*0\s*\]/);
  assert.doesNotMatch(source, /campaign\.destinations\s*\[\s*0\s*\]/);
  assert.doesNotMatch(source, /campaignAds\s*\[\s*0\s*\]/);
  assert.match(source, /resolveWorkspaceSelection\(campaign\.adSets/);
  assert.match(source, /resolveWorkspaceSelection\(campaign\.destinations/);
  assert.match(source, /resolveWorkspaceSelection\(campaignAds/);
  assert.match(source, /ad\.campaignId === campaign\.id && ad\.adSetId === adSet\?\.id && ad\.destinationId === destination\?\.id/);
  assert.match(source, /data\.campaign\.id !== campaignId/);
  assert.match(source, /let current = true/);
  assert.match(source, /data\.requestKey !== workspaceQueryKey/);
  assert.match(source, /workspaceQueryKeyRef\.current === operationQueryKey && workspace\.requestKey === operationQueryKey/);
});
