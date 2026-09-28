import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const migrationsUrl = new URL("../supabase/migrations/", import.meta.url);
const migrationNames = readdirSync(migrationsUrl)
  .filter((name) => name.endsWith("_ads_v2_plr_9_production_monetization_core.sql"));
const sql = migrationNames.length === 1
  ? readFileSync(new URL(`../supabase/migrations/${migrationNames[0]}`, import.meta.url), "utf8")
  : "";

function functionBody(qualifiedName) {
  const marker = `create or replace function ${qualifiedName}`;
  const start = sql.toLowerCase().indexOf(marker.toLowerCase());
  assert.ok(start >= 0, `${qualifiedName} missing`);
  const next = sql.toLowerCase().indexOf("create or replace function ", start + marker.length);
  return sql.slice(start, next >= 0 ? next : undefined);
}

test("PLR-9 is one forward-only migration with the canonical schema authorities", () => {
  assert.equal(migrationNames.length, 1);
  for (const relation of [
    "private.advertising_objective_capabilities",
    "private.advertising_billing_rate_versions",
    "private.advertising_billing_authorization_windows",
    "private.advertising_event_billing_materializations",
  ]) {
    assert.match(sql, new RegExp(`create table ${relation.replaceAll(".", "\\.")}`, "i"));
  }
  assert.match(sql, /alter table private\.advertising_canary_policy[\s\S]*add column launch_mode/i);
  assert.match(sql, /billing_cutover_at\s+timestamptz/i);
  assert.equal(
    (sql.match(/insert\s+into\s+private\.advertising_billing_rate_versions/gi) ?? []).length,
    1,
    "the only rate INSERT is the audited Admin draft RPC; the migration seeds no real rate",
  );
  assert.doesNotMatch(
    sql,
    /insert\s+into\s+private\.advertising_event_billing_materializations[^;]*\bselect\b[^;]*from\s+private\.advertising_events/i,
  );
});

test("objective capability truth and five launch modes are structural", () => {
  for (const [objective, event] of [
    ["awareness", "impression"],
    ["traffic", "click"],
    ["marketplace_sales", "click"],
  ]) {
    assert.match(sql, new RegExp(`'${objective}'[\\s\\S]{0,180}'${event}'`, "i"));
  }
  for (const objective of [
    "reach", "engagement", "video_views", "profile_visits", "messages",
    "website_conversions", "app_promotion",
  ]) {
    assert.match(sql, new RegExp(`'${objective}'`, "i"));
  }
  for (const mode of [
    "DISARMED", "CANARY_DELIVERY", "CANARY_BILLING", "SETTLEMENT_ONLY", "PRODUCTION",
  ]) {
    assert.match(sql, new RegExp(`'${mode}'`));
  }
  assert.match(sql, /launch_mode[\s\S]*canary_enabled[\s\S]*CANARY_DELIVERY[\s\S]*CANARY_BILLING/i);
  assert.match(sql, /max_spend_bdag[\s\S]*max_billable_events/i);
  assert.match(sql, /max_spend_bdag\s*<=\s*max_budget_bdag/i);
  assert.match(sql, /max_billable_events\s*>=\s*1/i);
  assert.match(functionBody("public.create_my_advertising_campaign_draft("), /advertising_objective_capabilities[\s\S]*setup_enabled/i);
  assert.match(functionBody("public.activate_my_advertising_campaign_v2("), /advertising_objective_capabilities[\s\S]*delivery_runtime_ready/i);
  assert.match(functionBody("public.resume_my_advertising_campaign_v2("), /advertising_objective_capabilities[\s\S]*delivery_runtime_ready/i);
  assert.match(functionBody("private.advertising_delivery_preflight_at("), /objective_delivery_not_available/i);
  assert.doesNotMatch(sql, /advertising_campaign_placement_selections/i);
  assert.match(functionBody("public.set_advertising_launch_mode_v2("), /advertising_placement_selections[\s\S]*advertising_placement_selection_items/i);
});

