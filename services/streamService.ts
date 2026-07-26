import { File } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import { getSupabaseClient } from '@/template';
import { invokeRpcWithSingleAuthRefresh } from '@/services/mediaService';

export const STREAM_MAX_SIZE_BYTES=200_000_000;
export const STREAM_MAX_DURATION_MS=60_000;
export const STREAM_MIME_TYPES=new Set(['video/mp4','video/quicktime','video/webm']);
const UUID_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STREAM_STATUSES=new Set(['pending','uploading','processing','ready','failed','delete_pending','deleted']);
const SAFE_TEXT_LIMIT=240;
const supabase=getSupabaseClient();

export type StreamPurpose='feed_video';
export type StreamUploadStage=
  |'STREAM_INPUT'|'STREAM_CREATE_UPLOAD'|'STREAM_DIRECT_POST'|'STREAM_PROCESSING'
  |'STREAM_PUBLISH'|'STREAM_DELETE'|'STREAM_UNKNOWN';

export interface StreamPlaybackDescriptor {
  assetId:string;
  status:'pending'|'uploading'|'processing'|'ready'|'failed'|'delete_pending'|'deleted';
  progress:number|null;
  durationSeconds:number|null;
  width:number|null;
  height:number|null;
  hlsUrl:string|null;
  dashUrl:string|null;
  thumbnailUrl:string|null;
  errorCode:string|null;
  readyAt:string|null;
}
export interface SafeStreamError {
  name:string;stage:StreamUploadStage;code:string;message:string;
  httpStatus?:number;operationId:string;
}
type ErrorLike={name?:unknown;message?:unknown;code?:unknown;status?:unknown;httpStatus?:unknown;context?:{status?:number;clone?:()=>unknown;json?:()=>Promise<unknown>}};

