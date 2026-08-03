import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { requireFixtureFinalization } from "../scripts/marketplace-fixture-lifecycle.mjs";

const migration = fs.readFileSync(
  "supabase/migrations/20260803131900_harden_remote_fixture_finalization.sql",
  "utf8",
);
const verifiers = [
  "verify-mkt-a3d2-multiseller.mjs",
  "verify-mkt-a3d2-remote-settlement.mjs",
  "verify-mkt-a4a-remote.mjs",
  "verify-mkt-a4b-remote.mjs",
].map((f) => fs.readFileSync(`scripts/${f}`, "utf8"));
const result = {
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

test("run identity is composite and collisions never overwrite suites", () => {
  assert.match(migration, /primary key\(fixture_suite,fixture_run_id\)/);
  assert.match(
    migration,
    /on conflict\(fixture_suite,fixture_run_id\)do nothing/,
  );
  assert.match(migration, /fixture_run_identity_collision/);
  assert.doesNotMatch(migration, /do update set fixture_suite/);
});
test("all verifier run ids include suite timestamp and random UUID suffix", () => {
  for (const source of verifiers) {
    assert.match(source, /FIXTURE_SUITE/);
    assert.match(source, /Date\.now\(\)\.toString\(36\)/);
    assert.match(
      source,
      /randomUUID|uuid\(\)\.slice|uid\(\)\.slice|id\(\)\.slice/,
    );
  }
});
test("root discovery uses only exact suite and run email contracts", () => {
  assert.match(migration, /register_fixture_run_roots/);
  assert.match(migration, /p_fixture_run_id\|\|'@example\.invalid'/);
  assert.doesNotMatch(migration, /%@example\.invalid/);
});
test("mixed checkout cancellation is rejected before release", () => {
  const guard = migration.indexOf("fixture_cleanup_mixed_checkout_forbidden"),
    release = migration.indexOf(
      "neutralize_marketplace_fixture_run",
      migration.indexOf(
        "create or replace function public.finalize_marketplace_fixture_run",
      ),
    );
  assert.ok(guard > 0 && release > guard);
  assert.match(migration, /marketplace_order_items/);
  assert.match(migration, /marketplace_inventory_reservations/);
});
test("failed finalization persists a sanitized cleanup_failed result", () => {
  assert.match(migration, /status='cleanup_failed',cleaned_at=null/);
  assert.match(migration, /failure_code/);
  assert.doesNotMatch(migration, /sqlerrm::text/);
});
test("finalization rejects stale suite run status and failures", async () => {
  assert.deepEqual(
    await requireFixtureFinalization(async () => result, {
      fixtureSuite: "mkt-a4b",
      fixtureRunId: "run-a",
    }),
    result,
  );
  await assert.rejects(
    requireFixtureFinalization(
      async () => ({ ...result, fixture_suite: "mkt-a4a" }),
      { fixtureSuite: "mkt-a4b", fixtureRunId: "run-a" },
    ),
    /suite_mismatch/,
  );
  await assert.rejects(
    requireFixtureFinalization(async () => ({
      ...result,
      status: "cleanup_failed",
      failure_code: "fixture_finalization_failed",
    })),
    /not_quarantined/,
  );
});
test("actual verifier entrypoints preserve original failure as cause", () => {
  for (const source of verifiers) {
    assert.match(source, /testFailure\s*=\s*error/);
    assert.match(source, /finalizationFailure\.cause\s*=\s*testFailure/);
    assert.match(source, /throw finalizationFailure/);
  }
});
test("A3D2 signup occurs inside protected try", () => {
  assert.match(verifiers[0], /try \{\s*const \{ buyer, sellerA, sellerB, fixture \} = await setup\(\)/);
  assert.match(verifiers[1], /try \{\s*const buyer = await signup\("buyer"\)/);
});
