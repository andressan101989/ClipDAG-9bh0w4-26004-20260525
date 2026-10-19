import { businessActorHasAdvertiserOwnerMediaAccess,businessActorHasAnyCapability,isUuid } from '../_shared/businessMediaAuth.ts';
import { authenticatedClient,authenticatedUser,admin,corsHeaders,json } from '../_shared/mediaAuth.ts';
import { CREATOR_PREMIUM_STREAM_PURPOSE } from '../_shared/premiumStreamSecurity.ts';
import {
  canonicalCloudflareTusLocation,
  cloudflareTusProvisionRetryDelayMs,
  classifyCloudflareTusFailure,
} from './premiumTusContract.mjs';
import {
  STREAM_MAX_DURATION_SECONDS,STREAM_MAX_SIZE_BYTES,StreamProviderError,safeFilename,
  sanitizeProviderError,streamApiBase,streamFetch,streamToken,
  validateStreamMime,validateStreamSize,
} from '../_shared/stream.ts';

const CREATOR_PREMIUM_STREAM_MAX_DURATION_SECONDS=180;

function encodeTusMetadata(value:string):string {
  const bytes=new TextEncoder().encode(value);
  let binary='';
  for(const byte of bytes) binary+=String.fromCharCode(byte);
  return btoa(binary);
}

function tusMetadataHeader(entries:Record<string,string|null>):string {
  return Object.entries(entries)
    .map(([key,value])=>value===null?key:`${key} ${encodeTusMetadata(value)}`)
    .join(',');
}

function safeProviderHeader(value:string|null):string|null {
  const normalized=value?.trim()??'';
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized)?normalized:null;
}

async function safeProviderErrorCode(response:Response):Promise<string|null> {
  const payload=await response.clone().json().catch(()=>null) as Record<string,unknown>|null;
  const errors=Array.isArray(payload?.errors)?payload.errors:[];
  const first=errors[0]&&typeof errors[0]==='object'?errors[0] as Record<string,unknown>:null;
  const code=String(first?.code??'').trim();
  return /^[A-Za-z0-9_.-]{1,64}$/.test(code)?code:null;
}

function safeLocationHost(value:string):string|null {
  try {
    const host=new URL(value).hostname;
    return /^[a-z0-9.-]{1,253}$/i.test(host)?host.toLowerCase():null;
  } catch {
    return null;
  }
}

