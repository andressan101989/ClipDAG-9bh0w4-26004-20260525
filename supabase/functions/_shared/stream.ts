export const STREAM_MAX_SIZE_BYTES=200_000_000;
export const STREAM_MAX_DURATION_SECONDS=60;
export const STREAM_MIME_TYPES=new Set(['video/mp4','video/quicktime','video/webm']);
export type StreamAssetStatus='uploading'|'processing'|'ready'|'failed';

function required(name:string):string {
  const value=Deno.env.get(name)?.trim();
  if(!value) throw new StreamProviderError('stream_configuration_missing',503);
  return value;
}

export const streamAccountId=()=>required('CLOUDFLARE_ACCOUNT_ID');
export const streamToken=()=>required('CLOUDFLARE_STREAM_TOKEN');
export const streamCustomerCode=()=>required('STREAM_CUSTOMER_CODE').replace(/^customer-/i,'');
export const streamWebhookSecret=()=>Deno.env.get('STREAM_WEBHOOK_SECRET')?.trim()||null;
export const streamApiBase=()=>`https://api.cloudflare.com/client/v4/accounts/${streamAccountId()}/stream`;

export class StreamProviderError extends Error {
  constructor(public code:string,public httpStatus=502,public transient=false) {
    super(code);
    this.name='StreamProviderError';
  }
}

