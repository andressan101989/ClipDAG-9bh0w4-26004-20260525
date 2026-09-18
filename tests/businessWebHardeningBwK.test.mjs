import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260918132900_business_web_production_hardening_bw_k.sql", import.meta.url),
  "utf8",
);
const migrations = readFileSync(
  new URL("../supabase/migrations/20260918045352_business_unified_analytics_bw_i.sql", import.meta.url),
  "utf8",
);

test("Team protected capability metadata and enforcement use one private authority", () => {
  assert.match(migration, /private\.business_team_protected_capabilities\(\)/);
  assert.match(migration, /catalog\.code = any\(private\.business_team_protected_capabilities\(\)\)/);
  assert.match(migration, /v_protected text\[\] := private\.business_team_protected_capabilities\(\)/);
  assert.doesNotMatch(migration, /v_protected constant text\[\]/);
  assert.doesNotMatch(migration, /catalog\.code = any\(array\[/);
});

test("hardening does not replace Analytics or introduce a parallel financial authority", () => {
  assert.match(migrations, /get_my_business_analytics/);
  assert.doesNotMatch(migration, /create table (?:public|private)\.(?:ledger|wallet|escrow|analytics)/i);
});
