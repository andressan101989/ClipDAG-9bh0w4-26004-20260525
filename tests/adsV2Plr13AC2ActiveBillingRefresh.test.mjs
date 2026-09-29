import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const names = readdirSync(new URL("supabase/migrations/", root))
  .filter((name) => name.endsWith("_ads_v2_plr_13a_c2_active_canary_billing_refresh.sql"));
const sql = names.length === 1
  ? readFileSync(new URL(`supabase/migrations/${names[0]}`, root), "utf8")
  : "";

test("PLR-13A-C2 has exactly one forward corrective migration", () => {
  assert.equal(names.length, 1);
});

test("the canonical launch RPC receives only the bounded active billing refresh exception", () => {
  assert.match(sql, /create or replace function public\.set_advertising_launch_mode_v2/i);
  assert.match(sql, /active_canary_billing_refresh/i);
  assert.match(sql, /v_campaign\.status='active'/i);
  assert.match(sql, /p_launch_mode='CANARY_BILLING'/i);
  assert.match(sql, /v_from_mode\s*<>\s*'CANARY_BILLING'/i);
  assert.match(sql, /p_expires_at\s*>\s*v_now\s*\+\s*interval '30 minutes'/i);
  assert.match(sql, /private\.advertising_events[\s\S]*campaign_id=p_campaign_id/i);
  assert.match(sql, /private\.advertising_event_billing_materializations[\s\S]*campaign_id=p_campaign_id/i);
  assert.match(sql, /private\.advertising_financial_events[\s\S]*event_type='spend'/i);
});

test("the corrective preserves the signature, ACL and singleton authorities", () => {
  assert.match(sql, /security definer[\s\S]*set search_path=''/i);
  assert.match(sql, /revoke all on function public\.set_advertising_launch_mode_v2\([\s\S]*from public,anon,authenticated,service_role/i);
  assert.match(sql, /grant execute on function public\.set_advertising_launch_mode_v2\([\s\S]*to service_role/i);
  assert.doesNotMatch(sql, /create\s+(?:or replace\s+)?function\s+public\.[a-z0-9_]*refresh/i);
  assert.doesNotMatch(sql, /create\s+table/i);
  assert.doesNotMatch(sql, /(?:fund_my|spend|settle)_advertising_campaign_budget_v2\s*\(/i);
});
