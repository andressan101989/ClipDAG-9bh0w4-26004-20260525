import { authenticatedUser,admin,json } from '../_shared/mediaAuth.ts';
import { isUuid,reconcileStreamVideo,sanitizeProviderError,streamCustomerCode,streamFetch } from '../_shared/stream.ts';

function descriptor(asset:Record<string,unknown>) {
  const ready=asset.status==='ready';
  return {assetId:asset.id,status:asset.status,progress:asset.provider_progress??null,
    durationSeconds:asset.duration_seconds??null,width:asset.width??null,height:asset.height??null,
    hlsUrl:ready?asset.hls_url:null,dashUrl:ready?asset.dash_url:null,
    thumbnailUrl:ready?asset.thumbnail_url:null,errorCode:asset.error_code??null,readyAt:asset.ready_at??null};
}
Deno.serve(async(req)=>{
  if(req.method!=='POST') return json({error:'method_not_allowed'},405);
  const user=await authenticatedUser(req); if(!user) return json({error:'unauthorized'},401);
  const body=await req.json().catch(()=>({})) as Record<string,unknown>;
  if(!isUuid(body.asset_id)) return json({error:'invalid_asset_id'},400);
  const db=admin();
  const {data,error}=await db.from('video_assets').select('*').eq('id',body.asset_id).eq('owner_id',user.id).maybeSingle();
  if(error) return json({error:'asset_lookup_failed'},500);
  if(!data) return json({error:'asset_not_found'},404);
  if(data.status==='deleted') return json({error:'asset_deleted'},410);
  let asset=data as Record<string,unknown>;
  const checkable=['uploading','processing'].includes(String(asset.status))&&typeof asset.cloudflare_uid==='string';
  const checkedAt=asset.last_provider_check_at?Date.parse(String(asset.last_provider_check_at)):0;
  if(checkable&&Date.now()-checkedAt>=5_000) {
    try {
      const provider=await streamFetch(`/${encodeURIComponent(String(asset.cloudflare_uid))}`,{method:'GET'});
      const result=provider.result as Record<string,unknown>|undefined;
      if(!result) throw new Error('stream_provider_invalid_response');
      const updates=reconcileStreamVideo(result,streamCustomerCode());
      const {data:updated,error:updateError}=await db.from('video_assets').update(updates)
        .eq('id',asset.id).eq('owner_id',user.id).select('*').single();
      if(updateError) return json({error:'asset_state_failed'},503);
      asset=updated as Record<string,unknown>;
    } catch(providerError) {
      const safe=sanitizeProviderError(providerError);
      return json({error:safe.code},safe.status);
    }
  }
  return json({success:true,data:descriptor(asset)});
});
