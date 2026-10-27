import { admin,json } from '../_shared/mediaAuth.ts';
import {
  deleteObjectWithReceipt,isR2Transient,verifyObjectAbsent,
} from '../_shared/r2.ts';
import {
  deleteStreamVideo,sanitizeProviderError,StreamProviderError,verifyStreamVideoAbsent,
} from '../_shared/stream.ts';

type CleanupOperation='delete'|'verify_absence';
type MediaCleanupRow={
  id:string;
  bucket_name:string;
  object_key:string;
  cleanup_attempts:number;
  operation:CleanupOperation;
  failure_exhausts:boolean;
};
type StreamVideoCleanupRow={
  id:string;
  cloudflare_uid:string|null;
  purpose:'feed_video'|'business_library'|'creator_premium_video'|'story_video';
  delete_attempts:number;
  operation:CleanupOperation;
  failure_exhausts:boolean;
};

class CleanupPersistenceError extends Error {}
class CleanupStaleClaimError extends Error {}

const MAX_CLAIM_ROUNDS=8;
// The pg_net caller currently has a 50s timeout. Stop claiming new work well
// before it and share one provider deadline across the whole invocation so a
// verify/delete/verify sequence cannot reset a fresh 15s timeout at each step.
const START_NEW_WORK_BUDGET_MS=20_000;
const PROVIDER_DEADLINE_MS=35_000;

function deleteOutcome(alreadyAbsent:boolean):'already_absent'|'delete_accepted' {
  return alreadyAbsent?'already_absent':'delete_accepted';
}

