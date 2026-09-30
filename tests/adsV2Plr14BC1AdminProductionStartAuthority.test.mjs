import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const migrationDirectory = new URL("supabase/migrations/", root);
const migrationNames = readdirSync(migrationDirectory)
  .filter((name) => name.endsWith(".sql"))
  .sort();
const migrationName = migrationNames.find((name) =>
  name.endsWith("_ads_v2_plr_14b_c1_admin_production_start_authority.sql"),
);

assert.ok(migrationName, "PLR-14B-C1 migration must exist");
const sql = readFileSync(new URL(`supabase/migrations/${migrationName}`, root), "utf8");
const adminApi = readFileSync(
  new URL("apps/admin-web/src/lib/adminAdvertisingApi.ts", root),
  "utf8",
);

function latestFunctionDefinition(functionName) {
  let definition = "";
  for (const name of migrationNames) {
    const source = readFileSync(new URL(`supabase/migrations/${name}`, root), "utf8");
    const marker = `create or replace function public.${functionName}(`;
    const start = source.toLowerCase().lastIndexOf(marker);
    if (start === -1) continue;
    const end = source.indexOf("\n$$;", start);
    assert.notEqual(end, -1, `${functionName} definition must terminate with $$;`);
    definition = source.slice(start, end + 4);
  }
  assert.notEqual(definition, "", `${functionName} must exist`);
  return definition;
}

test("PLR-14B-C1 is one transactional forward migration with no schema or finance expansion", () => {
  assert.match(sql, /^begin;/im);
  assert.match(sql, /commit;\s*$/im);
  assert.doesNotMatch(sql, /\b(?:create|alter|drop)\s+table\b/i);
  assert.doesNotMatch(sql, /\b(?:insert|update|delete)\s+(?:into\s+)?(?:public\.)?(?:financial_transactions|ledger_entries|advertising_campaign_finance)\b/i);
  assert.equal(
    (sql.match(/create or replace function public\.set_admin_advertising_launch_mode_v1\s*\(/gi) ?? []).length,
    1,
  );
  assert.equal((sql.match(/create or replace function public\.set_advertising_launch_mode_v2\s*\(/gi) ?? []).length, 0);
});

test("the admin bridge derives the actor, requires rollout.manage and accepts only Production or Disarmed", () => {
  const wrapper = latestFunctionDefinition("set_admin_advertising_launch_mode_v1");
  assert.match(wrapper, /security definer/i);
  assert.match(wrapper, /set search_path\s*=\s*''/i);
  assert.match(wrapper, /admin_require_capability\('advertising\.rollout\.manage'\)/i);
  assert.match(wrapper, /p_launch_mode\s+is\s+null\s+or\s+p_launch_mode\s+not\s+in\s*\(\s*'PRODUCTION'\s*,\s*'DISARMED'\s*\)/i);
  assert.doesNotMatch(wrapper, /p_(?:actor|user)_id/i);
  assert.match(wrapper, /set_config\('request\.jwt\.claim\.role'\s*,\s*'authenticated'\s*,\s*true\)/i);
  assert.match(wrapper, /set_advertising_launch_mode_v2\s*\(/i);
  assert.match(wrapper, /advertising_admin_launch_transition_invalid/i);
  assert.match(wrapper, /advertising_canary_policy[\s\S]*for update/i);
  assert.match(wrapper, /exception\s+when\s+others[\s\S]*set_config/i);
});

test("the internal launch RPC keeps its authority guard and canonical admin audit path", () => {
  const internal = latestFunctionDefinition("set_advertising_launch_mode_v2");
  assert.match(internal, /advertising_internal_authority_required/i);
  assert.match(internal, /admin_require_capability\('advertising\.rollout\.manage'\)/i);
  assert.match(internal, /advertising_admin_launch_mode_forbidden/i);
  assert.match(internal, /'v1\|admin\|advertising\|launch_mode\.transition'/i);
  assert.match(internal, /'human_admin'/i);
});

test("ACL exposes only the admin bridge to authenticated browsers", () => {
  assert.match(
    sql,
    /revoke all on function public\.set_advertising_launch_mode_v2\([\s\S]*?from public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.set_advertising_launch_mode_v2\([\s\S]*?to service_role/i,
  );
  assert.match(
    sql,
    /revoke all on function public\.set_admin_advertising_launch_mode_v1\([\s\S]*?from public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.set_admin_advertising_launch_mode_v1\([\s\S]*?to authenticated/i,
  );
});

test("Admin Web calls only the administrative bridge", () => {
  assert.match(
    adminApi,
    /rpc\("set_admin_advertising_launch_mode_v1"\s*,\s*\{p_launch_mode:mode,p_idempotency_key:idempotencyKey\}\)/,
  );
  assert.doesNotMatch(adminApi, /rpc\("set_advertising_launch_mode_v2"/);
});
