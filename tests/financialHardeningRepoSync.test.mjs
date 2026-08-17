import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const read = (path) => readFileSync(path, "utf8");
const financialSql = read(
  "supabase/migrations/20260817011224_harden_financial_security_definer_functions.sql",
);
const accessSql = read(
  "supabase/migrations/20260817011718_harden_buyer_financial_exposure.sql",
);
const allocationFoundation = read(
  "supabase/migrations/20260801043000_marketplace_mkt_a3c_bdag_payment.sql",
);
const settlementSource = read("services/marketplaceSettlementService.ts");
const orderSource = read("services/marketplaceOrderService.ts");
const nativeRequire = createRequire(import.meta.url);
const compile = (path, stubs = {}) => {
  const javascript = ts.transpileModule(read(path), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} };
  const require = (specifier) =>
    specifier in stubs ? stubs[specifier] : nativeRequire(specifier);
  vm.runInNewContext(javascript, {
    module,
    exports: module.exports,
    require,
    Error,
    Number,
    Date,
    Array,
    Object,
    RegExp,
    String,
    Math,
    __DEV__: false,
  });
  return module.exports;
};
const validators = compile("services/marketplaceRuntimeValidation.ts");
const template = { getSupabaseClient: () => ({}) };
const settlement = compile("services/marketplaceSettlementService.ts", {
  "@/template": template,
  "./marketplaceRuntimeValidation": validators,
});
const order = compile("services/marketplaceOrderService.ts", {
  "@/template": template,
  "@/services/marketplaceRuntimeValidation": validators,
});

const signatures = [
  "public.atomic_ledger_transfer(uuid, uuid, numeric, numeric, text, text, text, uuid, text)",
  "public.check_velocity_limit(uuid, text, numeric, integer, numeric, integer)",
  "public.credit_deposit_to_ledger(uuid, numeric, text, text, uuid)",
  "public.ensure_ledger_account(uuid)",
  "public.ledger_credit(uuid, uuid, numeric, text, jsonb)",
  "public.ledger_debit(uuid, uuid, numeric, text, jsonb)",
  "public.refund_withdrawal_to_ledger(uuid, text)",
  "public.request_withdrawal_from_ledger(uuid, numeric, text, text, text, text)",
  "public.transfer_bdag_internal(uuid, uuid, numeric, text)",
];
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("all nine exact internal financial signatures receive a fixed search path", () => {
  for (const signature of signatures)
    assert.match(
      financialSql,
      new RegExp(
        `alter function ${escape(signature)}\\s+set search_path to pg_catalog, public;`,
        "i",
      ),
    );
});

test("all nine internal financial functions are service-role only", () => {
  for (const signature of signatures) {
    const value = escape(signature);
    for (const role of ["public", "anon", "authenticated"])
      assert.match(
        financialSql,
        new RegExp(`revoke all on function ${value} from ${role};`, "i"),
      );
    assert.match(
      financialSql,
      new RegExp(`grant execute on function ${value} to service_role;`, "i"),
    );
  }
  assert.equal(
    [...financialSql.matchAll(/grant execute on function/gi)].length,
    signatures.length,
  );
  assert.doesNotMatch(
    financialSql,
    /grant execute on function[^;]+to (?:public|anon|authenticated);/i,
  );
});

test("withdrawal refund is explicitly closed to authenticated and anon", () => {
  const signature = escape("public.refund_withdrawal_to_ledger(uuid, text)");
  assert.match(
    financialSql,
    new RegExp(`revoke all on function ${signature} from authenticated;`, "i"),
  );
  assert.match(
    financialSql,
    new RegExp(`revoke all on function ${signature} from anon;`, "i"),
  );
  assert.match(
    financialSql,
    new RegExp(`grant execute on function ${signature} to service_role;`, "i"),
  );
});

test("nonexistent financial function names are never versioned", () => {
  for (const name of [
    "apply_marketplace_payment",
    "release_marketplace_order_settlement",
    "refund_marketplace_order",
    "finalize_marketplace_checkout_payment",
  ])
    assert.doesNotMatch(financialSql, new RegExp(name));
});

test("financial hardening migrations contain no business or ledger mutation", () => {
  assert.doesNotMatch(financialSql, /create\s+(?:or\s+replace\s+)?function/i);
  assert.doesNotMatch(financialSql, /\b(?:insert|update|delete)\b/i);
  assert.doesNotMatch(accessSql, /\b(?:insert|update|delete)\b/i);
});

test("buyer allocation policy is removed while seller policy remains", () => {
  assert.match(
    accessSql,
    /drop policy if exists marketplace_allocations_buyer_read\s+on public\.marketplace_payment_allocations;/i,
  );
  assert.doesNotMatch(accessSql, /drop policy[^;]*marketplace_allocations_seller_read/i);
  assert.match(
    allocationFoundation,
    /create policy marketplace_allocations_seller_read on public\.marketplace_payment_allocations for select to authenticated using\(seller_id=auth\.uid\(\)\);/i,
  );
});

test("wallet balance RPC denies public and anon while preserving authenticated and service role", () => {
  assert.match(
    accessSql,
    /revoke all on function public\.get_bdag_wallet_balance\(\) from public;/i,
  );
  assert.match(
    accessSql,
    /revoke all on function public\.get_bdag_wallet_balance\(\) from anon;/i,
  );
  assert.match(
    accessSql,
    /grant execute on function public\.get_bdag_wallet_balance\(\) to authenticated;/i,
  );
  assert.match(
    accessSql,
    /grant execute on function public\.get_bdag_wallet_balance\(\) to service_role;/i,
  );
});

