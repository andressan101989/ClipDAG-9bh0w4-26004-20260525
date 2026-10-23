/* eslint-disable import/no-unresolved */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from 'npm:@aws-sdk/client-s3@3.637.0';
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@3.637.0';

export const R2_PUT_URL_TTL_SECONDS=300;

function required(name:string):string {
  const value=Deno.env.get(name)?.trim();
  if(!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}
export const R2_PUBLIC_BUCKET=()=>required('R2_PUBLIC_BUCKET');
export const R2_PRIVATE_BUCKET=()=>required('R2_PRIVATE_BUCKET');
export const R2_PUBLIC_BASE_URL=()=>required('R2_PUBLIC_BASE_URL').replace(/\/+$/,'');
export function r2Client() {
  return new S3Client({
    region:'auto',
    endpoint:`https://${required('CLOUDFLARE_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    credentials:{accessKeyId:required('R2_ACCESS_KEY_ID'),secretAccessKey:required('R2_SECRET_ACCESS_KEY')},
  });
}
export const signPutIfAbsent=(bucket:string,key:string,mime:string,metadata:Record<string,string>)=>getSignedUrl(
  r2Client(),
  new PutObjectCommand({Bucket:bucket,Key:key,ContentType:mime,Metadata:metadata,IfNoneMatch:'*'}),
  {
    expiresIn:R2_PUT_URL_TTL_SECONDS,
    signableHeaders:new Set(['content-type','if-none-match']),
    unhoistableHeaders:new Set(['x-amz-meta-sha256']),
  },
);
export const signGet=(bucket:string,key:string,expiresIn=300)=>getSignedUrl(r2Client(),new GetObjectCommand({Bucket:bucket,Key:key}),{expiresIn});
export const signHead=(bucket:string,key:string,expiresIn=60)=>getSignedUrl(r2Client(),new HeadObjectCommand({Bucket:bucket,Key:key}),{expiresIn});
export const signDelete=(bucket:string,key:string,expiresIn=60)=>getSignedUrl(r2Client(),new DeleteObjectCommand({Bucket:bucket,Key:key}),{expiresIn});
const r2AbortSignal=(signal?:AbortSignal|null)=>{
  const timeout=AbortSignal.timeout(15_000);
  return signal?AbortSignal.any([signal,timeout]):timeout;
};
export const headObject=(bucket:string,key:string,signal?:AbortSignal|null)=>r2Client().send(
  new HeadObjectCommand({Bucket:bucket,Key:key}),
  {abortSignal:r2AbortSignal(signal)},
);
export const deleteObject=(bucket:string,key:string,signal?:AbortSignal|null)=>r2Client().send(
  new DeleteObjectCommand({Bucket:bucket,Key:key}),
  {abortSignal:r2AbortSignal(signal)},
);
function safeR2RequestId(result:unknown):string|null {
  if(!result||typeof result!=='object'||!('$metadata' in result)) return null;
  const metadata=(result as {$metadata?:{requestId?:unknown}}).$metadata;
  const value=typeof metadata?.requestId==='string'?metadata.requestId.trim():'';
  return /^[A-Za-z0-9._:-]{1,128}$/.test(value)?value:null;
}
export async function deleteObjectWithReceipt(
  bucket:string,key:string,signal?:AbortSignal|null,
):Promise<{
  accepted:boolean;
  alreadyAbsent:boolean;
  requestId:string|null;
}> {
  try {
    const result=await deleteObject(bucket,key,signal);
    return {accepted:true,alreadyAbsent:false,requestId:safeR2RequestId(result)};
  } catch(error) {
    if(isR2NotFound(error)) return {accepted:true,alreadyAbsent:true,requestId:safeR2RequestId(error)};
    throw error;
  }
}
export async function verifyObjectAbsent(
  bucket:string,key:string,signal?:AbortSignal|null,
):Promise<{
  absent:boolean;
  requestId:string|null;
}> {
  try {
    const result=await headObject(bucket,key,signal);
    return {absent:false,requestId:safeR2RequestId(result)};
  } catch(error) {
    if(isR2NotFound(error)) return {absent:true,requestId:safeR2RequestId(error)};
    throw error;
  }
}
export async function getObjectBytes(bucket:string,key:string,maxBytes:number):Promise<{bytes:Uint8Array;contentType:string|null}> {
  if(!bucket.trim()||!key.trim()||!Number.isInteger(maxBytes)||maxBytes<1) throw new Error('invalid_r2_object_request');
  const result=await r2Client().send(
    new GetObjectCommand({Bucket:bucket,Key:key}),
    {abortSignal:r2AbortSignal()},
  );
  const declared=Number(result.ContentLength??0);
  if(declared>maxBytes) throw new Error('r2_object_too_large');
  if(!result.Body) throw new Error('r2_object_empty');
  const bytes=await result.Body.transformToByteArray();
  if(!bytes.length) throw new Error('r2_object_empty');
  if(bytes.length>maxBytes) throw new Error('r2_object_too_large');
  return {bytes,contentType:result.ContentType??null};
}
export const publicUrl=(key:string)=>`${R2_PUBLIC_BASE_URL()}/${key.split('/').map(encodeURIComponent).join('/')}`;

export function r2ErrorStatus(error:unknown):number|undefined {
  if(!error||typeof error!=='object') return undefined;
  const value=error as {name?:string;$metadata?:{httpStatusCode?:number};statusCode?:number};
  return value.$metadata?.httpStatusCode??value.statusCode;
}
export function isR2NotFound(error:unknown):boolean {
  const name=error&&typeof error==='object'?'name' in error?String(error.name):'':'';
  return r2ErrorStatus(error)===404||name==='NoSuchKey'||name==='NotFound';
}
export function isR2Transient(error:unknown):boolean {
  const status=r2ErrorStatus(error);
  const name=error&&typeof error==='object'?'name' in error?String(error.name):'':'';
  return status===429||Boolean(status&&status>=500)||name==='TimeoutError'||name==='AbortError';
}
