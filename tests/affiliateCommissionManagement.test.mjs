import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  creatorCommissionBpsToPercent,
  creatorCommissionPercentToBps,
} from "../services/affiliateCommissionState.ts";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("creator commission percentage maps exactly to basis points", () => {
  assert.equal(creatorCommissionPercentToBps("0.01"), 1);
  assert.equal(creatorCommissionPercentToBps("5"), 500);
  assert.equal(creatorCommissionPercentToBps(10), 1000);
  assert.equal(creatorCommissionPercentToBps("30.00"), 3000);
  assert.equal(creatorCommissionBpsToPercent(1), "0.01");
  assert.equal(creatorCommissionBpsToPercent(500), "5");
});

test("invalid creator commission percentages are rejected", () => {
  for (const value of ["", "0", "-1", "30.01", "5.001", "nan"]) {
    assert.throws(() => creatorCommissionPercentToBps(value), /live_affiliate_invalid_offer/);
  }
});

test("creation preserves optional affiliate configuration and recoverable offer failure", async () => {
  const source = await read("app/create-product.tsx");
  assert.match(source, /Permitir que otros creadores vendan este producto/);
  assert.match(source, /affiliateEnabled \?/);
  assert.match(source, /creatorCommissionPercentToBps\(affiliatePercent\)/);
  assert.match(source, /Producto publicado, afiliados pendientes/);
  assert.match(source, /Reintentar activar afiliados/);
  assert.match(source, /idempotencyKey: affiliateKeyRef\.current/);
  assert.doesNotMatch(source, /Math\.round\(creatorCommissionPercent \* 100\)/);
});

test("seller can read, edit, disable and re-enable a public creator offer", async () => {
  const [screen, service] = await Promise.all([
    read("app/seller/product/[id]/edit.tsx"),
    read("services/liveCommerceService.ts"),
  ]);
  assert.match(screen, /Afiliados y comisiones/);
  assert.match(screen, /fetchMyLiveAffiliateOffer\(id\)/);
  assert.match(screen, /saveAffiliateOffer\('active'\)/);
  assert.match(screen, /saveAffiliateOffer\('paused'\)/);
  assert.match(screen, /Editar comisión/);
  assert.match(screen, /Activar afiliados/);
  assert.match(screen, /Desactivar afiliados/);
  assert.match(screen, /tarifa de plataforma.+no puede editarse aquí/s);
  assert.match(service, /fetch_my_live_affiliate_offer/);
  assert.match(service, /p_commission_bps: input\.commissionBps/);
});

test("seller offer read RPC is private, ownership-scoped and does not expose the table", async () => {
  const migration = await read("supabase/migrations/20260804110000_marketplace_affiliate_offer_management.sql");
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path = public/i);
  assert.match(migration, /p\.seller_id = actor/);
  assert.match(migration, /o\.seller_id = actor/);
  assert.match(migration, /revoke all on function public\.fetch_my_live_affiliate_offer\(uuid\)[\s\S]*from public, anon/i);
  assert.match(migration, /grant execute[\s\S]*to authenticated, service_role/i);
  assert.doesNotMatch(migration, /grant (select|insert|update|delete).*marketplace_live_affiliate_offers/i);
});

test("historical commission remains frozen and platform fee stays authoritative", async () => {
  const [commissionMigration, pinLifecycleMigration] = await Promise.all([
    read("supabase/migrations/20260803010000_marketplace_mkt_a4b_live_affiliate_commissions.sql"),
    read("supabase/migrations/20260803023000_fix_mkt_a4b_affiliate_pin_lifecycle.sql"),
  ]);
  assert.match(commissionMigration, /pin\.creator_commission_bps/);
  assert.match(commissionMigration, /new\.gross_amount\*pin\.creator_commission_bps\/10000\.0/);
  assert.match(commissionMigration, /gross_amount=platform_fee_amount\+seller_net_amount\+creator_commission_amount/);
  assert.match(pinLifecycleMigration, /live_affiliate_self_purchase_forbidden/);
});

test("modified Marketplace files contain no mojibake", async () => {
  for (const path of [
    "app/create-product.tsx",
    "app/seller/product/[id]/edit.tsx",
    "components/live/commerce/LiveViewerCommerce.tsx",
    "components/live/shop/LivePaymentConfirmation.tsx",
    "services/marketplacePaymentService.ts",
    "services/liveCommerceService.ts",
  ]) {
    assert.doesNotMatch(await read(path), /Ã|Â|â/);
  }
});
