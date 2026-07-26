import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  MAX_DURATION_MS,MAX_SIZE,createThenPost,directPostOnce,isHls,isVideo,lookupPublished,pollUntilReady,
  publishRecovery,reconcileThree,singleFlight,sourceFor,validDuration,validMime,validSize,
  validateContractWithCleanup,
} from './helpers/streamClientHarness.mjs';

const service=fs.readFileSync('services/streamService.ts','utf8');
const upload=fs.readFileSync('app/(tabs)/upload.tsx','utf8');
const feed=fs.readFileSync('contexts/FeedContext.tsx','utf8');
const card=fs.readFileSync('components/feature/VideoCard.native.tsx','utf8');
const migration=fs.readFileSync('supabase/migrations/20260726113000_publish_cloudflare_stream_video_posts.sql','utf8');

assert.equal(validMime('video/mp4'),true);
assert.equal(validMime('video/quicktime'),true);
assert.equal(validMime('video/webm'),true);
assert.equal(validMime('video/avi'),false);
assert.equal(validSize(MAX_SIZE),true);
assert.equal(validSize(MAX_SIZE+1),false);
assert.equal(validDuration(MAX_DURATION_MS),true);
assert.equal(validDuration(MAX_DURATION_MS+1),false);
assert.equal(validDuration(null),true);
assert.equal(isVideo('https://example.test/manifest/video.m3u8'),true);
assert.equal(isHls('https://example.test/manifest/video.m3u8'),true);
assert.equal(isVideo('https://customer-demo.cloudflarestream.com/u/manifest/video.m3u8'),true);
assert.equal(isVideo('https://videodelivery.net/u/manifest/video.m3u8'),true);
assert.equal(isVideo('https://legacy.test/videos/a.mp4'),true);
assert.equal(isVideo('https://example.test/a.jpg'),false);
assert.deepEqual(sourceFor('https://example.test/a.m3u8'),{uri:'https://example.test/a.m3u8',contentType:'hls'});
assert.equal(sourceFor('https://example.test/a.mp4'),'https://example.test/a.mp4');

let postCalls=0;
const uploaded=await directPostOnce({
  uploadUrl:'https://upload.invalid/temporary',file:{name:'video.mp4'},signal:new AbortController().signal,
  fetcher:async(_url,init)=>{postCalls++;assert.equal(init.method,'POST');assert.equal('headers' in init,false);
    assert.deepEqual(init.body.entries.map(entry=>entry[0]),['file']);return {ok:true,status:200};},
});
assert.equal(postCalls,1);
assert.equal(uploaded.calls,1);
let failedCalls=0;
await assert.rejects(()=>directPostOnce({
  uploadUrl:'https://upload.invalid/temporary',file:{},signal:new AbortController().signal,
  fetcher:async()=>{failedCalls++;throw new Error('network');},
}));
assert.equal(failedCalls,1,'Direct Creator POST must not retry');
const preAborted=new AbortController();preAborted.abort();
let abortedFetches=0;
await assert.rejects(()=>directPostOnce({
  uploadUrl:'https://upload.invalid/temporary',file:{},signal:preAborted.signal,
  fetcher:async()=>{abortedFetches++;return {ok:true};},
}),/aborted/);
assert.equal(abortedFetches,0);
const abortDuringCreate=new AbortController();
let postsAfterAbort=0,abortCleanups=0;
await assert.rejects(()=>createThenPost({
  signal:abortDuringCreate.signal,
  create:async()=>{abortDuringCreate.abort();return {assetId:'asset'};},
  post:async()=>{postsAfterAbort++;},cleanup:async()=>{abortCleanups++;},
}),/aborted/);
assert.equal(postsAfterAbort,0);
assert.equal(abortCleanups,1);

