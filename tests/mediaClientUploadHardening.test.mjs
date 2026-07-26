import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root=path.resolve(import.meta.dirname,'..');
const source=fs.readFileSync(path.join(root,'services/mediaService.ts'),'utf8');
const compiled=ts.transpileModule(source,{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
}).outputText;

class MockFile {
  constructor(uri) { this.uri=uri;this.name=uri.split('/').pop()||'file';this.size=uri.includes('converted')?321:123; }
}
const supabase={
  functions:{invoke:async()=>({data:null,error:null})},
  rpc:async()=>({data:null,error:null}),
  auth:{getSession:async()=>({data:{session:null}})},
  from:()=>({select(){return this;},in(){return this;},eq(){return this;},maybeSingle:async()=>({data:null,error:null})}),
};
const module={exports:{}};
const sandbox={
  module,exports:module.exports,console,setTimeout,clearTimeout,AbortController,Response,
  require(specifier) {
    if(specifier==='expo-file-system') return {File:MockFile};
    if(specifier==='expo/fetch') return {fetch:async()=>new Response()};
    if(specifier==='expo-image-manipulator') {
      return {manipulateAsync:async()=>({uri:'file:///converted.jpg'}),SaveFormat:{JPEG:'jpeg'}};
    }
    if(specifier==='@/template') return {getSupabaseClient:()=>supabase};
    throw new Error(`Unexpected module: ${specifier}`);
  },
};
vm.runInNewContext(compiled,sandbox,{filename:'mediaService.js'});
const policy=module.exports;

assert.equal(policy.shouldNormalizeImageForR2('image/jpeg','file:///photo.jpg'),false);
assert.equal(policy.shouldNormalizeImageForR2('image/png','file:///photo.png'),false);
assert.equal(policy.shouldNormalizeImageForR2('image/heic','file:///photo.heic'),true);
assert.equal(policy.shouldNormalizeImageForR2('image/heif','file:///photo.heif'),true);
assert.equal(policy.shouldNormalizeImageForR2('image/jpeg','file:///photo.HEIC'),true);
assert.equal(policy.shouldNormalizeImageForR2('audio/mpeg','file:///voice.mp3'),false);
assert.equal(policy.shouldNormalizeImageForR2('application/pdf','file:///doc.pdf'),false);

const converted=await policy.normalizeImageForR2Upload(
  {uri:'file:///photo.heic',mimeType:'image/heic',fileName:'photo.heic',sizeBytes:999,purpose:'product_image'},
  async()=>({uri:'file:///converted.jpg'}),
);
assert.equal(converted.mimeType,'image/jpeg');
assert.equal(converted.fileName,'photo.jpg');
assert.equal(converted.sizeBytes,321);
assert.notEqual(converted.sizeBytes,999);
assert.equal((await policy.normalizeImageForR2Upload(
  {uri:'file:///photo.jpg',mimeType:'image/jpeg',sizeBytes:123,purpose:'post_image'},
  async()=>{throw new Error('must not convert');},
)).uri,'file:///photo.jpg');
assert.equal((await policy.normalizeImageForR2Upload(
  {uri:'file:///voice.bin',mimeType:'application/octet-stream',sizeBytes:123,purpose:'chat_audio'},
  async()=>{throw new Error('must not convert audio');},
)).uri,'file:///voice.bin');

const uuid='123e4567-e89b-42d3-a456-426614174000';
assert.equal(policy.extractRpcUuid(uuid,'create_carousel_post'),uuid);
assert.equal(policy.extractRpcUuid({create_carousel_post:uuid},'create_carousel_post'),uuid);
assert.equal(policy.extractRpcUuid({id:uuid},'create_carousel_post'),uuid);
assert.equal(policy.extractRpcUuid([{id:uuid}],'create_carousel_post'),uuid);
assert.throws(()=>policy.extractRpcUuid([uuid,uuid],'create_carousel_post'),/invalid/);
assert.throws(()=>policy.extractRpcUuid('not-a-uuid','create_carousel_post'),/invalid/);