function safeText(value:unknown):string|undefined {
  if(typeof value!=='string'||!value.trim()) return undefined;
  return value.replace(/https?:\/\/\S+/gi,'[url]')
    .replace(/bearer\s+\S+/gi,'Bearer [redacted]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi,'[id]')
    .replace(/[A-Za-z0-9_-]{80,}/g,'[redacted]').slice(0,SAFE_TEXT_LIMIT);
}
function numericStatus(value:unknown):number|undefined {
  return typeof value==='number'&&Number.isFinite(value)?value:undefined;
}
export function createStreamOperationId():string {
  return `stream_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,10)}`;
}
export class StreamClientError extends Error {
  stage:StreamUploadStage;code:string;httpStatus?:number;operationId:string;
  constructor(input:Omit<SafeStreamError,'name'>) {
    super(input.message);this.name='StreamClientError';this.stage=input.stage;this.code=input.code;
    this.httpStatus=input.httpStatus;this.operationId=input.operationId;
  }
}
export function throwIfStreamAborted(
  signal:AbortSignal|undefined,
  stage:StreamUploadStage,
  operationId:string,
):void {
  if(signal?.aborted) throw new StreamClientError({stage,code:'aborted',message:'aborted',operationId});
}
export function getSafeStreamError(
  error:unknown,
  fallbackStage:StreamUploadStage='STREAM_UNKNOWN',
  operationId=createStreamOperationId(),
):SafeStreamError {
  const source=(error&&typeof error==='object'?error:{}) as ErrorLike;
  const existing=error instanceof StreamClientError?error:undefined;
  const message=safeText(existing?.message??source.message)??'stream_operation_failed';
  const aborted=source.name==='AbortError'||message.toLowerCase().includes('abort');
  return {
    name:safeText(existing?.name??source.name)??'StreamClientError',
    stage:existing?.stage??fallbackStage,
    code:existing?.code??safeText(source.code)??(aborted?'aborted':'stream_operation_failed'),
    message,httpStatus:existing?.httpStatus??numericStatus(source.httpStatus)??numericStatus(source.status),
    operationId:existing?.operationId??operationId,
  };
}
function streamError(error:unknown,stage:StreamUploadStage,operationId:string):StreamClientError {
  const safe=getSafeStreamError(error,stage,operationId);
  return new StreamClientError(safe);
}
async function functionError(error:unknown,dataError?:unknown):Promise<unknown> {
  if(!error) return {message:dataError,code:dataError};
  const source=error as ErrorLike;
  let responseBody:unknown;
  try {
    const readable=(source.context?.clone?.()??source.context) as {json?:()=>Promise<unknown>}|undefined;
    responseBody=await readable?.json?.();
  } catch { /* Optional sanitized function response. */ }
  const body=responseBody&&typeof responseBody==='object'?responseBody as Record<string,unknown>:{};
  const normalizedName=source.name==='FunctionsFetchError'?'functions_fetch_error'
    :source.name==='FunctionsRelayError'?'functions_relay_error':undefined;
  const code=body.error??body.code??normalizedName??source.code;
  return {name:source.name,message:body.error??body.code??source.message??code,code,
    status:source.context?.status??source.status};
}

export const validateStreamVideoMime=(value:unknown):value is string=>
  typeof value==='string'&&STREAM_MIME_TYPES.has(value.trim().toLowerCase());
export const validateStreamVideoSize=(value:unknown):boolean=>
  Number.isSafeInteger(Number(value))&&Number(value)>0&&Number(value)<=STREAM_MAX_SIZE_BYTES;
export const validateStreamVideoDuration=(value:unknown):boolean=>
  value===null||value===undefined||(Number.isFinite(Number(value))&&Number(value)>0&&Number(value)<=STREAM_MAX_DURATION_MS);
export const isHttpsStreamUrl=(value:unknown):value is string=>
  typeof value==='string'&&value.startsWith('https://');
export function isHlsUrl(value:unknown):boolean {
  if(typeof value!=='string') return false;
  const clean=value.toLowerCase().split('?')[0];
  return clean.endsWith('.m3u8')||clean.includes('/manifest/video.m3u8')
    ||(clean.includes('cloudflarestream.com')&&clean.includes('m3u8'))
    ||(clean.includes('videodelivery.net')&&clean.includes('m3u8'));
}
export function extractStreamRpcUuid(data:unknown,functionName:string):string {
  let value:unknown=data;
  if(Array.isArray(value)) {
    if(value.length!==1) throw new Error('invalid_rpc_result');
    value=value[0];
  }
  if(value&&typeof value==='object') {
    const record=value as Record<string,unknown>;
    value=record[functionName]??record.id;
  }
  if(typeof value!=='string'||!UUID_PATTERN.test(value)) throw new Error('invalid_rpc_result');
  return value;
}
export function extractNullableStreamRpcUuid(data:unknown,functionName:string):string|null {
  if(data===null||data===undefined) return null;
  return extractStreamRpcUuid(data,functionName);
}

interface StreamUploadContract {
  assetId:string;uploadUrl:string;method:'POST';formField:'file';expiresAt:string;
  maxDurationSeconds:number;maxSizeBytes:number;
}
export async function createStreamUpload(input:{
  mimeType:string;sizeBytes:number;fileName:string;operationId?:string;
}):Promise<StreamUploadContract> {
  const operationId=input.operationId??createStreamOperationId();
  try {
    const {data,error}=await supabase.functions.invoke('create-stream-upload',{body:{
      purpose:'feed_video',mime_type:input.mimeType,size_bytes:input.sizeBytes,file_name:input.fileName,
    }});
    if(error||!data?.success||!data.data) throw await functionError(error,data?.error);
    const contract=data.data as Record<string,unknown>;
    const assetId=typeof contract.assetId==='string'&&UUID_PATTERN.test(contract.assetId)?contract.assetId:null;
    const expiresAt=typeof contract.expiresAt==='string'?Date.parse(contract.expiresAt):NaN;
    const validContract=assetId!==null&&isHttpsStreamUrl(contract.uploadUrl)
      &&contract.method==='POST'&&contract.formField==='file'
      &&contract.maxDurationSeconds===60&&contract.maxSizeBytes===STREAM_MAX_SIZE_BYTES
      &&Number.isFinite(expiresAt)&&expiresAt>=Date.now()-300_000;
    if(!assetId||validContract!==true) {
      if(assetId) await deleteStreamVideo(assetId).catch(()=>{});
      throw new Error('invalid_stream_upload_contract');
    }
    return contract as unknown as StreamUploadContract;
  } catch(error) { throw streamError(error,'STREAM_CREATE_UPLOAD',operationId); }
}

export async function postVideoToStreamUploadUrl(input:{
  uri:string;uploadUrl:string;signal?:AbortSignal;operationId?:string;
  fetcher?:typeof expoFetch;timeoutMs?:number;
}):Promise<void> {
  const operationId=input.operationId??createStreamOperationId();
  throwIfStreamAborted(input.signal,'STREAM_DIRECT_POST',operationId);
  const controller=new AbortController();
  const abort=()=>controller.abort();
  input.signal?.addEventListener('abort',abort,{once:true});
  if(input.signal?.aborted) controller.abort();
  const timer=setTimeout(()=>controller.abort(),input.timeoutMs??300_000);
  try {
    throwIfStreamAborted(controller.signal,'STREAM_DIRECT_POST',operationId);
    const file=new File(input.uri);
    throwIfStreamAborted(controller.signal,'STREAM_DIRECT_POST',operationId);
    const formData=new FormData();
    formData.append('file',file as unknown as Blob);
    throwIfStreamAborted(controller.signal,'STREAM_DIRECT_POST',operationId);
    const response=await (input.fetcher??expoFetch)(input.uploadUrl,{
      method:'POST',body:formData,signal:controller.signal,
    });
    if(!response.ok) throw {code:`stream_upload_http_${response.status}`,status:response.status};
  } catch(error) { throw streamError(error,'STREAM_DIRECT_POST',operationId); }
  finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort',abort);
  }
}

