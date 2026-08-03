/* global Buffer */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read=path=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const stateSource=read('services/liveCommerceState.ts').replace(/^import type .*$/m,'');
const stateJs=ts.transpileModule(stateSource,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const state=await import(`data:text/javascript;base64,${Buffer.from(stateJs).toString('base64')}`);
const viewer=read('components/live/commerce/LiveViewerCommerce.tsx');
const migration=read('supabase/migrations/20260802170000_fix_marketplace_payment_fulfillment_reconciliation.sql');
const verifier=read('scripts/verify-mkt-a4a-remote.mjs');

test('modal resets only on a closed-to-open transition',()=>{
  const next=state.stageAfterVisibilityChange;
  assert.equal(next(false,true,'product',false,false,'shelf'),'shelf');
  assert.equal(next(true,true,'product',false,false,'shelf'),'product');
  assert.equal(next(true,true,'shipping',false,false,'shelf'),'shipping');
  assert.equal(next(false,true,'reservation',true,false,'shelf'),'reservation');
  assert.equal(next(false,true,'success',false,true,'shelf'),'success');
  assert.match(viewer,/previousVisible/);
});

test('payment reconciliation accepts legitimate fulfillment states only',()=>{
  assert.match(migration,/order_status not in \('confirmed','processing','shipped','delivered'\)/);
  assert.match(migration,/'confirmed_state_breakdown'/);
  assert.match(migration,/'invalid_confirmed_state_details'/);
  for(const invalid of ['pending_payment','cancelled'])assert.doesNotMatch(migration,new RegExp(`'confirmed','processing','shipped','delivered',?'${invalid}`));
  assert.match(migration,/revoke all on function public\.reconcile_marketplace_payments\(\) from public,anon,authenticated/);
});

test('remote verifier fails closed on every reported invariant',()=>{
  for(const marker of ['candidate_page_lengths','source_identity','payment_state','checkout_state','order_state','inventory_delta','payment_count','allocation_count','source_count','financial_transaction_count','buyer_balance','escrow_balance','seller_balance','platform_balance'])assert.match(verifier,new RegExp(`assert\\(\\s*["']${marker}["']`));
});