test("rates are prospective, placement-specific, immutable, and overlap-safe including global NULL scope", () => {
  assert.match(sql, /create extension if not exists btree_gist/i);
  assert.match(sql, /exclude using gist/i);
  assert.match(sql, /coalesce\s*\(\s*scope_campaign_id\s*,\s*'00000000-0000-0000-0000-000000000000'/i);
  assert.match(sql, /tstzrange\s*\(\s*effective_from\s*,\s*effective_to\s*,\s*'\[\)'/i);
  assert.match(sql, /rate_bdag\s+numeric\s*\(\s*20\s*,\s*8\s*\)/i);
  assert.match(sql, /currency[\s\S]*BDAG/i);
  assert.match(sql, /placement_code\s+text\s+not null/i);
  assert.match(sql, /advertising_billing_rate_published_immutable/i);
  assert.match(sql, /effective_from[\s\S]*billing_cutover_at/i);
});

test("classification is AFTER INSERT for impression/click and cannot move money", () => {
  assert.match(sql, /create trigger advertising_billable_event_classifier[\s\S]*after insert[\s\S]*event_type\s+in\s*\(\s*'impression'\s*,\s*'click'\s*\)/i);
  const classifier = functionBody("private.classify_advertising_billable_event_v2()");
  assert.doesNotMatch(classifier, /spend_advertising_campaign_budget_v2/i);
  assert.doesNotMatch(classifier, /financial_transactions|ledger_entries|ledger_accounts/i);
  assert.match(classifier, /billing_cutover_at/i);
  assert.match(classifier, /insert into private\.advertising_event_billing_materializations/i);
});

test("materializations reserve once, terminalize safely, and retain rate provenance", () => {
  assert.match(sql, /billable_event_id\s+uuid\s+not null\s+unique/i);
  for (const status of [
    "pending", "charged", "budget_exhausted", "not_billable_no_rate",
    "not_billable_outside_authorization", "not_billable_before_cutover",
    "not_billable_objective",
  ]) {
    assert.match(sql, new RegExp(`'${status}'`));
  }
  const pending = functionBody("private.advertising_active_pending_reserved_bdag(");
  assert.match(pending, /materialization\.status\s*=\s*'pending'/i);
  assert.match(pending, /window_row\.status\s*=\s*'OPEN'/i);
  assert.match(pending, /window_row\.opened_at\s*<=/i);
  assert.match(pending, /window_row\.expires_at\s+is null|window_row\.expires_at\s*>/i);
  assert.doesNotMatch(pending, /greatest\s*\(/i);
});

test("only the bounded server materializer invokes canonical Spend", () => {
  const materializer = functionBody("public.reconcile_advertising_billable_events_v2(");
  assert.match(materializer, /public\.spend_advertising_campaign_budget_v2/i);
  assert.match(materializer, /for update(?:\s+of\s+\w+)?\s+skip locked/i);
  assert.doesNotMatch(materializer, /exception\s+when\s+others/i);
  const spend = functionBody("public.spend_advertising_campaign_budget_v2(");
  assert.match(spend, /advertising_event_billing_materializations/i);
  assert.match(spend, /p_amount_bdag\s*(?:<>|!=)\s*v_materialization\.amount_bdag/i);
  assert.match(spend, /authorization_window_id/i);
});

test("launch, lifecycle, settlement, and cron authorities are singular and mode-aware", () => {
  for (const name of [
    "public.set_advertising_launch_mode_v2(",
    "public.reconcile_advertising_billable_events_v2(",
    "public.reconcile_advertising_campaign_settlements_v2(",
    "public.reconcile_advertising_campaign_lifecycle(",
  ]) {
    assert.equal((sql.toLowerCase().match(new RegExp(name.replace(/[.*+?^$()|[\]\\]/g, "\\$&"), "g")) ?? []).length >= 1, true);
  }
  for (const job of [
    "reconcile-advertising-billable-events-v2",
    "reconcile-advertising-campaign-lifecycle-v2",
    "reconcile-advertising-campaign-settlements-v2",
  ]) {
    assert.match(sql, new RegExp(`cron\\.schedule\\([\\s\\S]*'${job}'`, "i"));
  }
  assert.match(functionBody("public.reconcile_advertising_campaign_lifecycle("), /launch_mode\s*=\s*'PRODUCTION'/i);
  assert.match(functionBody("public.reconcile_advertising_campaign_settlements_v2("), /SETTLEMENT_ONLY[\s\S]*PRODUCTION/i);
});

test("Admin rate commands reuse canonical capability and immutable audit", () => {
  assert.match(sql, /advertising\.billing\.read/i);
  assert.match(sql, /advertising\.rates\.manage/i);
  for (const action of [
    "advertising.rate.draft.create",
    "advertising.rate.draft.update",
    "advertising.rate.publish",
    "advertising.rate.retire",
    "advertising.launch_mode.transition",
  ]) {
    assert.match(sql, new RegExp(action.replaceAll(".", "\\.")));
  }
  assert.match(sql, /private\.admin_action_audit/i);
  assert.doesNotMatch(sql, /create table (?:private\.)?(?:advertising_rate_audit|billing_admin_log)/i);
  assert.match(sql, /create or replace function private\.admin_audit_row_visible/i);
  assert.match(sql, /create or replace function public\.search_admin_finance_audit/i);
  assert.match(
    functionBody("public.set_advertising_launch_mode_v2("),
    /'advertising\.launch_mode\.transition'\s*,\s*'advertising_control_plane'/i,
    "launch transitions use the approved durable control-plane audit target",
  );
});

test("new privileged RPCs have locked search paths and least-privilege ACLs", () => {
  for (const name of [
    "set_advertising_launch_mode_v2",
    "reconcile_advertising_billable_events_v2",
    "reconcile_advertising_campaign_settlements_v2",
    "admin_create_advertising_billing_rate_draft_v2",
    "admin_update_advertising_billing_rate_draft_v2",
    "admin_publish_advertising_billing_rate_v2",
    "admin_retire_advertising_billing_rate_v2",
  ]) {
    const body = functionBody(`public.${name}(`);
    assert.match(body, /security definer/i, name);
    assert.match(body, /set search_path\s*=\s*''/i, name);
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\([\\s\\S]*from public,\\s*anon,\\s*authenticated,\\s*service_role`, "i"), name);
  }
  assert.match(sql, /grant execute on function public\.set_advertising_launch_mode_v2[\s\S]*to service_role/i);
  assert.match(sql, /grant execute on function public\.get_my_advertising_campaign_billing_v2[\s\S]*to authenticated/i);
});

test("reconciliation is mode-aware and safe DISARMED zero-rate state is legal", () => {
  const reconciliation = functionBody("public.reconcile_advertising_finance()");
  for (const key of [
    "production_rate_coverage_gap",
    "canary_rate_scope_mismatch",
    "active_pending_reservation_overflow",
    "billing_before_cutover",
    "billing_outside_authorization",
  ]) {
    assert.match(reconciliation, new RegExp(key));
  }
  assert.match(reconciliation, /launch_mode\s*=\s*'PRODUCTION'[\s\S]*production_rate_coverage_gap/i);
  assert.match(reconciliation, /launch_mode\s*=\s*'CANARY_BILLING'[\s\S]*canary_rate_scope_mismatch/i);
});