let clock=0,polls=0;
const ready=await pollUntilReady({
  now:()=>clock,sleep:async ms=>{assert.equal(ms,5_000);clock+=ms;},
  get:async()=>++polls===2?{status:'ready',hlsUrl:'https://stream.test/video.m3u8'}:{status:'processing',hlsUrl:null},
});
assert.equal(ready.status,'ready');
await assert.rejects(()=>pollUntilReady({
  now:()=>0,sleep:async()=>{},get:async()=>({status:'ready',hlsUrl:null}),
}),/stream_ready_invariant_failed/);
await assert.rejects(()=>pollUntilReady({
  now:()=>0,sleep:async()=>{},get:async()=>({status:'failed',errorCode:'provider_failed'}),
}),/provider_failed/);
let timeoutClock=0;
await assert.rejects(()=>pollUntilReady({
  timeoutMs:1,now:()=>timeoutClock,sleep:async()=>{timeoutClock=2;},
  get:async()=>({status:'processing'}),
}),/stream_processing_timeout/);
await assert.rejects(()=>pollUntilReady({
  now:()=>0,sleep:async()=>{},get:async()=>{throw Object.assign(new Error('gone'),{status:410});},
}),/gone/);
let transientCalls=0;
await pollUntilReady({
  now:()=>clock,sleep:async()=>{clock+=5_000;},
  get:async()=>++transientCalls===1
    ?Promise.reject(Object.assign(new Error('temporary'),{status:503}))
    :{status:'ready',hlsUrl:'https://stream.test/video.m3u8'},
});
assert.equal(transientCalls,2);

const session=async()=>({userId:'owner',error:null});
assert.deepEqual(await lookupPublished({
  session,links:async()=>({data:null,error:new Error('network')}),video:async()=>({data:null,error:null}),
}),{state:'unknown',code:'links'});
assert.deepEqual(await lookupPublished({
  session,links:async()=>({data:[{entity_id:'post'}],error:null}),
  video:async()=>({data:null,error:new Error('network')}),
}),{state:'unknown',code:'video'});
assert.deepEqual(await lookupPublished({
  session,links:async()=>({data:[],error:null}),video:async()=>({data:null,error:null}),
}),{state:'absent'});
assert.deepEqual(await lookupPublished({
  session,links:async()=>({data:[{entity_id:'post'}],error:null}),
  video:async id=>({data:{id},error:null}),
}),{state:'found',postId:'post'});
assert.deepEqual(await reconcileThree({
  sleep:async()=>{},lookup:async()=>({state:'absent'}),
}),{state:'absent'});
assert.deepEqual(await reconcileThree({
  sleep:async()=>{},lookup:async()=>({state:'unknown',code:'network'}),
}),{state:'unknown',code:'network'});

const sameAssetIds=[];
const foundRecovery=await publishRecovery({
  assetId:'asset',publish:async id=>{sameAssetIds.push(id);throw new Error('ambiguous');},
  reconcile:async()=>({state:'found',postId:'post'}),cleanup:async()=>{throw new Error('must not clean');},
});
assert.equal(foundRecovery.postId,'post');
assert.equal(foundRecovery.cleanups,0);
let unknownCleanups=0;
await assert.rejects(()=>publishRecovery({
  assetId:'asset',publish:async()=>{throw new Error('ambiguous');},
  reconcile:async()=>({state:'unknown',code:'network'}),cleanup:async()=>{unknownCleanups++;},
}),error=>error.code==='stream_publish_confirmation_pending');
assert.equal(unknownCleanups,0);
let absentLookups=0,absentCleanups=0;
await assert.rejects(()=>publishRecovery({
  assetId:'same-asset',publish:async id=>{sameAssetIds.push(id);throw new Error('ambiguous');},
  reconcile:async()=>{absentLookups++;return {state:'absent'};},cleanup:async()=>{absentCleanups++;},
}));
assert.equal(absentLookups,2);
assert.equal(absentCleanups,1);
assert.deepEqual(sameAssetIds.slice(-2),['same-asset','same-asset']);

