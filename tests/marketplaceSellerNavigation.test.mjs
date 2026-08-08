import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const header=read('components/marketplace/SellerScreenHeader.tsx');
const center=read('app/seller/index.tsx');
const apply=read('app/seller/apply.tsx');
const store=read('app/seller/store.tsx');
const products=read('app/seller/products.tsx');
const edit=read('app/seller/product-editor/[productId].tsx');

test('static client contract: shared header provides visible accessible history and fallback actions',()=>{
  assert.match(header,/MaterialIcons name="arrow-back-ios"/);
  assert.match(header,/accessibilityRole="button"/);
  assert.match(header,/accessibilityLabel=/);
  assert.match(header,/router\.canGoBack\(\)/);
  assert.match(header,/router\.back\(\)/);
  assert.match(header,/router\.replace\(fallbackRoute\)/);
  assert.match(header,/width:44,height:44/);
});

test('static client contract: Seller Center falls back to Profile and keeps seller actions',()=>{
  assert.match(center,/title="Centro de vendedor" fallbackRoute="\/\(tabs\)\/profile"/);
  assert.match(center,/Configurar tienda/);
  assert.match(center,/Mis productos/);
  assert.match(center,/Solicitar acceso/);
});

test('static client contract: every nested seller route has its deterministic fallback',()=>{
  assert.match(apply,/title="Solicitud de vendedor" fallbackRoute="\/seller"/);
  assert.match(store,/title="Configurar tienda" fallbackRoute="\/seller"/);
  assert.match(products,/title="Mis productos" fallbackRoute="\/seller"/);
  assert.match(edit,/router\.back\(\)/);
});

test('static client contract: no seller screen is a navigation dead end',()=>{
  for(const source of [center,apply,store,products]){
    assert.match(source,/SellerScreenHeader/);
  }
  assert.match(edit,/router\.back\(\)/);
});

test('scope contract: navigation fix does not reference database or commerce mutations',()=>{
  const changed=[header,center,apply,store,products,edit].join('\n');
  assert.doesNotMatch(changed,/supabase\/migrations|create_marketplace_product|create_order|ledger_entries/i);
});
