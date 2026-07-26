import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  MAX_DURATION_MS,MAX_SIZE,directPostOnce,isHls,isVideo,pollUntilReady,reconcilePublish,
  sourceFor,validDuration,validMime,validSize,
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
assert.deepEqual(reconcilePublish({rpcError:true,linkedPost:'post'}),{published:true,cleanup:false});
assert.deepEqual(reconcilePublish({rpcError:true,linkedPost:null}),{published:false,cleanup:true});

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
assert.match(upload,/base64: captureMode === 'photo'/);
assert.match(upload,/base64: isPhoto/);
assert.match(upload,/uploadAndPublishStreamVideo/);
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
