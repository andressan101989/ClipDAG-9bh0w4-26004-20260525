export const MAX_SIZE=200_000_000;
export const MAX_DURATION_MS=60_000;
export const MIMES=new Set(['video/mp4','video/quicktime','video/webm']);
export const validMime=value=>typeof value==='string'&&MIMES.has(value.trim().toLowerCase());
export const validSize=value=>Number.isSafeInteger(Number(value))&&Number(value)>0&&Number(value)<=MAX_SIZE;
export const validDuration=value=>value===null||value===undefined||
  Number.isFinite(Number(value))&&Number(value)>0&&Number(value)<=MAX_DURATION_MS;
export const isHls=value=>{
  if(typeof value!=='string') return false;
  const clean=value.toLowerCase().split('?')[0];
  return clean.endsWith('.m3u8')||clean.includes('/manifest/video.m3u8')
    ||clean.includes('cloudflarestream.com')&&clean.includes('m3u8')
    ||clean.includes('videodelivery.net')&&clean.includes('m3u8');
};
export const isVideo=value=>{
  if(!value) return false;
  const clean=value.toLowerCase().split('?')[0];
  return clean.includes('/videos/')||clean.includes('cloudflarestream.com')
    ||clean.includes('videodelivery.net')||/\.(mp4|mov|avi|mkv|webm|m4v|m3u8|mpd)$/.test(clean);
};
export const sourceFor=value=>!value?'':isHls(value)?{uri:value,contentType:'hls'}:value;

export async function directPostOnce({fetcher,file,uploadUrl,signal}) {
  if(signal?.aborted) throw Object.assign(new Error('aborted'),{code:'aborted'});
  const formData={entries:[],append(name,value){this.entries.push([name,value]);}};
  formData.append('file',file);
  const response=await fetcher(uploadUrl,{method:'POST',body:formData,signal});
  if(!response.ok) throw new Error(`stream_upload_http_${response.status}`);
  return {calls:1,formData};
}

export function normalizeFunctionError(source,body={}) {
  const normalized=source?.name==='FunctionsFetchError'?'functions_fetch_error'
    :source?.name==='FunctionsRelayError'?'functions_relay_error':undefined;
  return {code:body.error??body.code??normalized??source?.code,
    message:body.error??body.code??source?.message??normalized,
    status:source?.status};
}
export const transient=error=>{
  if(['aborted','invalid_stream_playback_response','stream_ready_invariant_failed'].includes(error?.code)) return false;
  if([400,401,403,404,409,410].includes(error?.status)) return false;
  if(['functions_fetch_error','functions_relay_error'].includes(error?.code)) return true;
  return [408,425,429,500,502,503,504].includes(error?.status)||
    error?.status===undefined&&/(failed to send (?:a )?request to the edge function|network request failed|failed to fetch|connection reset|timeout|temporar)/i.test(error?.message??'');
};
export async function pollUntilReady({get,sleep,now=()=>Date.now(),timeoutMs=480_000,intervalMs=5_000,maxErrors=3}) {
  const deadline=now()+timeoutMs;
  let errors=0;
  while(now()<deadline) {
    let value;
    try {value=await get();errors=0;}
    catch(error) {
      if(!transient(error)||++errors>maxErrors) throw error;
      await sleep(intervalMs);continue;
    }
    if(value.status==='ready') {
      if(typeof value.hlsUrl!=='string'||!value.hlsUrl.startsWith('https://')) throw new Error('stream_ready_invariant_failed');
      return value;
    }
    if(value.status==='failed') throw new Error(value.errorCode||'stream_failed');
    await sleep(intervalMs);
  }
  throw new Error('stream_processing_timeout');
}

export async function lookupPublished({session,links,video}) {
  const sessionResult=await session();
  if(sessionResult.error||!sessionResult.userId) return {state:'unknown',code:'session'};
  const linkResult=await links();
  if(linkResult.error) return {state:'unknown',code:'links'};
  if(!Array.isArray(linkResult.data)) return {state:'unknown',code:'links_shape'};
  if(linkResult.data.length===0) return {state:'absent'};
  if(linkResult.data.length!==1) return {state:'unknown',code:'links_shape'};
  const videoResult=await video(linkResult.data[0].entity_id);
  if(videoResult.error) return {state:'unknown',code:'video'};
  if(!videoResult.data) return {state:'unknown',code:'video_shape'};
  return {state:'found',postId:videoResult.data.id};
}
export async function reconcileThree({lookup,sleep=async()=>{}}) {
  let allAbsent=true,last={state:'unknown',code:'unknown'};
  for(const wait of [250,750,1500]) {
    await sleep(wait);
    const result=await lookup();
    if(result.state==='found') return result;
    if(result.state==='unknown') {allAbsent=false;last=result;}
  }
  return allAbsent?{state:'absent'}:last;
}
export async function publishRecovery({assetId,publish,reconcile,cleanup}) {
  let calls=0;
  try {calls++;return {postId:await publish(assetId),calls,cleanups:0};}
  catch(first) {
    const found=await reconcile();
    if(found.state==='found') return {postId:found.postId,calls,cleanups:0};
    if(found.state==='unknown') throw Object.assign(new Error('pending'),{code:'stream_publish_confirmation_pending',calls,cleanups:0});
    const deterministic=['22023','42501','23505'].includes(first.code);
    if(deterministic) {await cleanup();throw Object.assign(first,{calls,cleanups:1});}
    try {calls++;return {postId:await publish(assetId),calls,cleanups:0};}
    catch(second) {
      const secondLookup=await reconcile();
      if(secondLookup.state==='found') return {postId:secondLookup.postId,calls,cleanups:0};
      if(secondLookup.state==='unknown') throw Object.assign(new Error('pending'),{code:'stream_publish_confirmation_pending',calls,cleanups:0});
      await cleanup();throw Object.assign(second,{calls,cleanups:1});
    }
  }
}
export async function validateContractWithCleanup({contract,now=Date.now(),cleanup}) {
  const validId=/^[0-9a-f-]{36}$/i.test(contract.assetId??'');
  const expires=Date.parse(contract.expiresAt);
  const valid=validId&&contract.uploadUrl?.startsWith('https://')&&contract.method==='POST'
    &&contract.formField==='file'&&contract.maxDurationSeconds===60&&contract.maxSizeBytes===MAX_SIZE
    &&Number.isFinite(expires)&&expires>=now-300_000;
  if(!valid) {
    if(validId) await cleanup(contract.assetId);
    throw new Error('invalid_stream_upload_contract');
  }
  return contract;
}
export async function createThenPost({signal,create,post,cleanup}) {
  if(signal.aborted) throw Object.assign(new Error('aborted'),{code:'aborted'});
  const contract=await create();
  if(signal.aborted) {
    await cleanup(contract.assetId);
    throw Object.assign(new Error('aborted'),{code:'aborted'});
  }
  await post(contract);
}
export function singleFlight(handler) {
  let active=false;
  return async()=>{
    if(active) return false;
    active=true;
    try {await handler();return true;} finally {active=false;}
  };
}
