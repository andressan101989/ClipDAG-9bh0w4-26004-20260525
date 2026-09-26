import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const migrations = readdirSync(new URL("supabase/migrations/", root))
  .filter((name) => name.endsWith("_ads_v2_plr_6b_c1_canonical_funding_recovery.sql"));
const sql = migrations.length === 1
  ? readFileSync(new URL(`supabase/migrations/${migrations[0]}`, root), "utf8")
  : "";

function functionBody(name) {
  const start = sql.toLowerCase().indexOf(`create or replace function public.${name}`);
  const end = sql.indexOf("$$;", start);
  assert.ok(start >= 0 && end > start, `${name} replacement missing`);
  return sql.slice(start, end + 3);
}

test("C1 is one forward-only migration replacing only the two approved authorities", () => {
  assert.equal(migrations.length, 1);
  const replacements = [...sql.matchAll(/create\s+or\s+replace\s+function\s+([\w.]+)/gi)]
    .map((match) => match[1].toLowerCase());
  assert.deepEqual(replacements, [
    "public.get_my_advertising_campaign_finance",
    "public.settle_advertising_campaign_budget_v2",
  ]);
  assert.doesNotMatch(sql, /create\s+table|fund_ad_campaign_v3|service_role\s+(?:key|secret)|33b34e6a|tesla el carro|56990585/i);
  assert.doesNotMatch(sql, /update\s+private\.advertising_(?:canary_policy|finance_policy|campaign_lifecycle_policy|delivery_policy|placement_catalog)/i);
});

test("Finance read projects server-derived funding capability without client-specific constants", () => {
  const body = functionBody("get_my_advertising_campaign_finance");
  assert.match(body, /'funding_available'\s*,\s*v_funding_available/i);
  assert.match(body, /'funding_state'\s*,\s*v_funding_state/i);
  assert.match(body, /'budget_bdag_exact'\s*,\s*v_finance\.budget_bdag::text/i);
  assert.match(body, /finance_status\s*<>\s*'draft'/i);
  assert.match(body, /not\s+v_policy\.funding_enabled/i);
  assert.match(body, /private\.advertising_canary_campaign_allowed\s*\(\s*p_campaign_id\s*,\s*pg_catalog\.now\(\)\s*,\s*true\s*,\s*v_finance\.budget_bdag\s*\)/i);
  for (const state of ["platform_disabled", "available", "campaign_restricted", "already_funded"])
    assert.match(body, new RegExp(`'${state}'`, "i"));
  assert.match(body, /business\.owner_user_id\s*=\s*v_actor/i);
});

test("Settlement retains canonical money logic and admits only service or management sessions", () => {
  const body = functionBody("settle_advertising_campaign_budget_v2");
  assert.match(body, /v_role\s+text\s*:=\s*coalesce\(\(select auth\.role\(\)\),''\)/i);
  assert.match(body, /v_role\s*<>\s*'service_role'/i);
  assert.match(body, /session_user\s+not\s+in\s*\(\s*'postgres'\s*,\s*'supabase_admin'\s*\)/i);
  assert.match(body, /advertising_finance_internal_only/i);
  assert.match(body, /v_unused\s*:=\s*v_finance\.funded_bdag\s*-\s*v_finance\.spent_bdag\s*-\s*v_finance\.released_bdag/i);
  assert.match(body, /to_account_id[^;]+funding_source_account_id/is);
  assert.match(body, /public\.ledger_debit/i);
  assert.match(body, /public\.ledger_credit/i);
  assert.match(body, /advertising_canary_campaign_allowed/i);
  assert.doesNotMatch(body.slice(0, body.indexOf("returns jsonb")), /p_(?:amount|release)/i);
});

test("C1 reasserts browser-denied settlement and canonical existing grants", () => {
  assert.match(sql, /revoke all on function public\.settle_advertising_campaign_budget_v2\(uuid,uuid\) from public,\s*anon,\s*authenticated/i);
  assert.match(sql, /grant execute on function public\.settle_advertising_campaign_budget_v2\(uuid,uuid\) to service_role/i);
  assert.match(sql, /revoke all on function public\.fund_my_advertising_campaign_budget_v2\(uuid,uuid\) from public,\s*anon/i);
  assert.match(sql, /grant execute on function public\.fund_my_advertising_campaign_budget_v2\(uuid,uuid\) to authenticated,\s*service_role/i);
  assert.match(sql, /revoke all on function public\.get_my_advertising_campaign_finance\(uuid\) from public,\s*anon/i);
  assert.match(sql, /grant execute on function public\.get_my_advertising_campaign_finance\(uuid\) to authenticated/i);
});
