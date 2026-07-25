import { authenticatedUser,admin,json } from '../_shared/mediaAuth.ts';
import { deleteObject,headObject,isR2NotFound,isR2Transient,publicUrl } from '../_shared/r2.ts';
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

async function headWithRetry(bucket:string,key:string) {
  let lastError:unknown;
  for(let attempt=0;attempt<3;attempt++) {
    try { return await headObject(bucket,key); }
    catch(error) {
      if(isR2NotFound(error)) throw error;
      lastError=error;
      if(!isR2Transient(error)&&attempt===2) throw error;
      if(attempt<2) await wait(150*(2**attempt));
    }
  }
  throw lastError;
}
Deno.serve(async(req)=>{
  if(req.method!=='POST') return json({error:'method_not_allowed'},405);
  const user=await authenticatedUser(req); if(!user) return json({error:'unauthorized'},401);
  const {asset_id}=await req.json().catch(()=>({})); const db=admin();
  const {data:a}=await db.from('media_assets').select('*').eq('id',asset_id).eq('owner_id',user.id).maybeSingle();
  if(!a) return json({error:'not_found'},404);
  if(a.status==='ready') return json({success:true,data:{assetId:a.id,provider:'r2',mediaKind:a.media_kind,purpose:a.purpose,visibility:a.visibility,status:'ready',...(a.visibility==='public'?{url:publicUrl(a.object_key)}:{})}});
  if(!['pending','uploading'].includes(a.status)) return json({error:'invalid_status'},409);
  try {
    const head=await headWithRetry(a.bucket_name,a.object_key);
    if(Number(head.ContentLength)!==Number(a.size_bytes)||head.ContentType!==a.mime_type) {
      await db.from('media_assets').update({
        status:'delete_pending',error_code:'object_mismatch',
        next_cleanup_attempt_at:new Date().toISOString(),updated_at:new Date().toISOString(),
      }).eq('id',a.id);
      try {
        await deleteObject(a.bucket_name,a.object_key);
        await db.from('media_assets').update({
          status:'deleted',deleted_at:new Date().toISOString(),next_cleanup_attempt_at:null,
          cleanup_attempts:Number(a.cleanup_attempts??0)+1,last_cleanup_attempt_at:new Date().toISOString(),
          updated_at:new Date().toISOString(),
        }).eq('id',a.id).eq('status','delete_pending');
      } catch {
        await db.from('media_assets').update({error_code:'object_mismatch_delete_retry'}).eq('id',a.id);
      }
      return json({error:'object_mismatch'},409);
    }
    await db.from('media_assets').update({status:'ready',etag:String(head.ETag??'').replaceAll('\"',''),ready_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',a.id);
    return json({success:true,data:{assetId:a.id,provider:'r2',mediaKind:a.media_kind,purpose:a.purpose,visibility:a.visibility,status:'ready',...(a.visibility==='public'?{url:publicUrl(a.object_key)}:{})}});
  } catch(error) {
    if(isR2NotFound(error)) {
      await db.from('media_assets').update({status:'failed',error_code:'object_missing',updated_at:new Date().toISOString()}).eq('id',a.id);
      return json({error:'object_missing'},409);
    }
    await db.from('media_assets').update({error_code:'head_temporarily_unavailable',updated_at:new Date().toISOString()})
      .eq('id',a.id).in('status',['pending','uploading']);
    return json({error:'head_temporarily_unavailable'},503);
  }
});
