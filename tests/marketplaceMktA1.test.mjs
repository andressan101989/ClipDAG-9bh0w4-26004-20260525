import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const migration=read('supabase/migrations/20260727100000_marketplace_mkt_a1_seller_store_product_foundation.sql');
const service=read('services/marketplaceService.ts');
const context=read('contexts/ShopContext.tsx');
const create=read('app/create-product.tsx');
const detail=read('app/product/[id].tsx');
const profile=read('app/(tabs)/profile.tsx');

test('static contract: seller applications default pending and cannot self-approve',()=>{
  assert.match(migration,/status text not null default 'pending'/);
  assert.match(migration,/marketplace_actor_is_admin\(\)/);
  assert.match(migration,/approved_by=auth\.uid\(\)/);
  assert.match(migration,/approved_seller_required/);
  assert.match(migration,/grant execute on function public\.set_marketplace_seller_status[\s\S]*to service_role/);
});
test('static contract: seller, store, category and product authorization is server-derived',()=>{
  assert.match(migration,/v_user_id uuid:=auth\.uid\(\)/);
  assert.match(migration,/seller_id=v_user_id/);
  assert.match(migration,/active_owned_store_required/);
  assert.match(migration,/active_category_required/);
  assert.match(migration,/currency[^;]*'BDAG'/);
  assert.match(migration,/revoke insert,update,delete on public\.products from anon,authenticated/);
});
test('static contract: price uses fixed 8-decimal BDAG precision',()=>{
  assert.match(migration,/numeric\(20,8\)/);
  assert.match(migration,/price <> round\(price,8\)/);
  assert.match(migration,/marketplace_normalize_price/);
  assert.match(migration,/p_value<>round\(p_value,8\)/);
  assert.match(create,/máximo de 8 decimales/);
});
test('static contract: public discovery applies all moderation gates',()=>{
  for(const fragment of [
    "status='active'","moderation_status='approved'","deleted_at is null",
    "product_type='physical'","marketplace_seller_is_approved","s.status='active'","c.status='active'",
  ]) assert.ok(migration.includes(fragment),fragment);
  assert.match(migration,/revoke select on public\.products/);
  assert.doesNotMatch(migration,/grant select \([^)]*moderation_reason/);
});
test('static contract: R2 product and store media is owned, ready, ordered and bounded',()=>{
  assert.match(migration,/if v_count>4/);
  assert.match(migration,/owner_id=v_user_id and status='ready'/);
  assert.match(migration,/purpose='product_image'/);
  assert.match(migration,/purpose='store_logo'/);
  assert.match(migration,/purpose='store_banner'/);
  assert.match(migration,/entity_type='marketplace_store'/);
  assert.match(migration,/array_agg\(a\.public_url order by ids\.ordinality\)/);
  assert.match(migration,/delete from public\.media_asset_links[\s\S]*insert into public\.media_asset_links/);
});
test('static contract: legacy products are backfilled without replacing product ids',()=>{
  assert.match(migration,/Grandfather existing publishers/);
  assert.match(migration,/insert into public\.marketplace_sellers/);
  assert.match(migration,/update public\.products p[\s\S]*set store_id=s\.id/);
  assert.match(migration,/when status='active' then 'approved'/);
  assert.doesNotMatch(migration,/drop table\s+public\.products/i);
  assert.doesNotMatch(migration,/delete from public\.products/i);
});
test('client contract: product mutations use RPCs and never direct product writes',()=>{
  assert.match(service,/rpc\('create_marketplace_product'/);
  assert.match(service,/rpc\('update_marketplace_product'/);
  assert.match(service,/rpc\(published\?'publish_marketplace_product':'pause_marketplace_product'/);
  assert.match(service,/rpc\('soft_delete_marketplace_product'/);
  assert.doesNotMatch(service,/from\('products'\)\.insert/);
  assert.doesNotMatch(service,/from\('products'\)\.update/);
  assert.doesNotMatch(context,/from\('products'\)\.(insert|update|delete)/);
  assert.doesNotMatch(create,/create_product_with_media/);
});
test('client contract: deep link fetches by id and loading terminates',()=>{
  assert.match(detail,/fetchMarketplaceProductDetail\(id\)/);
  assert.match(detail,/finally\(\(\)=>\{if\(active\)setIsLoading\(false\)/);
  assert.match(detail,/Producto no disponible/);
});
test('client contract: seller gates creation and profile opens seller center',()=>{
  assert.match(create,/foundation\.seller\?\.status!=='approved'/);
  assert.match(create,/foundation\.store\.status!=='active'/);
  assert.match(profile,/router\.push\('\/seller'/);
});
test('scope contract: MKT-A1 contains no commerce or ledger mutation',()=>{
  const changed=[migration,service,context,create,detail].join('\n');
  assert.doesNotMatch(changed,/atomic_ledger_transfer|ledger_entries|create_order|checkout_marketplace/i);
});
