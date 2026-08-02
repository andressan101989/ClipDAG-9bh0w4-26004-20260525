import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read=path=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const migration=read('supabase/migrations/20260802150000_marketplace_mkt_a4a_live_commerce.sql');
const service=read('services/liveCommerceService.ts');
const viewer=read('components/live/commerce/LiveViewerCommerce.tsx');
const host=read('components/live/commerce/LiveHostProductManager.tsx');
const watch=read('app/live/watch/[streamId].tsx');
const broadcast=read('app/live/broadcast/[streamId].tsx');

test('pin and immutable source schemas are forward-only and nonfinancial',()=>{
  assert.match(migration,/begin;/);
  assert.match(migration,/create table public\.live_session_products/);
  assert.match(migration,/create table public\.marketplace_live_order_sources/);
  assert.match(migration,/marketplace_live_source_immutable/);
  assert.match(migration,/live_pin_active_product/);
  assert.match(migration,/live_pin_one_featured/);
  assert.doesNotMatch(migration,/influencer_(?:amount|commission)|ledger_(?:debit|credit)|atomic_ledger_transfer/i);
});

test('authorization, pin limit, lifecycle and direct-write denials are authoritative',()=>{
  assert.match(migration,/l\.host_id=auth\.uid\(\)/);
  assert.match(migration,/ms\.status='approved'/);
  assert.match(migration,/s\.status='active'/);
  assert.match(migration,/>=20/);
  assert.match(migration,/l\.status<>'live'/);
  assert.match(migration,/revoke all on live_session_products/);
  assert.match(migration,/revoke all on marketplace_live_order_sources/);
});

test('LIVE reservation wraps existing Marketplace reservation and snapshots source atomically',()=>{
  assert.match(migration,/result:=create_marketplace_checkout_reservation/);
  assert.match(migration,/insert into marketplace_live_order_sources/);
  assert.match(migration,/marketplace_own_product_forbidden/);
  assert.match(migration,/marketplace_idempotency_conflict/);
  assert.doesNotMatch(migration,/marketplace_payment_allocations\s+(?:insert|update)|pay_marketplace/i);
});

test('client never sends price seller store fee or source identity',()=>{
  assert.match(service,/create_live_marketplace_checkout_reservation/);
  assert.match(service,/p_session_id/);
  assert.match(service,/p_live_session_product_id/);
  assert.match(service,/p_variant_id/);
  assert.match(service,/p_quantity/);
  assert.doesNotMatch(service,/p_(?:seller_id|store_id|host_id|price|amount|fee|source)/);
});

test('LIVE commerce stays mounted with realtime and five-second polling',()=>{
  assert.match(watch,/LiveViewerCommerce/);
  assert.match(broadcast,/LiveHostProductManager/);
  assert.match(watch,/postgres_changes/);
  assert.match(broadcast,/postgres_changes/);
  assert.match(watch,/5_000/);
  assert.match(broadcast,/5_000/);
  assert.doesNotMatch(viewer,/router\.(?:replace|back)\([^)]*live/i);
});

test('viewer flow includes authoritative detail, shipping, reservation, payment and success',()=>{
  for(const value of ['fetchMarketplaceProductDetail','validateShippingAddress','createLiveCheckoutReservation','payMarketplaceCheckout','Compra confirmada','Continuar viendo el LIVE','Ver pedido'])assert.match(viewer,new RegExp(value));
  assert.match(viewer,/paymentKey=useRef\(randomUUID\(\)\)/);
  assert.match(viewer,/lock=useRef\(false\)/);
});

test('host manager supports pin unpin feature and duplicate-tap locking',()=>{
  for(const value of ['pinLiveProduct','unpinLiveProduct','featureLiveProduct','new Set<string>'])assert.match(host,new RegExp(value.replace(/[<>]/g,'\\$&')));
});

test('new client files contain no mojibake markers',()=>{
  for(const [name,text] of Object.entries({service,viewer,host}))assert.doesNotMatch(text,/Ã|Â|â€|�/,name);
});