function validatePlayback(data:unknown,expectedAssetId:string):StreamPlaybackDescriptor {
  if(!data||typeof data!=='object') throw new Error('invalid_stream_playback_response');
  const value=data as StreamPlaybackDescriptor;
  if(value.assetId!==expectedAssetId||!STREAM_STATUSES.has(value.status)) throw new Error('invalid_stream_playback_response');
  if(value.status==='ready'&&(!isHttpsStreamUrl(value.hlsUrl)||!Number.isFinite(value.durationSeconds)
    ||Number(value.durationSeconds)<=0||Number(value.durationSeconds)>60
    ||(value.thumbnailUrl!==null&&!isHttpsStreamUrl(value.thumbnailUrl)))) {
    throw new Error('stream_ready_invariant_failed');
  }
  if(value.status!=='ready'&&(value.hlsUrl!==null||value.dashUrl!==null||value.thumbnailUrl!==null)) {
    throw new Error('invalid_stream_playback_response');
  }
  return value;
}
export async function getStreamPlayback(assetId:string,operationId=createStreamOperationId()):Promise<StreamPlaybackDescriptor> {
  try {
    const {data,error}=await supabase.functions.invoke('get-stream-playback',{body:{asset_id:assetId}});
    if(error||!data?.success||!data.data) throw await functionError(error,data?.error);
    return validatePlayback(data.data,assetId);
  } catch(error) { throw streamError(error,'STREAM_PROCESSING',operationId); }
}
const delay=(milliseconds:number,signal?:AbortSignal)=>new Promise<void>((resolve,reject)=>{
  if(signal?.aborted) { reject(Object.assign(new Error('aborted'),{name:'AbortError'}));return; }
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},milliseconds);
  const abort=()=>{clearTimeout(timer);reject(Object.assign(new Error('aborted'),{name:'AbortError'}));};
  signal?.addEventListener('abort',abort,{once:true});
});
export async function waitForStreamReady(
  assetId:string,
  options:{signal?:AbortSignal;timeoutMs?:number;pollIntervalMs?:number;maxTransientErrors?:number;
    onProgress?:(value:StreamPlaybackDescriptor)=>void;sleep?:(milliseconds:number,signal?:AbortSignal)=>Promise<void>}={},
):Promise<StreamPlaybackDescriptor> {
  const operationId=createStreamOperationId();
  const deadline=Date.now()+(options.timeoutMs??480_000);
  let transientErrors=0;
  while(Date.now()<deadline) {
    if(options.signal?.aborted) throw streamError({name:'AbortError',message:'aborted'},'STREAM_PROCESSING',operationId);
    let descriptor:StreamPlaybackDescriptor;
    try {
      descriptor=await getStreamPlayback(assetId,operationId);
      transientErrors=0;
    } catch(error) {
      if(!isTransientStreamError(error)) throw streamError(error,'STREAM_PROCESSING',operationId);
      if(++transientErrors>(options.maxTransientErrors??3)) throw streamError(error,'STREAM_PROCESSING',operationId);
      await (options.sleep??delay)(options.pollIntervalMs??5_000,options.signal);
      continue;
    }
    options.onProgress?.(descriptor);
    if(descriptor.status==='ready') return descriptor;
    if(['failed','deleted','delete_pending'].includes(descriptor.status)) {
      throw new StreamClientError({stage:'STREAM_PROCESSING',code:descriptor.errorCode??`stream_${descriptor.status}`,
        message:descriptor.errorCode??`stream_${descriptor.status}`,operationId});
    }
    await (options.sleep??delay)(options.pollIntervalMs??5_000,options.signal);
  }
  throw new StreamClientError({stage:'STREAM_PROCESSING',code:'stream_processing_timeout',
    message:'stream_processing_timeout',operationId});
}

