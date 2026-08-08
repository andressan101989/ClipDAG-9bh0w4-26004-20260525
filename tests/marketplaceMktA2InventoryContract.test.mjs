import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const base=read('supabase/migrations/20260727120000_marketplace_mkt_a2_variants_inventory.sql');
const corrective=read('supabase/migrations/20260727121000_fix_mkt_a2_existing_inventory_contract.sql');
const seller=read('app/seller/product/[id]/variants.tsx');

test('static SQL contract: corrective migration wraps rather than edits deployed behavior',()=>{
  assert.match(corrective,/rename to configure_marketplace_product_variants_mkt_a2_original/);
  assert.match(corrective,/configure_marketplace_product_variants_mkt_a2_original\(/);
  assert.match(corrective,/revoke all on function public\.configure_marketplace_product_variants_mkt_a2_original[\s\S]*authenticated/);
  assert.match(corrective,/grant execute on function public\.configure_marketplace_product_variants\([\s\S]*authenticated/);
});

test('static SQL contract: existing on-hand is locked and changed values are rejected',()=>{
  assert.match(corrective,/from public\.marketplace_inventory_levels[\s\S]*for update/);
  assert.match(corrective,/v_supplied_on_hand<>v_authoritative_on_hand/);
  assert.match(corrective,/marketplace_existing_inventory_requires_inventory_action/);
  assert.match(corrective,/v_supplied_on_hand<0 or v_supplied_on_hand>1000000000/);
});

test('unit model: unchanged existing inventory succeeds and changed inventory is rejected without movement',()=>{
  const configureExisting=({authoritative,supplied,movements})=>{
    if(supplied!==authoritative) return {ok:false,onHand:authoritative,movements};
    return {ok:true,onHand:authoritative,movements};
  };
  assert.deepEqual(configureExisting({authoritative:12,supplied:12,movements:4}),
    {ok:true,onHand:12,movements:4});
  assert.deepEqual(configureExisting({authoritative:12,supplied:9,movements:4}),
    {ok:false,onHand:12,movements:4});
});

test('static SQL contract: threshold changes are bounded and do not alter quantity, reserved, version, or history',()=>{
  assert.match(corrective,/v_threshold<0 or v_threshold>1000000000/);
  assert.match(corrective,/set low_stock_threshold=v_threshold/);
  const thresholdUpdate=corrective.match(/update public\.marketplace_inventory_levels[\s\S]*?where variant_id=\(v_result_variant->>'id'\)::uuid;/)?.[0]??'';
  assert.doesNotMatch(thresholdUpdate,/on_hand\s*=/);
  assert.doesNotMatch(thresholdUpdate,/reserved\s*=/);
  assert.doesNotMatch(thresholdUpdate,/version\s*=/);
  assert.doesNotMatch(corrective,/insert into public\.marketplace_inventory_movements/);
});

test('static SQL contract: new variants retain one initial level and movement',()=>{
  const configure=base.slice(
    base.indexOf('create or replace function public.configure_marketplace_product_variants'),
    base.indexOf('create or replace function public.create_marketplace_product'),
  );
  assert.match(configure,/insert into public\.marketplace_inventory_levels/);
  assert.equal((configure.match(/insert into public\.marketplace_inventory_movements/g)??[]).length,1);
  assert.match(configure,/'initial'/);
  assert.match(configure,/perform public\.refresh_marketplace_product_projection/);
});

test('static SQL contract: set/adjust inventory remain movement-backed and idempotent',()=>{
  assert.match(base,/set_marketplace_variant_inventory/);
  assert.match(base,/adjust_marketplace_variant_inventory/);
  assert.match(base,/'seller_set'/);
  assert.match(base,/'seller_adjust'/);
  assert.match(base,/marketplace_inventory_idempotency_unique/);
  assert.match(base,/marketplace_idempotency_conflict/);
  assert.match(base,/perform public\.refresh_marketplace_product_projection/);
});

test('client contract: existing inventory uses authoritative set and adjustment actions',()=>{
  assert.match(seller,/>Stock</);
  assert.match(seller,/Guardar precio y stock/);
  assert.match(seller,/Corrección rápida/);
  assert.match(seller,/setVariantInventory/);
  assert.match(seller,/adjustVariantInventory/);
  assert.match(seller,/marketplace_existing_inventory_requires_inventory_action/);
});

test('client contract: configuration message is accurate and new variants accept initial inventory',()=>{
  assert.match(seller,/Las variantes fueron guardadas y las proyecciones del producto se actualizaron/);
  assert.doesNotMatch(seller,/Precio e inventario del producto fueron recalculados/);
  assert.match(seller,/>Stock</);
  assert.match(seller,/value=\{variant\.onHand\} keyboardType="number-pad"[\s\S]*updateDraft\(index,\{onHand,setOnHand:onHand\}\)/);
  assert.match(seller,/on_hand:Math\.max\(0,Number\.parseInt\(item\.onHand/);
});

test('scope contract: correction introduces no commerce or financial behavior',()=>{
  const changed=corrective+'\n'+seller;
  assert.doesNotMatch(changed,/create table public\.(cart|orders|order_items)|checkout|ledger_entries|atomic_ledger_transfer|bdag_transfer/i);
});
