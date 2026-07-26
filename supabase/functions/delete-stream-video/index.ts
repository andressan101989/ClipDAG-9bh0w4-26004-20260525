import { authenticatedUser,admin,json } from '../_shared/mediaAuth.ts';
import { isUuid,sanitizeProviderError,streamFetch,StreamProviderError } from '../_shared/stream.ts';

Deno.serve(async(req)=>{
  if(req.method!=='POST') return json({error:'method_not_allowed'},405);
  const user=await authenticatedUser(req); if(!user) return json({error:'unauthorized'},401);
  const body=await req.json().catch(()=>({})) as Record<string,unknown>;
  if(!isUuid(body.asset_id)) return json({error:'invalid_asset_id'},400);
  const db=admin();
  const {data,error}=await db.from('video_assets').select('*').eq('id',body.asset_id).eq('owner_id',user.id).maybeSingle();
  if(error) return json({error:'asset_lookup_failed'},500);
  if(!data) return json({error:'asset_not_found'},404);
  if(data.status==='deleted') return json({success:true,data:{assetId:data.id,status:'deleted'}});
  const {count,error:linkError}=await db.from('video_asset_links').select('*',{head:true,count:'exact'}).eq('asset_id',data.id);
  if(linkError) return json({error:'asset_link_check_failed'},503);
  if((count??0)>0) return json({error:'asset_in_use'},409);
  const attempts=Number(data.delete_attempts??0)+1;
  await db.from('video_assets').update({status:'delete_pending',delete_attempts:attempts}).eq('id',data.id);
  try {
    if(data.cloudflare_uid) {
      try { await streamFetch(`/${encodeURIComponent(data.cloudflare_uid)}`,{method:'DELETE'}); }
      catch(error) {
        if(error instanceof StreamProviderError&&error.code==='stream_not_found') { /* idempotent */ }
        else throw error;
      }
    }
    await db.from('video_assets').update({
      status:'deleted',deleted_at:new Date().toISOString(),hls_url:null,dash_url:null,thumbnail_url:null,
      error_code:null,error_message:null,next_cleanup_attempt_at:null,
    }).eq('id',data.id);
    return json({success:true,data:{assetId:data.id,status:'deleted'}});
  } catch(providerError) {
    const safe=sanitizeProviderError(providerError);
    await db.from('video_assets').update({
      status:'delete_pending',error_code:safe.code,error_message:safe.message,
      next_cleanup_attempt_at:new Date(Date.now()+Math.min(3600,60*Math.max(1,attempts))*1000).toISOString(),
    }).eq('id',data.id);
    return json({error:safe.code},503);
  }
});
