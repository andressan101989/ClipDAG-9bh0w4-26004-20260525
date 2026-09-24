import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const migrations = new URL("../supabase/migrations/", import.meta.url);
const matches = readdirSync(migrations).filter((name) =>
  name.endsWith("_ads_v2_plr_2_finance_retry_idempotency_hardening.sql"),
);

test("PLR-2 consists of exactly one corrective migration", () => {
  assert.equal(matches.length, 1, "exactly one PLR-2 migration must exist");
});

const sql = matches.length === 1
  ? readFileSync(new URL(matches[0], migrations), "utf8").replace(/\r\n?/g, "\n")
  : "";

function body(name) {
  const marker = `create or replace function public.${name}`;
  const start = sql.toLowerCase().indexOf(marker.toLowerCase());
  assert.ok(start >= 0, `${name} missing`);
  const end = sql.indexOf("$$;", start);
  assert.ok(end > start, `${name} body terminator missing`);
  return sql.slice(start, end + 3);
}

function before(source, earlier, later, message) {
  const first = source.indexOf(earlier);
  const second = source.indexOf(later);
  assert.ok(first >= 0, `${earlier} missing`);
  assert.ok(second >= 0, `${later} missing`);
  assert.ok(first < second, message);
}

test("fund authorizes ownership and resolves exact replay before the funding switch", () => {
  const fund = body("fund_my_advertising_campaign_budget_v2").toLowerCase();
  before(fund, "v_actor is null", "select * into v_finance from private.advertising_campaign_finance", "authentication must precede finance lookup");
  before(fund, "business.owner_user_id=v_actor", "private.advertising_campaign_finance\n  where campaign_id=p_campaign_id for update", "ownership must precede finance lock");
  before(fund, "event_type='fund' and idempotency_key=p_idempotency_key", "not v_policy.funding_enabled", "replay must precede funding switch");
  before(fund, "advertising_finance_idempotency_conflict", "not v_policy.funding_enabled", "replay conflict must precede funding switch");
  before(fund, "return private.advertising_campaign_finance_result(p_campaign_id)", "not v_policy.funding_enabled", "exact replay must return before funding switch");
  before(fund, "not v_policy.funding_enabled", "ads_actor_is_advertiser_age_eligible", "adult gate applies only to new funding");
  assert.match(fund, /campaign\.status='draft'[\s\S]*account\.status='active'[\s\S]*business\.status='active'/);
  assert.match(fund, /errcode='23505',message='advertising_finance_idempotency_conflict'/);
});

test("spend resolves an exact service-only replay before the spend switch", () => {
  const spend = body("spend_advertising_campaign_budget_v2").toLowerCase();
  before(spend, "auth.role()", "private.advertising_campaign_finance\n  where campaign_id=p_campaign_id for update", "service authorization must precede finance lookup");
  before(spend, "event_type='spend' and idempotency_key=p_idempotency_key", "not v_policy.spend_enabled", "replay must precede spend switch");
  before(spend, "v_prior.billable_event_id<>p_billable_event_id", "not v_policy.spend_enabled", "billable event conflict must precede spend switch");
  before(spend, "v_prior.amount_bdag<>v_amount", "not v_policy.spend_enabled", "amount conflict must precede spend switch");
  assert.match(spend, /errcode='23505',message='advertising_finance_idempotency_conflict'/);
  assert.match(spend, /advertising_billable_event_already_charged/);
});

test("settlement resolves its canonical row before the settlement switch", () => {
  const settle = body("settle_advertising_campaign_budget_v2").toLowerCase();
  before(settle, "auth.role()", "private.advertising_campaign_finance\n  where campaign_id=p_campaign_id for update", "service authorization must precede finance lookup");
  before(settle, "private.advertising_financial_settlements\n  where idempotency_key=p_idempotency_key", "not v_policy.settlement_enabled", "settlement replay must precede settlement switch");
  before(settle, "v_settlement.campaign_id<>p_campaign_id", "not v_policy.settlement_enabled", "settlement conflict must precede settlement switch");
  assert.match(settle, /if found then return private\.advertising_campaign_finance_result\(p_campaign_id\);end if;/);
  assert.match(settle, /errcode='23505',message='advertising_finance_idempotency_conflict'/);
});

test("health removes only the resolved retry blocker and remains fail closed", () => {
  const health = body("get_admin_advertising_health").toLowerCase();
  assert.doesNotMatch(health, /finance_idempotency_preactivation_hardening_required/);
  for (const blocker of [
    "campaign_activation_not_implemented",
    "age_authority_unavailable",
    "finance_funding_disabled",
    "finance_spend_disabled",
    "finance_settlement_disabled",
    "global_delivery_disabled",
    "no_v2_placement_enabled",
  ]) assert.match(health, new RegExp(blocker));
  assert.match(health, /'production_delivery_ready',false/);
});

test("PLR-2 preserves the H authority model and changes no policy, schema or reconciler", () => {
  assert.doesNotMatch(sql, /create\s+table|alter\s+table|create\s+(?:unique\s+)?index/i);
  assert.doesNotMatch(sql, /update\s+private\.advertising_finance_policy|insert\s+into\s+private\.advertising_finance_policy/i);
  assert.doesNotMatch(sql, /funding_enabled\s*=\s*true|spend_enabled\s*=\s*true|settlement_enabled\s*=\s*true/i);
  assert.doesNotMatch(sql, /create or replace function public\.reconcile_/i);
  assert.doesNotMatch(sql, /grant\s+execute|grant\s+all/i);
  assert.doesNotMatch(sql, /create or replace function public\.(?:fund|spend|settle).*_v3/i);
  assert.equal((sql.match(/create or replace function public\./gi) ?? []).length, 4);
  for (const name of [
    "fund_my_advertising_campaign_budget_v2",
    "spend_advertising_campaign_budget_v2",
    "settle_advertising_campaign_budget_v2",
    "get_admin_advertising_health",
  ]) {
    assert.match(body(name), /security definer\s+set search_path\s*=\s*''/i);
  }
});
