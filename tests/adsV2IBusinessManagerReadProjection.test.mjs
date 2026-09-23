import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationUrl = new URL("../supabase/migrations/20260923060732_ads_v2_i_business_manager_read_projection.sql", import.meta.url);

test("ADS V2 I extends the existing campaign read model without adding write authority", () => {
  const sql = readFileSync(migrationUrl, "utf8");

  assert.match(sql, /create or replace function private\.advertising_campaign_result\s*\(\s*p_campaign_id uuid\s*\)/i);
  assert.match(sql, /'audience'\s*,\s*case when audience\.id is null then null/i);
  assert.match(sql, /'placement_selection'\s*,\s*case when placement_selection\.id is null then null/i);
  assert.match(sql, /'latest_version_number'/i);
  assert.match(sql, /(?:from|join) private\.advertising_audiences/i);
  assert.match(sql, /(?:from|join) private\.advertising_placement_selections/i);
  assert.match(sql, /set search_path\s*=\s*''/i);
  assert.doesNotMatch(sql, /create\s+table|insert\s+into|alter\s+table|grant\s+execute/i);
});