assert.equal(policy.isRetryableAuthRpcError({code:'42501'}),true);
assert.equal(policy.isRetryableAuthRpcError({message:'JWT expired'}),true);
assert.equal(policy.isRetryableAuthRpcError({status:401}),true);
assert.equal(policy.isRetryableAuthRpcError({code:'22023',message:'invalid_media_count'}),false);
assert.equal(policy.isRetryableAuthRpcError({message:'network timeout'}),false);
let invokes=0,refreshes=0;
const retried=await policy.invokeRpcWithSingleAuthRefresh(
  async()=>++invokes===1?{data:null,error:{code:'42501'}}:{data:uuid,error:null},
  async()=>{refreshes++;return {error:null};},
);
assert.equal(retried.data,uuid);
assert.equal(invokes,2);
assert.equal(refreshes,1);
invokes=0;refreshes=0;
const validation=await policy.invokeRpcWithSingleAuthRefresh(
  async()=>{invokes++;return {data:null,error:{code:'22023'}};},
  async()=>{refreshes++;return {error:null};},
);
assert.equal(validation.error.code,'22023');
assert.equal(invokes,1);
assert.equal(refreshes,0);
const refreshFailure=await policy.invokeRpcWithSingleAuthRefresh(
  async()=>({data:null,error:{code:'42501'}}),
  async()=>({error:{code:'refresh_failed'}}),
);
assert.equal(refreshFailure.error.code,'refresh_failed');

const assets=['a','b'];
assert.equal(policy.validateCommonLinkedEntityRows(assets,[
  {asset_id:'a',entity_id:'post',position:0,slot:'media'},
  {asset_id:'b',entity_id:'post',position:1,slot:'media'},
]),'post');
assert.equal(policy.validateCommonLinkedEntityRows(assets,[
  {asset_id:'a',entity_id:'one',position:0,slot:'media'},
  {asset_id:'b',entity_id:'two',position:1,slot:'media'},
]),null);
assert.equal(policy.validateCommonLinkedEntityRows(assets,[
  {asset_id:'a',entity_id:'post',position:0,slot:'media'},
  {asset_id:'b',entity_id:'post',position:2,slot:'media'},
]),null);

const productSource=fs.readFileSync(path.join(root,'app/create-product.tsx'),'utf8');
assert.doesNotMatch(productSource,/uploadMediaFromUri\([\\s\\S]{0,400}\)\.catch\(\(\)\s*=>\s*null\)/);
assert.match(productSource,/finally\s*\{\s*setIsUploadingImage\(false\)/);
assert.match(productSource,/\[CreateProduct\] product image upload failed/);

const feedSource=fs.readFileSync(path.join(root,'contexts/FeedContext.tsx'),'utf8');
for(const field of ['message','details','hint','operationId']) assert.match(feedSource,new RegExp(field));
assert.match(feedSource,/refreshSession\(\)/);
assert.equal((feedSource.match(/refreshSession\(\)/g)||[]).length,1);
assert.match(feedSource,/invokeRpcWithSingleAuthRefresh/);

const uploadSource=fs.readFileSync(path.join(root,'app/(tabs)/upload.tsx'),'utf8');
assert.match(uploadSource,/findCommonLinkedEntityForAssets/);
assert.match(uploadSource,/CAROUSEL_RECONCILED_AFTER_AMBIGUOUS_RESPONSE/);
assert.match(uploadSource,/\[250,750,1500\]/);
assert.match(uploadSource,/if\(reconciledPostId\)[\s\S]*completedUploads\.fill\(undefined\)/);
assert.match(uploadSource,/if\(reconciledPostId\)[\s\S]*return;/);
assert.doesNotMatch(uploadSource,/console\.(?:warn|log)\([^)]*(?:uploadUrl|Authorization|access_token)/i);

console.log('mediaClientUploadHardening.test.mjs: PASS');
