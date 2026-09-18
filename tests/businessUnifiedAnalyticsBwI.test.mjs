import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20260918045352_business_unified_analytics_bw_i.sql", "utf8");

test("BW-I creates one read projection and no parallel analytics or finance table", () => {
  assert.match(migration, /create or replace function public\.get_my_business_analytics/);
  assert.doesNotMatch(migration, /create\s+table|insert\s+into|update\s+public\.|delete\s+from\s+public\./i);
  assert.doesNotMatch(migration, /ledger_(credit|debit)|financial_transactions|app_wallets/i);
});

test("general analytics and every sensitive optional section have independent server gates", () => {
  assert.match(migration, /business\.analytics\.read/);
  assert.match(migration, /business\.ads\.read/);
  assert.match(migration, /business\.ads\.manage/);
  assert.match(migration, /business\.finance\.read/);
  assert.match(migration, /business\.payouts\.read/);
  assert.match(migration, /business\.payouts\.manage/);
  assert.match(migration, /'ads'.*'authorized', v_ads_allowed.*case when v_ads_allowed then v_ads else null end/s);
  assert.match(migration, /'finance'.*'authorized', v_finance_allowed.*case when v_finance_allowed then v_finance else null end/s);
  assert.match(migration, /'payouts'.*'authorized', v_payouts_allowed.*case when v_payouts_allowed then v_payouts else null end/s);
});

test("the projection is cross-business scoped, UTC bounded, and zero-fills daily series", () => {
  assert.match(migration, /e\.seller_id = p_business_owner_id/g);
  assert.match(migration, /at time zone 'UTC'/);
  assert.match(migration, /generate_series/);
  assert.match(migration, /when '7d' then 7 when '30d' then 30 when '90d' then 90/);
  assert.match(migration, /coalesce\(a\.gmv_bdag, 0::numeric\)::text/);
});

test("global breakdown counts stay independent from the bounded twenty-row response", () => {
  assert.match(migration, /count\(\*\) over \(\) as total_count/g);
  assert.match(migration, /limit 20/g);
  assert.match(migration, /'total_count', coalesce\(max\(r\.total_count\), 0\)/g);
});

test("money comes from canonical server aggregates and is serialized exactly", () => {
  assert.match(migration, /gross_merchandise_bdag/);
  assert.match(migration, /delta_spend_bdag/);
  assert.match(migration, /seller_net_amount/);
  assert.match(migration, /bdag_amount/);
  assert.match(migration, /::text/g);
});

test("SECURITY DEFINER exposure is deliberately minimized", () => {
  assert.match(migration, /security definer\s+set search_path = ''/i);
  assert.match(migration, /revoke all on function public\.get_my_business_analytics\(uuid, text\) from public, anon, authenticated, service_role/);
  assert.match(migration, /grant execute on function public\.get_my_business_analytics\(uuid, text\) to authenticated, service_role/);
});
