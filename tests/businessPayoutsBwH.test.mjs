import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync("supabase/migrations/20260917191915_business_payouts_bw_h.sql", "utf8");
const withdraw = fs.readFileSync("supabase/functions/bdag-withdraw/index.ts", "utf8");
const monitor = fs.readFileSync("supabase/functions/bdag-monitor/index.ts", "utf8");
const wallet = fs.readFileSync("app/(tabs)/wallet.tsx", "utf8");
const walletApi = fs.readFileSync("services/walletApi.ts", "utf8");
const conversion = fs.readFileSync("services/conversionEngine.ts", "utf8");
const bdagService = fs.readFileSync("services/bdagService.ts", "utf8");

test("BW-H keeps the single withdrawal table and worker", () => {
  assert.doesNotMatch(migration, /create\s+table/i);
  assert.match(migration, /alter table public\.withdrawal_requests/i);
  assert.match(withdraw, /functions\/v1\/bdag-monitor/);
  assert.match(monitor, /complete_withdrawal_settlement/);
  assert.match(monitor, /refund_withdrawal_to_ledger/);
});

test("new request accounting uses one financial transaction for all balanced legs", () => {
  assert.match(migration, /'withdrawal'.*'completed'/s);
  assert.match(migration, /ledger_debit\(\s*v_fin_txn_id\s*,\s*v_user_account\s*,\s*v_gross/s);
  assert.match(migration, /ledger_credit\(\s*v_fin_txn_id\s*,\s*v_escrow_account\s*,\s*v_net/s);
  assert.match(migration, /ledger_credit\(\s*v_fin_txn_id\s*,\s*v_platform_account\s*,\s*v_fee/s);
  assert.match(migration, /'withdrawal_request',v_withdrawal_id::text/);
});

test("canonical refund and settlement are independently auditable and idempotent", () => {
  assert.match(migration, /operation_type.*withdrawal_refund/s);
  assert.match(migration, /refund_fin_txn_id=v_refund_txn_id/);
  assert.match(migration, /ledger_debit\(v_refund_txn_id,v_platform_account,v_withdrawal\.fee_bdag/);
  assert.match(migration, /operation_type.*withdrawal_settlement/s);
  assert.match(migration, /settlement_fin_txn_id=v_settlement_txn_id/);
  assert.match(migration, /v_escrow_account,null,v_withdrawal\.net_bdag/);
});

test("legacy compatibility never invents a historical platform fee leg", () => {
  assert.match(migration, /v_is_canonical := v_withdrawal\.request_fingerprint is not null/);
  const legacy = migration.slice(migration.indexOf("-- Legacy holds"), migration.indexOf("return jsonb_build_object", migration.indexOf("-- Legacy holds")));
  assert.doesNotMatch(legacy, /v_platform_account/);
  assert.match(legacy, /legacy withdrawal refund/);
});

test("financial mutations are service-role only while business history is capability scoped", () => {
  for (const signature of [
    "request_withdrawal_from_ledger", "refund_withdrawal_to_ledger", "complete_withdrawal_settlement", "reconcile_withdrawal_escrow",
  ]) assert.match(migration, new RegExp(`grant execute on function public\\.${signature}[^;]* to service_role`, "is"));
  assert.match(migration, /business\.payouts\.read/);
  assert.match(migration, /business\.payouts\.manage/);
  assert.match(migration, /grant execute on function public\.search_my_business_payouts[^;]* to authenticated/is);
  assert.match(migration, /set search_path=''/g);
});

test("config and quote are server-driven and use the canonical stablecoin registry", () => {
  assert.match(withdraw, /action === 'config'/);
  assert.match(withdraw, /action === 'quote'/);
  assert.match(withdraw, /STABLECOINS\.map/);
  assert.match(withdraw, /get_withdrawal_config/);
  assert.match(withdraw, /BDAG_PER_USD/);
  assert.match(withdraw, /bdagUnitsToStablecoinUnits\(netUnits, rail\.decimals\)/);
  assert.match(withdraw, /value \* stablecoinScale.*BDAG_PER_USD.*BDAG_SCALE/s);
  assert.doesNotMatch(withdraw, /const MIN_WITHDRAWAL_BDAG|const WITHDRAWAL_FEE/);
});

test("mobile no longer presents the stale five-percent or one-BDAG policies", () => {
  assert.doesNotMatch(wallet, /WITHDRAWAL_FEE_PERCENT|MIN_WITHDRAWAL_AMOUNT/);
  assert.doesNotMatch(conversion, /WITHDRAWAL_FEE_PERCENT|applyWithdrawalFee/);
  assert.doesNotMatch(bdagService, /MIN_WITHDRAWAL_BDAG\s*=\s*1|PLATFORM_FEE_PERCENT\s*=\s*5/);
  assert.match(walletApi, /getWithdrawalConfigFromBackend/);
  assert.match(walletApi, /getWithdrawalQuoteFromBackend/);
});

test("request idempotency is UUID scoped and retries cannot rebroadcast", () => {
  assert.match(migration, /p_idempotency_key uuid/);
  assert.match(migration, /withdrawal_idempotency_conflict/);
  assert.ok(withdraw.indexOf("existingByKey") < withdraw.indexOf("Cooldown check"));
  assert.match(withdraw, /if \(rpcData\.idempotent\)/);
  assert.match(withdraw, /never broadcasts a[\s\S]*second blockchain transfer/);
});
