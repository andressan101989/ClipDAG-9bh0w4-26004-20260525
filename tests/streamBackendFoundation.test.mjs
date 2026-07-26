import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  MAX_DURATION,MAX_SIZE,compensateCreatedUid,createDirectUploadOnce,deleteLifecycle,
  deleteSucceeded,fallback,mapVideo,parseSignature,safeError,sign,timingSafeHex,
  validMime,validSize,verify,webhookLifecycle,webhookVideo,
} from './helpers/streamBackendHarness.mjs';

const migration=fs.readFileSync('supabase/migrations/20260726110000_create_cloudflare_stream_video_assets.sql','utf8');
const hardeningMigration=fs.readFileSync('supabase/migrations/20260726111000_harden_cloudflare_stream_upload_reservation.sql','utf8');
const invariantMigration=fs.readFileSync('supabase/migrations/20260726112000_enforce_cloudflare_stream_ready_invariants.sql','utf8');
const shared=fs.readFileSync('supabase/functions/_shared/stream.ts','utf8');
const create=fs.readFileSync('supabase/functions/create-stream-upload/index.ts','utf8');
const playback=fs.readFileSync('supabase/functions/get-stream-playback/index.ts','utf8');
const deletion=fs.readFileSync('supabase/functions/delete-stream-video/index.ts','utf8');
const webhook=fs.readFileSync('supabase/functions/stream-webhook/index.ts','utf8');
const config=fs.readFileSync('supabase/config.toml','utf8');

assert.equal(validMime('video/mp4'),true);
assert.equal(validMime('video/quicktime'),true);
assert.equal(validMime('video/webm'),true);
assert.equal(validMime('video/avi'),false);
assert.equal(validSize(MAX_SIZE),true);
assert.equal(validSize(MAX_SIZE+1),false);
assert.equal(MAX_DURATION,60);
assert.equal(mapVideo({status:{state:'pendingupload'}}).status,'uploading');
assert.equal(mapVideo({status:{state:'inprogress'}}).status,'processing');
assert.equal(mapVideo({status:{state:'ready'},readyToStream:false}).status,'processing');
assert.equal(mapVideo({uid:'uid',duration:30,status:{state:'ready'},readyToStream:true}).status,'ready');
assert.equal(mapVideo({uid:'uid',duration:30,status:{state:'ready'},readyToStream:true},'demo','other').status,'failed');
assert.equal(mapVideo({uid:'uid',duration:0,status:{state:'ready'},readyToStream:true}).status,'failed');
assert.equal(mapVideo({uid:'uid',duration:61,status:{state:'ready'},readyToStream:true}).status,'failed');
assert.equal(mapVideo({status:{state:'error'}}).status,'failed');
assert.match(fallback('uid','abc').hls,/customer-abc/);
assert.doesNotMatch(fallback('uid','customer-abc').hls,/customer-customer-/);

const now=1_700_000_000,raw='{"uid":"managed"}',secret='test-only-secret';
const signature=sign(secret,`${now}.${raw}`);
assert.deepEqual(parseSignature(`time=${now},sig1=${signature}`),{time:now,signature});
assert.equal(verify(raw,`time=${now},sig1=${signature}`,secret,now),true);
assert.equal(verify(raw,`time=${now},sig1=${'0'.repeat(64)}`,secret,now),false);
assert.equal(verify(raw,`time=${now-301},sig1=${sign(secret,`${now-301}.${raw}`)}`,secret,now),false);
assert.equal(timingSafeHex(signature,signature),true);
assert.equal(timingSafeHex(signature,'0'.repeat(64)),false);
assert.equal(webhookVideo({uid:'direct'}).uid,'direct');
assert.equal(webhookVideo({result:{uid:'nested'}}).uid,'nested');
assert.deepEqual(safeError({status:503}),{code:'stream_provider_temporarily_unavailable',message:'stream_provider_temporarily_unavailable'});
assert.equal(deleteSucceeded(404),true);

let calls=0;
await createDirectUploadOnce(async()=>{calls++; throw new Error('ambiguous');}).catch(()=>{});
assert.equal(calls,1,'Direct Upload creation must not retry automatically');

