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
  const db=admin(),minuteAgo=new Date(Date.now()-60_000).toISOString();
  const [recentResult,activeResult]=await Promise.all([
    db.from('video_assets').select('*',{head:true,count:'exact'}).eq('owner_id',user.id).gte('created_at',minuteAgo),
    db.from('video_assets').select('*',{head:true,count:'exact'}).eq('owner_id',user.id).in('status',['pending','uploading','processing']),
  ]);
  if(recentResult.error||activeResult.error) return json({error:'rate_limit_unavailable'},503);
  if((recentResult.count??0)>=5||(activeResult.count??0)>=3) return json({error:'rate_limited'},429);
  const id=crypto.randomUUID(),expiresAt=new Date(Date.now()+15*60_000).toISOString();
  const {error:insertError}=await db.from('video_assets').insert({
    id,owner_id:user.id,provider:'cloudflare_stream',purpose:'feed_video',visibility:'public',
    status:'pending',mime_type:mime,size_bytes:size,original_filename:safeFilename(body.file_name),
    max_duration_seconds:STREAM_MAX_DURATION_SECONDS,
  });
  if(insertError) return json({error:'asset_create_failed'},500);
  let uid:string|undefined;
  try {
    const environment=Deno.env.get('DENO_DEPLOYMENT_ID')?'production':'development';
    const provider=await streamFetch('/direct_upload',{method:'POST',body:JSON.stringify({
      maxDurationSeconds:STREAM_MAX_DURATION_SECONDS,creator:user.id,requireSignedURLs:false,
      allowedOrigins:[],expiry:expiresAt,meta:{asset_id:id,purpose:'feed_video',environment},
    })});
    const result=provider.result as Record<string,unknown>|undefined;
    uid=typeof result?.uid==='string'?result.uid:undefined;
    const uploadUrl=typeof result?.uploadURL==='string'&&result.uploadURL.startsWith('https://')?result.uploadURL:null;
    if(!uid||!uploadUrl) throw new Error('stream_provider_invalid_response');
    const {error:updateError}=await db.from('video_assets').update({
      cloudflare_uid:uid,status:'uploading',upload_expires_at:expiresAt,provider_status:'pendingupload',
    }).eq('id',id).eq('owner_id',user.id);
    if(updateError) {
      let deleted=false;
      try { await streamFetch(`/${encodeURIComponent(uid)}`,{method:'DELETE'}); deleted=true; } catch { /* retry by cleanup */ }
      await db.from('video_assets').update(deleted
        ? {status:'failed',error_code:'asset_state_failed'}
        : {status:'delete_pending',error_code:'asset_state_failed',next_cleanup_attempt_at:new Date().toISOString()}
      ).eq('id',id);
      return json({error:'asset_state_failed'},503);
    }
    return json({success:true,data:{
      assetId:id,uploadUrl,method:'POST',formField:'file',expiresAt,
      maxDurationSeconds:STREAM_MAX_DURATION_SECONDS,maxSizeBytes:STREAM_MAX_SIZE_BYTES,
    }});
  } catch(error) {
    const safe=sanitizeProviderError(error);
    await db.from('video_assets').update({
      status:uid?'delete_pending':'failed',error_code:safe.code,error_message:safe.message,
      next_cleanup_attempt_at:uid?new Date().toISOString():null,
    }).eq('id',id);
    return json({error:safe.code},safe.status);
  }
});