const id = (suffix) =>
  `10000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const at = "2026-08-17T12:00:00.000Z";
const supportReceipt = (paymentStatus, allocationStatus) => ({
  dispute: { id: id(1), status: "resolved", reason_code: "damaged", created_at: at },
  order: { id: id(2), status: "refunded" },
  payment: { status: paymentStatus, gross_amount: 20 },
  allocation: {
    status: allocationStatus,
    gross_amount: 20,
    seller_net_amount: 17,
    creator_commission_amount: 1,
    platform_fee_amount: 2,
  },
});

test("settlement dispute parser accepts every canonical payment state", () => {
  for (const status of ["paid", "partially_refunded", "refunded"])
    assert.equal(
      settlement.parseSupportMarketplaceDispute(
        supportReceipt(status, "refunded"),
      ).payment.status,
      status,
    );
});

test("settlement dispute parser rejects stale or unknown payment states", () => {
  for (const status of ["pending", "failed", "unknown"])
    assert.throws(
      () =>
        settlement.parseSupportMarketplaceDispute(
          supportReceipt(status, "refunded"),
        ),
      (error) => error?.code === "marketplace_dispute_resolution_unknown",
    );
});

test("settlement dispute parser accepts every canonical allocation state", () => {
  for (const status of [
    "held",
    "released",
    "partially_refunded",
    "refunded",
  ])
    assert.equal(
      settlement.parseSupportMarketplaceDispute(
        supportReceipt("refunded", status),
      ).allocation.status,
      status,
    );
});

test("settlement dispute parser rejects unknown allocation states", () => {
  assert.throws(
    () =>
      settlement.parseSupportMarketplaceDispute(
        supportReceipt("refunded", "unknown"),
      ),
    (error) => error?.code === "marketplace_dispute_resolution_unknown",
  );
});

test("settlement source enumerates only production payment and allocation states", () => {
  assert.match(
    settlementSource,
    /const paymentStatuses = \[\s*"paid",\s*"partially_refunded",\s*"refunded",\s*\] as const;/,
  );
  assert.match(
    settlementSource,
    /const allocationStatuses = \[\s*"held",\s*"released",\s*"partially_refunded",\s*"refunded",\s*\] as const;/,
  );
});

const checkoutReceipt = (orderStatus, paymentStatus) => ({
  checkout: {
    id: id(3),
    reference: "CHK-TEST",
    status: "paid",
    currency: "BDAG",
    subtotal: 20,
    shipping_amount: 0,
    total: 20,
    expires_at: at,
    created_at: at,
    shipping_quote_policy: "frozen_until_expiry",
    paid_at: at,
  },
  shipping_address: {
    recipient_name: "Comprador",
    city: "Miami",
    region: "FL",
    country: "US",
  },
  orders: [
    {
      id: id(4),
      order_number: "ORD-TEST",
      seller_id: id(5),
      store_id: id(6),
      status: orderStatus,
      subtotal: 20,
      shipping_amount: 0,
      total: 20,
      reservation_expires_at: at,
      frozen_shipping: [],
      items: [],
    },
  ],
  payment: {
    id: id(7),
    status: paymentStatus,
    currency: "BDAG",
    gross_amount: 20,
    fee_bps: 1000,
    paid_at: at,
  },
});

test("checkout parser accepts every canonical Marketplace order state", () => {
  for (const status of [
    "pending_payment",
    "confirmed",
    "processing",
    "shipped",
    "delivered",
    "cancelled",
    "expired",
    "refunded",
    "partially_refunded",
  ])
    assert.equal(
      order.parseMarketplaceCheckoutReservation(
        checkoutReceipt(status, "paid"),
      ).orders[0].status,
      status,
    );
});

test("checkout parser rejects unknown Marketplace order states", () => {
  assert.throws(
    () =>
      order.parseMarketplaceCheckoutReservation(
        checkoutReceipt("future_order_state", "paid"),
      ),
    (error) => error?.code === "marketplace_order_unknown",
  );
});

test("checkout parser accepts every canonical Marketplace payment state", () => {
  for (const status of ["paid", "partially_refunded", "refunded"])
    assert.equal(
      order.parseMarketplaceCheckoutReservation(
        checkoutReceipt("partially_refunded", status),
      ).payment.status,
      status,
    );
});

test("checkout parser rejects unknown Marketplace payment states", () => {
  assert.throws(
    () =>
      order.parseMarketplaceCheckoutReservation(
        checkoutReceipt("confirmed", "future_payment_state"),
      ),
    (error) => error?.code === "marketplace_order_unknown",
  );
});

test("order service exposes strict order and payment types and enum parsers", () => {
  assert.match(orderSource, /export type MarketplaceOrderStatus=/);
  assert.match(orderSource, /status:MarketplaceOrderStatus/);
  assert.match(orderSource, /export type MarketplacePaymentStatus=/);
  assert.match(orderSource, /status:MarketplacePaymentStatus/);
  assert.doesNotMatch(
    orderSource,
    /status:rpcString\(o\.status|status:rpcString\(p\.status/,
  );
});
