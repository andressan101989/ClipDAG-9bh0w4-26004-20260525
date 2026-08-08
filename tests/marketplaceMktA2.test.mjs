import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const sql=read('supabase/migrations/20260727120000_marketplace_mkt_a2_variants_inventory.sql');
const service=read('services/marketplaceService.ts');
const detail=read('app/product/[id].tsx');
const selection=read('services/marketplaceVariantSelection.ts');
const seller=read('app/seller/product/[id]/variants.tsx');
const edit=read('app/seller/product-editor/[productId].tsx');
const shop=read('app/(tabs)/shop.tsx');

test('static contract: options and values are bounded and server-only',()=>{
  assert.match(sql,/create table public\.marketplace_product_options/);
  assert.match(sql,/position between 0 and 2/);
  assert.match(sql,/create unique index marketplace_product_options_name_unique/);
  assert.match(sql,/create table public\.marketplace_product_option_values/);
  assert.match(sql,/position between 0 and 19/);
  assert.match(sql,/revoke all on public\.marketplace_product_options/);
});
test('static contract: variants enforce canonical SKU, money and combinations',()=>{
  assert.match(sql,/marketplace_normalize_sku/);
  assert.match(sql,/\^\[A-Z0-9\._-\]\+\$/);
  assert.match(sql,/marketplace_variants_store_sku_unique/);
  assert.match(sql,/numeric\(20,8\)/);
  assert.match(sql,/marketplace_variants_combination_unique/);
  assert.match(sql,/marketplace_incomplete_combination/);
  assert.match(sql,/marketplace_duplicate_combination/);
  assert.match(sql,/marketplace_exactly_one_default_required/);
});
test('static contract: every existing product is backfilled once',()=>{
  assert.match(sql,/where p\.deleted_at is null[\s\S]*not exists\(select 1 from public\.marketplace_product_variants/);
  assert.match(sql,/'backfill'/);
  assert.match(sql,/marketplace_backfill_default_variant_failed/);
  assert.match(sql,/marketplace_backfill_ownership_failed/);
  assert.doesNotMatch(sql,/delete from public\.products/i);
  assert.doesNotMatch(sql,/delete from public\.product_saves/i);
});
test('static contract: inventory is locked, versioned, idempotent and nonnegative',()=>{
  assert.match(sql,/marketplace_inventory_levels/);
  assert.match(sql,/marketplace_inventory_movements/);
  assert.match(sql,/for update/);
  assert.match(sql,/version=version\+1/);
  assert.match(sql,/marketplace_inventory_idempotency_unique/);
  assert.match(sql,/marketplace_idempotency_conflict/);
  assert.match(sql,/v_result<l\.reserved or v_result<0/);
  assert.match(sql,/marketplace_inventory_movements_append_only/);
});
test('static contract: compatibility projections are atomic and publication-independent',()=>{
  assert.match(sql,/refresh_marketplace_product_projection/);
  assert.match(sql,/min\(v\.price\)/);
  assert.match(sql,/sum\(greatest\(l\.on_hand-l\.reserved,0\)\)/);
  assert.doesNotMatch(sql,/set status='paused'[\s\S]*on_hand/i);
  assert.match(sql,/revoke insert,update,delete on public\.products from anon,authenticated/);
});
test('static contract: product creation creates default variant and initial movement',()=>{
  assert.match(sql,/create or replace function public\.create_marketplace_product/);
  assert.match(sql,/insert into public\.marketplace_product_variants/);
  assert.match(sql,/is_default,combination_key/);
  assert.match(sql,/'initial'/);
  assert.match(sql,/revoke execute on function public\.create_product_with_media/);
});
test('static contract: seller isolation and public safety are enforced',()=>{
  assert.match(sql,/seller_id=auth\.uid\(\)/);
  assert.match(sql,/p\.status='active'/);
  assert.match(sql,/v\.status='active'/);
  assert.match(sql,/marketplace_inventory_movements_read_owned/);
  assert.doesNotMatch(sql,/grant select on public\.marketplace_inventory_movements to anon/);
  const publicMovement=service.match(/export interface MarketplaceInventoryMovement \{([\s\S]*?)\}/)?.[1]??'';
  assert.doesNotMatch(publicMovement,/idempotency_key/);
});
test('client contract: canonical detail resolves authoritative combinations',()=>{
  assert.match(service,/fetchMarketplaceProductDetail/);
  assert.match(detail,/isOptionValueSelectable/);
  assert.match(detail,/reconcileVariantSelection/);
  assert.match(detail,/resolveExactVariant/);
  assert.match(selection,/variant\.status === 'active'/);
  assert.match(selection,/variant\.option_value_ids\.length === options\.length/);
  assert.match(detail,/selectedVariant\?\.price/);
  assert.match(detail,/Completa tus opciones/);
  assert.match(detail,/Esta combinación está agotada/);
  assert.match(detail,/Producto agotado/);
  assert.match(detail,/accessibilityRole="radio"/);
  assert.match(detail,/accessibilityState=\{\{selected,disabled:!enabled\}\}/);
  assert.match(detail,/accessibilityLabel=\{`\$\{option\.name\} \$\{value\.value\}`\}/);
  assert.match(detail,/setQuantity\(1\)/);
  assert.match(detail,/Math\.min\(available, q \+ 1\)/);
  assert.match(detail,/selectedVariant\?\.image_url/);
  assert.match(detail,/selectedVariant\?\.available_quantity/);
  assert.match(detail,/selectedVariant\?\.compare_at_price/);
  assert.match(detail,/fetchMarketplaceProductDetail\(id\)/);
});
test('client contract: seller can configure and mutate inventory without duplicate submit',()=>{
  assert.match(seller,/configureProductVariants/);
  assert.match(seller,/setVariantInventory/);
  assert.match(seller,/adjustVariantInventory/);
  assert.match(seller,/actionLock\.current/);
  assert.match(seller,/randomUUID\(\)/);
  assert.match(seller,/Cambios sin guardar/);
  assert.match(edit,/Administrar variantes|Agregar color, talla u otra opción/);
});
test('client contract: cards use projections without N+1 variant reads',()=>{
  assert.match(shop,/variant_price_max/);
  assert.match(shop,/Agotado/);
  assert.doesNotMatch(shop,/fetchMarketplaceProductDetail/);
});
test('scope contract: no checkout, order, ledger or BDAG mutation was introduced',()=>{
  const changed=[sql,service,detail,seller,edit,shop].join('\n');
  assert.doesNotMatch(changed,/create table public\.(orders|order_items|cart)|atomic_ledger_transfer|ledger_entries/i);
  assert.doesNotMatch(sql,/reserved\s*=\s*p_/i);
});