async function createPremiumTusUpload(input:{
  assetId:string;
  ownerId:string;
  premiumContentId:string;
  fileName:string;
  sizeBytes:number;
  expiresAt:string;
  environment:string;
}):Promise<{uid:string;uploadUrl:string|null}> {
  const metadata={
    name:input.fileName,
    requiresignedurls:null,
    maxDurationSeconds:String(CREATOR_PREMIUM_STREAM_MAX_DURATION_SECONDS),
    expiry:input.expiresAt,
    asset_id:input.assetId,
    purpose:CREATOR_PREMIUM_STREAM_PURPOSE,
    premium_content_id:input.premiumContentId,
    environment:input.environment,
  };
  let response:Response|null=null;
  for(let attempt=1;attempt<=4;attempt+=1) {
    try {
      response=await fetch(`${streamApiBase()}?direct_user=true`,{
        method:'POST',
        headers:{
          Authorization:`Bearer ${streamToken()}`,
          'Tus-Resumable':'1.0.0',
          'Upload-Length':String(input.sizeBytes),
          'Upload-Creator':input.ownerId,
          'Upload-Metadata':tusMetadataHeader(metadata),
        },
        signal:AbortSignal.timeout(15_000),
      });
    } catch {
      console.error('[create-stream-upload] premium_stream_tus_provision_failed',{
        code:'stream_provider_temporarily_unavailable',
        provider_status:null,
        provider_error_code:null,
        provider_request_id:null,
        attempt,
      });
      throw new StreamProviderError('stream_provider_temporarily_unavailable',503,true);
    }
    if(response.ok) break;
    const failure=classifyCloudflareTusFailure(response.status);
    const retryDelayMs=cloudflareTusProvisionRetryDelayMs(
      response.status,
      response.headers.get('retry-after'),
      attempt,
    );
    console.error('[create-stream-upload] premium_stream_tus_provision_failed',{
      code:failure.code,
      provider_status:response.status,
      provider_error_code:await safeProviderErrorCode(response),
      provider_request_id:safeProviderHeader(response.headers.get('cf-ray')),
      attempt,
      retry_scheduled:retryDelayMs!==null,
    });
    if(retryDelayMs===null) {
      throw new StreamProviderError(failure.code,failure.httpStatus,failure.transient);
    }
    await new Promise(resolve=>setTimeout(resolve,retryDelayMs));
  }
  if(!response||!response.ok) {
    throw new StreamProviderError('stream_provider_temporarily_unavailable',503,true);
  }
  const uid=response.headers.get('stream-media-id')?.trim()??'';
  const rawUploadUrl=response.headers.get('location')?.trim()??'';
  const uploadUrl=uid?canonicalCloudflareTusLocation(rawUploadUrl,uid):null;
  if(!uid||!uploadUrl) {
    const mediaIdentifierPresent=Boolean(uid);
    console.error('[create-stream-upload] premium_stream_tus_provision_failed',{
      code:'stream_provider_invalid_response',
      provider_status:response.status,
      provider_error_code:null,
      provider_request_id:safeProviderHeader(response.headers.get('cf-ray')),
      media_identifier_present:mediaIdentifierPresent,
      location_host:safeLocationHost(rawUploadUrl),
    });
    if(uid) return {uid,uploadUrl:null};
    throw new StreamProviderError('stream_provider_invalid_response',502);
  }
  return {uid,uploadUrl};
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST') return json({error:'method_not_allowed'},405);
  const user=await authenticatedUser(req); if(!user) return json({error:'unauthorized'},401);
  const body=await req.json().catch(()=>({})) as Record<string,unknown>;
  const purpose=String(body.purpose??'');
  const requestedBusinessOwner=body.business_owner_id;
  const premiumContentId=body.premium_content_id;
  const isPremium=purpose===CREATOR_PREMIUM_STREAM_PURPOSE;
  if(isPremium) {
    if(requestedBusinessOwner!==undefined&&requestedBusinessOwner!==null) {
      return json({error:'invalid_premium_stream_contract'},400);
    }
    if(!isUuid(premiumContentId)) return json({error:'invalid_premium_content'},400);
    const caller=authenticatedClient(req);
    if(!caller) return json({error:'unauthorized'},401);
    const {data:authorized,error:authorizationError}=await caller.rpc(
      'authorize_my_creator_premium_video_upload_v1',
      {p_content_id:premiumContentId},
    );
    if(authorizationError||authorized!==true) return json({error:'premium_upload_forbidden'},403);
  } else if(premiumContentId!==undefined&&premiumContentId!==null) {
    return json({error:'unexpected_premium_context'},400);
  }
  let ownerId=user.id;
  if(requestedBusinessOwner!==undefined&&requestedBusinessOwner!==null) {
    if(!isUuid(requestedBusinessOwner)) return json({error:'invalid_business_scope'},400);
    if(purpose!=='business_library') return json({error:'invalid_business_media_contract'},400);
    const legacyAllowed=await businessActorHasAnyCapability(req,requestedBusinessOwner,['business.media.manage']);
    const advertiserOwnerAllowed=await businessActorHasAdvertiserOwnerMediaAccess(user.id,requestedBusinessOwner);
    const allowed=legacyAllowed||advertiserOwnerAllowed;
    if(!allowed) return json({error:'business_media_manage_required'},403);
    ownerId=requestedBusinessOwner;
  } else if(purpose!=='feed_video'&&!isPremium) return json({error:'invalid_purpose'},400);
  const mime=validateStreamMime(body.mime_type); if(!mime) return json({error:'invalid_mime_type'},400);
  const size=validateStreamSize(body.size_bytes); if(!size) return json({error:'invalid_size'},400);
  const db=admin();
  const id=crypto.randomUUID(),expiresAt=new Date(Date.now()+15*60_000).toISOString();
  const {data:reservation,error:reservationError}=await db.rpc('reserve_stream_upload_asset',{
    p_asset_id:id,p_owner_id:ownerId,p_mime_type:mime,p_size_bytes:size,
    p_original_filename:safeFilename(body.file_name),p_purpose:purpose,
  });
  if(reservationError) return json({error:'rate_limit_unavailable'},503);
  if(reservation==='rate_limited'||reservation==='active_limit_reached') {
    return json({error:reservation},429);
  }
  if(reservation!=='created') return json({error:'asset_create_failed'},503);

  let uid:string|undefined;
  const persistRecovery=async(values:Record<string,unknown>,code:string):Promise<boolean>=>{
    const {error}=await db.from('video_assets').update(values).eq('id',id).eq('owner_id',ownerId);
    if(error) {
      console.error('[create-stream-upload] recovery_state_persist_failed',{code});
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
    const metadata:Record<string,string>={asset_id:id,purpose,environment};
    if(isPremium) metadata.premium_content_id=String(premiumContentId);
    let uploadUrl:string|null=null;
    if(isPremium) {
      const provider=await createPremiumTusUpload({
        assetId:id,
        ownerId,
        premiumContentId:String(premiumContentId),
        fileName:safeFilename(body.file_name),
        sizeBytes:size,
        expiresAt,
        environment,
      });
      uid=provider.uid;
      uploadUrl=provider.uploadUrl;
    } else {
      const providerContract={
        maxDurationSeconds:STREAM_MAX_DURATION_SECONDS,creator:ownerId,requireSignedURLs:false,
        allowedOrigins:[],expiry:expiresAt,meta:metadata,
      };
      const provider=await streamFetch('/direct_upload',{method:'POST',body:JSON.stringify(providerContract)});
      const result=provider.result as Record<string,unknown>|undefined;
      uid=typeof result?.uid==='string'?result.uid:undefined;
      uploadUrl=typeof result?.uploadURL==='string'&&result.uploadURL.startsWith('https://')?result.uploadURL:null;
    }
    if(!uid) throw new Error('stream_provider_invalid_response');
    if(!uploadUrl) {
      const persisted=await compensateUid(uid,'stream_provider_invalid_response');
      if(!persisted) return json({error:'asset_state_failed'},503);
      return json({error:'stream_provider_invalid_response'},502);
    }
    const {error:updateError}=await db.from('video_assets').update({
      cloudflare_uid:uid,status:'uploading',upload_expires_at:expiresAt,provider_status:'pendingupload',
    }).eq('id',id).eq('owner_id',ownerId);
    if(updateError) {
      const persisted=await compensateUid(uid,'asset_state_failed');
      if(!persisted) return json({error:'asset_state_failed'},503);
      return json({error:'asset_state_failed'},503);
    }
    return json({success:true,data:isPremium?{
      assetId:id,uploadUrl,protocol:'tus',method:'PATCH',expiresAt,
      maxDurationSeconds:CREATOR_PREMIUM_STREAM_MAX_DURATION_SECONDS,
      maxSizeBytes:STREAM_MAX_SIZE_BYTES,ownerId,
    }:{
      assetId:id,uploadUrl,protocol:'multipart',method:'POST',formField:'file',expiresAt,
      maxDurationSeconds:STREAM_MAX_DURATION_SECONDS,maxSizeBytes:STREAM_MAX_SIZE_BYTES,ownerId,
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
