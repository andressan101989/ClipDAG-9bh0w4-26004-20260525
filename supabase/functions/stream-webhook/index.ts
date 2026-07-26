import { admin,json } from '../_shared/mediaAuth.ts';
import {
  isUuid,reconcileStreamVideo,streamCustomerCode,streamWebhookSecret,verifyWebhook,webhookVideo,
} from '../_shared/stream.ts';

Deno.serve(async(req)=>{
  if(req.method!=='POST') return json({error:'method_not_allowed'},405);
  const secret=streamWebhookSecret();
  if(!secret) return json({error:'stream_webhook_not_configured'},503);
  const rawBody=await req.text();
  if(!await verifyWebhook(rawBody,req.headers.get('Webhook-Signature'),secret)) {
    return json({error:'invalid_webhook_signature'},401);
  }
  let payload:Record<string,unknown>;
  try { payload=JSON.parse(rawBody) as Record<string,unknown>; }
  catch { return json({error:'invalid_json'},400); }
  const video=webhookVideo(payload);
  if(!video) return json({success:true},202);
  const uid=typeof video.uid==='string'?video.uid.trim():'';
  if(!uid) return json({success:true},202);
  const meta=video.meta&&typeof video.meta==='object'?video.meta as Record<string,unknown>:{};
  const assetId=isUuid(meta.asset_id)?meta.asset_id:null;
  const db=admin();
  let query=db.from('video_assets').select('*');
  query=assetId?query.eq('id',assetId):query.eq('cloudflare_uid',uid);
  const {data:asset,error:lookupError}=await query.maybeSingle();
  if(lookupError) return json({error:'stream_webhook_lookup_failed'},503);
  if(!asset) return json({success:true},202);
  if(!asset.cloudflare_uid||uid!==asset.cloudflare_uid) return json({success:true},202);
  if(['deleted','delete_pending'].includes(asset.status)) return json({success:true});
  const updates=reconcileStreamVideo(
    video,streamCustomerCode(),asset.cloudflare_uid,Number(asset.max_duration_seconds??60),
  );
  if(asset.status==='ready') {
    if(updates.status!=='ready') return json({success:true});
    const providerPlayback=video.playback&&typeof video.playback==='object'
      ? video.playback as Record<string,unknown>:{};
    const providerHls=typeof providerPlayback.hls==='string'?providerPlayback.hls:null;
    updates.status='ready';
    updates.ready_at=asset.ready_at;
    updates.hls_url=providerHls?.startsWith('https://')?updates.hls_url:asset.hls_url;
    updates.dash_url=updates.dash_url??asset.dash_url;
    updates.thumbnail_url=updates.thumbnail_url??asset.thumbnail_url;
    updates.error_code=null;
    updates.error_message=null;
  } else if(asset.ready_at) {
    updates.ready_at=asset.ready_at;
  }
  const {error:updateError}=await db.from('video_assets').update(updates).eq('id',asset.id);
  if(updateError) return json({error:'stream_webhook_update_failed'},503);
  return json({success:true});
});
