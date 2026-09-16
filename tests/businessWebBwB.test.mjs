import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Business Web preserves canonical seller/store mutation authorities", async () => {
  const api = await read("apps/business-web/src/lib/businessApi.ts");
  for (const rpc of ["apply_marketplace_seller", "update_marketplace_seller_application", "create_marketplace_store", "update_marketplace_store"]) {
    assert.match(api, new RegExp(`\\\"${rpc}\\\"`));
  }
  assert.doesNotMatch(api, /\.insert\s*\(|\.update\s*\(|service[_-]?role/i);
  assert.match(api, /get_my_business_access/);
  assert.doesNotMatch(api, /businesses_table|merchants|organizations/i);
});

test("canonical SQL denies cross-owner Store mutations and preserves one Store per seller", async () => {
  const migration = await read("supabase/migrations/20260727100000_marketplace_mkt_a1_seller_store_product_foundation.sql");
  assert.match(migration, /unique\s*\(seller_id\)/i);
  assert.match(migration, /where id=p_store_id and seller_id=v_user_id and status<>'suspended'/i);
  assert.match(migration, /values\(v_user_id,btrim\(p_name\)/i);
  assert.match(migration, /where user_id=v_user_id and status in \('pending','rejected'\)/i);
});

test("Business Web has no Admin RBAC, finance or service-role dependency", async () => {
  const files = await Promise.all([
    read("apps/business-web/src/App.tsx"),
    read("apps/business-web/src/auth/BusinessAuthProvider.tsx"),
    read("apps/business-web/src/lib/businessApi.ts"),
    read("apps/business-web/src/lib/supabase.ts"),
  ]);
  const source = files.join("\n");
  assert.doesNotMatch(source, /AdminAuthProvider|admin_actor_has_capability|private\.admin_/);
  assert.doesNotMatch(source, /ledger_accounts|ledger_entries|financial_transactions|withdrawal_requests|app_wallet/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|service_role/);
});

test("root scripts expose the complete Business Web lifecycle", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.scripts["business:web:dev"], "npm --prefix apps/business-web run dev");
  assert.equal(pkg.scripts["business:web:test"], "npm --prefix apps/business-web run test");
  assert.equal(pkg.scripts["business:web:lint"], "npm --prefix apps/business-web run lint");
  assert.equal(pkg.scripts["business:web:build"], "npm --prefix apps/business-web run build");
});
