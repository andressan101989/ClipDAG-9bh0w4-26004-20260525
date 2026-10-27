import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const storyId='10000000-0000-4000-8000-000000000001';
const ownerId='20000000-0000-4000-8000-000000000001';
const assetId='30000000-0000-4000-8000-000000000001';
const otherId='40000000-0000-4000-8000-000000000001';
const detail={id:storyId,owner:{id:ownerId},story_kind:'media',media_type:'video',resolved_media_kind:'video',media_origin:'story_stream_asset',source_status:'available',video_asset_id:assetId};
const link={asset_id:assetId,owner_id:ownerId,entity_type:'story',entity_id:storyId,slot:'media',position:0};
const asset={id:assetId,owner_id:ownerId,purpose:'story_video',provider:'cloudflare_stream',visibility:'private',status:'ready',deleted_at:null,cloudflare_uid:'private-provider-id',hls_url:null,dash_url:null,thumbnail_url:null,provider_metadata:{require_signed_urls:true},duration_seconds:12};
const grant={hlsUrl:'https://customer-code.cloudflarestream.com/signed-token/manifest/video.m3u8',dashUrl:'https://customer-code.cloudflarestream.com/signed-token/manifest/video.mpd',thumbnailUrl:'https://customer-code.cloudflarestream.com/signed-token/thumbnails/thumbnail.jpg',expiresAt:new Date(Date.now()+300000).toISOString()};

function rowsChain(rows){
  const filters=[];
  const chain={select:()=>chain,eq:(field,value)=>{filters.push([field,value]);return chain},limit:()=>chain,
    maybeSingle:async()=>({data:rows.find(row=>filters.every(([field,value])=>row[field]===value))??null,error:null}),
    then(resolve,reject){return Promise.resolve({data:rows.filter(row=>filters.every(([field,value])=>row[field]===value)),error:null}).then(resolve,reject)}};
  return chain;
}

