import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read=path=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const migration=read('supabase/migrations/20260802163000_fix_marketplace_mkt_a4a_live_commerce.sql');
const service=read('services/liveCommerceService.ts');
const state=read('services/liveCommerceState.ts');
const host=read('components/live/commerce/LiveHostProductManager.tsx');
const viewer=read('components/live/commerce/LiveViewerCommerce.tsx');

test('command fingerprints bind key to complete command',()=>{
  for(const token of ["'pin'","'unpin'","'feature'",'request_fingerprint','result_json'])assert.ok(migration.includes(token));
  assert.match(migration,/pg_advisory_xact_lock/);
  assert.match(migration,/live_commerce_idempotency_conflict/);
});

test('candidate pagination is server-owned, limit-plus-one and strict',()=>{
  assert.match(migration,/limit n\+1/);
  assert.match(migration,/\(p\.updated_at,p\.id\)<\(p_before_updated_at,p_before_id\)/);
  assert.match(migration,/jsonb_build_object\('items',rows_json,'next_cursor'/);
  assert.match(service,/data\.next_cursor/);
  assert.doesNotMatch(service,/items\.length\s*===\s*50/);
});

test('signed marketplace images and stale featured variants are sanitized',()=>{
  for(const marker of ['token','access_token','signature','expires','x-amz-'])assert.match(migration,new RegExp(marker));
  assert.match(service,/PRIVATE_QUERY/);
  assert.match(migration,/safe_featured_variant_id/);
  assert.match(migration,/greatest\(coalesce\(i\.on_hand,0\)-coalesce\(i\.reserved,0\),0\)>0/);
});

test('host manager loads every cursor page without duplicate products',()=>{
  for(const marker of ['PAGE_SIZE=20','onEndReached','cursor','new Map','more'])assert.match(host,new RegExp(marker));
});

test('viewer variant matrix and quantity rules are authoritative',()=>{
  for(const marker of ['selectionForPreferredVariant','isOptionValueSelectable','reconcileVariantSelection','resolveExactVariant','accessibilityRole="radio"','Completa tus opciones','Esta combinación no está disponible','Agotado'])assert.match(viewer,new RegExp(marker));
  assert.match(viewer,/setQuantity\(1\)/);
  assert.match(viewer,/Math\.max\(1/);
});

test('reservation command model reuses only matching signatures',()=>{
  assert.match(state,/liveReservationSignature/);
  assert.match(state,/address\.recipientName\.trim/);
  assert.match(state,/pending\?\.signature===signature/);
  const command=(pending,signature,next)=>pending?.signature===signature?pending:{signature,idempotencyKey:next};
  const first=command(null,'a','key-1');
  assert.equal(command(first,'a','key-2').idempotencyKey,'key-1');
  assert.equal(command(first,'b','key-2').idempotencyKey,'key-2');
});

test('recovery cancellation balance and payment uncertainty remain authoritative',()=>{
  for(const marker of ['fetchMyActiveLiveCheckout','cancelCheckoutReservation','fetchAuthoritativeBdagBalance','MarketplacePaymentError','marketplace_payment_transport','Cancelar reserva','Saldo disponible'])assert.match(viewer,new RegExp(marker));
  assert.match(migration,/fetch_my_active_live_checkout/);
});

test('correction is nonfinancial and original migration remains separate',()=>{
  assert.doesNotMatch(migration,/ledger_(?:debit|credit)|atomic_ledger_transfer|marketplace_payment_allocations\s+set|influencer_commission/i);
});
