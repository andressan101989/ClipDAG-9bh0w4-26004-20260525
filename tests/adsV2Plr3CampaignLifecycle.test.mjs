import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const migrations = new URL("../supabase/migrations/", import.meta.url);
const matches = readdirSync(migrations).filter((name) =>
  name.endsWith("_ads_v2_plr_3_campaign_activation_lifecycle.sql"),
);

test("PLR-3 consists of exactly one lifecycle migration", () => {
  assert.equal(matches.length, 1, "exactly one PLR-3 migration must exist");
});

const sql = matches.length === 1 ? readFileSync(new URL(matches[0], migrations), "utf8") : "";

function body(schema, name) {
  const marker = `create or replace function ${schema}.${name}`;
  const start = sql.toLowerCase().indexOf(marker.toLowerCase());
  assert.ok(start >= 0, `${schema}.${name} missing`);
  const end = sql.indexOf("$$;", start);
  assert.ok(end > start, `${schema}.${name} body terminator missing`);
  return sql.slice(start, end + 3).toLowerCase();
}

function before(source, earlier, later, message) {
  const first = source.indexOf(earlier);
  const second = source.indexOf(later);
  assert.ok(first >= 0, `${earlier} missing`);
  assert.ok(second >= 0, `${later} missing`);
  assert.ok(first < second, message);
}

test("canonical status constraint and lifecycle policy remain pre-launch locked", () => {
  assert.match(sql, /status in \('draft','scheduled','active','paused','completed','cancelled','archived'\)/i);
  assert.match(sql, /status='archived' and archived_at is not null/i);
  assert.match(sql, /status<>'archived' and archived_at is null/i);
  assert.match(sql, /create table private\.advertising_campaign_lifecycle_policy/i);
  assert.match(sql, /nelyon-ads-campaign-lifecycle-v1/i);
  assert.match(sql, /activation_enabled boolean not null default false/i);
  assert.match(sql, /automatic_transitions_enabled boolean not null default false/i);
  assert.doesNotMatch(sql, /activation_enabled\s*=\s*true|automatic_transitions_enabled\s*=\s*true/i);
});

test("lifecycle audit is private, immutable and owner actions are idempotent", () => {
  assert.match(sql, /create table private\.advertising_campaign_lifecycle_events/i);
  assert.match(sql, /action in \('activate','pause','resume','complete','cancel'\)/i);
  assert.match(sql, /source in \('owner','service'\)/i);
  assert.match(sql, /create unique index advertising_campaign_lifecycle_events_idempotency_idx/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /force row level security/i);
  assert.match(sql, /raise exception using errcode='55000',message='advertising_campaign_lifecycle_events_immutable'/i);
  assert.match(sql, /revoke all on table private\.advertising_campaign_lifecycle_events from public,anon,authenticated,service_role/i);
});

test("readiness is server-derived from identity, age, finance, reviewed assembly and placements", () => {
  const readiness = body("private", "advertising_campaign_operational_readiness_at");
  for (const required of [
    "ads_actor_is_advertiser_age_eligible",
    "advertising_campaign_finance",
    "ads_ad_submission_fingerprint",
    "advertising_audience_versions",
    "advertising_placement_selection_versions",
    "advertising_placement_catalog",
    "viewer_geo_authority_unavailable",
    "viewer_language_authority_unavailable",
    "campaign_schedule_expired",
    "no_operational_ad_set",
  ]) assert.match(readiness, new RegExp(required));
  assert.match(readiness, /'target_status',v_target_status/);
  assert.match(readiness, /'ready_ad_count',v_ready_ad_count/);
});

