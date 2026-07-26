import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

export const MAX_SIZE=200_000_000;
export const MAX_DURATION=60;
export const MIMES=new Set(['video/mp4','video/quicktime','video/webm']);
export const validMime=value=>MIMES.has(String(value??'').trim().toLowerCase());
export const validSize=value=>Number.isSafeInteger(Number(value))&&Number(value)>0&&Number(value)<=MAX_SIZE;
export const fallback=(uid,code)=>{
  const normalized=code.replace(/^customer-/i,'');
  const root=`https://customer-${normalized}.cloudflarestream.com/${uid}`;
  return {hls:`${root}/manifest/video.m3u8`,dash:`${root}/manifest/video.mpd`,thumbnail:`${root}/thumbnails/thumbnail.jpg`};
};
export function mapVideo(result,code='demo') {
  const state=String(result.status?.state??result.state??'').toLowerCase().replace(/[\s_-]/g,'');
  const status=state==='error'?'failed':state==='pendingupload'?'uploading':
    state==='ready'&&result.readyToStream===true?'ready':'processing';
  const urls=fallback(result.uid??'uid',code),ready=status==='ready';
  return {status,hls_url:ready?(result.playback?.hls??urls.hls):null,
    dash_url:ready?(result.playback?.dash??urls.dash):null,
    thumbnail_url:ready?(result.thumbnail??urls.thumbnail):null};
}
export function parseSignature(value) {
  if(!value) return null;
  const entries=Object.fromEntries(value.split(',').map(part=>part.trim().split('=',2)));
  const time=Number(entries.time);
  return Number.isInteger(time)&&/^[0-9a-f]{64}$/i.test(entries.sig1??'')
    ? {time,signature:entries.sig1.toLowerCase()}:null;
}
export const sign=(secret,message)=>crypto.createHmac('sha256',secret).update(message).digest('hex');
export function timingSafeHex(left,right) {
  if(left.length!==right.length) return false;
  return crypto.timingSafeEqual(Buffer.from(left),Buffer.from(right));
}
export function verify(raw,header,secret,now) {
  const parsed=parseSignature(header);
  if(!parsed||Math.abs(now-parsed.time)>300) return false;
  return timingSafeHex(sign(secret,`${parsed.time}.${raw}`),parsed.signature);
}
export const webhookVideo=payload=>typeof payload.uid==='string'?payload:
  payload.result&&typeof payload.result==='object'?payload.result:null;
export const safeError=error=>({
  code:Number(error?.status)===429||Number(error?.status)>=500?'stream_provider_temporarily_unavailable':'stream_provider_error',
  message:Number(error?.status)===429||Number(error?.status)>=500?'stream_provider_temporarily_unavailable':'stream_provider_error',
});
export async function createDirectUploadOnce(fetcher) {
  return fetcher('/direct_upload',{method:'POST'});
}
export const deleteSucceeded=status=>status>=200&&status<300||status===404;
