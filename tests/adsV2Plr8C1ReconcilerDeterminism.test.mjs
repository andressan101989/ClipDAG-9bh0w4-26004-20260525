import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const migrationsUrl = new URL("../supabase/migrations/", import.meta.url);

test("PLR-8 C1 reconciler follows canonical purchase validity and propagates processing failures", () => {
  const names = readdirSync(migrationsUrl)
    .filter((name) => name.endsWith("_ads_v2_plr_8_c1_reconciler_determinism.sql"));
  assert.equal(names.length, 1);
  const sql = readFileSync(new URL(`../supabase/migrations/${names[0]}`, import.meta.url), "utf8");

  assert.match(sql, /create or replace function public\.reconcile_advertising_marketplace_purchase_conversions_v2\(p_limit integer default 100\)/i);
  assert.match(sql, /security definer[\s\S]*set search_path\s*=\s*''/i);
  assert.match(sql, /order_row\.confirmed_at is not null/i);
  assert.match(sql, /order_row\.confirmed_at\s*>=\s*v_policy\.marketplace_purchase_conversion_started_at/i);
  assert.match(sql, /order_row\.cancelled_at is null/i);
  assert.match(sql, /order_row\.expired_at is null/i);
  assert.doesNotMatch(sql, /order_row\.status\s+in\s*\(/i);
  assert.doesNotMatch(sql, /exception\s+when\s+others/i);
  assert.match(sql, /v_result\s*:=\s*public\.record_advertising_marketplace_purchase_conversion_v2\(v_item\.id,v_conversion_key\)/i);
  assert.match(sql, /for update/i);
  assert.match(sql, /order by order_row\.confirmed_at,item\.id/i);
  assert.match(sql, /revoke all on function public\.reconcile_advertising_marketplace_purchase_conversions_v2\(integer\)[\s\S]*from public,anon,authenticated/i);
  assert.match(sql, /grant execute on function public\.reconcile_advertising_marketplace_purchase_conversions_v2\(integer\)[\s\S]*to service_role/i);
  assert.doesNotMatch(sql, /cron\.(schedule|unschedule)/i);
  assert.doesNotMatch(sql, /create\s+(unique\s+)?index/i);
});

test("PLR-8 root cause remains documented by the historical migration without editing history", () => {
  const names = readdirSync(migrationsUrl)
    .filter((name) => name.endsWith("_ads_v2_plr_8_full_funnel_marketplace_attribution.sql"));
  assert.equal(names.length, 1);
  const sql = readFileSync(new URL(`../supabase/migrations/${names[0]}`, import.meta.url), "utf8");
  assert.match(sql, /order_row\.status in \('confirmed','processing','shipped','delivered'\)/i);
  assert.match(sql, /exception when others then[\s\S]*v_errors := v_errors \+ 1;[\s\S]*exit;/i);
});