export async function publishStreamVideoPost(input:{assetId:string;caption:string;music:string;operationId?:string}):Promise<string> {
  const operationId=input.operationId??createStreamOperationId();
  try {
    const invoke=()=>supabase.rpc('publish_stream_video_post',{
      p_asset_id:input.assetId,p_caption:input.caption,p_music:input.music,
    });
    const {data,error}=await invokeRpcWithSingleAuthRefresh(invoke,()=>supabase.auth.refreshSession());
    if(error) throw error;
    return extractStreamRpcUuid(data,'publish_stream_video_post');
  } catch(error) { throw streamError(error,'STREAM_PUBLISH',operationId); }
}
export type PublishedStreamPostLookup=
  |{state:'found';postId:string}
  |{state:'absent'}
  |{state:'unknown';code:string};
interface PublishedLookupOptions {
  getSession?:()=>Promise<{data:{session:{user:{id:string}}|null};error:unknown}>;
  getLinks?:(assetId:string,userId:string)=>Promise<{data:unknown;error:unknown}>;
  getVideo?:(postId:string,userId:string)=>Promise<{data:unknown;error:unknown}>;
}
export async function findPublishedStreamPost(
  assetId:string,
  options:PublishedLookupOptions={},
):Promise<PublishedStreamPostLookup> {
  try {
    const sessionResult=options.getSession?await options.getSession():await supabase.auth.getSession();
    if(sessionResult.error||!sessionResult.data.session?.user) return {state:'unknown',code:'stream_session_lookup_failed'};
    const userId=sessionResult.data.session.user.id;
    const linkResult=options.getLinks?await options.getLinks(assetId,userId):
      await supabase.from('video_asset_links').select('entity_id')
        .eq('asset_id',assetId).eq('entity_type','video_post').eq('slot','video').eq('owner_id',userId);
    if(linkResult.error) return {state:'unknown',code:'stream_link_lookup_failed'};
    if(!Array.isArray(linkResult.data)) return {state:'unknown',code:'stream_link_response_invalid'};
    if(linkResult.data.length===0) return {state:'absent'};
    if(linkResult.data.length!==1) return {state:'unknown',code:'stream_link_response_invalid'};
    const row=linkResult.data[0] as Record<string,unknown>;
    if(typeof row.entity_id!=='string'||!UUID_PATTERN.test(row.entity_id)) {
      return {state:'unknown',code:'stream_link_response_invalid'};
    }
    const videoResult=options.getVideo?await options.getVideo(row.entity_id,userId):
      await supabase.from('videos').select('id,user_id').eq('id',row.entity_id).eq('user_id',userId).maybeSingle();
    if(videoResult.error) return {state:'unknown',code:'stream_post_lookup_failed'};
    if(!videoResult.data||typeof videoResult.data!=='object') return {state:'unknown',code:'stream_post_response_invalid'};
    const video=videoResult.data as Record<string,unknown>;
    if(video.id!==row.entity_id||video.user_id!==userId) return {state:'unknown',code:'stream_post_response_invalid'};
    return {state:'found',postId:row.entity_id};
  } catch { return {state:'unknown',code:'stream_reconciliation_failed'}; }
}
export async function reconcilePublishedStreamPost(
  assetId:string,
  options:PublishedLookupOptions&{
    sleep?:(milliseconds:number)=>Promise<void>;
    delays?:readonly number[];
  }={},
):Promise<PublishedStreamPostLookup> {
  const waits=options.delays??[250,750,1500];
  let allAbsent=true,lastUnknown:PublishedStreamPostLookup={state:'unknown',code:'stream_reconciliation_failed'};
  for(const milliseconds of waits) {
    await (options.sleep??(value=>delay(value)))(milliseconds);
    const result=await findPublishedStreamPost(assetId,options);
    if(result.state==='found') return result;
    if(result.state==='unknown') {allAbsent=false;lastUnknown=result;}
  }
  return allAbsent?{state:'absent'}:lastUnknown;
}
export async function deleteStreamVideo(assetId:string):Promise<void> {
  const operationId=createStreamOperationId();
  try {
    const {data,error}=await supabase.functions.invoke('delete-stream-video',{body:{asset_id:assetId}});
    if(error||!data?.success) throw await functionError(error,data?.error);
  } catch(error) { throw streamError(error,'STREAM_DELETE',operationId); }
}
export function isTransientStreamError(error:unknown):boolean {
  const safe=getSafeStreamError(error,'STREAM_PUBLISH');
  if(safe.code==='aborted'||safe.code==='invalid_stream_playback_response'
    ||safe.code==='stream_ready_invariant_failed') return false;
  if([400,401,403,404,409,410].includes(safe.httpStatus??0)) return false;
  if(safe.code==='functions_fetch_error'||safe.code==='functions_relay_error') return true;
  if([408,425,429].includes(safe.httpStatus??0)||(safe.httpStatus??0)>=500) return true;
  const text=`${safe.code} ${safe.message}`.toLowerCase();
  return safe.httpStatus===undefined
    &&/(failed to send (?:a )?request to the edge function|network request failed|failed to fetch|connection reset|timeout|timed out|temporar)/.test(text);
}
function deterministicPublishError(error:unknown):boolean {
  return ['22023','42501','23505'].includes(getSafeStreamError(error,'STREAM_PUBLISH').code);
}
function canRetryPublish(error:unknown):boolean {
  if(deterministicPublishError(error)) return false;
  const safe=getSafeStreamError(error,'STREAM_PUBLISH');
  return safe.httpStatus===undefined||isTransientStreamError(error);
}
function confirmationPending(operationId:string):StreamClientError {
  return new StreamClientError({stage:'STREAM_PUBLISH',code:'stream_publish_confirmation_pending',
    message:'stream_publish_confirmation_pending',operationId});
}
async function publishWithRecovery(
  input:{assetId:string;caption:string;music:string;operationId:string},
  options:{
    publish?:(value:typeof input)=>Promise<string>;
    reconcile?:(assetId:string)=>Promise<PublishedStreamPostLookup>;
  }={},
):Promise<string> {
  const publish=options.publish??publishStreamVideoPost;
  const reconcile=options.reconcile??reconcilePublishedStreamPost;
  try { return await publish(input); }
  catch(firstError) {
    const firstLookup=await reconcile(input.assetId);
    if(firstLookup.state==='found') return firstLookup.postId;
    if(firstLookup.state==='unknown') throw confirmationPending(input.operationId);
    if(!canRetryPublish(firstError)) throw firstError;
    try { return await publish(input); }
    catch(secondError) {
      const secondLookup=await reconcile(input.assetId);
      if(secondLookup.state==='found') return secondLookup.postId;
      if(secondLookup.state==='unknown') throw confirmationPending(input.operationId);
      throw secondError;
    }
  }
}

