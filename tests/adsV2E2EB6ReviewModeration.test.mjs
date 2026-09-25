import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migrationNames = readdirSync(join(root, "supabase", "migrations"));
const foundation = readFileSync(join(root, "supabase", "migrations", migrationNames.find((name) => name.endsWith("_ads_v2_d_creative_moderation_foundation.sql"))), "utf8");
const adminProjection = readFileSync(join(root, "supabase", "migrations", migrationNames.find((name) => name.endsWith("_ads_v2_j_admin_analytics_production_closure.sql"))), "utf8");
const businessApi = readFileSync(join(root, "apps", "business-web", "src", "lib", "adsManagerApi.ts"), "utf8");
const adminApi = readFileSync(join(root, "apps", "admin-web", "src", "lib", "adminAdvertisingApi.ts"), "utf8");
const adminCoordinator = readFileSync(join(root, "apps", "admin-web", "src", "lib", "adminReviewCoordinator.ts"), "utf8");

test("B6 adds no database migration and keeps the canonical review RPCs", () => {
  assert.equal(migrationNames.filter((name) => /e2e_b6|review_moderation_operational/i.test(name)).length, 0);
  for (const name of ["submit_my_advertising_ad_for_review", "search_admin_advertising_ads", "admin_review_advertising_ad"]) {
    assert.match(`${foundation}\n${adminProjection}`, new RegExp(`create or replace function public\\.${name}\\s*\\(`, "i"));
  }
});

test("submission and moderation remain exact, idempotent and fingerprint guarded", () => {
  assert.match(foundation, /ads_ad_submission_fingerprint/i);
  assert.match(foundation, /advertising_ad_submission_changed/i);
  assert.match(foundation, /advertising_ad_review_idempotency_conflict/i);
  assert.match(foundation, /unique\s*\(ad_id,\s*idempotency_key\)/i);
  assert.match(foundation, /private\.ads_validate_creative_payload/i);
  assert.match(adminProjection, /join private\.advertising_creative_versions as version on version\.id = ad\.creative_version_id/i);
  assert.match(adminProjection, /'submission_fingerprint', ad\.submission_fingerprint/i);
});

test("capabilities and internal-note privacy remain server authorities", () => {
  assert.match(adminProjection, /admin_require_capability\('content\.items\.read'\)/i);
  assert.match(foundation, /admin_require_capability\('content\.items\.moderate'\)/i);
  const workspaceStart = foundation.search(/create or replace function public\.get_my_advertising_creative_workspace/i);
  const workspaceEnd = foundation.indexOf("create or replace function", workspaceStart + 50);
  const workspace = foundation.slice(workspaceStart, workspaceEnd);
  assert.match(workspace, /latest_rejection_message/i);
  assert.doesNotMatch(workspace, /'note'|actor_user_id/i);
  assert.match(adminProjection, /'note', latest\.note/i);
});

test("Business and Admin clients use the existing RPCs with coordinated keys", () => {
  assert.match(businessApi, /submit_my_advertising_ad_for_review/);
  assert.match(adminApi, /admin_review_advertising_ad/);
  assert.doesNotMatch(adminApi, /crypto\.randomUUID/);
  assert.match(adminCoordinator, /nelyon:admin:ads-review:/);
  assert.match(adminCoordinator, /navigator[\s\S]*locks/);
  assert.match(adminCoordinator, /SHA-256/);
  const storedRecord = adminCoordinator.slice(adminCoordinator.indexOf("type RecordState"), adminCoordinator.indexOf("function normalize"));
  assert.doesNotMatch(storedRecord, /note|auth|session|token/i);
});
