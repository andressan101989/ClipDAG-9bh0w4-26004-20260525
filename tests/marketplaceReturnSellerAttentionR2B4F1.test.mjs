import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260823161526_marketplace_return_seller_attention_r2b4_f1.sql");
const sales = migration.slice(
  migration.indexOf("create or replace function public.fetch_my_marketplace_sales("),
  migration.indexOf("create or replace function public.fetch_my_marketplace_returns("),
);
const returns = migration.slice(
  migration.indexOf("create or replace function public.fetch_my_marketplace_returns("),
  migration.indexOf("comment on function public.fetch_my_marketplace_sales("),
);
const shipped = "when rr.status='approved'and rs.status='shipped'then'receipt_confirmation_pending'";
const labelPending = "when rr.status='approved'and rs.id is null then'label_pending'";
test("sales routes shipped returns before label-pending returns", () => {
  assert.ok(sales.indexOf(shipped) < sales.indexOf(labelPending));
});

test("return inbox routes shipped returns before label-pending returns", () => {
  assert.ok(returns.indexOf(shipped) < returns.indexOf(labelPending));
});

test("label_pending requires that no return shipment exists", () => {
  assert.match(sales, /rs\.id is null then'label_pending'/);
  assert.match(returns, /rs\.id is null then'label_pending'/);
});

test("label asset absence is never an attention classifier", () => {
  assert.doesNotMatch(sales + returns, /return_label_asset_id\s+is\s+null/i);
});

test("F1 is one transactional read-model-only migration", () => {
  assert.match(migration, /\nbegin;[\s\S]*commit;\s*$/);
  assert.deepEqual(
    [...migration.matchAll(/create or replace function public\.([a-z0-9_]+)\(/g)].map((match) => match[1]),
    ["fetch_my_marketplace_sales", "fetch_my_marketplace_returns"],
  );
});

test("F1 contains no data or financial mutation", () => {
  assert.doesNotMatch(migration, /\b(insert|update|delete)\b/i);
  assert.doesNotMatch(migration, /financial_transactions|ledger_entries|marketplace_return_refunds/i);
});

test("F1 creates no table or parallel financial function", () => {
  assert.doesNotMatch(migration, /\bcreate\s+(table|function)\b/i);
  assert.doesNotMatch(migration, /marketplace_(complete|create|refund|reverse)_/i);
});

test("both read models preserve hardened function security", () => {
  for (const body of [sales, returns]) {
    assert.match(body, /security definer set search_path=pg_catalog,public/);
    assert.match(body, /auth\.uid\(\)/);
    assert.match(body, /marketplace_sellers[\s\S]*status='approved'/);
    assert.match(body, /marketplace_stores[\s\S]*status='active'/);
  }
});

test("ACL is exact for both seller read models", () => {
  for (const signature of [
    "fetch_my_marketplace_sales\\(text,integer,timestamptz,uuid\\)",
    "fetch_my_marketplace_returns\\(integer,timestamptz,uuid\\)",
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${signature}\\s+from public,anon,authenticated;`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${signature}\\s+to authenticated,service_role;`));
  }
});

test("comments document shipment precedence and legacy compatibility", () => {
  assert.match(migration, /Shipped returns always require receipt confirmation/);
  assert.match(migration, /Shipment state outranks label presence/);
  assert.match(migration, /legacy shipments without labels/);
});
