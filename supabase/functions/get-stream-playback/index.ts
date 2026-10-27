import { authenticatedClient,authenticatedUser,admin,corsHeaders,json } from '../_shared/mediaAuth.ts';
import {
  CREATOR_PREMIUM_STREAM_PURPOSE,STORY_STREAM_PURPOSE,
  createPrivateStreamPlaybackGrant,createPremiumStreamPlaybackGrant,
  isPrivateStreamPurpose,reconcilePrivateStreamVideo,
} from '../_shared/premiumStreamSecurity.ts';
import {
  isUuid,monotonicStreamUpdates,reconcileStreamVideo,sanitizeProviderError,
  streamCustomerCode,streamFetch,
} from '../_shared/stream.ts';

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
  const privatePurpose=isPrivateStreamPurpose(asset.purpose);
  const ready=asset.status==='ready'&&!privatePurpose;
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
    ...(asset.purpose===CREATOR_PREMIUM_STREAM_PURPOSE
      ?{playbackMode:'premium_entitlement_required'}
      :asset.purpose===STORY_STREAM_PURPOSE
        ?{playbackMode:'story_visibility_required'}:{}),
  };
}

function hasPrivateProviderProof(asset:Record<string,unknown>,purpose:string):boolean {
  const metadata=asset.provider_metadata&&typeof asset.provider_metadata==='object'
    ? asset.provider_metadata as Record<string,unknown>:{};
  return asset.purpose===purpose
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
  const hasStory=body.story_id!==undefined;
  const hasAdminReview=body.admin_review!==undefined;
  if(Number(hasAsset)+Number(hasPremiumContent)+Number(hasStory)!==1) {
    return json({error:'invalid_request'},400);
  }
  if(hasAdminReview&&body.admin_review!==true) return json({error:'invalid_request'},400);
  if(hasAdminReview&&!hasPremiumContent) return json({error:'invalid_request'},400);

  if(hasStory) {
    if(!isUuid(body.story_id)) return premiumJson({error:'invalid_story'},400);
    const storyId=body.story_id;
    const caller=authenticatedClient(req);
    if(!caller) return premiumJson({error:'unauthorized'},401);
    // This read intentionally uses the caller JWT. The canonical Stories RLS
    // owns expiry, blocks, moderation and fail-closed safety visibility.
    const {data:story,error:storyError}=await caller.from('stories')
      .select('id,user_id,media_type,expires_at').eq('id',storyId).maybeSingle();
    if(storyError) return premiumJson({error:'story_video_unavailable'},503);
    if(!story||story.media_type!=='video') return premiumJson({error:'not_found'},404);
    const nowSeconds=Math.floor(Date.now()/1000);
    const storyExpiryMilliseconds=typeof story.expires_at==='string'
      ?Date.parse(story.expires_at):Number.NaN;
    const maximumExpiresAtSeconds=Math.floor(storyExpiryMilliseconds/1000);
    if(!Number.isSafeInteger(maximumExpiresAtSeconds)) {
      return premiumJson({error:'story_video_unavailable'},503);
    }
    if(maximumExpiresAtSeconds<=nowSeconds) return premiumJson({error:'not_found'},404);

    const db=admin();
    const {data:links,error:linksError}=await db.from('video_asset_links')
      .select('asset_id,owner_id').eq('entity_type','story').eq('entity_id',storyId)
      .eq('slot','media').eq('position',0).limit(2);
    if(linksError) return premiumJson({error:'story_video_unavailable'},503);
    if(!links?.length) return premiumJson({error:'not_found'},404);
    if(links.length!==1) return premiumJson({error:'story_video_ambiguous'},409);
    const {data:asset,error:assetError}=await db.from('video_assets')
      .select('*').eq('id',links[0].asset_id).maybeSingle();
    if(assetError) return premiumJson({error:'story_video_unavailable'},503);
    if(!asset) return premiumJson({error:'not_found'},404);
    if(links[0].owner_id!==story.user_id||asset.owner_id!==story.user_id
      ||!hasPrivateProviderProof(asset as Record<string,unknown>,STORY_STREAM_PURPOSE)) {
      return premiumJson({error:'story_video_forbidden'},403);
    }
    if(asset.status!=='ready'||Number(asset.duration_seconds)<=0
      ||Number(asset.duration_seconds)>15) {
      return premiumJson({error:'story_video_unavailable'},409);
    }
    try {
      const grant=await createPrivateStreamPlaybackGrant({
        cloudflareUid:String(asset.cloudflare_uid),customerCode:streamCustomerCode(),
        nowSeconds,maximumExpiresAtSeconds,
      });
      return premiumJson({success:true,data:{storyId,...grant}});
    } catch(error) {
      const safe=sanitizeProviderError(error);
      return premiumJson({error:safe.code},safe.status);
    }
  }

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
    if(!hasPrivateProviderProof(asset as Record<string,unknown>,CREATOR_PREMIUM_STREAM_PURPOSE)) {
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
      const updates=isPrivateStreamPurpose(asset.purpose)
        ? reconcilePrivateStreamVideo(
          result,String(asset.cloudflare_uid),asset.purpose,
          Number(asset.max_duration_seconds??60),
        )
        : reconcileStreamVideo(
          result,streamCustomerCode(),String(asset.cloudflare_uid),Number(asset.max_duration_seconds??60),
        );
      const guardedUpdates=monotonicStreamUpdates(asset,updates);
      let updated:Record<string,unknown>|null=null;
      if(guardedUpdates) {
        const {data:updateData,error:updateError}=await db.from('video_assets').update(guardedUpdates)
          .eq('id',asset.id)
          .eq('owner_id',user.id)
          .eq('cloudflare_uid',String(asset.cloudflare_uid))
          .eq('status',String(asset.status))
          .eq('updated_at',String(asset.updated_at))
          .select('*').maybeSingle();
        if(updateError) return json({error:'asset_state_failed'},503);
        updated=updateData as Record<string,unknown>|null;
      }
      if(updated) {
        asset=updated;
      } else {
        // A webhook/deletion may win the CAS, or Cloudflare may return an
        // out-of-order observation rejected by the monotonic guard. Re-read
        // without writing so polling always observes canonical server state.
        const {data:canonical,error:canonicalError}=await db.from('video_assets')
          .select('*').eq('id',asset.id).eq('owner_id',user.id).maybeSingle();
        if(canonicalError) return json({error:'asset_state_failed'},503);
        if(!canonical) return json({error:'asset_not_found'},404);
        asset=canonical as Record<string,unknown>;
      }
    } catch(providerError) {
      const safe=sanitizeProviderError(providerError);
      return json({error:safe.code},safe.status);
    }
  }
  return json({success:true,data:descriptor(asset)});
});
