import { authenticatedUser,admin,json } from '../_shared/mediaAuth.ts';
import {
  STREAM_MAX_DURATION_SECONDS,STREAM_MAX_SIZE_BYTES,safeFilename,sanitizeProviderError,
  streamFetch,validateStreamMime,validateStreamSize,
} from '../_shared/stream.ts';

Deno.serve(async(req)=>{
  if(req.method!=='POST') return json({error:'method_not_allowed'},405);
  const user=await authenticatedUser(req); if(!user) return json({error:'unauthorized'},401);
  const body=await req.json().catch(()=>({})) as Record<string,unknown>;
  if(String(body.purpose??'')!=='feed_video') return json({error:'invalid_purpose'},400);
  const mime=validateStreamMime(body.mime_type); if(!mime) return json({error:'invalid_mime_type'},400);
  const size=validateStreamSize(body.size_bytes); if(!size) return json({error:'invalid_size'},400);
  const db=admin();
  const id=crypto.randomUUID(),expiresAt=new Date(Date.now()+15*60_000).toISOString();
  const {data:reservation,error:reservationError}=await db.rpc('reserve_stream_upload_asset',{
    p_asset_id:id,p_owner_id:user.id,p_mime_type:mime,p_size_bytes:size,
    p_original_filename:safeFilename(body.file_name),
  });
  if(reservationError) return json({error:'rate_limit_unavailable'},503);
  if(reservation==='rate_limited'||reservation==='active_limit_reached') {
    return json({error:reservation},429);
  }
  if(reservation!=='created') return json({error:'asset_create_failed'},503);

  let uid:string|undefined;
  const persistRecovery=async(values:Record<string,unknown>,code:string):Promise<boolean>=>{
    const {error}=await db.from('video_assets').update(values).eq('id',id).eq('owner_id',user.id);
    if(error) {
      console.error('[create-stream-upload] recovery_state_persist_failed',{assetId:id,uid,code});
      return false;
    }
    return true;
  };
  const compensateUid=async(uidToDelete:string,failureCode:string):Promise<boolean>=>{
    let deleted=false,deleteCode=failureCode;
    try {
      await streamFetch(`/${encodeURIComponent(uidToDelete)}`,{method:'DELETE'});
      deleted=true;
    } catch(error) {
      const safe=sanitizeProviderError(error);
      if(safe.status===404) deleted=true;
      else deleteCode=safe.code;
    }
    return persistRecovery(deleted
      ? {status:'failed',cloudflare_uid:uidToDelete,error_code:failureCode,error_message:failureCode,next_cleanup_attempt_at:null}
      : {status:'delete_pending',cloudflare_uid:uidToDelete,error_code:deleteCode,error_message:deleteCode,next_cleanup_attempt_at:new Date().toISOString()},
    deleteCode);
  };

  try {
    const environment=Deno.env.get('DENO_DEPLOYMENT_ID')?'production':'development';
    const provider=await streamFetch('/direct_upload',{method:'POST',body:JSON.stringify({
      maxDurationSeconds:STREAM_MAX_DURATION_SECONDS,creator:user.id,requireSignedURLs:false,
      allowedOrigins:[],expiry:expiresAt,meta:{asset_id:id,purpose:'feed_video',environment},
    })});
    const result=provider.result as Record<string,unknown>|undefined;
    uid=typeof result?.uid==='string'?result.uid:undefined;
    const uploadUrl=typeof result?.uploadURL==='string'&&result.uploadURL.startsWith('https://')?result.uploadURL:null;
    if(!uid) throw new Error('stream_provider_invalid_response');
    if(!uploadUrl) {
      const persisted=await compensateUid(uid,'stream_provider_invalid_response');
      if(!persisted) return json({error:'asset_state_failed'},503);
      return json({error:'stream_provider_invalid_response'},502);
    }
    const {error:updateError}=await db.from('video_assets').update({
      cloudflare_uid:uid,status:'uploading',upload_expires_at:expiresAt,provider_status:'pendingupload',
    }).eq('id',id).eq('owner_id',user.id);
    if(updateError) {
      const persisted=await compensateUid(uid,'asset_state_failed');
      if(!persisted) return json({error:'asset_state_failed'},503);
      return json({error:'asset_state_failed'},503);
    }
    return json({success:true,data:{
      assetId:id,uploadUrl,method:'POST',formField:'file',expiresAt,
      maxDurationSeconds:STREAM_MAX_DURATION_SECONDS,maxSizeBytes:STREAM_MAX_SIZE_BYTES,
    }});
  } catch(error) {
    const safe=sanitizeProviderError(error);
    const persisted=uid
      ? await compensateUid(uid,safe.code)
      : await persistRecovery({status:'failed',error_code:safe.code,error_message:safe.message,next_cleanup_attempt_at:null},safe.code);
    if(!persisted) return json({error:'asset_state_failed'},503);
    return json({error:safe.code},safe.status);
  }
});
