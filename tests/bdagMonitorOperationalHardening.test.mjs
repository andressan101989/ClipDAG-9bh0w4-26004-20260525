import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import {
  isMonitorAuthorized,
  MonitorStepError,
  monitorHttpResult,
  requireMonitorResult,
  sanitizeMonitorMessage,
} from "../supabase/functions/_shared/monitorContract.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const monitor = read("supabase/functions/bdag-monitor/index.ts");
const ledger = read("supabase/functions/bdag-ledger/index.ts");
const architecture = read("services/financial/ARCHITECTURE.ts");
const migrationContract = read("scripts/migration_to_supabase.sql");

const staleRpcNames = [
  "refund_expired_premium_dms",
  "run_reconciliation_check",
  "cleanup_expired_idempotency_keys",
];

test("monitor removes all stale RPC calls without replacement or skipped noise", () => {
  for (const name of staleRpcNames) assert.doesNotMatch(monitor, new RegExp(name));
  for (const resultKey of ["dm_refunds", "reconciliation", "idempotency_cleaned", "skipped"])
    assert.doesNotMatch(monitor, new RegExp(resultKey));
  assert.match(monitor, /cleanup_stale_velocity_counters/);
  assert.match(monitor, /refund_withdrawal_to_ledger/);
  assert.doesNotMatch(monitor, /reconcile_marketplace_/);
});

test("required Supabase success produces the canonical HTTP 200 result", async () => {
  assert.deepEqual(await requireMonitorResult("required_step", async () => ({ data: 7, error: null })), 7);
  assert.deepEqual(monitorHttpResult(null, { required_step: 7 }), {
    status: 200,
    body: { success: true, results: { required_step: 7 } },
  });
  assert.match(monitor, /status: outcome\.status/);
});

test("required Supabase failure is structured, sanitized and non-2xx", async () => {
  let failure;
  try {
    await requireMonitorResult("load_withdrawals", async () => ({
      data: null,
      error: { message: "Authorization: top-secret\nquery failed" },
    }));
  } catch (error) {
    failure = error;
  }
  assert.ok(failure instanceof MonitorStepError);
  const outcome = monitorHttpResult(failure, { completed_step: true });
  assert.equal(outcome.status, 500);
  assert.equal(outcome.body.success, false);
  assert.equal(outcome.body.error.step, "load_withdrawals");
  assert.doesNotMatch(outcome.body.error.message, /top-secret|\n/);
  assert.deepEqual(outcome.body.results, { completed_step: true });
});

test("monitor authentication accepts only exact internal secrets and never logs a prefix", () => {
  assert.equal(isMonitorAuthorized("monitor", "monitor", "dispatch", "service"), true);
  assert.equal(isMonitorAuthorized("Bearer dispatch", "monitor", "dispatch", "service"), true);
  assert.equal(isMonitorAuthorized("Bearer service", "monitor", "dispatch", "service"), true);
  assert.equal(isMonitorAuthorized("monitor-extra", "monitor", "dispatch", "service"), false);
  assert.equal(isMonitorAuthorized("", "", "", ""), false);
  assert.doesNotMatch(monitor, /secret_prefix|console\.(log|error)\([^\n]*(secret|token|authorization)/i);
  assert.equal(sanitizeMonitorMessage("Bearer abcdef token=secret"), "Bearer [redacted] token=[redacted]");
});

test("every retained Supabase monitor operation is audited through an error check", () => {
  assert.match(monitor, /requireMonitorResult\('load_provisional_deposits'/);
  assert.match(monitor, /requireMonitorResult\('load_broadcasted_withdrawals'/);
  assert.match(monitor, /requireMonitorResult\('load_abandoned_withdrawals'/);
  assert.match(monitor, /requireMonitorResult\('load_expired_withdrawals'/);
  assert.match(monitor, /requireMonitorResult\('cleanup_stale_velocity_counters'/);
  assert.match(monitor, /completionError \|\| !completion\?\.success/);
  assert.doesNotMatch(monitor, /await admin\.from\([^\n]+\)(?![\s\S]{0,80}error)/);
});

test("unconsumed ledger maintenance actions are removed without touching valid finance actions", () => {
  assert.doesNotMatch(ledger, /action === ['"]reconcile['"]|action === ['"]refund_expired_dms['"]/);
  assert.doesNotMatch(ledger, /run_reconciliation_check|refund_expired_premium_dms|RECONCILE_SECRET/);
  for (const action of [
    "transfer", "purchase", "subscribe", "gift", "boost", "balance",
    "marketplace_checkout_pay", "marketplace_order_confirm_delivery",
    "premium_dm_send", "premium_dm_release",
  ]) assert.match(ledger, new RegExp(`action === ['\"]${action}['\"]`));
});

test("documentation describes deployed monitor reality without claiming auto-correction", () => {
  assert.match(architecture, /no generic run_reconciliation_check/);
  assert.match(architecture, /does not auto-correct balances/);
  assert.match(architecture, /idempotency keys are not/);
  assert.match(architecture, /Premium DM remains a separate incomplete module/);
  assert.doesNotMatch(architecture, /Automated reconciliation \+ auto-fix/);
  for (const name of staleRpcNames) assert.doesNotMatch(migrationContract, new RegExp(name));
});

test("correction adds no migration, RPC, table or client-side financial authority", () => {
  const migrationNames = readdirSync(new URL("../supabase/migrations", import.meta.url))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const visualRealtimeMigrationName =
    "20260830195917_live_battles_lb4_f4d_c_visual_realtime.sql";
  assert.ok(migrationNames.includes(visualRealtimeMigrationName));
  assert.equal(
    migrationNames.at(-1),
    "20260831023739_live_battles_lb4_f5_a_rematch_series_authority.sql",
  );
  assert.doesNotMatch(monitor, /create (table|function)|atomic_ledger_transfer/i);
  assert.equal((monitor.match(/admin\.rpc\('ledger_debit'/g) ?? []).length, 1);
  assert.match(monitor, /reverseProvisionalCredit[\s\S]*admin\.rpc\('ledger_debit'/);
  assert.doesNotMatch(ledger, /create (table|function)/i);
});
