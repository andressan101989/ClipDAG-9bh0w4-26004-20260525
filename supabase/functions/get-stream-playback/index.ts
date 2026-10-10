import { authenticatedClient,authenticatedUser,admin,corsHeaders,json } from '../_shared/mediaAuth.ts';
import {
  CREATOR_PREMIUM_STREAM_PURPOSE,createPremiumStreamPlaybackGrant,
  reconcilePremiumStreamVideo,
} from '../_shared/premiumStreamSecurity.ts';
import { isUuid,reconcileStreamVideo,sanitizeProviderError,streamCustomerCode,streamFetch } from '../_shared/stream.ts';

const premiumJson=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,
  headers:{
    ...corsHeaders,
    'Content-Type':'application/json',
    'Cache-Control':'private, no-store',
    'Pragma':'no-cache',
  },
});

function descriptor(asset:Record<string,unknown>) {
  const premium=asset.purpose===CREATOR_PREMIUM_STREAM_PURPOSE;
  const ready=asset.status==='ready'&&!premium;
  return {
    assetId:asset.id,
    status:asset.status,
    progress:asset.provider_progress??null,
    durationSeconds:asset.duration_seconds??null,
    width:asset.width??null,
    height:asset.height??null,
    hlsUrl:ready?asset.hls_url:null,
    dashUrl:ready?asset.dash_url:null,
    thumbnailUrl:ready?asset.thumbnail_url:null,
    errorCode:asset.error_code??null,
    readyAt:asset.ready_at??null,
    ...(premium?{playbackMode:'premium_entitlement_required'}:{}),
  };
}

function hasPremiumProviderProof(asset:Record<string,unknown>):boolean {
  const metadata=asset.provider_metadata&&typeof asset.provider_metadata==='object'
    ? asset.provider_metadata as Record<string,unknown>:{};
  return asset.purpose===CREATOR_PREMIUM_STREAM_PURPOSE
    && asset.provider==='cloudflare_stream'
    && asset.visibility==='private'
    && typeof asset.cloudflare_uid==='string'
    && asset.cloudflare_uid.trim().length>0
    && asset.hls_url===null
    && asset.dash_url===null
    && asset.thumbnail_url===null
    && metadata.require_signed_urls===true;
}

const premiumReviewableLifecycles=new Set([
  'pending_review','published','rejected','quarantined','removed',
]);

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers:corsHeaders});
  if(req.method!=='POST') return json({error:'method_not_allowed'},405);
  const user=await authenticatedUser(req); if(!user) return json({error:'unauthorized'},401);
  const body=await req.json().catch(()=>({})) as Record<string,unknown>;
  const hasAsset=body.asset_id!==undefined;
  const hasPremiumContent=body.premium_content_id!==undefined;
  const hasAdminReview=body.admin_review!==undefined;
  if(hasAsset===hasPremiumContent) return json({error:'invalid_request'},400);
  if(hasAdminReview&&body.admin_review!==true) return json({error:'invalid_request'},400);
  if(hasAdminReview&&!hasPremiumContent) return json({error:'invalid_request'},400);

  if(hasPremiumContent) {
    if(!isUuid(body.premium_content_id)) return json({error:'invalid_premium_content'},400);
    const contentId=body.premium_content_id;
    const caller=authenticatedClient(req);
    if(!caller) return json({error:'unauthorized'},401);
    let adminReviewCreatorId:string|null=null;
    if(body.admin_review===true){
      const {data:adminAllowed,error:adminError}=await caller.rpc('admin_actor_has_capability',{
        p_capability:'creator_premium.review.read',
      });
      if(adminError||adminAllowed!==true) return premiumJson({error:'forbidden'},403);
      const {data:reviewDetail,error:reviewError}=await caller.rpc(
        'get_admin_creator_premium_content_v1',{p_content_id:contentId},
      );
      const detail=reviewDetail&&typeof reviewDetail==='object'
        ? reviewDetail as Record<string,unknown>:null;
      const creator=detail?.creator&&typeof detail.creator==='object'
        ? detail.creator as Record<string,unknown>:null;
      if(reviewError||!detail||detail.content_kind!=='video'
        ||typeof detail.lifecycle_status!=='string'
        ||!premiumReviewableLifecycles.has(detail.lifecycle_status)
        ||typeof creator?.id!=='string'||!isUuid(creator.id)){
        return premiumJson({error:'forbidden'},403);
      }
      adminReviewCreatorId=creator.id;
    }else{
      const {data:entitlementData,error:entitlementError}=await caller.rpc(
        'get_my_creator_premium_entitlement_v1',
        {p_content_id:contentId},
      );
      const entitlement=Array.isArray(entitlementData)?entitlementData[0]:entitlementData;
      if(entitlementError||entitlement?.allowed!==true) return premiumJson({error:'forbidden'},403);
    }

    const db=admin();
    const {data:links,error:linksError}=await db.from('video_asset_links')
      .select('asset_id')
      .eq('entity_type','creator_premium_content')
      .eq('entity_id',contentId)
      .eq('slot','original')
      .eq('position',0)
      .limit(2);
    if(linksError) return premiumJson({error:'premium_video_unavailable'},503);
    if(!links?.length) return premiumJson({error:'not_found'},404);
    if(links.length!==1) return premiumJson({error:'premium_video_ambiguous'},409);

    const {data:asset,error:assetError}=await db.from('video_assets')
      .select('*')
      .eq('id',links[0].asset_id)
      .maybeSingle();
    if(assetError) return premiumJson({error:'premium_video_unavailable'},503);
    if(!asset) return premiumJson({error:'not_found'},404);
    if(!hasPremiumProviderProof(asset as Record<string,unknown>)) {
      return premiumJson({error:'premium_video_forbidden'},403);
    }
    if(body.admin_review===true&&asset.owner_id!==adminReviewCreatorId) {
      return premiumJson({error:'premium_video_forbidden'},403);
    }
    if(asset.status!=='ready') return premiumJson({error:'premium_video_unavailable'},409);
    try {
      const grant=await createPremiumStreamPlaybackGrant({
        cloudflareUid:String(asset.cloudflare_uid),
        customerCode:streamCustomerCode(),
      });
      return premiumJson({success:true,data:{contentId,...grant}});
    } catch(error) {
      const safe=sanitizeProviderError(error);
      return premiumJson({error:safe.code},safe.status);
    }
  }

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
      const providerUid=typeof result.uid==='string'?result.uid.trim():'';
      if(!providerUid||providerUid!==asset.cloudflare_uid) {
        return json({error:'stream_provider_uid_mismatch'},502);
      }
      const updates=asset.purpose===CREATOR_PREMIUM_STREAM_PURPOSE
        ? reconcilePremiumStreamVideo(
          result,String(asset.cloudflare_uid),Number(asset.max_duration_seconds??60),
        )
        : reconcileStreamVideo(
          result,streamCustomerCode(),String(asset.cloudflare_uid),Number(asset.max_duration_seconds??60),
        );
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