export function validateStreamMime(mime:unknown):string|null {
  const value=String(mime??'').trim().toLowerCase();
  return STREAM_MIME_TYPES.has(value)?value:null;
}
export function validateStreamSize(value:unknown):number|null {
  const size=Number(value);
  return Number.isSafeInteger(size)&&size>0&&size<=STREAM_MAX_SIZE_BYTES?size:null;
}
export function isUuid(value:unknown):value is string {
  return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
export function safeFilename(value:unknown):string {
  return String(value??'video').replace(/[\u0000-\u001f\\/:*?"<>|]/g,'_').trim().slice(0,180)||'video';
}
export function sanitizeProviderError(error:unknown):{code:string;message:string;status:number;transient:boolean} {
  if(error instanceof StreamProviderError) return {code:error.code,message:error.code,status:error.httpStatus,transient:error.transient};
  const status=typeof error==='object'&&error&&'status' in error?Number(error.status):0;
  const transient=status===408||status===425||status===429||status>=500;
  return {code:transient?'stream_provider_temporarily_unavailable':'stream_provider_error',message:transient?'stream_provider_temporarily_unavailable':'stream_provider_error',status:transient?503:502,transient};
}

export async function streamFetch(path:string,init:RequestInit={}):Promise<Record<string,unknown>> {
  const response=await fetch(`${streamApiBase()}${path}`,{
    ...init,
    headers:{Authorization:`Bearer ${streamToken()}`,'Content-Type':'application/json',...(init.headers??{})},
  });
  if(!response.ok) {
    if(response.status===404) throw new StreamProviderError('stream_not_found',404);
    throw new StreamProviderError(
      response.status===429||response.status>=500?'stream_provider_temporarily_unavailable':'stream_provider_rejected',
      response.status===429||response.status>=500?503:502,
      response.status===429||response.status>=500,
    );
  }
  const payload=await response.json().catch(()=>null) as Record<string,unknown>|null;
  if(!payload||payload.success!==true) throw new StreamProviderError('stream_provider_invalid_response',502);
  return payload;
}

function numberOrNull(value:unknown):number|null {
  const number=Number(value);
  return Number.isFinite(number)?number:null;
}
function httpsOrNull(value:unknown):string|null {
  return typeof value==='string'&&value.startsWith('https://')?value:null;
}
function dimensions(result:Record<string,unknown>):{width:number|null;height:number|null} {
  const input=(result.input&&typeof result.input==='object'?result.input:{}) as Record<string,unknown>;
  return {width:numberOrNull(result.width??input.width),height:numberOrNull(result.height??input.height)};
}
export function fallbackPlaybackUrls(uid:string,customerCode:string) {
  const code=customerCode.replace(/^customer-/i,'');
  const base=`https://customer-${code}.cloudflarestream.com/${uid}`;
  return {hls:`${base}/manifest/video.m3u8`,dash:`${base}/manifest/video.mpd`,thumbnail:`${base}/thumbnails/thumbnail.jpg`};
}

export function reconcileStreamVideo(
  result:Record<string,unknown>,
  customerCode:string,
  expectedUid:string,
  maxDurationSeconds=STREAM_MAX_DURATION_SECONDS,
) {
  const status=(result.status&&typeof result.status==='object'?result.status:{}) as Record<string,unknown>;
  const state=String(status.state??result.state??'').toLowerCase().replace(/[\s_-]/g,'');
  const readyToStream=result.readyToStream===true;
  const uid=typeof result.uid==='string'?result.uid.trim():'';
  let internalStatus:StreamAssetStatus;
  if(state==='error') internalStatus='failed';
  else if(state==='pendingupload') internalStatus='uploading';
  else if(state==='ready'&&readyToStream) internalStatus='ready';
  else internalStatus='processing';
  const fallback=uid?fallbackPlaybackUrls(uid,customerCode):{hls:null,dash:null,thumbnail:null};
  const playback=(result.playback&&typeof result.playback==='object'?result.playback:{}) as Record<string,unknown>;
  const thumbnail=httpsOrNull(result.thumbnail);
  const size=dimensions(result);
  const duration=numberOrNull(result.duration);
  const hls=httpsOrNull(playback.hls)??fallback.hls;
  const readyInvariantValid=
    uid.length>0&&uid===expectedUid&&typeof hls==='string'&&hls.startsWith('https://')&&
    duration!==null&&duration>0&&duration<=maxDurationSeconds;
  if(internalStatus==='ready'&&!readyInvariantValid) internalStatus='failed';
  const ready=internalStatus==='ready'&&readyInvariantValid;
  const invariantFailure=state==='ready'&&readyToStream&&!readyInvariantValid;
  return {
    status:internalStatus,
    provider_status:state||'unknown',
    provider_progress:numberOrNull(status.pctComplete??result.percentComplete),
    duration_seconds:duration,
    width:size.width,
    height:size.height,
    hls_url:ready?hls:null,
    dash_url:ready?(httpsOrNull(playback.dash)??fallback.dash):null,
    thumbnail_url:ready?(thumbnail??fallback.thumbnail):null,
    error_code:invariantFailure?'stream_ready_invariant_failed':internalStatus==='failed'?'stream_processing_failed':null,
    error_message:invariantFailure?'stream_ready_invariant_failed':internalStatus==='failed'?'stream_processing_failed':null,
    ready_at:ready?new Date().toISOString():null,
    last_provider_check_at:new Date().toISOString(),
  };
}

export function parseWebhookSignature(value:string|null):{time:number;signature:string}|null {
  if(!value) return null;
  const entries=Object.fromEntries(value.split(',').map(part=>part.trim().split('=',2)));
  const time=Number(entries.time),signature=entries.sig1;
  return Number.isInteger(time)&&typeof signature==='string'&&/^[0-9a-f]{64}$/i.test(signature)?{time,signature:signature.toLowerCase()}:null;
}
export function constantTimeEqualHex(left:string,right:string):boolean {
  if(left.length!==right.length) return false;
  let diff=0;
  for(let index=0;index<left.length;index++) diff|=left.charCodeAt(index)^right.charCodeAt(index);
  return diff===0;
}
export async function hmacSha256Hex(secret:string,message:string):Promise<string> {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
export async function verifyWebhook(rawBody:string,header:string|null,secret:string,nowSeconds=Math.floor(Date.now()/1000)):Promise<boolean> {
  const parsed=parseWebhookSignature(header);
  if(!parsed||Math.abs(nowSeconds-parsed.time)>300) return false;
  const expected=await hmacSha256Hex(secret,`${parsed.time}.${rawBody}`);
  return constantTimeEqualHex(expected,parsed.signature);
}
export function webhookVideo(payload:Record<string,unknown>):Record<string,unknown>|null {
  if(typeof payload.uid==='string') return payload;
  return payload.result&&typeof payload.result==='object'?payload.result as Record<string,unknown>:null;
}