let compensationDeletes=0;
const failedCompensation=await compensateCreatedUid({
  uid:'provider-uid',deleteProvider:async()=>{compensationDeletes++; throw new Error('temporary');},
  persist:async()=>true,
});
assert.equal(compensationDeletes,1);
assert.equal(failedCompensation.state.status,'delete_pending');
assert.equal(failedCompensation.state.cloudflare_uid,'provider-uid');

const lookupFailure=await webhookLifecycle({
  lookup:async()=>({error:true}),update:async()=>true,assetId:'asset',uid:'uid',
});
assert.deepEqual(lookupFailure,{status:503,error:'stream_webhook_lookup_failed',updated:false});
const nullUid=await webhookLifecycle({
  lookup:async()=>({data:{cloudflare_uid:null}}),update:async()=>true,assetId:'asset',uid:'uid',
});
assert.equal(nullUid.updated,false);
const wrongUid=await webhookLifecycle({
  lookup:async()=>({data:{cloudflare_uid:'other'}}),update:async()=>true,assetId:'asset',uid:'uid',
});
assert.equal(wrongUid.updated,false);
const updateFailure=await webhookLifecycle({
  lookup:async()=>({data:{cloudflare_uid:'uid'}}),update:async()=>false,assetId:'asset',uid:'uid',
});
assert.equal(updateFailure.error,'stream_webhook_update_failed');
const readyPreserved=await webhookLifecycle({
  lookup:async()=>({data:{cloudflare_uid:'uid'}}),update:async()=>true,
  assetId:'asset',uid:'uid',existingReadyAt:'original-ready-at',
});
assert.equal(readyPreserved.updates.ready_at,'original-ready-at');
const noUid=await webhookLifecycle({
  lookup:async()=>{throw new Error('must not query');},update:async()=>true,assetId:'asset',uid:'',
});
assert.equal(noUid.status,202);
const readyVsProcessing=await webhookLifecycle({
  lookup:async()=>({data:{cloudflare_uid:'uid'}}),update:async()=>true,
  assetId:'asset',uid:'uid',existingStatus:'ready',eventStatus:'processing',
});
assert.equal(readyVsProcessing.updated,false);
const readyVsError=await webhookLifecycle({
  lookup:async()=>({data:{cloudflare_uid:'uid'}}),update:async()=>true,
  assetId:'asset',uid:'uid',existingStatus:'ready',eventStatus:'failed',
});
assert.equal(readyVsError.updated,false);
const readyIncomplete=await webhookLifecycle({
  lookup:async()=>({data:{cloudflare_uid:'uid'}}),update:async()=>true,
  assetId:'asset',uid:'uid',existingStatus:'ready',eventStatus:'ready',
  existingReadyAt:'original-ready-at',existingHls:'https://existing/hls.m3u8',incomingHls:null,
});
assert.equal(readyIncomplete.updates.ready_at,'original-ready-at');
assert.equal(readyIncomplete.updates.hls_url,'https://existing/hls.m3u8');
for(const protectedStatus of ['deleted','delete_pending']) {
  const terminal=await webhookLifecycle({
    lookup:async()=>({data:{cloudflare_uid:'uid'}}),update:async()=>true,
    assetId:'asset',uid:'uid',existingStatus:protectedStatus,eventStatus:'ready',
  });
  assert.equal(terminal.updated,false);
}

let providerDeleteCalls=0;
const transitionFailure=await deleteLifecycle({
  transition:async()=>false,deleteProvider:async()=>{providerDeleteCalls++; return 204;},
  finish:async()=>true,persistFailure:async()=>true,
});
assert.equal(transitionFailure.error,'asset_state_failed');
assert.equal(providerDeleteCalls,0);
const finalUpdateFailure=await deleteLifecycle({
  transition:async()=>true,deleteProvider:async()=>204,finish:async()=>false,persistFailure:async()=>true,
});
assert.equal(finalUpdateFailure.success,undefined);
assert.equal(finalUpdateFailure.error,'asset_state_failed');
const idempotent404=await deleteLifecycle({
  transition:async()=>true,deleteProvider:async()=>404,finish:async()=>true,persistFailure:async()=>true,
});
assert.equal(idempotent404.success,true);

