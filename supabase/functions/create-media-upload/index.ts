import { businessActorHasAdvertiserOwnerMediaAccess,businessActorHasAnyCapability,isUuid } from '../_shared/businessMediaAuth.ts';
import { authenticatedClient,authenticatedUser,admin,corsHeaders,json } from '../_shared/mediaAuth.ts';
import { extensionForMime,validateMediaRequest } from '../_shared/mediaPurposes.ts';
import {
  PREMIUM_ORIGINAL_CACHE_CONTROL,
  signPremiumOriginalPutIfAbsent,
} from '../_shared/premiumR2Security.ts';
import { R2_PRIVATE_BUCKET,R2_PUBLIC_BUCKET,signPutIfAbsent } from '../_shared/r2.ts';

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST') return json({error:'method_not_allowed'},405);
  const user=await authenticatedUser(req); if(!user) return json({error:'unauthorized'},401);
  const body=await req.json().catch(()=>({}));
  const purpose=String(body.purpose??''),mime=String(body.mime_type??''),visibility=String(body.visibility??'');
  const premiumContentId=body.premium_content_id;
  const isPremiumPurpose=purpose==='creator_premium_teaser_image'||purpose==='creator_premium_original_image';
  const isPremiumOriginal=purpose==='creator_premium_original_image';
  if(isPremiumPurpose){
    if(!isUuid(premiumContentId))return json({error:'invalid_premium_content'},400);
    if(body.business_owner_id!==undefined&&body.business_owner_id!==null)return json({error:'invalid_premium_media_contract'},400);
  }else if(premiumContentId!==undefined&&premiumContentId!==null){
    return json({error:'unexpected_premium_context'},400);
  }
  const requestedBusinessOwner=body.business_owner_id;
  let ownerId=user.id;
  if(requestedBusinessOwner!==undefined&&requestedBusinessOwner!==null) {
    if(!isUuid(requestedBusinessOwner)) return json({error:'invalid_business_scope'},400);
    const capability = purpose==='business_library'&&visibility==='public'
      ? 'business.media.manage'
      : purpose==='return_label'&&visibility==='private'
        ? 'business.returns.manage'
        : purpose==='dispute_evidence'&&visibility==='private'
          ? 'business.disputes.respond'
          : null;
    if(!capability) return json({error:'invalid_business_media_contract'},400);
    const legacyAllowed=await businessActorHasAnyCapability(req,requestedBusinessOwner,[capability]);
    const advertiserOwnerAllowed=purpose==='business_library'&&visibility==='public'
      ? await businessActorHasAdvertiserOwnerMediaAccess(user.id,requestedBusinessOwner)
      : false;
    const allowed=legacyAllowed||advertiserOwnerAllowed;
    if(!allowed) return json({error:'business_media_capability_required'},403);
    ownerId=requestedBusinessOwner;
  } else if(purpose==='business_library') {
    return json({error:'business_scope_required'},400);
  }
  const size=Number(body.size_bytes);
  const validated=validateMediaRequest(purpose,mime,size,visibility);
  if('error' in validated) return json({error:validated.error},400);
  if(isPremiumPurpose){
    const caller=authenticatedClient(req);
    if(!caller)return json({error:'unauthorized'},401);
    const {data:authorized,error:authorizationError}=await caller.rpc(
      'authorize_my_creator_premium_image_upload_v1',
      {p_content_id:premiumContentId,p_purpose:purpose},
    );
    if(authorizationError||authorized!==true)return json({error:'premium_upload_forbidden'},403);
  }
  const db=admin();
  const minute=new Date(Date.now()-60_000).toISOString();
  const [recentResult,pendingResult,bytesResult] = await Promise.all([
    db.from('media_assets').select('*',{count:'exact',head:true}).eq('owner_id',ownerId).gte('created_at',minute),
    db.from('media_assets').select('*',{count:'exact',head:true}).eq('owner_id',ownerId).in('status',['pending','uploading']),
    db.from('media_assets').select('size_bytes').eq('owner_id',ownerId).gte('created_at',minute),
  ]);
  if(recentResult.error||pendingResult.error||bytesResult.error) return json({error:'rate_limit_unavailable'},503);
  const recent=recentResult.count,pending=pendingResult.count,bytes=bytesResult.data;
  if((recent??0)>=20||(pending??0)>=10) return json({error:'rate_limited'},429);
  if((bytes??[]).reduce((n,r)=>n+Number(r.size_bytes??0),0)+size>500_000_000) return json({error:'byte_rate_limited'},429);
  const id=crypto.randomUUID(),now=new Date(),ext=extensionForMime(mime);
  const env=Deno.env.get('DENO_DEPLOYMENT_ID')?'production':'development';
  const key=`${env}/${purpose}/${ownerId}/${now.getUTCFullYear()}/${String(now.getUTCMonth()+1).padStart(2,'0')}/${id}.${ext}`;
  const bucket=visibility==='public'?R2_PUBLIC_BUCKET():R2_PRIVATE_BUCKET();
  const safeName=String(body.file_name??'upload').replace(/[\u0000-\u001f\\\/]/g,'_').slice(0,180);
  const {error}=await db.from('media_assets').insert({id,owner_id:ownerId,provider:'r2',media_kind:validated.rule.kind,purpose,visibility,bucket_name:bucket,object_key:key,mime_type:mime,size_bytes:size,original_filename:safeName,status:'pending'});
  if(error) return json({error:'asset_create_failed'},500);
  let uploadUrl:string;
  try {
    if(isPremiumOriginal) {
      uploadUrl=await signPremiumOriginalPutIfAbsent(bucket,key,mime);
    } else {
      uploadUrl=await signPutIfAbsent(bucket,key,mime,{});
    }
  }
  catch {
    await db.from('media_assets').update({status:'failed',error_code:'presign_failed',updated_at:new Date().toISOString()}).eq('id',id);
    return json({error:'presign_failed'},503);
  }
  const {error:stateError}=await db.from('media_assets').update({status:'uploading',updated_at:new Date().toISOString()}).eq('id',id);
  if(stateError) {
    await db.from('media_assets').update({
      status:'delete_pending',error_code:'asset_state_failed',
      next_cleanup_attempt_at:new Date().toISOString(),updated_at:new Date().toISOString(),
    }).eq('id',id);
    return json({error:'asset_state_failed'},503);
  }
  const uploadContract=isPremiumOriginal
    ? {headers:{'Content-Type':mime,'If-None-Match':'*','Cache-Control':PREMIUM_ORIGINAL_CACHE_CONTROL}}
    : {headers:{'Content-Type':mime,'If-None-Match':'*'}};
  return json({success:true,data:{assetId:id,uploadUrl,method:'PUT',...uploadContract,expiresAt:new Date(Date.now()+300_000).toISOString(),ownerId}});
});
