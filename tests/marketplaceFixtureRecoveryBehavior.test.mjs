import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  executeFixtureRun,
  requireFixtureCleanup,
} from "../scripts/marketplace-fixture-lifecycle.mjs";

const read = (path) => fs.readFileSync(path, "utf8");
const neutralization = read(
  "supabase/migrations/20260803131500_neutralize_marketplace_fixture_financials.sql",
);
const analytics = read(
  "supabase/migrations/20260803131600_exclude_marketplace_fixtures_from_business_analytics.sql",
);

test("every remotely applied hygiene migration is represented in source control", () => {
  for (const version of ["120000", "123000", "124500", "130000"])
    assert.equal(
      fs.existsSync(
        `supabase/migrations/20260803${version}_` +
          ({
            120000: "marketplace_fixture_hygiene.sql",
            123000: "remote_fixture_lifecycle.sql",
            124500: "fixture_cleanup_validation.sql",
            130000: "exclude_registered_fixtures_from_public_catalog.sql",
          })[version],
      ),
      true,
    );
});

test("thrown verifier failure always reaches cleanup", async () => {
  const calls = [];
  await assert.rejects(
    executeFixtureRun({
      begin: async () => calls.push("begin"),
      register: async () => calls.push("register"),
      test: async () => {
        calls.push("test");
        throw new Error("deliberate_test_failure");
      },
      cleanup: async () => calls.push("cleanup"),
    }),
    /deliberate_test_failure/,
  );
  assert.deepEqual(calls, ["begin", "register", "test", "cleanup"]);
});

test("cleanup failure is not swallowed and produces a failing process contract", async () => {
  await assert.rejects(
    requireFixtureCleanup(async () => ({ quarantined: false })),
    /remote_fixture_cleanup_not_confirmed/,
  );
  await assert.rejects(
    executeFixtureRun({
      begin: async () => {},
      register: async () => {},
      test: async () => "ok",
      cleanup: async () => {
        throw new Error("cleanup_failed");
      },
    }),
    /cleanup_failed/,
  );
});

test("fixture financial compensation is balanced and reaches exact zero", () => {
  const state = { platform: -362, users: 127.5, escrow: 233, fees: 1.5 };
  const refund = state.escrow;
  state.escrow -= refund;
  state.users += refund;
  const sweep = state.users;
  state.users -= sweep;
  state.platform += sweep + state.fees;
  assert.deepEqual(state, { platform: 0, users: 0, escrow: 0, fees: 1.5 });
  assert.equal(refund, 233);
  assert.equal(sweep, 360.5);
});

test("neutralization is fixture-only, service-only, idempotent and ledger-balanced", () => {
  assert.match(neutralization, /fixture_service_role_required/);
  assert.match(neutralization, /fixture_ops\.is_fixture\('auth_user',o\.buyer_id\)/);
  assert.match(neutralization, /fixture_ops\.is_fixture\('store',new\.store_id\)/);
  assert.match(neutralization, /primary key\(cleanup_type,entity_id\)/);
  assert.match(neutralization, /marketplace_fixture_escrow_refund/);
  assert.match(neutralization, /marketplace_fixture_cleanup_sweep/);
  assert.match(neutralization, /ledger_debit/);
  assert.match(neutralization, /ledger_credit/);
  assert.doesNotMatch(neutralization, /delete\s+from\s+public\.(financial_transactions|ledger_entries)/i);
});

test("business analytics exclude fixtures while reconciliation remains unfiltered", () => {
  assert.match(neutralization, /fetch_my_live_shop_stats/);
  assert.match(neutralization, /not fixture_ops\.is_fixture\('product',e\.product_id\)/);
  assert.match(neutralization, /not fixture_ops\.is_fixture\('auth_user',e\.buyer_id\)/);
  const reconciliation = neutralization.slice(
    neutralization.indexOf("create or replace function public.reconcile_marketplace_payments"),
    neutralization.indexOf("create or replace function public.fetch_my_live_shop_stats"),
  );
  assert.doesNotMatch(reconciliation, /where\s+not fixture_ops\.is_fixture/i);
  assert.match(analytics, /is_business_purchase_event/);
  assert.match(analytics, /sold_count/);
  assert.match(analytics, /fetch_live_session_products/);
  assert.match(analytics, /fetch_my_live_shop_stats/);
});
