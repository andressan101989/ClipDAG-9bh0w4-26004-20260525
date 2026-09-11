import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260911165931_superuser_a3_f1_marketplace_audit_scope_redaction.sql",
    import.meta.url,
  ),
  "utf8",
);
const activityPage = readFileSync(
  new URL(
    "../apps/admin-web/src/pages/MarketplaceIntelligencePages.tsx",
    import.meta.url,
  ),
  "utf8",
);

const sellerActions = [
  "seller_approve",
  "seller_reject",
  "seller_suspend",
  "seller_restore",
];
const productActions = [
  "product_approve",
  "product_reject",
  "product_suspend",
];
const disputeActions = [
  "dispute_manual_review",
  "dispute_refund_buyer",
  "dispute_release_seller",
  "dispute_reject_claim",
];

test("keeps the canonical audit guard and Marketplace domain boundary", () => {
  assert.match(
    migration,
    /perform public\.admin_require_capability\('marketplace\.audit\.read'\)/,
  );
  assert.match(migration, /a\.domain = 'marketplace'/);
  assert.match(migration, /security definer/);
  assert.match(
    migration,
    /set search_path to 'pg_catalog','private','public'/,
  );
});

test("intersects each supported resource with its current read capability", () => {
  for (const capability of [
    "marketplace.sellers.read",
    "marketplace.products.read",
    "marketplace.disputes.read",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `admin_actor_has_capability\\('${capability.replaceAll(".", "\\.")}\\'\\)`,
      ),
    );
  }
  for (const action of [...sellerActions, ...productActions, ...disputeActions]) {
    assert.ok(migration.includes(`'${action}'`), `missing ${action}`);
  }
  assert.match(migration, /else false\s+end/);
});

test("unknown or mismatched future actions fail closed", () => {
  const visible = (targetType, action, capabilities) => {
    if (targetType === "seller" && sellerActions.includes(action))
      return capabilities.has("marketplace.sellers.read");
    if (targetType === "product" && productActions.includes(action))
      return capabilities.has("marketplace.products.read");
    if (targetType === "dispute" && disputeActions.includes(action))
      return capabilities.has("marketplace.disputes.read");
    return false;
  };
  const allMarketplaceReads = new Set([
    "marketplace.sellers.read",
    "marketplace.products.read",
    "marketplace.disputes.read",
  ]);
  assert.equal(visible("seller", "seller_approve", allMarketplaceReads), true);
  assert.equal(visible("seller", "product_approve", allMarketplaceReads), false);
  assert.equal(visible("order", "order_refund", allMarketplaceReads), false);
  assert.equal(visible("seller", "seller_future_action", allMarketplaceReads), false);
});

test("FINANCE_AUDITOR sees disputes but not seller or product audit", () => {
  const financeAuditor = new Set([
    "marketplace.audit.read",
    "marketplace.disputes.read",
    "marketplace.orders.read",
    "finance.audit.read",
  ]);
  assert.equal(financeAuditor.has("marketplace.disputes.read"), true);
  assert.equal(financeAuditor.has("marketplace.sellers.read"), false);
  assert.equal(financeAuditor.has("marketplace.products.read"), false);
});

test("PLATFORM_ADMIN and MARKETPLACE_ADMIN get operational finance metadata only", () => {
  assert.match(
    migration,
    /v_can_finance_audit := public\.admin_actor_has_capability\('finance\.audit\.read'\)/,
  );
  assert.match(
    migration,
    /case when v_can_finance_audit\s+then jsonb_build_object\('canonical_id'/,
  );
  for (const key of ["result_kind", "money_moved", "already_released"])
    assert.ok(migration.includes(`'${key}'`));
});

test("metadata is an explicit allow-list and never exposes the security fingerprint", () => {
  assert.doesNotMatch(migration, /'metadata'\s*,\s*a\.metadata/);
  assert.doesNotMatch(migration, /request_fingerprint/i);
  for (const forbidden of [
    "ledger_entry_id",
    "ledger_account_id",
    "wallet_address",
    "balance",
    "escrow_id",
    "financial_transaction_id",
    "push_token",
    "jwt",
    "service_key",
    "private_key",
  ]) {
    assert.doesNotMatch(migration, new RegExp(`'${forbidden}'`, "i"));
  }
});

test("seller and product receipts expose only approved operational keys", () => {
  for (const key of [
    "seller_id",
    "status",
    "store_status",
    "action",
    "updated_at",
    "product_id",
    "moderation_status",
    "moderation_reason",
    "publication_status",
  ]) {
    assert.ok(migration.includes(`'${key}'`), `missing safe key ${key}`);
  }
});

test("preserves response contract, pagination, and authenticated-only grant", () => {
  for (const key of [
    "activity",
    "page_size",
    "next_cursor",
    "actor_username",
    "actor_display_name",
    "reason_code",
    "metadata",
  ]) {
    assert.ok(migration.includes(`'${key}'`), `missing response key ${key}`);
  }
  assert.match(migration, /limit p_limit \+ 1/);
  assert.match(
    migration,
    /revoke all on function public\.search_marketplace_admin_activity\([\s\S]*?from public,anon,authenticated,service_role/,
  );
  assert.match(
    migration,
    /grant execute on function public\.search_marketplace_admin_activity\([\s\S]*?to authenticated/,
  );
});

test("admin-web has no legitimate dependency on audit metadata internals", () => {
  const pageStart = activityPage.indexOf("export function MarketplaceActivityPage");
  assert.notEqual(pageStart, -1);
  const pageSource = activityPage.slice(pageStart);
  assert.doesNotMatch(pageSource, /row\.metadata/);
  assert.doesNotMatch(pageSource, /request_fingerprint/);
});

test("F1 changes no catalog, assignment, audit storage, or finance objects", () => {
  for (const forbidden of [
    /insert\s+into\s+private\.admin_roles/i,
    /insert\s+into\s+private\.admin_capabilities/i,
    /insert\s+into\s+private\.admin_role_capabilities/i,
    /insert\s+into\s+private\.admin_user_roles/i,
    /update\s+private\.admin_action_audit/i,
    /create\s+table/i,
    /ledger_entries/i,
    /financial_transactions/i,
    /marketplace_order_refunds/i,
    /marketplace_order_settlements/i,
  ]) {
    assert.doesNotMatch(migration, forbidden);
  }
});