export async function uploadAndPublishStreamVideo(input:{
  uri:string;mimeType:string;fileName?:string;sizeBytes?:number;durationMs?:number|null;
  caption:string;music:string;signal?:AbortSignal;
  onStage?:(stage:StreamUploadStage,progress?:number|null)=>void;
}):Promise<{postId:string;assetId:string;hlsUrl:string;thumbnailUrl:string|null}> {
  const operationId=createStreamOperationId();
  let assetId:string|undefined;
  let published=false;
  try {
    throwIfStreamAborted(input.signal,'STREAM_INPUT',operationId);
    input.onStage?.('STREAM_INPUT');
    if(!input.uri) throw new Error('invalid_video_uri');
    if(!validateStreamVideoMime(input.mimeType)) throw new Error('invalid_video_mime');
    if(!validateStreamVideoDuration(input.durationMs)) throw new Error('invalid_video_duration');
    throwIfStreamAborted(input.signal,'STREAM_INPUT',operationId);
    const file=new File(input.uri);
    throwIfStreamAborted(input.signal,'STREAM_INPUT',operationId);
    if(!file.exists) throw new Error('video_file_not_found');
    const realSize=file.size;
    if(!validateStreamVideoSize(realSize)||input.sizeBytes!==undefined&&!validateStreamVideoSize(input.sizeBytes)) {
      throw new Error('invalid_video_size');
    }
    input.onStage?.('STREAM_CREATE_UPLOAD');
    throwIfStreamAborted(input.signal,'STREAM_CREATE_UPLOAD',operationId);
    const contract=await createStreamUpload({
      mimeType:input.mimeType.trim().toLowerCase(),sizeBytes:realSize,
      fileName:input.fileName||file.name||'video',operationId,
    });
    assetId=contract.assetId;
    throwIfStreamAborted(input.signal,'STREAM_DIRECT_POST',operationId);
    input.onStage?.('STREAM_DIRECT_POST');
    await postVideoToStreamUploadUrl({uri:input.uri,uploadUrl:contract.uploadUrl,signal:input.signal,operationId});
    input.onStage?.('STREAM_PROCESSING');
    throwIfStreamAborted(input.signal,'STREAM_PROCESSING',operationId);
    const playback=await waitForStreamReady(assetId,{signal:input.signal,onProgress:value=>{
      input.onStage?.('STREAM_PROCESSING',value.progress);
    }});
    input.onStage?.('STREAM_PUBLISH');
    throwIfStreamAborted(input.signal,'STREAM_PUBLISH',operationId);
    const postId=await publishWithRecovery({assetId,caption:input.caption,music:input.music,operationId});
    published=true;
    return {postId,assetId,hlsUrl:playback.hlsUrl!,thumbnailUrl:playback.thumbnailUrl};
  } catch(error) {
    const preserveAsset=error instanceof StreamClientError&&error.code==='stream_publish_confirmation_pending';
    if(assetId&&!published&&!preserveAsset) await deleteStreamVideo(assetId).catch(()=>{});
    throw streamError(error,error instanceof StreamClientError?error.stage:'STREAM_INPUT',operationId);
  }
}
