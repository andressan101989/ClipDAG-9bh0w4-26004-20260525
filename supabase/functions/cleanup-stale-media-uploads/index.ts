import { admin,json } from '../_shared/mediaAuth.ts';
import { deleteObject } from '../_shared/r2.ts';
import { sanitizeProviderError,streamFetch,StreamProviderError } from '../_shared/stream.ts';

type PremiumVideoCleanupRow={
  id:string;
  cloudflare_uid:string|null;
  delete_attempts:number;
};

Deno.serve(async(req)=>{
  if(req.method!=='POST') return json({error:'method_not_allowed'},405);
  const supplied=req.headers.get('X-Cleanup-Secret');
  const expected=Deno.env.get('MEDIA_CLEANUP_SECRET');
  if(!expected||supplied!==expected) return json({error:'forbidden'},403);
  const db=admin();
  const [{data:mediaRows,error:mediaError},{data:videoRows,error:videoError}]=await Promise.all([
    db.rpc('cleanup_stale_media_upload_records',{p_limit:50}),
    db.rpc('cleanup_stale_creator_premium_video_records',{p_limit:50}),
  ]);
  if(mediaError||videoError) return json({error:'cleanup_failed'},500);

  let objectsDeleted=0;
  for(const row of mediaRows??[]) {
    try {
      await deleteObject(row.bucket_name,row.object_key);
      await db.from('media_assets').update({
        status:'deleted',error_code:null,deleted_at:new Date().toISOString(),
        next_cleanup_attempt_at:null,updated_at:new Date().toISOString(),
      }).eq('id',row.id).eq('status','delete_pending');
      objectsDeleted++;
    } catch {
      await db.from('media_assets').update({error_code:'delete_retry_required',updated_at:new Date().toISOString()})
        .eq('id',row.id).eq('status','delete_pending');
    }
  }

  let streamVideosDeleted=0;
  for(const row of (videoRows??[]) as PremiumVideoCleanupRow[]) {
    try {
      if(row.cloudflare_uid) {
        try { await streamFetch(`/${encodeURIComponent(row.cloudflare_uid)}`,{method:'DELETE'}); }
        catch(error) {
          if(!(error instanceof StreamProviderError&&error.code==='stream_not_found')) throw error;
        }
      }
      const {data:deletedRow,error:deletedError}=await db.from('video_assets').update({
        status:'deleted',deleted_at:new Date().toISOString(),
        hls_url:null,dash_url:null,thumbnail_url:null,
        error_code:null,error_message:null,next_cleanup_attempt_at:null,
        updated_at:new Date().toISOString(),
      }).eq('id',row.id).eq('purpose','creator_premium_video').eq('status','delete_pending')
        .select('id').maybeSingle();
      if(deletedError) throw new StreamProviderError('stream_cleanup_database_update_failed',503,true);
      if(deletedRow?.id===row.id) streamVideosDeleted++;
    } catch(providerError) {
      const safe=sanitizeProviderError(providerError);
      const {error:retryError}=await db.from('video_assets').update({
        status:'delete_pending',error_code:safe.code,error_message:safe.message,
        updated_at:new Date().toISOString(),
      }).eq('id',row.id).eq('purpose','creator_premium_video').eq('status','delete_pending')
        .select('id').maybeSingle();
      if(retryError) return json({error:'cleanup_failed'},500);
    }
  }

  return json({
    success:true,
    stale:(mediaRows??[]).length,
    objectsDeleted,
    premiumVideosStale:(videoRows??[]).length,
    premiumVideosDeleted:streamVideosDeleted,
  });
});
