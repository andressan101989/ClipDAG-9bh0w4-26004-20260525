/* eslint-disable import/no-unresolved */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from 'npm:@aws-sdk/client-s3@3.637.0';
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@3.637.0';

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
export const signPut=(bucket:string,key:string,mime:string)=>getSignedUrl(r2Client(),new PutObjectCommand({Bucket:bucket,Key:key,ContentType:mime}),{expiresIn:300});
export const signGet=(bucket:string,key:string)=>getSignedUrl(r2Client(),new GetObjectCommand({Bucket:bucket,Key:key}),{expiresIn:300});
export const headObject=(bucket:string,key:string)=>r2Client().send(new HeadObjectCommand({Bucket:bucket,Key:key}));
export const deleteObject=(bucket:string,key:string)=>r2Client().send(new DeleteObjectCommand({Bucket:bucket,Key:key}));
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
