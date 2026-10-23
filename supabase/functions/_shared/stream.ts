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
export const normalizeStreamCustomerCode=(value:string)=>value.trim().toLowerCase()
  .replace(/^https?:\/\//i,'')
  .replace(/\/$/,'')
  .replace(/^customer-/i,'')
  .replace(/\.cloudflarestream\.com$/i,'');
export const streamCustomerCode=()=>normalizeStreamCustomerCode(required('STREAM_CUSTOMER_CODE'));
export const streamWebhookSecret=()=>Deno.env.get('STREAM_WEBHOOK_SECRET')?.trim()||null;
export const streamApiBase=()=>`https://api.cloudflare.com/client/v4/accounts/${streamAccountId()}/stream`;

export class StreamProviderError extends Error {
  constructor(public code:string,public httpStatus=502,public transient=false) {
    super(code);
    this.name='StreamProviderError';
  }
}

function safeProviderRequestId(response:Response):string|null {
  const value=response.headers.get('cf-ray')?.trim()??'';
  return /^[A-Za-z0-9._:-]{1,128}$/.test(value)?value:null;
}

function streamRequestSignal(signal:AbortSignal|null|undefined):AbortSignal {
  const timeout=AbortSignal.timeout(15_000);
  return signal?AbortSignal.any([signal,timeout]):timeout;
}

async function streamProviderResponse(path:string,init:RequestInit):Promise<Response> {
  try {
    return await fetch(`${streamApiBase()}${path}`,{
      ...init,
      signal:streamRequestSignal(init.signal),
      headers:{Authorization:`Bearer ${streamToken()}`,...(init.headers??{})},
    });
  } catch(error) {
    if(error instanceof StreamProviderError) throw error;
    const name=error&&typeof error==='object'&&'name' in error?String(error.name):'';
    throw new StreamProviderError(
      name==='AbortError'||name==='TimeoutError'
        ?'stream_provider_temporarily_unavailable'
        :'stream_provider_error',
      name==='AbortError'||name==='TimeoutError'?503:502,
      name==='AbortError'||name==='TimeoutError',
    );
  }
}

function throwStreamResponseError(response:Response):never {
  if(response.status===404) throw new StreamProviderError('stream_not_found',404);
  const transient=response.status===408||response.status===425||response.status===429||response.status>=500;
  throw new StreamProviderError(
    transient?'stream_provider_temporarily_unavailable':'stream_provider_rejected',
    transient?503:502,
    transient,
  );
}

export async function deleteStreamVideo(uid:string,signal?:AbortSignal|null):Promise<{
  accepted:boolean;
  alreadyAbsent:boolean;
  requestId:string|null;
}> {
  if(!uid.trim()) throw new StreamProviderError('stream_provider_identity_missing',500);
  const response=await streamProviderResponse(`/${encodeURIComponent(uid)}`,{
    method:'DELETE',headers:{Accept:'*/*'},signal,
  });
  const requestId=safeProviderRequestId(response);
  if(response.status===404) return {accepted:true,alreadyAbsent:true,requestId};
  if(!response.ok) throwStreamResponseError(response);
  // Cloudflare may return either an empty 2xx response or its normal API
  // envelope.  An explicit `success:false` must never be persisted as an
  // accepted provider deletion merely because the HTTP status was 2xx.
  const body=await response.text().catch(()=>null);
  if(body===null) throw new StreamProviderError('stream_provider_invalid_response',502);
  if(body.trim()) {
    let payload:Record<string,unknown>|null=null;
    try {
      const parsed=JSON.parse(body) as unknown;
      payload=parsed&&typeof parsed==='object'&&!Array.isArray(parsed)
        ?parsed as Record<string,unknown>
        :null;
    } catch {
      payload=null;
    }
    if(!payload||payload.success!==true) {
      throw new StreamProviderError('stream_provider_invalid_response',502);
    }
  }
  return {accepted:true,alreadyAbsent:false,requestId};
}

export async function verifyStreamVideoAbsent(uid:string,signal?:AbortSignal|null):Promise<{
  absent:boolean;
  requestId:string|null;
}> {
  if(!uid.trim()) throw new StreamProviderError('stream_provider_identity_missing',500);
  const response=await streamProviderResponse(`/${encodeURIComponent(uid)}`,{
    method:'GET',headers:{Accept:'application/json'},signal,
  });
  const requestId=safeProviderRequestId(response);
  if(response.status===404) return {absent:true,requestId};
  if(!response.ok) throwStreamResponseError(response);
  const payload=await response.json().catch(()=>null) as Record<string,unknown>|null;
  if(!payload||payload.success!==true) throw new StreamProviderError('stream_provider_invalid_response',502);
  return {absent:false,requestId};
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
  const response=await streamProviderResponse(path,{
    ...init,
    headers:{'Content-Type':'application/json',...(init.headers??{})},
  });
  if(!response.ok) throwStreamResponseError(response);
  const payload=await response.json().catch(()=>null) as Record<string,unknown>|null;
  if(!payload||payload.success!==true) throw new StreamProviderError('stream_provider_invalid_response',502);
  return payload;
}

export function durationOrNull(value:unknown):number|null {
  if(value===null||value===undefined||value==='') return null;
  const number=Number(value);
  return Number.isFinite(number)&&number>0?number:null;
}
export function positiveDimensionOrNull(value:unknown):number|null {
  if(value===null||value===undefined||value==='') return null;
  const number=Number(value);
  return Number.isInteger(number)&&number>0?number:null;
}
export function progressOrNull(value:unknown):number|null {
  if(value===null||value===undefined||value==='') return null;
  const number=Number(value);
  return Number.isFinite(number)&&number>=0&&number<=100?number:null;
}

const streamStateRank:Record<string,number>={pending:0,uploading:1,processing:2,ready:3};
const preserveOnSameState=[
  'duration_seconds','width','height','hls_url','dash_url','thumbnail_url',
  'provider_metadata','ready_at',
] as const;

/**
 * Reject out-of-order provider observations before an optimistic DB write.
 * The caller must additionally compare-and-set the row's `updated_at` token;
 * otherwise two observations read from the same state could still race.
 */
export function monotonicStreamUpdates(
  current:Record<string,unknown>,
  proposed:Record<string,unknown>,
  options:{allowReadySecurityFailure?:boolean}={},
):Record<string,unknown>|null {
  const currentStatus=String(current.status??'');
  const proposedStatus=String(proposed.status??'');
  if(['delete_pending','deleted'].includes(currentStatus)) return null;
  if(currentStatus==='failed'&&proposedStatus!=='failed') return null;
  if(proposedStatus==='failed') {
    if(currentStatus==='ready'&&options.allowReadySecurityFailure!==true) return null;
    if(currentStatus!=='failed'&&currentStatus!=='ready'
      &&streamStateRank[currentStatus]===undefined) return null;
  } else if(currentStatus==='ready'&&proposedStatus!=='ready') {
    return null;
  } else {
    const currentRank=streamStateRank[currentStatus];
    const proposedRank=streamStateRank[proposedStatus];
    if(currentStatus!=='failed'&&(
      currentRank===undefined||proposedRank===undefined||proposedRank<currentRank
    )) return null;
  }

  const updates={...proposed};
  if(currentStatus===proposedStatus) {
    const currentProgress=progressOrNull(current.provider_progress);
    const proposedProgress=progressOrNull(proposed.provider_progress);
    if(currentProgress!==null&&(proposedProgress===null||proposedProgress<currentProgress)) {
      updates.provider_progress=currentProgress;
    }
    for(const key of preserveOnSameState) {
      if(current[key]!==null&&current[key]!==undefined) updates[key]=current[key];
    }
  }
  return updates;
}
function httpsOrNull(value:unknown):string|null {
  return typeof value==='string'&&value.startsWith('https://')?value:null;
}
function dimensions(result:Record<string,unknown>):{width:number|null;height:number|null} {
  const input=(result.input&&typeof result.input==='object'?result.input:{}) as Record<string,unknown>;
  return {
    width:positiveDimensionOrNull(result.width??input.width),
    height:positiveDimensionOrNull(result.height??input.height),
  };
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
  const duration=durationOrNull(result.duration);
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
    provider_progress:progressOrNull(status.pctComplete??result.percentComplete),
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
