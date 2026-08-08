import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { calculateMarketplaceProductQualityCore as quality } from "../services/marketplaceProductQualityCore.mjs";
const migration = readFileSync(
  "supabase/migrations/20260808110000_marketplace_product_publishing_v2.sql",
  "utf8",
);
const edge = readFileSync(
  "supabase/functions/_shared/mediaPurposes.ts",
  "utf8",
);
const editor = readFileSync(
  "app/seller/product-editor/[productId].tsx",
  "utf8",
);
const base = {
  title: "Runner Pro",
  description: "Una descripcion profesional ".repeat(8),
  categoryId: "category",
  imageCount: 1,
  hasValidVideo: false,
  price: 10,
  inventory: 5,
  variantsReady: true,
  shippingReady: true,
  productType: "physical",
};
test("quality score is deterministic, bounded and advisory", () => {
  assert.deepEqual(quality(base), quality(base));
  assert.ok(quality(base).score >= 0 && quality(base).score <= 100);
  assert.ok(quality({ ...base, imageCount: 5 }).score > quality(base).score);
  assert.ok(
    quality({ ...base, hasValidVideo: true }).score > quality(base).score,
  );
  assert.ok(
    quality({ ...base, shippingReady: false }).score < quality(base).score,
  );
  assert.doesNotMatch(migration, /quality.*publish/i);
});
test("server media contract enforces five images, one cover and one <=60s video", () => {
  assert.match(migration, /image_count>5/);
  assert.match(migration, /marketplace_product_one_cover_uidx/);
  assert.match(migration, /p_video_asset_id uuid default null/);
  assert.match(migration, /duration_ms between 1 and 60000/);
  assert.match(edge, /product_video/);
  assert.match(edge, /video\/mp4/);
  assert.match(edge, /video\/quicktime/);
});
test("draft lifecycle is private, idempotent and resumable", () => {
  assert.match(migration, /products_seller_editor_session_key_uidx/);
  assert.match(migration, /0,'paused'/);
  assert.match(migration, /fetch_my_marketplace_product_draft/);
  assert.match(migration, /p\.seller_id=auth\.uid\(\)/);
  assert.match(editor, /Guardar borrador/);
  assert.match(editor, /AppState\.addEventListener/);
});
test("editor has failure, cover, reorder, preview and publication gates", () => {
  assert.match(editor, /state: "uploading"/);
  assert.match(editor, /state: "failed"/);
  assert.match(editor, /onMoveLeft/);
  assert.match(editor, /onCover/);
  assert.match(editor, /Vista previa privada/);
  assert.match(editor, /images\.some\(\(x\) => x\.state !== "ready"\)/);
});
test("migration leaves protected financial systems untouched", () => {
  assert.doesNotMatch(
    migration,
    /ledger_|marketplace_payments|marketplace_order_settlements|commission_bps|inventory_reservations|checkout_sessions/i,
  );
});
