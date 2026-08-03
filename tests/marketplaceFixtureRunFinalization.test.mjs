import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  executeFixtureRun,
  requireFixtureFinalization,
} from "../scripts/marketplace-fixture-lifecycle.mjs";

const migration = fs.readFileSync(
  "supabase/migrations/20260803131700_finalize_remote_marketplace_fixture_runs.sql",
  "utf8",
);
const zero = {
  quarantined: true,
  financial_neutralized: true,
  status: "quarantined",
  fixture_suite: "mkt-a4b",
  fixture_run_id: "run-a",
  products_active: 0,
  stores_active: 0,
  sessions_live: 0,
  pins_active: 0,
  offers_active: 0,
  fixture_user_spendable: 0,
  fixture_attributable_escrow: 0,
  active_reservations: 0,
  unresolved_allocations: 0,
  net_platform_impact: 0,
};

test("historical neutralization migration remains represented", () => {
  assert.equal(
    fs.existsSync(
      "supabase/migrations/20260803131500_neutralize_marketplace_fixture_financials.sql",
    ),
    true,
  );
});

test("quarantine-only and financial-only results are rejected", async () => {
  await assert.rejects(
    requireFixtureFinalization(async () => ({
      ...zero,
      financial_neutralized: false,
    })),
    /financial_neutralization/,
  );
  await assert.rejects(
    requireFixtureFinalization(async () => ({ ...zero, quarantined: false })),
    /quarantine/,
  );
});

test("validation order distinguishes missing identity status quarantine and finance", async () => {
  await assert.rejects(
    requireFixtureFinalization(async () => null),
    /quarantine_not_confirmed/,
  );
  await assert.rejects(
    requireFixtureFinalization(async () => zero, { fixtureSuite: "mkt-a4a" }),
    /suite_mismatch/,
  );
  await assert.rejects(
    requireFixtureFinalization(async () => zero, {
      fixtureRunId: "another-run",
    }),
    /run_id_mismatch/,
  );
  const cleanupFailedResult = {
    quarantined: false,
    financial_neutralized: false,
    status: "cleanup_failed",
    fixture_suite: "mkt-a4b",
    fixture_run_id: "mkt-a4b-proof-run",
    failure_code: "fixture_cleanup_mixed_checkout_forbidden",
  };
  await assert.rejects(
    requireFixtureFinalization(async () => cleanupFailedResult, {
      fixtureSuite: "mkt-a4b",
      fixtureRunId: "mkt-a4b-proof-run",
    }),
    /remote_fixture_run_not_quarantined/,
  );
  await assert.rejects(
    requireFixtureFinalization(async () => ({ ...zero, quarantined: false })),
    /remote_fixture_quarantine_not_confirmed/,
  );
  await assert.rejects(
    requireFixtureFinalization(async () => ({
      ...zero,
      financial_neutralized: false,
    })),
    /remote_fixture_financial_neutralization_not_confirmed/,
  );
});

test("only a complete all-zero finalization result is accepted", async () => {
  assert.deepEqual(await requireFixtureFinalization(async () => zero), zero);
  for (const field of [
    "products_active",
    "fixture_user_spendable",
    "fixture_attributable_escrow",
    "active_reservations",
    "unresolved_allocations",
    "net_platform_impact",
  ])
    await assert.rejects(
      requireFixtureFinalization(async () => ({ ...zero, [field]: 1 })),
      new RegExp(field),
    );
});

test("test and finalization failures are both preserved", async () => {
  await assert.rejects(
    executeFixtureRun({
      begin: async () => {},
      register: async () => {},
      test: async () => {
        throw new Error("original-test-failure");
      },
      cleanup: async () => {
        throw new Error("finalization-failure");
      },
    }),
    (error) =>
      error.message === "finalization-failure" &&
      error.cause?.message === "original-test-failure",
  );
});

test("database finalizer is run-scoped, locked, private and idempotent", () => {
  assert.match(
    migration,
    /fixture_financial_exposure\(p_fixture_suite text,p_fixture_run_id text\)/,
  );
  assert.match(
    migration,
    /fixture_suite=p_fixture_suite and fixture_run_id=p_fixture_run_id/g,
  );
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /if result is not null then return result/);
  assert.match(
    migration,
    /revoke all on function public\.finalize_marketplace_fixture_run.*public,anon,authenticated/,
  );
  assert.match(
    migration,
    /grant execute on function public\.finalize_marketplace_fixture_run.*service_role/,
  );
});

test("reservation, held allocation and fixture account teardown are authoritative", () => {
  assert.match(
    migration,
    /marketplace_release_checkout\(c\.checkout_id,'cancelled'/,
  );
  assert.match(migration, /marketplace_fixture_escrow_refund/);
  assert.match(migration, /status='refunded',refunded_at=now\(\)/);
  assert.match(migration, /marketplace_fixture_cleanup_sweep/);
  assert.match(migration, /creator_commissions_released/);
  assert.match(migration, /seller_net_released/);
  assert.doesNotMatch(
    migration,
    /delete\s+from\s+public\.(financial_transactions|ledger_entries|marketplace_order_settlements)/i,
  );
});

test("cleanup transactions are deterministic, unique and balanced", () => {
  assert.match(
    migration,
    /'fixture-refund:'\|\|p_fixture_suite\|\|':'\|\|p_fixture_run_id\|\|':'\|\|a\.id/,
  );
  assert.match(
    migration,
    /'fixture-sweep:'\|\|p_fixture_suite\|\|':'\|\|p_fixture_run_id\|\|':'\|\|acct\.id/,
  );
  assert.match(migration, /cleanup_ledger_debits/);
  assert.match(migration, /v_debits<>v_credits/);
});

test("all four verifiers invoke the atomic finalizer", () => {
  for (const file of [
    "verify-mkt-a3d2-multiseller.mjs",
    "verify-mkt-a3d2-remote-settlement.mjs",
    "verify-mkt-a4a-remote.mjs",
    "verify-mkt-a4b-remote.mjs",
  ]) {
    const source = fs.readFileSync(`scripts/${file}`, "utf8");
    assert.match(source, /finalize_marketplace_fixture_run/);
    assert.doesNotMatch(source, /marketplace_fixture_lifecycle[^\n]+cleanup/);
  }
});

test("nonfixture protection follows exact registered ownership", () => {
  assert.doesNotMatch(
    migration,
    /title\s+(like|~)|description\s+(like|~)|sku\s+(like|~)/i,
  );
  assert.match(migration, /fixture_cleanup_nonfixture_buyer/);
  assert.match(
    migration,
    /entity_type='auth_user'.*fixture_suite=p_fixture_suite and fixture_run_id=p_fixture_run_id/,
  );
});
