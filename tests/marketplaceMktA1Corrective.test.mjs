import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const service=read('services/marketplaceService.ts');
const migration=read('supabase/migrations/20260727110000_fix_marketplace_seller_restore.sql');
const original=read('supabase/migrations/20260727100000_marketplace_mkt_a1_seller_store_product_foundation.sql');
const sellerList=read('supabase/migrations/20260805102000_restore_seller_product_list.sql');
const hardening=read('supabase/migrations/20260811033000_marketplace_production_hardening.sql');

function ownedRows(rows,userId,key){return rows.filter(row=>row[key]===userId);}

test('unit model: two active public stores still resolve only the authenticated seller store',()=>{
  const stores=[
    {id:'store-a',seller_id:'seller-a',status:'active'},
    {id:'store-b',seller_id:'seller-b',status:'active'},
  ];
  assert.deepEqual(ownedRows(stores,'seller-a','seller_id'),[stores[0]]);
  assert.match(service,/auth\.getUser\(\)/);
  assert.match(service,/from\('marketplace_sellers'\)[\s\S]*\.eq\('user_id',user\.id\)\.maybeSingle\(\)/);
  assert.match(service,/from\('marketplace_stores'\)[\s\S]*\.eq\('seller_id',user\.id\)\.maybeSingle\(\)/);
  assert.doesNotMatch(service,/fetchSellerFoundation\([^)]*sellerId/);
});

test('unit model: seller dashboard excludes another seller public products',()=>{
  const products=[
    {id:'a-private',seller_id:'seller-a',status:'paused'},
    {id:'a-public',seller_id:'seller-a',status:'active'},
    {id:'b-public',seller_id:'seller-b',status:'active'},
  ];
  assert.deepEqual(ownedRows(products,'seller-a','seller_id').map(row=>row.id),['a-private','a-public']);
  const start=service.indexOf('export async function fetchMyProducts');
  const end=service.indexOf('export async function fetchSellerFoundation');
  const block=service.slice(start,end);
  assert.match(block,/rpc\('fetch_my_marketplace_products_v2'/);
  assert.match(hardening,/p\.seller_id=actor/);
  assert.match(hardening,/p\.status<>'deleted'/);
  assert.match(hardening,/p_limit is null or p_limit<1 or p_limit>100/);
  assert.doesNotMatch(block,/sellerId\s*:/);
});

test('static client contract: public discovery remains cross-seller and unchanged',()=>{
  const start=service.indexOf('export async function fetchProducts');
  const end=service.indexOf('export async function fetchProduct(productId');
  const block=service.slice(start,end);
  assert.match(block,/rpc\('fetch_public_marketplace_products'/);
  assert.doesNotMatch(block,/auth\.getUser\(\)/);
  assert.match(block,/p_seller_id:opts\?\.sellerId/);
  assert.match(sellerList,/p\.status='active'/);
  assert.match(sellerList,/p\.currency='BDAG'/);
});

test('static database contract: suspension preserves the store lifecycle state',()=>{
  const start=migration.indexOf('function public.set_marketplace_seller_status');
  const end=migration.indexOf('create or replace function public.restore_marketplace_seller');
  const block=migration.slice(start,end);
  assert.match(block,/marketplace_admin_required/);
  assert.match(block,/seller_self_moderation_forbidden/);
  assert.doesNotMatch(block,/update public\.marketplace_stores/);
});

test('static database contract: restore repairs the store but not products',()=>{
  const start=migration.indexOf('function public.restore_marketplace_seller');
  const block=migration.slice(start);
  assert.match(block,/set status='approved'/);
  assert.match(block,/update public\.marketplace_stores[\s\S]*set status='active'[\s\S]*status='suspended'/);
  assert.doesNotMatch(block,/update public\.products/);
  assert.match(block,/marketplace_admin_required/);
  assert.match(block,/seller_self_moderation_forbidden/);
});

test('static permissions: direct writes and legacy creator stay revoked',()=>{
  assert.match(original,/revoke insert,update,delete on public\.products from anon,authenticated/);
  assert.match(migration,/revoke execute on function public\.create_product_with_media[\s\S]*from public,anon,authenticated/);
  assert.match(migration,/set search_path=public/);
  assert.match(migration,/grant execute on function public\.set_marketplace_seller_status[\s\S]*to service_role/);
});
