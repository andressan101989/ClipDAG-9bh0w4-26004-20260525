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

function loadService({invoke,fetchImpl,warnings=[]}) {
  class MockFile {
    constructor(uri) { this.uri=uri;this.name='photo.png';this.size=10; }
  }
  const supabase={
    functions:{invoke},
    rpc:async()=>({data:null,error:null}),
    auth:{getSession:async()=>({data:{session:null}})},
    from:()=>({select(){return this;},in(){return this;},eq(){return this;},maybeSingle:async()=>({data:null,error:null})}),
  };
  const module={exports:{}};
  const sandbox={
    module,exports:module.exports,setTimeout,clearTimeout,AbortController,Response,
    console:{...console,warn:(label,payload)=>warnings.push({label,payload})},
    require(specifier) {
      if(specifier==='expo-file-system') return {File:MockFile};
      if(specifier==='expo/fetch') return {fetch:fetchImpl};
      if(specifier==='expo-image-manipulator') {
        return {manipulateAsync:async()=>({uri:'file:///converted.jpg'}),SaveFormat:{JPEG:'jpeg'}};
      }
      if(specifier==='@/template') return {getSupabaseClient:()=>supabase};
      throw new Error(`Unexpected module: ${specifier}`);
    },
  };
  vm.runInNewContext(compiled,sandbox,{filename:'mediaService.js'});
  return module.exports;
}

const ok=()=>({ok:true,status:200});
const http=status=>({ok:false,status});
const noDelay=async()=>{};
const baseInput=fetcher=>({
  file:{uri:'file:///photo.png'},uploadUrl:'https://signed.invalid/secret',
  headers:{'Content-Type':'image/png'},signal:new AbortController().signal,
  operationId:'op-safe',mimeType:'image/png',fetcher,sleep:noDelay,
});
const emptyInvoke=async()=>({data:null,error:null});
const service=loadService({invoke:emptyInvoke,fetchImpl:async()=>ok()});

let calls=0;
await service.putFileToR2WithRetry(baseInput(async()=>{calls++;return ok();}));
assert.equal(calls,1);

calls=0;
await service.putFileToR2WithRetry(baseInput(async()=>{
  calls++;
  if(calls===1) throw new Error('fetch failed: The network connection was lost.');
  return ok();
}));
assert.equal(calls,2);

calls=0;
await service.putFileToR2WithRetry(baseInput(async()=>{
  calls++;
  if(calls<3) throw new Error('ECONNRESET');
  return ok();
}));
assert.equal(calls,3);

for(const status of [503,429]) {
  calls=0;
  await service.putFileToR2WithRetry(baseInput(async()=>++calls===1?http(status):ok()));
  assert.equal(calls,2);
}
for(const status of [403,413]) {
  calls=0;
  await assert.rejects(
    service.putFileToR2WithRetry(baseInput(async()=>{calls++;return http(status);})),
    error=>error.stage==='MEDIA_R2_PUT'&&error.code===`media_upload_http_${status}`,
  );
  assert.equal(calls,1);
}

calls=0;
await assert.rejects(
  service.putFileToR2WithRetry(baseInput(async()=>{
    calls++;
    const error=new Error('cancelled');error.name='AbortError';throw error;
  })),
  error=>error.stage==='MEDIA_R2_PUT'&&error.code==='aborted',
);
assert.equal(calls,1);

const aborted=new AbortController();aborted.abort();calls=0;
await assert.rejects(
  service.putFileToR2WithRetry({...baseInput(async()=>{calls++;return ok();}),signal:aborted.signal}),
  error=>error.stage==='MEDIA_R2_PUT'&&error.code==='aborted',
);
assert.equal(calls,0);

calls=0;
const finalError=await service.putFileToR2WithRetry(baseInput(async()=>{
  calls++;throw new Error('network request failed');
})).catch(error=>error);
assert.equal(calls,3);
assert.equal(finalError.stage,'MEDIA_R2_PUT');
assert.equal(finalError.operationId,'op-safe');
assert.equal(finalError.attempts,3);

let createCalls=0,finalizeCalls=0,putCalls=0;
const warnings=[];
const integrated=loadService({
  warnings,
  invoke:async name=>{
    if(name==='create-media-upload') {
      createCalls++;
      return {data:{success:true,data:{
        assetId:'one-asset',uploadUrl:'https://signed.invalid/private',
        method:'PUT',headers:{'Content-Type':'image/png'},expiresAt:'soon',
      }},error:null};
    }
    if(name==='finalize-media-upload') {
      finalizeCalls++;
      return {data:{success:true,data:{
        assetId:'one-asset',provider:'r2',mediaKind:'image',purpose:'product_image',
        visibility:'public',status:'ready',url:'https://public.invalid/photo.png',
      }},error:null};
    }
    return {data:null,error:null};
  },
  fetchImpl:async()=>{
    putCalls++;
    if(putCalls<3) throw new Error('fetch failed: The network connection was lost.');
    return ok();
  },
});
const uploaded=await integrated.uploadMediaFromUri({
  uri:'file:///photo.png',purpose:'product_image',mimeType:'image/png',
  visibility:'public',timeoutMs:10_000,
});
assert.equal(uploaded.assetId,'one-asset');
assert.equal(createCalls,1);
assert.equal(putCalls,3);
assert.equal(finalizeCalls,1);
assert.equal(warnings.length,2);
assert.ok(warnings.every(entry=>entry.label==='[MediaService] R2 PUT transient failure'));
assert.ok(warnings.every(entry=>!JSON.stringify(entry).includes('signed.invalid')));
assert.ok(warnings.every(entry=>!('assetId' in entry.payload)));

const carouselSource=fs.readFileSync(path.join(root,'app/(tabs)/upload.tsx'),'utf8');
assert.match(carouselSource,/CAROUSEL_RECONCILED_AFTER_AMBIGUOUS_RESPONSE/);
const productSource=fs.readFileSync(path.join(root,'app/create-product.tsx'),'utf8');
assert.doesNotMatch(productSource,/uploadMediaFromUri\([\s\S]{0,400}\)\.catch\(\(\)\s*=>\s*null\)/);

console.log('mediaR2PutRetry.test.mjs: PASS');