test("activate and resume resolve authorized exact replay before policy", () => {
  for (const name of ["activate_my_advertising_campaign_v2", "resume_my_advertising_campaign_v2"]) {
    const action = body("public", name);
    before(action, "business.owner_user_id=v_actor", "idempotency_key=p_idempotency_key", `${name} ownership must precede replay`);
    before(action, "idempotency_key=p_idempotency_key", "not v_policy.activation_enabled", `${name} replay must precede policy`);
    assert.match(action, /advertising_campaign_lifecycle_idempotency_conflict/);
    assert.match(action, /advertising_campaign_activation_disabled/);
  }
});

test("pause and cancel are risk-reducing owner transitions without activation policy", () => {
  const pause = body("public", "pause_my_advertising_campaign_v2");
  const cancel = body("public", "cancel_my_advertising_campaign_v2");
  assert.match(pause, /status not in \('scheduled','active'\)/);
  assert.match(cancel, /status not in \('draft','scheduled','active','paused'\)/);
  assert.doesNotMatch(pause, /activation_enabled/);
  assert.doesNotMatch(cancel, /activation_enabled/);
  assert.match(pause, /to_status[^\n]*'paused'|values[^;]*'pause'[^;]*'paused'/s);
  assert.match(cancel, /to_status[^\n]*'cancelled'|values[^;]*'cancel'[^;]*'cancelled'/s);
});

test("service reconciler is bounded and never auto-resumes a paused campaign", () => {
  const reconcile = body("public", "reconcile_advertising_campaign_lifecycle");
  assert.match(reconcile, /v_role<>'service_role'/);
  assert.match(reconcile, /p_limit<1 or p_limit>500/);
  assert.match(reconcile, /for update skip locked/);
  assert.match(reconcile, /scheduled.*active/s);
  assert.match(reconcile, /'complete'/);
  assert.doesNotMatch(reconcile, /paused[^;]{0,300}to_status[^;]{0,60}active/s);
});

test("delivery preflight enforces lifecycle, schedule, finance, advertiser age and review fingerprint", () => {
  const preflight = body("private", "advertising_delivery_preflight_at");
  assert.doesNotMatch(preflight, /campaign_activation_not_implemented/);
  assert.doesNotMatch(preflight, /return pg_catalog\.jsonb_build_object\([\s\S]*'structurally_ready',v_structural[\s\S]*'production_deliverable',false/);
  for (const reason of [
    "campaign_not_active", "campaign_paused", "campaign_completed", "campaign_cancelled", "campaign_unavailable",
    "ad_set_outside_schedule", "campaign_finance_not_funded", "campaign_budget_exhausted",
    "advertiser_adult_eligibility_required", "ad_review_fingerprint_mismatch", "global_delivery_disabled",
  ]) assert.match(preflight, new RegExp(reason));
  assert.match(preflight, /'production_deliverable',v_production_deliverable/);
});

test("health replaces the implementation blocker with locked lifecycle policy blockers", () => {
  const health = body("public", "get_admin_advertising_health");
  assert.doesNotMatch(health, /campaign_activation_not_implemented/);
  assert.match(health, /campaign_activation_disabled/);
  assert.match(health, /campaign_automatic_transitions_disabled/);
  assert.match(health, /'campaign_activation_implemented',true/);
  assert.match(health, /'production_delivery_ready',false/);
});

test("grants preserve owner and service boundaries", () => {
  for (const name of [
    "get_my_advertising_campaign_activation_readiness",
    "activate_my_advertising_campaign_v2",
    "pause_my_advertising_campaign_v2",
    "resume_my_advertising_campaign_v2",
    "cancel_my_advertising_campaign_v2",
  ]) assert.match(sql, new RegExp(`grant execute on function public\\.${name}[^;]+to authenticated`, "is"));
  assert.match(sql, /revoke all on function public\.reconcile_advertising_campaign_lifecycle[^;]+from public,anon,authenticated/is);
  assert.match(sql, /grant execute on function public\.reconcile_advertising_campaign_lifecycle[^;]+to service_role/is);
  assert.doesNotMatch(sql, /grant execute on function public\.fetch_advertising_delivery_candidates_v2[^;]+to authenticated/is);
});
