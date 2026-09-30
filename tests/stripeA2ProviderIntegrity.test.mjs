import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseTopupRequest, usdCentsToBdag } from "../supabase/functions/_shared/stripeBilling.ts";

const migrationName = fs.readdirSync("supabase/migrations")
  .find((name) => name.endsWith("_stripe_a2_provider_integrity_financial_reversals.sql"));
assert.ok(migrationName, "STRIPE-A2 migration must exist");
const migration = fs.readFileSync(path.join("supabase/migrations", migrationName), "utf8");
const checkout = fs.readFileSync("supabase/functions/stripe-bdag-checkout/index.ts", "utf8");
const webhook = fs.readFileSync("supabase/functions/stripe-webhook/index.ts", "utf8");
const billing = fs.readFileSync("supabase/functions/_shared/stripeBilling.ts", "utf8");
const browserApi = fs.readFileSync("apps/business-web/src/lib/businessBillingApi.ts", "utf8");

test("database derives the Stripe economic snapshot and rejects manipulated values", () => {
  assert.match(migration, /create or replace function private\.stripe_bdag_per_usd\(\)/i);
  assert.match(migration, /select 100\.00000000::numeric/i);
  assert.match(migration, /v_bdag\s*:=\s*round\(v_amount::numeric\s*\*\s*v_rate\s*\/\s*100/i);
  assert.match(migration, /stripe_topup_rate_mismatch/);
  assert.match(migration, /stripe_topup_bdag_mismatch/);
  const preparePayload = checkout.slice(checkout.indexOf('p_action: "prepare_checkout"'), checkout.indexOf('}) as RpcResult'));
  assert.doesNotMatch(preparePayload, /usd_to_bdag_rate/);
  assert.doesNotMatch(preparePayload, /bdag_amount/);
  assert.match(billing, /BDAG_PER_USD/);
});

test("integer-cent boundaries and conversion are exact", () => {
  const key = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(parseTopupRequest({ amount_usd_cents: 50, idempotency_key: key }), { amountUsdCents: 50, idempotencyKey: key });
  assert.deepEqual(parseTopupRequest({ amount_usd_cents: 99_999_999, idempotency_key: key }), { amountUsdCents: 99_999_999, idempotencyKey: key });
  assert.equal(usdCentsToBdag(50), 50);
  assert.equal(usdCentsToBdag(99_999_999), 99_999_999);
  assert.throws(() => parseTopupRequest({ amount_usd_cents: 49, idempotency_key: key }), /invalid_amount_usd_cents/);
  assert.throws(() => parseTopupRequest({ amount_usd_cents: 100_000_000, idempotency_key: key }), /invalid_amount_usd_cents/);
  assert.throws(() => parseTopupRequest({ amount_usd_cents: 50.5, idempotency_key: key }), /invalid_amount_usd_cents/);
});

test("credit binds the exact success event, top-up and provider identifiers", () => {
  assert.match(migration, /v_event\.topup_id is distinct from p_topup_id/i);
  assert.match(migration, /v_event\.stripe_checkout_session_id\s+is distinct from\s+p_stripe_checkout_session_id/i);
  assert.match(migration, /v_event\.stripe_payment_intent_id\s+is distinct from\s+p_stripe_payment_intent_id/i);
  assert.match(migration, /v_topup\.status not in \('created','checkout_open','paid'\)/i);
  assert.match(migration, /stripe_credit_state_invalid/);
  assert.match(migration, /stripe_credit_event_binding_mismatch/);
});

test("provider facts are monotonic and refund/dispute adjustments use canonical ledger", () => {
  assert.match(migration, /refund_required_bdag/i);
  assert.match(migration, /dispute_required_bdag/i);
  assert.match(migration, /pending_reversal_bdag/i);
  assert.match(migration, /public\.apply_stripe_bdag_adjustment/i);
  assert.match(migration, /public\.ledger_debit/i);
  assert.match(migration, /public\.ledger_credit/i);
  assert.match(migration, /stripe_bdag_(?:refund|dispute)_reversal/i);
  assert.match(migration, /pending_insufficient_funds/i);
  assert.match(migration, /refund_required_bdag\s*\+\s*dispute_required_bdag/i);
  assert.match(migration, /stripe_legacy_webhook_evidence_requires_review/i);
  assert.match(migration, /v_incoming_dispute_rank\s*<=\s*v_current_dispute_rank/i);
  assert.match(webhook, /charge\.dispute\.funds_withdrawn/);
  assert.match(webhook, /charge\.dispute\.funds_reinstated/);
  assert.match(webhook, /charge\.dispute\.closed/);
});

test("test/live isolation is enforced at both Edge and database boundaries", () => {
  assert.match(webhook, /event\.livemode\s*!==\s*false/);
  assert.match(webhook, /stripe_mode_mismatch/);
  assert.match(migration, /v_livemode is distinct from false[\s\S]*stripe_mode_mismatch/i);
  assert.match(migration, /p_livemode is distinct from false[\s\S]*stripe_mode_mismatch/i);
});

test("Stripe reconciliation exposes every A2 integrity class without mutating data", () => {
  assert.match(migration, /create or replace function public\.reconcile_stripe_bdag_finance\(\)/i);
  assert.match(migration, /language sql[\s\S]*stable[\s\S]*security definer/i);
  for (const finding of [
    "credited_without_financial_transaction",
    "stripe_transaction_without_topup",
    "topup_transaction_amount_mismatch",
    "missing_credit_ledger_entry",
    "adjustment_transaction_authority_mismatch",
    "missing_adjustment_ledger_entry",
    "webhook_linked_to_wrong_topup",
    "unresolved_webhook_event",
    "duplicate_payment_intent",
    "duplicate_checkout_session",
    "test_live_mismatch",
    "refund_reversal_amount_mismatch",
    "economically_unreconciled_refund_or_dispute",
    "pending_reversal_insufficient_funds",
    "snapshot_formula_mismatch",
    "impossible_credited_status",
  ]) assert.match(migration, new RegExp(`'${finding}'`));
  assert.match(migration, /grant execute on function public\.reconcile_stripe_bdag_finance\(\) to service_role/i);
  assert.doesNotMatch(migration, /grant execute on function public\.reconcile_stripe_bdag_finance\(\) to (?:anon|authenticated)/i);
  assert.match(webhook, /completed\.error\s*\|\|\s*!completed\.data/);
});

test("browser checkout uses a bounded session intent rather than an ephemeral default UUID", () => {
  assert.match(browserApi, /STRIPE_TOPUP_INTENT_STORAGE_KEY/);
  assert.match(browserApi, /sessionStorage/);
  assert.match(browserApi, /getOrCreateStripeTopupIntent/);
  assert.match(browserApi, /clearStripeTopupIntent/);
  assert.doesNotMatch(browserApi, /idempotencyKey\s*=\s*crypto\.randomUUID\(\)/);
});
