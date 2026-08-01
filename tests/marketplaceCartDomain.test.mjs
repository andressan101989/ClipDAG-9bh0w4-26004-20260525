/* global Buffer */
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import {readFileSync} from 'node:fs';

const source=readFileSync('services/marketplaceCart.ts','utf8').replace(/^import type .*$/m,'');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const cart=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const optionValue=(value='M')=>[{optionId:'size',optionName:'Talla',valueId:`size-${value}`,value}];
const input=(overrides={})=>({productId:'product-1',variantId:'variant-m',sellerId:'seller',storeId:'store',title:'Camisa',sellerUsername:'ana',sku:'SKU-M',imageUrl:'https://cdn/item.jpg',options:optionValue(),currency:'BDAG',unitPrice:10,compareAtPrice:12,quantity:1,availableQuantitySnapshot:5,productUpdatedAt:null,...overrides});

test('identity merges exact variants but keeps different variants and products separate',()=>{
  let state=[];
  let mutation=cart.addMarketplaceCartItem(state,input({quantity:2}));state=mutation.items;
  mutation=cart.addMarketplaceCartItem(state,input({quantity:1,options:optionValue('label-does-not-control-id')}));state=mutation.items;
  assert.equal(mutation.result.status,'merged');assert.equal(state[0].quantity,3);assert.equal(state[0].key,'product-1:variant-m');
  state=cart.addMarketplaceCartItem(state,input({variantId:'variant-l',options:optionValue('L')})).items;
  state=cart.addMarketplaceCartItem(state,input({productId:'product-2'})).items;
  assert.equal(state.length,3);assert.deepEqual(state.map(item=>item.key),['product-1:variant-m','product-1:variant-l','product-2:variant-m']);
});

test('quantities reject invalid values, clamp merges, stop at one, and remove one exact line',()=>{
  for(const quantity of [0,-1,NaN,1.5])assert.equal(cart.addMarketplaceCartItem([],input({quantity})).result.ok,false);
  let state=cart.addMarketplaceCartItem([],input({quantity:4})).items;
  const clamped=cart.addMarketplaceCartItem(state,input({quantity:4}));
  assert.equal(clamped.result.status,'quantity_adjusted');assert.equal(clamped.result.applied,5);state=clamped.items;
  assert.equal(cart.setMarketplaceCartQuantity(state,state[0].key,0).result.code,'invalid_quantity');
  assert.equal(cart.setMarketplaceCartQuantity(state,state[0].key,1).result.item.quantity,1);
  const second=cart.addMarketplaceCartItem(state,input({variantId:'variant-l'})).items;
  assert.deepEqual(second.filter(item=>item.key!=='product-1:variant-l').map(item=>item.key),['product-1:variant-m']);
});

test('local and signed image URLs are rejected from persistence inputs',()=>{
  assert.equal(cart.addMarketplaceCartItem([],input({imageUrl:'file:///photo.jpg'})).result.code,'invalid_item');
  assert.equal(cart.addMarketplaceCartItem([],input({imageUrl:'https://private.test/a?token=secret'})).result.code,'invalid_item');
});

test('totals include only valid available BDAG lines and never produce NaN',()=>{
  const available=cart.addMarketplaceCartItem([],input({quantity:2,unitPrice:12.5})).items[0];
  const unavailable={...available,key:'product-1:variant-l',variantId:'variant-l',quantity:4,unitPrice:99,availability:'out_of_stock'};
  const malformed={...available,key:'product-2:variant-m',productId:'product-2',unitPrice:NaN};
  assert.deepEqual(cart.marketplaceCartTotals([available,unavailable,malformed]),{totalQuantity:8,distinctItemCount:3,availableItemCount:2,subtotal:25});
  assert.equal(available.currency,'BDAG');
});

const detail=(variants,overrides={})=>({product:{id:'product-1',seller_id:'seller',store_id:'store',title:'Camisa nueva',status:'active',updated_at:'now',seller:{username:'nueva'},...overrides},options:[{id:'size',name:'Talla',values:[{id:'size-M',value:'M'}]}],variants});
const variant=(overrides={})=>({id:'variant-m',status:'active',price:15,compare_at_price:20,available_quantity:3,image_url:'https://cdn/new.jpg',sku:'NEW',option_value_ids:['size-M'],...overrides});

test('revalidation deduplicates products and refreshes price, inventory, image and option labels',async()=>{
  const items=[cart.addMarketplaceCartItem([],input({quantity:5})).items[0],cart.addMarketplaceCartItem([],input({variantId:'variant-l'})).items[0]];
  let requests=0;
  const result=await cart.revalidateMarketplaceCartItems(items,async()=>{requests++;return detail([variant(),variant({id:'variant-l',price:18,available_quantity:2})]);});
  assert.equal(requests,1);assert.equal(result.adjustedItemCount,1);assert.deepEqual(result.priceChangedKeys,['product-1:variant-m','product-1:variant-l']);
  assert.deepEqual({price:result.items[0].unitPrice,stock:result.items[0].availableQuantitySnapshot,quantity:result.items[0].quantity,image:result.items[0].imageUrl},{price:15,stock:3,quantity:3,image:'https://cdn/new.jpg'});
});

test('revalidation retains unavailable lines and preserves snapshots on network failure',async()=>{
  const item=cart.addMarketplaceCartItem([],input()).items[0];
  const zero=await cart.revalidateMarketplaceCartItems([item],async()=>detail([variant({available_quantity:0})]));
  assert.equal(zero.items[0].availability,'out_of_stock');assert.equal(cart.marketplaceCartTotals(zero.items).subtotal,0);
  const inactive=await cart.revalidateMarketplaceCartItems([item],async()=>detail([variant({status:'inactive'})]));
  assert.equal(inactive.items[0].availability,'variant_unavailable');
  const missing=await cart.revalidateMarketplaceCartItems([item],async()=>null);
  assert.equal(missing.items[0].availability,'product_unavailable');
  const failed=await cart.revalidateMarketplaceCartItems([item],async()=>{throw new Error('network');});
  assert.equal(failed.complete,false);assert.deepEqual(failed.items,[item]);
});