function harness({capability=true,projection=detail,links=[link],assets=[asset],visible=true}={}){
  let handler,privilegedReads=0,ordinaryReads=0;
  const rpcCalls=[],grantCalls=[];
  const caller={from(table){assert.equal(table,'stories');ordinaryReads++;return rowsChain(visible?[{id:storyId,user_id:ownerId,media_type:'video',expires_at:new Date(Date.now()+600000).toISOString()}]:[])},
    async rpc(name,args){rpcCalls.push({name,args});if(name==='admin_actor_has_capability')return{data:capability,error:null};assert.equal(name,'get_admin_story_detail');return{data:projection,error:null}}};
  const db={from(table){privilegedReads++;return rowsChain(table==='video_asset_links'?links:assets)}};
  const modules={
    '../_shared/mediaAuth.ts':{authenticatedUser:async()=>({id:otherId}),authenticatedClient:()=>caller,admin:()=>db,corsHeaders:{},json:(body,status=200)=>new Response(JSON.stringify(body),{status})},
    '../_shared/premiumStreamSecurity.ts':{CREATOR_PREMIUM_STREAM_PURPOSE:'creator_premium_video',STORY_STREAM_PURPOSE:'story_video',isPrivateStreamPurpose:purpose=>['story_video','creator_premium_video'].includes(purpose),createPrivateStreamPlaybackGrant:async input=>{grantCalls.push(input);return grant}},
    '../_shared/stream.ts':{isUuid:value=>typeof value==='string'&&/^[0-9a-f-]{36}$/.test(value),streamCustomerCode:()=> 'code',sanitizeProviderError:()=>({code:'unavailable',status:503})},
  };
  const output=ts.transpileModule(readFileSync('supabase/functions/get-stream-playback/index.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(output,{exports:{},require:name=>modules[name],Deno:{serve:fn=>{handler=fn}},Request,Response,Headers,Date,console});
  return{rpcCalls,grantCalls,reads:()=>({privilegedReads,ordinaryReads}),async call(body={story_id:storyId,admin_review:true}){const response=await handler(new Request('https://edge.test',{method:'POST',body:JSON.stringify(body)}));return{response,body:await response.json()}}};
}

test('authorized direct Stream inspection binds canonical Story and returns only an expiring no-store grant',async()=>{
  const host=harness({visible:false});
  const {response,body}=await host.call();
  assert.equal(response.status,200);
  assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  assert.deepEqual(body,{success:true,data:{storyId,...grant}});
  assert.equal(host.rpcCalls[0].name,'admin_actor_has_capability');
  assert.equal(host.rpcCalls[0].args.p_capability,'stories.items.read');
  assert.equal(host.rpcCalls[1].name,'get_admin_story_detail');
  assert.equal(host.rpcCalls[1].args.p_story_id,storyId);
  assert.equal(host.reads().ordinaryReads,0);
  assert.equal(host.grantCalls.length,1);
  assert.ok(host.grantCalls[0].maximumExpiresAtSeconds<=Math.floor(Date.now()/1000)+300);
  assert.doesNotMatch(JSON.stringify(body),/private-provider-id|owner_id|provider_metadata|video_asset_id|evidence/);
});

test('caller capability failure rejects before privileged canonical reads or signing',async()=>{
  const host=harness({capability:false});
  assert.equal((await host.call()).response.status,403);
  assert.equal(host.reads().privilegedReads,0);
  assert.equal(host.grantCalls.length,0);
});

for(const [label,options] of [
  ['wrong Story projection',{projection:{...detail,id:otherId}}],
  ['wrong projection asset',{projection:{...detail,video_asset_id:otherId}}],
  ['shared Story projection',{projection:{...detail,story_kind:'shared'}}],
  ['wrong projection kind',{projection:{...detail,media_type:'photo'}}],
  ['wrong media origin',{projection:{...detail,media_origin:'shared_stream_asset'}}],
  ['unavailable projection',{projection:{...detail,source_status:'unavailable'}}],
  ['wrong Story link',{links:[{...link,entity_id:otherId}]}],
  ['wrong slot',{links:[{...link,slot:'original'}]}],
  ['wrong link owner',{links:[{...link,owner_id:otherId}]}],
  ['wrong asset owner',{assets:[{...asset,owner_id:otherId}]}],
  ['wrong purpose',{assets:[{...asset,purpose:'creator_premium_video'}]}],
  ['wrong provider',{assets:[{...asset,provider:'r2'}]}],
  ['public asset',{assets:[{...asset,visibility:'public'}]}],
  ['deleted asset',{assets:[{...asset,status:'deleted'}]}],
  ['deleted-at asset',{assets:[{...asset,deleted_at:'2026-10-27T00:00:00Z'}]}],
  ['processing asset',{assets:[{...asset,status:'processing'}]}],
  ['public URL',{assets:[{...asset,hls_url:'https://public.example/raw.m3u8'}]}],
  ['missing signed-url proof',{assets:[{...asset,provider_metadata:{require_signed_urls:false}}]}],
  ['missing duration',{assets:[{...asset,duration_seconds:null}]}],
  ['ambiguous link',{links:[link,link]}],
])test(`admin Stream review rejects ${label} without a grant`,async()=>{
  const host=harness(options);
  const result=await host.call();
  assert.ok(result.response.status>=400);
  assert.equal(host.grantCalls.length,0);
  assert.doesNotMatch(JSON.stringify(result.body),/https:|private-provider-id|provider_metadata/);
});

test('ordinary Story playback still uses caller RLS and cannot opt into privileged access without capability',async()=>{
  const denied=harness({visible:false});
  assert.equal((await denied.call({story_id:storyId})).response.status,404);
  assert.equal(denied.reads().ordinaryReads,1);
  assert.equal(denied.grantCalls.length,0);
  assert.equal(denied.rpcCalls.length,0);
  const allowed=harness();
  assert.equal((await allowed.call({story_id:storyId})).response.status,200);
  assert.equal(allowed.rpcCalls.length,0);
  assert.equal(allowed.reads().ordinaryReads,1);
});
