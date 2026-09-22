import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("../supabase/migrations/20260922213956_ads_v2_f_c1_owner_preview_privacy_hardening.sql", import.meta.url), "utf8");

test("C1 replaces only the existing owner preview RPC", () => {
  assert.match(sql, /create or replace function public\.preview_my_advertising_delivery\s*\(\s*p_ad_id uuid,\s*p_placement_code text,\s*p_viewer_user_id uuid,\s*p_at_time timestamptz/i);
  assert.doesNotMatch(sql, /create\s+table|alter\s+table|create_my_advertising|fetch_advertising_delivery_candidates_v2\s*\(/i);
});

test("cross-user viewer identity is denied before preflight", () => {
  const guard = sql.indexOf("advertising_delivery_preview_viewer_access_denied");
  const call = sql.indexOf("private.advertising_delivery_preflight_at");
  assert.ok(guard > 0 && call > guard);
  assert.match(sql, /p_viewer_user_id is not null\s+and p_viewer_user_id <> v_actor/i);
  assert.match(sql, /advertising_delivery_preflight_at\s*\(\s*p_ad_id,\s*p_placement_code,\s*v_actor,/i);
  assert.doesNotMatch(sql, /advertising_delivery_preflight_at\s*\([^)]*p_viewer_user_id/i);
});

test("RPC remains authenticated SECDEF with an empty search path", () => {
  assert.match(sql, /security definer\s+set search_path = ''/i);
  assert.match(sql, /revoke all on function public\.preview_my_advertising_delivery[^;]+from public, anon/i);
  assert.match(sql, /grant execute on function public\.preview_my_advertising_delivery[^;]+to authenticated/i);
  assert.doesNotMatch(sql, /grant execute[^;]+to anon/i);
});

test("C1 does not touch delivery, events, age, finance, or legacy Ads", () => {
  assert.doesNotMatch(sql, /update\s+private\.advertising_delivery_policy|advertising_placement_catalog\s+set|user_age_eligibility|marketplace_ad_|financial_transactions|ledger_|insert\s+into|delete\s+from/i);
});
