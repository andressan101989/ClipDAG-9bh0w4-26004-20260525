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
  const formData={entries:[],append(name,value){this.entries.push([name,value]);}};
  formData.append('file',file);
  const response=await fetcher(uploadUrl,{method:'POST',body:formData,signal});
  if(!response.ok) throw new Error(`stream_upload_http_${response.status}`);
  return {calls:1,formData};
}

export async function pollUntilReady({get,sleep,now=()=>Date.now(),timeoutMs=480_000,intervalMs=5_000}) {
  const deadline=now()+timeoutMs;
  while(now()<deadline) {
    const value=await get();
    if(value.status==='ready') {
      if(typeof value.hlsUrl!=='string'||!value.hlsUrl.startsWith('https://')) throw new Error('stream_ready_invariant_failed');
      return value;
    }
    if(value.status==='failed') throw new Error(value.errorCode||'stream_failed');
    await sleep(intervalMs);
  }
  throw new Error('stream_processing_timeout');
}

export function reconcilePublish({rpcError,linkedPost}) {
  if(!rpcError) return {published:true,cleanup:false};
  return linkedPost?{published:true,cleanup:false}:{published:false,cleanup:true};
}
