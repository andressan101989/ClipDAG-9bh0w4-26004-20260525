import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const runner = await readFile(
  new URL(
    "../scripts/prove-marketplace-fixture-finalization.mjs",
    import.meta.url,
  ),
  "utf8",
);

test("fixture database proof runner has a secure rollback-only contract", () => {
  assert.match(runner, /import \{ spawnSync \} from "node:child_process"/);
  assert.doesNotMatch(runner, /\brequire\s*\(/);
  assert.match(runner, /process\.env\.ComSpec/);
  assert.match(runner, /pathToFileURL/);
  assert.match(runner, /randomUUID\(\)\.toUpperCase\(\)/);
  assert.doesNotMatch(runner, /postgres(?:ql)?:\/\//i);
  assert.doesNotMatch(runner, /service[_-]?role[_-]?key/i);
  assert.doesNotMatch(runner, /password\s*:\s*["'][^"']+["']/i);
  assert.doesNotMatch(
    runner,
    /console\.(?:log|error)\([^\n]*(?:cli|captured|config)/i,
  );
});

test("fixture database proof covers both cases, retry, baselines, and reconciliation", () => {
  assert.match(runner, /fixture_cleanup_mixed_checkout_forbidden/);
  assert.match(runner, /remote_fixture_run_not_quarantined/);
  assert.match(runner, /fixture_only_result_invalid/);
  assert.match(runner, /retry_result_changed/);
  assert.match(runner, /retry_added_transactions/);
  assert.match(runner, /retry_added_ledger_entries/);
  assert.match(runner, /retry_added_cleanup_rows/);
  assert.match(runner, /rollbackCase/g);
  assert.match(runner, /await db\.query\("rollback"\)/);
  assert.match(runner, /order_items/);
  assert.match(runner, /proof_runs/);
  assert.match(runner, /rollback_global_counts_changed/);
  assert.match(runner, /reconcile_marketplace_payments/);
  assert.match(runner, /reconcile_marketplace_settlements/);
  assert.match(runner, /reconcile_marketplace_live_commissions/);
  assert.match(runner, /FIXTURE_PROOF_FAILED:/);
});
