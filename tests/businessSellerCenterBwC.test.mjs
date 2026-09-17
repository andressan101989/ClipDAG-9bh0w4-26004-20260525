import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = (name) => readFileSync(`supabase/migrations/${name}`, "utf8");
const c1 = migration("20260916230150_business_seller_center_web_bw_c1_runtime_sql_fix.sql");
const c2 = migration("20260916231439_business_seller_center_web_bw_c2_pagination_fix.sql");
const c3 = migration("20260916233012_business_seller_center_web_bw_c3_return_projection_fix.sql");
const c4 = migration("20260917011750_business_seller_center_web_bw_c4_product_media_owner_fix.sql");

test("C4 replaces only canonical product media authority and removes owner ambiguity", () => {
  assert.equal((c4.match(/create\s+or\s+replace\s+function/gi) ?? []).length, 1);
  assert.match(c4, /public\.set_my_marketplace_product_media_v2\(\s*p_product_id uuid,p_image_asset_ids uuid\[\],p_cover_asset_id uuid,p_video_asset_id uuid default null/);
  assert.match(c4, /v_owner_id uuid/);
  assert.equal((c4.match(/a\.owner_id=v_owner_id/g) ?? []).length, 3);
  assert.doesNotMatch(c4, /a\.owner_id=owner_id/);
  assert.match(c4, /private\.business_require_capability\(v_owner_id,'business\.catalog\.manage'\)/);
  assert.match(c4, /private\.business_actor_has_capability\(v_owner_id,'business\.media\.(read|manage)'\)/);
  assert.match(c4, /security definer\s+set search_path = ''/i);
});

test("C4 is schema-neutral, finance-neutral and preserves C1 special-expression fix", () => {
  assert.doesNotMatch(c4, /create\s+table|alter\s+table|create\s+policy|grant\s|revoke\s|edge|financial_transactions|ledger_entries|marketplace_payments|settlements|withdrawals|app_wallets/i);
  for (const source of [c1, c2, c3, c4]) {
    assert.doesNotMatch(source, /pg_catalog\.(?:coalesce|greatest|least)\s*\(/i);
  }
});

test("C4 preserves product media limits, same-owner validation and C1A-compatible linking", () => {
  assert.match(c4, /image_count>5/);
  assert.match(c4, /p_cover_asset_id=any\(p_image_asset_ids\)/);
  assert.match(c4, /a\.owner_id=v_owner_id and a\.status='ready' and a\.visibility='public'/);
  assert.match(c4, /a\.purpose in\('product_image','business_library'\)/);
  assert.match(c4, /insert into public\.media_asset_links/);
  assert.doesNotMatch(c4, /set\s+owner_id|set\s+purpose/i);
});
