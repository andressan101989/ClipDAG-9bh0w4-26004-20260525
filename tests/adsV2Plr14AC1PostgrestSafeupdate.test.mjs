import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const migrationDirectory = new URL("supabase/migrations/", root);
const migrationNames = readdirSync(migrationDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const canonicalCodes = [
  "social_feed",
  "clips",
  "stories",
  "live",
  "marketplace_home",
  "marketplace_search",
];

function latestFunctionDefinition(functionName) {
  let definition = "";
  for (const migrationName of migrationNames) {
    const sql = readFileSync(new URL(`supabase/migrations/${migrationName}`, root), "utf8");
    const marker = `create or replace function public.${functionName}(`;
    const start = sql.toLowerCase().lastIndexOf(marker);
    if (start === -1) continue;
    const end = sql.indexOf("\n$$;", start);
    assert.notEqual(end, -1, `${functionName} definition must terminate with $$;`);
    definition = sql.slice(start, end + 4);
  }
  assert.notEqual(definition, "", `${functionName} must exist`);
  return definition;
}

function placementCatalogUpdates(definition) {
  return definition.match(
    /update\s+private\.advertising_placement_catalog\b[\s\S]*?;/gi,
  ) ?? [];
}

function hasCanonicalPlacementPredicate(statement) {
  if (!/\bwhere\b/i.test(statement)) return false;
  return canonicalCodes.every((code) => statement.includes(`'${code}'`));
}

function updateStatements(definition) {
  return definition.match(/^\s*update\s+[a-z_][a-z0-9_.]*(?:\s+[a-z_][a-z0-9_]*)?\s+set\b[\s\S]*?;/gim) ?? [];
}

test("C1 is one transactional forward migration that only replaces the two canonical RPCs", () => {
  const names = migrationNames.filter((name) =>
    name.endsWith("_ads_v2_plr_14a_c1_postgrest_safeupdate.sql"),
  );
  assert.equal(names.length, 1);
  const sql = readFileSync(new URL(`supabase/migrations/${names[0]}`, root), "utf8");
  assert.match(sql, /^begin;/im);
  assert.match(sql, /commit;\s*$/im);
  assert.equal(
    (sql.match(/create or replace function public\.set_admin_advertising_production_rollout_v1\s*\(/gi) ?? []).length,
    1,
  );
  assert.equal(
    (sql.match(/create or replace function public\.set_advertising_launch_mode_v2\s*\(/gi) ?? []).length,
    1,
  );
  assert.doesNotMatch(sql, /\b(?:create|alter|drop)\s+table\b/i);
  assert.doesNotMatch(sql, /\b(?:grant|revoke)\b/i);
});

test("rollout mutation bounds both placement-catalog updates", () => {
  const definition = latestFunctionDefinition("set_admin_advertising_production_rollout_v1");
  const updates = placementCatalogUpdates(definition);
  assert.equal(updates.length, 2);
  assert.match(updates[0], /where\s+placement\.code\s*=\s*item\.code/i);
  assert.equal(hasCanonicalPlacementPredicate(updates[1]), true);
});

test("launch mutation bounds its placement-catalog update to the exact six-code domain", () => {
  const definition = latestFunctionDefinition("set_advertising_launch_mode_v2");
  const updates = placementCatalogUpdates(definition);
  assert.equal(updates.length, 1);
  assert.equal(hasCanonicalPlacementPredicate(updates[0]), true);
});

test("corrected canonical functions retain definer security, locked search_path and existing gates", () => {
  const rollout = latestFunctionDefinition("set_admin_advertising_production_rollout_v1");
  const launch = latestFunctionDefinition("set_advertising_launch_mode_v2");
  for (const definition of [rollout, launch]) {
    assert.match(definition, /security definer/i);
    assert.match(definition, /set search_path\s*=\s*''/i);
  }
  assert.match(rollout, /admin_require_capability\('advertising\.rollout\.manage'\)/i);
  assert.match(rollout, /advertising_rollout_config_version_stale/i);
  assert.match(rollout, /admin_idempotency_conflict/i);
  assert.match(launch, /advertising_admin_launch_mode_forbidden/i);
  assert.match(launch, /p_placement_code<>'social_feed'/i);
  assert.match(launch, /advertising_active_canary_billing_refresh_invalid/i);
});

test("every UPDATE in both corrected RPCs has an intentional domain predicate", () => {
  const rollout = latestFunctionDefinition("set_admin_advertising_production_rollout_v1");
  const launch = latestFunctionDefinition("set_advertising_launch_mode_v2");
  const rolloutUpdates = updateStatements(rollout);
  const launchUpdates = updateStatements(launch);
  assert.equal(rolloutUpdates.length, 3);
  assert.equal(launchUpdates.length, 6);
  for (const statement of [...rolloutUpdates, ...launchUpdates]) {
    assert.match(statement, /\bwhere\b/i);
  }
  assert.doesNotMatch(`${rollout}\n${launch}`, /^\s*delete\s+from\b/gim);
});
