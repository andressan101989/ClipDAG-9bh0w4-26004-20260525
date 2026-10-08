import {
  STREAM_MAX_DURATION_SECONDS,
  StreamProviderError,
  durationOrNull,
  positiveDimensionOrNull,
  progressOrNull,
} from './stream.ts';

export const CREATOR_PREMIUM_STREAM_PURPOSE='creator_premium_video';
export const PREMIUM_STREAM_TOKEN_TTL_SECONDS=300;
export const PREMIUM_STREAM_TOKEN_NBF_SKEW_SECONDS=30;

type PremiumStreamStatus='uploading'|'processing'|'ready'|'failed';

function requiredSecret(name:string):string {
  const value=Deno.env.get(name)?.trim();
  if(!value) throw new StreamProviderError('stream_signing_configuration_missing',503);
  return value;
}

function dimensions(result:Record<string,unknown>):{width:number|null;height:number|null} {
  const input=(result.input&&typeof result.input==='object'?result.input:{}) as Record<string,unknown>;
  return {
    width:positiveDimensionOrNull(result.width??input.width),
    height:positiveDimensionOrNull(result.height??input.height),
  };
}

export function reconcilePremiumStreamVideo(
  result:Record<string,unknown>,
  expectedUid:string,
  maxDurationSeconds=STREAM_MAX_DURATION_SECONDS,
) {
  const status=(result.status&&typeof result.status==='object'?result.status:{}) as Record<string,unknown>;
  const state=String(status.state??result.state??'').toLowerCase().replace(/[\s_-]/g,'');
  const readyToStream=result.readyToStream===true;
  const requiresSignedUrls=result.requireSignedURLs===true;
  const uid=typeof result.uid==='string'?result.uid.trim():'';
  const duration=durationOrNull(result.duration);
  const size=dimensions(result);
  let internalStatus:PremiumStreamStatus;
  let errorCode:string|null=null;

  if(state==='error') {
    internalStatus='failed';
    errorCode='stream_processing_failed';
  } else if(state==='pendingupload') {
    internalStatus='uploading';
  } else if(state==='ready'&&readyToStream) {
    const coreReady=uid.length>0&&uid===expectedUid&&duration!==null&&duration<=maxDurationSeconds;
    if(!requiresSignedUrls) {
      internalStatus='failed';
      errorCode='creator_premium_stream_signed_urls_required';
    } else if(!coreReady) {
      internalStatus='failed';
      errorCode='stream_ready_invariant_failed';
    } else {
      internalStatus='ready';
    }
  } else {
    internalStatus='processing';
  }

  const ready=internalStatus==='ready';
  const checkedAt=new Date().toISOString();
  return {
    status:internalStatus,
    provider_status:state||'unknown',
    provider_progress:progressOrNull(status.pctComplete??result.percentComplete),
    duration_seconds:duration,
    width:size.width,
    height:size.height,
    hls_url:null,
    dash_url:null,
    thumbnail_url:null,
    provider_metadata:{require_signed_urls:requiresSignedUrls},
    error_code:errorCode,
    error_message:errorCode,
    ready_at:ready?checkedAt:null,
    last_provider_check_at:checkedAt,
  };
}

function encodeBase64Url(bytes:Uint8Array):string {
  let binary='';
  for(let offset=0;offset<bytes.length;offset+=0x8000) {
    binary+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));
  }
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

function encodeJson(value:Record<string,unknown>):string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function privateJwkFromBase64(encoded:string):JsonWebKey {
  try {
    const binary=atob(encoded.trim());
    const bytes=Uint8Array.from(binary,character=>character.charCodeAt(0));
    const parsed=JSON.parse(new TextDecoder().decode(bytes)) as JsonWebKey;
    if(parsed.kty!=='RSA'||typeof parsed.n!=='string'||typeof parsed.e!=='string'||typeof parsed.d!=='string') {
      throw new Error('invalid_rsa_jwk');
    }
    return parsed;
  } catch {
    throw new StreamProviderError('stream_signing_configuration_invalid',503);
  }
}

function validateSigningInput(cloudflareUid:string,customerCode:string,keyId:string):void {
  if(!/^[A-Za-z0-9_-]{8,256}$/.test(cloudflareUid)) {
    throw new StreamProviderError('stream_signing_asset_invalid',500);
  }
  if(!/^[a-z0-9]{3,128}$/i.test(customerCode)) {
    throw new StreamProviderError('stream_signing_customer_invalid',503);
  }
  if(!keyId||keyId.length>512) {
    throw new StreamProviderError('stream_signing_configuration_invalid',503);
  }
}

export async function createPremiumStreamPlaybackGrant(input:{
  cloudflareUid:string;
  customerCode:string;
  nowSeconds?:number;
  keyId?:string;
  privateJwkB64?:string;
}) {
  const keyId=input.keyId?.trim()||requiredSecret('STREAM_SIGNING_KEY_ID');
  const encodedJwk=input.privateJwkB64?.trim()||requiredSecret('STREAM_SIGNING_KEY_JWK_B64');
  const uid=input.cloudflareUid.trim();
  const code=input.customerCode.trim().toLowerCase()
    .replace(/^customer-/,'').replace(/\.cloudflarestream\.com$/,'');
  validateSigningInput(uid,code,keyId);
  const now=input.nowSeconds??Math.floor(Date.now()/1000);
  if(!Number.isSafeInteger(now)||now<=0) {
    throw new StreamProviderError('stream_signing_clock_invalid',500);
  }
  const expires=now+PREMIUM_STREAM_TOKEN_TTL_SECONDS;
  const header=encodeJson({alg:'RS256',kid:keyId});
  const claims=encodeJson({
    sub:uid,
    kid:keyId,
    exp:expires,
    nbf:now-PREMIUM_STREAM_TOKEN_NBF_SKEW_SECONDS,
  });
  const signingInput=`${header}.${claims}`;
  let key:CryptoKey;
  try {
    key=await crypto.subtle.importKey(
      'jwk',
      privateJwkFromBase64(encodedJwk),
      {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},
      false,
      ['sign'],
    );
  } catch(error) {
    if(error instanceof StreamProviderError) throw error;
    throw new StreamProviderError('stream_signing_configuration_invalid',503);
  }
  const signature=await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );
  const token=`${signingInput}.${encodeBase64Url(new Uint8Array(signature))}`;
  const base=`https://customer-${code}.cloudflarestream.com/${token}`;
  return {
    hlsUrl:`${base}/manifest/video.m3u8`,
    dashUrl:`${base}/manifest/video.mpd`,
    thumbnailUrl:`${base}/thumbnails/thumbnail.jpg`,
    expiresAt:new Date(expires*1000).toISOString(),
  };
}
