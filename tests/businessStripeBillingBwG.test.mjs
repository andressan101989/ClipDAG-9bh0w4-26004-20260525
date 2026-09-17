import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import Stripe from "stripe";

const migration = fs.readFileSync("supabase/migrations/20260917161738_business_stripe_billing_bw_g.sql", "utf8");
const checkout = fs.readFileSync("supabase/functions/stripe-bdag-checkout/index.ts", "utf8");
const webhook = fs.readFileSync("supabase/functions/stripe-webhook/index.ts", "utf8");
const stripeBilling = fs.readFileSync("supabase/functions/_shared/stripeBilling.ts", "utf8");
const economics = fs.readFileSync("supabase/functions/_shared/bdagEconomics.ts", "utf8");
const deposit = fs.readFileSync("supabase/functions/bdag-deposit/index.ts", "utf8");
const financePage = fs.readFileSync("apps/business-web/src/pages/finance/BusinessFinancePage.tsx", "utf8");

test("BW-G creates exactly three private provider adapter tables and no wallet", () => {
  assert.equal((migration.match(/create table private\.stripe_/g) ?? []).length, 3);
  assert.doesNotMatch(migration, /create table (?:public\.)?(?:stripe_wallet|business_wallet|stripe_ledger|stripe_escrow)/i);
  assert.match(migration, /alter table private\.stripe_customers force row level security/);
  assert.match(migration, /revoke all on table private\.stripe_bdag_topups from public, anon, authenticated/);
});

test("canonical credit is service-role-only and uses the existing ledger", () => {
  assert.match(migration, /operation_type[\s\S]*'deposit'/);
  assert.match(migration, /'stripe_bdag_topup'/);
  assert.match(migration, /public\.ensure_ledger_account/);
  assert.match(migration, /public\.ledger_credit/);
  assert.match(migration, /grant execute on function public\.credit_stripe_bdag_topup[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /grant execute on function public\.credit_stripe_bdag_topup[\s\S]*to authenticated/);
});

test("webhook verification uses the official pinned SDK and exact raw body", async () => {
  assert.match(webhook, /npm:stripe@22\.6\.2/);
  assert.match(webhook, /const rawBody = await req\.text\(\)/);
  assert.match(webhook, /constructEventAsync\([\s\S]*rawBody[\s\S]*signature/);
  assert.match(webhook, /charge\.dispute\.created[\s\S]*stripe\.charges\.retrieve/);
  assert.doesNotMatch(webhook.slice(0, webhook.indexOf("constructEventAsync")), /JSON\.parse\(rawBody\)/);

  const secret = "whsec_bw_g_test";
  const payload = JSON.stringify({ id: "evt_test", object: "event" });
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  assert.equal(Stripe.webhooks.constructEvent(payload, header, secret).id, "evt_test");
  assert.throws(() => Stripe.webhooks.constructEvent(payload + " ", header, secret));
});

test("checkout is hosted, owner-derived and never accepts URLs or conversion from browser", () => {
  assert.match(checkout, /mode: "payment"/);
  assert.match(checkout, /payment_method_types: \["card"\]/);
  assert.match(checkout, /user\.id/);
  assert.match(stripeBilling, /BUSINESS_WEB_PUBLIC_URL/);
  assert.match(stripeBilling, /webhookSecret/);
  assert.doesNotMatch(checkout, /body\.(?:businessOwnerId|bdag_amount|conversion_rate|customer_id|success_url|cancel_url)/);
});

test("one shared USD to BDAG source is reused by blockchain deposit", () => {
  assert.match(economics, /BDAG_PER_USD = 100/);
  assert.match(deposit, /import \{ BDAG_PER_USD \} from '\.\.\/_shared\/bdagEconomics\.ts'/);
  assert.doesNotMatch(deposit, /const USD_TO_BDAG\s*=\s*100/);
  assert.doesNotMatch(financePage, /100\s*BDAG|BDAG_PER_USD|USD_TO_BDAG/);
});

test("refunds and disputes require review without automatic ledger debit", () => {
  assert.match(migration, /charge\.refunded/);
  assert.match(migration, /charge\.dispute\.created/);
  assert.match(migration, /status='requires_review'/);
  const reviewBranch = migration.slice(migration.indexOf("elsif v_event_type in ('charge.refunded'"), migration.indexOf("return jsonb_build_object('already_processed'"));
  assert.doesNotMatch(reviewBranch, /ledger_|financial_transactions|balance\s*=/i);
});

test("provider tables and Business projection never expose card data or provider identifiers", () => {
  assert.doesNotMatch(migration, /\b(?:pan|cvc|card_number|payment_method_object|card_fingerprint|full_payload)\b/i);
  const overview = migration.slice(
    migration.indexOf("create or replace function public.get_my_business_billing_overview"),
    migration.indexOf("create or replace function public.manage_stripe_bdag_adapter"),
  );
  assert.doesNotMatch(overview, /stripe_(?:customer|checkout_session|payment_intent|event)_id|financial_transaction_id/);
});
