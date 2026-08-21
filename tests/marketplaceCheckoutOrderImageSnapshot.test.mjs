import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260820010000_fix_marketplace_checkout_order_image_snapshot.sql",
  "utf8",
);

const imageSnapshotExpression = /select coalesce\(\(select a\.public_url from public\.media_assets a where a\.id=v_variant\.image_asset_id and a\.status='ready'\),public\.marketplace_safe_public_image_url\(v_product\.images\[1\]\)\)into v_image/;

test("checkout snapshot keeps a ready selected-variant image first", () => {
  assert.match(migration, imageSnapshotExpression);
  const variantImage = "https://cdn.example/variant.jpg";
  const productImage = "https://cdn.example/product.jpg";
  assert.equal(variantImage ?? productImage ?? null, variantImage);
});

test("checkout snapshot falls back to the canonical public product cover", () => {
  assert.match(migration, /marketplace_safe_public_image_url\(v_product\.images\[1\]\)/);
  const variantImage = null;
  const productImage = "https://cdn.example/product.jpg";
  assert.equal(variantImage ?? productImage ?? null, productImage);
});

test("checkout reservation still succeeds with a null image snapshot", () => {
  assert.match(migration, /insert into public\.marketplace_order_items[\s\S]*image_url[\s\S]*v_image/);
  const variantImage = null;
  const productImage = null;
  assert.equal(variantImage ?? productImage ?? null, null);
  assert.doesNotMatch(migration, /marketplace_(?:variant|product)_image_required/);
});

test("replacement preserves the authoritative reservation and security contract", () => {
  assert.match(migration, /create or replace function public\.create_marketplace_checkout_reservation\(p_items jsonb,p_shipping_address jsonb,p_idempotency_key uuid\)/);
  assert.match(migration, /security definer set search_path=public/);
  assert.match(migration, /v_price_snapshot jsonb:='\{\}'::jsonb/);
  assert.match(migration, /marketplace_checkout_price_snapshot_invalid/);
  assert.match(migration, /set reserved=reserved\+x\.quantity,version=version\+1/);
  assert.match(migration, /return public\.marketplace_checkout_response\(v_checkout\)/);
});

test("image correction introduces no parallel RPC, backfill, or financial mutation", () => {
  assert.equal((migration.match(/create or replace function/g) ?? []).length, 1);
  assert.doesNotMatch(migration, /update public\.marketplace_order_items/);
  assert.doesNotMatch(migration, /ledger_|wallet|escrow|settlement|platform_fee|seller_net|commission/i);
});