const validAssetId='123e4567-e89b-42d3-a456-426614174000';
let contractCleanups=0;
await assert.rejects(()=>validateContractWithCleanup({
  contract:{assetId:validAssetId,uploadUrl:'invalid',method:'POST',formField:'file',
    maxDurationSeconds:60,maxSizeBytes:MAX_SIZE,expiresAt:new Date().toISOString()},
  cleanup:async()=>{contractCleanups++;},
}),/invalid_stream_upload_contract/);
assert.equal(contractCleanups,1);
await validateContractWithCleanup({
  now:Date.now(),contract:{assetId:validAssetId,uploadUrl:'https://upload.invalid',method:'POST',formField:'file',
    maxDurationSeconds:60,maxSizeBytes:MAX_SIZE,expiresAt:new Date(Date.now()-240_000).toISOString()},
  cleanup:async()=>{throw new Error('must not clean');},
});
let operations=0,release;
const locked=singleFlight(async()=>{operations++;await new Promise(resolve=>{release=resolve;});});
const first=locked(),second=locked();
assert.equal(await second,false);
release();assert.equal(await first,true);assert.equal(operations,1);

assert.match(migration,/create unique index video_asset_links_one_feed_post_per_asset_idx/);
assert.match(migration,/where entity_type = 'video_post' and slot = 'video'/);
assert.match(migration,/create or replace function public\.publish_stream_video_post/);
assert.match(migration,/pg_advisory_xact_lock\(hashtextextended\(p_asset_id::text, 0\)\)/);
assert.match(migration,/insert into public\.videos[\s\S]*insert into public\.video_asset_links/);
assert.doesNotMatch(migration,/p_user_id|p_owner_id/);
assert.match(migration,/status <> 'ready'/);
assert.match(migration,/hls_url !~ '\^https:\/\/'/);
assert.match(migration,/create or replace function public\.delete_stream_video_post/);
assert.match(migration,/user_id = v_user_id/);
assert.match(migration,/status = case when status = 'deleted' then status else 'delete_pending' end/);
assert.match(migration,/revoke all on function public\.publish_stream_video_post[\s\S]*from public, anon/);
assert.match(migration,/grant execute on function public\.publish_stream_video_post[\s\S]*to authenticated/);

assert.match(service,/new FormData\(\)/);
assert.match(service,/formData\.append\('file'/);
assert.match(service,/method:'POST',body:formData/);
assert.doesNotMatch(service,/Content-Type.*multipart/i);
assert.doesNotMatch(service,/console\.(?:log|warn|error)\([^)]*uploadUrl/i);
assert.doesNotMatch(service,/upload_url|persist.*uploadUrl/i);
assert.match(service,/pollIntervalMs\?\?5_000/);
assert.match(service,/invokeRpcWithSingleAuthRefresh/);
assert.match(service,/findPublishedStreamPost/);
assert.match(service,/state:'unknown'/);
assert.match(service,/stream_publish_confirmation_pending/);
assert.match(service,/throwIfStreamAborted/);
assert.match(service,/expiresAt>=Date\.now\(\)-300_000/);
assert.match(service,/if\(assetId\) await deleteStreamVideo\(assetId\)\.catch/);
assert.doesNotMatch(service,/createStreamUpload[\s\S]*createStreamUpload[\s\S]*createStreamUpload/);
assert.match(upload,/base64: captureMode === 'photo'/);
assert.match(upload,/base64: isPhoto/);
assert.match(upload,/uploadAndPublishStreamVideo/);
assert.match(upload,/uploadInFlightRef\.current=true/);
assert.match(upload,/uploadInFlightRef\.current=false/);
assert.match(upload,/No pudimos confirmar el resultado de la publicación/);
assert.match(upload,/if\(selectedMedia\.type==='video'\)/);
assert.doesNotMatch(upload,/selectedMedia\.type==='video'[\s\S]{0,1600}uploadFileFromUri/);
assert.match(upload,/const uploaded = await uploadMediaToStorage\(selectedMedia\)/,'photo flow remains R2-backed');
assert.match(feed,/delete_stream_video_post/);
assert.match(feed,/deleteStorageFile/,'legacy deletion remains available');
assert.match(card,/contentType:'hls'/);
for(const source of [service,upload,feed,card,migration]) {
  assert.doesNotMatch(source,/CLOUDFLARE_STREAM_TOKEN\s*=/);
  assert.doesNotMatch(source,/Authorization\s*:/);
}
console.log('streamClientIntegration: PASS');