Deno.serve(async(req)=>{
  if(req.method!=='POST') return json({error:'method_not_allowed'},405);
  const supplied=req.headers.get('X-Cleanup-Secret');
  const expected=Deno.env.get('MEDIA_CLEANUP_SECRET');
  if(!expected||supplied!==expected) return json({error:'forbidden'},403);
  const db=admin();
  const startedAt=Date.now();
  const providerDeadline=AbortSignal.timeout(PROVIDER_DEADLINE_MS);

  let objectsDeleted=0,objectsRechecked=0,staleClaims=0,exhaustedClaims=0;
  let streamVideosDeleted=0,streamVideosRechecked=0;
  let premiumVideosClaimed=0,premiumVideosDeleted=0,premiumVideosRechecked=0;
  let storyVideosClaimed=0,storyVideosDeleted=0,storyVideosRechecked=0;
  let r2Claimed=0,streamClaimed=0;
  let persistenceFailed=false;
  let r2LaneStopped=false,streamLaneStopped=false;
  let r2Drained=false,streamDrained=false;

  const processR2=async(row:MediaCleanupRow):Promise<boolean>=>{
    try {
      let deletion:null|{alreadyAbsent:boolean;requestId:string|null}=null;
      let verification=row.operation==='verify_absence'
        ?await verifyObjectAbsent(row.bucket_name,row.object_key,providerDeadline)
        :null;
      // A tombstoned object that reappears is deleted again under the current
      // fence, then independently checked a second time.
      if(row.operation==='delete'||verification?.absent===false) {
        deletion=await deleteObjectWithReceipt(
          row.bucket_name,row.object_key,providerDeadline,
        );
        const {data:receipt,error:receiptError}=await db.rpc(
          'record_media_asset_provider_delete_v1',
          {
            p_asset_id:row.id,
            p_cleanup_attempt:row.cleanup_attempts,
            p_operation:row.operation,
            p_delete_outcome:deleteOutcome(deletion.alreadyAbsent),
            p_delete_request_id:deletion.requestId,
          },
        );
        if(receiptError) throw new CleanupPersistenceError('r2_delete_receipt_failed');
        if(receipt!==true) throw new CleanupStaleClaimError('r2_delete_receipt_stale');
        verification=await verifyObjectAbsent(
          row.bucket_name,row.object_key,providerDeadline,
        );
      }
      if(!verification?.absent) throw new Error('r2_object_still_present');
      const {data:completion,error:completionError}=await db.rpc(
        'finalize_media_asset_cleanup_v1',
        {
          p_asset_id:row.id,
          p_cleanup_attempt:row.cleanup_attempts,
          p_operation:row.operation,
          p_delete_outcome:deletion?deleteOutcome(deletion.alreadyAbsent):null,
          p_delete_request_id:deletion?.requestId??null,
          p_absence_request_id:verification.requestId,
        },
      );
      if(completionError) throw new CleanupPersistenceError('r2_finalize_failed');
      if(completion==='finalized') objectsDeleted++;
      else if([
        'recheck_scheduled','verified','verified_recheck_scheduled',
      ].includes(String(completion))) objectsRechecked++;
      else if(completion==='exhausted') exhaustedClaims++;
      else staleClaims++;
      return true;
    } catch(error) {
      if(error instanceof CleanupPersistenceError) {
        persistenceFailed=true;
        return false;
      }
      if(error instanceof CleanupStaleClaimError) {
        staleClaims++;
        return true;
      }
      const message=error instanceof Error?error.message:'';
      const code=isR2Transient(error)
        ?'r2_provider_temporarily_unavailable'
        :message==='r2_object_still_present'
          ?'r2_object_still_present'
          :row.operation==='verify_absence'
            ?'r2_absence_verification_failed'
            :'r2_provider_delete_failed';
      const {data:retryRecorded,error:retryError}=await db.rpc(
        'record_media_asset_cleanup_failure_v1',
        {p_asset_id:row.id,p_cleanup_attempt:row.cleanup_attempts,p_error_code:code},
      );
      if(retryError) {
        persistenceFailed=true;
        return false;
      }
      if(retryRecorded!==true) staleClaims++;
      else if(row.failure_exhausts) exhaustedClaims++;
      return true;
    }
  };

  const processStream=async(row:StreamVideoCleanupRow):Promise<boolean>=>{
    try {
      if(!row.cloudflare_uid) {
        throw new StreamProviderError('stream_provider_identity_missing',500,false);
      }
      let deletion:null|{alreadyAbsent:boolean;requestId:string|null}=null;
      let verification=row.operation==='verify_absence'
        ?await verifyStreamVideoAbsent(row.cloudflare_uid,providerDeadline)
        :null;
      if(row.operation==='delete'||verification?.absent===false) {
        deletion=await deleteStreamVideo(row.cloudflare_uid,providerDeadline);
        const {data:receipt,error:receiptError}=await db.rpc(
          'record_creator_premium_video_provider_delete_v1',
          {
            p_asset_id:row.id,
            p_delete_attempt:row.delete_attempts,
            p_operation:row.operation,
            p_delete_outcome:deleteOutcome(deletion.alreadyAbsent),
            p_delete_request_id:deletion.requestId,
          },
        );
        if(receiptError) throw new CleanupPersistenceError('stream_delete_receipt_failed');
        if(receipt!==true) throw new CleanupStaleClaimError('stream_delete_receipt_stale');
        verification=await verifyStreamVideoAbsent(row.cloudflare_uid,providerDeadline);
      }
      if(!verification?.absent) throw new Error('stream_object_still_present');
      const alreadyAbsent=deletion?.alreadyAbsent??true;
      const {data:completion,error:completionError}=await db.rpc(
        'finalize_creator_premium_video_cleanup_v1',
        {
          p_asset_id:row.id,
          p_delete_attempt:row.delete_attempts,
          p_operation:row.operation,
          p_delete_outcome:deletion
            ?deleteOutcome(alreadyAbsent)
            :row.operation==='delete'?'already_absent':null,
          p_delete_request_id:deletion?.requestId??null,
          p_absence_request_id:verification?.requestId??null,
        },
      );
      if(completionError) throw new CleanupPersistenceError('stream_finalize_failed');
      if(completion==='finalized') {
        streamVideosDeleted++;
        if(row.purpose==='creator_premium_video') premiumVideosDeleted++;
        if(row.purpose==='story_video') storyVideosDeleted++;
      }
      else if([
        'recheck_scheduled','verified','verified_recheck_scheduled',
      ].includes(String(completion))) {
        streamVideosRechecked++;
        if(row.purpose==='creator_premium_video') premiumVideosRechecked++;
        if(row.purpose==='story_video') storyVideosRechecked++;
      }
      else if(completion==='exhausted') exhaustedClaims++;
      else staleClaims++;
      return true;
    } catch(providerError) {
      if(providerError instanceof CleanupPersistenceError) {
        persistenceFailed=true;
        return false;
      }
      if(providerError instanceof CleanupStaleClaimError) {
        staleClaims++;
        return true;
      }
      const safe=providerError instanceof Error&&providerError.message==='stream_object_still_present'
        ?{code:'stream_object_still_present'}
        :sanitizeProviderError(providerError);
      const {data:retryRecorded,error:retryError}=await db.rpc(
        'record_creator_premium_video_cleanup_failure_v1',
        {p_asset_id:row.id,p_delete_attempt:row.delete_attempts,p_error_code:safe.code},
      );
      if(retryError) {
        persistenceFailed=true;
        return false;
      }
      if(retryRecorded!==true) staleClaims++;
      else if(row.failure_exhausts) exhaustedClaims++;
      return true;
    }
  };

  // Claim/process under a bounded wall-clock budget. This keeps
  // useful throughput without pre-claiming rows that the invocation may never
  // reach. One row per eligible lane is claimed before provider work begins,
  // then the two provider lanes run concurrently under the same hard deadline.
  // A slow R2 request therefore cannot starve Stream on every cron invocation.
  for(let round=0;round<MAX_CLAIM_ROUNDS;round+=1) {
    let progressed=false;
    if(Date.now()-startedAt>=START_NEW_WORK_BUDGET_MS) break;
    const work:{lane:'r2'|'stream';run:()=>Promise<boolean>}[]=[];
    if(!r2LaneStopped&&!r2Drained) {
      const {data,error}=await db.rpc('cleanup_stale_media_upload_records',{p_limit:1});
      if(error) {
        persistenceFailed=true;
        r2LaneStopped=true;
      } else {
        const row=((data??[]) as MediaCleanupRow[])[0];
        if(!row) r2Drained=true;
        else {
          progressed=true;
          r2Claimed++;
          work.push({lane:'r2',run:()=>processR2(row)});
        }
      }
    }
    if(!streamLaneStopped&&!streamDrained) {
      const {data,error}=await db.rpc(
        'cleanup_stale_creator_premium_video_records',{p_limit:1},
      );
      if(error) {
        persistenceFailed=true;
        streamLaneStopped=true;
      } else {
        const row=((data??[]) as StreamVideoCleanupRow[])[0];
        if(!row) streamDrained=true;
        else {
          progressed=true;
          streamClaimed++;
          if(row.purpose==='creator_premium_video') premiumVideosClaimed++;
          if(row.purpose==='story_video') storyVideosClaimed++;
          work.push({lane:'stream',run:()=>processStream(row)});
        }
      }
    }
    const outcomes=await Promise.allSettled(work.map(async({lane,run})=>({
      lane,keepRunning:await run(),
    })));
    for(const outcome of outcomes) {
      if(outcome.status==='rejected') {
        persistenceFailed=true;
        // The rejected promise keeps no provider identity in telemetry. Stop
        // both lanes because persistence state is now indeterminate.
        r2LaneStopped=true;
        streamLaneStopped=true;
      } else if(!outcome.value.keepRunning) {
        if(outcome.value.lane==='r2') r2LaneStopped=true;
        else streamLaneStopped=true;
      }
    }
    if(!progressed) break;
  }

  const result={
    success:!persistenceFailed,
    stale:r2Claimed,
    objectsDeleted,
    objectsRechecked,
    streamVideosClaimed:streamClaimed,
    streamVideosDeleted,
    streamVideosRechecked,
    premiumVideosStale:premiumVideosClaimed,
    premiumVideosDeleted,
    premiumVideosRechecked,
    storyVideosStale:storyVideosClaimed,
    storyVideosDeleted,
    storyVideosRechecked,
    staleClaims,
    exhaustedClaims,
  };
  return persistenceFailed?json({error:'cleanup_failed',...result},500):json(result);
});