assert.match(migration,/create table public\.video_assets/);
assert.match(migration,/create table public\.video_asset_links/);
assert.match(migration,/enable row level security/g);
assert.match(migration,/size_bytes > 0 and size_bytes <= 200000000/);
assert.match(migration,/max_duration_seconds > 0 and max_duration_seconds <= 60/);
assert.match(migration,/grant select on public\.video_assets to authenticated/);
assert.doesNotMatch(migration,/for insert\s+to authenticated/i);
assert.match(hardeningMigration,/pg_advisory_xact_lock\(hashtextextended\(p_owner_id::text, 0\)\)/);
assert.match(hardeningMigration,/created/);
assert.match(hardeningMigration,/rate_limited/);
assert.match(hardeningMigration,/active_limit_reached/);
assert.match(hardeningMigration,/revoke all on function public\.reserve_stream_upload_asset[\s\S]*from public, anon, authenticated/);
assert.match(hardeningMigration,/grant execute on function public\.reserve_stream_upload_asset[\s\S]*to service_role/);
assert.match(invariantMigration,/video_assets_ready_invariants_check/);
assert.match(invariantMigration,/hls_url is not null/);
assert.match(invariantMigration,/ready_at is not null/);
assert.match(invariantMigration,/duration_seconds <= max_duration_seconds/);
assert.match(invariantMigration,/mime_type in \('video\/mp4','video\/quicktime','video\/webm'\)/);
assert.match(shared,/readyToStream===true/);
assert.match(shared,/uid===expectedUid/);
assert.match(shared,/stream_ready_invariant_failed/);
assert.match(shared,/constantTimeEqualHex/);
assert.match(shared,/\$\{parsed\.time\}\.\$\{rawBody\}/);
assert.match(create,/\/direct_upload/);
assert.match(create,/db\.rpc\('reserve_stream_upload_asset'/);
assert.doesNotMatch(create,/recentResult|activeResult/);
assert.match(create,/maxDurationSeconds:STREAM_MAX_DURATION_SECONDS/);
assert.match(create,/requireSignedURLs:false/);
assert.match(create,/allowedOrigins:\[\]/);
assert.doesNotMatch(migration,/upload_url|uploadurl/i,'schema must not persist uploadURL');
for(const match of create.matchAll(/\.update\(\{([\s\S]*?)\}\)/g)) {
  assert.doesNotMatch(match[1],/uploadUrl|upload_url/i,'DB updates must not persist uploadURL');
}
assert.doesNotMatch(create,/console\.(?:log|warn|error)\([^)]*(?:token|uploadUrl)/i);
assert.match(create,/recovery_state_persist_failed/);
assert.match(create,/cloudflare_uid:uidToDelete/);
assert.match(create,/if\(!uploadUrl\)[\s\S]*compensateUid\(uid,'stream_provider_invalid_response'\)/);
assert.match(playback,/Date\.now\(\)-checkedAt>=5_000/);
assert.match(playback,/stream_provider_uid_mismatch/);
assert.match(playback,/providerUid!==asset\.cloudflare_uid/);
assert.match(deletion,/stream_not_found/);
assert.match(deletion,/if\(pendingError\) return json\(\{error:'asset_state_failed'\},503\)/);
assert.match(deletion,/if\(deletedError\) return json\(\{error:'asset_state_failed'\},503\)/);
assert.match(webhook,/const rawBody=await req\.text\(\)/);
assert.match(webhook,/stream_webhook_not_configured/);
assert.match(webhook,/stream_webhook_lookup_failed/);
assert.match(webhook,/stream_webhook_update_failed/);
assert.match(webhook,/if\(!uid\) return json\(\{success:true\},202\)/);
assert.match(webhook,/if\(!asset\.cloudflare_uid\|\|uid!==asset\.cloudflare_uid\)/);
assert.match(webhook,/if\(asset\.status==='ready'\)/);
assert.match(webhook,/if\(updates\.status!=='ready'\) return json\(\{success:true\}\)/);
assert.match(webhook,/updates\.ready_at=asset\.ready_at/);
assert.match(webhook,/updates\.hls_url=providerHls\?\.startsWith\('https:\/\/'\)\?updates\.hls_url:asset\.hls_url/);
assert.match(config,/\[functions\.stream-webhook\]\s+verify_jwt = false/);
for(const source of [shared,create,playback,deletion,webhook]) {
  assert.doesNotMatch(source,/CLOUDFLARE_STREAM_TOKEN\s*=/);
  assert.doesNotMatch(source,/console\.log\([^)]*(?:token|uploadUrl)/i);
}
console.log('streamBackendFoundation: PASS');
