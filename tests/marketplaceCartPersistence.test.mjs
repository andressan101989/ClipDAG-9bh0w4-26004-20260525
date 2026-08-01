/* global Buffer */
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import {readFileSync} from 'node:fs';

globalThis.__cartValidator=value=>Boolean(value&&value.key===`${value.productId}:${value.variantId}`&&value.currency==='BDAG'&&Number.isInteger(value.quantity)&&value.quantity>0&&/^https:\/\//.test(value.imageUrl??'https://valid'));
const source=readFileSync('services/marketplaceCartStorage.ts','utf8')
  .replace("import AsyncStorage from '@react-native-async-storage/async-storage';","const AsyncStorage={getItem:async()=>null,setItem:async()=>{}};")
  .replace(/^import \{ isMarketplaceCartItem, type MarketplaceCartItem \} from .*$/m,'const isMarketplaceCartItem=globalThis.__cartValidator;');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const storage=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const item={key:'p:v',productId:'p',variantId:'v',currency:'BDAG',quantity:1,imageUrl:null};

test('guest and authenticated keys are isolated',()=>{
  assert.equal(storage.marketplaceCartStorageKey(null),'onspace:marketplace-cart:v1:guest');
  assert.equal(storage.marketplaceCartStorageKey('user-a'),'onspace:marketplace-cart:v1:user:user-a');
  assert.notEqual(storage.marketplaceCartStorageKey('user-a'),storage.marketplaceCartStorageKey('user-b'));
});

test('malformed JSON, version mismatch and malformed entries restore safely',async()=>{
  for(const raw of ['{bad',JSON.stringify({version:2,items:[item]})]){
    const store=new storage.MarketplaceCartStorage({getItem:async()=>raw,setItem:async()=>{}});
    assert.deepEqual(await store.load('key'),[]);
  }
  const store=new storage.MarketplaceCartStorage({getItem:async()=>JSON.stringify({version:1,items:[item,{bad:true}]}),setItem:async()=>{}});
  assert.deepEqual(await store.load('key'),[item]);
});

test('serialized writes prevent an older slow write overwriting newer state and restore on remount',async()=>{
  let persisted=null;let first=true;
  const adapter={getItem:async()=>persisted,setItem:async(_key,value)=>{if(first){first=false;await new Promise(resolve=>setTimeout(resolve,20));}persisted=value;}};
  const writer=new storage.MarketplaceCartStorage(adapter);
  const oldWrite=writer.save('key',[item]);
  const newer={...item,quantity:2};const newWrite=writer.save('key',[newer]);
  await Promise.all([oldWrite,newWrite]);
  const remounted=new storage.MarketplaceCartStorage(adapter);
  assert.deepEqual(await remounted.load('key'),[newer]);
});
