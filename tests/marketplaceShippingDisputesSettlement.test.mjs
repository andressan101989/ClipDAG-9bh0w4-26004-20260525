import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const migration = await read('supabase/migrations/20260804120000_marketplace_shipping_disputes_scheduler.sql');
const buyer = await read('app/orders/[id].tsx');
const seller = await read('app/seller/orders/[id].tsx');
const dispute = await read('components/marketplace/MarketplaceDisputePanel.tsx');
const creation = await read('app/seller/product-editor/[productId].tsx');
const editing = creation;

test('shipping profiles are seller-owned private configuration', () => {
  assert.match(migration, /create table public\.marketplace_shipping_profiles/);
  assert.match(migration, /p\.seller_id=auth\.uid\(\)/);
  assert.match(migration, /marketplace_shipping_profile_not_owned/);
  assert.match(migration, /revoke all on public\.marketplace_shipping_profiles/);
});
test('publication requires shipping and existing products receive explicit legacy compatibility', () => {
  assert.match(migration, /marketplace_product_not_ready_shipping_incomplete/);
  assert.match(migration, /legacy_unrestricted/);
  assert.match(creation, /Configuracion de envio requerida/);
  assert.match(editing, /Configurar envio/);
});
test('checkout rejects unsupported destinations and freezes shipping values', () => {
  assert.match(migration, /marketplace_shipping_destination_unsupported/);
  assert.match(migration, /marketplace_order_shipping_snapshots/);
  assert.match(migration, /shipping_price,\s*processing_days_min,processing_days_max,transit_days_min,transit_days_max/);
  assert.match(migration, /unique\(order_id,profile_id\)/);
});
test('shipping amount is included in authoritative total while creator commission excludes shipping', () => {
  assert.match(migration, /total=round\(subtotal\+shipping_amount,8\)/);
  assert.match(migration, /commission:=round\(product_subtotal\*pin\.creator_commission_bps/);
  assert.match(migration, /new\.seller_net_amount:=new\.gross_amount-new\.platform_fee_amount-commission/);
});
test('seller fulfillment remains ownership checked and idempotent', async () => {
  const fulfillment = await read('supabase/migrations/20260801054500_marketplace_mkt_a3d1_order_fulfillment.sql');
  assert.match(fulfillment, /o\.seller_id<>auth\.uid\(\)/);
  assert.match(fulfillment, /marketplace_fulfillment_idempotency_conflict/);
  assert.match(seller, /Marcar como enviado/);
  assert.match(seller, /Número de seguimiento|NÃºmero de seguimiento/);
});
test('buyer sees tracking, estimated delivery, receipt and dispute actions', () => {
  assert.match(buyer, /Ver seguimiento/);
  assert.match(buyer, /Entrega estimada/);
  assert.match(buyer, /Confirmar recepción/);
  assert.match(buyer, /MarketplaceDisputePanel/);
});
test('dispute reasons and Spanish statuses are complete', () => {
  for (const code of ['not_received','damaged','incorrect_item','missing_items','other']) assert.match(dispute, new RegExp(code));
  for (const label of ['No recibí el pedido','Producto dañado','Producto incorrecto','Faltan artículos','Otro problema','En revisión']) assert.match(dispute, new RegExp(label));
});
test('active dispute blocks both manual and scheduled release', () => {
  assert.match(migration, /marketplace_dispute_blocks_allocation_release/);
  assert.match(migration, /status in\('open','under_review'\)/);
  assert.match(migration, /marketplace_settlement_dispute_active/);
});
test('automatic settlement has separate fallback policy and authenticated cron', () => {
  assert.match(migration, /dispute_window_days/);
  assert.match(migration, /maximum_shipment_fallback_days/);
  assert.match(migration, /set_config\('request\.jwt\.claim\.role','service_role'/);
  assert.match(migration, /cron\.schedule\('settle-eligible-marketplace-orders','17 \* \* \* \*'/);
  assert.match(migration, /revoke all on function[\s\S]*public\.run_scheduled_marketplace_settlement\(\)[\s\S]*from public,anon,authenticated/);
});
test('scheduler is bounded, retry-safe, observable and skips locked rows', () => {
  assert.match(migration, /p_limit not between 1 and 500/);
  assert.match(migration, /for update of o skip locked/);
  assert.match(migration, /marketplace-auto-settlement:/);
  assert.match(migration, /marketplace_settlement_run_failures/);
  assert.match(migration, /jsonb_build_object\('processed',processed,'failed',failed/);
});
test('scope excludes protected integrations and records premium design deferral', async () => {
  const changed = [migration,buyer,seller,dispute,creation,editing].join('\n');
  assert.doesNotMatch(changed, /Agora|DeepAR|WalletConnect|CallKit|Cloudflare/);
  assert.match(await read('docs/marketplace-functional-completion.md'), /UX\/UI premium.+deferred/);
});
