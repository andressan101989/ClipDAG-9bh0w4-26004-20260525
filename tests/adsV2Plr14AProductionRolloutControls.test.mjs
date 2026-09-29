import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const migrationDirectory = new URL("supabase/migrations/", root);
const names = readdirSync(migrationDirectory)
  .filter((name) => name.endsWith("_ads_v2_plr_14a_production_rollout_controls.sql"));
const sql = names.length === 1
  ? readFileSync(new URL(`supabase/migrations/${names[0]}`, root), "utf8")
  : "";
const adminApi = readFileSync(new URL("apps/admin-web/src/lib/adminAdvertisingApi.ts", root), "utf8");
const adminPage = readFileSync(new URL("apps/admin-web/src/pages/AdminAdvertisingPages.tsx", root), "utf8");

test("PLR-14A has exactly one forward rollout-control migration", () => {
  assert.equal(names.length, 1);
  assert.match(sql, /^begin;/im);
  assert.match(sql, /commit;\s*$/im);
});

test("desired rollout configuration extends the two canonical authorities", () => {
  assert.match(sql, /alter table private\.advertising_delivery_policy[\s\S]*production_rollout_version[\s\S]*production_delivery_paused[\s\S]*production_rollout_config_version/i);
  assert.match(sql, /alter table private\.advertising_placement_catalog[\s\S]*production_rollout_bps[\s\S]*production_kill_switch/i);
  assert.match(sql, /production_rollout_bps\s+between\s+0\s+and\s+10000/i);
  assert.doesNotMatch(sql, /create\s+table\s+.*(?:rollout|placement|delivery_policy)/i);
});

test("one private deterministic cohort helper gates the canonical preflight", () => {
  assert.match(sql, /create or replace function private\.advertising_viewer_in_production_rollout\(\s*p_placement_code text,\s*p_viewer_user_id uuid\s*\)/i);
  assert.match(sql, /extensions\.digest[\s\S]*production_rollout_version[\s\S]*10000/i);
  assert.doesNotMatch(sql, /\brandom\s*\(/i);
  assert.match(sql, /create or replace function private\.advertising_delivery_preflight_at/i);
  assert.match(sql, /production_rollout_not_selected/i);
  assert.match(sql, /private\.advertising_delivery_preflight_structural_at/i);
  assert.match(sql, /private\.advertising_campaign_billing_readiness_at/i);
});

test("the sole launch authority supports production subsets and preserves canary social-feed safety", () => {
  assert.match(sql, /create or replace function public\.set_advertising_launch_mode_v2/i);
  assert.match(sql, /p_launch_mode='PRODUCTION'[\s\S]*production_rollout_bps>0[\s\S]*production_kill_switch/i);
  assert.match(sql, /advertising_production_effective_placement_required/i);
  assert.match(sql, /advertising_production_rate_coverage_incomplete/i);
  assert.match(sql, /p_placement_code<>'social_feed'/i);
  assert.doesNotMatch(sql, /p_launch_mode='PRODUCTION'\s+and\s+code='social_feed'/i);
  assert.match(sql, /grant execute on function public\.set_advertising_launch_mode_v2\([\s\S]*to authenticated/i);
  assert.match(sql, /advertising\.rollout\.manage/i);
});

test("the deferred launch envelope accepts exact multi-surface production state and pause", () => {
  assert.match(sql, /create or replace function private\.advertising_assert_canary_launch_envelope/i);
  assert.match(sql, /production_delivery_paused/i);
  assert.match(sql, /advertising_production_runtime_placement_mismatch/i);
  assert.match(sql, /advertising_production_rate_coverage_incomplete/i);
  assert.doesNotMatch(sql, /v_enabled_count<>1[\s\S]{0,500}mode=PRODUCTION/i);
});

test("rollout capability and audited optimistic mutation are canonical and SUPER_ADMIN-only", () => {
  assert.match(sql, /'advertising\.rollout\.manage'\s*,\s*'advertising'\s*,\s*'workflow'/i);
  assert.match(sql, /\('SUPER_ADMIN'\s*,\s*'advertising\.rollout\.manage'\)/i);
  assert.doesNotMatch(sql, /\('(PLATFORM_ADMIN|FINANCE_AUDITOR|MODERATOR|SUPPORT|MARKETPLACE_ADMIN)'\s*,\s*'advertising\.rollout\.manage'\)/i);
  assert.match(sql, /create or replace function public\.set_admin_advertising_production_rollout_v1/i);
  assert.match(sql, /p_expected_config_version[\s\S]*production_rollout_config_version/i);
  assert.match(sql, /admin_idempotency_conflict/i);
  assert.match(sql, /advertising\.production_rollout\.configure/i);
  assert.match(sql, /insert into private\.admin_action_audit/i);
});

test("read projection exposes six-placement readiness without secrets", () => {
  assert.match(sql, /create or replace function public\.get_admin_advertising_rollout_control_v1/i);
  assert.match(sql, /public\.admin_actor_has_capability\('advertising\.ads\.read'\)[\s\S]*public\.admin_actor_has_capability\('advertising\.billing\.read'\)/i);
  for (const placement of ["social_feed", "clips", "stories", "live", "marketplace_home", "marketplace_search"]) {
    assert.match(sql, new RegExp(`'${placement}'`));
  }
  assert.match(sql, /production_rate_coverage/i);
  assert.doesNotMatch(sql, /service_role[^;]*(?:key|secret)/i);
});

test("Admin Web consumes server rollout truth and exposes no browser service role", () => {
  assert.match(adminApi, /getAdminAdvertisingRolloutControl/);
  assert.match(adminApi, /setAdminAdvertisingProductionRollout/);
  assert.match(adminApi, /setAdminAdvertisingLaunchMode/);
  assert.match(adminPage, /PRODUCTION ROLLOUT/);
  assert.match(adminPage, /advertising\.rollout\.manage/);
  assert.match(adminPage, /Start Production/);
  assert.match(adminPage, /Disarm Production/);
  assert.match(adminPage, /Global delivery pause/);
  assert.doesNotMatch(`${adminApi}\n${adminPage}`, /service_role|SUPABASE_SERVICE_ROLE/i);
});

